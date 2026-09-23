'use strict';

// Replaced by build_pwa.py. Only the generated public app files are cached.
const VERSION = "3384e0d4a776b298a94d";
const PRECACHE_PATHS = [
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./index.html",
  "./manifest.webmanifest",
  "./runtime.js",
  "./sw.js",
  "./vendor/lucide-LICENSE.txt",
  "./vendor/lucide.min.js"
];
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = 'craftpocket-pwa:' + encodeURIComponent(SCOPE.href) + ':';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const PRECACHE_URLS = PRECACHE_PATHS.map(path => new URL(path, SCOPE).href);
const ALLOWED_URLS = new Set(PRECACHE_URLS);
const INDEX_URL = new URL('./index.html', SCOPE).href;

async function cacheReady() {
  if (!(await caches.keys()).includes(CACHE_NAME)) return false;
  const cache = await caches.open(CACHE_NAME);
  const entries = await Promise.all(PRECACHE_URLS.map(url => cache.match(url)));
  return entries.every(response => !!response && response.ok);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // addAll rejects HTTP failures and commits its entries as one batch. A
    // failed install never removes an older, working offline app version.
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(PRECACHE_URLS.map(url => new Request(url, {
        cache: 'reload', credentials: 'same-origin'
      })));
      if (!(await cacheReady())) throw new Error('Offline cache is incomplete');
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // Updates wait for an explicit SKIP_WAITING message from runtime.js.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Preserve the previous cache if storage was evicted after installation.
    if (!(await cacheReady())) return;
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil((async () => {
      if (await cacheReady()) await self.skipWaiting();
    })());
  } else if (event.data?.type === 'GET_CACHE_STATUS') {
    event.waitUntil((async () => {
      const message = {type: 'CACHE_STATUS', ready: await cacheReady(), version: VERSION};
      if (event.ports?.[0]) event.ports[0].postMessage(message);
      else if (event.source) event.source.postMessage(message);
    })());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  // The app uses hash navigation. Do not intercept unrelated paths, API calls,
  // uploads, or future resources that were not explicitly shipped in this app.
  const shellNavigation = request.mode === 'navigate'
    && (url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname);
  if (!shellNavigation && !ALLOWED_URLS.has(url.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(shellNavigation ? INDEX_URL : url.href);
    if (cached) return cached;
    // No runtime cache writes: fetched content and user data never enter it.
    return fetch(request);
  })());
});
