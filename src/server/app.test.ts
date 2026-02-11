import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { createRepository } from '../db/repository.js';
import { createApp } from './app.js';

const db = openDatabase(':memory:');
const repo = createRepository(db);
const app = createApp(repo, {
  analyzeActivity: async (activity, plan) => {
    let content = `## 本次总结\n活动 ${activity.name}\n\n## 亮点\n- 节奏稳定\n\n## 风险提示\n- 注意恢复\n\n`;
    if (plan) {
      content += `## 计划完成度\n计划: ${plan.planText}\n完成率: 100%\n\n`;
    }
    content += `## 下次训练建议\n1. 慢跑热身`;
    return content;
  },
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
});

describe('training plans api', () => {
  it('creates a new training plan', async () => {
    const res = await request(app).post('/api/training-plans').send({
      date: '2026-01-15',
      planText: '轻松跑 5km，配速 6:00/km',
    });
    expect(res.status).toBe(201);
    expect(res.body.date).toBe('2026-01-15');
    expect(res.body.planText).toBe('轻松跑 5km，配速 6:00/km');
    expect(res.body.id).toBeDefined();
  });

  it('returns 409 for duplicate date', async () => {
    await request(app).post('/api/training-plans').send({
      date: '2026-01-16',
      planText: '间歇跑 8x400m',
    });

    const duplicate = await request(app).post('/api/training-plans').send({
      date: '2026-01-16',
      planText: '不同的计划',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toContain('already exists');
  });

  it('validates required fields on create', async () => {
    const noDate = await request(app).post('/api/training-plans').send({ planText: 'test' });
    expect(noDate.status).toBe(400);

    const noPlan = await request(app).post('/api/training-plans').send({ date: '2026-01-20' });
    expect(noPlan.status).toBe(400);

    const emptyPlan = await request(app).post('/api/training-plans').send({ date: '2026-01-21', planText: '  ' });
    expect(emptyPlan.status).toBe(400);
  });

  it('gets a training plan by date', async () => {
    await request(app).post('/api/training-plans').send({
      date: '2026-01-17',
      planText: 'LSD 15km',
    });

    const res = await request(app).get('/api/training-plans/2026-01-17');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-01-17');
    expect(res.body.planText).toBe('LSD 15km');
  });

  it('returns 404 when plan not found', async () => {
    const res = await request(app).get('/api/training-plans/2026-12-31');
    expect(res.status).toBe(404);
  });

  it('updates a training plan', async () => {
    await request(app).post('/api/training-plans').send({
      date: '2026-01-18',
      planText: '原计划',
    });

    const updated = await request(app).put('/api/training-plans/2026-01-18').send({
      planText: '更新后的计划',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.planText).toBe('更新后的计划');

    const check = await request(app).get('/api/training-plans/2026-01-18');
    expect(check.body.planText).toBe('更新后的计划');
  });

  it('returns 404 when updating non-existent plan', async () => {
    const res = await request(app).put('/api/training-plans/2026-12-30').send({
      planText: 'test',
    });
    expect(res.status).toBe(404);
  });

  it('deletes a training plan', async () => {
    await request(app).post('/api/training-plans').send({
      date: '2026-01-19',
      planText: '待删除',
    });

    const deleted = await request(app).delete('/api/training-plans/2026-01-19');
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);

    const check = await request(app).get('/api/training-plans/2026-01-19');
    expect(check.status).toBe(404);
  });

  it('returns false when deleting non-existent plan (idempotent)', async () => {
    const res = await request(app).delete('/api/training-plans/2026-12-29');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(false);
  });

  it('gets training plans by date range', async () => {
    await request(app).post('/api/training-plans').send({ date: '2026-02-01', planText: 'Plan A' });
    await request(app).post('/api/training-plans').send({ date: '2026-02-05', planText: 'Plan B' });
    await request(app).post('/api/training-plans').send({ date: '2026-02-10', planText: 'Plan C' });

    const res = await request(app).get('/api/training-plans?from=2026-02-01&to=2026-02-07');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].date).toBe('2026-02-05'); // DESC order
    expect(res.body[1].date).toBe('2026-02-01');
  });

  it('returns all plans when no date range specified', async () => {
    const res = await request(app).get('/api/training-plans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('calendar daily summary api', () => {
  it('returns daily summary with plan and activity completion status', async () => {
    // Add a plan for 2026-01-01
    await request(app).post('/api/training-plans').send({
      date: '2026-01-01',
      planText: '轻松跑 10km',
    });

    const res = await request(app).get('/api/calendar/daily-summary?year=2026&month=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Find 2026-01-01
    const day1 = res.body.find((d: { date: string }) => d.date === '2026-01-01');
    expect(day1).toBeDefined();
    expect(day1.plan).toBeDefined();
    expect(day1.plan.planText).toBe('轻松跑 10km');
    expect(day1.activities.length).toBeGreaterThan(0);
    expect(day1.completionStatus).toBe('completed');

    // Find a day with no plan
    const dayNoActivity = res.body.find((d: { date: string; completionStatus: string }) => d.completionStatus === 'no_plan');
    expect(dayNoActivity).toBeDefined();
  });

  it('validates year and month parameters', async () => {
    const noYear = await request(app).get('/api/calendar/daily-summary?month=1');
    expect(noYear.status).toBe(400);

    const noMonth = await request(app).get('/api/calendar/daily-summary?year=2026');
    expect(noMonth.status).toBe(400);

    const invalidMonth = await request(app).get('/api/calendar/daily-summary?year=2026&month=13');
    expect(invalidMonth.status).toBe(400);
  });
});

describe('ai analysis with training plan', () => {
  it('adds fallback plan section when analyzer output misses it', async () => {
    const activityId = 9902;
    const activityDate = '2026-02-01';

    repo.upsertRunActivity({
      stravaId: activityId,
      name: 'Fallback Plan Run',
      startDateLocal: `${activityDate}T06:00:00Z`,
      distanceM: 5000,
      movingTimeS: 1600,
      elapsedTimeS: 1650,
      totalElevationGainM: 20,
      averageSpeedMps: 3.12,
      maxSpeedMps: 4.2,
      averageHeartrate: 150,
      maxHeartrate: 168,
      averageCadence: 86,
      sufferScore: 20,
      mapSummaryPolyline: null,
      mapPolyline: null,
      rawJson: '{}',
      splits: [],
    });

    await request(app).post('/api/training-plans').send({
      date: activityDate,
      planText: '轻松跑 5km，配速 6:00/km',
    });

    const appWithoutPlanSection = createApp(repo, {
      analyzeActivity: async () => '## 本次总结\n正常完成\n\n## 亮点\n状态稳定\n\n## 风险提示\n注意补水\n\n## 下次训练建议\n保持节奏',
    });

    const res = await request(appWithoutPlanSection).post(`/api/activities/${activityId}/analysis`).send({ force: true });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('## 计划完成度');
    expect(res.body.content).toContain('轻松跑 5km，配速 6:00/km');
  });

  it('regenerates analysis when training plan is newer than cached analysis', async () => {
    const activityId = 9901;
    const activityDate = '2026-01-31';

    repo.upsertRunActivity({
      stravaId: activityId,
      name: 'Cache Freshness Run',
      startDateLocal: `${activityDate}T07:30:00Z`,
      distanceM: 8000,
      movingTimeS: 2800,
      elapsedTimeS: 2850,
      totalElevationGainM: 60,
      averageSpeedMps: 2.86,
      maxSpeedMps: 4.2,
      averageHeartrate: 148,
      maxHeartrate: 166,
      averageCadence: 84,
      sufferScore: 32,
      mapSummaryPolyline: null,
      mapPolyline: null,
      rawJson: '{}',
      splits: [],
    });

    const first = await request(app).post(`/api/activities/${activityId}/analysis`).send({});
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);
    expect(first.body.content).not.toContain('计划完成度');

    await request(app).post('/api/training-plans').send({
      date: activityDate,
      planText: '目标: 8km 稳定配速',
    });

    const second = await request(app).post(`/api/activities/${activityId}/analysis`).send({});
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(false);
    expect(second.body.content).toContain('计划完成度');
    expect(second.body.content).toContain('目标: 8km 稳定配速');

    const third = await request(app).post(`/api/activities/${activityId}/analysis`).send({});
    expect(third.status).toBe(200);
    expect(third.body.cached).toBe(true);
  });

  it('includes plan completion when plan exists', async () => {
    // Add a plan for 2026-01-01 (activity 101 date)
    await request(app).post('/api/training-plans').send({
      date: '2026-01-01',
      planText: '目标: 10km 配速 6:00/km',
    });

    const res = await request(app).post('/api/activities/101/analysis').send({ force: true });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('计划完成度');
    expect(res.body.content).toContain('目标: 10km 配速 6:00/km');
  });

  it('generates normal analysis when no plan exists', async () => {
    const res = await request(app).post('/api/activities/102/analysis').send({});
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('本次总结');
    expect(res.body.content).not.toContain('计划完成度');
  });
});
