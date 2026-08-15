import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { isValidSyncCode, normalizeSyncCode } from '@/lib/syncCode';

/**
 * 解析に使う最大辺長（px）。毎フレーム ImageData 全体を走査するので、
 * カメラの実解像度（1080p 以上になりうる）のままだと端末が発熱する。
 * QR は 21x21 モジュールなので 480px もあれば十分に読める。
 */
const ANALYZE_MAX_EDGE = 480;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 妥当な同期コードを読み取ったときだけ呼ばれる（ハイフン無しの正規化済み文字列）。 */
  onDetected: (code: string) => void;
}

/** getUserMedia の失敗理由を、次にすべきことが分かる日本語にする。 */
function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'カメラの使用が許可されていません。ブラウザまたは端末の設定でこのサイトのカメラを許可してください。許可できない場合も、コードを手入力すれば同期できます。';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'カメラが見つかりませんでした。コードを手入力してください。';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'カメラを他のアプリが使用中の可能性があります。ほかのアプリを閉じてから、もう一度お試しください。';
    case 'OverconstrainedError':
      return '利用できるカメラが見つかりませんでした。コードを手入力してください。';
    default:
      return `カメラを起動できませんでした${name ? `（${name}）` : ''}。コードを手入力してください。`;
  }
}

/**
 * カメラで QR を読み取り、同期コードを取り出す。
 *
 * **このコンポーネントは同期を実行しない。** 読み取った値を `onDetected` で返すだけで、
 * 実際の切り替えは呼び出し側が既存の確認ダイアログ → `switchSyncCode()` の経路で行う
 * （switchSyncCode() の保全ロジックを迂回しないため。docs/sync.md を参照）。
 *
 * 映像は端末内の <canvas> で処理するだけで、どこにも送信しない。
 */
export function SyncQrScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** 妥当でない QR を読んだときの案内。読み取りは止めずに出し続ける。 */
  const [wrongQr, setWrongQr] = useState(false);

  // onDetected は親で毎レンダー再生成されうるが、この effect は open でだけ張り直したい
  // （依存に入れるとカメラが起動し直してしまう）。最新の関数を ref 経由で読む。
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setReady(false);
    setWrongQr(false);

    // この effect の実行が有効かどうか。StrictMode の二重実行や、起動処理の途中で
    // 閉じられた場合に、後から届いた stream を確実に捨てるために使う。
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // カメラのトラックを止め損ねるとインジケータが点いたままになる。
    // 正常終了・エラー・アンマウントのすべてでここを通す。
    const stop = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const start = async () => {
      // 非セキュアコンテキストでは navigator.mediaDevices ごと存在しない。
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(
          'この環境ではカメラを使えません（HTTPS でのみ利用できます）。コードを手入力してください。',
        );
        return;
      }

      let jsQR: typeof import('jsqr').default;
      try {
        ({ default: jsQR } = await import('jsqr'));
      } catch (err) {
        console.error('[SyncQrScanner] jsQR の読み込みに失敗:', err);
        setError(
          '読み取り機能を読み込めませんでした。オンラインで一度アプリを開き直すか、コードを手入力してください。',
        );
        return;
      }
      if (cancelled) return;

      try {
        // facingMode は ideal にする。exact にすると背面カメラの無い PC で
        // OverconstrainedError になり、前面カメラでも読めるはずの場面で失敗する。
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (err) {
        console.error('[SyncQrScanner] getUserMedia に失敗:', err);
        if (!cancelled) setError(describeCameraError(err));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      // React の muted は属性として確実に反映されないことがある。iOS Safari は
      // muted + playsInline でないとインライン再生してくれないので明示的に立てる。
      video.muted = true;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (err) {
        // 自動再生が拒否されても、下のループは readyState を見てから描くので致命的ではない。
        console.warn('[SyncQrScanner] video.play() が拒否された:', err);
      }
      if (cancelled) return;
      setReady(true);

      const tick = () => {
        if (cancelled) return;
        raf = requestAnimationFrame(tick);

        const v = videoRef.current;
        if (!v || !ctx) return;
        if (v.readyState < v.HAVE_CURRENT_DATA) return;
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (!vw || !vh) return;

        const scale = Math.min(1, ANALYZE_MAX_EDGE / Math.max(vw, vh));
        const cw = Math.max(1, Math.round(vw * scale));
        const ch = Math.max(1, Math.round(vh * scale));
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;

        ctx.drawImage(v, 0, 0, cw, ch);
        const image = ctx.getImageData(0, 0, cw, ch);
        // QR は白地に黒。反転探索は不要なので dontInvert にして走査量を半分にする。
        const result = jsQR(image.data, cw, ch, { inversionAttempts: 'dontInvert' });
        if (!result) return;

        const code = normalizeSyncCode(result.data);
        if (!isValidSyncCode(code)) {
          // 他アプリの QR を写しただけの可能性が高い。閉じずに案内だけ出して読み続ける。
          // 同じ値の setState は React 側で無視されるので、毎フレーム呼んでも再描画されない。
          setWrongQr(true);
          return;
        }
        stop();
        onDetectedRef.current(code);
      };
      raf = requestAnimationFrame(tick);
    };

    void start();
    return stop;
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} ariaLabel="QR を読み取る">
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">QR を読み取る</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="-m-2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="block aspect-square w-full object-cover"
              />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                  カメラを起動しています...
                </div>
              )}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              もう一方の端末の設定画面で「QR を表示」を押し、その QR を枠に収めてください。
            </p>
            {wrongQr && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                このアプリの同期コードではない QR を読み取りました。もう一方の端末の同期コードの QR を写してください。
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
