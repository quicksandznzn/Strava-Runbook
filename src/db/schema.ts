import type Database from 'better-sqlite3';

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      device_name TEXT,
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
      calories REAL,
      suffer_score REAL,
      map_summary_polyline TEXT,
      map_polyline TEXT,
      heartrate_zones_json TEXT,
      trend_points_json TEXT,
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
      average_heartrate REAL,
      average_cadence REAL,
      calories REAL,
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

    CREATE TABLE IF NOT EXISTS training_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      plan_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_training_plans_date ON training_plans(date);
  `);

  // Backward-compatible migration for existing local databases.
  ensureColumn(db, 'activities', 'device_name', 'TEXT');
  ensureColumn(db, 'activities', 'calories', 'REAL');
  ensureColumn(db, 'activities', 'heartrate_zones_json', 'TEXT');
  ensureColumn(db, 'activities', 'trend_points_json', 'TEXT');
  ensureColumn(db, 'activity_splits', 'average_heartrate', 'REAL');
  ensureColumn(db, 'activity_splits', 'average_cadence', 'REAL');
  ensureColumn(db, 'activity_splits', 'calories', 'REAL');
}
