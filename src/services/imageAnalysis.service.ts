import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import { env } from '../config/env';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export interface AnalyzeImageInput {
  imageBase64: string;
  outputLanguage: string; // language code for response
}

export interface AnalyzeImageResult {
  ok: boolean;
  /**
   * When ok === false, a machine-readable error code, e.g. "NOT_EDUCATIONAL".
   */
  errorCode?: string;
  /**
   * Human-readable error message when ok === false.
   */
  errorMessage?: string;
  /**
   * Free-form analysis text (translated + explained) when ok === true.
   */
  analysis?: string;
}

export async function analyzeImage({
  imageBase64,
  outputLanguage,
}: AnalyzeImageInput): Promise<AnalyzeImageResult> {
  const imagePart = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  const prompt = `You are an image analysis service for a study/learning app.

You will receive an image. Follow these rules:

1) First, decide if the image contains educational content clearly aimed at learning or practice.
   Be STRICT and CONSERVATIVE:
   - ONLY mark it as educational if MOST of what you see is clearly schoolwork or study material for children or students.
   - If you are NOT SURE, treat it as NOT educational.

   Examples of educational content: homework, worksheets, textbook pages with exercises, quizzes, math problems, language exercises, diagrams with questions, etc.
   Examples of NOT educational content: memes, random photos, screenshots of chats or social media, invoices, contracts, adult work documents, advertisements, logos, UI screenshots, random web pages, etc.

2) If the image does NOT contain educational content (or you are unsure), you MUST respond with JSON in this form:

{
  "ok": false,
  "errorCode": "NOT_EDUCATIONAL",
  "errorMessage": "The uploaded image does not appear to contain educational content."
}

3) If the image DOES contain educational content:
   - Detect the language or languages present in the image.
   - Extract the important text or information a student might care about.
   - Explain the content clearly and concisely.
   - ALWAYS respond in the output language with code "${outputLanguage}" (regardless of the language in the image).
   - If there are exercises or questions, help the student understand how to approach them, but do NOT give the final answers directly. Use hints and explain concepts instead.

   In this case, respond with JSON in this form:

{
  "ok": true,
  "analysis": "...your explanation and translated content here as a single string..."
}

4) IMPORTANT:
   - ALWAYS respond with JSON matching one of the two shapes above.
   - Do NOT include any extra keys. Do NOT include any commentary outside the JSON.`;

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'You are an image analysis service for a study/learning app. Be concise, student-friendly, and strictly follow the requested JSON format.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'input_image',
          image_url: { url: imagePart },
        },
      ],
    },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices?.[0]?.message?.content ?? '';

  if (!content) {
    return {
      ok: false,
      errorCode: 'MODEL_EMPTY',
      errorMessage: 'Empty response from model',
    };
  }

  try {
    const parsed = JSON.parse(content);

    // Normalize to our result type
    if (parsed && parsed.ok === false) {
      return {
        ok: false,
        errorCode: typeof parsed.errorCode === 'string' ? parsed.errorCode : 'NOT_EDUCATIONAL',
        errorMessage:
          typeof parsed.errorMessage === 'string'
            ? parsed.errorMessage
            : 'The uploaded image does not appear to contain educational content.',
      };
    }

    return {
      ok: true,
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '',
    };
  } catch (e) {
    console.error('Failed to parse model JSON for analyzeImage', e, content);
    // Fallback: treat whole content as analysis text
    return {
      ok: true,
      analysis: content,
    };
  }
}
