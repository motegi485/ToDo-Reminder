-- チェックボックスのアクセント色（ユーザー任意指定）。
-- NULL = 未指定。クライアントが種類×期限で自動配色する（既存挙動）。
-- サーバーは color を解釈せず、同期でそのまま保存・返却するだけ（パススルー）。
-- CHECK 制約は付けない: 将来パレットを増やしても同期（INSERT OR REPLACE）が壊れないようにする。
-- 既存行は NULL（=自動）で始まる。
ALTER TABLE tasks ADD COLUMN color TEXT;
