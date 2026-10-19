import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { handler as analyzeImageHandler } from './handlers/analyzeImage';
import { handler as healthHandler } from './handlers/health';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.get('/health', async (_req: Request, res: Response) => {
  const lambdaResult = await healthHandler({} as any);
  res
    .status(lambdaResult.statusCode || 200)
    .set(lambdaResult.headers || {})
    .send(lambdaResult.body);
});

app.post('/analyze-image', async (req: Request, res: Response) => {
  const lambdaResult = await analyzeImageHandler({
    body: JSON.stringify(req.body),
  } as any);

  res
    .status(lambdaResult.statusCode || 200)
    .set(lambdaResult.headers || {})
    .send(lambdaResult.body);
});

app.listen(port, () => {
  console.log(`Local dev server listening on port ${port}`);
});
