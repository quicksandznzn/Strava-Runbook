import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/client.js';
import { createRepository } from '../db/repository.js';
import { createApp } from './app.js';

const db = openDatabase(':memory:');
const repo = createRepository(db);
const syncActivities = vi.fn(async (_input: { full?: boolean; from?: string }, _repository: typeof repo) => ({
  totalFetchedRuns: 3,
  created: 1,
  updated: 2,
  skippedNonRun: 0,
  failed: 0,
}));
const analyzePeriod = vi.fn(
  async (_input: {
    period: 'week' | 'month' | 'year';
    from: string;
    to: string;
    summary: { totalRuns: number };
    recentRuns: Array<{ stravaId: number }>;
  }) => '## 周期总结\n本周期训练稳定\n\n## 训练亮点\n里程完成良好\n\n## 风险提示\n注意恢复\n\n## 下阶段建议\n1. 稳定频次',
);
const app = createApp(repo, {
  analyzeActivity: async (activity) =>
    `## 本次总结\n活动 ${activity.name}\n\n## 亮点\n- 节奏稳定\n\n## 风险提示\n- 注意恢复\n\n## 下次训练建议\n1. 慢跑热身`,
  analyzePeriod,
  syncActivities,
});

beforeAll(() => {
  repo.upsertRunActivity({
    stravaId: 101,
    name: 'Morning Run',
    startDateLocal: '2026-01-01T08:00:00Z',
    distanceM: 10000,
    movingTimeS: 3600,
    elapsedTimeS: 3700,
    totalElevationGainM: 80,
    averageSpeedMps: 2.77,
    maxSpeedMps: 4.5,
    averageHeartrate: 150,
    maxHeartrate: 173,
    averageCadence: 80,
    sufferScore: 40,
    mapSummaryPolyline: null,
    mapPolyline: null,
    rawJson: '{}',
    splits: [
      {
        splitIndex: 1,
        distanceM: 1000,
        elapsedTimeS: 360,
        elevationDifferenceM: 2,
        averageSpeedMps: 2.7,
        paceSecPerKm: 360,
        averageHeartrate: 152,
      },
    ],
  });

  repo.upsertRunActivity({
    stravaId: 102,
    name: 'Tempo',
    startDateLocal: '2026-01-08T08:00:00Z',
    distanceM: 5000,
    movingTimeS: 1500,
    elapsedTimeS: 1520,
    totalElevationGainM: 35,
    averageSpeedMps: 3.33,
    maxSpeedMps: 4.7,
    averageHeartrate: null,
    maxHeartrate: null,
    averageCadence: 85,
    sufferScore: null,
    mapSummaryPolyline: null,
    mapPolyline: null,
    rawJson: '{}',
    splits: [],
  });

  repo.upsertRunActivity({
    stravaId: 103,
    name: 'Late UTC Run',
    startDateLocal: '2026-01-01T23:30:00Z',
    distanceM: 1000,
    movingTimeS: 360,
    elapsedTimeS: 365,
    totalElevationGainM: 10,
    averageSpeedMps: 2.77,
    maxSpeedMps: 3.8,
    averageHeartrate: 140,
    maxHeartrate: 155,
    averageCadence: 82,
    sufferScore: 8,
    mapSummaryPolyline: null,
    mapPolyline: null,
    rawJson: '{}',
    splits: [],
  });
});

describe('api', () => {
  it('returns accurate summary', async () => {
    const res = await request(app).get('/api/summary');
    expect(res.status).toBe(200);
    expect(res.body.totalRuns).toBe(3);
    expect(res.body.totalDistanceM).toBe(16000);
    expect(res.body.totalMovingTimeS).toBe(5460);
  });

  it('supports paginated activity list sorting', async () => {
    const res = await request(app).get('/api/activities?page=1&pageSize=1&sortBy=distance_m&sortDir=desc');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].stravaId).toBe(101);
    expect(res.body.total).toBe(3);
  });

  it('returns calendar quick filter options', async () => {
    const res = await request(app).get('/api/filters/calendar');
    expect(res.status).toBe(200);
    expect(res.body.years).toContain(2026);
    expect(res.body.monthsByYear['2026']).toContain(1);
  });

  it('returns detail payload with empty optional fields', async () => {
    const res = await request(app).get('/api/activities/102');
    expect(res.status).toBe(200);
    expect(res.body.stravaId).toBe(102);
    expect(res.body.averageHeartrate).toBeNull();
    expect(res.body.mapPolyline).toBeNull();
  });

  it('generates and caches AI analysis', async () => {
    const first = await request(app).post('/api/activities/101/analysis').send({});
    expect(first.status).toBe(200);
    expect(first.body.activityId).toBe(101);
    expect(first.body.content).toContain('本次总结');
    expect(first.body.cached).toBe(false);

    const second = await request(app).post('/api/activities/101/analysis').send({});
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.content).toContain('本次总结');

    const persisted = await request(app).get('/api/activities/101/analysis');
    expect(persisted.status).toBe(200);
    expect(persisted.body.cached).toBe(true);
    expect(persisted.body.content).toContain('本次总结');
  });

  it('applies from/to filters directly on start_date_local date', async () => {
    const res = await request(app).get('/api/activities?from=2026-01-01&to=2026-01-01');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((item: { stravaId: number }) => item.stravaId);
    expect(ids).toContain(103);
  });

  it('generates realtime period analysis without persistence', async () => {
    const res = await request(app).post('/api/analysis/period').send({ period: 'year' });
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('year');
    expect(res.body.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.content).toContain('周期总结');
    expect(res.body.generatedAt).toBeTruthy();
    expect(analyzePeriod).toHaveBeenCalled();
  });

  it('returns 400 for invalid period analysis input', async () => {
    const res = await request(app).post('/api/analysis/period').send({ period: 'quarter' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid period');
  });

  it('syncs latest data without duplicate inserts by using upsert', async () => {
    const res = await request(app).post('/api/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('incremental');
    expect(res.body.from).toBe('2026-01-08');
    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(2);
    expect(syncActivities).toHaveBeenCalled();
    expect(syncActivities.mock.calls.at(-1)?.[0]).toEqual({ full: false, from: '2026-01-08' });
  });

  it('returns 400 for invalid sync date input', async () => {
    const res = await request(app).post('/api/sync').send({ from: '2026/01/08' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid date format');
  });

  it('prevents concurrent sync requests', async () => {
    let notifyStarted = () => {};
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowApp = createApp(repo, {
      syncActivities: async () => {
        notifyStarted();
        await gate;
        return {
          totalFetchedRuns: 0,
          created: 0,
          updated: 0,
          skippedNonRun: 0,
          failed: 0,
        };
      },
    });

    const first = new Promise<request.Response>((resolve, reject) => {
      request(slowApp)
        .post('/api/sync')
        .send({})
        .end((error, response) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        });
    });
    await started;
    const second = await request(slowApp).post('/api/sync').send({});
    expect(second.status).toBe(409);
    expect(second.body.error).toContain('already in progress');

    release();
    const firstDone = await first;
    expect(firstDone.status).toBe(200);
  });
});
