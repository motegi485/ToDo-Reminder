// D1 は 1 クエリあたりのバインド変数が約 100 個までのため、IN(...) 検索や
// batch の文数をこの単位で分割する。
//
// 40 にしている理由（50 ではなく）: D1 Free の上限は「50 クエリ / Worker 呼び出し」で、
// push 1 回の発行文数は `1(users upsert) + ceil(N/CHUNK) (既存行 SELECT) + N (batch の文)`
// になる。N=50 だと 52 文となり、batch 内の文が個別にカウントされる場合は上限を超える
// （個別カウントかどうかは公式ドキュメントに記載が無い）。N=40 なら 42 文で、
// どちらの解釈でも安全側に収まる。クライアント側の PUSH_CHUNK_SIZE と揃えること。
export const CHUNK_SIZE = 40;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
