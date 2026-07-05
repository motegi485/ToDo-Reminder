/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { PrecacheEntry } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

interface PushPayload {
  title: string;
  body: string;
  task_id?: string;
  due_date?: string;
}

// ビルド時に注入されるアプリシェル一覧をプリキャッシュし、オフラインのコールド起動でも
// 画面が開けるようにする。autoUpdate なので新ビルドのアセットは次回起動で差し替わる。
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// SPA: どのパス（/report, /settings 等）へ直接アクセスしてもキャッシュ済みの index.html を返す。
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data: PushPayload = { title: 'リマインダー', body: '' };
  try {
    data = event.data?.json() ?? data;
  } catch {
    /* fallthrough */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // 同じタスクの通知は最新 1 件に集約する。task_id が無い異常ペイロードは
      // 一意なタグを振り、互いに置き換え合わないようにする。
      tag: data.task_id ?? `reminder-${Date.now()}`,
      data: { task_id: data.task_id },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = (event.notification.data as { task_id?: string } | null)?.task_id;
  const url = taskId ? `/?task=${taskId}` : '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          await (client as WindowClient).focus();
          (client as WindowClient).navigate?.(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
