/* =========================================================================
   COHORT VIEW

   The year group, read-only, for somebody without an account. It is built to
   work like the app's own Peloton tab and profiles, and computes streaks,
   goal-hit rates and the board with the same rules app.js uses, so a number
   here is the number a student sees.

   Four calls, all in view.sql, all anon-callable and all leaving out anybody
   with hide_hours on:
     cohort_view()               people, the daily rollup, goals, subjects,
                                 busyness — read every few minutes
     cohort_live()               live timers and the newest forty sessions —
                                 read every thirty seconds
     cohort_subject_daily(key)   the rollup narrowed to one subject
     cohort_profile(uid)         one person's subjects, areas and sessions,
                                 without notes
   ========================================================================= */
"use strict";

const CFG = window.CREW_CONFIG || {};
const CAT = window.HSC_CATALOGUE || { papers: [] };
const LIVE_MS = 30e3, FULL_MS = 5 * 60e3;

/* persistSession off: this page shares an origin with the app, and must not
   pick up — or tidy away — the session of a student signed in on this browser. */
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

/* ------------------------------------------------------------------ utils */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f1 = n => (Math.round(n * 10) / 10).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const f0 = n => Math.round(n).toLocaleString("en-AU");
const hrs = m => m / 60;
const colourOk = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#5A6472";
const subjKey = n => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

/* Days are "YYYY-MM-DD" in Sydney time, handled as plain dates in UTC so the
   viewer's own timezone can never shift one. */
const P = iso => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const iso = t => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => iso(P(d) + n * 864e5);
const daysBetween = (a, b) => Math.round((P(b) - P(a)) / 864e5);
const dowIdx = d => (new Date(P(d)).getUTCDay() + 6) % 7;             // 0 = Monday
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtD = d => { const t = new Date(P(d)); return DOW[dowIdx(d)] + " " + t.getUTCDate() + " " + MON[t.getUTCMonth()]; };
const fmtShort = d => { const t = new Date(P(d)); return t.getUTCDate() + " " + MON[t.getUTCMonth()]; };

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
}
function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
function ago(ts) {
  const s = Math.max(0, (Date.now() + skew - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}
const avatar = (p, cls) =>
  `<span class="av${cls ? " " + cls : ""}" style="background:${colourOk(p && p.colour)}">${esc(initials(p && p.display_name))}</span>`;

/* the app's colour ramp: cyan past goal → red well short */
function lvl(ratio, logged) {
  if (ratio === null) return logged ? "var(--l4)" : "var(--none)";
  if (ratio >= 1.2) return "var(--l5)";
  if (ratio >= 1)   return "var(--l4)";
  if (ratio >= 0.8) return "var(--l3)";
  if (ratio >= 0.6) return "var(--l2)";
  if (ratio >= 0.4) return "var(--l1)";
  if (ratio > 0)    return "var(--l0)";
  return "var(--none)";
}

/* An axis that tops out on a round number in round steps. Asking for a fixed
   number of steps lets a second axis share the first one's gridlines. */
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function niceAxis(max, steps) {
  const step = niceStep(Math.max(max, 1e-9) / (steps || 4));
  const n = steps || Math.max(1, Math.ceil(max / step));
  return { top: step * n, step, n };
}

/* ------------------------------------------------------------------ state */
let D = null;                    /* cohort_view() */
let L = { live: [], feed: [] };  /* cohort_live() */
let skew = 0;                    /* server clock minus ours */
let PEOPLE = new Map(), DAILY = new Map(), GOALS = new Map();
let lastOk = 0;
const UI = { more: {}, tab: "now", range: 7, subject: "", metric: "hours", find: "", busyH: 168, h2hA: "", h2hB: "" };
const SUBJ_DAILY = new Map();    /* key → Map(uid → days) */
const PROFILES = new Map();      /* uid → cohort_profile() */
let openId = null;

const today = () => D ? D.today : iso(Date.now());
const profileOf = id => PEOPLE.get(id) || { id, display_name: "Someone", colour: "#8B94A3" };

/* ------------------------------------------------------------ the maths */
function cell(uid, day, src) {
  const e = (src || DAILY).get(uid); const v = e && e[day];
  return v || [0, 0];
}
const minutesOn = (uid, day) => cell(uid, day)[0];

function goalFor(uid, day) {
  const o = GOALS.get(uid + "|" + day);
  if (o !== undefined) return o;
  const p = PEOPLE.get(uid);
  if (!p) return 0;
  if (Array.isArray(p.weekday_goals) && p.weekday_goals.length === 7) {
    const v = p.weekday_goals[dowIdx(day)];
    if (v !== null && v !== undefined && v !== "") return Number(v);
  }
  return Number(p.default_goal || 0);
}
function ratioFor(uid, day) {
  const g = goalFor(uid, day), h = minutesOn(uid, day) / 60;
  if (g <= 0) return h > 0 ? 1 : null;
  return h / g;
}
const firstDayCache = new Map();
function firstDayFor(uid) {
  if (firstDayCache.has(uid)) return firstDayCache.get(uid);
  const e = DAILY.get(uid); let f = null;
  if (e) for (const k in e) if (!f || k < f) f = k;
  firstDayCache.set(uid, f); return f;
}
/* consecutive days ending today where the goal was met; a goal of 0 passes
   through, and today does not break it while there is still time left */
function streakFor(uid) {
  let cur = 0, d = today();
  const first = firstDayFor(uid);
  for (let i = 0; i < 400; i++) {
    if (!first || d < first) break;
    const g = goalFor(uid, d), h = minutesOn(uid, d) / 60;
    if (g <= 0) { d = addDays(d, -1); continue; }
    if (h >= g) { cur++; d = addDays(d, -1); }
    else if (i === 0) d = addDays(d, -1);
    else break;
  }
  return cur;
}
function rangeDays(r) {
  const t = today();
  if (r) { const o = []; for (let i = r - 1; i >= 0; i--) o.push(addDays(t, -i)); return o; }
  let start = t;
  DAILY.forEach((e, uid) => { const f = firstDayFor(uid); if (f && f < start) start = f; });
  const o = []; for (let d = start; d <= t && o.length < 400; d = addDays(d, 1)) o.push(d);
  return o;
}

const METRICS = {
  hours:    { label: "Hours",          fmt: r => f1(r.hours), unit: "h",  get: r => r.hours },
  sessions: { label: "Sessions",       fmt: r => String(r.sessions), unit: "", get: r => r.sessions },
  best:     { label: "Longest day",    fmt: r => f1(r.best), unit: "h",   get: r => r.best },
  goalHit:  { label: "Goal hit rate",  fmt: r => r.goalHit === null ? "—" : f0(r.goalHit * 100), unit: "%",
              get: r => r.goalHit === null ? -1 : r.goalHit, whole: true },
  streak:   { label: "Current streak", fmt: r => String(r.streak), unit: "d", get: r => r.streak, whole: true }
};
const metricFor = () => (UI.subject && METRICS[UI.metric].whole) ? "hours" : UI.metric;

function board(r, subject) {
  const days = rangeDays(r);
  const src = subject ? (SUBJ_DAILY.get(subject) || new Map()) : DAILY;
  let people = [...PEOPLE.values()];
  if (subject) {
    const g = (D.subjects || []).find(s => s.key === subject);
    const takers = new Set(g ? g.takers : []);
    people = people.filter(p => takers.has(p.id));
  }
  const t = today(), last7 = rangeDays(7);
  const rows = people.map(p => {
    let mins = 0, sessions = 0, best = 0, hit = 0, withGoal = 0;
    const first = firstDayFor(p.id);
    days.forEach(d => {
      const [m, n] = cell(p.id, d, src);
      mins += m; sessions += n; best = Math.max(best, m);
      if (!subject && first && d >= first) {
        const g = goalFor(p.id, d);
        if (g > 0 && (d < t || m / 60 >= g)) { withGoal++; if (m / 60 >= g) hit++; }
      }
    });
    return {
      id: p.id, p, hours: mins / 60, sessions, best: best / 60, avg: mins / 60 / days.length,
      goalHit: withGoal ? hit / withGoal : null, streak: subject ? 0 : streakFor(p.id),
      spark: last7.map(d => cell(p.id, d, src)[0] / 60)
    };
  });
  const m = METRICS[metricFor()];
  rows.sort((a, b) => m.get(b) - m.get(a) || b.hours - a.hours || a.p.display_name.localeCompare(b.p.display_name));
  return rows;
}

/* ---------------------------------------------------------------- loading */
async function loadFull() {
  const t0 = Date.now();
  const { data, error } = await sb.rpc("cohort_view");
  if (error || !data) { markStale(); return false; }
  skew = new Date(data.now).getTime() - (t0 + Date.now()) / 2;
  D = data;
  PEOPLE = new Map(D.people.map(p => [p.id, p]));
  DAILY = new Map(Object.entries(D.daily || {}).map(([uid, days]) => [uid, days]));
  GOALS = new Map((D.goals || []).map(g => [g.user_id + "|" + g.day, Number(g.hours)]));
  firstDayCache.clear();
  SUBJ_DAILY.clear();
  if (UI.subject) await loadSubject(UI.subject);
  return true;
}
async function loadLive() {
  const t0 = Date.now();
  const { data, error } = await sb.rpc("cohort_live");
  if (error || !data) { markStale(); return false; }
  skew = new Date(data.now).getTime() - (t0 + Date.now()) / 2;
  L = data; lastOk = Date.now();
  return true;
}
async function loadSubject(key) {
  if (!key || SUBJ_DAILY.has(key)) return;
  const { data } = await sb.rpc("cohort_subject_daily", { subject_key: key });
  SUBJ_DAILY.set(key, new Map(Object.entries(data || {})));
}

function markStale() {
  const u = $("updated"); u.classList.add("stale");
  u.lastElementChild.textContent = lastOk ? "Reconnecting… last updated " + ago(lastOk - skew) : "Can't reach the server";
}
function markFresh() {
  const u = $("updated"); u.classList.remove("stale");
  u.lastElementChild.textContent = "Live · updated " +
    new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/* Long lists show their top and a button for the rest, so the page is not a
   wall on a phone. What is open stays open across refreshes. */
const CAPS = { today: 24, feed: 12, board: 25 };
function capped(key, list) {
  const cap = UI.more[key] ? Infinity : CAPS[key];
  return { list: list.slice(0, cap), rest: Math.max(0, list.length - cap), open: !!UI.more[key] && list.length > CAPS[key] };
}
const moreBtn = (key, c) => c.rest ? `<button class="more" data-more="${key}">Show all ${c.rest + CAPS[key]}</button>`
                           : c.open ? `<button class="more" data-more="${key}">Show fewer</button>` : "";

/* ----------------------------------------------------------------- render */
function renderAll() {
  if (!D) return;
  markFresh(); renderCountdown();
  renderLive(); renderKpis(); renderToday(); renderDaily(); renderFeed();
  renderPeloton(); renderSubjects();
  if (openId) renderProfile(openId);
}
function renderLiveBits() {
  if (!D) return;
  markFresh(); renderLive(); renderKpis(); renderToday(); renderFeed();
  if (openId) paintProfileLive(openId);
}

function renderCountdown() {
  const papers = (CAT.papers || []).map(p => p.date).sort();
  const el = $("countdown");
  if (!papers.length) { el.hidden = true; return; }
  const t = today(), n = daysBetween(t, papers[0]);
  if (n > 1)       el.textContent = n + " days to the first HSC exam";
  else if (n === 1) el.textContent = "First HSC exam tomorrow";
  else if (t <= papers[papers.length - 1]) el.textContent = "HSC exams underway";
  else { el.hidden = true; return; }
  el.hidden = false;
}

/* ------------------------------------------------------------------ NOW */
const elapsed = t => Number(t.acc_ms || 0) + (t.running ? Date.now() + skew - new Date(t.started_at).getTime() : 0);
/* the timer's label is "Subject · Area"; the joined names win when they exist,
   and the label fills in for a subject deleted since the timer started */
function liveParts(t) {
  const bits = String(t.label || "").split(" · ");
  return { subject: t.subject || bits[0] || "Study", area: t.area || (t.subject ? "" : bits.slice(1).join(" · ")) };
}
function liveSorted() {
  return (L.live || []).filter(t => PEOPLE.has(t.user_id)).slice()
    .sort((a, b) => a.running === b.running ? elapsed(b) - elapsed(a) : (a.running ? -1 : 1));
}
function renderLive() {
  const live = liveSorted(), running = live.filter(t => t.running);
  $("live-n").textContent = running.length;
  $("live-sub").textContent = (live.length > running.length ? (live.length - running.length) + " paused · " : "") +
    (D.record ? "Record: " + D.record + " studying at once" : "Timers students are running now");
  $("live-list").innerHTML = live.length ? live.map(t => {
    const p = profileOf(t.user_id), x = liveParts(t);
    return `<button class="lc${t.running ? "" : " paused"}" data-profile="${esc(t.user_id)}">
      ${avatar(p)}
      <div class="who">
        <div class="nm">${esc(p.display_name)}</div>
        <div class="sj" style="color:${colourOk(t.subject_colour)}">${esc(x.subject)}</div>
        ${x.area ? `<div class="ar">${esc(x.area)}</div>` : ""}
      </div>
      <span class="t" data-live="${esc(t.user_id)}">${hms(elapsed(t))}</span>
    </button>`;
  }).join("") : `<p class="empty">Nobody has a timer running right now.</p>`;
}
function tick() {
  if (!D) return;
  document.querySelectorAll("[data-live]").forEach(el => {
    const t = (L.live || []).find(x => x.user_id === el.dataset.live);
    if (t && t.running) el.textContent = hms(elapsed(t));
  });
}

function renderKpis() {
  const t = today(), wk = rangeDays(7), prev = wk.map(d => addDays(d, -7));
  let mT = 0, aT = 0, m7 = 0, mP = 0, a7 = 0, mAll = 0, sAll = 0, hitT = 0;
  PEOPLE.forEach((p, id) => {
    const e = DAILY.get(id); if (!e) return;
    const mt = cell(id, t)[0]; mT += mt; if (mt) { aT++; if (goalFor(id, t) > 0 && mt / 60 >= goalFor(id, t)) hitT++; }
    let w = 0; wk.forEach(d => w += cell(id, d)[0]); m7 += w; if (w) a7++;
    prev.forEach(d => mP += cell(id, d)[0]);
    for (const k in e) { mAll += e[k][0]; sAll += e[k][1]; }
  });
  const members = PEOPLE.size;
  const delta = mP > 0
    ? `<span class="${m7 >= mP ? "up" : "down"}">${m7 >= mP ? "▲" : "▼"} ${f0(Math.abs(m7 - mP) / mP * 100)}%</span> on the week before`
    : "First full week of data";
  const first = rangeDays(0)[0];
  const cards = [
    { k: "Hours today", v: f1(hrs(mT)), d: `${aT} student${aT === 1 ? "" : "s"} so far · ${hitT} hit their goal` },
    { k: "Hours this week", v: f0(hrs(m7)), d: delta },
    { k: "Active this week", v: f0(a7) + `<small>/ ${f0(members)}</small>`,
      d: (members ? f0(a7 / members * 100) + "% of the cohort" : "") + (a7 ? " · " + f1(hrs(m7) / a7) + " h each" : "") },
    { k: "Total hours logged", v: f0(hrs(mAll)), d: f0(sAll) + " sessions since " + fmtShort(first) }
  ];
  $("kpis").innerHTML = cards.map(c =>
    `<div class="kpi"><div class="k">${c.k}</div><div class="v">${c.v}</div><div class="d">${c.d}</div></div>`).join("");
}

function renderToday() {
  const t = today(), liveIds = new Set((L.live || []).filter(x => x.running).map(x => x.user_id));
  const rows = [...PEOPLE.values()].map(p => ({ p, h: cell(p.id, t)[0] / 60, g: goalFor(p.id, t), live: liveIds.has(p.id) }))
    .filter(r => r.h > 0 || r.live)
    .sort((a, b) => b.h - a.h || (b.live - a.live));
  $("today-sub").textContent = rows.length
    ? `${rows.length} student${rows.length === 1 ? "" : "s"} on the board today, against each person's own goal`
    : "Hours logged today, against each person's own goal";
  $("ramp").innerHTML = [["var(--l5)", "120%+"], ["var(--l4)", "Goal met"], ["var(--l2)", "60–99%"], ["var(--l0)", "Under 60%"]]
    .map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("");
  const cT = capped("today", rows);
  $("today").innerHTML = rows.length ? cT.list.map(r => {
    const ratio = r.g > 0 ? r.h / r.g : (r.h > 0 ? 1 : null);
    const w = r.g > 0 ? Math.min(100, r.h / r.g * 100) : (r.h > 0 ? 100 : 0);
    return `<div class="tr" data-profile="${esc(r.p.id)}">
      <div class="nm">${avatar(r.p, "sm")}<span>${esc(r.p.display_name)}</span>${r.live ? `<i class="livepip" title="Studying now"></i>` : ""}</div>
      <div class="meter"><i style="width:${w}%;background:${lvl(ratio, r.h > 0)}"></i></div>
      <div class="h"><b>${f1(r.h)}</b>${r.g > 0 ? " / " + f1(r.g) : ""} h</div>
    </div>`;
  }).join("") : `<p class="empty">Nothing logged yet today.</p>`;
  $("today-more").innerHTML = moreBtn("today", cT);
}

/* Hours as bars, students as a line on its own scale. Days before anybody
   used the app are dropped rather than drawn as a long flat nothing. */
function renderDaily() {
  const days = rangeDays(30).filter(d => d >= rangeDays(0)[0]);
  const rows = days.map(d => {
    let m = 0, s = 0; PEOPLE.forEach((p, id) => { const v = cell(id, d)[0]; m += v; if (v) s++; });
    return { d, h: m / 60, s };
  });
  const W = 900, H = 280, Lp = 40, R = 40, T = 18, B = 42, svg = $("daily");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (!rows.length) { svg.innerHTML = ""; return; }
  const ah = niceAxis(Math.max(1, ...rows.map(r => r.h)));
  const as = niceAxis(Math.max(1, ...rows.map(r => r.s)), ah.n);
  const cw = (W - Lp - R) / rows.length, bw = Math.min(34, cw * 0.66);
  const y = v => T + (H - T - B) * (1 - v / ah.top), ys = v => T + (H - T - B) * (1 - v / as.top);
  let g = "";
  for (let i = 0; i <= ah.n; i++) {
    const yy = y(ah.step * i);
    g += `<line class="grid" x1="${Lp}" x2="${W - R}" y1="${yy}" y2="${yy}"/>
      <text x="${Lp - 8}" y="${yy + 4}" text-anchor="end">${f0(ah.step * i)}</text>
      <text x="${W - R + 8}" y="${yy + 4}">${f1(as.step * i)}</text>`;
  }
  g += `<text x="${Lp - 8}" y="${T - 6}" text-anchor="end">h</text><text x="${W - R + 8}" y="${T - 6}">ppl</text>`;
  const every = rows.length > 20 ? 3 : rows.length > 12 ? 2 : 1;
  rows.forEach((r, i) => {
    const x = Lp + cw * i + (cw - bw) / 2, top = y(r.h), now = r.d === today();
    g += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(0, H - B - top)}" rx="3" fill="${now ? "#FF7A4D" : "#E8402A"}" opacity="${now ? .55 : 1}" data-tip="${esc(fmtD(r.d))}: ${f1(r.h)} h from ${r.s} student${r.s === 1 ? "" : "s"}${now ? " (so far)" : ""}"/>`;
    if (r.h > 0 && rows.length <= 21) g += `<text class="val" x="${x + bw / 2}" y="${top - 5}" text-anchor="middle">${f0(r.h)}</text>`;
    if ((rows.length - 1 - i) % every === 0)
      g += `<text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle">${DOW[dowIdx(r.d)]}</text><text x="${x + bw / 2}" y="${H - B + 30}" text-anchor="middle">${fmtShort(r.d)}</text>`;
  });
  g += `<polyline points="${rows.map((r, i) => `${Lp + cw * i + cw / 2},${ys(r.s)}`).join(" ")}" fill="none" stroke="#2B6177" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>`;
  rows.forEach((r, i) => { g += `<circle cx="${Lp + cw * i + cw / 2}" cy="${ys(r.s)}" r="3" fill="#fff" stroke="#2B6177" stroke-width="2" pointer-events="none"/>`; });
  g += `<line class="axis" x1="${Lp}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg.innerHTML = g;
}

function renderFeed() {
  const rows = (L.feed || []).filter(s => PEOPLE.has(s.user_id));
  const cF = capped("feed", rows);
  $("feed").innerHTML = rows.length ? cF.list.map(s => {
    const p = profileOf(s.user_id);
    return `<div class="fe">
      ${avatar(p, "sm")}
      <div class="what">
        <div class="l1"><b data-profile="${esc(s.user_id)}">${esc(p.display_name)}</b> · <span style="color:${colourOk(s.subject_colour)};font-weight:600">${esc(s.subject || "Study")}</span></div>
        <div class="l2">${s.area ? esc(s.area) + " · " : ""}${s.day === today() ? "today" : fmtD(s.day)}</div>
      </div>
      <div class="h">${f1(s.minutes / 60)} h<small>${ago(s.created_at)}</small></div>
    </div>`;
  }).join("") : `<p class="empty">Nothing logged yet.</p>`;
  $("feed-more").innerHTML = moreBtn("feed", cF);
}

/* -------------------------------------------------------------- PELOTON */
function renderPeloton() {
  /* subject picker: everybody's subjects, most-taken first */
  const sel = $("lb-subject");
  const opts = `<option value="">All subjects</option>` + (D.subjects || [])
    .filter(s => s.takers.length > 1 || s.mall > 0)
    .map(s => `<option value="${esc(s.key)}">${esc(s.label)} (${s.takers.length})</option>`).join("");
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  sel.value = UI.subject;
  const ms = $("lb-metric");
  const mo = Object.entries(METRICS).filter(([k, m]) => !(UI.subject && m.whole))
    .map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("");
  if (ms.dataset.sig !== mo) { ms.innerHTML = mo; ms.dataset.sig = mo; }
  ms.value = metricFor();
  document.querySelectorAll("#range button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.r === UI.range)));

  renderBoard(); renderRace(); renderStack(); renderBusy(); renderHours(); renderH2H();
}

function spark(vals) {
  const W = 84, H = 22, max = Math.max(0.5, ...vals), bw = W / vals.length;
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${vals.map((v, i) =>
    `<rect x="${i * bw + 1}" y="${H - Math.max(v > 0 ? 2 : 1, v / max * H)}" width="${bw - 2}" height="${Math.max(v > 0 ? 2 : 1, v / max * H)}" rx="1.5" fill="${v > 0 ? "#E8402A" : "#E6E9EF"}"/>`).join("")}</svg>`;
}

function renderBoard() {
  const rows = board(UI.range, UI.subject);
  const m = METRICS[metricFor()];
  const active = rows.filter(r => r.hours > 0);
  const rangeTxt = UI.range === 1 ? "today" : UI.range ? "the last " + UI.range + " days" : "all time";
  const subj = UI.subject ? ((D.subjects || []).find(s => s.key === UI.subject) || {}).label : "";
  $("lb-sub").textContent = `${active.length} of ${rows.length} ${subj ? "taking " + subj + " " : ""}logged something ${rangeTxt} · ranked by ${m.label.toLowerCase()}`;

  const podium = active.slice(0, 3);
  const order = [1, 0, 2].filter(i => podium[i]);
  $("podium").innerHTML = podium.length ? order.map(i => {
    const r = podium[i];
    return `<div class="pod p${i + 1}" data-profile="${esc(r.id)}">
      ${avatar(r.p, i === 0 ? "xl" : "")}
      <div class="pl">${["1st", "2nd", "3rd"][i]}</div>
      <div class="nm">${esc(r.p.display_name)}</div>
      <div class="big">${m.fmt(r)}<small> ${m.unit}</small></div>
    </div>`;
  }).join("") : "";
  $("podium").hidden = !podium.length;

  const q = UI.find.trim().toLowerCase();
  const ranked = active.map((r, i) => Object.assign(r, { rank: i + 1 }));
  const cB = capped("board", q ? rows.filter(r => r.p.display_name.toLowerCase().includes(q)) : ranked);
  const shown = cB.list;
  $("board").querySelector("tbody").innerHTML = shown.length ? shown.map(r => `
    <tr class="g${r.rank || 0}" data-profile="${esc(r.id)}">
      <td class="rk">${r.rank || "—"}</td>
      <td><span class="st">${avatar(r.p, "sm")}${esc(r.p.display_name)}</span></td>
      <td class="n"><b>${f1(r.hours)}</b></td>
      <td class="n wide">${r.sessions}</td>
      <td class="n wide">${f1(r.avg)}</td>
      <td class="n wide">${f1(r.best)}</td>
      <td class="n">${UI.subject ? "—" : r.goalHit === null ? "—" : f0(r.goalHit * 100) + "%"}</td>
      <td class="n">${UI.subject ? "—" : r.streak ? r.streak + " d" : "0"}</td>
      <td class="wide">${spark(r.spark)}</td>
    </tr>`).join("")
    : `<tr><td colspan="9" class="empty">${q ? "Nobody by that name." : "Nothing logged in this range."}</td></tr>`;
  const idle = rows.length - active.length;
  $("lb-more").innerHTML = moreBtn("board", cB) +
    (!q && idle ? `<p class="note">${idle} more ${idle === 1 ? "hasn't" : "haven't"} logged anything ${rangeTxt}. Search above to find anyone.</p>` : "");
}

/* top eight by hours over the range; "Today" draws the week instead, since
   a race of one day is a single point */
function raceSet() {
  const r = UI.range === 1 ? 7 : UI.range;
  const days = rangeDays(r);
  const top = board(r, UI.subject).filter(x => x.hours > 0).slice(0, 8);
  return { days, top, src: UI.subject ? (SUBJ_DAILY.get(UI.subject) || new Map()) : DAILY };
}
function keysHTML(list) {
  return list.map(x => `<span data-profile="${esc(x.id || "")}"><i style="background:${x.c}"></i>${esc(x.n)}</span>`).join("");
}
function renderRace() {
  const { days, top, src } = raceSet();
  const W = 620, H = 330, Lp = 36, R = 12, T = 14, B = 30, svg = $("race");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  $("race-sub").textContent = `Cumulative hours, top eight, ${UI.range === 0 ? "all time" : "last " + days.length + " days"}`;
  if (!top.length) { svg.innerHTML = ""; $("race-keys").innerHTML = `<p class="empty">Nothing logged in this range.</p>`; return; }
  const series = top.map(r => { let c = 0; return { r, pts: days.map(d => (c += cell(r.id, d, src)[0] / 60)) }; });
  const ax = niceAxis(Math.max(...series.map(s => s.pts[s.pts.length - 1])));
  const x = i => Lp + (W - Lp - R) * (days.length === 1 ? 0.5 : i / (days.length - 1));
  const y = v => T + (H - T - B) * (1 - v / ax.top);
  let g = "";
  for (let i = 0; i <= ax.n; i++) g += `<line class="grid" x1="${Lp}" x2="${W - R}" y1="${y(ax.step * i)}" y2="${y(ax.step * i)}"/><text x="${Lp - 6}" y="${y(ax.step * i) + 4}" text-anchor="end">${f0(ax.step * i)}</text>`;
  const every = Math.ceil(days.length / 7);
  days.forEach((d, i) => { if ((days.length - 1 - i) % every === 0) g += `<text x="${x(i)}" y="${H - B + 17}" text-anchor="middle">${fmtShort(d)}</text>`; });
  series.slice().reverse().forEach(s => {
    const c = colourOk(s.r.p.colour);
    g += `<polyline points="${s.pts.map((v, i) => x(i) + "," + y(v)).join(" ")}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
    const lv = s.pts[s.pts.length - 1];
    g += `<circle cx="${x(days.length - 1)}" cy="${y(lv)}" r="4" fill="${c}" data-tip="${esc(s.r.p.display_name)}: ${f1(lv)} h"/>`;
  });
  g += `<line class="axis" x1="${Lp}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg.innerHTML = g;
  $("race-keys").innerHTML = keysHTML(top.map(r => ({ id: r.id, c: colourOk(r.p.colour), n: r.p.display_name + " · " + f1(r.hours) + " h" })));
}
function renderStack() {
  const { days, top, src } = raceSet();
  const W = 620, H = 330, Lp = 36, R = 12, T = 14, B = 30, svg = $("stack");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  $("stack-sub").textContent = `Hours each day, the top eight and everyone else`;
  const ids = new Set(top.map(r => r.id));
  const cols = days.map(d => {
    let rest = 0; (src).forEach((e, uid) => { if (PEOPLE.has(uid) && !ids.has(uid)) rest += (e[d] ? e[d][0] : 0); });
    return { d, parts: top.map(r => ({ r, h: cell(r.id, d, src)[0] / 60 })), rest: rest / 60 };
  });
  const tot = c => c.parts.reduce((a, x) => a + x.h, 0) + c.rest;
  const peak = Math.max(0, ...cols.map(tot));
  if (!peak) { svg.innerHTML = ""; $("stack-keys").innerHTML = `<p class="empty">Nothing logged in this range.</p>`; return; }
  const ax = niceAxis(peak), cw = (W - Lp - R) / cols.length, bw = Math.min(30, cw * 0.72);
  const y = v => T + (H - T - B) * (1 - v / ax.top);
  let g = "";
  for (let i = 0; i <= ax.n; i++) g += `<line class="grid" x1="${Lp}" x2="${W - R}" y1="${y(ax.step * i)}" y2="${y(ax.step * i)}"/><text x="${Lp - 6}" y="${y(ax.step * i) + 4}" text-anchor="end">${f0(ax.step * i)}</text>`;
  const every = Math.ceil(cols.length / 7);
  cols.forEach((c, i) => {
    const x = Lp + cw * i + (cw - bw) / 2; let acc = 0;
    c.parts.forEach(p => {
      if (!p.h) return;
      g += `<rect x="${x}" y="${y(acc + p.h)}" width="${bw}" height="${y(acc) - y(acc + p.h)}" fill="${colourOk(p.r.p.colour)}" data-tip="${esc(p.r.p.display_name)}, ${fmtD(c.d)}: ${f1(p.h)} h"/>`;
      acc += p.h;
    });
    if (c.rest) g += `<rect x="${x}" y="${y(acc + c.rest)}" width="${bw}" height="${y(acc) - y(acc + c.rest)}" fill="#CDD3DC" data-tip="Everyone else, ${fmtD(c.d)}: ${f1(c.rest)} h"/>`;
    if ((cols.length - 1 - i) % every === 0) g += `<text x="${x + bw / 2}" y="${H - B + 17}" text-anchor="middle">${fmtShort(c.d)}</text>`;
  });
  g += `<line class="axis" x1="${Lp}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg.innerHTML = g;
  $("stack-keys").innerHTML = keysHTML(top.map(r => ({ id: r.id, c: colourOk(r.p.colour), n: r.p.display_name }))
    .concat([{ c: "#CDD3DC", n: "Everyone else" }]));
}

/* the hourly peaks, zero-filled: an hour nobody studied is a zero, not a gap
   the line quietly joins across */
function hourly(hoursBack) {
  const map = new Map((D.history || []).map(([b, p]) => [new Date(b).getTime(), p]));
  const now = Math.floor((Date.now() + skew) / 36e5) * 36e5;
  const first = D.history && D.history.length ? new Date(D.history[0][0]).getTime() : now;
  const out = [];
  for (let t = Math.max(first, now - (hoursBack - 1) * 36e5); t <= now; t += 36e5) out.push([t, map.get(t) || 0]);
  return out;
}
const sydHour = t => Number(new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hour12: false })) % 24;
const hourLabel = h => (h % 12 || 12) + (h < 12 ? "am" : "pm");
function renderBusy() {
  document.querySelectorAll("#busy-range button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.h === UI.busyH)));
  const pts = hourly(UI.busyH);
  const W = 900, H = 250, Lp = 36, R = 12, T = 14, B = 30, svg = $("busy");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const peak = Math.max(0, ...pts.map(p => p[1]));
  $("busy-sub").textContent = `Most people on the clock at once, each hour · peak in this window ${peak}, all-time record ${D.record}`;
  if (pts.length < 2) { svg.innerHTML = ""; return; }
  const ax = niceAxis(Math.max(1, peak));
  const x = i => Lp + (W - Lp - R) * i / (pts.length - 1), y = v => T + (H - T - B) * (1 - v / ax.top);
  let g = "";
  for (let i = 0; i <= ax.n; i++) g += `<line class="grid" x1="${Lp}" x2="${W - R}" y1="${y(ax.step * i)}" y2="${y(ax.step * i)}"/><text x="${Lp - 6}" y="${y(ax.step * i) + 4}" text-anchor="end">${f0(ax.step * i)}</text>`;
  let lastDay = "";
  pts.forEach(([t], i) => {
    const d = new Date(t).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric" });
    const h = sydHour(t);
    if (UI.busyH <= 24 ? h % 3 === 0 : (h === 0 && d !== lastDay)) {
      g += `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text x="${x(i)}" y="${H - B + 17}" text-anchor="middle">${UI.busyH <= 24 ? hourLabel(h) : d}</text>`;
      lastDay = d;
    }
  });
  const line = pts.map((p, i) => x(i) + "," + y(p[1])).join(" ");
  g += `<polygon points="${x(0)},${y(0)} ${line} ${x(pts.length - 1)},${y(0)}" fill="#E8402A" opacity=".12"/>`;
  g += `<polyline points="${line}" fill="none" stroke="#E8402A" stroke-width="2" stroke-linejoin="round"/>`;
  const bw = (W - Lp - R) / pts.length;
  pts.forEach(([t, v], i) => {
    g += `<rect x="${x(i) - bw / 2}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent" data-tip="${esc(new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric" }))}: ${v} studying"/>`;
  });
  g += `<line class="axis" x1="${Lp}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg.innerHTML = g;
}
function renderHours() {
  const sums = Array(24).fill(0), counts = Array(24).fill(0);
  hourly(14 * 24).forEach(([t, v]) => { const h = sydHour(t); sums[h] += v; counts[h]++; });
  const vals = sums.map((s, h) => counts[h] ? s / counts[h] : 0);
  const W = 620, H = 240, Lp = 30, R = 10, T = 14, B = 30, svg = $("hours");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const peak = Math.max(...vals);
  if (!peak) { svg.innerHTML = ""; $("hours-note").textContent = "Not enough data yet."; return; }
  const ax = niceAxis(peak), cw = (W - Lp - R) / 24, bw = cw * 0.72, y = v => T + (H - T - B) * (1 - v / ax.top);
  const ph = vals.indexOf(peak);
  let g = "";
  for (let i = 0; i <= ax.n; i++) g += `<line class="grid" x1="${Lp}" x2="${W - R}" y1="${y(ax.step * i)}" y2="${y(ax.step * i)}"/><text x="${Lp - 6}" y="${y(ax.step * i) + 4}" text-anchor="end">${f1(ax.step * i)}</text>`;
  vals.forEach((v, h) => {
    const x = Lp + cw * h + (cw - bw) / 2;
    g += `<rect x="${x}" y="${y(v)}" width="${bw}" height="${H - B - y(v)}" rx="2" fill="${h === ph ? "#E8402A" : "#2B6177"}" opacity="${h === ph ? 1 : .75}" data-tip="${hourLabel(h)}: ${f1(v)} on average"/>`;
    if (h % 3 === 0) g += `<text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle">${hourLabel(h)}</text>`;
  });
  g += `<line class="axis" x1="${Lp}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg.innerHTML = g;
  $("hours-note").textContent = `Busiest around ${hourLabel(ph)}–${hourLabel((ph + 1) % 24)}, with ${f1(peak)} studying at once on average over the last fortnight.`;
}

function renderH2H() {
  const wk = board(7), all = board(0);
  const ranked = wk.filter(r => r.hours > 0);
  if (!UI.h2hA && ranked[0]) UI.h2hA = ranked[0].id;
  if (!UI.h2hB && ranked[1]) UI.h2hB = ranked[1].id;
  const people = [...PEOPLE.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const opts = people.map(p => `<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join("");
  ["h2h-a", "h2h-b"].forEach(id => { const s = $(id); if (s.dataset.sig !== opts) { s.innerHTML = opts; s.dataset.sig = opts; } });
  $("h2h-a").value = UI.h2hA; $("h2h-b").value = UI.h2hB;
  const A = UI.h2hA, B = UI.h2hB;
  if (!A || !B) { $("h2h").innerHTML = `<p class="empty">Pick two students.</p>`; return; }
  const w = id => wk.find(r => r.id === id), a = id => all.find(r => r.id === id);
  const rows = [
    ["Hours this week", r => w(r).hours, v => f1(v) + " h"],
    ["Hours all time", r => a(r).hours, v => f1(v) + " h"],
    ["Sessions all time", r => a(r).sessions, v => String(v)],
    ["Longest day", r => a(r).best, v => f1(v) + " h"],
    ["Goal hit rate", r => a(r).goalHit === null ? -1 : a(r).goalHit, v => v < 0 ? "—" : f0(v * 100) + "%"],
    ["Current streak", r => a(r).streak, v => v + " d"],
    ["Days active this week", r => w(r).spark.filter(x => x > 0).length, v => v + " / 7"]
  ];
  const pa = profileOf(A), pb = profileOf(B);
  $("h2h").innerHTML = `<div class="h2h">
    <div class="a who" data-profile="${esc(A)}">${esc(pa.display_name)}</div><div></div><div class="b who" data-profile="${esc(B)}">${esc(pb.display_name)}</div>
    ${rows.map(([k, get, fmt]) => {
      const va = get(A), vb = get(B);
      return `<div class="a ${va > vb ? "win" : ""}">${fmt(va)}</div><div class="m">${k}</div><div class="b ${vb > va ? "win" : ""}">${fmt(vb)}</div>`;
    }).join("")}
  </div>`;
}

/* ------------------------------------------------------------- SUBJECTS */
function renderSubjects() {
  const rows = (D.subjects || []).filter(s => s.mall > 0 || s.takers.length > 2)
    .sort((a, b) => b.m7 - a.m7 || b.mall - a.mall);
  const max = Math.max(1, ...rows.map(s => s.m7));
  $("subj").querySelector("tbody").innerHTML = rows.map(s => `
    <tr data-subject="${esc(s.key)}">
      <td><b>${esc(s.label)}</b></td>
      <td class="n">${s.takers.length}</td>
      <td class="n"><b>${f1(hrs(s.m7))} h</b></td>
      <td class="wide bar"><div class="track"><i style="width:${(s.m7 / max * 100).toFixed(1)}%"></i></div></td>
      <td class="n wide">${f1(hrs(s.m7) / Math.max(1, s.takers.length))} h</td>
      <td class="n">${f0(hrs(s.mall))} h</td>
    </tr>`).join("");

  const counts = new Map((D.subjects || []).map(s => [s.key, s.takers.length]));
  const t = today();
  const papers = (CAT.papers || []).map(p => Object.assign({}, p, { n: counts.get(subjKey(p.subject)) || 0 }))
    .filter(p => p.n > 0);
  $("exams").querySelector("tbody").innerHTML = papers.length ? papers.map(p => {
    const d = daysBetween(t, p.date);
    return `<tr class="${d < 0 ? "past" : d <= 7 ? "soon" : ""}" data-subject="${esc(subjKey(p.subject))}">
      <td style="white-space:nowrap">${fmtD(p.date)}</td>
      <td><span style="color:${colourOk(p.colour)};font-weight:650">${esc(p.subject)}</span><div class="sub">${esc(p.paper)}</div></td>
      <td class="n wide" style="white-space:nowrap">${esc(p.start)}–${esc(p.end)}</td>
      <td class="n">${p.n}</td>
      <td class="n" style="white-space:nowrap">${d < 0 ? "done" : d === 0 ? "today" : d === 1 ? "tomorrow" : d + " days"}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="5" class="empty">No papers found.</td></tr>`;
}

/* -------------------------------------------------------------- PROFILE */
async function openProfile(id) {
  if (!PEOPLE.has(id)) return;
  openId = id;
  $("ov").hidden = false; document.body.style.overflow = "hidden";
  renderProfile(id);
  if (!PROFILES.has(id)) {
    const { data } = await sb.rpc("cohort_profile", { uid: id });
    PROFILES.set(id, data || { subjects: [], areas: [], sessions: [] });
    if (openId === id) renderProfile(id);
  }
}
function closeProfile() { openId = null; $("ov").hidden = true; document.body.style.overflow = ""; }

function profileLiveHTML(id) {
  const t = (L.live || []).find(x => x.user_id === id);
  if (!t) return "";
  const x = liveParts(t);
  return `<div class="pflive"><i class="dot"></i>${t.running ? "Studying now" : "Paused"}: <span style="color:${colourOk(t.subject_colour)};font-weight:650">${esc(x.subject)}</span>${x.area ? " · " + esc(x.area) : ""}<b data-live="${esc(id)}">${hms(elapsed(t))}</b></div>`;
}
function paintProfileLive(id) {
  const el = document.querySelector("#pf-body .pflive-slot"); if (el) el.innerHTML = profileLiveHTML(id);
}

function renderProfile(id) {
  const p = profileOf(id), wk = board(7).filter(r => r.hours > 0);
  const rank = wk.findIndex(r => r.id === id);
  $("pf-head").innerHTML = `${avatar(p, "xl")}
    <div><h2 id="pf-name">${esc(p.display_name)}</h2>
      <div class="meta">${rank >= 0 ? `#${rank + 1} of ${wk.length} this week · ${f1(wk[rank].hours)} h` : "No hours this week"} · joined ${new Date(p.created_at).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" })}</div></div>
    <button class="x" data-close aria-label="Close">×</button>`;

  const e = DAILY.get(id) || {};
  const days = Object.keys(e).sort();
  const totalM = days.reduce((a, d) => a + e[d][0], 0), totalS = days.reduce((a, d) => a + e[d][1], 0);
  const best = days.length ? Math.max(...days.map(d => e[d][0])) / 60 : 0;
  let hit = 0, withGoal = 0;
  if (days.length) for (let d = days[0]; d <= today(); d = addDays(d, 1)) {
    const g = goalFor(id, d), h = (e[d] ? e[d][0] : 0) / 60;
    if (g > 0 && (d < today() || h >= g)) { withGoal++; if (h >= g) hit++; }
  }

  /* five weeks, Monday first, ending this week */
  const t = today(), start = addDays(t, -dowIdx(t) - 28);
  let chain = DOW.map(d => `<span class="dw">${d[0]}</span>`).join("");
  for (let i = 0; i < 35; i++) {
    const d = addDays(start, i);
    if (d > t) { chain += `<i class="out"></i>`; continue; }
    const h = (e[d] ? e[d][0] : 0) / 60, g = goalFor(id, d);
    chain += `<i class="${d === t ? "today" : ""}" style="background:${lvl(ratioFor(id, d), h > 0)}" data-tip="${esc(fmtD(d))}: ${f1(h)} h${g > 0 ? " of " + f1(g) : ""}"></i>`;
  }

  const pr = PROFILES.get(id);
  let detail = `<div class="loading">Loading subjects and sessions…</div>`;
  if (pr) {
    const subs = pr.subjects || [], areas = pr.areas || [], sess = pr.sessions || [];
    const hSub = {}, hArea = {};
    sess.forEach(s => {
      if (s.subject_id) hSub[s.subject_id] = (hSub[s.subject_id] || 0) + s.minutes / 60;
      if (s.area_id) hArea[s.area_id] = (hArea[s.area_id] || 0) + s.minutes / 60;
    });
    const mx = Math.max(1, ...subs.map(s => hSub[s.id] || 0));
    const subOf = sid => subs.find(s => s.id === sid);
    const areaOf = aid => areas.find(a => a.id === aid);
    const byDay = new Map(); sess.forEach(s => { if (!byDay.has(s.day)) byDay.set(s.day, []); byDay.get(s.day).push(s); });
    const subsSorted = subs.slice().sort((a, b) => (hSub[b.id] || 0) - (hSub[a.id] || 0));
    const areasSorted = areas.filter(a => hArea[a.id] || a.target_hours).sort((a, b) => (hArea[b.id] || 0) - (hArea[a.id] || 0));
    detail = `
      <div><h3>Hours by subject</h3><div class="rows">${subsSorted.length ? subsSorted.map(s => {
        const v = hSub[s.id] || 0;
        return `<div class="rb"><div class="l"><i style="background:${colourOk(s.colour)}"></i>${esc(s.name)}</div>
          <div class="track"><i style="width:${v / mx * 100}%;background:${colourOk(s.colour)}"></i></div>
          <div class="v">${f1(v)} h</div></div>`;
      }).join("") : `<p class="empty">No subjects set up.</p>`}</div></div>
      ${areasSorted.length ? `<div><h3>Areas</h3><div class="rows">${areasSorted.map(a => {
        const s = subOf(a.subject_id) || {}, v = hArea[a.id] || 0, tg = Number(a.target_hours) || 0;
        const w = tg ? Math.min(100, v / tg * 100) : v / Math.max(1, ...areasSorted.map(x => hArea[x.id] || 0)) * 100;
        return `<div class="rb"><div class="l" title="${esc(s.name || "")}"><i style="background:${colourOk(s.colour)}"></i>${esc(a.name)}</div>
          <div class="track"><i style="width:${w}%;background:${colourOk(s.colour)}"></i></div>
          <div class="v">${f1(v)}${tg ? `<small> / ${f1(tg)}</small>` : ""} h</div></div>`;
      }).join("")}</div></div>` : ""}
      <div><h3>Every session${sess.length ? " · " + sess.length + ", newest first" : ""}</h3>
        <div class="pflog">${sess.length ? [...byDay.entries()].map(([d, list]) => `
          <div class="dg">${fmtD(d)} · ${f1(list.reduce((a, s) => a + s.minutes, 0) / 60)} h${goalFor(id, d) > 0 ? " of " + f1(goalFor(id, d)) : ""}</div>
          ${list.map(s => { const sj = subOf(s.subject_id), ar = areaOf(s.area_id);
            return `<div class="en"><span><b style="color:${colourOk(sj && sj.colour)}">${esc(sj ? sj.name : "Study")}</b>${ar ? " · " + esc(ar.name) : ""}</span><span>${f1(s.minutes / 60)} h</span></div>`;
          }).join("")}`).join("") : `<p class="empty" style="padding:14px">Nothing logged yet.</p>`}</div></div>`;
  }

  $("pf-body").innerHTML = `
    <div class="pflive-slot">${profileLiveHTML(id)}</div>
    <div class="pfk">
      <div class="kpi"><div class="k">Hours, all time</div><div class="v">${f1(totalM / 60)}</div><div class="d">${totalS} session${totalS === 1 ? "" : "s"}</div></div>
      <div class="kpi"><div class="k">Days with something logged</div><div class="v">${days.length}</div><div class="d">${days.length ? "since " + fmtShort(days[0]) : "nothing yet"}</div></div>
      <div class="kpi"><div class="k">Current streak</div><div class="v">${streakFor(id)}<small>d</small></div><div class="d">Rest days carry it through</div></div>
      <div class="kpi"><div class="k">Average per active day</div><div class="v">${f1(days.length ? totalM / 60 / days.length : 0)}<small>h</small></div><div class="d">Best ${f1(best)} h${withGoal ? " · goal hit " + f0(hit / withGoal * 100) + "%" : ""}</div></div>
    </div>
    <div><h3>Last five weeks</h3><div class="chain">${chain}</div></div>
    ${detail}`;
}

/* --------------------------------------------------------------- wiring */
function setTab(tab) {
  if (!["now", "peloton", "subjects"].includes(tab)) tab = "now";
  UI.tab = tab;
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("on", p.id === "p-" + tab));
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) { setTab(b.dataset.tab); window.scrollTo(0, 0); } });

$("range").addEventListener("click", e => {
  const b = e.target.closest("button[data-r]"); if (!b) return;
  UI.range = +b.dataset.r; renderPeloton();
});
$("busy-range").addEventListener("click", e => {
  const b = e.target.closest("button[data-h]"); if (!b) return;
  UI.busyH = +b.dataset.h; renderBusy();
});
$("lb-subject").addEventListener("change", async e => {
  UI.subject = e.target.value;
  if (UI.subject) { $("lb-sub").textContent = "Loading…"; await loadSubject(UI.subject); }
  renderPeloton();
});
$("lb-metric").addEventListener("change", e => { UI.metric = e.target.value; renderPeloton(); });
$("lb-find").addEventListener("input", e => { UI.find = e.target.value; renderBoard(); });
$("h2h-a").addEventListener("change", e => { UI.h2hA = e.target.value; renderH2H(); });
$("h2h-b").addEventListener("change", e => { UI.h2hB = e.target.value; renderH2H(); });

/* one listener for every name, avatar, row and subject on the page */
document.addEventListener("click", async e => {
  if (e.target.closest("[data-close]") || e.target.id === "ov") { closeProfile(); return; }
  const mb = e.target.closest("[data-more]");
  if (mb) {
    const k = mb.dataset.more; UI.more[k] = !UI.more[k];
    ({ today: renderToday, feed: renderFeed, board: renderBoard })[k]();
    return;
  }
  const pr = e.target.closest("[data-profile]");
  if (pr && pr.dataset.profile) { openProfile(pr.dataset.profile); return; }
  const sj = e.target.closest("[data-subject]");
  if (sj) {
    UI.subject = sj.dataset.subject; UI.find = ""; $("lb-find").value = "";
    setTab("peloton"); window.scrollTo(0, 0);
    await loadSubject(UI.subject); renderPeloton();
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && openId) closeProfile(); });

/* tooltips for anything with data-tip, charts mostly */
const tip = $("tip");
document.addEventListener("mousemove", e => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + "px"; tip.style.top = (e.clientY + 16) + "px";
});

/* ------------------------------------------------------------------ start */
setTab((location.hash || "").slice(1));
(async () => {
  const [a, b] = await Promise.all([loadFull(), loadLive()]);
  if (a && b) renderAll();
  setInterval(async () => { if (!document.hidden && await loadLive()) renderLiveBits(); }, LIVE_MS);
  setInterval(async () => { if (!document.hidden && await loadFull()) renderAll(); }, FULL_MS);
  setInterval(tick, 1000);
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const stale = Date.now() - hiddenAt > FULL_MS;
    const ok = await (stale ? Promise.all([loadFull(), loadLive()]).then(r => r[0] && r[1]) : loadLive());
    if (ok) stale ? renderAll() : renderLiveBits();
  });
})();
