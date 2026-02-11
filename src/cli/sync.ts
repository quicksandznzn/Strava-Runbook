import 'dotenv/config';
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { openDatabase, DEFAULT_DB_PATH } from '../db/client.js';
import { createRepository, type RunRepository } from '../db/repository.js';
import { createStravaApiClient, fetchRunSummaries, toPersistedActivity } from './strava.js';

export interface SyncStats {
  totalFetchedRuns: number;
  created: number;
  updated: number;
  skippedNonRun: number;
  failed: number;
}

interface SyncOptions {
  full?: boolean;
  from?: string;
  dbPath?: string;
}

function parseFromDateToEpoch(from?: string): number | undefined {
  if (!from) {
    return undefined;
  }

  const parsed = new Date(`${from}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --from date: ${from}. Expected format YYYY-MM-DD.`);
  }

  return Math.floor(parsed.getTime() / 1000);
}

export async function runSync(options: SyncOptions, repository?: RunRepository): Promise<SyncStats> {
  const token = process.env.STRAVA_ACCESS_TOKEN;
  if (!token) {
    throw new Error('Missing STRAVA_ACCESS_TOKEN in environment.');
  }

  const db = repository ? null : openDatabase(options.dbPath ?? DEFAULT_DB_PATH);
  const repo = repository ?? createRepository(db!);
  const client = createStravaApiClient(token);
  try {
    const afterEpoch = options.full ? undefined : parseFromDateToEpoch(options.from);
    const summaryResult = await fetchRunSummaries(client, { afterEpoch });

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const summary of summaryResult.runs) {
      try {
        const detail = await client.getActivityById(summary.id);
        const persisted = toPersistedActivity(detail);
        const result = repo.upsertRunActivity(persisted);
        if (result === 'created') {
          created += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        console.warn(`Failed syncing activity ${summary.id}:`, error);
      }
    }

    return {
      totalFetchedRuns: summaryResult.runs.length,
      created,
      updated,
      skippedNonRun: summaryResult.skippedNonRun,
      failed,
    };
  } finally {
    db?.close();
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option('--full', 'perform full sync')
    .option('--from <YYYY-MM-DD>', 'sync from date (inclusive)')
    .option('--db-path <path>', 'sqlite db path', DEFAULT_DB_PATH)
    .parse(process.argv);

  const options = program.opts<{ full?: boolean; from?: string; dbPath?: string }>();

  if (!options.full && !options.from) {
    options.from = '1970-01-01';
  }

  const stats = await runSync(options);

  console.log('Sync complete');
  console.log(`- Fetched run activities: ${stats.totalFetchedRuns}`);
  console.log(`- Created: ${stats.created}`);
  console.log(`- Updated: ${stats.updated}`);
  console.log(`- Skipped non-run: ${stats.skippedNonRun}`);
  console.log(`- Failed: ${stats.failed}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
