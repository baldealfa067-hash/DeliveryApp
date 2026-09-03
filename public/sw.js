/* Bornaal Service Worker
 * Objetivo atual: registo PWA (instalação em "Adicionar ao ecrã principal").
 * Estrutura preparada para notificações push (eventos push/notificationclick).
 * NOTA: não faz cache de assets de propósito — os ficheiros têm hash e o
 * index.html é no-cache; cache aqui reintroduziria erros de chunk obsoleto.
 */
const CACHE_VERSION = "bornaal-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Bornaal", body: event.data.text() };
  }
  const options = {
    body: data.body || "Tem uma novidade na Bornaal.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/", whatsapp_url: data.whatsapp_url || "" },
  };
  event.waitUntil(self.registration.showNotification(data.title || "Bornaal", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const wa = event.notification.data?.whatsapp_url;
  if (wa) {
    event.waitUntil(self.clients.openWindow(wa));
    return;
  }
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          await client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});