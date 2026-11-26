// Potomac HQ's service worker (quality of life, 2026-11-25): it lets HQ be
// installed on a phone's home screen, and shows HQ's alerts there. It keeps
// no copies of pages: HQ always loads fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// An alert from HQ: { title, body, url }. Anything else is ignored.
self.addEventListener("push", (event) => {
  let alert = null;
  try {
    alert = event.data ? event.data.json() : null;
  } catch {
    alert = null;
  }
  if (!alert || typeof alert.title !== "string") return;
  const url = typeof alert.url === "string" && alert.url.startsWith("/") && !alert.url.startsWith("//") ? alert.url : "/";
  event.waitUntil(
    self.registration.showNotification(alert.title.slice(0, 120), {
      body: typeof alert.body === "string" ? alert.body.slice(0, 300) : "",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: typeof alert.tag === "string" ? alert.tag : undefined,
      data: { url },
    }),
  );
});

// Tapping one opens HQ at its page, in a window already open if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const one of windows) {
        if (one.url.startsWith(self.location.origin) && "focus" in one) {
          one.navigate(url);
          return one.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
