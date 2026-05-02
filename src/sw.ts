/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

interface PushPayload {
  title: string;
  body: string;
  task_id?: string;
  due_date?: string;
}

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
      badge: '/icons/icon.svg',
      tag: data.task_id,
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
