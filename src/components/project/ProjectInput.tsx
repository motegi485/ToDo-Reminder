import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useProjectNames } from '@/hooks/useProjects';
import { CONSTANTS } from '@/lib/constants';

interface Props {
  id?: string;
  value: string | null;
  onChange: (next: string | null) => void;
}

// メニューの特別な選択肢を表す内部値（実際のプロジェクト名と衝突しない予約文字列）
const NONE = '__NONE__';
const NEW = '__NEW__';

interface Item {
  key: string;
  label: string;
}

export function ProjectInput({ id, value, onChange }: Props) {
  const names = useProjectNames();
  // 「新規作成」モードかどうか。ダイアログを閉じると本コンポーネントは unmount され自動リセットされる
  const [creating, setCreating] = useState(false);

  const currentKey = creating ? NEW : value === null ? NONE : value;
  // 編集中タスクのプロジェクトが（一時的に）候補一覧へ未反映でも選択を保てるよう補う
  const showValueAsOption = !creating && value !== null && !names.includes(value);

  const items: Item[] = [{ key: NONE, label: 'その他' }];
  if (showValueAsOption) items.push({ key: value as string, label: value as string });
  for (const n of names) items.push({ key: n, label: n });
  items.push({ key: NEW, label: '＋ 新規作成' });

  const handleSelect = (key: string) => {
    if (key === NEW) {
      setCreating(true);
      onChange(null);
    } else if (key === NONE) {
      setCreating(false);
      onChange(null);
    } else {
      setCreating(false);
      onChange(key);
    }
  };

  return (
    <>
      <Dropdown id={id} items={items} currentKey={currentKey} onPick={handleSelect} />

      {creating && (
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value.length === 0 ? null : e.target.value)}
          placeholder="新しいプロジェクト名"
          maxLength={CONSTANTS.PROJECT_NAME_MAX_LENGTH}
          autoFocus
          className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        />
      )}
    </>
  );
}

interface PanelPos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

// カスタムドロップダウン。Modal / BottomSheet の overflow で見切れないよう、パネルはポータルで fixed 配置する
function Dropdown({
  id,
  items,
  currentKey,
  onPick,
}: {
  id?: string;
  items: Item[];
  currentKey: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    // 下に十分なスペースが無く上の方が広ければ上向きに開く
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(300, (openUp ? spaceAbove : spaceBelow) - margin * 2);
    setPos({
      left: r.left,
      width: r.width,
      top: openUp ? undefined : r.bottom + margin,
      bottom: openUp ? window.innerHeight - r.top + margin : undefined,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onDocClick = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // キャプチャフェーズで先取りし、ダイアログの Escape ハンドラまで届かせない（ドロップダウンだけ閉じる）
        e.stopPropagation();
        setOpen(false);
      }
    };
    const reposition = () => place();
    document.addEventListener('pointerdown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const currentLabel = items.find((i) => i.key === currentKey)?.label ?? '';

  return (
    <div className="relative">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors dark:bg-slate-900 ${
          open
            ? 'border-slate-400 ring-2 ring-slate-300/50 dark:border-slate-500 dark:ring-slate-600/40'
            : 'border-slate-300 hover:border-slate-400 dark:border-slate-600 dark:hover:border-slate-500'
        }`}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className="fixed z-50 overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
            style={{
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
          >
            {items.map((item) => {
              const selected = item.key === currentKey;
              const isNew = item.key === NEW;
              return (
                <div key={item.key}>
                  {isNew && <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onPick(item.key);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      selected
                        ? 'font-medium text-slate-900 dark:text-slate-100'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {selected && !isNew && (
                      <Check size={15} className="shrink-0 text-slate-500 dark:text-slate-400" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
