import { handler } from '../../src/handlers/health';

describe('health handler', () => {
  it('returns 200', async () => {
    const result = await handler({} as any);
    expect((result as any).statusCode).toBe(200);
  });

  it('returns status:ok and service name', async () => {
    const result = await handler({} as any);
    const body = JSON.parse((result as any).body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('snappy-study-api');
  });

  it('includes CORS headers', async () => {
    const result = await handler({} as any);
    expect((result as any).headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
