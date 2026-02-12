import 'dotenv/config';
import { createPgPoolFromEnv } from '../db/client.js';
import { createRepository } from '../db/repository.js';
import { applySchema } from '../db/schema.js';
import { createApp } from './app.js';
import { analyzeActivityWithCodex, analyzePeriodWithCodex } from './codexAnalysis.js';

const port = Number(process.env.PORT ?? 8787);

async function bootstrap(): Promise<void> {
  const pool = createPgPoolFromEnv();
  await applySchema(pool);

  const repo = createRepository(pool);
  const app = createApp(repo, {
    analyzeActivity: analyzeActivityWithCodex,
    analyzePeriod: analyzePeriodWithCodex,
  });

  const server = app.listen(port, () => {
    console.log(`Run Strava API listening on http://localhost:${port}`);
  });

  const shutdown = async () => {
    server.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start API server:', error);
  process.exit(1);
});
