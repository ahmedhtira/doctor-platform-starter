/* Dewini Pro uses a network-only service worker.
 *
 * Full document navigations are intentionally NOT intercepted.
 * Authentication, redirects and Next.js document loading must remain
 * under the browser's native networking stack.
 *
 * Patient and dashboard responses are never written to an offline cache.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    event.request.mode === "navigate"
  ) {
    return;
  }

  event.respondWith(fetch(event.request));
});
