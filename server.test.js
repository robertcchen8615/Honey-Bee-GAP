process.env.OPENAI_API_KEY = "test";
process.env.CHANNEL_ACCESS_TOKEN = "test"; process.env.CHANNEL_SECRET = "test";
const request = require('supertest');
const app = require('./server');

describe('GET /health', () => {
  it('returns health status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });
});
