/* =========================================================================
   COHORT VIEW

   A read-only page for somebody who should be able to see how the year
   group is going without having an account — a teacher, most obviously.

   Everything comes from one call, cohort_view(token), which returns nothing
   at all unless the token after the # is one issued in view_links. The
   token never leaves the fragment except in that call: fragments are not
   sent to GitHub Pages and not put in a Referer.

   What this page can see is decided in the database, not here: no chat, no
   notes, no goals, and nobody who has switched on "hide my hours". See
   view.sql.
   ========================================================================= */
"use strict";

const CFG = window.CREW_CONFIG || {};
const REFRESH_MS = 30000;

/* Accept "#<uuid>" and "#k=<uuid>", and ignore anything else in the hash. */
const TOKEN = (location.hash.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0] || null;

/* persistSession off: this page shares an origin with the app, and must not
   pick up — or tidy away — the session of a student signed in on this browser. */
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f1 = n => (Math.round(n * 10) / 10).toLocaleString("en-AU", { maximumFractionDigits: 1 });
const f0 = n => Math.round(n).toLocaleString("en-AU");
const hrs = mins => mins / 60;

let DATA = null;
let skew = 0;          /* server clock minus ours, so live timers read true */
let lastOk = 0;

/* ------------------------------------------------------------------ dates */
/* Days arrive as "YYYY-MM-DD" in Sydney time; treat them as plain dates. */
const parseDay = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const dayDiff = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const dowShort = iso => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][parseDay(iso).getUTCDay()];
const dayLabel = iso => { const d = parseDay(iso); return d.getUTCDate() + " " +
  ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]; };

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
const avatar = p => `<span class="av" style="background:${/^#[0-9a-f]{6}$/i.test(p.colour) ? p.colour : "#5A6472"}">${esc(initials(p.name))}</span>`;

/* ---------------------------------------------------------------- loading */
async function load() {
  if (!TOKEN) { showGone(); return; }
  const t0 = Date.now();
  const { data, error } = await sb.rpc("cohort_view", { token: TOKEN });
  if (error) { markStale(); return; }
  if (!data) { showGone(); return; }
  skew = new Date(data.now).getTime() - (t0 + Date.now()) / 2;
  DATA = data; lastOk = Date.now();
  $("gone").hidden = true; $("main").hidden = false;
  render();
}

function showGone() {
  $("main").hidden = true; $("gone").hidden = false;
  const u = $("updated"); u.classList.add("stale"); u.lastElementChild.textContent = "Link not active";
}
function markStale() {
  const u = $("updated"); u.classList.add("stale");
  u.lastElementChild.textContent = lastOk ? "Reconnecting… last updated " + timeAgo(lastOk) : "Can't reach the server";
}
function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? "just now" : Math.round(s / 60) + " min ago";
}

/* ---------------------------------------------------------------- render */
function render() {
  const u = $("updated"); u.classList.remove("stale");
  u.lastElementChild.textContent = "Live · updated " + new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  renderCountdown(); renderLive(); renderKpis(); renderDaily(); renderSubjects(); renderHours(); renderBoard();
}

function renderCountdown() {
  const papers = ((window.HSC_CATALOGUE || {}).papers || []).map(p => p.date).sort();
  const el = $("countdown");
  if (!papers.length) { el.hidden = true; return; }
  const today = DATA.today, first = papers[0], last = papers[papers.length - 1];
  const n = dayDiff(today, first);
  if (n > 1)       el.textContent = n + " days to the first HSC exam";
  else if (n === 1) el.textContent = "First HSC exam tomorrow";
  else if (today <= last) el.textContent = "HSC exams underway";
  else { el.hidden = true; return; }
  el.hidden = false;
}

function renderLive() {
  const live = DATA.live || [];
  const running = live.filter(t => t.running);
  $("live-n").textContent = running.length;
  const rec = DATA.totals.live_record;
  $("live-sub").textContent = (live.length > running.length ? (live.length - running.length) + " paused · " : "") +
    (rec ? "Record: " + rec + " studying at once" : "Timers students are running at the moment");
  $("live-list").innerHTML = live.length ? live.map((t, i) => `
    <div class="lc${t.running ? "" : " paused"}">
      ${avatar(t)}
      <div class="who"><div class="nm">${esc(t.name)}</div><div class="what">${esc(t.label || "Study")}</div></div>
      <span class="t" data-i="${i}">${hms(elapsed(t))}</span>
    </div>`).join("")
    : `<p class="empty">Nobody has a timer running right now.</p>`;
}
const elapsed = t => Number(t.acc_ms || 0) + (t.running ? Date.now() + skew - new Date(t.started_at).getTime() : 0);

function tick() {
  if (!DATA) return;
  document.querySelectorAll(".lc .t").forEach(el => {
    const t = DATA.live[+el.dataset.i]; if (t && t.running) el.textContent = hms(elapsed(t));
  });
}

function renderKpis() {
  const T = DATA.totals;
  const wk = hrs(T.minutes_7d), prev = hrs(T.minutes_prev7);
  let delta = "";
  if (prev > 0) {
    const pct = (wk - prev) / prev * 100;
    delta = `<span class="${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "▲" : "▼"} ${f0(Math.abs(pct))}%</span> on the week before`;
  } else delta = "First full week of data";
  const perStudent = T.active_7d ? wk / T.active_7d : 0;
  const since = T.first_day ? "since " + dayLabel(T.first_day) : "";
  const cards = [
    { k: "Hours this week", v: f0(wk), d: delta },
    { k: "Students active this week", v: f0(T.active_7d) + `<small>/ ${f0(T.members)}</small>`,
      d: T.members ? f0(T.active_7d / T.members * 100) + "% of the cohort on the app" : "" },
    { k: "Average per active student", v: f1(perStudent) + "<small>h</small>", d: "over the last 7 days" },
    { k: "Total hours logged", v: f0(hrs(T.minutes_all)), d: f0(T.sessions_all) + " sessions " + since }
  ];
  $("kpis").innerHTML = cards.map(c =>
    `<div class="kpi"><div class="k">${c.k}</div><div class="v">${c.v}</div><div class="d">${c.d}</div></div>`).join("");
}

/* Hours as bars, students as a line on its own scale. Days before anybody
   used the app are dropped rather than drawn as a long flat nothing. */
function renderDaily() {
  const first = DATA.totals.first_day;
  const rows = (DATA.daily || []).filter(r => !first || r.day >= first);
  const W = 900, H = 280, L = 40, R = 40, T = 18, B = 42;
  const svg = $("daily");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (!rows.length) { svg.innerHTML = ""; return; }
  const ah = niceAxis(Math.max(1, ...rows.map(r => hrs(r.minutes))));
  const as = niceAxis(Math.max(1, ...rows.map(r => r.students)), ah.n);
  const maxH = ah.top, maxS = as.top;
  const cw = (W - L - R) / rows.length, bw = Math.min(34, cw * 0.66);
  const y = v => T + (H - T - B) * (1 - v / maxH);
  const ys = v => T + (H - T - B) * (1 - v / maxS);
  let g = "";
  for (let i = 0; i <= ah.n; i++) {
    const v = ah.step * i, yy = y(v);
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    g += `<text x="${L - 8}" y="${yy + 4}" text-anchor="end">${f0(v)}</text>`;
    g += `<text x="${W - R + 8}" y="${yy + 4}">${f1(as.step * i)}</text>`;
  }
  g += `<text x="${L - 8}" y="${T - 6}" text-anchor="end">h</text><text x="${W - R + 8}" y="${T - 6}">ppl</text>`;
  const every = rows.length > 20 ? 3 : rows.length > 12 ? 2 : 1;
  rows.forEach((r, i) => {
    const x = L + cw * i + (cw - bw) / 2, h = hrs(r.minutes), top = y(h);
    const today = r.day === DATA.today;
    g += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(0, H - B - top)}" rx="3" fill="${today ? "#FF7A4D" : "#E8402A"}" opacity="${today ? .55 : 1}"><title>${dowShort(r.day)} ${dayLabel(r.day)}: ${f1(h)} h, ${r.students} students${today ? " (so far)" : ""}</title></rect>`;
    if (h > 0 && rows.length <= 21) g += `<text class="val" x="${x + bw / 2}" y="${top - 5}" text-anchor="middle">${f0(h)}</text>`;
    if ((rows.length - 1 - i) % every === 0)
      g += `<text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle">${dowShort(r.day)}</text><text x="${x + bw / 2}" y="${H - B + 30}" text-anchor="middle">${dayLabel(r.day)}</text>`;
  });
  const pts = rows.map((r, i) => `${L + cw * i + cw / 2},${ys(r.students)}`).join(" ");
  g += `<polyline points="${pts}" fill="none" stroke="#2B6177" stroke-width="2" stroke-linejoin="round"/>`;
  rows.forEach((r, i) => { g += `<circle cx="${L + cw * i + cw / 2}" cy="${ys(r.students)}" r="3" fill="#fff" stroke="#2B6177" stroke-width="2"/>`; });
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg.innerHTML = g;
}

function renderSubjects() {
  const rows = (DATA.subjects || []).filter(s => s.m7 > 0).sort((a, b) => b.m7 - a.m7).slice(0, 12);
  if (!rows.length) { $("subjects").innerHTML = `<p class="empty">Nothing logged this week yet.</p>`; return; }
  const max = rows[0].m7;
  $("subjects").innerHTML = rows.map(s => `
    <div class="sr" title="${esc(s.label)}: ${f1(hrs(s.m7))} h this week, ${f0(hrs(s.mall))} h all time">
      <div class="l">${esc(s.label)}<small>${s.students}</small></div>
      <div class="track"><div class="fill" style="width:${(s.m7 / max * 100).toFixed(1)}%"></div></div>
      <div class="h">${f0(hrs(s.m7))} h</div>
    </div>`).join("");
}

function renderHours() {
  const byHour = new Map((DATA.by_hour || []).map(r => [r.hour, Number(r.avg_peak)]));
  const vals = Array.from({ length: 24 }, (_, h) => byHour.get(h) || 0);
  const svg = $("hours");
  const W = 620, H = 240, L = 30, R = 10, T = 14, B = 30;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const peak = Math.max(...vals);
  if (!peak) { svg.innerHTML = ""; $("hours-note").textContent = "Not enough data yet."; return; }
  const ax = niceAxis(peak), max = ax.top, cw = (W - L - R) / 24, bw = cw * 0.72;
  const y = v => T + (H - T - B) * (1 - v / max);
  const peakH = vals.indexOf(peak);
  let g = "";
  for (let i = 0; i <= ax.n; i++) {
    const v = ax.step * i;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${f1(v)}</text>`;
  }
  vals.forEach((v, h) => {
    const x = L + cw * h + (cw - bw) / 2;
    g += `<rect x="${x}" y="${y(v)}" width="${bw}" height="${H - B - y(v)}" rx="2" fill="${h === peakH ? "#E8402A" : "#2B6177"}" opacity="${h === peakH ? 1 : .75}"><title>${hourLabel(h)}: ${f1(v)} on average</title></rect>`;
    if (h % 3 === 0) g += `<text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle">${hourLabel(h)}</text>`;
  });
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg.innerHTML = g;
  $("hours-note").textContent = `Busiest around ${hourLabel(peakH)}–${hourLabel((peakH + 1) % 24)}, with ${f1(peak)} studying at once on average.`;
}
const hourLabel = h => (h % 12 || 12) + (h < 12 ? "am" : "pm");

function renderBoard() {
  const rows = DATA.leaders || [];
  $("board").innerHTML = rows.length ? rows.map((r, i) => `
    <tr>
      <td class="rk">${i + 1}</td>
      <td><span class="st">${avatar(r)}${esc(r.name)}</span></td>
      <td class="n"><b>${f1(hrs(r.m7))} h</b></td>
      <td class="n">${r.days7} / 7</td>
      <td class="n wide">${f0(hrs(r.mall))} h</td>
    </tr>`).join("")
    : `<tr><td colspan="5" class="empty">Nothing logged this week yet.</td></tr>`;
}

/* An axis that tops out on a round number, split into steps that are round
   too: 1, 2, 2.5 or 5 times a power of ten. Asking for a fixed number of steps
   lets a second axis share the first one's gridlines. */
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function niceAxis(max, steps) {
  const step = niceStep(Math.max(max, 1e-9) / (steps || 4));
  const n = steps || Math.max(1, Math.ceil(max / step));
  return { top: step * n, step, n };
}

/* ------------------------------------------------------------------ start */
load();
if (TOKEN) {
  sb.rpc("cohort_seen", { token: TOKEN }).then(() => {}, () => {});
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  window.addEventListener("hashchange", () => location.reload());
}
