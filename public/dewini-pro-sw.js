/* Dewini Pro service worker.
 *
 * No application requests are intercepted.
 * Authentication, Next.js navigation and patient/staff traffic always use
 * the browser's native networking stack.
 *
 * The worker remains registered for PWA lifecycle support.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
