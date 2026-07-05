-- 端末ごとの Push 購読テーブル。
-- 従来は users.push_subscription 1 列に「同期コードにつき 1 購読」しか持てず、
-- 同じコードで 2 台目が購読すると 1 台目の購読が上書きされ、通知が
-- 「最後に購読した端末」にしか届かなかった。端末(= endpoint)単位の行に分離し、
-- Cron は同期コード配下の全端末へ配信する。
-- endpoint は Push サービスが端末×購読ごとに発行する一意 URL。PRIMARY KEY にする
-- ことで、同じ端末の再購読・同期コード切替は INSERT ... ON CONFLICT で原子的に
-- 付け替えられる（unsubscribe を挟む必要がなく、購読ゼロの瞬間が生まれない）。
CREATE TABLE push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  sync_code    TEXT NOT NULL,
  subscription TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Cron の「この同期コードの全購読」検索用。
CREATE INDEX idx_push_subscriptions_sync_code ON push_subscriptions(sync_code);

-- 既存の users.push_subscription を移行（endpoint は購読 JSON から抽出）。
-- users.push_subscription 列は残すが、以後は読み書きしない（deprecated）。
INSERT OR IGNORE INTO push_subscriptions (endpoint, sync_code, subscription, created_at, updated_at)
SELECT json_extract(push_subscription, '$.endpoint'), sync_code, push_subscription, updated_at, updated_at
FROM users
WHERE push_subscription IS NOT NULL
  AND json_extract(push_subscription, '$.endpoint') IS NOT NULL;

-- reminder_time はクライアント・サーバーとも Date.toISOString()（UTC・固定書式）で
-- 書き込むため、辞書順比較 = 時刻順比較が成り立つ。notify Cron は datetime() で
-- 包んで比較していたが、関数で包むとインデックスが使えず毎分フルスキャンになる。
-- ISO 文字列の素の範囲比較に切り替えるのに合わせ、インデックスも張り直す。
-- 旧 partial index（WHERE status='active'）は「active OR 完了済み繰り返し」という
-- notify の述語に適合しないため、全行インデックスに置き換える。
DROP INDEX IF EXISTS idx_tasks_reminder_time;
CREATE INDEX idx_tasks_reminder_time ON tasks(reminder_time);

-- 取りこぼし回収クエリ（繰り返しタスク限定・過去全域を見る）専用の partial index。
-- 全行インデックスだと送信済み単発タスクの過去行が毎分スキャン対象に溜まり続ける。
CREATE INDEX idx_tasks_recurring_reminder
  ON tasks(reminder_time) WHERE recurrence_rule IS NOT NULL;
