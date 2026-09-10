/* =========================================================================
   STUDY TRACK — service worker

   This exists for one reason: reminders. It deliberately does NOT cache
   the app. The crew view is meant to be live, and a stale cached app.js
   is a far worse bug than a slow first load.
   ========================================================================= */
"use strict";

self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }

  event.waitUntil(self.registration.showNotification(d.title || "Study Track", {
    body:  d.body || "Time to put something on the board.",
    icon:  "favicon.svg",
    badge: "favicon.svg",
    /* One tag per kind, so a second nudge replaces the first rather than
       stacking up a wall of banners nobody reads. */
    tag:   "studytrack-" + (d.kind || "nudge"),
    renotify: true,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL((event.notification.data && event.notification.data.url) || "./",
                        self.registration.scope).href;
    /* If the app is already open somewhere, focus that instead of piling
       up another tab. */
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
