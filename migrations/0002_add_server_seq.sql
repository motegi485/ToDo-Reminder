-- server_seq: サーバーが upsert 時に採番する同期カーソル専用の値（サーバー時計）。
-- pull は updated_at（クライアント時計・LWW 競合解決用）ではなく server_seq を
-- カーソルに使うことで、「編集 → push」の遅延や端末間の時計ズレによる取りこぼしを防ぐ。
ALTER TABLE tasks ADD COLUMN server_seq INTEGER NOT NULL DEFAULT 0;

-- 既存行を更新時刻で初期化（last_synced_at=0 の全件 pull を従来通り成立させる）。
UPDATE tasks SET server_seq = updated_at;

CREATE INDEX idx_tasks_server_seq ON tasks(sync_code, server_seq);
