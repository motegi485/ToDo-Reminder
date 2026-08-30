import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 例外時に描くもの。`reset` を押させると、もう一度 children の描画を試す。 */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** この値が変わったら自動で復帰を試みる（例: ルートが切り替わった）。 */
  resetKey?: string;
  /** ログに出すときの識別子。 */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * 描画中の例外をここで止める。
 *
 * ## なぜ要るか
 *
 * pull はサーバー応答を正規化せずに Dexie へ入れる（`sync.ts` の `db.tasks.put(serverTask)`）。
 * サーバーは中身を解釈しないので、**別バージョンのクライアントが書いた形や壊れた値が
 * そのまま描画まで届く経路が実在する**。React は描画中に投げられた例外を捕まえないと
 * ツリー全体をアンマウントするため、カード 1 枚の失敗で画面が真っ白になり、
 * 設定画面にも辿り着けない（＝再同期もデータ管理もできない）。ユーザーからは
 * 「データが全部消えた」ようにしか見えない。
 *
 * ## 通常時に DOM を足さないこと
 *
 * `render()` は例外が無いあいだ `this.props.children` を**そのまま**返す。ラッパー要素を
 * 足すと `useFlipReorder` が壊れる（あちらは `listRef` の**直接の子**の `data-task-id` を
 * 読んでいるため、間に 1 段挟まると並べ替えアニメーションが効かなくなる）。
 * fallback を描くときだけ要素が現れる。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
