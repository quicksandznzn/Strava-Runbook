import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunRepository, PersistedActivity } from '../db/repository.js';
import type {
  ActivityAiAnalysis,
  CompletionStatus,
  DailySummary,
  DateRangeQuery,
  RunActivity,
  TrainingPlan,
  WeeklyTrendPoint,
} from '../shared/types.js';
import { createApp } from './app.js';

interface StoredActivity extends PersistedActivity {
  updatedAt: string;
}

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toShanghaiDate(dateIso: string): string {
  return shanghaiDateFormatter.format(new Date(dateIso));
}

function paceFromDistanceAndTime(distanceM: number, movingTimeS: number): number | null {
  if (!Number.isFinite(distanceM) || !Number.isFinite(movingTimeS) || distanceM <= 0 || movingTimeS <= 0) {
    return null;
  }
  return (movingTimeS * 1000) / distanceM;
}

function weekStartFromShanghaiDate(dateIso: string): string {
  const shDate = toShanghaiDate(dateIso);
  const [year, month, day] = shDate.split('-').map((value) => Number(value));
  const base = new Date(Date.UTC(year, month - 1, day));
  const weekday = base.getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  base.setUTCDate(base.getUTCDate() - mondayOffset);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildMonthDateKeys(year: number, month: number): string[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthText = String(month).padStart(2, '0');
  return Array.from({ length: daysInMonth }, (_, idx) => `${year}-${monthText}-${String(idx + 1).padStart(2, '0')}`);
}

function createInMemoryRepository(): RunRepository {
  const activities = new Map<number, StoredActivity>();
  const analyses = new Map<number, ActivityAiAnalysis>();
  const trainingPlans = new Map<string, TrainingPlan>();
  let trainingPlanId = 1;

  const toRunActivity = (activity: StoredActivity): RunActivity => {
    const athleteMaxHeartrate = Array.from(activities.values()).reduce<number | null>((max, item) => {
      if (item.maxHeartrate == null) {
        return max;
      }
      if (max == null) {
        return item.maxHeartrate;
      }
      return item.maxHeartrate > max ? item.maxHeartrate : max;
    }, null);

    return {
      stravaId: activity.stravaId,
      name: activity.name,
      deviceName: activity.deviceName ?? null,
      athleteMaxHeartrate,
      startDateLocal: activity.startDateLocal,
      distanceM: activity.distanceM,
      movingTimeS: activity.movingTimeS,
      elapsedTimeS: activity.elapsedTimeS,
      totalElevationGainM: activity.totalElevationGainM,
      averageSpeedMps: activity.averageSpeedMps,
      maxSpeedMps: activity.maxSpeedMps,
      paceSecPerKm: paceFromDistanceAndTime(activity.distanceM, activity.movingTimeS),
      averageHeartrate: activity.averageHeartrate,
      maxHeartrate: activity.maxHeartrate,
      averageCadence: activity.averageCadence,
      calories: activity.calories ?? null,
      sufferScore: activity.sufferScore,
      mapSummaryPolyline: activity.mapSummaryPolyline,
      mapPolyline: activity.mapPolyline,
      splits: activity.splits,
      heartRateZones: activity.heartRateZones,
      trendPoints: activity.trendPoints,
      updatedAt: activity.updatedAt,
    };
  };

  const filterByRange = (range: DateRangeQuery): StoredActivity[] => {
    return Array.from(activities.values()).filter((item) => {
      const shDate = toShanghaiDate(item.startDateLocal);
      if (range.from && shDate < range.from) {
        return false;
      }
      if (range.to && shDate > range.to) {
        return false;
      }
      return true;
    });
  };

  return {
    async upsertRunActivity(activity: PersistedActivity): Promise<'created' | 'updated'> {
      const existed = activities.has(activity.stravaId);
      activities.set(activity.stravaId, {
        ...activity,
        updatedAt: new Date().toISOString(),
      });
      return existed ? 'updated' : 'created';
    },

    async getSummary(range: DateRangeQuery) {
      const filtered = filterByRange(range);
      const totalRuns = filtered.length;
      const totalDistanceM = filtered.reduce((sum, item) => sum + item.distanceM, 0);
      const totalMovingTimeS = filtered.reduce((sum, item) => sum + item.movingTimeS, 0);
      const totalElevationGainM = filtered.reduce((sum, item) => sum + item.totalElevationGainM, 0);
      const heartrateSamples = filtered.map((item) => item.averageHeartrate).filter((item): item is number => item != null);
      const paces = filtered
        .map((item) => paceFromDistanceAndTime(item.distanceM, item.movingTimeS))
        .filter((value): value is number => value != null);

      return {
        totalRuns,
        totalDistanceM,
        totalMovingTimeS,
        totalElevationGainM,
        averagePaceSecPerKm: paceFromDistanceAndTime(totalDistanceM, totalMovingTimeS),
        bestPaceSecPerKm: paces.length > 0 ? Math.min(...paces) : null,
        averageHeartrate:
          heartrateSamples.length > 0
            ? heartrateSamples.reduce((sum, value) => sum + value, 0) / heartrateSamples.length
            : null,
      };
    },

    async getWeeklyTrends(range: DateRangeQuery): Promise<WeeklyTrendPoint[]> {
      const grouped = new Map<string, { distanceM: number; movingTimeS: number; runs: number }>();
      for (const item of filterByRange(range)) {
        const key = weekStartFromShanghaiDate(item.startDateLocal);
        const current = grouped.get(key) ?? { distanceM: 0, movingTimeS: 0, runs: 0 };
        current.distanceM += item.distanceM;
        current.movingTimeS += item.movingTimeS;
        current.runs += 1;
        grouped.set(key, current);
      }

      return Array.from(grouped.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, value]) => ({
          weekStart,
          totalDistanceM: value.distanceM,
          totalMovingTimeS: value.movingTimeS,
          averagePaceSecPerKm: paceFromDistanceAndTime(value.distanceM, value.movingTimeS),
          runs: value.runs,
        }));
    },

    async listActivities(query) {
      const page = Math.max(1, Number(query.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
      const sortBy = query.sortBy ?? 'start_date_local';
      const sortDir = query.sortDir === 'asc' ? 1 : -1;
      const filtered = filterByRange(query);

      const sorted = [...filtered].sort((a, b) => {
        const valueA =
          sortBy === 'distance_m'
            ? a.distanceM
            : sortBy === 'pace_sec_per_km'
              ? paceFromDistanceAndTime(a.distanceM, a.movingTimeS) ?? Number.POSITIVE_INFINITY
              : Date.parse(a.startDateLocal);
        const valueB =
          sortBy === 'distance_m'
            ? b.distanceM
            : sortBy === 'pace_sec_per_km'
              ? paceFromDistanceAndTime(b.distanceM, b.movingTimeS) ?? Number.POSITIVE_INFINITY
              : Date.parse(b.startDateLocal);

        if (valueA === valueB) {
          return Date.parse(b.startDateLocal) - Date.parse(a.startDateLocal);
        }

        return valueA > valueB ? sortDir : -sortDir;
      });

      const start = (page - 1) * pageSize;
      const items = sorted.slice(start, start + pageSize).map(toRunActivity);

      return {
        page,
        pageSize,
        total: sorted.length,
        items,
      };
    },

    async getActivityById(stravaId: number): Promise<RunActivity | null> {
      const activity = activities.get(stravaId);
      if (!activity) {
        return null;
      }
      return toRunActivity(activity);
    },

    async getActivityAnalysis(stravaId: number): Promise<ActivityAiAnalysis | null> {
      const item = analyses.get(stravaId);
      if (!item) {
        return null;
      }
      return {
        ...item,
        cached: true,
      };
    },

    async saveActivityAnalysis(stravaId: number, content: string): Promise<ActivityAiAnalysis> {
      const result: ActivityAiAnalysis = {
        activityId: stravaId,
        content,
        generatedAt: new Date().toISOString(),
        cached: false,
      };
      analyses.set(stravaId, result);
      return result;
    },

    async getCalendarFilterOptions() {
      const rows = filterByRange({}).map((item) => toShanghaiDate(item.startDateLocal));
      const years: number[] = [];
      const monthsByYear: Record<string, number[]> = {};

      for (const date of rows) {
        const [yearRaw, monthRaw] = date.split('-');
        const year = Number(yearRaw);
        const month = Number(monthRaw);
        if (!years.includes(year)) {
          years.push(year);
        }
        const key = String(year);
        monthsByYear[key] ??= [];
        if (!monthsByYear[key].includes(month)) {
          monthsByYear[key].push(month);
        }
      }

      years.sort((a, b) => b - a);
      for (const key of Object.keys(monthsByYear)) {
        monthsByYear[key].sort((a, b) => a - b);
      }

      return { years, monthsByYear };
    },

    async createTrainingPlan(date: string, planText: string): Promise<TrainingPlan> {
      if (trainingPlans.has(date)) {
        const duplicateError = new Error('duplicate key value violates unique constraint "training_plans_date_key"');
        (duplicateError as Error & { code?: string }).code = '23505';
        throw duplicateError;
      }

      const now = new Date().toISOString();
      const plan: TrainingPlan = {
        id: trainingPlanId,
        date,
        planText,
        createdAt: now,
        updatedAt: now,
      };
      trainingPlanId += 1;
      trainingPlans.set(date, plan);
      return plan;
    },

    async getTrainingPlanByDate(date: string): Promise<TrainingPlan | null> {
      return trainingPlans.get(date) ?? null;
    },

    async updateTrainingPlan(date: string, planText: string): Promise<TrainingPlan | null> {
      const existing = trainingPlans.get(date);
      if (!existing) {
        return null;
      }

      const updated: TrainingPlan = {
        ...existing,
        planText,
        updatedAt: new Date().toISOString(),
      };
      trainingPlans.set(date, updated);
      return updated;
    },

    async deleteTrainingPlan(date: string): Promise<boolean> {
      return trainingPlans.delete(date);
    },

    async getTrainingPlansByRange(from?: string, to?: string): Promise<TrainingPlan[]> {
      return Array.from(trainingPlans.values())
        .filter((plan) => {
          if (from && plan.date < from) {
            return false;
          }
          if (to && plan.date > to) {
            return false;
          }
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    async getDailySummary(year: number, month: number): Promise<DailySummary[]> {
      const days = buildMonthDateKeys(year, month);
      if (days.length === 0) {
        return [];
      }

      const from = days[0];
      const to = days[days.length - 1];
      const [plans, activitiesByRange] = await Promise.all([
        this.getTrainingPlansByRange(from, to),
        this.listActivities({
          from,
          to,
          page: 1,
          pageSize: 1000,
          sortBy: 'start_date_local',
          sortDir: 'asc',
        }),
      ]);

      const planMap = new Map(plans.map((plan) => [plan.date, plan]));
      const activityMap = new Map<string, RunActivity[]>();
      for (const activity of activitiesByRange.items) {
        const dateKey = toShanghaiDate(activity.startDateLocal);
        if (!activityMap.has(dateKey)) {
          activityMap.set(dateKey, []);
        }
        activityMap.get(dateKey)?.push(activity);
      }

      return days.map((date) => {
        const plan = planMap.get(date) ?? null;
        const activities = activityMap.get(date) ?? [];
        let completionStatus: CompletionStatus = 'no_plan';
        if (plan) {
          completionStatus = activities.length > 0 ? 'completed' : 'missed';
        }
        return {
          date,
          plan,
          activities,
          completionStatus,
        };
      });
    },
  };
}

const repo = createInMemoryRepository();
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
  analyzeActivity: async (activity, plan) => {
    let content = `## 本次总结\n活动 ${activity.name}\n\n## 亮点\n- 节奏稳定\n\n## 风险提示\n- 注意恢复\n\n`;
    if (plan) {
      content += `## 计划完成度\n计划: ${plan.planText}\n完成率: 100%\n\n`;
    }
    content += `## 下次训练建议\n1. 慢跑热身`;
    return content;
  },
  analyzePeriod,
  syncActivities,
});

beforeAll(async () => {
  await repo.upsertRunActivity({
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
    trendPoints: [
      { elapsedTimeS: 60, distanceM: 250, paceSecPerKm: 340, heartrate: 145 },
      { elapsedTimeS: 120, distanceM: 520, paceSecPerKm: 335, heartrate: 149 },
      { elapsedTimeS: 180, distanceM: 790, paceSecPerKm: 332, heartrate: 152 },
    ],
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
        averageCadence: 84,
        calories: 62,
      },
    ],
  });

  await repo.upsertRunActivity({
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

  await repo.upsertRunActivity({
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
    expect(res.body.athleteMaxHeartrate).toBe(186);
  });

  it('returns detail payload with trend points when available', async () => {
    const res = await request(app).get('/api/activities/101');
    expect(res.status).toBe(200);
    expect(res.body.stravaId).toBe(101);
    expect(res.body.trendPoints).toHaveLength(3);
    expect(res.body.trendPoints[0].elapsedTimeS).toBe(60);
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

  it('applies from/to filters with Asia/Shanghai date boundary', async () => {
    const res = await request(app).get('/api/activities?from=2026-01-02&to=2026-01-02');
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
    const activityDate = '2026-03-01';

    await repo.upsertRunActivity({
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

    await repo.upsertRunActivity({
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
    const activityId = 9903;
    const activityDate = '2026-03-03';

    await repo.upsertRunActivity({
      stravaId: activityId,
      name: 'Planned Tempo Run',
      startDateLocal: `${activityDate}T07:00:00Z`,
      distanceM: 10000,
      movingTimeS: 3600,
      elapsedTimeS: 3650,
      totalElevationGainM: 48,
      averageSpeedMps: 2.78,
      maxSpeedMps: 4.1,
      averageHeartrate: 152,
      maxHeartrate: 171,
      averageCadence: 84,
      sufferScore: 41,
      mapSummaryPolyline: null,
      mapPolyline: null,
      rawJson: '{}',
      splits: [],
    });

    await request(app).post('/api/training-plans').send({
      date: activityDate,
      planText: '目标: 10km 配速 6:00/km',
    });

    const res = await request(app).post(`/api/activities/${activityId}/analysis`).send({ force: true });
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
