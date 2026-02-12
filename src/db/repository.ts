import type Database from 'better-sqlite3';
import type {
  ActivityAiAnalysis,
  ActivityQuery,
  CalendarFilterOptions,
  CompletionStatus,
  DailySummary,
  DateRangeQuery,
  PaginatedActivities,
  RunActivity,
  RunHeartRateZone,
  RunTrendPoint,
  RunSplit,
  SummaryMetrics,
  TrainingPlan,
  WeeklyTrendPoint,
} from '../shared/types.js';
import { paceFromDistanceAndTime } from '../shared/units.js';

export interface PersistedSplit {
  splitIndex: number;
  distanceM: number;
  elapsedTimeS: number;
  elevationDifferenceM: number | null;
  averageSpeedMps: number | null;
  paceSecPerKm: number | null;
  averageHeartrate: number | null;
  averageCadence: number | null;
  calories: number | null;
}

export interface PersistedHeartRateZone {
  zone: string;
  minBpm: number;
  maxBpm: number | null;
  timeS: number;
  percentage: number | null;
}

export interface PersistedTrendPoint {
  elapsedTimeS: number;
  distanceM: number | null;
  paceSecPerKm: number | null;
  heartrate: number | null;
}

export interface PersistedActivity {
  stravaId: number;
  name: string;
  deviceName?: string | null;
  startDateLocal: string;
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  totalElevationGainM: number;
  averageSpeedMps: number | null;
  maxSpeedMps: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  calories?: number | null;
  sufferScore: number | null;
  mapSummaryPolyline: string | null;
  mapPolyline: string | null;
  heartRateZones?: PersistedHeartRateZone[];
  trendPoints?: PersistedTrendPoint[];
  rawJson: string;
  splits: PersistedSplit[];
}

interface WhereClauseResult {
  clause: string;
  params: Array<string | number>;
}

const DEFAULT_QUERY: ActivityQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'start_date_local',
  sortDir: 'desc',
};

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDateWhere(range: DateRangeQuery): WhereClauseResult {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (range.from) {
    clauses.push('date(start_date_local) >= date(?)');
    params.push(range.from);
  }

  if (range.to) {
    clauses.push('date(start_date_local) <= date(?)');
    params.push(range.to);
  }

  if (clauses.length === 0) {
    return { clause: '', params };
  }

  return {
    clause: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

function buildPlanDateWhere(range: DateRangeQuery): WhereClauseResult {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (range.from) {
    clauses.push('date(date) >= date(?)');
    params.push(range.from);
  }

  if (range.to) {
    clauses.push('date(date) <= date(?)');
    params.push(range.to);
  }

  if (clauses.length === 0) {
    return { clause: '', params };
  }

  return {
    clause: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

function mapRunActivity(row: Record<string, unknown>): RunActivity {
  const athleteMaxHeartrate =
    row.athlete_max_heartrate == null
      ? null
      : Number.isFinite(Number(row.athlete_max_heartrate))
        ? Number(row.athlete_max_heartrate)
        : null;

  return {
    stravaId: Number(row.strava_id),
    name: String(row.name),
    deviceName: row.device_name == null ? null : String(row.device_name),
    athleteMaxHeartrate,
    startDateLocal: String(row.start_date_local),
    distanceM: Number(row.distance_m),
    movingTimeS: Number(row.moving_time_s),
    elapsedTimeS: Number(row.elapsed_time_s),
    totalElevationGainM: Number(row.total_elevation_gain_m),
    averageSpeedMps: row.average_speed_mps == null ? null : Number(row.average_speed_mps),
    maxSpeedMps: row.max_speed_mps == null ? null : Number(row.max_speed_mps),
    paceSecPerKm: row.pace_sec_per_km == null ? null : Number(row.pace_sec_per_km),
    averageHeartrate: row.average_heartrate == null ? null : Number(row.average_heartrate),
    maxHeartrate: row.max_heartrate == null ? null : Number(row.max_heartrate),
    averageCadence: row.average_cadence == null ? null : Number(row.average_cadence),
    calories: row.calories == null ? null : Number(row.calories),
    sufferScore: row.suffer_score == null ? null : Number(row.suffer_score),
    mapSummaryPolyline: row.map_summary_polyline == null ? null : String(row.map_summary_polyline),
    mapPolyline: row.map_polyline == null ? null : String(row.map_polyline),
    heartRateZones: parseHeartRateZones(row.heartrate_zones_json),
    trendPoints: parseTrendPoints(row.trend_points_json),
    updatedAt: String(row.updated_at),
  };
}

function mapRunSplit(row: Record<string, unknown>): RunSplit {
  return {
    splitIndex: Number(row.split_index),
    distanceM: Number(row.distance_m),
    elapsedTimeS: Number(row.elapsed_time_s),
    elevationDifferenceM: row.elevation_difference_m == null ? null : Number(row.elevation_difference_m),
    averageSpeedMps: row.average_speed_mps == null ? null : Number(row.average_speed_mps),
    paceSecPerKm: row.pace_sec_per_km == null ? null : Number(row.pace_sec_per_km),
    averageHeartrate: row.average_heartrate == null ? null : Number(row.average_heartrate),
    averageCadence: row.average_cadence == null ? null : Number(row.average_cadence),
    calories: row.calories == null ? null : Number(row.calories),
  };
}

function parseHeartRateZones(rawValue: unknown): RunHeartRateZone[] | undefined {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const zones: RunHeartRateZone[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const object = item as Record<string, unknown>;
      const zone = typeof object.zone === 'string' ? object.zone : '';
      const minBpm = Number(object.minBpm);
      const timeS = Number(object.timeS);
      const maxRaw = object.maxBpm;
      const maxBpm =
        maxRaw == null
          ? null
          : Number.isFinite(Number(maxRaw))
            ? Number(maxRaw)
            : null;
      const percentageRaw = object.percentage;
      const percentage =
        percentageRaw == null
          ? null
          : Number.isFinite(Number(percentageRaw))
            ? Number(percentageRaw)
            : null;

      if (!zone || !Number.isFinite(minBpm) || !Number.isFinite(timeS)) {
        continue;
      }

      zones.push({
        zone,
        minBpm,
        maxBpm,
        timeS,
        percentage,
      });
    }

    return zones.length > 0 ? zones : undefined;
  } catch {
    return undefined;
  }
}

function parseTrendPoints(rawValue: unknown): RunTrendPoint[] | undefined {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const points: RunTrendPoint[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const object = item as Record<string, unknown>;
      const elapsedTimeS = Number(object.elapsedTimeS);
      const distanceRaw = object.distanceM;
      const paceRaw = object.paceSecPerKm;
      const heartrateRaw = object.heartrate;
      const distanceM =
        distanceRaw == null
          ? null
          : Number.isFinite(Number(distanceRaw))
            ? Number(distanceRaw)
            : null;
      const paceSecPerKm =
        paceRaw == null
          ? null
          : Number.isFinite(Number(paceRaw))
            ? Number(paceRaw)
            : null;
      const heartrate =
        heartrateRaw == null
          ? null
          : Number.isFinite(Number(heartrateRaw))
            ? Number(heartrateRaw)
            : null;

      if (!Number.isFinite(elapsedTimeS) || elapsedTimeS < 0) {
        continue;
      }

      points.push({
        elapsedTimeS: Math.round(elapsedTimeS),
        distanceM,
        paceSecPerKm,
        heartrate,
      });
    }

    points.sort((a, b) => a.elapsedTimeS - b.elapsedTimeS);
    return points.length > 0 ? points : undefined;
  } catch {
    return undefined;
  }
}

export function createRepository(db: Database.Database) {
  const existsStmt = db.prepare('SELECT 1 FROM activities WHERE strava_id = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO activities (
      strava_id, name, device_name, start_date_local, distance_m, moving_time_s, elapsed_time_s,
      total_elevation_gain_m, average_speed_mps, max_speed_mps,
      average_heartrate, max_heartrate, average_cadence, calories, suffer_score,
      map_summary_polyline, map_polyline, heartrate_zones_json, trend_points_json, raw_json, updated_at
    ) VALUES (
      @strava_id, @name, @device_name, @start_date_local, @distance_m, @moving_time_s, @elapsed_time_s,
      @total_elevation_gain_m, @average_speed_mps, @max_speed_mps,
      @average_heartrate, @max_heartrate, @average_cadence, @calories, @suffer_score,
      @map_summary_polyline, @map_polyline, @heartrate_zones_json, @trend_points_json, @raw_json, @updated_at
    )
    ON CONFLICT(strava_id)
    DO UPDATE SET
      name = excluded.name,
      device_name = excluded.device_name,
      start_date_local = excluded.start_date_local,
      distance_m = excluded.distance_m,
      moving_time_s = excluded.moving_time_s,
      elapsed_time_s = excluded.elapsed_time_s,
      total_elevation_gain_m = excluded.total_elevation_gain_m,
      average_speed_mps = excluded.average_speed_mps,
      max_speed_mps = excluded.max_speed_mps,
      average_heartrate = excluded.average_heartrate,
      max_heartrate = excluded.max_heartrate,
      average_cadence = excluded.average_cadence,
      calories = excluded.calories,
      suffer_score = excluded.suffer_score,
      map_summary_polyline = excluded.map_summary_polyline,
      map_polyline = excluded.map_polyline,
      heartrate_zones_json = excluded.heartrate_zones_json,
      trend_points_json = excluded.trend_points_json,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);

  const deleteSplitsStmt = db.prepare('DELETE FROM activity_splits WHERE activity_strava_id = ?');
  const insertSplitStmt = db.prepare(`
    INSERT INTO activity_splits (
      activity_strava_id, split_index, distance_m, elapsed_time_s,
      elevation_difference_m, average_speed_mps, pace_sec_per_km, average_heartrate, average_cadence, calories
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertAnalysisStmt = db.prepare(`
    INSERT INTO activity_ai_analysis (
      activity_strava_id, content, generated_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(activity_strava_id)
    DO UPDATE SET
      content = excluded.content,
      generated_at = excluded.generated_at
  `);

  const upsertTransaction = db.transaction((activity: PersistedActivity) => {
    const existed = Boolean(existsStmt.get(activity.stravaId));

    upsertStmt.run({
      strava_id: activity.stravaId,
      name: activity.name,
      device_name: activity.deviceName ?? null,
      start_date_local: activity.startDateLocal,
      distance_m: activity.distanceM,
      moving_time_s: activity.movingTimeS,
      elapsed_time_s: activity.elapsedTimeS,
      total_elevation_gain_m: activity.totalElevationGainM,
      average_speed_mps: activity.averageSpeedMps,
      max_speed_mps: activity.maxSpeedMps,
      average_heartrate: activity.averageHeartrate,
      max_heartrate: activity.maxHeartrate,
      average_cadence: activity.averageCadence,
      calories: activity.calories ?? null,
      suffer_score: activity.sufferScore,
      map_summary_polyline: activity.mapSummaryPolyline,
      map_polyline: activity.mapPolyline,
      heartrate_zones_json: activity.heartRateZones ? JSON.stringify(activity.heartRateZones) : null,
      trend_points_json: activity.trendPoints ? JSON.stringify(activity.trendPoints) : null,
      raw_json: activity.rawJson,
      updated_at: new Date().toISOString(),
    });

    deleteSplitsStmt.run(activity.stravaId);
    for (const split of activity.splits) {
      insertSplitStmt.run(
        activity.stravaId,
        split.splitIndex,
        split.distanceM,
        split.elapsedTimeS,
        split.elevationDifferenceM,
        split.averageSpeedMps,
        split.paceSecPerKm,
        split.averageHeartrate,
        split.averageCadence,
        split.calories,
      );
    }

    return existed ? 'updated' : 'created';
  });

  return {
    upsertRunActivity(activity: PersistedActivity): 'created' | 'updated' {
      return upsertTransaction(activity) as 'created' | 'updated';
    },

    getSummary(range: DateRangeQuery): SummaryMetrics {
      const where = buildDateWhere(range);
      const row = db
        .prepare(
          `
          SELECT
            COUNT(*) AS total_runs,
            COALESCE(SUM(distance_m), 0) AS total_distance_m,
            COALESCE(SUM(moving_time_s), 0) AS total_moving_time_s,
            COALESCE(SUM(total_elevation_gain_m), 0) AS total_elevation_gain_m,
            AVG(average_heartrate) AS average_heartrate,
            MIN((moving_time_s * 1000.0) / NULLIF(distance_m, 0)) AS best_pace_sec_per_km
          FROM activities
          ${where.clause}
        `,
        )
        .get(...where.params) as Record<string, unknown>;

      const totalDistanceM = Number(row.total_distance_m);
      const totalMovingTimeS = Number(row.total_moving_time_s);
      return {
        totalRuns: Number(row.total_runs),
        totalDistanceM,
        totalMovingTimeS,
        totalElevationGainM: Number(row.total_elevation_gain_m),
        averagePaceSecPerKm: paceFromDistanceAndTime(totalDistanceM, totalMovingTimeS),
        bestPaceSecPerKm: row.best_pace_sec_per_km == null ? null : Number(row.best_pace_sec_per_km),
        averageHeartrate: row.average_heartrate == null ? null : Number(row.average_heartrate),
      };
    },

    getWeeklyTrends(range: DateRangeQuery): WeeklyTrendPoint[] {
      const where = buildDateWhere(range);
      const rows = db
        .prepare(
          `
          SELECT
            strftime('%Y', start_date_local) AS year,
            strftime('%W', start_date_local) AS week,
            MIN(date(start_date_local)) AS week_start,
            SUM(distance_m) AS total_distance_m,
            SUM(moving_time_s) AS total_moving_time_s,
            COUNT(*) AS runs
          FROM activities
          ${where.clause}
          GROUP BY year, week
          ORDER BY year ASC, week ASC
        `,
        )
        .all(...where.params) as Array<Record<string, unknown>>;

      return rows.map((row) => {
        const totalDistanceM = Number(row.total_distance_m);
        const totalMovingTimeS = Number(row.total_moving_time_s);

        return {
          weekStart: String(row.week_start),
          totalDistanceM,
          totalMovingTimeS,
          averagePaceSecPerKm: paceFromDistanceAndTime(totalDistanceM, totalMovingTimeS),
          runs: Number(row.runs),
        };
      });
    },

    listActivities(inputQuery: Partial<ActivityQuery> & DateRangeQuery): PaginatedActivities {
      const query = {
        ...DEFAULT_QUERY,
        ...inputQuery,
      };

      const where = buildDateWhere(query);
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
      const offset = (page - 1) * pageSize;

      const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';
      const sortSql =
        query.sortBy === 'distance_m'
          ? 'distance_m'
          : query.sortBy === 'pace_sec_per_km'
            ? '(moving_time_s * 1000.0 / NULLIF(distance_m, 0))'
            : 'start_date_local';

      const totalRow = db
        .prepare(`SELECT COUNT(*) AS total FROM activities ${where.clause}`)
        .get(...where.params) as Record<string, unknown>;
      const total = Number(totalRow.total);

      const rows = db
        .prepare(
          `
          SELECT
            strava_id,
            name,
            device_name,
            start_date_local,
            distance_m,
            moving_time_s,
            elapsed_time_s,
            total_elevation_gain_m,
            average_speed_mps,
            max_speed_mps,
            average_heartrate,
            max_heartrate,
            average_cadence,
            calories,
            suffer_score,
            map_summary_polyline,
            map_polyline,
            updated_at,
            (moving_time_s * 1000.0 / NULLIF(distance_m, 0)) AS pace_sec_per_km
          FROM activities
          ${where.clause}
          ORDER BY ${sortSql} ${sortDir}, start_date_local DESC
          LIMIT ? OFFSET ?
        `,
        )
        .all(...where.params, pageSize, offset) as Array<Record<string, unknown>>;

      return {
        page,
        pageSize,
        total,
        items: rows.map(mapRunActivity),
      };
    },

    getActivityById(stravaId: number): RunActivity | null {
      const row = db
        .prepare(
          `
          SELECT
            *,
            (moving_time_s * 1000.0 / NULLIF(distance_m, 0)) AS pace_sec_per_km,
            (SELECT MAX(max_heartrate) FROM activities) AS athlete_max_heartrate
          FROM activities
          WHERE strava_id = ?
        `,
        )
        .get(stravaId) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      const splitsRows = db
        .prepare(
          `
          SELECT
            split_index, distance_m, elapsed_time_s,
            elevation_difference_m, average_speed_mps, pace_sec_per_km, average_heartrate, average_cadence, calories
          FROM activity_splits
          WHERE activity_strava_id = ?
          ORDER BY split_index ASC
        `,
        )
        .all(stravaId) as Array<Record<string, unknown>>;

      return {
        ...mapRunActivity(row),
        splits: splitsRows.map(mapRunSplit),
      };
    },

    getActivityAnalysis(stravaId: number): ActivityAiAnalysis | null {
      const row = db
        .prepare(
          `
          SELECT
            activity_strava_id,
            content,
            generated_at
          FROM activity_ai_analysis
          WHERE activity_strava_id = ?
        `,
        )
        .get(stravaId) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      return {
        activityId: Number(row.activity_strava_id),
        content: String(row.content),
        generatedAt: String(row.generated_at),
        cached: true,
      };
    },

    saveActivityAnalysis(stravaId: number, content: string): ActivityAiAnalysis {
      const generatedAt = new Date().toISOString();
      upsertAnalysisStmt.run(stravaId, content, generatedAt);
      return {
        activityId: stravaId,
        content,
        generatedAt,
        cached: false,
      };
    },

    getCalendarFilterOptions(): CalendarFilterOptions {
      const rows = db
        .prepare(
          `
          SELECT
            CAST(strftime('%Y', start_date_local) AS INTEGER) AS year,
            CAST(strftime('%m', start_date_local) AS INTEGER) AS month
          FROM activities
          GROUP BY year, month
          ORDER BY year DESC, month ASC
        `,
        )
        .all() as Array<Record<string, unknown>>;

      const years: number[] = [];
      const monthsByYear: Record<string, number[]> = {};

      for (const row of rows) {
        const year = Number(row.year);
        const month = Number(row.month);
        if (!Number.isFinite(year) || !Number.isFinite(month)) {
          continue;
        }
        if (!years.includes(year)) {
          years.push(year);
        }
        const key = String(year);
        monthsByYear[key] ??= [];
        if (!monthsByYear[key].includes(month)) {
          monthsByYear[key].push(month);
        }
      }

      return { years, monthsByYear };
    },

    createTrainingPlan(date: string, planText: string): TrainingPlan {
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `
          INSERT INTO training_plans (date, plan_text, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `,
        )
        .run(date, planText, now, now);

      return {
        id: Number(result.lastInsertRowid),
        date,
        planText,
        createdAt: now,
        updatedAt: now,
      };
    },

    getTrainingPlanByDate(date: string): TrainingPlan | null {
      const row = db
        .prepare(
          `
          SELECT id, date, plan_text, created_at, updated_at
          FROM training_plans
          WHERE date = ?
        `,
        )
        .get(date) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      return {
        id: Number(row.id),
        date: String(row.date),
        planText: String(row.plan_text),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    },

    updateTrainingPlan(date: string, planText: string): TrainingPlan | null {
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `
          UPDATE training_plans
          SET plan_text = ?, updated_at = ?
          WHERE date = ?
        `,
        )
        .run(planText, now, date);

      if (result.changes === 0) {
        return null;
      }

      return this.getTrainingPlanByDate(date);
    },

    deleteTrainingPlan(date: string): boolean {
      const result = db
        .prepare(
          `
          DELETE FROM training_plans
          WHERE date = ?
        `,
        )
        .run(date);

      return result.changes > 0;
    },

    getTrainingPlansByRange(from?: string, to?: string): TrainingPlan[] {
      const where = buildPlanDateWhere({ from, to });
      const rows = db
        .prepare(
          `
          SELECT id, date, plan_text, created_at, updated_at
          FROM training_plans
          ${where.clause}
          ORDER BY date DESC
        `,
        )
        .all(...where.params) as Array<Record<string, unknown>>;

      return rows.map((row) => ({
        id: Number(row.id),
        date: String(row.date),
        planText: String(row.plan_text),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    },

    getDailySummary(year: number, month: number): DailySummary[] {
      // 生成月份的所有日期
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      const days: string[] = [];

      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        days.push(formatLocalDateKey(d));
      }

      if (days.length === 0) {
        return [];
      }

      const from = days[0];
      const to = days[days.length - 1];

      // 批量查询计划和活动
      const plans = this.getTrainingPlansByRange(from, to);
      const activities = this.listActivities({
        from,
        to,
        page: 1,
        pageSize: 1000,
        sortBy: 'start_date_local',
        sortDir: 'asc',
      });

      // 组装每日摘要
      const planMap = new Map(plans.map((p) => [p.date, p]));
      const activityMap = new Map<string, RunActivity[]>();

      for (const activity of activities.items) {
        const date = activity.startDateLocal.split('T')[0];
        if (!activityMap.has(date)) {
          activityMap.set(date, []);
        }
        activityMap.get(date)!.push(activity);
      }

      return days.map((date) => {
        const plan = planMap.get(date) ?? null;
        const dayActivities = activityMap.get(date) ?? [];

        let status: CompletionStatus;
        if (!plan) {
          status = 'no_plan';
        } else if (dayActivities.length === 0) {
          status = 'missed';
        } else {
          status = 'completed';
        }

        return {
          date,
          plan,
          activities: dayActivities,
          completionStatus: status,
        };
      });
    },
  };
}

export type RunRepository = ReturnType<typeof createRepository>;
