require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { z } = require('zod');
const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---- OpenAI client ----
if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment');
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Health check ----
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'snappy-study-api' });
});

// ---- Analyze image ----
// Expects JSON body: { imageBase64: string, language?: string }
// language = desired OUTPUT language; image language is auto-detected by the model.
app.post('/analyze-image', async (req, res) => {
  try {
    console.log('Incoming /analyze-image body keys:', Object.keys(req.body || {}));

    const schema = z.object({
      imageBase64: z.string().min(1),
      language: z.string().min(1).optional().default('en'),
    });

    const parseResult = schema.safeParse(req.body || {});
    if (!parseResult.success) {
      console.error('Validation error in /analyze-image:', parseResult.error.flatten());
      return res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
    }

    const { imageBase64, language } = parseResult.data;

    const imagePart = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    // --- Step 1: Classify image as educational vs not_educational ---
    console.log('Calling OpenAI for /analyze-image: classification step');

    const classificationResponse = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content:
            'You classify images for a children\'s homework helper app. Your job is only to decide if an image is clearly children\'s homework or not.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Look at this image and answer with exactly one word: "educational" or "not_educational".

- Answer "educational" ONLY if the image clearly shows children\'s homework or study material: textbook pages, worksheets, math problems, school-style diagrams, class notes, or very similar school assignments.
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

    const classificationRaw = classificationResponse.choices?.[0]?.message?.content || '';
    const classification = classificationRaw.trim().toLowerCase();

    console.log('Image classification result:', classificationRaw);

    // --- If NOT educational: return localized refusal, no image analysis ---
    if (classification !== 'educational') {
      console.log('Image classified as not_educational; generating refusal message');

      const refusalResponse = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content:
              'You translate short messages for a children\'s homework helper app.',
          },
          {
            role: 'user',
            content: `Translate this sentence into the language with code "${language}". Return only the translated sentence, nothing else:\n\n"This image doesn\u2019t appear to be educational content for children\u2019s homework, so I can\u2019t analyze it."`,
          },
        ],
      });

      const refusalText =
        refusalResponse.choices?.[0]?.message?.content?.trim() ||
        'This image doesn\u2019t appear to be educational content for children\u2019s homework, so I can\u2019t analyze it.';

      console.log('Refusal text length:', refusalText.length);

      return res.json({
        success: true,
        analysis: refusalText,
      });
    }

    // --- If educational: perform normal homework-oriented analysis ---
    console.log('Image classified as educational; performing homework analysis');

    const analysisPrompt = `You are a homework helper for children.

The image has been classified as educational homework content. Please:
1. Automatically detect the language(s) present in the image.
2. Extract any important text or information a student might care about.
3. Explain the content clearly and concisely so that a child can understand it.

ALWAYS respond in the output language with code "${language}" (regardless of the language in the image).
Return your answer as natural text, suitable for showing directly to the user.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a homework helper for children in a study/learning app. Be concise, student-friendly, and only focus on explaining the educational content of the image.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: analysisPrompt },
            {
              type: 'image_url',
              image_url: { url: imagePart },
            },
          ],
        },
      ],
    });

    const analysis = response.choices?.[0]?.message?.content || '';

    console.log('OpenAI analysis response length:', analysis.length);

    res.json({
      success: true,
      analysis,
    });
  } catch (err) {
    console.error('Error in /analyze-image', err);
    if (err?.response?.status || err?.response?.data) {
      console.error('OpenAI error response:', err.response.status, err.response.data);
    }
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

// Global error handler (last middleware)
app.use((err, _req, res, _next) => {
  console.error('Unhandled error middleware:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Text-to-speech (TTS) ----
// Expects JSON body: { text: string, language?: string }
// Returns: { success: true, audioBase64: string } where audioBase64 is an MP3 file.
app.post('/tts', async (req, res) => {
  try {
    const schema = z.object({
      text: z.string().min(1),
      language: z.string().min(1).optional().default('en'),
    });

    const parseResult = schema.safeParse(req.body || {});
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
    }

    const { text, language } = parseResult.data;

    console.log('/tts request for language:', language);

    const speechResponse = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      format: 'mp3',
      input: `Read the following text naturally in the language with code "${language}". Do not translate it, just read it as written. Text: ${text}`,
    });

    const audioBuffer = Buffer.from(await speechResponse.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');

    return res.json({
      success: true,
      audioBase64,
    });
  } catch (err) {
    console.error('Error in /tts', err);
    return res.status(500).json({ success: false, error: 'Failed to generate speech' });
  }
});

app.listen(port, () => {
  console.log(`snappy-study-api listening on port ${port}`);
});
