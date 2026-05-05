CREATE TABLE users (
  sync_code         TEXT PRIMARY KEY,
  push_subscription TEXT,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  sync_code       TEXT NOT NULL,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('simple','quantitative')),
  status          TEXT NOT NULL CHECK (status IN ('active','completed','deleted')),
  current_value   INTEGER,
  target_value    INTEGER,
  due_date        TEXT,
  reminder_offset INTEGER,
  reminder_time   TEXT,
  recurrence_rule TEXT,
  project_name    TEXT,
  sort_order      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (sync_code) REFERENCES users(sync_code)
);

CREATE INDEX idx_tasks_reminder_time
  ON tasks(reminder_time) WHERE status = 'active';
CREATE INDEX idx_tasks_sync_code
  ON tasks(sync_code, status, updated_at);
CREATE INDEX idx_tasks_project
  ON tasks(sync_code, project_name, status);
