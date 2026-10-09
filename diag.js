/* =========================================================================
   DIAG — a quiet note to ourselves when the app goes wrong on someone's
   machine
   -------------------------------------------------------------------------
   People report "stuck on loading", "Page Unresponsive", Chrome using
   gigabytes. None of that shows in the database logs, because it happens in
   the browser. This file notices it there and sends one small row
   (diag.sql) so we can see what actually happened:

     · slow-boot      the app took more than 10 s to open
     · boot-timeout   a start-up read stalled (app.js gave up and retried)
     · boot-session   the saved sign-in couldn't be read (another tab?)
     · boot-error     start-up failed outright
     · freeze         the page was blocked for 2 s or more, with the script
     · memory         the page's JavaScript passed 1 GB
     · error          the first uncaught error of the visit

   A normal visit sends nothing. When something does go wrong, it sends at
   most one report every 30 minutes from this browser, each a few hundred
   bytes. The database caps it again (5 an hour per person, 300 an hour in
   all, 5,000 rows, two weeks' keep). Nothing personal: no notes, subjects,
   names or to-dos, only timings, counts and error text.

   Loads before app.js so it hears errors from start-up. It uses sb and UID
   from app.js only when it sends, so it never holds anything up.
   ========================================================================= */
const DIAG = {
  t0: Date.now(),
  bootMs: null,
  errors: [],         /* first few uncaught errors, trimmed */
  freezes: [],        /* main-thread blocks of 2 s or more */
  sentKinds: new Set(),
  queue: null         /* a report waiting for sign-in */
};
const DIAG_GAP_MS = 30 * 60e3, DIAG_KEY = "studytrack-diag-last";

function diagSnapshot() {
  const m = performance.memory;
  let live = null, crew = null;
  try { live = DB.timers.length; crew = DB.profiles.length; } catch (e) { /* app.js not up yet */ }
  const c = navigator.connection || {};
  return {
    page_s: Math.round((Date.now() - DIAG.t0) / 1000),
    boot_ms: DIAG.bootMs,
    heap_mb: m ? Math.round(m.usedJSHeapSize / 1e6) : null,
    heap_limit_mb: m ? Math.round(m.jsHeapSizeLimit / 1e6) : null,
    nodes: document.getElementsByTagName("*").length,
    anims: document.getAnimations ? document.getAnimations().length : null,
    live, crew,
    tab: (document.querySelector('nav.tabs button[aria-selected="true"]') || { dataset: {} }).dataset.p || null,
    hidden: document.hidden,
    online: navigator.onLine,
    net: c.effectiveType || null,
    cores: navigator.hardwareConcurrency || null,
    device_gb: navigator.deviceMemory || null,
    screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    ua: (navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/) || [""])[0],
    os: /Mac/.test(navigator.platform) ? "mac" : /Win/.test(navigator.platform) ? "win" : /CrOS/.test(navigator.userAgent) ? "chromeos" : navigator.platform,
    errors: DIAG.errors.slice(0, 3),
    freezes: DIAG.freezes.slice(-3)
  };
}

/* One report. Quiet if it can't: diagnostics must never cause a problem. */
function diagReport(kind, detail) {
  try {
    if (DIAG.sentKinds.has(kind)) return;            /* once per kind per visit */
    let last = 0;
    try { last = Number(localStorage.getItem(DIAG_KEY)) || 0; } catch (e) { /* private window */ }
    if (Date.now() - last < DIAG_GAP_MS) return;     /* once per half hour per browser */
    if (typeof sb === "undefined" || !sb || typeof UID === "undefined" || !UID) {
      /* not signed in yet (or start-up is what's stuck): keep the first one
         and try again shortly */
      if (!DIAG.queue) { DIAG.queue = { kind, detail }; setTimeout(diagFlush, 20000); }
      return;
    }
    DIAG.sentKinds.add(kind);
    try { localStorage.setItem(DIAG_KEY, String(Date.now())); } catch (e) { /* private window */ }
    const p = Object.assign({ kind, detail: detail ? String(detail).slice(0, 300) : null }, diagSnapshot());
    Promise.resolve(sb.rpc("diag_report", { p })).then(() => {}, () => {});
  } catch (e) { /* never let this be the thing that breaks */ }
}
function diagFlush() {
  const q = DIAG.queue;
  DIAG.queue = null;
  if (q) diagReport(q.kind, q.detail);
}

/* app.js calls this once the app is on screen. */
function diagBootDone() {
  DIAG.bootMs = Date.now() - DIAG.t0;
  if (DIAG.bootMs > 10000) diagReport("slow-boot", `${Math.round(DIAG.bootMs / 1000)} s to open`);
}

window.addEventListener("error", e => {
  if (DIAG.errors.length < 3) DIAG.errors.push(`${String(e.message).slice(0, 160)} @${String(e.filename || "").split("/").pop()}:${e.lineno}`);
  diagReport("error", e.message);
});
window.addEventListener("unhandledrejection", e => {
  const r = e.reason;
  if (DIAG.errors.length < 3) DIAG.errors.push(("unhandled: " + String((r && r.message) || r)).slice(0, 180));
});

/* Freezes: Chrome's long-animation-frame entries say which script held the
   page; older browsers get the plain long-task duration. */
(function watchFreezes() {
  const note = (ms, script) => {
    DIAG.freezes.push({ ms: Math.round(ms), at_s: Math.round((Date.now() - DIAG.t0) / 1000), script });
    if (DIAG.freezes.length > 5) DIAG.freezes.shift();
    diagReport("freeze", `${Math.round(ms)} ms blocked${script ? " in " + script : ""}`);
  };
  try {
    new PerformanceObserver(list => list.getEntries().forEach(f => {
      if (f.duration < 2000) return;
      const s = (f.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
      note(f.duration, s ? `${s.sourceFunctionName || "?"} ${String(s.sourceURL || "").split("/").pop()}:${s.sourceCharPosition}` : null);
    })).observe({ type: "long-animation-frame", buffered: true });
  } catch (e) {
    try {
      new PerformanceObserver(list => list.getEntries().forEach(t => { if (t.duration >= 2000) note(t.duration, null); }))
        .observe({ type: "longtask", buffered: true });
    } catch (e2) { /* nothing to watch with */ }
  }
})();

/* Memory: a glance every five minutes, which costs nothing. */
setInterval(() => {
  const m = performance.memory;
  if (m && m.usedJSHeapSize > 1e9) diagReport("memory", `${Math.round(m.usedJSHeapSize / 1e6)} MB of JavaScript`);
}, 5 * 60e3);
