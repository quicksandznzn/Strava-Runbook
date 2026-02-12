import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPgPoolFromEnv } from './client.js';
import { createRepository, type RunRepository } from './repository.js';
import { applySchema } from './schema.js';

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const describeIfDb = hasTestDatabase ? describe : describe.skip;

describeIfDb('Training Plans Repository (PostgreSQL)', () => {
  let pool: Pool;
  let repository: RunRepository;

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    }

    pool = createPgPoolFromEnv();
    await applySchema(pool);
    await pool.query('TRUNCATE activity_ai_analysis, activity_splits, activities, training_plans RESTART IDENTITY CASCADE');
    repository = createRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates, reads, updates and deletes a training plan', async () => {
    const created = await repository.createTrainingPlan('2026-01-15', '轻松跑 8km');
    expect(created.date).toBe('2026-01-15');
    expect(created.planText).toBe('轻松跑 8km');

    const fetched = await repository.getTrainingPlanByDate('2026-01-15');
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);

    const updated = await repository.updateTrainingPlan('2026-01-15', '间歇跑 6x800m');
    expect(updated?.planText).toBe('间歇跑 6x800m');

    const deleted = await repository.deleteTrainingPlan('2026-01-15');
    expect(deleted).toBe(true);

    const missing = await repository.getTrainingPlanByDate('2026-01-15');
    expect(missing).toBeNull();
  });
});
