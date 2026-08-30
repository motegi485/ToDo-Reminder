import { useSyncExternalStore } from 'react';
import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from '@/lib/sync';

/**
 * 同期の状態を購読する。`sync.ts` のモジュールスコープが唯一の実体で、
 * `runSync()` の各分岐が更新する。
 *
 * `getSyncStatus()` は変化したときだけ新しい参照を返す（`setStatus` が
 * オブジェクトを作り直す）ので、`useSyncExternalStore` の要求を満たす。
 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}
