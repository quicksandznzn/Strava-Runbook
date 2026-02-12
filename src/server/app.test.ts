import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunRepository, PersistedActivity } from '../db/repository.js';
import type { ActivityAiAnalysis, DateRangeQuery, RunActivity, WeeklyTrendPoint } from '../shared/types.js';
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

function createInMemoryRepository(): RunRepository {
  const activities = new Map<number, StoredActivity>();
  const analyses = new Map<number, ActivityAiAnalysis>();

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
  analyzeActivity: async (activity) =>
    `## 本次总结\n活动 ${activity.name}\n\n## 亮点\n- 节奏稳定\n\n## 风险提示\n- 注意恢复\n\n## 下次训练建议\n1. 慢跑热身`,
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
