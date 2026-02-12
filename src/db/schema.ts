import type { Pool, PoolClient } from 'pg';

export async function applySchema(db: Pool | PoolClient): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS activities (
      id BIGSERIAL PRIMARY KEY,
      strava_id BIGINT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      device_name TEXT,
      start_date_local TIMESTAMPTZ NOT NULL,
      distance_m DOUBLE PRECISION NOT NULL,
      moving_time_s INTEGER NOT NULL,
      elapsed_time_s INTEGER NOT NULL,
      total_elevation_gain_m DOUBLE PRECISION NOT NULL,
      average_speed_mps DOUBLE PRECISION,
      max_speed_mps DOUBLE PRECISION,
      average_heartrate DOUBLE PRECISION,
      max_heartrate DOUBLE PRECISION,
      average_cadence DOUBLE PRECISION,
      calories DOUBLE PRECISION,
      suffer_score DOUBLE PRECISION,
      map_summary_polyline TEXT,
      map_polyline TEXT,
      heartrate_zones_json JSONB,
      trend_points_json JSONB,
      raw_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_splits (
      id BIGSERIAL PRIMARY KEY,
      activity_strava_id BIGINT NOT NULL REFERENCES activities(strava_id) ON DELETE CASCADE,
      split_index INTEGER NOT NULL,
      distance_m DOUBLE PRECISION NOT NULL,
      elapsed_time_s INTEGER NOT NULL,
      elevation_difference_m DOUBLE PRECISION,
      average_speed_mps DOUBLE PRECISION,
      pace_sec_per_km DOUBLE PRECISION,
      average_heartrate DOUBLE PRECISION,
      average_cadence DOUBLE PRECISION,
      calories DOUBLE PRECISION,
      UNIQUE(activity_strava_id, split_index)
    );

    CREATE TABLE IF NOT EXISTS activity_ai_analysis (
      activity_strava_id BIGINT PRIMARY KEY REFERENCES activities(strava_id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activities_start_date_local ON activities(start_date_local);
    CREATE INDEX IF NOT EXISTS idx_activities_strava_id ON activities(strava_id);
    CREATE INDEX IF NOT EXISTS idx_splits_activity_id ON activity_splits(activity_strava_id);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_activity_id ON activity_ai_analysis(activity_strava_id);
  `);
}
