import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // In Lambda this will surface as an init error
  console.error('Invalid environment configuration', parsed.error.flatten());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
