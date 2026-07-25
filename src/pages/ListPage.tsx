import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { FAB } from '@/components/ui/FAB';
import { TaskFormDialog } from '@/components/task/TaskFormDialog';
import { ProjectGroup, emitProjectStatesChanged } from '@/components/project/ProjectGroup';
import { ProjectChips, type Selection } from '@/components/project/ProjectChips';
import { EmptyState } from '@/components/task/EmptyState';
import { SortMenu } from '@/components/task/SortMenu';
import { useProjectGroups } from '@/hooks/useProjects';
import { isExpanded, pruneProjectStates, toggleExpanded } from '@/lib/projectExpansion';
import type { Task } from '@/types';

export default function ListPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // プロジェクトチップの選択状態。永続化しない（リロードで「すべて」に戻る）。
  const [selected, setSelected] = useState<Selection>({ kind: 'all' });
  // focusTaskId のポーリング effect（[focusTaskId] のみに依存）から常に最新の選択状態を
  // 読むための ref。selected を変更する箇所は必ず setSelectedSynced を経由する（write-through）。
  const selectedRef = useRef<Selection>(selected);
  const setSelectedSynced = (next: Selection) => {
    selectedRef.current = next;
    setSelected(next);
  };

  // undefined = IndexedDB 読込中。空配列（本当にタスクなし）と区別し、
  // 起動時に EmptyState が一瞬表示されるのを防ぐ。
  const groups = useProjectGroups();
  const loading = groups === undefined;

  // groups の参照は毎レンダー変わるため、effect の依存に含めず ref 経由で最新値を読む。
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // 削除済みプロジェクトの展開状態（localStorage）を一覧の読込時に間引く。
  useEffect(() => {
    if (groups === undefined) return;
    pruneProjectStates(groups.map((g) => g.name));
    // 読込完了時の 1 回だけでよい（groups の参照は毎レンダー変わるため対象にしない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // 選択中プロジェクトが消滅した（タスク削除・完了や、リネームで別名になった）場合、
  // 「すべて」へ自動フォールバックする。groups はレンダー時点の値を使う（groupsRef ではない）。
  const selectedExists =
    selected.kind !== 'project' || groups === undefined || groups.some((g) => g.name === selected.name);
  useEffect(() => {
    if (!selectedExists) setSelectedSynced({ kind: 'all' });
    // setSelectedSynced は毎レンダー再生成されるが中身は安定（selectedRef + setSelected のみ参照）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExists]);

  // 通知タップのディープリンク（/?task=<id>）: 該当タスクのグループを特定し、
  // 「すべて」表示中は従来どおりそのグループを展開、絞り込み中はそのプロジェクトへ
  // チップを切り替える（filtered は常時展開のため toggleExpanded は不要）。
  // その後カードへスクロールして 2 秒間ハイライトする。処理後はパラメータを外す。
  const focusTaskId = searchParams.get('task');
  useEffect(() => {
    if (!focusTaskId) return;

    // filtered 切替時は「1グループのアンマウント＋別グループのマウント」を伴う重いコミットに
    // なりうるため、固定フレーム数ではなく要素が見つかるまで有界（20フレーム≒330ms）でリトライする。
    // finish() が呼ばれた直後に focusTaskId が null になり effect の cleanup が走るが、
    // このリトライは cleanup に紐付けない（紐付けるとハイライトが常に途中で消える）。
    const scrollToTaskWhenReady = (id: string, attempts = 20) => {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
        if (!el) {
          if (attempts > 0) scrollToTaskWhenReady(id, attempts - 1);
          return;
        }
        el.scrollIntoView({ block: 'center' });
        el.classList.add('task-focus-highlight');
        window.setTimeout(() => el.classList.remove('task-focus-highlight'), 2000);
      });
    };

    const tryFocus = (): boolean => {
      const currentGroups = groupsRef.current;
      if (!currentGroups) return false;
      const group = currentGroups.find((g) => g.tasks.some((t) => t.id === focusTaskId));
      if (!group) return false;

      const currentSelection = selectedRef.current;
      if (currentSelection.kind === 'all') {
        // 「すべて」表示中は従来どおりアコーディオンを展開するだけ（絞り込みへは切り替えない）。
        if (!isExpanded(group.name)) {
          toggleExpanded(group.name);
          emitProjectStatesChanged();
        }
      } else if (!(currentSelection.kind === 'project' && currentSelection.name === group.name)) {
        // 絞り込み中で対象と不一致 → チップを対象グループへ切り替える。
        setSelectedSynced({ kind: 'project', name: group.name });
      }

      scrollToTaskWhenReady(focusTaskId);
      return true;
    };

    const finish = () => {
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      setSearchParams({}, { replace: true });
    };

    if (tryFocus()) {
      finish();
      return;
    }

    // タスクがまだ手元にない（読込中、または他端末発の通知で未同期）場合、
    // 短い間隔で再試行する。他端末で削除済みなど恒久的に見つからない場合に
    // 備えてタイムアウトで諦め、パラメータだけは必ず外す。
    const pollId = window.setInterval(() => {
      if (tryFocus()) finish();
    }, 500);
    const timeoutId = window.setTimeout(finish, 20000);

    return () => {
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
    };
    // groups は groupsRef、selected は selectedRef 経由で参照するため依存に含めない
    // （focusTaskId のみで開始・再開。20秒ポーリングを選択切替のたびに再起動させないため）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId]);

  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (task: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  // 単一プロジェクトで絞り込み中に FAB から新規作成した場合のプロジェクト名初期値。
  const initialProject = selected.kind === 'project' ? selected.name : null;

  // ヘッダーのサマリー。groups は毎レンダー新しい配列になるため useMemo は無意味。
  // 要素数はプロジェクト数程度なので単純な集計で足りる。
  const summary = (() => {
    if (groups === undefined || groups.length === 0) return '\u00A0';
    const remaining = groups.reduce((sum, g) => sum + g.remaining, 0);
    if (remaining === 0) return 'すべて完了しています';
    const projectCount = groups.filter((g) => g.name !== null).length;
    return projectCount > 0
      ? `未完了 ${remaining}件・${projectCount}プロジェクト`
      : `未完了 ${remaining}件`;
  })();

  return (
    <div className="space-y-4 pb-24">
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex-none flex h-9 w-9 items-center justify-center rounded-xl
                     bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-900"
        >
          <ListTodo className="h-[1.125rem] w-[1.125rem]" />
        </span>
        <div className="min-w-[7.5rem] flex-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight whitespace-nowrap">
            タスク一覧
          </h1>
          <p className="mt-0.5 text-xs leading-tight text-slate-500 dark:text-slate-400">
            {summary}
          </p>
        </div>
        <div className="flex min-w-0 shrink [&>select]:min-w-0 [&>select]:w-full [&>select]:text-ellipsis">
          <SortMenu />
        </div>
      </header>

      {groups !== undefined && groups.length > 0 && (
        <ProjectChips groups={groups} selected={selected} onSelect={setSelectedSynced} />
      )}

      {groups === undefined ? null : groups.length === 0 ? (
        <EmptyState />
      ) : (
        groups.map((g, index) => {
          const visible =
            selected.kind === 'all' || (selected.kind === 'project' && selected.name === g.name);
          if (!visible) return null;
          return (
            <ProjectGroup
              key={g.name ?? '__null__'}
              name={g.name}
              tasks={g.tasks}
              onEdit={handleEdit}
              isFirstGroup={index === 0}
              variant={selected.kind === 'all' ? 'accordion' : 'filtered'}
            />
          );
        })
      )}

      <FAB onClick={handleAdd} />
      <TaskFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        initialProject={initialProject}
      />
    </div>
  );
}
