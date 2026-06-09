import request from 'supertest';
import { Application } from 'express';
import { makeTestApp } from '../helpers/make-test-app';
import { createDb } from '../../src/db/connection';
import { initDb } from '../../src/db/schema';
import { SqliteCampaignRepository } from '../../src/campaigns/campaign.repository';
import { CampaignService } from '../../src/campaigns/campaign.service';
import { createApp } from '../../src/app';

let app: Application;

// Fresh in-memory DB before every test — no cross-test pollution.
beforeEach(() => {
  ({ app } = makeTestApp());
});

const BASE = { name: 'Summer Sale', publisherId: 'pub-1', startDate: '2025-07-01' };

// ---------------------------------------------------------------------------
// POST /campaigns
// ---------------------------------------------------------------------------
describe('POST /campaigns', () => {
  it('201 with full body, Location header, and ETag: "1"', async () => {
    const res = await request(app).post('/campaigns').send(BASE);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      name: 'Summer Sale',
      publisherId: 'pub-1',
      startDate: '2025-07-01',
      status: 'active',
      createdAt: expect.any(String),
      version: 1,
    });
    expect(res.headers['location']).toBe(`/campaigns/${res.body.id}`);
    expect(res.headers['etag']).toBe('"1"');
  });

  it('defaults status to active when omitted', async () => {
    const res = await request(app).post('/campaigns').send(BASE);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
  });

  it('accepts status paused at creation', async () => {
    const res = await request(app).post('/campaigns').send({ ...BASE, status: 'paused' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('paused');
  });

  it('400 VALIDATION_ERROR — name missing', async () => {
    const { name: _n, ...noName } = BASE;
    const res = await request(app).post('/campaigns').send(noName);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: expect.any(String) });
    expect(Array.isArray(res.body.error.details)).toBe(true);
    const paths: string[] = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('name');
  });

  it('400 VALIDATION_ERROR — publisherId missing', async () => {
    const { publisherId: _p, ...noPublisher } = BASE;
    const res = await request(app).post('/campaigns').send(noPublisher);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths: string[] = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('publisherId');
  });

  it('400 VALIDATION_ERROR — startDate not a valid date string', async () => {
    const res = await request(app).post('/campaigns').send({ ...BASE, startDate: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /campaigns/:id
// ---------------------------------------------------------------------------
describe('GET /campaigns/:id', () => {
  it('200 with campaign body and ETag header', async () => {
    const { body: created } = await request(app).post('/campaigns').send(BASE);
    const res = await request(app).get(`/campaigns/${created.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.id);
    expect(res.headers['etag']).toBe('"1"');
  });

  it('404 NOT_FOUND — exact error envelope shape', async () => {
    const res = await request(app).get('/campaigns/unknown-id-xyz');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        message: expect.stringContaining('unknown-id-xyz'),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// GET /campaigns
// ---------------------------------------------------------------------------
describe('GET /campaigns', () => {
  it('400 VALIDATION_ERROR — publisherId missing', async () => {
    const res = await request(app).get('/campaigns');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('200 with { data, pagination } shape', async () => {
    const res = await request(app).get('/campaigns?publisherId=pub-1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: expect.any(Array),
      pagination: {
        limit: expect.any(Number),
        offset: expect.any(Number),
        total: expect.any(Number),
      },
    });
  });

  it('pagination: limit and offset are respected, total reflects all records', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).post('/campaigns').send(BASE);
    }

    const res = await request(app).get('/campaigns?publisherId=pub-1&limit=2&offset=0');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ limit: 2, offset: 0, total: 3 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /campaigns/:id
// ---------------------------------------------------------------------------
describe('PATCH /campaigns/:id', () => {
  it('200 legal transition active → paused, ETag bumped to "2"', async () => {
    const { body: created } = await request(app).post('/campaigns').send(BASE);
    const res = await request(app).patch(`/campaigns/${created.id}`).send({ status: 'paused' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
    expect(res.body.version).toBe(2);
    expect(res.headers['etag']).toBe('"2"');
  });

  it('409 CONFLICT — illegal transition ended → active', async () => {
    const { body: created } = await request(app).post('/campaigns').send(BASE);
    await request(app).patch(`/campaigns/${created.id}`).send({ status: 'ended' });

    const res = await request(app).patch(`/campaigns/${created.id}`).send({ status: 'active' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('ended'),
    });
  });

  it('404 NOT_FOUND — unknown campaign id', async () => {
    const res = await request(app).patch('/campaigns/no-such-id').send({ status: 'paused' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 VALIDATION_ERROR — unrecognised status value', async () => {
    const { body: created } = await request(app).post('/campaigns').send(BASE);
    const res = await request(app).patch(`/campaigns/${created.id}`).send({ status: 'unknown' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('optimistic locking (If-Match)', () => {
    it('200 when If-Match matches current version — version increments', async () => {
      const { body: created } = await request(app).post('/campaigns').send(BASE);

      const res = await request(app)
        .patch(`/campaigns/${created.id}`)
        .set('If-Match', '"1"')
        .send({ status: 'paused' });

      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
      expect(res.headers['etag']).toBe('"2"');
    });

    it('412 PRECONDITION_FAILED when If-Match is stale', async () => {
      const { body: created } = await request(app).post('/campaigns').send(BASE);
      // Advance version to 2
      await request(app)
        .patch(`/campaigns/${created.id}`)
        .set('If-Match', '"1"')
        .send({ status: 'paused' });

      // Now attempt with the stale version "1"
      const res = await request(app)
        .patch(`/campaigns/${created.id}`)
        .set('If-Match', '"1"')
        .send({ status: 'active' });

      expect(res.status).toBe(412);
      expect(res.body.error.code).toBe('PRECONDITION_FAILED');
    });

    it('412 PRECONDITION_FAILED for a stale If-Match even on a no-op transition', async () => {
      // Problem-B regression: precondition is evaluated before the same-status
      // shortcut, so a stale If-Match on a no-op must NOT return 200.
      const { body: created } = await request(app).post('/campaigns').send(BASE);
      // Advance version to 2 (status now paused).
      await request(app)
        .patch(`/campaigns/${created.id}`)
        .set('If-Match', '"1"')
        .send({ status: 'paused' });

      // Same-status PATCH (paused → paused) with the now-stale "1".
      const res = await request(app)
        .patch(`/campaigns/${created.id}`)
        .set('If-Match', '"1"')
        .send({ status: 'paused' });

      expect(res.status).toBe(412);
      expect(res.body.error.code).toBe('PRECONDITION_FAILED');
    });

    it('200 with no If-Match header — default last-write-wins flow is intact', async () => {
      const { body: created } = await request(app).post('/campaigns').send(BASE);
      const res = await request(app)
        .patch(`/campaigns/${created.id}`)
        .send({ status: 'paused' });

      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
      expect(res.headers['etag']).toBe('"2"');
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /campaigns/:id
// ---------------------------------------------------------------------------
describe('DELETE /campaigns/:id', () => {
  it('204 with no body on success', async () => {
    const { body: created } = await request(app).post('/campaigns').send(BASE);
    const res = await request(app).delete(`/campaigns/${created.id}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it('404 NOT_FOUND for unknown id', async () => {
    const res = await request(app).delete('/campaigns/no-such-id');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /campaigns/:id/metrics
// ---------------------------------------------------------------------------
describe('GET /campaigns/:id/metrics', () => {
  it('200 with { impressions, clicks, ctr } all in valid ranges', async () => {
    const { body: created } = await request(app).post('/campaigns').send(BASE);
    const res = await request(app).get(`/campaigns/${created.id}/metrics`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      impressions: expect.any(Number),
      clicks: expect.any(Number),
      ctr: expect.any(Number),
    });
    expect(res.body.impressions).toBeGreaterThanOrEqual(1000);
    expect(res.body.clicks).toBeGreaterThanOrEqual(0);
    expect(res.body.clicks).toBeLessThanOrEqual(res.body.impressions);
    expect(res.body.ctr).toBeGreaterThanOrEqual(0);
    expect(res.body.ctr).toBeLessThanOrEqual(1);
  });

  it('404 NOT_FOUND for unknown campaign id', async () => {
    const res = await request(app).get('/campaigns/unknown-metrics-id/metrics');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Error contract — catch-all 404, malformed JSON, generic 500
// ---------------------------------------------------------------------------
describe('error contract', () => {
  it('unknown route → 404 JSON envelope (not Express HTML)', async () => {
    const res = await request(app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: expect.any(String) });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('malformed JSON body → 400 VALIDATION_ERROR envelope (not 500)', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('Content-Type', 'application/json')
      .send('{ "name": "broken", '); // invalid JSON

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('unexpected error → generic 500 message, no internal detail leaked', async () => {
    const db = createDb(':memory:');
    initDb(db);
    const repo = new SqliteCampaignRepository(db);
    const secret = 'SQLITE_INTERNAL_TABLE_CORRUPTION_SECRET';
    jest.spyOn(repo, 'findById').mockRejectedValue(new Error(secret));
    const failingApp = createApp({ db, campaignService: new CampaignService(repo) });

    const res = await request(failingApp).get('/campaigns/anything');

    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// Pagination determinism — close-timestamp rows, no skips/dupes across pages
// ---------------------------------------------------------------------------
describe('pagination determinism', () => {
  it('returns each row exactly once when paging through same/close-timestamp rows', async () => {
    const TOTAL = 7;
    const created: string[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const { body } = await request(app).post('/campaigns').send(BASE);
      created.push(body.id);
    }

    const limit = 2;
    const seen: string[] = [];
    for (let offset = 0; offset < TOTAL; offset += limit) {
      const res = await request(app).get(`/campaigns?publisherId=pub-1&limit=${limit}&offset=${offset}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((c: { id: string }) => c.id));
    }

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL); // no duplicates
    expect(new Set(seen)).toEqual(new Set(created)); // no skips
  });
});
