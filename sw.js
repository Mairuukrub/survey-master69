// Offline shell: the form keeps working without signal; answers live in localStorage until sent.
const CACHE = "m69-v1";
const SHELL = ["./", "./index.html", "./style.css", "./questions.js", "./app.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("google.com") || url.hostname.endsWith("googleusercontent.com")) return;  // never cache the data API
  // network first for our own files (so updates arrive), cache fallback offline; fonts cache-first
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (url.hostname.includes("fonts.g")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })));
  }
});
