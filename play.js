/* =========================================================================
   PLAY — levels, achievements, the study clock, and the year group's patterns
   -------------------------------------------------------------------------
   Everything here is drawn from data the app already holds (your own sessions,
   the daily rollup, whoever's profile is open) plus four read-only functions
   in stats.sql. Nothing in this file writes to the database.

   THE RULES IT PLAYS BY
   · Levels count at most 8 hours a day. An 11-hour day earns what an 8-hour
     day does, so the way to level up is to come back tomorrow, not to stay up.
   · No badge rewards studying late at night. One rewards not doing it.
   · Private mode is respected: nobody in it gets a level, a badge or a place
     on any board here, except on their own screen.
   · Somebody hiding other people's hours sees none of the year-group cards.

   app.js calls into this file through a handful of globals, each guarded so
   the app still works if this file fails to load:
     playRender()            after every renderAll
     playProfileHTML(id,all) inside a profile, under the live card
     playAfterProfile(id)    once the profile is on screen
     playLevelTag(id)        the level pill beside a name on the leaderboard
     playRankToday()         your place today, for the masthead chip
   ========================================================================= */

/* ---------------------------------------------------------------------------
   LEVELS
   Thresholds set from the real spread on 1 October: half the year group had
   between 5 and 50 capped hours, the top handful just over 100. That leaves
   Band 6 and HSC Legend genuinely ahead of everybody with five weeks to go,
   and both reachable at four or five hours a day.
   --------------------------------------------------------------------------- */
const PL_DAY_CAP = 8;
const PL_LEVELS = [
  { n: 1, name: "Rookie",     at: 0,   col: "#8B94A3" },
  { n: 2, name: "Starter",    at: 5,   col: "#5B8DB8" },
  { n: 3, name: "Regular",    at: 15,  col: "#2E9C7A" },
  { n: 4, name: "Committed",  at: 30,  col: "#2F6FDB" },
  { n: 5, name: "Locked In",  at: 50,  col: "#E8402A" },
  { n: 6, name: "Scholar",    at: 75,  col: "#7A4FD6" },
  { n: 7, name: "Elite",      at: 100, col: "#C98A0B" },
  { n: 8, name: "Band 6",     at: 150, col: "#0F8FA0" },
  { n: 9, name: "HSC Legend", at: 200, col: "#D6336C" }
];

/* Colour themes, one more at each level. They only repaint the brand accent;
   the attainment colours (goal met, under 40%...) are data and never change. */
const PL_THEMES = [
  { id: "ember",    name: "Ember",    lvl: 1, a: "#E8402A", a2: "#FF7A4D", ink: "#B02B18", wash: "#FFF1ED" },
  { id: "ocean",    name: "Ocean",    lvl: 2, a: "#1F6FD1", a2: "#4D9BFF", ink: "#15539F", wash: "#EDF4FF" },
  { id: "forest",   name: "Forest",   lvl: 3, a: "#138A5E", a2: "#36BE8A", ink: "#0B6143", wash: "#E8F6F0" },
  { id: "grape",    name: "Grape",    lvl: 4, a: "#7046D6", a2: "#9E7BFF", ink: "#5230A8", wash: "#F3EEFF" },
  { id: "gold",     name: "Gold",     lvl: 5, a: "#C98A0B", a2: "#F2B53A", ink: "#8C5F05", wash: "#FFF7E3" },
  { id: "rose",     name: "Rose",     lvl: 6, a: "#D6336C", a2: "#FF6B9A", ink: "#A11F4E", wash: "#FFEEF4" },
  { id: "midnight", name: "Midnight", lvl: 7, a: "#2D3D78", a2: "#5B74C9", ink: "#1E2A57", wash: "#EEF1FA" },
  { id: "lagoon",   name: "Lagoon",   lvl: 8, a: "#0B8EA0", a2: "#2FC9D9", ink: "#086A77", wash: "#E6F8FA" },
  { id: "aurora",   name: "Aurora",   lvl: 9, a: "#B4339C", a2: "#FF7A4D", ink: "#83206F", wash: "#FCEEF8" }
];

/* ---------------------------------------------------------------------------
   Small things
   --------------------------------------------------------------------------- */
const plStore = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } }
};
const plMins = m => {
  m = Math.round(m);
  if (m < 1) return "0m";
  return m < 60 ? m + "m" : Math.floor(m / 60) + "h" + (m % 60 ? " " + (m % 60) + "m" : "");
};
const plHourName = h => (h % 12 || 12) + (h < 12 ? "am" : "pm");
const plHourSpan = h => plHourName(h) + "–" + plHourName((h + 1) % 24);
const PL_DOW_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const plVisible = id => {
  const p = DB.profiles.find(x => x.id === id);
  return !!p && (id === UID || !p.hide_hours);
};
function plNice(v) {
  const steps = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1500, 1800, 2400, 3000];
  return steps.find(s => s >= v) || Math.ceil(v / 600) * 600;
}
function plColourOfSubject(key, sessionsOwner) {
  if (key === "live") return null;
  const s = subjById(key);
  if (s && s.colour) return s.colour;
  return "#9AA4B2";
}

/* ---------------------------------------------------------------------------
   WHERE THE TIME OF DAY COMES FROM
   A session is filed when it ends, so it covered the stretch before
   created_at. Spread across the clock hours it touched, that is exact for a
   timed session. One typed in for a different day says nothing about the
   time of day, so it counts towards the day's total but no hour.
   --------------------------------------------------------------------------- */
function plSegments(sessions, withLive) {
  const out = [];
  (sessions || []).forEach(s => {
    const m = Number(s.minutes);
    if (!(m > 0 && m <= 600) || !s.created_at) return;
    const end = new Date(s.created_at).getTime(), start = end - m * 60000;
    const ed = isoOf(new Date(end)), sd = isoOf(new Date(start));
    if (sd !== s.day && ed !== s.day && ed !== addDays(s.day, 1)) return;
    out.push({ start, end, key: s.subject_id || "none", min: m });
  });
  if (withLive && typeof localTimer !== "undefined" && localTimer) {
    const ms = liveMsFor(UID);
    if (ms > 0) {
      const now = Date.now();
      /* The part since the last resume is exact; anything from before a pause
         is put just before it, which is where it almost always was. */
      const runMs = localTimer.running ? Math.min(ms, now - new Date(localTimer.started_at).getTime()) : 0;
      const runStart = now - runMs;
      out.push({ start: runStart - (ms - runMs), end: now, key: localTimer.subject_id || "none", min: ms / 60000, live: true });
    }
  }
  return out;
}
/* day -> 24 hours -> { subjectKey: minutes } */
function plSpread(segs) {
  const out = {};
  segs.forEach(x => {
    let t = x.start, guard = 0;
    while (t < x.end && guard++ < 30) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const seg = Math.min(next, x.end) - t;
      const day = isoOf(d);
      const row = out[day] || (out[day] = Array.from({ length: 24 }, () => ({})));
      const k = x.live ? x.key + "|live" : x.key;
      row[d.getHours()][k] = (row[d.getHours()][k] || 0) + seg / 60000;
      t = next;
    }
  });
  return out;
}

/* ---------------------------------------------------------------------------
   Server numbers. Asked for once, then at most every ten minutes.
   --------------------------------------------------------------------------- */
const PL = {
  clock: null, clockAt: 0, clockBusy: false,
  subjects: { 7: null, 30: null }, subjectsAt: { 7: 0, 30: 0 }, subjRange: 7,
  kudos: null, kudosAt: 0, kudosTab: "received",
  badgeStats: {},            /* uid -> {kudos_received, kudos_given} | null */
  badgeAt: {},
  dayView: "day", dayCursor: null, weekCursor: null,
  clockWho: "all",
  shownAch: false,
  levelBoardOpen: null
};
const PL_STALE = 10 * 60e3;

async function plRpc(name, args) {
  if (typeof sb === "undefined" || !sb) return null;
  try {
    const { data, error } = await sb.rpc(name, args);
    if (error) { console.warn(name, error.message); return null; }
    return data;
  } catch (e) { console.warn(name, e); return null; }
}
function plClockSince() { return addDays(todayISO(), -27); }

async function plLoadClock(force) {
  if (PL.clockBusy || (!force && PL.clock && Date.now() - PL.clockAt < PL_STALE)) return;
  PL.clockBusy = true;
  const d = await plRpc("crew_clock", { since: plClockSince() });
  PL.clockBusy = false;
  if (!d) return;
  const cells = Array.from({ length: 7 }, () => new Array(24).fill(0));
  (d.cells || []).forEach(c => { if (cells[c[0]]) cells[c[0]][c[1]] = Number(c[2]) || 0; });
  const byDow = new Array(7).fill(0);
  Object.keys(d.student_days_by_dow || {}).forEach(k => { byDow[Number(k)] = Number(d.student_days_by_dow[k]) || 0; });
  PL.clock = { cells, byDow, total: Number(d.student_days) || 0 };
  PL.clockAt = Date.now();
  plPaintDay(); plPaintClock();
}
async function plLoadSubjects(range, force) {
  if (!force && PL.subjects[range] && Date.now() - PL.subjectsAt[range] < PL_STALE) return;
  PL.subjectsAt[range] = Date.now();
  const d = await plRpc("crew_subject_hours", { since: addDays(todayISO(), -(range - 1)) });
  if (!d) { PL.subjectsAt[range] = 0; return; }
  PL.subjects[range] = d;
  plPaintBattle();
}
async function plLoadKudos(force) {
  if (!force && PL.kudos && Date.now() - PL.kudosAt < PL_STALE) return;
  PL.kudosAt = Date.now();
  const d = await plRpc("kudos_board", { since: addDays(todayISO(), -6) });
  if (!d) { PL.kudosAt = 0; return; }
  PL.kudos = d;
  plPaintKudos();
}
async function plLoadBadgeStats(uid, force) {
  if (!force && PL.badgeAt[uid] && Date.now() - PL.badgeAt[uid] < PL_STALE) return PL.badgeStats[uid];
  PL.badgeAt[uid] = Date.now();
  const d = await plRpc("badge_stats", { uid });
  PL.badgeStats[uid] = d || null;
  return PL.badgeStats[uid];
}

/* ---------------------------------------------------------------------------
   LEVELS — from the daily rollup, so everybody's can be worked out here
   --------------------------------------------------------------------------- */
function plCappedHours(uid) {
  const e = DB.daily.get(uid);
  if (!e || !e.days) return uid === UID ? Math.min(PL_DAY_CAP, liveMsFor(UID) / 3600000) : 0;
  const today = todayISO();
  let h = 0;
  Object.keys(e.days).forEach(d => { if (d !== today) h += Math.min(PL_DAY_CAP, e.days[d][0] / 60); });
  h += Math.min(PL_DAY_CAP, dayCell(uid, today)[0] / 60);
  return h;
}
function plLevel(uid) {
  const h = plCappedHours(uid);
  let i = 0;
  PL_LEVELS.forEach((L, j) => { if (h >= L.at) i = j; });
  const L = PL_LEVELS[i], N = PL_LEVELS[i + 1] || null;
  return { ...L, h, next: N, pct: N ? (h - L.at) / (N.at - L.at) : 1, toGo: N ? N.at - h : 0 };
}
function plLevelBadge(L, cls) {
  return `<span class="pl-lv ${cls || ""}" style="--lv:${L.col}" title="Level ${L.n} · ${esc(L.name)}">${L.n}</span>`;
}
function playLevelTag(id) {
  if (!UID || !plVisible(id)) return "";
  if (id !== UID && hidingOthers()) return "";
  const L = plLevel(id);
  return `<span class="pl-tag" style="--lv:${L.col}" title="Level ${L.n} · ${esc(L.name)} · ${f0(L.h)} capped hours">Lv ${L.n}</span>`;
}

/* ---------------------------------------------------------------------------
   THEMES
   --------------------------------------------------------------------------- */
function plApplyTheme(id) {
  const t = PL_THEMES.find(x => x.id === id) || PL_THEMES[0];
  const r = document.documentElement;
  if (t.id === "ember") {
    ["--accent", "--accent-2", "--accent-ink", "--accent-wash"].forEach(k => r.style.removeProperty(k));
    delete r.dataset.accent;
  } else {
    r.style.setProperty("--accent", t.a); r.style.setProperty("--accent-2", t.a2);
    r.style.setProperty("--accent-ink", t.ink); r.style.setProperty("--accent-wash", t.wash);
    r.dataset.accent = t.id;
  }
}
function plThemeKey() { return "st.theme." + (UID || "anon"); }
function plCurrentTheme() {
  const id = plStore.get(plThemeKey(), "ember");
  const t = PL_THEMES.find(x => x.id === id);
  if (!t) return "ember";
  /* a theme you have not unlocked yet (a shared laptop, say) falls back */
  if (UID && plLevel(UID).n < t.lvl) return "ember";
  return id;
}

/* ---------------------------------------------------------------------------
   ACHIEVEMENTS
   Thresholds set from the real data: the median member had a 4-day longest
   run and 103 kudos received; the top tenth 10 days and 173. Early bird is
   meant to be rare (seven people had it on day one). Every hours badge uses
   capped hours, like levels.
   --------------------------------------------------------------------------- */
const PL_ICONS = {
  clock:  '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flame:  '<path d="M12 3.5c.6 3.2 4.6 4.7 4.6 9.3a4.6 4.6 0 0 1-9.2 0c0-2.4 1.3-3.6 2-5 .9 1 1.6 2.1 1.8 3 .8-2.2 1.4-4.6.8-7.3z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.3"/>',
  paper:  '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15h6M9.5 18h3.5"/>',
  sun:    '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  moon:   '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  bolt:   '<path d="M13 2.8 5.5 13.2h5.6L10.4 21.2 18.5 10.4h-5.7z"/>',
  heart:  '<path d="M12 19.5s-7.5-4.5-7.5-10A4 4 0 0 1 12 7.2a4 4 0 0 1 7.5 2.3c0 5.5-7.5 10-7.5 10z"/>',
  gift:   '<path d="M4.5 10h15v3.5h-15zM6 13.5h12v7H6zM12 10v10.5M12 10c-1.5-3.5-5-4-5-1.6C7 10 12 10 12 10zM12 10c1.5-3.5 5-4 5-1.6C17 10 12 10 12 10z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.8a3 3 0 0 0 3.4 4M16 6h3.2a3 3 0 0 1-3.4 4M12 13v4M8.5 20h7M9.5 17h5v3h-5z"/>',
  star:   '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  leaf:   '<path d="M5 19c0-8 5-13.5 14-14-.5 9-6 14-14 14zM5 19l7-7"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
  cal:    '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8 14h2M11.5 14h2M15 14h1.5M8 17h2M11.5 17h2"/>',
  seed:   '<path d="M12 20.5v-7M12 13.5c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 15.5c0-3-2.3-5-5.5-5 0 3 2.3 5 5.5 5z"/>',
  crown:  '<path d="m4 8 4 4 4-6 4 6 4-4-1.6 10H5.6z"/><path d="M5.6 20.5h12.8"/>',
  medal:  '<circle cx="12" cy="15" r="5"/><path d="M8.5 3.5 10.5 10M15.5 3.5 13.5 10M8 3.5h8"/>'
};
const PL_TIER = { b: { name: "Bronze", col: "#B07A45" }, s: { name: "Silver", col: "#8995A6" }, g: { name: "Gold", col: "#C9961A" }, p: { name: "Platinum", col: "#2FA7B8" } };

/* Each test gets the facts object built by plFacts and returns [have, need]. */
const PL_ACH = [
  { id: "first",    icon: "seed",   tier: "b", name: "Day one",          desc: "Log your first session",                    t: f => [f.sessions, 1] },
  { id: "h10",      icon: "clock",  tier: "b", name: "Ten down",         desc: "10 hours of study",                         t: f => [f.capped, 10] },
  { id: "h25",      icon: "clock",  tier: "b", name: "Quarter century",  desc: "25 hours of study",                         t: f => [f.capped, 25] },
  { id: "h50",      icon: "clock",  tier: "s", name: "Half ton",         desc: "50 hours of study",                         t: f => [f.capped, 50] },
  { id: "h100",     icon: "clock",  tier: "g", name: "Centurion",        desc: "100 hours of study",                        t: f => [f.capped, 100] },
  { id: "h150",     icon: "crown",  tier: "p", name: "Band 6 hours",     desc: "150 hours of study",                        t: f => [f.capped, 150] },
  { id: "r3",       icon: "flame",  tier: "b", name: "Warming up",       desc: "Study 3 days in a row",                     t: f => [f.bestRun, 3] },
  { id: "r7",       icon: "flame",  tier: "s", name: "Full week",        desc: "Study 7 days in a row",                     t: f => [f.bestRun, 7] },
  { id: "r14",      icon: "flame",  tier: "g", name: "Fortnight",        desc: "Study 14 days in a row",                    t: f => [f.bestRun, 14] },
  { id: "r21",      icon: "flame",  tier: "p", name: "Unbroken",         desc: "Study 21 days in a row",                    t: f => [f.bestRun, 21] },
  { id: "g1",       icon: "target", tier: "b", name: "On target",        desc: "Hit your daily goal",                       t: f => [f.goalsHit, 1] },
  { id: "g10",      icon: "target", tier: "s", name: "Reliable",         desc: "Hit your daily goal on 10 days",            t: f => [f.goalsHit, 10] },
  { id: "g25",      icon: "target", tier: "g", name: "Clockwork",        desc: "Hit your daily goal on 25 days",            t: f => [f.goalsHit, 25] },
  { id: "pp1",      icon: "paper",  tier: "b", name: "Exam conditions",  desc: "Log a past paper session",                  t: f => [f.papers, 1] },
  { id: "pp10",     icon: "paper",  tier: "s", name: "Paper trail",      desc: "10 past paper sessions",                    t: f => [f.papers, 10] },
  { id: "pp25",     icon: "paper",  tier: "g", name: "Exam ready",       desc: "25 past paper sessions",                    t: f => [f.papers, 25] },
  { id: "deep",     icon: "bolt",   tier: "b", name: "Deep work",        desc: "A single session of 90 minutes or more",    t: f => [f.deep, 1] },
  { id: "deep10",   icon: "bolt",   tier: "s", name: "Deep focus",       desc: "10 sessions of 90 minutes or more",         t: f => [f.deep, 10] },
  { id: "allround", icon: "layers", tier: "s", name: "All-rounder",      desc: "5 hours in every one of your subjects",     t: f => [f.allRound, 1] },
  { id: "early",    icon: "sun",    tier: "g", name: "Early bird",       desc: "Start 5 sessions before 8am",               t: f => [f.early, 5] },
  { id: "week20",   icon: "cal",    tier: "s", name: "Big week",         desc: "20 hours in one Monday-to-Sunday week",      t: f => [f.bestWeek, 20] },
  { id: "week30",   icon: "cal",    tier: "g", name: "Huge week",        desc: "30 hours in one Monday-to-Sunday week",      t: f => [f.bestWeek, 30] },
  { id: "rest",     icon: "leaf",   tier: "s", name: "Recharged",        desc: "Take a day off after 6 or more in a row",   t: f => [f.recharged, 1] },
  { id: "lights",   icon: "moon",   tier: "s", name: "Lights out",       desc: "Study 5 days in a week, none of it after 11pm", t: f => [f.lightsOut, 1] },
  { id: "top10",    icon: "medal",  tier: "s", name: "Top ten",          desc: "Finish a day in the year group's top 10",   t: f => [f.top10, 1] },
  { id: "podium",   icon: "trophy", tier: "g", name: "Podium",           desc: "Finish a day in the top 3",                 t: f => [f.podium, 1] },
  { id: "first1",   icon: "crown",  tier: "p", name: "Number one",       desc: "Finish a day first in the year group",      t: f => [f.won, 1] },
  { id: "kr50",     icon: "heart",  tier: "b", name: "Appreciated",      desc: "Receive 50 kudos",                          t: f => [f.kr, 50], kudos: true },
  { id: "kr100",    icon: "heart",  tier: "s", name: "Fan favourite",    desc: "Receive 100 kudos",                         t: f => [f.kr, 100], kudos: true },
  { id: "kr200",    icon: "heart",  tier: "g", name: "Crowd pleaser",    desc: "Receive 200 kudos",                         t: f => [f.kr, 200], kudos: true },
  { id: "kg50",     icon: "gift",   tier: "b", name: "Supporter",        desc: "Give 50 kudos",                             t: f => [f.kg, 50], kudos: true },
  { id: "kg250",    icon: "gift",   tier: "g", name: "Hype machine",     desc: "Give 250 kudos",                            t: f => [f.kg, 250], kudos: true }
];

/* Where somebody finished each past day, worked out once per rollup. */
let PL_RANKS = { sig: "", best: {} };
function plDayRanks() {
  const sig = DB.daily.size + ":" + todayISO() + ":" + DB.profiles.length + ":" + (DB.daily.get(UID) ? Object.keys(DB.daily.get(UID).days).length : 0);
  if (PL_RANKS.sig === sig) return PL_RANKS.best;
  const byDay = {};
  DB.daily.forEach((e, uid) => {
    if (!plVisible(uid) || !e || !e.days) return;
    Object.keys(e.days).forEach(d => {
      if (d >= todayISO()) return;
      const m = e.days[d][0];
      if (m > 0) (byDay[d] = byDay[d] || []).push([uid, m]);
    });
  });
  const best = {};   /* uid -> { rank, day } */
  Object.keys(byDay).forEach(d => {
    const list = byDay[d].sort((a, b) => b[1] - a[1]);
    /* a day needs a real field to count: ten people at least */
    if (list.length < 10) return;
    list.forEach(([uid], i) => {
      const r = i + 1;
      if (!best[uid] || r < best[uid].rank) best[uid] = { rank: r, day: d };
    });
  });
  PL_RANKS = { sig, best };
  return best;
}

function plFacts(uid, sessions) {
  const e = DB.daily.get(uid);
  const days = e && e.days ? e.days : {};
  const today = todayISO();
  const dayH = d => (d === today ? dayCell(uid, d)[0] : ((days[d] || [0])[0])) / 60;
  const studied = Object.keys(days).filter(d => days[d][0] >= 15).sort();
  if (dayCell(uid, today)[0] >= 15 && studied.indexOf(today) < 0) studied.push(today);

  /* longest run of days with at least 15 minutes */
  let bestRun = 0, run = 0, prev = null, recharged = 0;
  studied.forEach(d => {
    if (prev && addDays(prev, 1) === d) run++;
    else {
      /* a single day off straight after six or more in a row, then back */
      if (prev && run >= 6 && addDays(prev, 2) === d) recharged = 1;
      run = 1;
    }
    bestRun = Math.max(bestRun, run);
    prev = d;
  });

  let goalsHit = 0;
  Object.keys(days).forEach(d => { const g = goalFor(uid, d); if (g > 0 && dayH(d) >= g) goalsHit++; });
  if (!days[today]) { const g = goalFor(uid, today); if (g > 0 && dayH(today) >= g) goalsHit++; }

  /* best Monday-to-Sunday week, capped like levels */
  const weeks = {};
  Object.keys(days).forEach(d => {
    const wk = addDays(d, -dowIdx(d));
    weeks[wk] = (weeks[wk] || 0) + Math.min(PL_DAY_CAP, dayH(d));
  });
  if (!days[today]) { const wk = addDays(today, -dowIdx(today)); weeks[wk] = (weeks[wk] || 0) + Math.min(PL_DAY_CAP, dayH(today)); }
  const bestWeek = Math.max(0, ...Object.values(weeks));

  const list = sessions || [];
  const areas = myAreas(uid);
  const paperAreas = new Set(areas.filter(a => /past\s*paper|practice\s*paper|trial\s*paper/i.test(a.name)).map(a => a.id));
  const papers = list.filter(s => paperAreas.has(s.area_id) || /past\s*paper/i.test(s.note || "")).length;
  const deep = list.filter(s => s.minutes >= 90 && s.minutes <= 240).length;

  let early = 0;
  const lateWeeks = new Set(), weekDays = {};
  list.forEach(s => {
    if (!s.created_at || !(s.minutes > 0)) return;
    const end = new Date(s.created_at), start = new Date(end.getTime() - s.minutes * 60000);
    if (isoOf(end) !== s.day && isoOf(start) !== s.day && isoOf(end) !== addDays(s.day, 1)) return;
    if (start.getHours() >= 4 && start.getHours() < 8) early++;
    const wk = addDays(s.day, -dowIdx(s.day));
    (weekDays[wk] = weekDays[wk] || new Set()).add(s.day);
    const eh = end.getHours() + end.getMinutes() / 60;
    if (eh >= 23 || eh < 4) lateWeeks.add(wk);
  });
  const thisWeek = addDays(today, -dowIdx(today));
  const lightsOut = Object.keys(weekDays).some(wk => wk < thisWeek && weekDays[wk].size >= 5 && !lateWeeks.has(wk)) ? 1 : 0;

  const subs = mySubjects(uid);
  const bySub = {};
  list.forEach(s => { if (s.subject_id) bySub[s.subject_id] = (bySub[s.subject_id] || 0) + s.minutes / 60; });
  const allRound = subs.length >= 3 && subs.every(s => (bySub[s.id] || 0) >= 5) ? 1 : 0;

  const r = plDayRanks()[uid];
  const ks = PL.badgeStats[uid];
  return {
    sessions: list.length || (e && e.first_day ? 1 : 0),
    capped: plCappedHours(uid), bestRun, goalsHit, papers, deep, early, bestWeek,
    recharged, lightsOut, allRound,
    top10: r && r.rank <= 10 ? 1 : 0, podium: r && r.rank <= 3 ? 1 : 0, won: r && r.rank === 1 ? 1 : 0,
    bestRank: r || null,
    kr: ks ? Number(ks.kudos_received) || 0 : 0, kg: ks ? Number(ks.kudos_given) || 0 : 0,
    kudosKnown: !!ks
  };
}
function plAchievements(uid, sessions) {
  const f = plFacts(uid, sessions);
  return { f, list: PL_ACH.map(a => {
    const [have, need] = a.t(f);
    return { ...a, have, need, done: have >= need, pct: Math.max(0, Math.min(1, have / need)), unknown: a.kudos && !f.kudosKnown };
  }) };
}
function plIcon(name, size) {
  return `<svg viewBox="0 0 24 24" width="${size || 22}" height="${size || 22}" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PL_ICONS[name] || PL_ICONS.star}</svg>`;
}
function plMedal(a, size) {
  const T = PL_TIER[a.tier];
  return `<span class="pl-medal ${a.done ? "on" : "off"}" style="--tier:${T.col}${size ? ";--ms:" + size + "px" : ""}">${plIcon(a.icon, size ? Math.round(size * .52) : 22)}</span>`;
}
function plProgressText(a) {
  if (a.done) return "Unlocked";
  if (a.unknown) return "—";
  const fmt = v => (a.id.startsWith("h") || a.id.startsWith("week")) ? f0(Math.floor(v)) : f0(v);
  return `${fmt(a.have)} / ${a.need}`;
}

/* ---------------------------------------------------------------------------
   YOUR DAY — the Screen Time chart
   --------------------------------------------------------------------------- */
function plTypicalLine(dow) {
  const C = PL.clock;
  if (!C) return null;
  if (dow === null) {
    const tot = C.total || 1;
    return Array.from({ length: 24 }, (_, h) => C.cells.reduce((a, row) => a + row[h], 0) / tot);
  }
  const n = C.byDow[dow] || 0;
  if (n < 5) return null;
  return C.cells[dow].map(v => v / n);
}

/* 24 stacked bars. rows[h] = [[colour, minutes, label], ...] */
/* Charts are drawn at the width they will be shown at, so the axis text stays
   11px on a laptop and a phone alike rather than scaling with the box. */
function plWidth(box) {
  const w = box && box.clientWidth;
  return w && w > 200 ? Math.round(w) : 720;
}
function plHourChart(rows, opts) {
  const W = opts.w || 720, H = opts.h || (W < 520 ? 180 : 220), L = 40, R = 8, T = 10, B = 24;
  const iw = W - L - R, ih = H - T - B, bw = iw / 24;
  const tot = rows.map(r => r.reduce((a, x) => a + x[1], 0));
  const line = opts.line || null;
  const max = opts.max || plNice(Math.max(5, ...tot, ...(line || [0])) * 1.08);
  const y = v => T + ih - (v / max) * ih;
  let g = "";
  const ticks = [0, max / 2, max];
  ticks.forEach(v => {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="pl-grid${v === 0 ? " base" : ""}"/>`;
    g += `<text x="${L - 7}" y="${y(v) + 4}" text-anchor="end" class="pl-ax">${v === 0 ? "0" : plMins(v)}</text>`;
  });
  [0, 6, 12, 18].forEach(h => {
    g += `<line x1="${L + h * bw}" x2="${L + h * bw}" y1="${T}" y2="${T + ih}" class="pl-grid v"/>`;
    g += `<text x="${L + h * bw + 2}" y="${H - 6}" class="pl-ax">${plHourName(h)}</text>`;
  });
  if (opts.nowHour !== undefined && opts.nowHour !== null)
    g += `<rect x="${L + opts.nowHour * bw}" y="${T}" width="${bw}" height="${ih}" class="pl-now"/>`;
  rows.forEach((r, h) => {
    let acc = 0;
    const x = L + h * bw + bw * .16, w = bw * .68;
    r.forEach((seg, j) => {
      const v = seg[1]; if (v <= 0) return;
      const y0 = y(acc + v), hh = Math.max(1.2, y(acc) - y(acc + v));
      const top = j === r.length - 1 || r.slice(j + 1).every(s => s[1] <= 0);
      g += `<rect x="${x}" y="${y0}" width="${w}" height="${hh}" fill="${seg[0]}" ${top ? `rx="2.5"` : ""} class="${seg[3] ? "pl-livebar" : ""}"/>`;
      acc += v;
    });
  });
  if (line) {
    const pts = line.map((v, h) => `${L + h * bw + bw / 2},${y(v)}`).join(" ");
    g += `<polyline points="${pts}" class="pl-typ"/>`;
  }
  rows.forEach((_, h) => {
    g += `<rect x="${L + h * bw}" y="${T}" width="${bw}" height="${ih}" fill="transparent" data-plh="${h}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="pl-chart" role="img" aria-label="${esc(opts.label || "Minutes in each hour of the day")}">${g}</svg>`;
}

function plSubjectName(key) {
  const k = String(key).split("|")[0];
  if (k === "none") return "Study";
  const s = subjById(k);
  return s ? s.name : "Study";
}
function plRowsFor(dayRow) {
  return dayRow.map(cell => Object.keys(cell)
    .sort((a, b) => plSubjectName(a).localeCompare(plSubjectName(b)) || (a.endsWith("|live") ? 1 : -1))
    .map(k => {
      const base = k.split("|")[0];
      return [plColourOfSubject(base) || "#9AA4B2", cell[k], plSubjectName(k), k.endsWith("|live")];
    }));
}

function plPaintDay() {
  const host = $("pl-day");
  if (!host || !UID) return;
  const view = PL.dayView;
  host.querySelectorAll("[data-plview]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.plview === view)));
  host.querySelector("[data-plnav='-1']").disabled = view === "pattern";
  if (view === "day") plPaintDayView(host);
  else if (view === "week") plPaintWeekView(host);
  else plPaintPatternView(host);
}

function plPaintDayView(host) {
  const today = todayISO();
  const day = PL.dayCursor || today;
  const segs = plSegments(DB.sessions.filter(s => s.user_id === UID), day === today);
  const spread = plSpread(segs);
  const row = spread[day] || Array.from({ length: 24 }, () => ({}));
  const rows = plRowsFor(row);
  const tots = rows.map(r => r.reduce((a, x) => a + x[1], 0));
  const placed = tots.reduce((a, b) => a + b, 0);
  const total = minutesOn(UID, day);
  const line = plTypicalLine(dowIdx(day));
  const nowH = day === today ? new Date().getHours() : null;

  host.querySelector(".pl-dnav b").textContent =
    day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : fmtD(day);
  host.querySelector("[data-plnav='1']").disabled = day >= today;
  host.querySelector(".pl-dbig").innerHTML = `${esc(hm(total / 60))}${
    liveMsFor(UID) && day === today ? ` <span class="pl-livechip"><i></i>timer counted in</span>` : ""}`;

  /* the insights row */
  const daySessions = DB.sessions.filter(s => s.user_id === UID && s.day === day);
  const peak = tots.indexOf(Math.max(...tots));
  const daySegs = segs.filter(x => isoOf(new Date(x.end - 1)) === day || isoOf(new Date(x.start)) === day);
  const first = daySegs.length ? new Date(Math.min(...daySegs.map(x => x.start))) : null;
  const last = daySegs.length ? new Date(Math.max(...daySegs.map(x => x.end))) : null;
  const longest = Math.max(0, ...daySessions.map(s => s.minutes), ...segs.filter(x => x.live).map(x => x.min));
  const typTotal = line ? line.reduce((a, b) => a + b, 0) : null;
  const facts = [
    ["Busiest hour", placed > 0 ? plHourSpan(peak) : "—"],
    ["Started", first ? clockOf(first) : "—"],
    ["Finished", last ? (day === today && liveMsFor(UID) ? "still going" : clockOf(last)) : "—"],
    ["Longest session", longest ? plMins(longest) : "—"]
  ];
  host.querySelector(".pl-facts").innerHTML = facts.map(f =>
    `<div><span>${f[0]}</span><b>${esc(f[1])}</b></div>`).join("");

  host.querySelector(".pl-chartbox").innerHTML = plHourChart(rows, { line, max: 60, nowHour: nowH, w: plWidth(host.querySelector(".pl-chartbox")),
    label: "Your study in each hour of " + fmtLong(day) });

  /* subject legend, Screen Time style */
  const bySub = {};
  rows.forEach(r => r.forEach(s => { bySub[s[2]] = bySub[s[2]] || { col: s[0], m: 0 }; bySub[s[2]].m += s[1]; }));
  const legend = Object.keys(bySub).sort((a, b) => bySub[b].m - bySub[a].m);
  const unplaced = Math.max(0, total - placed);
  host.querySelector(".pl-legend").innerHTML = legend.map(k =>
    `<span><i style="background:${bySub[k].col}"></i>${esc(k)} <b>${plMins(bySub[k].m)}</b></span>`).join("") +
    (unplaced >= 1 ? `<span class="pl-muted" title="Logged by hand for this day later on, so there is no time of day to put it at">+ ${plMins(unplaced)} logged without a time</span>` : "") +
    (line ? `<span class="pl-typkey"><i></i>Typical Knox student on a ${PL_DOW_LONG[dowIdx(day)]}${typTotal ? ` · ${plMins(typTotal)}` : ""}</span>` : "");

  const note = host.querySelector(".pl-note");
  if (!total) note.textContent = day === today ? "Nothing yet today. Start the timer and watch this fill in, hour by hour." : "Nothing logged on this day.";
  else if (typTotal && placed > 0) {
    const d = total - typTotal;
    note.textContent = Math.abs(d) < 10 ? "Right on what a typical studying Knox student does on this day."
      : d > 0 ? `${plMins(d)} more than a typical studying Knox student on a ${PL_DOW_LONG[dowIdx(day)]}.`
      : `${plMins(-d)} short of a typical studying Knox student on a ${PL_DOW_LONG[dowIdx(day)]}.`;
  } else note.textContent = "";

  plWireHover(host.querySelector(".pl-chartbox"), h => {
    const r = rows[h], t = tots[h];
    const typ = line ? `<br><em>Typical: ${plMins(line[h])}</em>` : "";
    return `<b>${plHourSpan(h)}</b>${t ? plMins(t) : "Nothing"}${r.filter(s => s[1] >= .5).map(s =>
      `<br><span style="color:${s[0]}">●</span> ${esc(s[2])}${s[3] ? " (running)" : ""} · ${plMins(s[1])}`).join("")}${typ}`;
  });
}

function plWireHover(box, html) {
  if (!box) return;
  box.onmousemove = e => {
    const t = e.target.closest && e.target.closest("[data-plh]");
    if (!t) { hideTT(); return; }
    showTT(e, html(Number(t.dataset.plh)));
  };
  box.onmouseleave = hideTT;
  box.onclick = e => {
    const t = e.target.closest && e.target.closest("[data-plh]");
    if (t) showTT(e, html(Number(t.dataset.plh)));
  };
}

function plPaintWeekView(host) {
  const today = todayISO();
  const wk = PL.weekCursor || addDays(today, -dowIdx(today));
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  host.querySelector(".pl-dnav b").textContent = wk === addDays(today, -dowIdx(today)) ? "This week"
    : wk === addDays(today, -dowIdx(today) - 7) ? "Last week" : "Week of " + fmtD(wk);
  host.querySelector("[data-plnav='1']").disabled = addDays(wk, 7) > today;

  const mine = DB.sessions.filter(s => s.user_id === UID);
  const rows = days.map(d => {
    const by = {};
    mine.filter(s => s.day === d).forEach(s => { const k = s.subject_id || "none"; by[k] = (by[k] || 0) + s.minutes; });
    if (d === today && liveMsFor(UID)) { const k = (localTimer.subject_id || "none") + "|live"; by[k] = (by[k] || 0) + liveMsFor(UID) / 60000; }
    return Object.keys(by).sort((a, b) => plSubjectName(a).localeCompare(plSubjectName(b)))
      .map(k => [plColourOfSubject(k.split("|")[0]) || "#9AA4B2", by[k], plSubjectName(k), k.endsWith("|live")]);
  });
  const tots = rows.map(r => r.reduce((a, x) => a + x[1], 0));
  const sofar = days.filter(d => d <= today);
  const sum = tots.reduce((a, b) => a + b, 0);
  const avg = sofar.length ? sum / sofar.length : 0;
  host.querySelector(".pl-dbig").innerHTML = `${esc(hm(sum / 60))} <span class="pl-sub">· ${esc(hm(avg / 60))} a day on average</span>`;

  const W = plWidth(host.querySelector(".pl-chartbox")), H = W < 520 ? 180 : 220, L = 40, R = 8, T = 10, B = 24, iw = W - L - R, ih = H - T - B, bw = iw / 7;
  const goals = days.map(d => goalFor(UID, d) * 60);
  const max = plNice(Math.max(60, ...tots, ...goals) * 1.08);
  const y = v => T + ih - (v / max) * ih;
  let g = "";
  [0, max / 2, max].forEach(v => {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="pl-grid${v === 0 ? " base" : ""}"/>`;
    g += `<text x="${L - 7}" y="${y(v) + 4}" text-anchor="end" class="pl-ax">${v === 0 ? "0" : plMins(v)}</text>`;
  });
  rows.forEach((r, i) => {
    const x = L + i * bw + bw * .22, w = bw * .56;
    let acc = 0;
    r.forEach((s, j) => {
      const top = j === r.length - 1;
      g += `<rect x="${x}" y="${y(acc + s[1])}" width="${w}" height="${Math.max(1.2, y(acc) - y(acc + s[1]))}" fill="${s[0]}" ${top ? 'rx="3"' : ""} class="${s[3] ? "pl-livebar" : ""}"/>`;
      acc += s[1];
    });
    if (goals[i] > 0) g += `<line x1="${x - 4}" x2="${x + w + 4}" y1="${y(goals[i])}" y2="${y(goals[i])}" class="pl-goal"/>`;
    g += `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" class="pl-ax${days[i] === today ? " on" : ""}">${DOW[i]}</text>`;
    g += `<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" fill="transparent" data-plh="${i}" style="cursor:pointer"/>`;
  });
  if (avg > 0) g += `<line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" class="pl-typ"/>` +
    `<text x="${W - R - 2}" y="${y(avg) - 5}" text-anchor="end" class="pl-ax avg">avg</text>`;
  host.querySelector(".pl-chartbox").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="pl-chart" role="img" aria-label="Your study each day this week">${g}</svg>`;

  const bySub = {};
  rows.forEach(r => r.forEach(s => { bySub[s[2]] = bySub[s[2]] || { col: s[0], m: 0 }; bySub[s[2]].m += s[1]; }));
  host.querySelector(".pl-legend").innerHTML = Object.keys(bySub).sort((a, b) => bySub[b].m - bySub[a].m).map(k =>
    `<span><i style="background:${bySub[k].col}"></i>${esc(k)} <b>${plMins(bySub[k].m)}</b></span>`).join("") +
    `<span class="pl-goalkey"><i></i>Your goal each day</span>`;

  const best = tots.indexOf(Math.max(...tots));
  const met = days.filter((d, i) => d <= today && goals[i] > 0 && tots[i] >= goals[i]).length;
  const withGoal = days.filter((d, i) => d <= today && goals[i] > 0).length;
  const active = tots.filter(t => t > 0).length;
  host.querySelector(".pl-facts").innerHTML = [
    ["Best day", tots[best] > 0 ? DOW[best] + " · " + plMins(tots[best]) : "—"],
    ["Days studied", active + " of " + sofar.length],
    ["Goals hit", withGoal ? met + " of " + withGoal : "—"],
    ["Sessions", String(mine.filter(s => days.indexOf(s.day) > -1).length)]
  ].map(f => `<div><span>${f[0]}</span><b>${esc(f[1])}</b></div>`).join("");
  host.querySelector(".pl-note").textContent = "Tap a day to see it hour by hour.";

  const box = host.querySelector(".pl-chartbox");
  plWireHover(box, i => `<b>${fmtD(days[i])}</b>${tots[i] ? plMins(tots[i]) : "Nothing"}${goals[i] ? ` of ${plMins(goals[i])} goal` : ""}${
    rows[i].filter(s => s[1] >= .5).map(s => `<br><span style="color:${s[0]}">●</span> ${esc(s[2])} · ${plMins(s[1])}`).join("")}`);
  box.onclick = e => {
    const t = e.target.closest && e.target.closest("[data-plh]");
    if (!t) return;
    const d = days[Number(t.dataset.plh)];
    if (d > today) return;
    hideTT(); PL.dayView = "day"; PL.dayCursor = d; plPaintDay();
  };
}

function plPaintPatternView(host) {
  const today = todayISO(), since = plClockSince();
  host.querySelector(".pl-dnav b").textContent = "Last 4 weeks";
  host.querySelector("[data-plnav='1']").disabled = true;
  const mine = DB.sessions.filter(s => s.user_id === UID && s.day >= since);
  const spread = plSpread(plSegments(mine, false));
  const active = Object.keys(spread).filter(d => d >= since && d <= today);
  const n = Math.max(1, new Set(mine.map(s => s.day)).size);
  const sum = new Array(24).fill(0);
  active.forEach(d => spread[d].forEach((cell, h) => { sum[h] += Object.values(cell).reduce((a, b) => a + b, 0); }));
  const avg = sum.map(v => v / n);
  const line = plTypicalLine(null);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#E8402A";
  const rows = avg.map(v => [[accent, v, "You"]]);
  const total = avg.reduce((a, b) => a + b, 0);
  host.querySelector(".pl-dbig").innerHTML = `${esc(hm(total / 60))} <span class="pl-sub">· your average study day</span>`;
  host.querySelector(".pl-chartbox").innerHTML = plHourChart(rows, { line, w: plWidth(host.querySelector(".pl-chartbox")), label: "Your average minutes in each hour" });

  const parts = [["Morning", 5, 12], ["Afternoon", 12, 17], ["Evening", 17, 21], ["Night", 21, 29]];
  const share = parts.map(p => { let m = 0; for (let h = p[1]; h < p[2]; h++) m += avg[h % 24]; return m; });
  const peak = avg.indexOf(Math.max(...avg));
  const typPeak = line ? line.indexOf(Math.max(...line)) : null;
  const top = share.indexOf(Math.max(...share));
  host.querySelector(".pl-facts").innerHTML = parts.map((p, i) =>
    `<div><span>${p[0]}</span><b>${total ? f0(share[i] / total * 100) + "%" : "—"}</b></div>`).join("");
  host.querySelector(".pl-legend").innerHTML =
    `<span><i style="background:${accent}"></i>You, per day you studied</span>` +
    (line ? `<span class="pl-typkey"><i></i>Typical Knox student, per day they studied</span>` : "");
  host.querySelector(".pl-note").textContent = total
    ? `You're ${["a morning", "an afternoon", "an evening", "a night"][top]} studier: most of your work lands ${plHourSpan(peak)}` +
      (typPeak !== null ? `. The year group peaks ${plHourSpan(typPeak)}.` : ".")
    : "Log a few sessions with the timer and your pattern shows up here.";
  plWireHover(host.querySelector(".pl-chartbox"), h =>
    `<b>${plHourSpan(h)}</b>You: ${plMins(avg[h])}${line ? `<br><em>Typical: ${plMins(line[h])}</em>` : ""}`);
}

function plDayCardHTML() {
  return `<header>
      <div><h2>Your day</h2><div class="sub">When you studied, hour by hour. The dotted line is a typical Knox student.</div></div>
      <div class="controls pl-seg" role="group" aria-label="Chart view">
        <button class="chip" data-plview="day">Day</button>
        <button class="chip" data-plview="week">Week</button>
        <button class="chip" data-plview="pattern">Pattern</button>
      </div>
    </header>
    <div class="body">
      <div class="pl-dtop">
        <div class="pl-dnav">
          <button class="pl-arrow" data-plnav="-1" aria-label="Earlier">‹</button>
          <b>Today</b>
          <button class="pl-arrow" data-plnav="1" aria-label="Later">›</button>
        </div>
        <div class="pl-dbig">0m</div>
      </div>
      <div class="pl-chartbox"></div>
      <div class="pl-legend"></div>
      <div class="pl-facts"></div>
      <div class="pl-note"></div>
    </div>`;
}
function plWireDayCard(host) {
  host.addEventListener("click", e => {
    const v = e.target.closest("[data-plview]");
    if (v) { PL.dayView = v.dataset.plview; plStore.set("st.dayview", PL.dayView); plPaintDay(); return; }
    const n = e.target.closest("[data-plnav]");
    if (n && !n.disabled) {
      const step = Number(n.dataset.plnav), today = todayISO();
      if (PL.dayView === "day") {
        const next = addDays(PL.dayCursor || today, step);
        PL.dayCursor = next >= today ? null : next;
      } else if (PL.dayView === "week") {
        const cur = PL.weekCursor || addDays(today, -dowIdx(today));
        const next = addDays(cur, step * 7);
        PL.weekCursor = next >= addDays(today, -dowIdx(today)) ? null : next;
      }
      plPaintDay();
    }
  });
}

/* ---------------------------------------------------------------------------
   MY STATS — level, records, achievements
   --------------------------------------------------------------------------- */
function plLevelCardHTML() {
  const L = plLevel(UID);
  const cur = plCurrentTheme();
  return `<header><div><h2>Your level</h2><div class="sub">Every hour counts, up to ${PL_DAY_CAP} a day. Consistency levels you up, not all-nighters.</div></div></header>
    <div class="body">
      <div class="pl-lvhero">
        <div class="pl-lvring" style="--lv:${L.col};--p:${(L.pct * 100).toFixed(1)}">
          <div><b>${L.n}</b><span>level</span></div>
        </div>
        <div class="pl-lvtext">
          <div class="pl-lvname" style="color:${L.col}">${esc(L.name)}</div>
          <div class="pl-lvh"><b>${f1(L.h)}</b> capped hours</div>
          ${L.next ? `<div class="track pl-lvtrack"><div class="fill" style="width:${(L.pct * 100).toFixed(1)}%;background:linear-gradient(90deg,${L.col},${L.next.col})"></div></div>
            <div class="pl-lvnext">${f1(L.toGo)} h to <b style="color:${L.next.col}">${esc(L.next.name)}</b>${
              L.toGo > 0 ? ` · about ${Math.max(1, Math.ceil(L.toGo / 4))} day${Math.ceil(L.toGo / 4) === 1 ? "" : "s"} at 4 h a day` : ""}</div>`
            : `<div class="pl-lvnext">Top level. Nothing left to unlock but the exam.</div>`}
        </div>
      </div>
      <div class="pl-ladder">${PL_LEVELS.map(x => `<span class="${x.n <= L.n ? "on" : ""}${x.n === L.n ? " cur" : ""}" style="--lv:${x.col}" title="Level ${x.n} · ${esc(x.name)} · ${x.at} h">${x.n}</span>`).join("")}</div>
      <h3 class="sec" style="margin-top:18px">Colour theme</h3>
      <div class="pl-themes">${PL_THEMES.map(t => {
        const open = L.n >= t.lvl;
        return `<button class="pl-theme${t.id === cur ? " on" : ""}" data-pltheme="${t.id}" ${open ? "" : "disabled"}
          style="--a:${t.a};--a2:${t.a2}" title="${open ? esc(t.name) : `Unlocks at level ${t.lvl}`}">
          <i></i><span>${open ? esc(t.name) : `Lv ${t.lvl}`}</span>${open ? "" : `<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`}</button>`;
      }).join("")}</div>
    </div>`;
}

function plBestsHTML(f) {
  const mine = DB.sessions.filter(s => s.user_id === UID);
  const e = DB.daily.get(UID);
  const days = e && e.days ? e.days : {};
  let bestDay = null;
  Object.keys(days).forEach(d => { if (!bestDay || days[d][0] > days[bestDay][0]) bestDay = d; });
  const longest = mine.reduce((a, s) => s.minutes > (a ? a.minutes : 0) ? s : a, null);
  const bySub = {};
  mine.forEach(s => { if (s.subject_id) bySub[s.subject_id] = (bySub[s.subject_id] || 0) + s.minutes; });
  const fav = Object.keys(bySub).sort((a, b) => bySub[b] - bySub[a])[0];
  const favS = fav ? subjById(fav) : null;
  const spread = plSpread(plSegments(mine, false));
  const byH = new Array(24).fill(0);
  Object.values(spread).forEach(r => r.forEach((c, h) => { byH[h] += Object.values(c).reduce((a, b) => a + b, 0); }));
  const pk = byH.indexOf(Math.max(...byH));
  const items = [
    ["Best day", bestDay ? hm(days[bestDay][0] / 60) : "—", bestDay ? fmtD(bestDay) : "", "cal"],
    ["Best week", f.bestWeek ? f1(f.bestWeek) + " h" : "—", "Monday to Sunday, capped", "layers"],
    ["Longest session", longest ? plMins(longest.minutes) : "—", longest ? fmtD(longest.day) : "", "bolt"],
    ["Longest run", f.bestRun ? f.bestRun + " day" + (f.bestRun === 1 ? "" : "s") : "—", "Days in a row with study", "flame"],
    ["Best finish", f.bestRank ? "#" + f.bestRank.rank : "—", f.bestRank ? fmtD(f.bestRank.day) : "On any day", "trophy"],
    ["Top subject", favS ? f1(bySub[fav] / 60) + " h" : "—", favS ? favS.name : "", "star"],
    ["Power hour", byH[pk] > 0 ? plHourName(pk) : "—", byH[pk] > 0 ? plMins(byH[pk]) + " there, all time" : "", "clock"],
    ["Kudos", f.kudosKnown ? String(f.kr) : "—", f.kudosKnown ? `received · ${f.kg} given` : "", "heart"]
  ];
  return `<header><div><h2>Personal bests</h2><div class="sub">Your records, all in one place</div></div></header>
    <div class="body"><div class="pl-bests">${items.map(i => `<div class="pl-best">
      <span class="pl-bi">${plIcon(i[3], 17)}</span>
      <div><span class="k">${esc(i[0])}</span><b>${esc(i[1])}</b><small>${esc(i[2])}</small></div></div>`).join("")}</div></div>`;
}

function plAchCardHTML(A) {
  const done = A.list.filter(a => a.done).length;
  /* closest ones first among the locked: what to aim at next */
  const locked = A.list.filter(a => !a.done && !a.unknown).sort((a, b) => b.pct - a.pct);
  const next = locked.slice(0, 3);
  return `<header><div><h2>Achievements</h2><div class="sub">${done} of ${A.list.length} unlocked</div></div>
      <div class="pl-achbar"><div class="track"><div class="fill" style="width:${(done / A.list.length * 100).toFixed(1)}%"></div></div></div></header>
    <div class="body">
      ${next.length ? `<div class="pl-next"><span class="pl-nextk">Closest</span>${next.map(a => `
        <div class="pl-nexti">${plMedal(a, 34)}<div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
          <div class="track"><div class="fill" style="width:${(a.pct * 100).toFixed(1)}%;background:${PL_TIER[a.tier].col}"></div></div></div>
          <span class="pl-np">${plProgressText(a)}</span></div>`).join("")}</div>` : ""}
      <div class="pl-achgrid">${A.list.map(a => `
        <div class="pl-ach ${a.done ? "on" : ""}" title="${esc(a.desc)}${a.done ? "" : " · " + plProgressText(a)}">
          ${plMedal(a, 46)}
          <b>${esc(a.name)}</b>
          <small>${esc(a.desc)}</small>
          <span class="pl-tier" style="color:${PL_TIER[a.tier].col}">${a.done ? PL_TIER[a.tier].name : plProgressText(a)}</span>
        </div>`).join("")}</div>
    </div>`;
}

/* ---------------------------------------------------------------------------
   PELOTON — the study clock, the subject battle, kudos, levels, records
   --------------------------------------------------------------------------- */
function plPaintClock() {
  const host = $("pl-clock");
  if (!host) return;
  const body = host.querySelector(".pl-clockbody");
  host.querySelectorAll("[data-plwho]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.plwho === PL.clockWho)));
  let grid, sub;
  if (PL.clockWho === "me") {
    const since = plClockSince();
    const mine = DB.sessions.filter(s => s.user_id === UID && s.day >= since);
    const spread = plSpread(plSegments(mine, false));
    grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const nByDow = new Array(7).fill(0);
    new Set(mine.map(s => s.day)).forEach(d => nByDow[dowIdx(d)]++);
    Object.keys(spread).forEach(d => {
      if (d < since) return;
      spread[d].forEach((c, h) => { grid[dowIdx(d)][h] += Object.values(c).reduce((a, b) => a + b, 0); });
    });
    grid = grid.map((row, i) => row.map(v => nByDow[i] ? v / nByDow[i] : 0));
    sub = "Your average minutes in each hour, per day you studied, over the last four weeks";
  } else {
    if (!PL.clock) { body.innerHTML = `<div class="empty">Working out when everybody studies…</div>`; return; }
    grid = PL.clock.cells.map((row, i) => row.map(v => PL.clock.byDow[i] ? v / PL.clock.byDow[i] : 0));
    sub = `A typical studying student's minutes in each hour · last four weeks · ${PL.clock.total.toLocaleString()} student-days`;
  }
  host.querySelector(".sub").textContent = sub;
  const max = Math.max(1, ...grid.flat());
  const now = new Date(), nd = (now.getDay() + 6) % 7, nh = now.getHours();
  let peak = [0, 0];
  grid.forEach((r, d) => r.forEach((v, h) => { if (v > grid[peak[0]][peak[1]]) peak = [d, h]; }));
  const cell = (v, d, h) => {
    const a = v / max;
    return `<i class="${d === nd && h === nh ? "now" : ""}" data-pld="${d}" data-plhh="${h}"
      style="${a > .02 ? `background:rgba(232,64,42,${(.08 + Math.sqrt(a) * .92).toFixed(2)});background:color-mix(in srgb, var(--accent) ${Math.round(8 + Math.sqrt(a) * 92)}%, var(--surface-2))` : "background:var(--surface-2)"}"></i>`;
  };
  /* the sum over each part of the day, for the summary underneath */
  const tot = grid.flat().reduce((a, b) => a + b, 0) || 1;
  const band = (a, b) => grid.reduce((s, r) => s + r.slice(a, b).reduce((x, y) => x + y, 0), 0) / tot;
  body.innerHTML = `
    <div class="pl-heat">
      <div class="pl-heathours"><span></span>${Array.from({ length: 24 }, (_, h) => `<span>${h % 3 === 0 ? plHourName(h) : ""}</span>`).join("")}</div>
      ${grid.map((r, d) => `<div class="pl-heatrow"><span>${DOW[d]}</span>${r.map((v, h) => cell(v, d, h)).join("")}</div>`).join("")}
    </div>
    <div class="pl-clockfacts">
      <div><span>Busiest slot</span><b>${PL_DOW_LONG[peak[0]]} ${plHourSpan(peak[1])}</b></div>
      <div><span>Before noon</span><b>${f0(band(0, 12) * 100)}%</b></div>
      <div><span>Noon to 6pm</span><b>${f0(band(12, 18) * 100)}%</b></div>
      <div><span>After 6pm</span><b>${f0(band(18, 24) * 100)}%</b></div>
    </div>`;
  const heat = body.querySelector(".pl-heat");
  heat.onmousemove = e => {
    const t = e.target.closest("[data-pld]");
    if (!t) { hideTT(); return; }
    const d = Number(t.dataset.pld), h = Number(t.dataset.plhh), v = grid[d][h];
    showTT(e, `<b>${PL_DOW_LONG[d]} · ${plHourSpan(h)}</b>${plMins(v)} ${PL.clockWho === "me" ? "on an average day you studied" : "for a typical studying student"}`);
  };
  heat.onmouseleave = hideTT;
}

function plSubjectColour(label) {
  const c = CAT.byName(label);
  if (c && c.colour) return c.colour;
  let h = 0; for (const ch of String(label)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 48%)`;
}
function plPaintBattle() {
  const host = $("pl-battle");
  if (!host) return;
  host.querySelectorAll("[data-plsr]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.plsr) === PL.subjRange)));
  const d = PL.subjects[PL.subjRange];
  const body = host.querySelector(".body");
  if (!d) { body.innerHTML = `<div class="empty">Counting up every subject…</div>`; return; }
  const mineNames = new Set(DB.subjects.map(s => s.name.trim().toLowerCase()));
  const rows = d.slice(0, 12);
  const mx = Math.max(1, ...rows.map(r => Number(r.minutes)));
  body.innerHTML = `<div class="pl-battle">${rows.map((r, i) => {
    const col = plSubjectColour(r.label), mine = mineNames.has(String(r.label).trim().toLowerCase());
    const per = r.people ? Number(r.minutes) / r.people / 60 : 0;
    return `<div class="pl-brow${mine ? " mine" : ""}" title="${esc(r.label)} · ${f1(r.minutes / 60)} h from ${r.people} ${r.people === 1 ? "person" : "people"} · ${f1(per)} h each">
      <span class="pl-brank">${i + 1}</span>
      <span class="pl-bname">${esc(r.label)}${mine ? ` <em>yours</em>` : ""}</span>
      <span class="track"><span class="fill" style="width:${(r.minutes / mx * 100).toFixed(1)}%;background:${col}"></span></span>
      <span class="pl-bval">${f0(r.minutes / 60)} h<small>${r.people} ppl</small></span>
    </div>`;
  }).join("")}</div>`;
}

function plPaintKudos() {
  const host = $("pl-kudos");
  if (!host) return;
  host.querySelectorAll("[data-plkt]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.plkt === PL.kudosTab)));
  const body = host.querySelector(".body");
  if (!PL.kudos) { body.innerHTML = `<div class="empty">Counting kudos…</div>`; return; }
  const list = (PL.kudos[PL.kudosTab] || []).filter(r => DB.profiles.some(p => p.id === r[0]));
  if (!list.length) { body.innerHTML = `<div class="empty">No kudos this week yet.</div>`; return; }
  const mx = Math.max(1, ...list.map(r => r[1]));
  body.innerHTML = `<div class="pl-kboard">${list.map((r, i) => {
    const p = profileOf(r[0]);
    return `<div class="pl-krow${r[0] === UID ? " me" : ""}">
      <span class="pl-brank${i < 3 ? " m" + (i + 1) : ""}">${i + 1}</span>
      <div class="who person" data-profile="${esc(r[0])}">${avatarHTML(p, "sm")}<span class="nm">${esc(p.display_name)}</span>${playLevelTag(r[0])}</div>
      <span class="track"><span class="fill" style="width:${(r[1] / mx * 100).toFixed(1)}%"></span></span>
      <b>${r[1]}</b>
    </div>`;
  }).join("")}</div>`;
}

function plPaintLevels() {
  const host = $("pl-levels");
  if (!host) return;
  const people = visiblePeople().filter(p => p.id === UID || DB.daily.has(p.id));
  const by = PL_LEVELS.map(() => []);
  people.forEach(p => { const L = plLevel(p.id); by[L.n - 1].push({ id: p.id, h: L.h }); });
  by.forEach(list => list.sort((a, b) => b.h - a.h));
  const mx = Math.max(1, ...by.map(l => l.length));
  const me = plLevel(UID).n;
  host.querySelector(".body").innerHTML = `<div class="pl-lvdist">${PL_LEVELS.slice().reverse().map(L => {
    const list = by[L.n - 1];
    const open = PL.levelBoardOpen === L.n;
    return `<div class="pl-lvrow${L.n === me ? " me" : ""}">
      <button class="pl-lvbtn" data-pllv="${L.n}" ${list.length ? "" : "disabled"} aria-expanded="${open}">
        ${plLevelBadge(L)}<span class="pl-lvn">${esc(L.name)}</span>
        <span class="track"><span class="fill" style="width:${(list.length / mx * 100).toFixed(1)}%;background:${L.col}"></span></span>
        <b>${list.length}</b>
      </button>
      ${list.length && open ? `<div class="pl-lvfaces">${list.map(x => `<span class="person" data-profile="${esc(x.id)}" title="${esc(profileOf(x.id).display_name)} · ${f0(x.h)} h">${avatarHTML(profileOf(x.id), "sm")}</span>`).join("")}</div>` : ""}
    </div>`;
  }).join("")}</div><p class="pl-foot">Tap a level to see who is on it. You are on level ${me}.</p>`;
}

function plPaintRecords() {
  const host = $("pl-records");
  if (!host) return;
  const today = todayISO();
  const people = visiblePeople().filter(p => DB.daily.has(p.id) || p.id === UID);
  const m = (id, d) => (d === today ? dayCell(id, d)[0] : ((DB.daily.get(id) || { days: {} }).days[d] || [0])[0]);
  const last = n => Array.from({ length: n }, (_, i) => addDays(today, -i));
  const L7 = last(7), P7 = Array.from({ length: 7 }, (_, i) => addDays(today, -7 - i)), L14 = last(14);
  const rows = people.map(p => {
    const wk = L7.reduce((a, d) => a + Math.min(PL_DAY_CAP * 60, m(p.id, d)), 0);
    const pw = P7.reduce((a, d) => a + Math.min(PL_DAY_CAP * 60, m(p.id, d)), 0);
    const cons = L14.filter(d => m(p.id, d) >= 60).length;
    let run = 0;
    for (let i = 0; i < 200; i++) {
      const d = addDays(today, -i);
      if (m(p.id, d) >= 15) run++;
      else if (i === 0) continue;   /* today still has time */
      else break;
    }
    return { id: p.id, wk, pw, cons, run, imp: pw >= 120 ? wk - pw : 0 };
  });
  const pick = (k, filt) => rows.filter(filt || (() => true)).sort((a, b) => b[k] - a[k] || b.wk - a.wk)[0];
  const recs = [
    ["Biggest week", pick("wk"), r => f1(r.wk / 60) + " h", "Last 7 days, 8 h a day at most", "cal"],
    ["Longest run going", pick("run"), r => r.run + " days", "Studied every day, ending today", "flame"],
    ["Most consistent", pick("cons"), r => r.cons + " of 14", "Days with an hour or more, last fortnight", "target"],
    ["Most improved", pick("imp", r => r.imp > 0), r => "+" + f1(r.imp / 60) + " h", "This week against last week", "bolt"]
  ];
  host.querySelector(".body").innerHTML = `<div class="pl-recs">${recs.map(r => {
    const w = r[1];
    if (!w || (r[0] === "Most improved" && !w.imp)) return `<div class="pl-rec"><span class="pl-bi">${plIcon(r[4], 17)}</span><div><span class="k">${r[0]}</span><b>—</b><small>${r[3]}</small></div></div>`;
    const p = profileOf(w.id);
    const me = rows.find(x => x.id === UID);
    return `<div class="pl-rec person" data-profile="${esc(w.id)}">
      ${avatarHTML(p, "lg")}
      <div><span class="k">${r[0]}</span><b>${esc(p.display_name)}</b><small>${esc(r[2](w))} · ${r[3]}</small>
        ${me && w.id !== UID ? `<small class="pl-you">You: ${esc(r[2](me)).replace(/^\+-/, "−")}</small>` : w.id === UID ? `<small class="pl-you">That's you</small>` : ""}</div>
    </div>`;
  }).join("")}</div>`;
}

/* ---------------------------------------------------------------------------
   PROFILES
   --------------------------------------------------------------------------- */
function playProfileHTML(id, all) {
  if (!UID || !plVisible(id)) return "";
  if (id !== UID && hidingOthers()) return "";
  const L = plLevel(id);
  const A = plAchievements(id, all);
  const got = A.list.filter(a => a.done);
  const segs = plSegments(all, id === UID);
  const spread = plSpread(segs);
  const n = Math.max(1, new Set(all.map(s => s.day)).size);
  const byH = new Array(24).fill(0);
  Object.values(spread).forEach(r => r.forEach((c, h) => { byH[h] += Object.values(c).reduce((a, b) => a + b, 0); }));
  const avg = byH.map(v => v / n);
  const pk = avg.indexOf(Math.max(...avg));
  const first = (profileOf(id).display_name || "They").split(/\s+/)[0];
  return `<div class="pl-prof mb16" data-plprof="${esc(id)}">
    <div class="pl-proflv">
      <div class="pl-lvring sm" style="--lv:${L.col};--p:${(L.pct * 100).toFixed(1)}"><div><b>${L.n}</b></div></div>
      <div><div class="pl-lvname" style="color:${L.col}">${esc(L.name)}</div>
        <div class="pl-lvh">${f1(L.h)} capped hours${L.next ? ` · ${f1(L.toGo)} to ${esc(L.next.name)}` : ""}</div></div>
      <div class="pl-profcount"><b>${got.length}</b><span>of ${A.list.length} badges</span></div>
    </div>
    <div class="pl-profbadges">${got.length ? got.map(a => `<span title="${esc(a.name)} · ${esc(a.desc)}">${plMedal(a, 34)}</span>`).join("")
      : `<span class="pl-muted">No badges yet.</span>`}</div>
    ${byH.some(v => v > 0) ? `<h3 class="sec" style="margin-top:14px">When ${id === UID ? "you study" : esc(first) + " studies"}</h3>
      <div class="pl-profchart">${plHourChart(avg.map(v => [["var(--accent)", v, ""]]), { line: plTypicalLine(null), h: 150, w: 560,
        label: "Average minutes in each hour" })}</div>
      <div class="pl-legend"><span>Busiest around <b>${plHourName(pk)}</b></span>${PL.clock ? `<span class="pl-typkey"><i></i>Typical Knox student</span>` : ""}</div>` : ""}
  </div>`;
}
function plWireProfile(id) {
  const box = document.querySelector(`[data-plprof="${CSS.escape(id)}"]`);
  if (box) {
    const chart = box.querySelector(".pl-profchart");
    const n = Math.max(1, new Set((id === UID ? DB.sessions : GUEST.sessions).map(s => s.day)).size);
    if (chart) plWireHover(chart, h => {
      const segs = plSpread(plSegments(id === UID ? DB.sessions : GUEST.sessions, false));
      let m = 0; Object.values(segs).forEach(r => { m += Object.values(r[h]).reduce((a, b) => a + b, 0); });
      const line = plTypicalLine(null);
      return `<b>${plHourSpan(h)}</b>${plMins(m / n)} on an average study day${line ? `<br><em>Typical: ${plMins(line[h])}</em>` : ""}`;
    });
  }
}
async function playAfterProfile(id) {
  plWireProfile(id);
  if (!plVisible(id)) return;
  const before = PL.badgeStats[id];
  await plLoadBadgeStats(id);
  /* the kudos badges arrive a moment later; repaint just this block */
  if (JSON.stringify(before) !== JSON.stringify(PL.badgeStats[id]) && typeof openProfileId !== "undefined" && openProfileId === id) {
    const old = document.querySelector(`[data-plprof="${CSS.escape(id)}"]`);
    if (old) {
      const wrap = document.createElement("div");
      wrap.innerHTML = playProfileHTML(id, id === UID ? DB.sessions.slice() : GUEST.sessions.slice());
      if (wrap.firstElementChild) { old.replaceWith(wrap.firstElementChild); plWireProfile(id); }
    }
  }
}

/* ---------------------------------------------------------------------------
   RANK TODAY, for the masthead chip
   --------------------------------------------------------------------------- */
function playRankToday() {
  if (!UID || hidingOthers()) return null;
  const day = todayISO();
  const mine = dayCell(UID, day)[0];
  if (mine <= 0) return null;
  let above = 0, n = 0;
  visiblePeople().forEach(p => {
    const v = dayCell(p.id, day)[0];
    if (v > 0) n++;
    if (p.id !== UID && v > mine) above++;
  });
  return { rank: above + 1, of: n };
}

/* ---------------------------------------------------------------------------
   CELEBRATIONS — a new badge or a new level, once per device
   --------------------------------------------------------------------------- */
const PL_CELE = [];
function plCelebrate(item) {
  PL_CELE.push(item);
  if (PL_CELE.length === 1) plShowCele();
}
function plShowCele() {
  const it = PL_CELE[0];
  if (!it) return;
  let ov = $("pl-cele");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "pl-cele"; ov.className = "pl-cele";
    document.body.appendChild(ov);
    ov.addEventListener("click", e => {
      if (e.target === ov || e.target.closest("[data-plclose]")) {
        ov.classList.remove("on");
        PL_CELE.shift();
        setTimeout(plShowCele, 260);
      }
      const go = e.target.closest("[data-plgo]");
      if (go) { const t = document.querySelector('nav.tabs button[data-p="me"]'); if (t) t.click(); }
    });
  }
  const conf = Array.from({ length: 26 }, (_, i) =>
    `<i style="--x:${(Math.random() * 2 - 1).toFixed(2)};--d:${(Math.random() * .5).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg;--c:${["var(--accent)", "var(--accent-2)", "#C9961A", "#2FA7B8", "#7A4FD6", "#19A974"][i % 6]}"></i>`).join("");
  ov.innerHTML = `<div class="pl-celebox" role="dialog" aria-label="${esc(it.title)}">
    <div class="pl-conf">${conf}</div>
    <div class="pl-celek">${esc(it.kicker)}</div>
    <div class="pl-celeart">${it.art}</div>
    <h2>${esc(it.title)}</h2>
    <p>${it.text}</p>
    <div class="pl-celebtns">
      <button class="btn ghost sm" data-plgo data-plclose>See all</button>
      <button class="btn sm" data-plclose>Nice</button>
    </div>
  </div>`;
  requestAnimationFrame(() => ov.classList.add("on"));
}
function plCheckUnlocks(A) {
  const key = "st.ach." + UID, lkey = "st.lvl." + UID;
  const seen = plStore.get(key, null);
  const done = A.list.filter(a => a.done && !a.unknown).map(a => a.id);
  const L = plLevel(UID);
  const seenL = plStore.get(lkey, null);
  if (seen === null) {
    /* First visit since this arrived: one card that says what you already have. */
    plStore.set(key, done); plStore.set(lkey, L.n);
    if (done.length) plCelebrate({
      kicker: "New: levels and achievements",
      art: `<div class="pl-lvring big" style="--lv:${L.col};--p:${(L.pct * 100).toFixed(1)}"><div><b>${L.n}</b><span>level</span></div></div>`,
      title: `You're level ${L.n}, ${L.name}`,
      text: `You've already unlocked <b>${done.length}</b> of ${A.list.length} achievements. Level up for new colour themes. Only ${PL_DAY_CAP} hours a day count, so steady beats heroic.`
    });
    return;
  }
  const fresh = done.filter(id => seen.indexOf(id) < 0);
  if (fresh.length) {
    plStore.set(key, seen.concat(fresh));
    fresh.slice(0, 3).forEach(id => {
      const a = A.list.find(x => x.id === id);
      plCelebrate({ kicker: PL_TIER[a.tier].name + " achievement", art: plMedal(a, 92), title: a.name, text: esc(a.desc) + "." });
    });
    if (fresh.length > 3) toast(`And ${fresh.length - 3} more achievements unlocked`);
  }
  if (seenL !== null && L.n > seenL) {
    plStore.set(lkey, L.n);
    const theme = PL_THEMES.find(t => t.lvl === L.n);
    plCelebrate({
      kicker: "Level up",
      art: `<div class="pl-lvring big" style="--lv:${L.col};--p:0"><div><b>${L.n}</b><span>level</span></div></div>`,
      title: L.name,
      text: `${f0(L.h)} capped hours.${theme ? ` You unlocked the <b>${esc(theme.name)}</b> colour theme on My stats.` : ""}`
    });
  } else if (seenL === null || L.n !== seenL) plStore.set(lkey, L.n);
}

/* ---------------------------------------------------------------------------
   MOUNTING — the cards are made once, then repainted
   --------------------------------------------------------------------------- */
function plMount() {
  if ($("pl-day")) return;
  /* Today: straight after the four numbers at the top */
  const homeK = document.querySelector("#p-home > .grid.g4");
  if (homeK) {
    const c = document.createElement("div");
    c.className = "card mb16 pl-daycard"; c.id = "pl-day";
    c.innerHTML = plDayCardHTML();
    homeK.after(c);
    plWireDayCard(c);
  }
  /* My stats: level and records at the top, achievements under them */
  const me = $("p-me");
  if (me) {
    const g = document.createElement("div");
    g.className = "grid g2 mb16 pl-g2"; g.id = "pl-mefirst";
    g.innerHTML = `<div class="card pl-lvcard" id="pl-level"></div><div class="card" id="pl-bests"></div>`;
    me.prepend(g);
    const a = document.createElement("div");
    a.className = "card mb16"; a.id = "pl-ach";
    g.after(a);
    g.addEventListener("click", e => {
      const t = e.target.closest("[data-pltheme]");
      if (!t || t.disabled) return;
      plStore.set(plThemeKey(), t.dataset.pltheme);
      plApplyTheme(t.dataset.pltheme);
      $("pl-level").innerHTML = plLevelCardHTML();
      toast(PL_THEMES.find(x => x.id === t.dataset.pltheme).name + " theme on");
      plPaintDay();
    });
  }
  /* Peloton: the clock under the leaderboard, then the boards */
  const crew = $("p-crew");
  const lb = crew && crew.querySelector("#lbtbl") && crew.querySelector("#lbtbl").closest(".card");
  if (lb) {
    const clk = document.createElement("div");
    clk.className = "card mb16"; clk.id = "pl-clock";
    clk.innerHTML = `<header><div><h2>When the year group studies</h2><div class="sub">—</div></div>
      <div class="controls"><button class="chip" data-plwho="all">Everyone</button><button class="chip" data-plwho="me">You</button></div></header>
      <div class="body pl-clockbody"></div>`;
    lb.after(clk);
    clk.addEventListener("click", e => {
      const b = e.target.closest("[data-plwho]");
      if (b) { PL.clockWho = b.dataset.plwho; plPaintClock(); }
    });
    const g1 = document.createElement("div");
    g1.className = "grid g2 mb16";
    g1.innerHTML = `
      <div class="card" id="pl-battle"><header><div><h2>Subject battle</h2><div class="sub">Hours the year group put into each subject</div></div>
        <div class="controls"><button class="chip" data-plsr="7">7 days</button><button class="chip" data-plsr="30">30 days</button></div></header><div class="body"></div></div>
      <div class="card" id="pl-kudos"><header><div><h2>Kudos board</h2><div class="sub">The last 7 days. Your own kudos on yourself don't count.</div></div>
        <div class="controls"><button class="chip" data-plkt="received">Got</button><button class="chip" data-plkt="given">Gave</button></div></header><div class="body"></div></div>`;
    clk.after(g1);
    g1.addEventListener("click", e => {
      const s = e.target.closest("[data-plsr]");
      if (s) { PL.subjRange = Number(s.dataset.plsr); plPaintBattle(); plLoadSubjects(PL.subjRange); }
      const k = e.target.closest("[data-plkt]");
      if (k) { PL.kudosTab = k.dataset.plkt; plPaintKudos(); }
    });
    const g2 = document.createElement("div");
    g2.className = "grid g2 mb16";
    g2.innerHTML = `
      <div class="card" id="pl-records"><header><div><h2>This week's standouts</h2><div class="sub">Rewarding showing up, not burning out</div></div></header><div class="body"></div></div>
      <div class="card" id="pl-levels"><header><div><h2>Levels across the year group</h2><div class="sub">Everybody's capped hours, ${PL_DAY_CAP} a day at most</div></div></header><div class="body"></div></div>`;
    g1.after(g2);
    g2.addEventListener("click", e => {
      const b = e.target.closest("[data-pllv]");
      if (b) { const n = Number(b.dataset.pllv); PL.levelBoardOpen = PL.levelBoardOpen === n ? null : n; plPaintLevels(); }
    });
  }
}

let PL_LAST_FULL = 0;
function playRender() {
  if (!UID || !ME) return;
  try {
    plMount();
    plApplyTheme(plCurrentTheme());
    plPaintDay();
    const A = plAchievements(UID, DB.sessions.filter(s => s.user_id === UID));
    if ($("pl-level")) $("pl-level").innerHTML = plLevelCardHTML();
    if ($("pl-bests")) $("pl-bests").innerHTML = plBestsHTML(A.f);
    if ($("pl-ach")) $("pl-ach").innerHTML = plAchCardHTML(A);
    plPaintClock(); plPaintBattle(); plPaintKudos(); plPaintLevels(); plPaintRecords();
    /* the masthead: level beside your weekly place */
    const mr = $("me-rank");
    if (mr && !mr.querySelector(".pl-lv")) {
      const L = plLevel(UID);
      mr.innerHTML = `${plLevelBadge(L, "xs")} ${esc(mr.textContent)}`;
    }
    if (A.f.kudosKnown) plCheckUnlocks(A);
    /* server numbers, at most every ten minutes */
    plLoadClock(); plLoadSubjects(PL.subjRange); plLoadKudos();
    if (!PL.badgeAt[UID] || Date.now() - PL.badgeAt[UID] > PL_STALE) {
      plLoadBadgeStats(UID).then(() => {
        const B = plAchievements(UID, DB.sessions.filter(s => s.user_id === UID));
        if ($("pl-bests")) $("pl-bests").innerHTML = plBestsHTML(B.f);
        if ($("pl-ach")) $("pl-ach").innerHTML = plAchCardHTML(B);
        if (B.f.kudosKnown || PL.badgeStats[UID] === null) plCheckUnlocks(B);
      });
    }
  } catch (e) { console.error("play", e); }
}

/* The day chart follows a running timer. Once a minute is plenty. */
setInterval(() => {
  if (!UID || document.hidden) return;
  const home = $("p-home");
  if (home && home.classList.contains("on") && PL.dayView === "day" && !PL.dayCursor && liveMsFor(UID)) {
    try { plPaintDay(); } catch (e) { /* next minute */ }
  }
}, 60000);

PL.dayView = ["day", "week", "pattern"].indexOf(plStore.get("st.dayview", "day")) > -1 ? plStore.get("st.dayview", "day") : "day";

/* app.js may have signed in and drawn everything before this file arrived
   (its promises run between the two script tags), so catch up once. */
if (typeof UID !== "undefined" && UID && typeof ME !== "undefined" && ME) {
  try { renderAll(); } catch (e) { playRender(); }
}

/* A chart drawn on a hidden tab had no width to measure; redraw on arrival,
   and when the window changes size. */
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.p === "home") setTimeout(() => { try { plPaintDay(); } catch (e) { /* */ } }, 0);
}));
let plResizeT = 0, plLastW = innerWidth;
addEventListener("resize", () => {
  clearTimeout(plResizeT);
  plResizeT = setTimeout(() => {
    if (Math.abs(innerWidth - plLastW) < 40) return;
    plLastW = innerWidth;
    try { plPaintDay(); } catch (e) { /* */ }
  }, 200);
});
