const CACHE = 'tv-next-shell-v1';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tv-next-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.headers.has('Authorization')) return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const allowed = ASSETS.map(path => new URL(path, self.registration.scope).href);
  if (event.request.mode !== 'navigate' && !allowed.includes(url.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const clone = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, clone)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match(new URL('./index.html', self.registration.scope).href) : null) || new Response('Offline', { status: 503 })));
});
function appUrl(value) {
  try {
    const url = new URL(value || self.registration.scope);
    return url.href.startsWith(self.registration.scope) ? url.href : self.registration.scope;
  } catch { return self.registration.scope; }
}
self.addEventListener('push', event => {
  let data;
  try { data = event.data?.json() || {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title : 'テレビのつづき', {
    body: typeof data.body === 'string' ? data.body : '次回の放送情報を確認してください。',
    tag: typeof data.tag === 'string' ? data.tag : 'tv-next',
    icon: new URL('./icons/icon-192.png', self.registration.scope).href,
    data: { url: appUrl(data.url) },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = appUrl(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(client => client.url.startsWith(self.registration.scope));
    if (client) { await client.navigate(url); return client.focus(); }
    return self.clients.openWindow(url);
  }));
});
