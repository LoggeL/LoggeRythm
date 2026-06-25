/* Spotifrei service worker — conservative offline support.
 *
 * Online behaviour is unchanged (network-first for navigations + API, so users
 * always get fresh content). Offline support kicks in only for:
 *   - immutable Next static chunks (cache-first; content-hashed → safe)
 *   - tracks the user explicitly DOWNLOADED (served from the sf-audio cache,
 *     with HTTP Range support sliced from the cached full body)
 *   - cached cover images for downloaded tracks
 *   - a last-good app shell, served only when the network is unreachable
 */
const VERSION = "sf-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const AUDIO = "sf-audio"; // unversioned — user downloads must persist across releases
const IMG = "sf-img";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("sf-v") && !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAudio(url) {
  return url.pathname.includes("/tracks/") && url.pathname.endsWith("/stream");
}
function isStatic(url) {
  return url.pathname.startsWith("/_next/static");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Downloaded audio: serve from cache (with Range), else go to network.
  if (url.origin === self.location.origin && isAudio(url)) {
    event.respondWith(handleAudio(req, url));
    return;
  }
  // Cross-origin cover images: serve cached copies when available.
  if (url.origin !== self.location.origin) {
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(url.pathname)) {
      event.respondWith(cacheFirst(req, IMG));
    }
    return;
  }
  // Immutable static assets: cache-first.
  if (isStatic(url)) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }
  // Navigations: network-first, fall back to a cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNav(req));
    return;
  }
  // Everything else (API, etc.): passthrough to the network.
});

async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
    return res;
  } catch {
    return hit || Response.error();
  }
}

async function networkFirstNav(req) {
  const shell = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) shell.put("/", res.clone());
    return res;
  } catch {
    return (await shell.match("/")) || (await shell.match(req)) || Response.error();
  }
}

async function handleAudio(req, url) {
  const key = url.origin + url.pathname;
  const c = await caches.open(AUDIO);
  const cached = await c.match(key);
  if (cached) return rangeFrom(req, cached);
  return fetch(req); // not downloaded → stream online
}

async function rangeFrom(req, cached) {
  const buf = await cached.arrayBuffer();
  const size = buf.byteLength;
  const range = req.headers.get("range");
  if (!range) {
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
      },
    });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end)) end = size - 1;
  end = Math.min(end, size - 1);
  const chunk = buf.slice(start, end + 1);
  return new Response(chunk, {
    status: 206,
    headers: {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(chunk.byteLength),
    },
  });
}
