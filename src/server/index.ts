import 'dotenv/config';
import { openDatabase, DEFAULT_DB_PATH } from '../db/client.js';
import { createRepository } from '../db/repository.js';
import { createApp } from './app.js';
import { analyzeActivityWithCodex, analyzePeriodWithCodex } from './codexAnalysis.js';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.STRAVA_DB_PATH ?? DEFAULT_DB_PATH;

const db = openDatabase(dbPath);
const repo = createRepository(db);
const app = createApp(repo, {
  analyzeActivity: analyzeActivityWithCodex,
  analyzePeriod: analyzePeriodWithCodex,
});

app.listen(port, () => {
  console.log(`Run Strava API listening on http://localhost:${port}`);
});
