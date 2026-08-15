import { useEffect, useState } from 'react';
import { buildQrMatrix, qrMatrixToPath, type QrMatrix } from '@/lib/qr';

/** QR の周囲に必要な余白（クワイエットゾーン）。規格上 4 モジュール以上。 */
const QUIET_ZONE = 4;

interface Props {
  /** QR に載せる値。ハイフン無しの同期コードを渡す。 */
  value: string;
}

/**
 * 同期コードの QR を表示する。**QR に載せるのは同期コードの生文字列だけ**で、
 * URL は載せない（同期コードは bearer credential なので、履歴・Referer・
 * アクセスログに残る経路を作らない。docs/security.md を参照）。
 */
export function SyncQrCode({ value }: Props) {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMatrix(null);
    setFailed(false);
    buildQrMatrix(value)
      .then((m) => {
        if (!cancelled) setMatrix(m);
      })
      .catch((err: unknown) => {
        console.error('[SyncQrCode] QR の生成に失敗:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const size = matrix ? matrix.length + QUIET_ZONE * 2 : 0;

  return (
    <div className="space-y-3">
      {/* QR は白地・黒モジュールが原則。ダークモードでも色を反転させない
          （反転した QR は読み取れないリーダーがある）。クワイエットゾーンも
          viewBox に含めて白で塗るので、この枠の中だけ常に白になる。 */}
      <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        {matrix ? (
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="block h-auto w-full"
            shapeRendering="crispEdges"
            role="img"
            /* コードそのものを読み上げさせない。値は上のテキストで確認できる。 */
            aria-label="同期コードの QR コード"
          >
            <rect width={size} height={size} fill="#ffffff" />
            <path d={qrMatrixToPath(matrix, QUIET_ZONE)} fill="#000000" />
          </svg>
        ) : (
          <div className="flex aspect-square items-center justify-center bg-white text-xs text-slate-400">
            {failed ? 'QR を生成できませんでした' : '生成中...'}
          </div>
        )}
      </div>
      <p className="text-xs text-amber-600 dark:text-amber-400">
        ⚠ このコードを知る人は、あなたのタスクとメモを読み書きできます。一度渡すと取り消せません。
      </p>
    </div>
  );
}
