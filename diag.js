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
     · hang           the last visit died frozen, inside the functions named
                      (sent on the next visit, since a frozen page can't send)

   Freeze and hang reports name the app functions that were running, so a
   report says "renderHome 6200 ms > crewCards 6100 ms", not just "it froze".
   diagWatch() times the app's larger functions (short helpers count inside
   their callers); the cost is a clock read per call.

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
  slow: [],           /* app function calls of 50 ms or more: [name, startMs, ms, depth] */
  stack: [],          /* the timed app functions running right now */
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
  try { diagWatch(); } catch (e) { /* diagnostics only */ }
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
  const note = (ms, script, start) => {
    const inside = diagSlowIn(start, ms);
    DIAG.freezes.push({ ms: Math.round(ms), at_s: Math.round((Date.now() - DIAG.t0) / 1000), script, calls: inside });
    if (DIAG.freezes.length > 5) DIAG.freezes.shift();
    diagReport("freeze", `${Math.round(ms)} ms blocked${inside.length ? " in " + inside.slice(0, 3).join(" > ") : script ? " in " + script : ""}`);
  };
  try {
    new PerformanceObserver(list => list.getEntries().forEach(f => {
      if (f.duration < 2000) return;
      const s = (f.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
      note(f.duration, s ? `${s.sourceFunctionName || "?"} ${String(s.sourceURL || "").split("/").pop()}:${s.sourceCharPosition}` : null, f.startTime);
    })).observe({ type: "long-animation-frame", buffered: true });
  } catch (e) {
    try {
      new PerformanceObserver(list => list.getEntries().forEach(t => { if (t.duration >= 2000) note(t.duration, null, t.startTime); }))
        .observe({ type: "longtask", buffered: true });
    } catch (e2) { /* nothing to watch with */ }
  }
})();

/* Memory: a glance every five minutes, which costs nothing. */
setInterval(() => {
  const m = performance.memory;
  if (m && m.usedJSHeapSize > 1e9) diagReport("memory", `${Math.round(m.usedJSHeapSize / 1e6)} MB of JavaScript`);
}, 5 * 60e3);

/* -------------------------------------------------------------------------
   Which of our functions held the page
   -------------------------------------------------------------------------
   Chrome only says a freeze began where a database reply came back; the app
   code that ran after it is what we need. Each larger app function gets a
   thin wrapper that notes calls of 50 ms or more, and the freeze report
   lists the ones inside the frozen stretch, outermost first.

   A page frozen for good never gets to report. So while timed functions run,
   the outermost few are written down (localStorage, a few dozen bytes), and
   a heartbeat is written every 2 s. A visit that ends with its last note
   newer than its last heartbeat, and without the page closing normally,
   died frozen; the next visit sends that as "hang". */
const DIAG_SKIP = new Set(["plnPopAway"]);   /* removed as a listener by reference */
const DIAG_VISIT = Math.random().toString(36).slice(2, 10);
const DIAG_CRUMB = "studytrack-diag-c-", DIAG_BEAT = "studytrack-diag-b-";

function diagSlowIn(start, ms) {
  if (start == null) return [];
  return DIAG.slow.filter(c => c[1] < start + ms && c[1] + c[2] > start)
    .sort((a, b) => a[3] - b[3] || b[2] - a[2]).slice(0, 8)
    .map(c => `${c[0]} ${c[2]}ms`);
}

function diagCrumb() {
  try { localStorage.setItem(DIAG_CRUMB + DIAG_VISIT, JSON.stringify({ s: DIAG.stack.slice(0, 4).join(" > "), t: Date.now(), p: Math.round((Date.now() - DIAG.t0) / 1000) })); } catch (e) { /* private window */ }
}
function diagBeat() {
  try { localStorage.setItem(DIAG_BEAT + DIAG_VISIT, String(Date.now())); } catch (e) { /* private window */ }
}

function diagWatch() {
  if (DIAG.watching) return;
  DIAG.watching = true;
  for (const k of Object.getOwnPropertyNames(window)) {
    if (DIAG_SKIP.has(k) || /^diag/.test(k) || !/^[a-z]/.test(k)) continue;
    const d = Object.getOwnPropertyDescriptor(window, k);
    if (!d || typeof d.value !== "function" || !d.writable) continue;
    const f = d.value;
    let src = "";
    try { src = Function.prototype.toString.call(f); } catch (e) { continue; }
    /* ours, and big enough to be worth a clock read */
    if (src.length < 300 || /\[native code\]/.test(src) || /^class\b/.test(src)) continue;
    window[k] = function () {
      const st = DIAG.stack;
      st.push(k);
      if (st.length <= 3) diagCrumb();
      const t0 = performance.now();
      try { return f.apply(this, arguments); }
      finally {
        const ms = performance.now() - t0;
        st.pop();
        if (ms >= 50) { DIAG.slow.push([k, Math.round(t0), Math.round(ms), st.length]); if (DIAG.slow.length > 60) DIAG.slow.splice(0, 20); }
      }
    };
  }
  diagBeat();
  setInterval(diagBeat, 2000);
  addEventListener("pagehide", () => {
    try { localStorage.removeItem(DIAG_CRUMB + DIAG_VISIT); localStorage.removeItem(DIAG_BEAT + DIAG_VISIT); } catch (e) { /* nothing */ }
  });
  diagLastVisit();
}

/* Visits that ended frozen, found on the way in. Another open tab that's
   alive keeps beating, so only notes left still for 30 s count. */
function diagLastVisit() {
  try {
    const now = Date.now(), seen = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(DIAG_CRUMB) || k.startsWith(DIAG_BEAT))) seen.add(k.slice(DIAG_CRUMB.length));
    }
    seen.forEach(v => {
      if (v === DIAG_VISIT) return;
      const c = JSON.parse(localStorage.getItem(DIAG_CRUMB + v) || "null");
      const b = Number(localStorage.getItem(DIAG_BEAT + v)) || 0;
      const last = Math.max(c ? c.t : 0, b);
      if (now - last < 30000) return;                    /* another tab, still alive */
      localStorage.removeItem(DIAG_CRUMB + v); localStorage.removeItem(DIAG_BEAT + v);
      if (c && c.t > b && now - c.t < 3 * 864e5) {
        /* the hang skips the half-hour gap: it's the report that matters most */
        try { localStorage.removeItem(DIAG_KEY); } catch (e) { /* fine */ }
        diagReport("hang", `froze in ${c.s || "?"} (${c.p} s into the visit, ${Math.round((now - c.t) / 60000)} min ago)`);
      }
    });
  } catch (e) { /* never the thing that breaks */ }
}
