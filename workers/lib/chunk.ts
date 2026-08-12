// D1 は 1 クエリあたりのバインド変数が約 100 個までのため、IN(...) 検索や
// batch の文数をこの単位で分割する。
//
// 40 にしている理由（50 ではなく）: D1 Free の上限は「50 クエリ / Worker 呼び出し」で、
// push 1 回の発行文数は `1(users upsert) + ceil(N/CHUNK) (既存行 SELECT) + N (batch の文)`
// になる。この CHUNK=40 のもとで N=50 を受け付けると `1 + 2 + 50 = 53` 文となり、
// batch 内の文が個別にカウントされる場合は上限を超える（個別カウントかどうかは公式
// ドキュメントに記載が無い）。N=40 なら 42 文で、どちらの解釈でも安全側に収まる。
// クライアント側の PUSH_CHUNK_SIZE と、サーバーの LIMITS.MAX_TASKS_PER_PUSH に揃えること。
export const CHUNK_SIZE = 40;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
