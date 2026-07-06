import { storage } from './storage';
import { CONSTANTS } from './constants';

function projectKey(name: string | null): string {
  return name ?? CONSTANTS.PROJECT_RESERVED_KEY;
}

export function isExpanded(name: string | null): boolean {
  const key = projectKey(name);
  const states = storage.getProjectStates();
  if (key in states) return states[key]!;
  return storage.getProjectDefaultExpanded();
}

export function toggleExpanded(name: string | null): boolean {
  const key = projectKey(name);
  const states = storage.getProjectStates();
  const current = key in states ? states[key]! : storage.getProjectDefaultExpanded();
  const next = !current;
  states[key] = next;
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
  if (!(oldKey in states)) return;
  const newKey = projectKey(newName);
  if (!(newKey in states)) states[newKey] = states[oldKey]!;
  delete states[oldKey];
  storage.setProjectStates(states);
}

export function applyDefaultExpansion(newDefault: boolean, activeProjectNames: Array<string | null>): void {
  // 現存するプロジェクトのキーだけで作り直す。既存キーを引き継ぐと、削除済み
  // プロジェクトの状態が localStorage に永久に残り続ける。
  const states: Record<string, boolean> = {};
  for (const name of activeProjectNames) states[projectKey(name)] = newDefault;
  storage.setProjectStates(states);
  storage.setProjectDefaultExpanded(newDefault);
}

/** 存在しなくなったプロジェクトの展開状態を間引く。変化がある時だけ書き込む。 */
export function pruneProjectStates(activeProjectNames: Array<string | null>): void {
  const states = storage.getProjectStates();
  const keep = new Set(activeProjectNames.map(projectKey));
  let removed = false;
  for (const key of Object.keys(states)) {
    if (!keep.has(key)) {
      delete states[key];
      removed = true;
    }
  }
  if (removed) storage.setProjectStates(states);
}
