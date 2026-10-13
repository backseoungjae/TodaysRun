export const migration001 = `
CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  status TEXT NOT NULL CHECK(status IN ('running','paused','completed')),
  started_at_ms INTEGER NOT NULL CHECK(typeof(started_at_ms)='integer' AND started_at_ms >= 0 AND started_at_ms <= 9007199254740991),
  ended_at_ms INTEGER CHECK(ended_at_ms IS NULL OR (typeof(ended_at_ms)='integer' AND ended_at_ms >= started_at_ms AND ended_at_ms <= 9007199254740991)),
  active_duration_ms INTEGER NOT NULL CHECK(typeof(active_duration_ms)='integer' AND active_duration_ms >= 0 AND active_duration_ms <= 9007199254740991),
  committed_duration_ms INTEGER NOT NULL CHECK(typeof(committed_duration_ms)='integer' AND committed_duration_ms >= 0 AND committed_duration_ms <= active_duration_ms),
  active_since_ms INTEGER CHECK(active_since_ms IS NULL OR (typeof(active_since_ms)='integer' AND active_since_ms >= started_at_ms AND active_since_ms <= 9007199254740991)),
  distance_meters REAL NOT NULL DEFAULT 0 CHECK(distance_meters >= 0 AND distance_meters < 1e100),
  last_checkpoint_at_ms INTEGER NOT NULL CHECK(typeof(last_checkpoint_at_ms)='integer' AND last_checkpoint_at_ms >= started_at_ms AND last_checkpoint_at_ms <= 9007199254740991),
  last_saved_at_ms INTEGER NOT NULL CHECK(typeof(last_saved_at_ms)='integer' AND last_saved_at_ms >= last_checkpoint_at_ms AND last_saved_at_ms <= 9007199254740991),
  segment_index INTEGER CHECK(segment_index IS NULL OR (typeof(segment_index)='integer' AND segment_index >= 0)),
  state_revision INTEGER NOT NULL CHECK(typeof(state_revision)='integer' AND state_revision >= 0),
  completion_reason TEXT CHECK(completion_reason IS NULL OR completion_reason IN ('normal','recovered')),
  CHECK((status='running' AND active_since_ms IS NOT NULL) OR (status!='running' AND active_since_ms IS NULL)),
  CHECK((status='completed' AND ended_at_ms IS NOT NULL AND completion_reason IS NOT NULL AND ended_at_ms >= last_saved_at_ms)
     OR (status!='completed' AND ended_at_ms IS NULL AND completion_reason IS NULL)),
  CHECK(status='running' OR active_duration_ms=committed_duration_ms)
);
CREATE TABLE run_locations (
  id INTEGER PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy_meters REAL NOT NULL CHECK(accuracy_meters >= 0 AND accuracy_meters < 1e100),
  recorded_at_ms INTEGER NOT NULL CHECK(typeof(recorded_at_ms)='integer' AND recorded_at_ms >= 0 AND recorded_at_ms <= 9007199254740991),
  segment_index INTEGER NOT NULL CHECK(typeof(segment_index)='integer' AND segment_index >= 0),
  distance_delta_meters REAL NOT NULL CHECK(distance_delta_meters >= 0 AND distance_delta_meters < 1e100),
  UNIQUE(run_id, recorded_at_ms)
);
CREATE INDEX runs_completed_order ON runs(started_at_ms DESC) WHERE status='completed';
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  background_tracking_enabled INTEGER NOT NULL CHECK(background_tracking_enabled IN (0,1))
);
INSERT INTO app_settings(id, background_tracking_enabled) VALUES(1,0);
PRAGMA user_version = 1;
`;
