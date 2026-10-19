'use strict';
// Only this app's shell is cached. User photos/records never enter network/cache requests.
const CACHE = 'kozakura-biyori-shell-v1.1.3';
const BASE = new URL('./', self.location.href);
const SHELL = ['', 'index.html', 'style.css', 'app.js', 'model.js', 'art.svg', 'bird.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL.map(path => new URL(path, BASE).href));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('kozakura-biyori-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match(new URL('index.html', BASE).href).then(cached => cached || fetch(event.request)));
    return;
  }
  if (SHELL.some(path => new URL(path, BASE).href === url.href)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
