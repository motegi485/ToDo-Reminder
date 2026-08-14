import { KeyRound, Mail, Phone, StickyNote, type LucideIcon } from 'lucide-react';
import type { MemoType } from '@/types';

/**
 * メモの種類ごとの表示・入力定義。
 *
 * 種類はクライアント専用の概念で、サーバーは memo_type を解釈しない
 * （color と同じ素通し扱い。docs/invariants.md I-6）。種類を増やすときは
 * ここに 1 行足すだけでよく、サーバー側の変更は不要。
 */
export interface MemoTypeDef {
  value: MemoType;
  label: string;
  icon: LucideIcon;
  /** 値の入力欄に渡す inputMode。端末のソフトキーボードが切り替わる。 */
  inputMode: 'tel' | 'email' | 'text';
  /** 一覧で値を伏せ字にするか。 */
  masked: boolean;
}

export const MEMO_TYPES: readonly MemoTypeDef[] = [
  { value: 'phone', label: '電話', icon: Phone, inputMode: 'tel', masked: false },
  { value: 'email', label: 'メール', icon: Mail, inputMode: 'email', masked: false },
  { value: 'password', label: 'パスワード', icon: KeyRound, inputMode: 'text', masked: true },
  { value: 'other', label: 'その他', icon: StickyNote, inputMode: 'text', masked: false },
];

export const DEFAULT_MEMO_TYPE: MemoType = 'other';

const MEMO_TYPE_MAP: ReadonlyMap<MemoType, MemoTypeDef> = new Map(
  MEMO_TYPES.map((t) => [t.value, t]),
);

/**
 * 種類の定義を引く。未知の値（新しいクライアントが作ったメモを古い版で開いた場合など）は
 * 「その他」へフォールバックし、値が読めなくなることを防ぐ。
 */
export function memoTypeDef(value: MemoType | null | undefined): MemoTypeDef {
  const found = value ? MEMO_TYPE_MAP.get(value) : undefined;
  return found ?? MEMO_TYPE_MAP.get(DEFAULT_MEMO_TYPE)!;
}

/** 一覧に出す伏せ字。実際の文字数を漏らさないよう長さは固定する。 */
export const MASKED_PLACEHOLDER = '••••••••';
