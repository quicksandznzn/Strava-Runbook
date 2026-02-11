import type Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      start_date_local TEXT NOT NULL,
      distance_m REAL NOT NULL,
      moving_time_s INTEGER NOT NULL,
      elapsed_time_s INTEGER NOT NULL,
      total_elevation_gain_m REAL NOT NULL,
      average_speed_mps REAL,
      max_speed_mps REAL,
      average_heartrate REAL,
      max_heartrate REAL,
      average_cadence REAL,
      suffer_score REAL,
      map_summary_polyline TEXT,
      map_polyline TEXT,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_strava_id INTEGER NOT NULL,
      split_index INTEGER NOT NULL,
      distance_m REAL NOT NULL,
      elapsed_time_s INTEGER NOT NULL,
      elevation_difference_m REAL,
      average_speed_mps REAL,
      pace_sec_per_km REAL,
      FOREIGN KEY(activity_strava_id) REFERENCES activities(strava_id) ON DELETE CASCADE,
      UNIQUE(activity_strava_id, split_index)
    );

    CREATE TABLE IF NOT EXISTS activity_ai_analysis (
      activity_strava_id INTEGER PRIMARY KEY,
      content TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      FOREIGN KEY(activity_strava_id) REFERENCES activities(strava_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activities_start_date_local ON activities(start_date_local);
    CREATE INDEX IF NOT EXISTS idx_activities_strava_id ON activities(strava_id);
    CREATE INDEX IF NOT EXISTS idx_splits_activity_id ON activity_splits(activity_strava_id);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_activity_id ON activity_ai_analysis(activity_strava_id);
  `);
}
