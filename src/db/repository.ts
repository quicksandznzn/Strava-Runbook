import type { Pool } from 'pg';
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

export interface RunRepository {
  upsertRunActivity(activity: PersistedActivity): Promise<'created' | 'updated'>;
  getSummary(range: DateRangeQuery): Promise<SummaryMetrics>;
  getWeeklyTrends(range: DateRangeQuery): Promise<WeeklyTrendPoint[]>;
  listActivities(inputQuery: Partial<ActivityQuery> & DateRangeQuery): Promise<PaginatedActivities>;
  getActivityById(stravaId: number): Promise<RunActivity | null>;
  getActivityAnalysis(stravaId: number): Promise<ActivityAiAnalysis | null>;
  saveActivityAnalysis(stravaId: number, content: string): Promise<ActivityAiAnalysis>;
  getCalendarFilterOptions(): Promise<CalendarFilterOptions>;
  createTrainingPlan(date: string, planText: string): Promise<TrainingPlan>;
  getTrainingPlanByDate(date: string): Promise<TrainingPlan | null>;
  updateTrainingPlan(date: string, planText: string): Promise<TrainingPlan | null>;
  deleteTrainingPlan(date: string): Promise<boolean>;
  getTrainingPlansByRange(from?: string, to?: string): Promise<TrainingPlan[]>;
  getDailySummary(year: number, month: number): Promise<DailySummary[]>;
}

const DEFAULT_QUERY: ActivityQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'start_date_local',
  sortDir: 'desc',
};

function buildDateWhere(range: DateRangeQuery, startIndex = 1): WhereClauseResult {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  let index = startIndex;

  if (range.from) {
    clauses.push(`DATE(start_date_local AT TIME ZONE 'Asia/Shanghai') >= $${index}::date`);
    params.push(range.from);
    index += 1;
  }

  if (range.to) {
    clauses.push(`DATE(start_date_local AT TIME ZONE 'Asia/Shanghai') <= $${index}::date`);
    params.push(range.to);
    index += 1;
  }

  if (clauses.length === 0) {
    return { clause: '', params };
  }

  return {
    clause: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

function buildPlanDateWhere(range: DateRangeQuery, startIndex = 1): WhereClauseResult {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  let index = startIndex;

  if (range.from) {
    clauses.push(`date >= $${index}::date`);
    params.push(range.from);
    index += 1;
  }

  if (range.to) {
    clauses.push(`date <= $${index}::date`);
    params.push(range.to);
    index += 1;
  }

  if (clauses.length === 0) {
    return { clause: '', params };
  }

  return {
    clause: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

function parseJsonArray(rawValue: unknown): unknown[] | undefined {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseHeartRateZones(rawValue: unknown): RunHeartRateZone[] | undefined {
  const parsed = parseJsonArray(rawValue);
  if (!parsed) {
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
}

function parseTrendPoints(rawValue: unknown): RunTrendPoint[] | undefined {
  const parsed = parseJsonArray(rawValue);
  if (!parsed) {
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
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

const calendarDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toCalendarDateKey(dateIso: string): string {
  return calendarDateFormatter.format(new Date(dateIso));
}

function toSqlDateString(value: unknown): string {
  if (typeof value === 'string') {
    const matched = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (matched) {
      return matched[1];
    }
  }

  if (value instanceof Date) {
    return shanghaiDateFormatter.format(value);
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return shanghaiDateFormatter.format(parsed);
  }

  return String(value);
}

function buildMonthDateKeys(year: number, month: number): string[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthText = String(month).padStart(2, '0');
  return Array.from({ length: daysInMonth }, (_, idx) => `${year}-${monthText}-${String(idx + 1).padStart(2, '0')}`);
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
    startDateLocal: toIsoString(row.start_date_local),
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
    updatedAt: toIsoString(row.updated_at),
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

function mapTrainingPlan(row: Record<string, unknown>): TrainingPlan {
  return {
    id: Number(row.id),
    date: toSqlDateString(row.date),
    planText: String(row.plan_text),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export function createRepository(db: Pool): RunRepository {
  return {
    async upsertRunActivity(activity: PersistedActivity): Promise<'created' | 'updated'> {
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        const existsResult = await client.query('SELECT 1 FROM activities WHERE strava_id = $1', [activity.stravaId]);
        const existed = (existsResult.rowCount ?? 0) > 0;

        await client.query(
          `
          INSERT INTO activities (
            strava_id, name, device_name, start_date_local, distance_m, moving_time_s, elapsed_time_s,
            total_elevation_gain_m, average_speed_mps, max_speed_mps,
            average_heartrate, max_heartrate, average_cadence, calories, suffer_score,
            map_summary_polyline, map_polyline, heartrate_zones_json, trend_points_json, raw_json, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, NOW()
          )
          ON CONFLICT(strava_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            device_name = EXCLUDED.device_name,
            start_date_local = EXCLUDED.start_date_local,
            distance_m = EXCLUDED.distance_m,
            moving_time_s = EXCLUDED.moving_time_s,
            elapsed_time_s = EXCLUDED.elapsed_time_s,
            total_elevation_gain_m = EXCLUDED.total_elevation_gain_m,
            average_speed_mps = EXCLUDED.average_speed_mps,
            max_speed_mps = EXCLUDED.max_speed_mps,
            average_heartrate = EXCLUDED.average_heartrate,
            max_heartrate = EXCLUDED.max_heartrate,
            average_cadence = EXCLUDED.average_cadence,
            calories = EXCLUDED.calories,
            suffer_score = EXCLUDED.suffer_score,
            map_summary_polyline = EXCLUDED.map_summary_polyline,
            map_polyline = EXCLUDED.map_polyline,
            heartrate_zones_json = EXCLUDED.heartrate_zones_json,
            trend_points_json = EXCLUDED.trend_points_json,
            raw_json = EXCLUDED.raw_json,
            updated_at = NOW()
          `,
          [
            activity.stravaId,
            activity.name,
            activity.deviceName ?? null,
            activity.startDateLocal,
            activity.distanceM,
            activity.movingTimeS,
            activity.elapsedTimeS,
            activity.totalElevationGainM,
            activity.averageSpeedMps,
            activity.maxSpeedMps,
            activity.averageHeartrate,
            activity.maxHeartrate,
            activity.averageCadence,
            activity.calories ?? null,
            activity.sufferScore,
            activity.mapSummaryPolyline,
            activity.mapPolyline,
            activity.heartRateZones && activity.heartRateZones.length > 0 ? JSON.stringify(activity.heartRateZones) : null,
            activity.trendPoints && activity.trendPoints.length > 0 ? JSON.stringify(activity.trendPoints) : null,
            activity.rawJson,
          ],
        );

        await client.query('DELETE FROM activity_splits WHERE activity_strava_id = $1', [activity.stravaId]);

        for (const split of activity.splits) {
          await client.query(
            `
            INSERT INTO activity_splits (
              activity_strava_id,
              split_index,
              distance_m,
              elapsed_time_s,
              elevation_difference_m,
              average_speed_mps,
              pace_sec_per_km,
              average_heartrate,
              average_cadence,
              calories
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `,
            [
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
            ],
          );
        }

        await client.query('COMMIT');
        return existed ? 'updated' : 'created';
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async getSummary(range: DateRangeQuery): Promise<SummaryMetrics> {
      const where = buildDateWhere(range);
      const { rows } = await db.query(
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
        where.params,
      );

      const row = (rows[0] ?? {}) as Record<string, unknown>;
      const totalDistanceM = Number(row.total_distance_m ?? 0);
      const totalMovingTimeS = Number(row.total_moving_time_s ?? 0);
      return {
        totalRuns: Number(row.total_runs ?? 0),
        totalDistanceM,
        totalMovingTimeS,
        totalElevationGainM: Number(row.total_elevation_gain_m ?? 0),
        averagePaceSecPerKm: paceFromDistanceAndTime(totalDistanceM, totalMovingTimeS),
        bestPaceSecPerKm: row.best_pace_sec_per_km == null ? null : Number(row.best_pace_sec_per_km),
        averageHeartrate: row.average_heartrate == null ? null : Number(row.average_heartrate),
      };
    },

    async getWeeklyTrends(range: DateRangeQuery): Promise<WeeklyTrendPoint[]> {
      const where = buildDateWhere(range);
      const { rows } = await db.query(
        `
          SELECT
            DATE_TRUNC('week', start_date_local AT TIME ZONE 'Asia/Shanghai')::date AS week_start,
            SUM(distance_m) AS total_distance_m,
            SUM(moving_time_s) AS total_moving_time_s,
            COUNT(*) AS runs
          FROM activities
          ${where.clause}
          GROUP BY week_start
          ORDER BY week_start ASC
        `,
        where.params,
      );

      return rows.map((row) => {
        const mapped = row as Record<string, unknown>;
        const totalDistanceM = Number(mapped.total_distance_m);
        const totalMovingTimeS = Number(mapped.total_moving_time_s);

        return {
          weekStart: toIsoString(mapped.week_start).slice(0, 10),
          totalDistanceM,
          totalMovingTimeS,
          averagePaceSecPerKm: paceFromDistanceAndTime(totalDistanceM, totalMovingTimeS),
          runs: Number(mapped.runs),
        };
      });
    },

    async listActivities(inputQuery: Partial<ActivityQuery> & DateRangeQuery): Promise<PaginatedActivities> {
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

      const totalResult = await db.query(`SELECT COUNT(*) AS total FROM activities ${where.clause}`, where.params);
      const total = Number((totalResult.rows[0] as Record<string, unknown> | undefined)?.total ?? 0);

      const limitPlaceholder = `$${where.params.length + 1}`;
      const offsetPlaceholder = `$${where.params.length + 2}`;

      const { rows } = await db.query(
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
            heartrate_zones_json,
            trend_points_json,
            updated_at,
            (moving_time_s * 1000.0 / NULLIF(distance_m, 0)) AS pace_sec_per_km
          FROM activities
          ${where.clause}
          ORDER BY ${sortSql} ${sortDir}, start_date_local DESC
          LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
        `,
        [...where.params, pageSize, offset],
      );

      return {
        page,
        pageSize,
        total,
        items: rows.map((row) => mapRunActivity(row as Record<string, unknown>)),
      };
    },

    async getActivityById(stravaId: number): Promise<RunActivity | null> {
      const activityResult = await db.query(
        `
          SELECT
            *,
            (moving_time_s * 1000.0 / NULLIF(distance_m, 0)) AS pace_sec_per_km,
            (SELECT MAX(max_heartrate) FROM activities) AS athlete_max_heartrate
          FROM activities
          WHERE strava_id = $1
        `,
        [stravaId],
      );

      const row = activityResult.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        return null;
      }

      const splitsResult = await db.query(
        `
          SELECT
            split_index,
            distance_m,
            elapsed_time_s,
            elevation_difference_m,
            average_speed_mps,
            pace_sec_per_km,
            average_heartrate,
            average_cadence,
            calories
          FROM activity_splits
          WHERE activity_strava_id = $1
          ORDER BY split_index ASC
        `,
        [stravaId],
      );

      return {
        ...mapRunActivity(row),
        splits: splitsResult.rows.map((split) => mapRunSplit(split as Record<string, unknown>)),
      };
    },

    async getActivityAnalysis(stravaId: number): Promise<ActivityAiAnalysis | null> {
      const result = await db.query(
        `
          SELECT
            activity_strava_id,
            content,
            generated_at
          FROM activity_ai_analysis
          WHERE activity_strava_id = $1
        `,
        [stravaId],
      );

      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        return null;
      }

      return {
        activityId: Number(row.activity_strava_id),
        content: String(row.content),
        generatedAt: toIsoString(row.generated_at),
        cached: true,
      };
    },

    async saveActivityAnalysis(stravaId: number, content: string): Promise<ActivityAiAnalysis> {
      const generatedAt = new Date().toISOString();
      await db.query(
        `
          INSERT INTO activity_ai_analysis (
            activity_strava_id,
            content,
            generated_at
          ) VALUES ($1, $2, $3)
          ON CONFLICT(activity_strava_id)
          DO UPDATE SET
            content = EXCLUDED.content,
            generated_at = EXCLUDED.generated_at
        `,
        [stravaId, content, generatedAt],
      );

      return {
        activityId: stravaId,
        content,
        generatedAt,
        cached: false,
      };
    },

    async getCalendarFilterOptions(): Promise<CalendarFilterOptions> {
      const { rows } = await db.query(`
          SELECT
            EXTRACT(YEAR FROM start_date_local AT TIME ZONE 'Asia/Shanghai')::int AS year,
            EXTRACT(MONTH FROM start_date_local AT TIME ZONE 'Asia/Shanghai')::int AS month
          FROM activities
          GROUP BY year, month
          ORDER BY year DESC, month ASC
        `);

      const years: number[] = [];
      const monthsByYear: Record<string, number[]> = {};

      for (const row of rows) {
        const mapped = row as Record<string, unknown>;
        const year = Number(mapped.year);
        const month = Number(mapped.month);
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

    async createTrainingPlan(date: string, planText: string): Promise<TrainingPlan> {
      const { rows } = await db.query(
        `
          INSERT INTO training_plans (date, plan_text, created_at, updated_at)
          VALUES ($1::date, $2, NOW(), NOW())
          RETURNING id, date, plan_text, created_at, updated_at
        `,
        [date, planText],
      );
      return mapTrainingPlan(rows[0] as Record<string, unknown>);
    },

    async getTrainingPlanByDate(date: string): Promise<TrainingPlan | null> {
      const { rows } = await db.query(
        `
          SELECT id, date, plan_text, created_at, updated_at
          FROM training_plans
          WHERE date = $1::date
        `,
        [date],
      );
      const row = rows[0] as Record<string, unknown> | undefined;
      return row ? mapTrainingPlan(row) : null;
    },

    async updateTrainingPlan(date: string, planText: string): Promise<TrainingPlan | null> {
      const { rows } = await db.query(
        `
          UPDATE training_plans
          SET plan_text = $2, updated_at = NOW()
          WHERE date = $1::date
          RETURNING id, date, plan_text, created_at, updated_at
        `,
        [date, planText],
      );
      const row = rows[0] as Record<string, unknown> | undefined;
      return row ? mapTrainingPlan(row) : null;
    },

    async deleteTrainingPlan(date: string): Promise<boolean> {
      const result = await db.query(
        `
          DELETE FROM training_plans
          WHERE date = $1::date
        `,
        [date],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async getTrainingPlansByRange(from?: string, to?: string): Promise<TrainingPlan[]> {
      const where = buildPlanDateWhere({ from, to });
      const { rows } = await db.query(
        `
          SELECT id, date, plan_text, created_at, updated_at
          FROM training_plans
          ${where.clause}
          ORDER BY date DESC
        `,
        where.params,
      );
      return rows.map((row) => mapTrainingPlan(row as Record<string, unknown>));
    },

    async getDailySummary(year: number, month: number): Promise<DailySummary[]> {
      const days = buildMonthDateKeys(year, month);
      if (days.length === 0) {
        return [];
      }

      const from = days[0];
      const to = days[days.length - 1];
      const [plansResult, activitiesResult] = await Promise.all([
        db.query(
          `
            SELECT id, date, plan_text, created_at, updated_at
            FROM training_plans
            WHERE date >= $1::date AND date <= $2::date
            ORDER BY date DESC
          `,
          [from, to],
        ),
        db.query(
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
              heartrate_zones_json,
              trend_points_json,
              updated_at,
              (moving_time_s * 1000.0 / NULLIF(distance_m, 0)) AS pace_sec_per_km,
              (SELECT MAX(max_heartrate) FROM activities) AS athlete_max_heartrate
            FROM activities
            WHERE DATE(start_date_local AT TIME ZONE 'UTC') >= $1::date
              AND DATE(start_date_local AT TIME ZONE 'UTC') <= $2::date
            ORDER BY start_date_local ASC
          `,
          [from, to],
        ),
      ]);

      const planMap = new Map<string, TrainingPlan>();
      for (const row of plansResult.rows) {
        const plan = mapTrainingPlan(row as Record<string, unknown>);
        planMap.set(plan.date, plan);
      }

      const activityMap = new Map<string, RunActivity[]>();
      for (const row of activitiesResult.rows) {
        const activity = mapRunActivity(row as Record<string, unknown>);
        const dateKey = toCalendarDateKey(activity.startDateLocal);
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
