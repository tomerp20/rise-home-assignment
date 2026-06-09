# Campaign Management API

A REST API for creating and managing advertising campaigns with a status lifecycle and optimistic concurrency control.

## Overview

Advertisers run **campaigns** on behalf of publishers. Each campaign has a name, an owning `publisherId`, a `startDate`, and a `status` that moves through a small lifecycle (`active` ⇄ `paused` → `ended`). The API exposes the five CRUD operations over campaigns plus a `/health` probe and a `/campaigns/:id/metrics` endpoint.

Two parts are worth a closer look:

- **Status state machine** — illegal transitions (e.g. resurrecting an `ended` campaign) are rejected with `409`, so status is never silently corrupted.
- **Optimistic locking** — every read returns an `ETag`; clients send it back as `If-Match` on update, and a concurrent edit fails loudly instead of last-write-wins.

## Tech stack

- **Runtime:** Node 20 + TypeScript (CommonJS)
- **Web:** Express
- **Storage:** SQLite via `better-sqlite3` (local) / DynamoDB (deployed)
- **Validation:** Zod
- **Logging:** pino (`pino-http`)
- **Tests:** Jest + supertest
- **Deploy:** Serverless Framework → AWS Lambda

## Quick Start

```bash
# Prerequisites: Node 20+, npm
cp .env.example .env       # PORT, DB_PATH, LOG_LEVEL — defaults are fine
npm install
npm run dev                # tsx watch — restarts on save
```

The server listens on **http://localhost:3000** (override with `PORT`). The SQLite file is created automatically at `DB_PATH` (default `./data/campaigns.sqlite`). Verify it is up:

```bash
curl http://localhost:3000/health
# → 200 {"status":true}
```

## Running tests

```bash
npm test
```

Jest covers the state-machine and locking logic as unit tests against the service, plus supertest integration tests that exercise the routes end-to-end over an in-memory SQLite database — including the error paths (validation `400`, not-found `404`, illegal-transition and version `409`).

## API reference

| Method   | Path                      | Purpose                                          |
| -------- | ------------------------- | ------------------------------------------------ |
| `GET`    | `/health`                 | Liveness + DB ping                               |
| `POST`   | `/campaigns`              | Create a campaign                                |
| `GET`    | `/campaigns`              | List by publisher (paginated)                    |
| `GET`    | `/campaigns/:id`          | Fetch one (returns `ETag`)                       |
| `PATCH`  | `/campaigns/:id`          | Change status (accepts `If-Match`)               |
| `DELETE` | `/campaigns/:id`          | Hard-delete                                      |
| `GET`    | `/campaigns/:id/metrics`  | Impressions / clicks / CTR                       |

**Pagination:** `GET /campaigns` requires a `publisherId` query param and accepts `limit` (1–100, default 20) and `offset` (default 0); responses carry `{ data, pagination: { limit, offset, total } }`.
**Concurrency:** `GET` and `PATCH` return an `ETag` (the campaign `version`, e.g. `"1"`). Send it as `If-Match` on `PATCH`; a stale value yields `409 VERSION_CONFLICT`.

```bash
# Create, then pause it
curl -X POST http://localhost:3000/campaigns \
  -H 'Content-Type: application/json' \
  -d '{"name":"Summer Sale","publisherId":"pub-42","startDate":"2026-07-01"}'

curl -X PATCH http://localhost:3000/campaigns/<id> \
  -H 'Content-Type: application/json' -H 'If-Match: "1"' \
  -d '{"status":"paused"}'
```

## Design decisions

Each is **decision → why → tradeoff**.

- **Status state machine** (`active`⇄`paused`→`ended`, `ended` terminal). The lifecycle lives in one transition table, checked before any write; illegal moves return `409`. _Tradeoff:_ adding a status means editing the table, but the rules can never drift across call sites.
- **Optimistic locking via `ETag` / `If-Match`.** Concurrent status updates are likely; a version check (`UPDATE … WHERE id=? AND version=?`) makes a lost update fail loudly as `409` rather than silently overwrite. The DynamoDB equivalent is a `ConditionExpression`. _Tradeoff:_ clients must round-trip the `ETag`; `If-Match` is optional, so callers opt into safety.
- **Offset/limit pagination.** Simple, stateless, and enough at take-home scale; `total` is returned for UI paging. _Tradeoff:_ deep offsets get expensive and can skip rows under concurrent inserts — a cursor is the at-scale answer.
- **Storage behind a `CampaignRepository` interface.** The service depends on the interface, not SQLite; the same code runs on `SqliteCampaignRepository` locally and a DynamoDB implementation in Lambda. _Tradeoff:_ the interface is the lowest common denominator (PK = `id`, a GSI on `publisherId` to avoid a full table scan), so storage-specific tricks stay out of the service.
- **Zod as the single source of truth.** One schema per payload yields both runtime validation and the inferred TypeScript types. _Tradeoff:_ validation is centralized in middleware, away from the handler it guards.
- **Structured logging with pino**, silenced under `NODE_ENV=test` to keep test output clean.
- **Hard delete.** No dependent records are in scope, so `DELETE` removes the row. _Tradeoff:_ no audit trail or restore — soft-delete is the obvious next step.

**Architecture** is a thin layered stack: routes act as controllers (parse, validate, set headers) → `CampaignService` holds the domain rules → `CampaignRepository` owns persistence. Errors flow through a single `AppError` → error-handler middleware that renders `{ error: { code, message } }`.

## Project structure

```
src/
  app.ts                 # Express app wiring (logger, routes, error handler)
  server.ts              # Composition root: db + service + listen
  config.ts              # Env-driven config
  campaigns/             # routes · service · repository · schema · types
  health/                # health route
  db/                    # connection + schema (DDL)
  middleware/            # validate · error-handler
  errors/                # AppError
tests/                   # supertest integration + helpers
```

## Deployment

Deployed with the **Serverless Framework** to **AWS Lambda + API Gateway (HTTP API) + DynamoDB** (region `il-central-1`).

**Live URL:** https://51h5206mxe.execute-api.il-central-1.amazonaws.com

```bash
npx serverless@3 deploy --region il-central-1
```

The storage layer swaps via the `STORAGE` env var (`sqlite` | `dynamodb`) — same application code, a DynamoDB-backed `CampaignRepository` in the cloud. The table is keyed on `id` with a `publisherId-index` GSI for list queries. Cost guardrails: DynamoDB is **PAY_PER_REQUEST** (on-demand) and the function runs with **no VPC** (no NAT cost). Tear everything down with:

```bash
npx serverless@3 remove --region il-central-1
```

## Assumptions / What I'd do with more time

- **Publishers are out of scope** — `publisherId` is an opaque string; there's no publisher resource or ownership/auth check.
- **`PATCH` is status-only** by design (the one field with real lifecycle rules); editing `name`/`startDate` would be a separate concern.
- **Metrics are synthetic** — `/metrics` returns plausible random numbers; a real implementation would read from an analytics store.
- **Next steps for production:** soft delete + audit trail, authN/Z, and cursor-based listing to replace deep offsets.
