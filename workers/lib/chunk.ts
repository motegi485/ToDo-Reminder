// D1 は 1 クエリあたりのバインド変数が約 100 個までのため、IN(...) 検索や
// batch の文数をこの単位で分割する。
export const CHUNK_SIZE = 50;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
