-- Push リマインダーの二重送信を防ぐ冪等ガード用テーブル。
-- cron が (task_id, reminder_time) を原子的に「予約」し、初回のみ送信する。
-- tasks 表は同期で INSERT OR REPLACE されるため列を足せない。独立テーブルで管理する。
CREATE TABLE IF NOT EXISTS sent_reminders (
  task_id       TEXT NOT NULL,
  reminder_time TEXT NOT NULL,
  sent_at       INTEGER NOT NULL,
  PRIMARY KEY (task_id, reminder_time)
);

CREATE INDEX IF NOT EXISTS idx_sent_reminders_sent_at
  ON sent_reminders(sent_at);
