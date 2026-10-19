import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { analyzeImage } from '../services/imageAnalysis.service';

// ~5 MB image limit: base64 encodes 3 bytes → 4 chars, so 5 MB ≈ 6,710,887 chars
const MAX_IMAGE_BASE64_LENGTH = 7_000_000;

const bodySchema = z.object({
  imageBase64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH, {
    message: 'Image exceeds the 5 MB size limit',
  }),
  language: z.string().min(2).max(10).default('en'),
});

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
};

function checkApiKey(event: APIGatewayProxyEventV2): boolean {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error('API_KEY env var is not set');
    return false;
  }
  const provided = event.headers?.['x-api-key'] ?? event.headers?.['X-Api-Key'] ?? '';
  return provided === apiKey;
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  if (!checkApiKey(event)) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    let json: unknown;
    try {
      json = event.body ? JSON.parse(event.body) : {};
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid JSON body' }),
      };
    }

    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid request body', details: parsed.error.flatten() }),
      };
    }

    const { imageBase64, language } = parsed.data;
    const result = await analyzeImage({ imageBase64, outputLanguage: language });

    if (!result.ok) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, analysis: result.analysis }),
    };

  } catch (err) {
    console.error('analyzeImage handler error', (err as Error)?.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
