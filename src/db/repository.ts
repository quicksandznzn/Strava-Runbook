import type Database from 'better-sqlite3';
import type {
  ActivityAiAnalysis,
  ActivityQuery,
  CalendarFilterOptions,
  DateRangeQuery,
  PaginatedActivities,
  RunActivity,
  RunSplit,
  SummaryMetrics,
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
}

export interface PersistedActivity {
  stravaId: number;
  name: string;
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
  sufferScore: number | null;
  mapSummaryPolyline: string | null;
  mapPolyline: string | null;
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

function mapRunActivity(row: Record<string, unknown>): RunActivity {
  return {
    stravaId: Number(row.strava_id),
    name: String(row.name),
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
    sufferScore: row.suffer_score == null ? null : Number(row.suffer_score),
    mapSummaryPolyline: row.map_summary_polyline == null ? null : String(row.map_summary_polyline),
    mapPolyline: row.map_polyline == null ? null : String(row.map_polyline),
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
  };
}

export function createRepository(db: Database.Database) {
  const existsStmt = db.prepare('SELECT 1 FROM activities WHERE strava_id = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO activities (
      strava_id, name, start_date_local, distance_m, moving_time_s, elapsed_time_s,
      total_elevation_gain_m, average_speed_mps, max_speed_mps,
      average_heartrate, max_heartrate, average_cadence, suffer_score,
      map_summary_polyline, map_polyline, raw_json, updated_at
    ) VALUES (
      @strava_id, @name, @start_date_local, @distance_m, @moving_time_s, @elapsed_time_s,
      @total_elevation_gain_m, @average_speed_mps, @max_speed_mps,
      @average_heartrate, @max_heartrate, @average_cadence, @suffer_score,
      @map_summary_polyline, @map_polyline, @raw_json, @updated_at
    )
    ON CONFLICT(strava_id)
    DO UPDATE SET
      name = excluded.name,
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
      suffer_score = excluded.suffer_score,
      map_summary_polyline = excluded.map_summary_polyline,
      map_polyline = excluded.map_polyline,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);

  const deleteSplitsStmt = db.prepare('DELETE FROM activity_splits WHERE activity_strava_id = ?');
  const insertSplitStmt = db.prepare(`
    INSERT INTO activity_splits (
      activity_strava_id, split_index, distance_m, elapsed_time_s,
      elevation_difference_m, average_speed_mps, pace_sec_per_km
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
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
      suffer_score: activity.sufferScore,
      map_summary_polyline: activity.mapSummaryPolyline,
      map_polyline: activity.mapPolyline,
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
            *,
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
            (moving_time_s * 1000.0 / NULLIF(distance_m, 0)) AS pace_sec_per_km
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
            elevation_difference_m, average_speed_mps, pace_sec_per_km
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
  };
}

export type RunRepository = ReturnType<typeof createRepository>;
