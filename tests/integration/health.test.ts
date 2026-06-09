import request from 'supertest';
import { makeTestApp } from '../helpers/make-test-app';

describe('GET /health', () => {
  it('200 { status: true }', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: true });
  });
});
