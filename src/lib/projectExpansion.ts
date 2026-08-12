import { storage } from './storage';
import { CONSTANTS } from './constants';

// 未分類グループのキー。この名前はプロジェクト名として入力できない（validation.ts）。
// 状態は Map で持つ: 素のオブジェクトだと、ユーザーが付けた '__proto__' という
// プロジェクト名が Object.prototype と衝突し、`key in states` が常に true・
// `states[key] = v` は own property を作らない（= その 1 件だけ状態を保存できない）。
function projectKey(name: string | null): string {
  return name ?? CONSTANTS.PROJECT_RESERVED_KEY;
}

export function isExpanded(name: string | null): boolean {
  const key = projectKey(name);
  const states = storage.getProjectStates();
  const saved = states.get(key);
  if (saved !== undefined) return saved;
  return storage.getProjectDefaultExpanded();
}

export function toggleExpanded(name: string | null): boolean {
  const key = projectKey(name);
  const states = storage.getProjectStates();
  const current = states.get(key) ?? storage.getProjectDefaultExpanded();
  const next = !current;
  states.set(key, next);
  storage.setProjectStates(states);
  return next;
}

/**
 * プロジェクト名変更時、展開状態を旧名キーから新名キーへ引き継ぐ。
 * 新名側に既存の状態があれば（＝統合先が既存プロジェクト）そちらを優先して残す
 * （統合後に画面上残るのは統合先グループであり、その展開状態を尊重するため）。
 */
export function migrateProjectState(oldName: string, newName: string): void {
  const states = storage.getProjectStates();
  const oldKey = projectKey(oldName);
  const saved = states.get(oldKey);
  if (saved === undefined) return;
  const newKey = projectKey(newName);
  if (!states.has(newKey)) states.set(newKey, saved);
  states.delete(oldKey);
  storage.setProjectStates(states);
}

export function applyDefaultExpansion(newDefault: boolean, activeProjectNames: Array<string | null>): void {
  // 現存するプロジェクトのキーだけで作り直す。既存キーを引き継ぐと、削除済み
  // プロジェクトの状態が localStorage に永久に残り続ける。
  const states = new Map<string, boolean>();
  for (const name of activeProjectNames) states.set(projectKey(name), newDefault);
  storage.setProjectStates(states);
  storage.setProjectDefaultExpanded(newDefault);
}

/** 存在しなくなったプロジェクトの展開状態を間引く。変化がある時だけ書き込む。 */
export function pruneProjectStates(activeProjectNames: Array<string | null>): void {
  const states = storage.getProjectStates();
  const keep = new Set(activeProjectNames.map(projectKey));
  let removed = false;
  for (const key of [...states.keys()]) {
    if (!keep.has(key)) {
      states.delete(key);
      removed = true;
    }
  }
  if (removed) storage.setProjectStates(states);
}
