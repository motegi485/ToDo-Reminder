-- メモ（電話番号・メールアドレス・パスワードなどの控え）を tasks 表に同居させるための 3 列。
--
-- メモは「チェックして完了させる」性質を持たないタスクの兄弟エンティティで、
-- 同期・プロジェクト分け・同期コード切替を tasks とまったく同じ経路に乗せるために
-- 専用テーブルではなく列追加で表現する。applyLWW は SQL 文まで tasks 決め打ちで、
-- pull カーソル（server_seq）もテーブル単位のため、表を増やすと同期基盤一式の複製になる。
--
-- 判別に type を使わない理由: 0001 の CHECK (type IN ('simple','quantitative')) は今も有効で、
-- SQLite は列 CHECK を後から緩められない。type に 'memo' を足すとテーブル再構築が必要になる。
-- メモ行は type='simple' のまま保存し、判別は kind で行うことで再構築を避ける。
--
-- CHECK 制約は付けない: 0005_add_color.sql と同じ理由で、値の集合が将来増えるものに
-- サーバー側の制約を持たせると、クライアントを更新した瞬間に同期が
-- CHECK constraint failed で全滅する。サーバーは color / project_name と同様、
-- これらを解釈せず素通しで保存・返却するだけにする。
--
-- 既存行はすべて NULL で始まる（kind IS NULL がタスク）。

-- 行の種別。'memo' がメモ、NULL がタスク。
ALTER TABLE tasks ADD COLUMN kind TEXT;

-- メモの種類（'phone' / 'email' / 'password' / 'other'）。
-- クライアントがアイコン・入力キーボード・マスクの有無を決めるためだけに使う。
ALTER TABLE tasks ADD COLUMN memo_type TEXT;

-- メモの値（コピー対象）。
ALTER TABLE tasks ADD COLUMN memo_value TEXT;
