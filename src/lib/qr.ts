/**
 * QR コードの生成。qrcode-generator を動的 import して、真偽値の行列だけを返す。
 *
 * 描画方法（SVG / Canvas / img）はこの層で決めない。呼び出し側が行列から好きな形で
 * 描く（SyncQrCode.tsx は 1 本の <path> にまとめたインライン SVG にしている）。
 *
 * 動的 import にしているのは、QR を使うのが設定画面だけであり、初期ロードに
 * 載せたくないため。Vite が別チャンクに分ける。**CDN からは読まない**
 * （オフラインで表示できる必要がある）。
 */

/** QR のモジュール行列。`matrix[row][col]` が true なら黒。 */
export type QrMatrix = readonly (readonly boolean[])[];

/**
 * 同期コードなどの英数字文字列を QR の行列に変換する。
 *
 * @param text QR 英数字モードの文字集合（`0-9 A-Z $%*+-./:` と半角空白）に収まる文字列。
 *             同期コードの文字集合（`CONSTANTS.SYNC_CODE_CHARS`）はこの部分集合。
 */
export async function buildQrMatrix(text: string): Promise<QrMatrix> {
  const { default: qrcode } = await import('qrcode-generator');

  // 型番は 0（自動）、誤り訂正は Q（約 25%）。画面 → カメラの読み取りは
  // 反射や手ブレで欠けやすいので、L/M ではなく Q を選ぶ。
  const qr = qrcode(0, 'Q');

  // モードを明示する。既定の Byte モードだと 12 バイトが version 1-Q の上限
  // 11 バイトを超えて version 2（25x25）に上がり、無駄に密度が高くなる。
  // 英数字モードなら version 1-Q の容量は 16 文字なので 12 文字が 21x21 に収まる。
  qr.addData(text, 'Alphanumeric');
  qr.make();

  const count = qr.getModuleCount();
  const matrix: boolean[][] = [];
  for (let row = 0; row < count; row++) {
    const line: boolean[] = new Array<boolean>(count);
    for (let col = 0; col < count; col++) {
      line[col] = qr.isDark(row, col);
    }
    matrix.push(line);
  }
  return matrix;
}

/**
 * 行列を SVG の path データに変換する。黒モジュール 1 つを 1 単位の正方形として描く。
 * `viewBox` は `0 0 (count + margin*2) (count + margin*2)` を想定。
 */
export function qrMatrixToPath(matrix: QrMatrix, margin: number): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.length; row++) {
    const line = matrix[row]!;
    for (let col = 0; col < line.length; col++) {
      if (line[col]) parts.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return parts.join('');
}
