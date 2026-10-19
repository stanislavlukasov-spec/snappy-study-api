// Must be declared before the import block so the hoisted jest.mock factory can
// close over a jest.fn() that is already initialised.
// We use the factory form of jest.mock so the constructor mock is in place
// BEFORE the service module loads and calls `new OpenAI(...)` at the top level.
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

import OpenAI from 'openai';
import { analyzeImage } from '../../src/services/imageAnalysis.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retrieve the `chat.completions.create` mock from the single OpenAI instance
 * that was created when the service module loaded.
 */
function getMockCreate(): jest.Mock {
  const instance = (OpenAI as jest.MockedClass<typeof OpenAI>).mock.results[0].value;
  return instance.chat.completions.create as jest.Mock;
}

function mockModelResponse(content: string) {
  getMockCreate().mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
}

beforeEach(() => {
  getMockCreate().mockClear();
});

// ── Educational content ───────────────────────────────────────────────────────

describe('analyzeImage service – educational content', () => {
  it('returns ok:true with analysis text', async () => {
    mockModelResponse(JSON.stringify({ ok: true, analysis: 'This is a maths worksheet about addition.' }));

    const result = await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    expect(result.ok).toBe(true);
    expect(result.analysis).toBe('This is a maths worksheet about addition.');
  });

  it('returns ok:true with an empty analysis string when model omits it', async () => {
    mockModelResponse(JSON.stringify({ ok: true }));

    const result = await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    expect(result.ok).toBe(true);
    expect(result.analysis).toBe('');
  });
});

// ── NOT_EDUCATIONAL ───────────────────────────────────────────────────────────

describe('analyzeImage service – not educational', () => {
  it('returns ok:false with errorCode NOT_EDUCATIONAL', async () => {
    mockModelResponse(JSON.stringify({
      ok: false,
      errorCode: 'NOT_EDUCATIONAL',
      errorMessage: 'The uploaded image does not appear to contain educational content.',
    }));

    const result = await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('NOT_EDUCATIONAL');
    expect(result.errorMessage).toBeDefined();
  });

  it('defaults errorCode to NOT_EDUCATIONAL when model omits it', async () => {
    mockModelResponse(JSON.stringify({ ok: false }));

    const result = await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('NOT_EDUCATIONAL');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('analyzeImage service – edge cases', () => {
  it('returns MODEL_EMPTY when the model returns no content', async () => {
    getMockCreate().mockResolvedValueOnce({ choices: [{ message: { content: '' } }] });

    const result = await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('MODEL_EMPTY');
  });

  it('returns MODEL_EMPTY when choices array is empty', async () => {
    getMockCreate().mockResolvedValueOnce({ choices: [] });

    const result = await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('MODEL_EMPTY');
  });

  it('falls back to raw content as analysis when model returns invalid JSON', async () => {
    mockModelResponse('not valid json at all');

    const result = await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    expect(result.ok).toBe(true);
    expect(result.analysis).toBe('not valid json at all');
  });

  it('prepends data:image/jpeg;base64, when imageBase64 has no data: prefix', async () => {
    mockModelResponse(JSON.stringify({ ok: true, analysis: 'ok' }));

    await analyzeImage({ imageBase64: 'rawbase64==', outputLanguage: 'en' });

    const call = getMockCreate().mock.calls[0][0];
    const imageContent = call.messages[1].content.find((c: any) => c.type === 'input_image');
    expect(imageContent.image_url.url).toBe('data:image/jpeg;base64,rawbase64==');
  });

  it('uses the data: URI as-is when imageBase64 already has a data: prefix', async () => {
    mockModelResponse(JSON.stringify({ ok: true, analysis: 'ok' }));

    await analyzeImage({ imageBase64: 'data:image/png;base64,abc123', outputLanguage: 'en' });

    const call = getMockCreate().mock.calls[0][0];
    const imageContent = call.messages[1].content.find((c: any) => c.type === 'input_image');
    expect(imageContent.image_url.url).toBe('data:image/png;base64,abc123');
  });

  it('passes the outputLanguage code into the prompt', async () => {
    mockModelResponse(JSON.stringify({ ok: true, analysis: 'Tekst.' }));

    await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'et' });

    const call = getMockCreate().mock.calls[0][0];
    const userText = call.messages[1].content.find((c: any) => c.type === 'text');
    expect(userText.text).toContain('"et"');
  });

  it('uses json_object response_format', async () => {
    mockModelResponse(JSON.stringify({ ok: true, analysis: 'ok' }));

    await analyzeImage({ imageBase64: 'abc123', outputLanguage: 'en' });

    const call = getMockCreate().mock.calls[0][0];
    expect(call.response_format).toEqual({ type: 'json_object' });
  });
});
