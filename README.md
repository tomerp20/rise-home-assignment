# Campaign Management API

A REST API for creating and managing advertising campaigns with a status lifecycle and optimistic concurrency control.

## Overview

Advertisers run **campaigns** on behalf of publishers. Each campaign has a name, an owning `publisherId`, a `startDate`, and a `status` that moves through a small lifecycle (`active` ⇄ `paused` → `ended`). The API exposes the five CRUD operations over campaigns plus a `/health` probe and a `/campaigns/:id/metrics` endpoint.

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
