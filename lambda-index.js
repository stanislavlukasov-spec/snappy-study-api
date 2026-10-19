require('dotenv').config();

const { z } = require('zod');
const OpenAI = require('openai');

// ── Constants ──────────────────────────────────────────────────────────────────
// ~5 MB image limit: base64 encodes 3 bytes → 4 chars, so 5 MB ≈ 6,710,887 chars
const MAX_IMAGE_BASE64_LENGTH = 7_000_000;
// TTS input cap — OpenAI limit is 4,096 chars; we enforce a conservative limit
const MAX_TTS_TEXT_LENGTH = 3_000;

// ── API key auth ───────────────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;

function checkApiKey(event) {
  if (!API_KEY) {
    // No key configured — fail closed in production, warn in dev
    console.error('API_KEY env var is not set');
    return false;
  }
  const provided = event.headers?.['x-api-key'] || event.headers?.['X-Api-Key'] || '';
  return provided === API_KEY;
}

// ── CORS ───────────────────────────────────────────────────────────────────────
function getCorsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  };
}

// ── OpenAI client ──────────────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment (Lambda env var)');
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Helpers ────────────────────────────────────────────────────────────────────
function jsonResponse(statusCode, body, corsHeaders) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function normalizePath(rawPath) {
  if (!rawPath) return '/';
  // Strip stage prefix if present (e.g. /prod/analyze-image -> /analyze-image)
  const parts = rawPath.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  if (parts[0] === 'prod') parts.shift();
  return '/' + parts.join('/');
}

// ── Lambda handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const cors = getCorsHeaders();

  try {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const rawPath = event.requestContext?.http?.path || event.path || '/';
    const path = normalizePath(rawPath);

    console.log(`[Lambda] ${method} ${path}`);

    // ── GET /health (public) ───────────────────────────────────────────────────
    if (path === '/health' && method === 'GET') {
      return jsonResponse(200, { status: 'ok', service: 'snappy-study-api' }, cors);
    }

    // ── Auth: all routes below require a valid x-api-key ──────────────────────
    if (!checkApiKey(event)) {
      return jsonResponse(401, { error: 'Unauthorized' }, cors);
    }

    // ── POST /tts ──────────────────────────────────────────────────────────────
    if (path === '/tts' && method === 'POST') {
      let body;
      try {
        const rawBody = event.body || '{}';
        body = event.isBase64Encoded
          ? JSON.parse(Buffer.from(rawBody, 'base64').toString('utf8'))
          : JSON.parse(rawBody);
      } catch {
        return jsonResponse(400, { error: 'Invalid JSON body' }, cors);
      }

      const schema = z.object({
        text: z.string().min(1).max(MAX_TTS_TEXT_LENGTH, {
          message: `Text must be ${MAX_TTS_TEXT_LENGTH} characters or fewer`,
        }),
        language: z.string().min(2).max(10).optional().default('en'),
      });

      const parseResult = schema.safeParse(body || {});
      if (!parseResult.success) {
        return jsonResponse(400, {
          error: 'Invalid request body',
          details: parseResult.error.flatten(),
        }, cors);
      }

      const { text, language } = parseResult.data;

      try {
        const speechResponse = await openai.audio.speech.create({
          model: 'gpt-4o-mini-tts',
          voice: 'alloy',
          format: 'mp3',
          input: `Read the following text naturally in the language with code "${language}". Do not translate it, just read it as written. Text: ${text}`,
        });

        const audioBase64 = Buffer.from(await speechResponse.arrayBuffer()).toString('base64');

        return jsonResponse(200, { success: true, audioBase64 }, cors);
      } catch (err) {
        console.error('OpenAI error in /tts:', err?.message);
        return jsonResponse(502, { error: 'Failed to generate speech' }, cors);
      }
    }

    // ── POST /analyze-image ────────────────────────────────────────────────────
    if (path === '/analyze-image' && method === 'POST') {
      let body;
      try {
        const rawBody = event.body || '{}';
        body = event.isBase64Encoded
          ? JSON.parse(Buffer.from(rawBody, 'base64').toString('utf8'))
          : JSON.parse(rawBody);
      } catch {
        return jsonResponse(400, { error: 'Invalid JSON body' }, cors);
      }

      const schema = z.object({
        imageBase64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH, {
          message: 'Image exceeds the 5 MB size limit',
        }),
        language: z.string().min(2).max(10).optional().default('en'),
      });

      const parseResult = schema.safeParse(body || {});
      if (!parseResult.success) {
        return jsonResponse(400, {
          error: 'Invalid request body',
          details: parseResult.error.flatten(),
        }, cors);
      }

      const { imageBase64, language } = parseResult.data;

      const imagePart = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      // ── Step 1: classify ────────────────────────────────────────────────────
      let classification;
      try {
        const classificationResponse = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content:
                "You classify images for a children's homework helper app. Your job is only to decide if an image is clearly children's homework or not.",
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Look at this image and answer with exactly one word: "educational" or "not_educational".

- Answer "educational" ONLY if the image clearly shows children's homework or study material: textbook pages, worksheets, math problems, school-style diagrams, class notes, or very similar school assignments.
- In all other cases (pets like cats/dogs, people, rooms, furniture, food, travel, nature, memes, social media screenshots, random web images, advertisements, etc.), answer "not_educational".

Return exactly one word: educational OR not_educational.`,
                },
                {
                  type: 'image_url',
                  image_url: { url: imagePart },
                },
              ],
            },
          ],
        });

        classification = (classificationResponse.choices?.[0]?.message?.content || '').trim().toLowerCase();
        console.log(`[Lambda] /analyze-image classification: ${classification}`);
      } catch (err) {
        console.error('OpenAI error in classification step:', err?.message);
        return jsonResponse(502, { error: 'Image classification service failed. Please try again later.' }, cors);
      }

      // ── Step 2a: not educational — return localised refusal ─────────────────
      if (classification !== 'educational') {
        try {
          const refusalResponse = await openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [
              {
                role: 'system',
                content: "You translate short messages for a children's homework helper app.",
              },
              {
                role: 'user',
                content: `Translate this sentence into the language with code "${language}". Return only the translated sentence, nothing else:\n\n"This image doesn\u2019t appear to be educational content for children\u2019s homework, so I can\u2019t analyze it."`,
              },
            ],
          });

          const refusalText =
            refusalResponse.choices?.[0]?.message?.content?.trim() ||
            "This image doesn\u2019t appear to be educational content for children\u2019s homework, so I can\u2019t analyze it.";

          return jsonResponse(200, { success: true, analysis: refusalText }, cors);
        } catch (err) {
          console.error('OpenAI error in refusal translation:', err?.message);
          return jsonResponse(502, { error: 'Image analysis service failed. Please try again later.' }, cors);
        }
      }

      // ── Step 2b: educational — perform homework analysis ────────────────────
      const analysisPrompt = `You are a homework helper for children.

The image contains educational homework content. Analyse it and break your response into 2–4 short, focused sections.

You MUST respond with valid JSON in this exact format — no text outside the JSON:
{
  "ok": true,
  "sections": [
    { "title": "<section title>", "text": "<section content>" }
  ]
}

Guidelines:
- Choose section titles that suit the content type. Good examples: "What this is", "Main content", "Key vocabulary", "Step-by-step", "How to approach it", "Tips", "Examples".
- Keep each "text" clear, concise, and student-friendly (2–4 sentences max per section).
- Respond entirely in the language with code "${language}" — both titles and text.
- Do NOT add any commentary, markdown, or text outside the JSON object.`;

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a homework helper for children. Always respond with valid JSON only — no markdown, no extra text.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: analysisPrompt },
                { type: 'image_url', image_url: { url: imagePart } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
        });

        const content = response.choices?.[0]?.message?.content || '';
        console.log(`[Lambda] /analyze-image analysis complete (${content.length} chars)`);

        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch {
          // Fallback: wrap raw text as a single section
          return jsonResponse(200, {
            success: true,
            sections: [{ title: '', text: content }],
          }, cors);
        }

        if (parsed.sections && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
          return jsonResponse(200, { success: true, sections: parsed.sections }, cors);
        }

        // Model returned JSON but wrong shape — wrap whatever text we can find
        const fallbackText = parsed.text || parsed.analysis || content;
        return jsonResponse(200, {
          success: true,
          sections: [{ title: '', text: fallbackText }],
        }, cors);
      } catch (err) {
        console.error('OpenAI error in analysis step:', err?.message);
        const code = err?.code || err?.error?.code;
        if (code === 'insufficient_quota' || err?.status === 429) {
          return jsonResponse(429, {
            error: 'Image analysis temporarily unavailable due to API quota limits. Please try again later.',
            code: 'insufficient_quota',
          }, cors);
        }
        return jsonResponse(502, { error: 'Image analysis service failed. Please try again later.' }, cors);
      }
    }

    return jsonResponse(404, { error: 'Not Found' }, cors);
  } catch (err) {
    console.error('Unhandled error in Lambda handler:', err?.message);
    return jsonResponse(500, { error: 'Internal server error' }, cors);
  }
};
