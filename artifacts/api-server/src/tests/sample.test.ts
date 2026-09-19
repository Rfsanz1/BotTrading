import request from 'supertest';
import app from '../app';

describe('basic', () => {
  it('healthz', async () => {
    const res = await request(app).get('/api/healthz');
    expect(res.status).toBe(200);
  });
});
