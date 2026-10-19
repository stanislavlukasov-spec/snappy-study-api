import { handler } from '../../src/handlers/analyzeImage';

// Mock the service so handler tests don't touch OpenAI
jest.mock('../../src/services/imageAnalysis.service');

import { analyzeImage } from '../../src/services/imageAnalysis.service';
const mockAnalyzeImage = analyzeImage as jest.MockedFunction<typeof analyzeImage>;

const TEST_API_KEY = 'test-api-key-abc123';

/** Build a valid event with the correct API key header by default. */
function makeEvent(body: unknown, headers: Record<string, string> = {}) {
  return {
    body: JSON.stringify(body),
    headers: { 'x-api-key': TEST_API_KEY, ...headers },
  } as any;
}

beforeAll(() => { process.env.API_KEY = TEST_API_KEY; });
afterAll(() => { delete process.env.API_KEY; });
beforeEach(() => jest.clearAllMocks());

// ── Validation ────────────────────────────────────────────────────────────────

describe('analyzeImage handler – validation', () => {
  it('returns 400 when body is missing', async () => {
    const result = await handler({ body: undefined, headers: { 'x-api-key': TEST_API_KEY } } as any) as any;
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/invalid request body/i);
  });

  it('returns 400 when imageBase64 is missing', async () => {
    const result = await handler(makeEvent({ language: 'en' })) as any;
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when imageBase64 is an empty string', async () => {
    const result = await handler(makeEvent({ imageBase64: '', language: 'en' })) as any;
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 with validation details', async () => {
    const result = await handler(makeEvent({})) as any;
    const body = JSON.parse(result.body);
    expect(body.details).toBeDefined();
  });
});

// ── Successful analysis ───────────────────────────────────────────────────────

describe('analyzeImage handler – successful analysis', () => {
  it('returns 200 with analysis when service succeeds', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({ ok: true, analysis: 'This is a maths worksheet.' });

    const result = await handler(makeEvent({ imageBase64: 'abc123', language: 'en' })) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.analysis).toBe('This is a maths worksheet.');
  });

  it('defaults language to "en" when not provided', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({ ok: true, analysis: 'Some text.' });

    await handler(makeEvent({ imageBase64: 'abc123' }));

    expect(mockAnalyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({ outputLanguage: 'en' })
    );
  });

  it('forwards the requested language to the service', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({ ok: true, analysis: 'Tekst.' });

    await handler(makeEvent({ imageBase64: 'abc123', language: 'et' }));

    expect(mockAnalyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({ outputLanguage: 'et' })
    );
  });

  it('forwards imageBase64 to the service', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({ ok: true, analysis: 'Result.' });

    await handler(makeEvent({ imageBase64: 'base64data==', language: 'en' }));

    expect(mockAnalyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({ imageBase64: 'base64data==' })
    );
  });

  it('includes CORS headers on success', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({ ok: true, analysis: 'ok' });
    const result = await handler(makeEvent({ imageBase64: 'x', language: 'en' })) as any;
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});

// ── NOT_EDUCATIONAL ───────────────────────────────────────────────────────────

describe('analyzeImage handler – not educational', () => {
  it('returns 200 with success:false and errorCode when service rejects the image', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({
      ok: false,
      errorCode: 'NOT_EDUCATIONAL',
      errorMessage: 'The uploaded image does not appear to contain educational content.',
    });

    const result = await handler(makeEvent({ imageBase64: 'abc123', language: 'en' })) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('NOT_EDUCATIONAL');
    expect(body.errorMessage).toBeDefined();
  });

  it('does not include an analysis field when not educational', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({ ok: false, errorCode: 'NOT_EDUCATIONAL', errorMessage: 'Nope' });
    const result = await handler(makeEvent({ imageBase64: 'x', language: 'en' })) as any;
    const body = JSON.parse(result.body);
    expect(body.analysis).toBeUndefined();
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('analyzeImage handler – error handling', () => {
  it('returns 500 when the service throws', async () => {
    mockAnalyzeImage.mockRejectedValueOnce(new Error('OpenAI unavailable'));

    const result = await handler(makeEvent({ imageBase64: 'abc123', language: 'en' })) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/internal server error/i);
  });

  it('returns 400 when body is unparseable JSON', async () => {
    const result = await handler({ body: '{bad json', headers: { 'x-api-key': TEST_API_KEY } } as any) as any;
    expect(result.statusCode).toBe(400);
  });
});

// ── Authentication ────────────────────────────────────────────────────────────

describe('analyzeImage handler – authentication', () => {
  it('returns 401 when x-api-key header is missing', async () => {
    const result = await handler({ body: JSON.stringify({ imageBase64: 'abc', language: 'en' }), headers: {} } as any) as any;
    expect(result.statusCode).toBe(401);
  });

  it('returns 401 when x-api-key header is wrong', async () => {
    const result = await handler(makeEvent({ imageBase64: 'abc', language: 'en' }, { 'x-api-key': 'wrong-key' })) as any;
    expect(result.statusCode).toBe(401);
  });

  it('includes CORS headers even on 401', async () => {
    const result = await handler({ body: JSON.stringify({ imageBase64: 'abc' }), headers: {} } as any) as any;
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
