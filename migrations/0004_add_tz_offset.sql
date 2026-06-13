-- 繰り返しタスクの reminder_time をサーバー側で次周期へ進めるために、
-- タスク生成時の端末タイムゾーンオフセット（UTC からの分。JST=+540）を保持する。
-- 毎月の境界（ローカルの 1 日 0:00）を厳密に計算するために必要。
-- 既存行は NULL（クライアントが次回 revive 時にバックフィルして同期する）。
ALTER TABLE tasks ADD COLUMN tz_offset INTEGER;
