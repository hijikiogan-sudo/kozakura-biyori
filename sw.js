'use strict';
// Only this app's shell is cached. User photos/records never enter network/cache requests.
const CACHE = 'kozakura-biyori-shell-v1.7.1';
const BASE = new URL('./', self.location.href);
const SHELL = ['', 'index.html', 'style.css', 'app.js', 'platform.js', 'model.js', 'art.svg', 'bird.svg', 'manifest.webmanifest', 'icon-duo-192.png', 'icon-duo-512.png', 'apple-touch-icon-duo.png',"birds/lovebird-green.svg","birds/lovebird-yellow.svg","birds/lovebird-aqua.svg","birds/lovebird-blue.svg","birds/lovebird-white.svg","birds/lovebird-violet.svg","birds/button-green.svg","birds/button-yellow.svg","birds/button-aqua.svg","birds/button-blue.svg","birds/button-white.svg","birds/button-violet.svg", "covers/lovebird-green.svg", "covers/lovebird-yellow.svg", "covers/lovebird-aqua.svg", "covers/lovebird-blue.svg", "covers/lovebird-white.svg", "covers/lovebird-violet.svg", "covers/button-green.svg", "covers/button-yellow.svg", "covers/button-aqua.svg", "covers/button-blue.svg", "covers/button-white.svg", "covers/button-violet.svg"];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL.map(path => new Request(new URL(path, BASE).href, {cache:'reload'})));
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

self.addEventListener('message', event => {
  if (event.data?.type === 'GET_APP_VERSION') event.ports[0]?.postMessage({version:'1.7.1'});
});
