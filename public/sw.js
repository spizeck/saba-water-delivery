/**
 * Saba Water Delivery — lightweight service worker.
 *
 * Strategy:
 *  - Keep a single offline fallback page so a full reload while offline shows
 *    a helpful message instead of a browser error.
 *  - Cache hashed static assets (JS/CSS/images) at runtime so the app shell
 *    can render quickly, but never cache API responses or pages that contain
 *    user-specific data.
 *  - Use network-first for navigation requests so the latest content is
 *    always served when connected.
 */

const STATIC_CACHE = "saba-water-static-v1";
const OFFLINE_PAGE = "/offline.html";
const MAX_ASSETS = 60;

const PRECACHE = [OFFLINE_PAGE];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== STATIC_CACHE) {
              return caches.delete(key);
            }
            return undefined;
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isSameOrigin(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

function isAssetRequest(request) {
  const url = new URL(request.url);
  const assetExtensions = /\.(js|css|png|jpg|jpeg|svg|gif|webp|ico|woff2|ttf|otf)$/;
  return (
    request.method === "GET" &&
    isSameOrigin(request) &&
    assetExtensions.test(url.pathname) &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.includes("__nextjs")
  );
}

function isNavigationRequest(request) {
  return request.mode === "navigate" && request.method === "GET";
}

async function trimCache() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_ASSETS) {
    const toDelete = keys.slice(0, keys.length - MAX_ASSETS);
    await Promise.all(toDelete.map((request) => cache.delete(request)));
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Never intercept cross-origin or non-GET requests.
  if (request.method !== "GET" || !isSameOrigin(request)) {
    return;
  }

  // Never cache authentication/session endpoints or server actions.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/cron/")) {
    return;
  }

  if (isAssetRequest(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              const clone = networkResponse.clone();
              caches.open(STATIC_CACHE).then((cache) => {
                cache.put(request, clone);
                void trimCache();
              });
            }
            return networkResponse;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      }),
    );
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() =>
          caches.match(OFFLINE_PAGE).then((fallback) => fallback || new Response("Offline", { status: 503 })),
        ),
    );
  }
});
