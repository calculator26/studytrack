/* =========================================================================
   STUDY CREW
   A shared study tracker. Everyone logs their own subjects, areas and goals;
   everyone can see everyone else. Supabase for auth + data, static hosting.
   ========================================================================= */
"use strict";

const CFG = window.CREW_CONFIG || {};
/* The app's own name, in one place. CREW_NAME is only shown as a chip beside
   it when a group has given itself a different one — matching either the
   current name or the one this was called before keeps that chip hidden. */
const APP_NAME = "Knox Study Track";
const isGenericName = n => ["knox study track", "study track"].indexOf(String(n || "").trim().toLowerCase()) > -1;
const PALETTE = ["#3E7CA6","#C0564C","#3FA98A","#C9A227","#7A6BB5","#D98C3F","#2B6177","#B0577E"];

/* ---------------------------------------------------------------------------
   A colour of your own.

   The picker used to open on the same green for everyone, and most people
   quite reasonably left it there — ninety-one of the first hundred and
   twenty-six ended up sharing a colour with somebody, which makes the charts
   and the live strip much harder to read than they need to be.

   So a new arrival is handed one nobody has yet. Hues are stepped by the
   golden angle so consecutive ones land far apart, and each is solved for a
   contrast ratio against white between about 4.6 and 9.6 to one — the colour
   is both the background behind white initials and the text of a name on a
   white card, and that one number keeps them both readable.

   Nobody is stuck with it: the picker is still there and still does whatever
   you tell it.
   --------------------------------------------------------------------------- */
function hslToRgb(h, sat, light) {
  h = ((h % 360) + 360) % 360 / 360;
  if (sat === 0) return [light, light, light];
  const q = light < .5 ? light * (1 + sat) : light + sat - light * sat, p2 = 2 * light - q;
  const f = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p2 + (q - p2) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p2 + (q - p2) * (2/3 - t) * 6;
    return p2;
  };
  return [f(h + 1/3), f(h), f(h - 1/3)];
}
const rgbToHex = c => "#" + c.map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const srgb = v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
/* the WCAG ratio between this colour and white, which is the one number that
   decides whether white initials on it can be read */
const contrastOnWhite = c =>
  1.05 / (.2126 * srgb(c[0]) + .7152 * srgb(c[1]) + .0722 * srgb(c[2]) + .05);

const COLOUR_SATS    = [.68, .52, .80, .60, .74, .46];
const COLOUR_TARGETS = [4.6, 6.2, 8.4, 5.4, 7.3, 9.6];
function colourAt(i) {
  const sat = COLOUR_SATS[i % COLOUR_SATS.length], target = COLOUR_TARGETS[i % COLOUR_TARGETS.length];
  let lo = .08, hi = .72, rgb = null;
  for (let k = 0; k < 24; k++) {            /* solve lightness for that ratio */
    const mid = (lo + hi) / 2;
    rgb = hslToRgb(i * 137.508, sat, mid);
    if (contrastOnWhite(rgb) > target) lo = mid; else hi = mid;
  }
  return rgbToHex(rgb);
}
const normColour = c => String(c || "").trim().toLowerCase();
/* the first generated colour nobody is using */
function freeProfileColour() {
  const taken = new Set(DB.profiles.map(p => normColour(p.colour)));
  for (let i = 0; i < 3000; i++) {
    const c = colourAt(i);
    if (!taken.has(c)) return c;
  }
  return PALETTE[0];
}
/* who else is on this colour, so Setup can mention it rather than let two
   people quietly look identical */
const colourClash = c =>
  DB.profiles.filter(p => p.id !== UID && normColour(p.colour) === normColour(c));

let sb = null;
try {
  if (window.supabase && CFG.SUPABASE_URL && !/YOUR-PROJECT/.test(CFG.SUPABASE_URL)) {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }
} catch (e) { console.error(e); }

/* ---------------------------------------------------------------------------
   Reads that would undo a write.

   A full read takes a moment to come back, and one that set off before you
   pressed delete still has the row in it. Applying that answer puts the row
   straight back on the screen — which is exactly what deleting a session
   looked like: gone, then back a second later, apparently at random.

   So every write to a table the app keeps a copy of stamps a clock as it
   lands, loadAll() notes when it set off, and a read older than the last
   write is thrown away and asked again rather than believed.

   Wrapped here, once, rather than at each of the twenty-nine places that
   write something: the one that gets forgotten is the one that brings this
   back. Reads are handed through untouched — only the four writing verbs
   are wrapped, and each is still executed exactly once.
   --------------------------------------------------------------------------- */
const CACHED_TABLES = ["profiles", "subjects", "areas", "sessions", "goals"];
const WRITE_VERBS   = ["insert", "update", "upsert", "delete"];
let dataTouched = 0;

if (sb) {
  const rawFrom = sb.from.bind(sb);
  /* Follows the chain — .eq(), .select(), .single() all hand back something
     else to carry on with — and stamps the clock when the whole thing settles. */
  const follow = o => (o && typeof o === "object") ? new Proxy(o, {
    get(t, k) {
      if (k === "then" && typeof t.then === "function") {
        return (res, rej) => t.then(
          v => { dataTouched = Date.now(); return v; },
          e => { dataTouched = Date.now(); throw e; }
        ).then(res, rej);
      }
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? (...a) => follow(v.apply(t, a)) : v;
    }
  }) : o;

  sb.from = table => {
    const q = rawFrom(table);
    if (CACHED_TABLES.indexOf(table) === -1) return q;
    return new Proxy(q, {
      get(t, k) {
        const v = Reflect.get(t, k, t);
        if (typeof v !== "function") return v;
        if (WRITE_VERBS.indexOf(k) === -1) return (...a) => v.apply(t, a);   /* reads: untouched */
        return (...a) => follow(v.apply(t, a));
      }
    });
  };
}

/* ---------------- tiny helpers ---------------- */
const $  = id => document.getElementById(id);
const el = (t, a) => { const n = document.createElementNS("http://www.w3.org/2000/svg", t);
  for (const k in a) n.setAttribute(k, a[k]); return n; };
const esc = s => String(s == null ? "" : s).replace(/[<>&"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
const f0 = n => Math.round(n);
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); };
const parseD = s => { const p = String(s).slice(0,10).split("-").map(Number); return new Date(p[0], p[1]-1, p[2]); };
const isoOf = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const addDays = (s, n) => isoOf(new Date(parseD(s).getTime() + n*864e5));
const dowIdx = s => (parseD(s).getDay() + 6) % 7;            // 0 = Monday
const fmtD = s => parseD(s).toLocaleDateString("en-AU", {weekday:"short", day:"numeric", month:"short"});
const fmtLong = s => parseD(s).toLocaleDateString("en-AU", {weekday:"long", day:"numeric", month:"long"});
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const initials = n => String(n||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase() || "?";
const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function toast(msg, ms) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), ms || 2600);
}
const tt = $("tt");
function showTT(e, html) {
  tt.innerHTML = html; tt.classList.add("on");
  const p = 12, w = tt.offsetWidth, h = tt.offsetHeight;
  let x = e.clientX + p, y = e.clientY + p;
  if (x + w > innerWidth - 8)  x = e.clientX - w - p;
  if (y + h > innerHeight - 8) y = e.clientY - h - p;
  tt.style.left = x + "px"; tt.style.top = y + "px";
}
const hideTT = () => tt.classList.remove("on");

/* colour ramp: cyan past goal → red well short */
function lvlColour(ratio, logged) {
  if (ratio === null) return logged ? "var(--l4)" : "var(--none)";
  if (ratio >= 1.2) return "var(--l5)";
  if (ratio >= 1)   return "var(--l4)";
  if (ratio >= 0.8) return "var(--l3)";
  if (ratio >= 0.6) return "var(--l2)";
  if (ratio >= 0.4) return "var(--l1)";
  if (ratio > 0)    return "var(--l0)";
  return "var(--none)";
}
function avatarHTML(p, cls) {
  const c = (p && p.colour) || "#7B8D98";
  if (p && p.avatar_url)
    return `<img class="av ${cls||''}" style="border-color:${esc(c)}" src="${esc(p.avatar_url)}" alt="">`;
  return `<div class="av ${cls||''}" style="background:${esc(c)};border-color:${esc(c)}">${esc(initials(p && p.display_name))}</div>`;
}

/* ---------------- state ---------------- */
let UID = null, ME = null;
/* ---------------------------------------------------------------------------
   What this client actually holds.

   It used to hold the whole database: everybody's sessions, everybody's
   subjects, everybody's areas, re-read in full every few seconds. At eight
   people that was merely wasteful. At four hundred it is about three
   megabytes a read before anyone has logged anything, which no amount of
   tuning survives.

   So: your own rows in full, because you are the only person who can edit
   them — and for everyone else, the rollup the statistics are actually made
   of. Every crew-wide number in this app (hours, streaks, the charts, the
   sparklines, goal-hit rates) comes from one fact, how many minutes a person
   did on a day, and that is what `daily` carries.
   --------------------------------------------------------------------------- */
const DB = {
  profiles: [],          /* everyone — names, colours and goal settings */
  subjects: [],          /* mine */
  areas: [],             /* mine */
  sessions: [],          /* mine */
  goals: [],             /* mine, plus everyone's inside the window */
  timers: [],            /* everyone, and tiny */
  daily: new Map(),      /* user_id -> { days: {"2026-09-14":[minutes,sessions]}, first_day, ... } */
  crewSubjects: [],      /* [{ key, label, takers:[user_id] }] for the leaderboard picker */
  feed: [],              /* the 40 most recent sessions crew-wide, labels included */
  allSessions: null,     /* only ever filled for the admin console */
  /* session_id -> { kudos:[uid], sus:[uid] }, only for rows currently drawable:
     your own day, the forty in the feed, and whoever's profile is open. Asked
     for by id rather than held whole — this app spent a commit getting the
     habit of downloading tables it only needed forty rows of. */
  reactions: {},
  /* owner_id -> { kudos:[uid], sus:[uid], at:started_at }. Bounded by who is
     actually running a timer, so unlike the session ones this is read whole. */
  timerReactions: {}
};

/* How far back the rollup reaches. Long enough for any streak anyone will
   have before the HSC, short enough that it stays small. */
const CREW_WINDOW_DAYS = 180;
const crewSince = () => addDays(todayISO(), -CREW_WINDOW_DAYS);

/* The one lookup everything else is built on. */
function dayCell(uid, day) {
  const e = DB.daily.get(uid);
  const v = e && e.days && e.days[day];
  return v || [0, 0];
}
const minutesOn  = (uid, day) => dayCell(uid, day)[0];
const sessionsOn = (uid, day) => dayCell(uid, day)[1];

/* Rows come back from the rpc as an array; this is the shape the app reads. */
function absorbDaily(rows, merge) {
  if (!merge) DB.daily = new Map();
  (rows || []).forEach(r => {
    const cur = DB.daily.get(r.user_id);
    if (cur && merge) {
      Object.assign(cur.days, r.days || {});
      cur.first_day     = r.first_day || cur.first_day;
      cur.total_minutes = Number(r.total_minutes || 0);
      cur.total_sessions = Number(r.total_sessions || 0);
    } else {
      DB.daily.set(r.user_id, {
        days: r.days || {},
        first_day: r.first_day || null,
        total_minutes: Number(r.total_minutes || 0),
        total_sessions: Number(r.total_sessions || 0)
      });
    }
  });
}

/* Your own edits show up at once rather than waiting for the next read, and
   the read that follows only confirms them. */
function patchDaily(uid, day, minutes, sessions) {
  let e = DB.daily.get(uid);
  if (!e) { e = { days: {}, first_day: day, total_minutes: 0, total_sessions: 0 }; DB.daily.set(uid, e); }
  const cur = e.days[day] || [0, 0];
  const next = [Math.max(0, cur[0] + minutes), Math.max(0, cur[1] + sessions)];
  if (next[0] === 0 && next[1] === 0) delete e.days[day]; else e.days[day] = next;
  e.total_minutes  = Math.max(0, e.total_minutes + minutes);
  e.total_sessions = Math.max(0, e.total_sessions + sessions);
  if (!e.first_day || day < e.first_day) e.first_day = day;
}

const crewTotals = () => {
  let m = 0, n = 0;
  DB.daily.forEach(e => { m += e.total_minutes; n += e.total_sessions; });
  return { hours: m / 60, sessions: n };
};
let CUR = todayISO();
/* The Peloton page opens on the last seven days. A single day swings too hard
   on who happened to have a free period — the week is the truer picture of who
   is actually putting the work in. Today is still one tap away. */
let RANGE = 7;
let localTimer = null, tickHandle = null, pollHandle = null, lastBeat = 0;
/* Whether our live_timers row is known to be on the table. A heartbeat may only
   conclude that a session was finished elsewhere if the row was there to begin
   with — otherwise a start that never reached the server would come back a
   minute later as a timer silently binned, taking the time on it with it.
   Declared up here with the rest of the timer state because restoreTimer() and
   the cross-tab listener both touch it, and both can run before the bottom of
   this file has been reached. */
let timerLive = false;
/* When this tab last wrote to its live_timers row, and how many of those
   writes are still in the air. A read that set off before a write finished
   cannot say whether the row still exists — it may have been answered from
   before the write landed — so it is never allowed to reinstate a timer you
   have just stopped. Getting this wrong resurrects a session the moment you
   finish it. */
let timerTouched = 0, timerWrites = 0;
function timerWriteStart() { timerWrites++; timerTouched = Date.now(); }
function timerWriteEnd()   { timerWrites = Math.max(0, timerWrites - 1); timerTouched = Date.now(); }

const profileOf = id => DB.profiles.find(p => p.id === id) || {id, display_name:"Unknown", colour:"#7B8D98"};
/* Whoever's profile is open, fetched when you click them. This client keeps
   its own subjects and areas and nobody else's, so a visitor's rows live here
   for as long as their profile is on screen and the lookups below fall
   through to them. */
let GUEST = { id: null, subjects: [], areas: [], sessions: [] };

const mySubjects = uid => uid === UID ? DB.subjects : (GUEST.id === uid ? GUEST.subjects : []);
const myAreas    = uid => uid === UID ? DB.areas    : (GUEST.id === uid ? GUEST.areas    : []);
const areaById   = id => DB.areas.find(a => a.id === id)    || GUEST.areas.find(a => a.id === id);
const subjById   = id => DB.subjects.find(s => s.id === id) || GUEST.subjects.find(s => s.id === id);

function goalFor(uid, day) {
  const o = DB.goals.find(g => g.user_id === uid && g.day === day);
  if (o) return Number(o.hours);
  const p = DB.profiles.find(x => x.id === uid);
  if (!p) return 0;
  if (Array.isArray(p.weekday_goals) && p.weekday_goals.length === 7) {
    const v = p.weekday_goals[dowIdx(day)];
    if (v !== null && v !== undefined && v !== "") return Number(v);
  }
  return Number(p.default_goal || 0);
}
const hoursFor = (uid, day) => minutesOn(uid, day) / 60;

function ratioFor(uid, day) {
  const g = goalFor(uid, day), h = hoursFor(uid, day);
  if (g <= 0) return h > 0 ? 1 : null;
  return h / g;
}
/* streak: consecutive days ending today where the goal was met; goal 0 passes through */
function streakFor(uid) {
  let cur = 0, d = todayISO();
  const first = firstDayFor(uid);
  for (let i = 0; i < 400; i++) {
    if (first && d < first) break;
    const g = goalFor(uid, d), h = hoursFor(uid, d);
    if (g <= 0) { d = addDays(d, -1); continue; }
    if (h >= g) { cur++; d = addDays(d, -1); }
    else if (i === 0 && h < g) { d = addDays(d, -1); }   // today still has time left
    else break;
  }
  return cur;
}
function longestStreakFor(uid) {
  const days = allDaysFor(uid); let run = 0, best = 0;
  days.forEach(d => {
    const g = goalFor(uid, d), h = hoursFor(uid, d);
    if (g <= 0 || h >= g) { run++; best = Math.max(best, run); } else run = 0;
  });
  return best;
}
function firstDayFor(uid) {
  const e = DB.daily.get(uid);
  return (e && e.first_day) || null;
}
function allDaysFor(uid) {
  const f = firstDayFor(uid); if (!f) return [];
  const out = []; let d = f, t = todayISO();
  while (d <= t && out.length < 500) { out.push(d); d = addDays(d, 1); }
  return out;
}
function rangeDays() {
  const t = todayISO();
  if (RANGE === 0) {
    /* "All time" reaches back to the first day anybody logged, or to the edge
       of the rollup window, whichever is nearer. */
    let start = null;
    DB.daily.forEach(e => { if (e.first_day && (!start || e.first_day < start)) start = e.first_day; });
    const edge = crewSince();
    if (!start) start = t;
    else if (start < edge) start = edge;
    const out = []; let d = start;
    while (d <= t && out.length < 500) { out.push(d); d = addDays(d, 1); }
    return out.length ? out : [t];
  }
  const out = [];
  for (let i = RANGE - 1; i >= 0; i--) out.push(addDays(t, -i));
  return out;
}

/* =========================================================================
   AUTH
   ========================================================================= */
let authMode = "in";
function authMsg(kind, text) {
  $("au-msg").innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : "";
}
function paintAuthMode() {
  const up = authMode === "up";
  /* the brand lockup sits right above this, so do not say it twice */
  const crew = String(CFG.CREW_NAME || "").trim();
  const named = crew && !isGenericName(crew) ? crew : null;
  $("au-title").textContent = up ? (named ? "Join " + named : "Join the peloton")
                                 : (named || "Welcome back");
  $("au-lede").textContent  = up ? "Make an account so the others can see how you are going."
                                 : "Sign in to see how the peloton is going.";
  $("au-go").textContent    = up ? "Create account" : "Sign in";
  $("au-namefield").style.display = up ? "" : "none";
  $("au-tab-in").setAttribute("aria-selected", String(!up));
  $("au-tab-up").setAttribute("aria-selected", String(up));
  $("au-pass").setAttribute("autocomplete", up ? "new-password" : "current-password");
}
function switchMode(m) { authMode = m; authMsg(); paintAuthMode(); }
document.querySelectorAll("[data-authmode]").forEach(b =>
  b.addEventListener("click", () => switchMode(b.dataset.authmode)));
$("au-go").addEventListener("click", doAuth);
["au-email","au-pass","au-name"].forEach(id =>
  $(id).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doAuth(); } }));

/* Supabase speaks in error strings. Say something a person can act on. */
function friendlyAuthError(err) {
  const m = String((err && err.message) || "").toLowerCase();
  if (m.includes("invalid login credentials"))
    return "That email and password do not match. Check both — or create an account if you have not yet.";
  if (m.includes("email not confirmed"))
    return "Your email has not been confirmed yet. Click the link in the email Supabase sent you, then sign in.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "There is already an account on that email. Sign in instead.";
  if (m.includes("password should be") || m.includes("password must"))
    return "That password is too short — use at least 6 characters.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts just now. Wait a minute and try again.";
  if (m.includes("failed to fetch") || m.includes("networkerror"))
    return "Could not reach the server. Check your connection and try again.";
  return (err && err.message) || "That did not work.";
}

let authBusy = false;
async function doAuth() {
  if (authBusy) return;                                  /* stop double submits */
  const up    = authMode === "up";
  const email = $("au-email").value.trim().toLowerCase();
  const pass  = $("au-pass").value;
  const name  = $("au-name").value.trim();

  if (!email || !pass) { authMsg("err", "Email and password are both needed."); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { authMsg("err", "That does not look like an email address."); return; }
  if (up && !name) { authMsg("err", "Pick a display name — it is how you show up on the leaderboard."); return; }
  if (up && pass.length < 6) { authMsg("err", "Use a password of at least 6 characters."); return; }
  const allow = CFG.ALLOWED_EMAILS || [];
  if (up && allow.length && !allow.map(x => x.toLowerCase()).includes(email)) {
    authMsg("err", "That email is not on the invite list for this peloton."); return;
  }

  authBusy = true;
  $("au-go").disabled = true;
  $("au-go").textContent = up ? "Creating account…" : "Signing in…";
  authMsg();
  try {
    if (up) {
      const { data, error } = await sb.auth.signUp({
        email, password: pass, options: { data: { display_name: name } }
      });
      if (error) throw error;

      /* Supabase hands back a user with no identities when the email is taken,
         rather than admitting the account exists. Treat that as "sign in". */
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        switchMode("in");   /* switching clears the message, so say it after */
        authMsg("err", "There is already an account on that email. Sign in instead.");
        return;
      }
      /* Confirmation off: signUp already returns a session and we are in. */
      if (data.session) { await enterSession(data.session); return; }

      /* Confirmation on, or the session did not come back — try signing in. */
      const { data: d2, error: e2 } = await sb.auth.signInWithPassword({ email, password: pass });
      if (!e2 && d2 && d2.session) { await enterSession(d2.session); return; }
      switchMode("in");
      authMsg("ok", "Account created. Click the confirmation link in your email, then come back and sign in.");
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      if (!data || !data.session) throw new Error("Signed in, but no session came back. Try again.");
      await enterSession(data.session);
    }
  } catch (err) {
    authMsg("err", friendlyAuthError(err));
  } finally {
    authBusy = false;
    $("au-go").disabled = false;
    paintAuthMode();                                     /* restores the label */
  }
}
$("signout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

/* =========================================================================
   BOOT
   ========================================================================= */
function show(which) {
  ["boot","auth","onb","app"].forEach(id => $(id).classList.toggle("hide", id !== which));
}
(async function boot() {
  if (!sb) {
    show("auth");
    $("au-title").textContent = "Not configured yet";
    $("au-lede").textContent = "Open config.js and put your Supabase project URL and anon key in it.";
    ["au-email","au-pass","au-go"].forEach(id => $(id).style.display = "none");
    const seg = document.querySelector(".authseg"); if (seg) seg.style.display = "none";
    return;
  }
  paintAuthMode();
  const { data } = await sb.auth.getSession();
  await enterSession(data.session);

  /* This is what actually drives the app after a sign-in or sign-up. Without it
     a successful sign-in leaves you sitting on the login screen. */
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) { UID = null; ME = null; show("auth"); return; }
    if (event === "SIGNED_IN" || event === "USER_UPDATED") enterSession(session);
  });
})();

/* One way in, whoever calls it, and safe to call twice for the same session. */
let entering = null;
async function enterSession(session) {
  if (!session) { UID = null; ME = null; show("auth"); return; }
  if (entering === session.user.id) return;
  entering = session.user.id;
  try { await onSession(session); }
  finally { entering = null; }
}

/* The signup trigger in schema.sql normally creates the profile row before we
   get here. Occasionally we win the race, so wait for it before inserting. */
async function ensureProfile(session) {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 200 + i * 250));
    await loadAll();
    const p = DB.profiles.find(x => x.id === UID);
    if (p) return p;
  }
  const meta = session.user.user_metadata || {};
  const { error } = await sb.from("profiles").insert({
    id: UID,
    display_name: meta.display_name || String(session.user.email || "").split("@")[0] || "New member"
  });
  if (error && error.code !== "23505") console.error("profile insert", error);
  await loadAll();
  return DB.profiles.find(x => x.id === UID) || null;
}

async function onSession(session) {
  if (!session) { show("auth"); return; }
  UID = session.user.id;
  show("boot");
  try {
    await loadAll();
    ME = DB.profiles.find(p => p.id === UID) || await ensureProfile(session);
    if (!ME) {
      show("auth");
      authMsg("err", "Signed in, but there is no profile row for you and one could not be made. Has schema.sql been run on this project?");
      return;
    }
    if (!ME.onboarded) { startOnboarding(); return; }
    show("app");
    subscribeRealtime();
    restoreTimer();
    try { await loadReactions(); } catch (e) { /* counts can wait */ }
    renderAll();
    initReminders();
    loadPokes();
    /* Asks the database whether this account is an administrator and reveals
       the console entry in Setup if it is. Never blocks the app: a project
       that has not re-run schema.sql simply has no console. */
    if (typeof adminBoot === "function") adminBoot();
  } catch (err) {
    console.error(err);
    show("auth");
    authMsg("err", "Signed in, but the data would not load: " + ((err && err.message) || err));
  }
}

/* ---------------------------------------------------------------------------
   Who is allowed to write DB.timers.

   Two readers race for it: the quick live_timers poll, and the live_timers
   leg of the six-table loadAll(). loadAll is slow — it drags the whole
   sessions table behind it — so its snapshot of the timers is taken early
   and lands late. Without a guard it happily reinstates a started_at that
   a poll has already superseded, and every clock on screen jumps back to
   where it was before, until the next poll drags it forward again. That
   flicker is what looks like a caching bug from the outside.

   So reads take a ticket on the way out, and a read that comes back after
   a newer one has already landed is thrown away.
   --------------------------------------------------------------------------- */
let timersIssued = 0, timersApplied = 0;
const timersTicket = () => ++timersIssued;
function applyTimers(rows, ticket, readAt) {
  if (ticket <= timersApplied) return false;     /* a fresher read beat us home */
  timersApplied = ticket;
  DB.timers = rows || [];
  adoptOrphanTimer(readAt);
  return true;
}

/* ---------------------------------------------------------------------------
   Adopting a timer of your own that this tab has lost track of.

   Every control on the timer card is gated on localTimer being set — Discard
   included. So if a row of yours is sitting on the server while this tab
   believes nothing is running, there is no way left to stop it: Discard is
   greyed out, and the crew carries on seeing you "studying" for as long as the
   row survives. That is how a timer ends up stuck for twenty-five hours.

   The row is the truth, so take it back rather than leaving it unreachable.
   A read that began before your last button press is ignored, so the poll
   that was already in flight when you pressed Discard cannot undo it.
   --------------------------------------------------------------------------- */
function adoptOrphanTimer(readAt) {
  if (localTimer || !UID) return;
  if (timerWrites > 0) return;                 /* a write is still in the air */
  if (readAt && readAt < timerTouched) return; /* this read predates it landing */
  const row = DB.timers.find(t => t.user_id === UID);
  if (!row) return;
  localTimer = row;
  timerLive = true;                 /* we just read it, so it is on the table */
  try { paintTimer(); startClock(); } catch (e) { /* page not built yet */ }
}

/* The activity feed needs other people's subject and area names, which this
   client no longer keeps. Forty rows, with the two names came along for the
   ride, is far cheaper than everybody's subject tables. */
const FEED_COLUMNS = "*, subjects(name, colour), areas(name)";
const feedRow = r => Object.assign({}, r, {
  subject_name:   r.subjects ? r.subjects.name   : null,
  subject_colour: r.subjects ? r.subjects.colour : null,
  area_name:      r.areas    ? r.areas.name      : null,
  subjects: undefined, areas: undefined
});

function normaliseProfiles() {
  DB.profiles.forEach(p => {
    if (typeof p.weekday_goals === "string") {
      try { p.weekday_goals = JSON.parse(p.weekday_goals); } catch (e) { p.weekday_goals = null; }
    }
  });
}

/* The whole picture. Runs when you sign in and after you change something of
   your own — a handful of times a visit, not every few seconds. */
async function loadAll() {
  const ticket = timersTicket(), readAt = Date.now();
  const since = crewSince();
  const [pr, su, ar, se, go, ti, cd, cs, fe, tr] = await Promise.all([
    sb.from("profiles").select("*"),
    sb.from("subjects").select("*").eq("user_id", UID).order("position"),
    sb.from("areas").select("*").eq("user_id", UID).order("position"),
    sb.from("sessions").select("*").eq("user_id", UID).order("day", { ascending: false }),
    /* everyone's overrides inside the window, and all of your own so your
       own longest streak stays right however far back it goes */
    sb.from("goals").select("*").or("user_id.eq." + UID + ",day.gte." + since),
    sb.from("live_timers").select("*"),
    sb.rpc("crew_daily", { since }),
    sb.rpc("crew_subjects"),
    sb.from("sessions").select(FEED_COLUMNS).order("created_at", { ascending: false }).limit(40),
    /* Errors rather than throws on a project that has not run migrate.sql yet,
       which absorbTimerReactions reads as "nobody has reacted". */
    sb.from("timer_reactions").select("*")
  ]);
  /* Set off before the last write landed, so it cannot know about it. Throwing
     it away costs one more read; believing it un-deletes things. */
  if (readAt <= dataTouched) return false;
  DB.profiles = pr.data || []; DB.subjects = su.data || []; DB.areas = ar.data || [];
  DB.sessions = se.data || []; DB.goals = go.data || [];
  absorbDaily(cd.data, false);
  DB.crewSubjects = (cs.data || []).map(r => ({ key: r.key, label: r.label, takers: r.takers || [] }));
  DB.feed = (fe.data || []).map(feedRow);
  applyTimers(ti.data, ticket, readAt);
  /* After applyTimers, never before: each reaction is matched against the
     started_at it was aimed at, so running it first compares against the
     previous read's timers and drops every reaction on a timer that has just
     been started or restarted. */
  absorbTimerReactions(tr);
  normaliseProfiles();
  return true;
}

/* What the automatic path reads instead.

   Nothing that happened while you were looking at the page can change a day
   other than today — you cannot log into last Tuesday from here — so the
   rollup only has to be asked about the last couple of days, which is a few
   kilobytes rather than the lot. Profiles are left alone: they change when
   somebody edits their name, and realtime says so when they do. */
let crewReloadProfiles = false;
async function loadCrew() {
  const ticket = timersTicket(), readAt = Date.now();
  const since = addDays(todayISO(), -1);
  /* only_active: somebody who has not logged anything in the last two days has
     nothing to merge, and four hundred rows saying so is most of what this
     read would otherwise cost. */
  const newest = DB.feed.length ? DB.feed[0].created_at : null;
  const feedJob = newest
    ? sb.from("sessions").select(FEED_COLUMNS).gt("created_at", newest)
        .order("created_at", { ascending: false }).limit(40)
    : sb.from("sessions").select(FEED_COLUMNS).order("created_at", { ascending: false }).limit(40);

  const jobs = [
    sb.rpc("crew_daily", { since, only_active: true }),
    sb.from("live_timers").select("*"),
    feedJob,
    sb.from("timer_reactions").select("*")
  ];
  if (crewReloadProfiles) jobs.push(sb.from("profiles").select("*"));
  const [cd, ti, fe, tr, pr] = await Promise.all(jobs);
  if (readAt <= dataTouched) return false;
  absorbDaily(cd.data, true);            /* merged, so older days are kept */
  if (LB_SUBJECT) { SUBJECT_DAILY.key = null; await loadSubjectDaily(LB_SUBJECT); }
  /* Only what is new since last time, put on the front. A session somebody
     deleted elsewhere can linger here until the next full read; it is a list
     of what happened, and the rules that matter are enforced in the database. */
  const fresh = (fe.data || []).map(feedRow);
  DB.feed = newest ? fresh.concat(DB.feed).slice(0, 40) : fresh;
  if (pr && pr.data) { DB.profiles = pr.data; normaliseProfiles(); crewReloadProfiles = false; }
  applyTimers(ti.data, ticket, readAt);
  /* After applyTimers, never before: each reaction is matched against the
     started_at it was aimed at, so running it first compares against the
     previous read's timers and drops every reaction on a timer that has just
     been started or restarted. */
  absorbTimerReactions(tr);
  return true;
}
/* A refresh asked for while one is already running used to be dropped on the
   floor — which is how a delete could finish, ask for the repaint that would
   have shown it gone, and get nothing. Now it is remembered and run after,
   and a read discarded as stale asks again by the same route. */
let refreshing = false, refreshQueued = false, refreshWantsAll = false;
async function runRefresh(rerender, full) {
  if (refreshing) { refreshQueued = true; refreshWantsAll = refreshWantsAll || full; return; }
  refreshing = true;
  refreshWantsAll = full;
  try {
    let tries = 0;
    do {
      refreshQueued = false;
      const wantAll = refreshWantsAll;
      refreshWantsAll = false;
      if (await (wantAll ? loadAll() : loadCrew())) {
        ME = DB.profiles.find(p => p.id === UID) || ME;
        /* After the rows, because it asks by id for exactly the ones just
           read. Failing here leaves the entries drawn without their counts,
           which is a great deal better than not drawing the entries. */
        try { await loadReactions(); } catch (e) { /* counts can wait */ }
        if (rerender !== false) renderAll();
      } else {
        refreshQueued = true;            /* stale read — go round again */
        refreshWantsAll = refreshWantsAll || wantAll;
      }
    } while (refreshQueued && ++tries < 5);
  } finally { refreshing = false; refreshQueued = false; refreshWantsAll = false; }
}

/* After something of yours changed: read the lot. */
const refresh = rerender => runRefresh(rerender, true);

/* The automatic path — a timer firing, somebody else logging a session, a tab
   coming back to the front. This is the one that runs hundreds of times an
   evening across the year group, so it reads kilobytes, not megabytes. */
const refreshCrew = () => runRefresh(undefined, false);
/* live_timers is a handful of rows, so it is cheap to ask for it often. This is
   deliberately NOT a full refresh: it swaps in the timers and repaints the two
   live areas, leaving the rest of the page — and anything you are typing — alone. */
async function pollTimers() {
  if (!sb || !UID || document.hidden) return;
  const ticket = timersTicket(), readAt = Date.now();
  try {
    const { data, error } = await sb.from("live_timers").select("*");
    if (error) return;
    if (!applyTimers(data, ticket, readAt)) return;   /* stale by the time it arrived */
    paintLive();          /* the signature decides whether the DOM actually changes */
  } catch (e) { /* a dropped poll is not worth bothering anyone about */ }
}

/* ---------------------------------------------------------------------------
   Coalescing the crew feed.

   Realtime fans out: one person logging a session wakes every connected
   client at the same instant, and refresh() is six full-table reads — the
   whole sessions table among them. Ten people with a tab each turned every
   single write into sixty queries, all at once, and a running timer
   heartbeats into live_timers every sixty seconds on top of that. That is
   what flattened the free-tier instance.

   So: bursts collapse into one read, and a tab nobody is looking at does no
   work at all. It catches up the moment you look at it again.
   --------------------------------------------------------------------------- */
/* The reconciling read. It used to be the thing that made the page live, so it
   had to be quick; now realtime moves the numbers and this only tidies up
   behind it — the feed, other people's edits, anything a dropped socket
   missed. A minute is plenty, and at four hundred people the difference
   between eight seconds and sixty is most of the bandwidth bill. */
const REFRESH_GAP = 60000;
const TIMERS_GAP  = 5000;
let refreshHandle = null, refreshAt = 0;
let timersHandle  = null, timersAt  = 0;
let missedWhileHidden = false;

function refreshSoon() {
  if (document.hidden) { missedWhileHidden = true; return; }
  if (refreshHandle) return;                       /* one is already queued */
  refreshHandle = setTimeout(() => {
    refreshHandle = null; refreshAt = Date.now(); missedWhileHidden = false;
    refreshCrew();
  }, Math.max(0, REFRESH_GAP - (Date.now() - refreshAt)));
}

function pollTimersSoon() {
  if (document.hidden) { missedWhileHidden = true; return; }
  if (timersHandle) return;
  timersHandle = setTimeout(() => {
    timersHandle = null; timersAt = Date.now();
    pollTimers();
  }, Math.max(0, TIMERS_GAP - (Date.now() - timersAt)));
}

/* Somebody else logged a session.

   This used to send every connected client off to re-read, which is the shape
   that does not survive four hundred people: one person pressing save turns
   into four hundred reads. But an insert arrives carrying the whole row, and
   the rollup only wants the minutes and the day — so the numbers move at once,
   for nothing, and the read becomes a slow reconcile rather than a reflex.

   Edits and deletions come through without the old row attached, so those
   still ask; they are a fraction of the traffic. */
function onCrewSession(payload) {
  const row = payload && (payload.new || payload.old);
  const kind = payload && payload.eventType;
  if (!row || row.user_id === UID) return;     /* your own are applied locally already */
  if (kind === "INSERT" && row.day && row.minutes) {
    patchDaily(row.user_id, row.day, Number(row.minutes), 1);
    try { renderAll(); } catch (e) { /* not up yet */ }
    return;
  }
  refreshSoon();
}

function subscribeRealtime() {
  try {
    sb.channel("crew")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions"    }, onCrewSession)
      /* Chat is subscribed from the start even though nothing is fetched until
         you open the tab — that is what puts the dot on it when somebody
         speaks, and a socket message costs nothing to receive. */
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onChatInsert)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, onChatDelete)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_timers" }, pollTimersSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles"    },
          () => { crewReloadProfiles = true; refreshSoon(); })
      .subscribe();

    /* Nudges are addressed to one person, so each client listens only for
       its own. No filter here would mean every poke woke the whole crew. */
    sb.channel("nudges:" + UID)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "nudges", filter: "to_user=eq." + UID
      }, loadPokes)
      .subscribe();
  } catch (e) { /* realtime is a bonus, not a requirement */ }

  if (pollHandle) return;                       /* only ever wire these up once */
  /* Realtime already tells us the moment anything changes. These intervals
     are only a safety net for a dropped socket, so they can be lazy — and
     they do nothing at all for a tab in the background. */
  pollHandle = setInterval(() => { if (!document.hidden) pollTimersSoon(); }, 30000);
  setInterval(() => { if (!document.hidden) refreshSoon(); }, 300000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    paintTimer();
    pollTimersSoon();
    /* Only re-read everything if something actually happened while you were
       away, or it has gone stale sitting there. */
    if (missedWhileHidden || Date.now() - refreshAt > REFRESH_GAP) refreshSoon();
    loadPokes();   /* one tiny indexed read against a partial index */
  });
  window.addEventListener("online", () => { pollTimersSoon(); refreshSoon(); });
}

/* =========================================================================
   ONBOARDING
   ========================================================================= */
/* The Knox subject catalogue — every HSC course, its 2026 papers and its syllabus
   sections. Purely a starting point: everything it fills in stays editable. */
const CAT = window.HSC_CATALOGUE || { subjects: [], active: [], papers: [], categories: {}, byName: () => null };
let obSubjects = [], obAvatarFile = null, obStep = 1;

function startOnboarding() {
  show("onb");
  $("ob-name").value = ME.display_name || "";
  /* Their row was created with the column default, which is the same for
     everybody, so treat anything still shared as "not chosen yet". */
  const mine = normColour(ME.colour);
  $("ob-colour").value = (mine && !colourClash(mine).length) ? mine : freeProfileColour();
  $("ob-avpreview").textContent = initials(ME.display_name);
  $("ob-avpreview").style.background = ME.colour || "#2FCFA6";
  /* The picker button and the by-hand form are both in the markup now, so they
     are wired once rather than rebuilt every time onboarding starts. */
  if (!$("ob-openpicker").dataset.wired) {
    $("ob-openpicker").dataset.wired = "1";
    $("ob-openpicker").addEventListener("click", () => openPicker({
      taken: () => obSubjects.map(s => s.name),
      pick: c => { addObSubject(c.name, c.exam_date, c.colour, c.areas.slice()); }
    }));
    $("ob-manualtoggle").addEventListener("click", () => {
      const box = $("ob-manual"), open = box.hidden;
      box.hidden = !open;
      $("ob-manualtoggle").setAttribute("aria-expanded", String(open));
      $("ob-manualtoggle").textContent = open
        ? "Hide the by-hand form" : "Not on the list? Type one in by hand";
      if (open) $("ob-subname").focus();
    });
  }
  const wk = DOW.map((d, i) => `<div><label class="fl" style="text-align:center">${d}</label>
    <input type="number" min="0" max="16" step="0.5" id="obwk${i}" value="${i < 5 ? 3 : 5}" style="text-align:center;padding:7px 4px"></div>`).join("");
  $("ob-wk").innerHTML = wk;
  setStep(1);
}
function setStep(n) {
  obStep = n;
  ["ob1","ob2","ob3"].forEach((id, i) => $(id).classList.toggle("hide", i !== n - 1));
  [1,2,3].forEach(i => $("st" + i).classList.toggle("on", i <= n));
  window.scrollTo(0, 0);
}
$("ob-avfile").addEventListener("change", e => {
  obAvatarFile = e.target.files[0] || null;
  if (obAvatarFile) {
    const r = new FileReader();
    r.onload = () => { $("ob-avpreview").innerHTML = `<img class="av xl" src="${r.result}" alt="">`;
      $("ob-avpreview").style.background = "transparent"; };
    r.readAsDataURL(obAvatarFile);
  }
});
$("ob-name").addEventListener("input", e => {
  if (!obAvatarFile) $("ob-avpreview").textContent = initials(e.target.value);
});
$("ob-colour").addEventListener("input", e => {
  if (!obAvatarFile) $("ob-avpreview").style.background = e.target.value;
});
$("ob-next1").addEventListener("click", () => {
  if (!$("ob-name").value.trim()) { toast("Give yourself a display name first"); return; }
  setStep(2);
});
$("ob-back2").addEventListener("click", () => setStep(1));
$("ob-back3").addEventListener("click", () => setStep(2));
$("ob-addsub").addEventListener("click", () => {
  const n = $("ob-subname").value.trim(); if (!n) return;
  addObSubject(n, $("ob-subexam").value || null, $("ob-subcolour").value);
  $("ob-subname").value = ""; $("ob-subexam").value = "";
  $("ob-subcolour").value = PALETTE[obSubjects.length % PALETTE.length];
});
$("ob-subname").addEventListener("keydown", e => { if (e.key === "Enter") $("ob-addsub").click(); });

function addObSubject(name, exam, colour, areas) {
  if (obSubjects.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
  /* typing a subject by hand still gets its catalogue sections if the name matches */
  const c = areas ? null : CAT.byName(name);
  obSubjects.push({ name, exam_date: exam || (c && c.exam_date) || null,
    colour: colour || (c && c.colour) || PALETTE[obSubjects.length % PALETTE.length],
    areas: areas || (c ? c.areas.slice() : []) });
  paintObSubjects();
}
function paintObSubjects() {
  const box = $("ob-sublist");
  if (!obSubjects.length) { box.innerHTML = `<div class="empty">No subjects yet. Add at least one to continue.</div>`; return; }
  box.innerHTML = obSubjects.map((s, i) => `
    <div class="card" style="margin-bottom:10px;box-shadow:none">
      <div class="body" style="padding:12px 14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
          <span class="swatch" style="background:${esc(s.colour)}"></span>
          <strong style="flex:1">${esc(s.name)}</strong>
          <span style="font-size:11.5px;color:var(--ink-soft)">${s.exam_date ? "exam " + fmtD(s.exam_date) : "no exam date"}</span>
          <button class="x" data-rm="${i}" title="Remove">×</button>
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px">
          ${s.areas.map((a, j) => `<span class="chip" style="cursor:default" title="Click the name to rename">
            <span contenteditable="true" data-rna="${i}:${j}" style="outline:none;min-width:12px;display:inline-block">${esc(a)}</span>
            <button class="x" data-rma="${i}:${j}" style="font-size:12px;padding:0 2px;margin-left:3px">×</button></span>`).join("")
            || `<span style="font-size:12px;color:var(--ink-soft)">No areas yet — optional, but they make your stats much sharper.</span>`}
        </div>
        <div style="display:flex;gap:8px">
          <input type="text" data-ain="${i}" placeholder="Add an area, e.g. Module B — Eliot" style="font-size:12.5px;padding:6px 9px">
          <button class="btn ghost sm" data-aadd="${i}">Add area</button>
        </div>
      </div>
    </div>`).join("");
  box.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => {
    obSubjects.splice(+b.dataset.rm, 1); paintObSubjects(); }));
  box.querySelectorAll("[data-rma]").forEach(b => b.addEventListener("click", () => {
    const [i, j] = b.dataset.rma.split(":").map(Number); obSubjects[i].areas.splice(j, 1); paintObSubjects(); }));
  box.querySelectorAll("[data-rna]").forEach(el => {
    const commit = () => {
      const [i, j] = el.dataset.rna.split(":").map(Number);
      const v = el.textContent.trim();
      if (v) obSubjects[i].areas[j] = v; else paintObSubjects();
    };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } });
  });
  box.querySelectorAll("[data-aadd]").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.aadd, inp = box.querySelector(`[data-ain="${i}"]`);
    const v = inp.value.trim(); if (!v) return;
    obSubjects[i].areas.push(v); paintObSubjects(); }));
  box.querySelectorAll("[data-ain]").forEach(inp => inp.addEventListener("keydown", e => {
    if (e.key === "Enter") box.querySelector(`[data-aadd="${inp.dataset.ain}"]`).click(); }));
}
$("ob-next2").addEventListener("click", () => {
  if (!obSubjects.length) { toast("Add at least one subject"); return; }
  setStep(3);
});
$("ob-finish").addEventListener("click", async () => {
  $("ob-finish").disabled = true;
  try {
    let avatar_url = (ME && ME.avatar_url) || null;
    if (obAvatarFile) {
      /* a picture is not worth losing the whole signup over */
      try { avatar_url = await uploadAvatar(obAvatarFile); }
      catch (e) { toast("Could not upload the picture — carrying on without it"); }
    }
    const wk = DOW.map((_, i) => Number($("obwk" + i).value));
    await sb.from("profiles").update({
      display_name: $("ob-name").value.trim(),
      colour: $("ob-colour").value,
      avatar_url,
      weekday_goals: wk,
      default_goal: Number($("ob-default").value) || 0,
      onboarded: true
    }).eq("id", UID);

    for (let i = 0; i < obSubjects.length; i++) {
      const s = obSubjects[i];
      const { data } = await sb.from("subjects").insert({
        user_id: UID, name: s.name, colour: s.colour, exam_date: s.exam_date, position: i
      }).select().single();
      if (data && s.areas.length) {
        await sb.from("areas").insert(s.areas.map((a, j) => ({
          user_id: UID, subject_id: data.id, name: a, position: j })));
      }
    }
    await refresh(false);
    ME = DB.profiles.find(p => p.id === UID);
    show("app"); subscribeRealtime(); renderAll();
    toast("You are in. Start the timer when you sit down.");
  } catch (e) {
    toast("Could not save: " + (e.message || e)); $("ob-finish").disabled = false;
  }
});

async function uploadAvatar(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${UID}/avatar-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  return sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

/* =========================================================================
   TABS
   ========================================================================= */
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("nav.tabs button").forEach(x => x.setAttribute("aria-selected", "false"));
  b.setAttribute("aria-selected", "true");
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("on"));
  $("p-" + b.dataset.p).classList.add("on"); hideTT(); window.scrollTo(0, 0);
  paintNowPill();          /* appear or disappear straight away, not a second later */
  /* Chat costs nothing until somebody actually looks at it. */
  if (b.dataset.p === "chat") {
    initChat();
    /* Paint after the load resolves — which is immediately once it has loaded
       once. Anything that arrived over the socket while you were on another
       tab is already in CHAT.rows and needs putting on the screen. */
    loadChat().then(() => { paintChat(); CHAT.unread = 0; paintChatDot(); chatScrollBottom(true); });
    CHAT.unread = 0; paintChatDot();
  }
}));

/* the pill's own controls just drive the real timer buttons */
$("np-go").addEventListener("click", goToTimer);
$("np-pause").addEventListener("click", () => {
  if (!localTimer) return;
  (localTimer.running ? $("tm-pause") : $("tm-start")).click();
  paintNowPill();
});
$("np-stop").addEventListener("click", () => { goToTimer(); $("tm-stop").click(); });
$("rangechips").querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => {
  $("rangechips").querySelectorAll("[data-r]").forEach(x => x.setAttribute("aria-pressed", "false"));
  b.setAttribute("aria-pressed", "true"); RANGE = +b.dataset.r; renderCrew();
}));
/* The pressed chip follows RANGE rather than the markup, so a browser still
   holding a cached index.html never shows one range highlighted over another. */
$("rangechips").querySelectorAll("[data-r]").forEach(x =>
  x.setAttribute("aria-pressed", String(+x.dataset.r === RANGE)));

/* =========================================================================
   SELECTS  (subject / area pickers built from the signed-in user's own data)
   ========================================================================= */
/* Two selects rather than one long list: the subject, then the part of it.
   The area list follows whatever subject is chosen. */
const SEL_PAIRS = [["tm-subj","tm-area"], ["f-subj","f-area"], ["ms-subj","ms-area"], ["e-subj","e-area"]];

/* `owner` is almost always you. It is somebody else only when an admin is
   correcting their session, and then the lists have to be *their* subjects —
   a session cannot point at a subject its owner does not have. */
function subjectOptionsHTML(owner) {
  const subs = mySubjects(owner || UID);
  if (!subs.length) return `<option value="">${owner && owner !== UID
    ? "This member has no subjects" : "Add a subject in Setup first"}</option>`;
  return subs.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
}
function areaOptionsHTML(subjectId, owner) {
  const as = myAreas(owner || UID).filter(a => a.subject_id === subjectId);
  return `<option value="">Whole subject</option>` +
    as.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
}
function paintAreaSelect(sid, aid, keep, owner) {
  const want = keep !== undefined ? keep : $(aid).value;
  $(aid).innerHTML = areaOptionsHTML($(sid).value, owner);
  if (want && $(aid).querySelector('[value="' + want + '"]')) $(aid).value = want;
}
function paintSelects() {
  const html = subjectOptionsHTML();
  SEL_PAIRS.forEach(([sid, aid]) => {
    /* The edit sheet may be showing another member's subjects right now.
       A background refresh must not quietly swap them for yours. */
    if (sid === "e-subj" && editingId) return;
    const ks = $(sid).value, ka = $(aid).value;
    $(sid).innerHTML = html;
    if (ks && $(sid).querySelector('[value="' + ks + '"]')) $(sid).value = ks;
    paintAreaSelect(sid, aid, ka);
  });
}
SEL_PAIRS.forEach(([sid, aid]) =>
  $(sid).addEventListener("change", () =>
    paintAreaSelect(sid, aid, "", sid === "e-subj" ? editingOwner : UID)));

function readPair(sid, aid) {
  return { subject_id: $(sid).value || null, area_id: $(aid).value || null };
}
function setPair(sid, aid, subject_id, area_id, owner) {
  if (subject_id) $(sid).value = subject_id;
  paintAreaSelect(sid, aid, area_id || "", owner);
}
/* Feed rows arrive with their subject and area names attached, because they
   belong to people whose subject tables this client no longer holds. Rows of
   your own carry no such names and are looked up live, so renaming a subject
   still shows up straight away. */
function labelOf(s) {
  if (s.area_id)    { const a = areaById(s.area_id);    if (a) return a.name; }
  if (s.subject_id) { const x = subjById(s.subject_id); if (x) return x.name; }
  if (s.area_name)    return s.area_name;
  if (s.subject_name) return s.subject_name;
  return "Study";
}
function colourOf(s) {
  const sub = s.subject_id ? subjById(s.subject_id) : null;
  return (sub && sub.colour) || s.subject_colour || "#7B8D98";
}

/* =========================================================================
   TIMER  (mirrored to live_timers so the crew sees it)
   ========================================================================= */
function elapsedMs() {
  if (!localTimer) return 0;
  return localTimer.acc_ms + (localTimer.running ? Date.now() - new Date(localTimer.started_at).getTime() : 0);
}
function hms(ms) {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(pad).join(":");
}
/* Short form for the tab title and the pill: seconds always visible, hours only
   once there are some. Ticks every second either way. */
function shortTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, sec = total % 60;
  return h ? h + ":" + pad(m) + ":" + pad(sec) : pad(m) + ":" + pad(sec);
}

function paintTimer() {
  const t = localTimer, d = $("tdisp");
  d.textContent = hms(elapsedMs());
  d.classList.toggle("run", !!(t && t.running));
  $("tm-start").textContent = t ? (t.running ? "Running" : "Resume") : "Start";
  $("tm-start").disabled = !!(t && t.running);
  $("tm-pause").disabled  = !(t && t.running);
  $("tm-stop").disabled   = !t;
  $("tm-cancel").disabled = !t;
  $("tsub").textContent = t ? (t.label + (t.running ? "" : " · paused")) : "Nothing running";
  document.title = t ? (t.running ? "▶ " : "❚❚ ") + shortTime(elapsedMs()) + " · " + APP_NAME
                     : nudgeTitle();
  paintFavicon();
  paintNowPill();
  paintLive();
}

/* ---------------------------------------------------------------------------
   The pill that follows you around the app while a session runs. It stays out
   of the way on Today, where the real timer is already on screen.
   --------------------------------------------------------------------------- */
function paintNowPill() {
  const el = $("nowpill");
  if (!el) return;
  const t = localTimer;
  const onHome = $("p-home") && $("p-home").classList.contains("on");
  const show = !!t && !onHome;
  if (el.hidden === show) el.hidden = !show;   /* only touch it when it changes */
  if (!show) return;
  $("np-time").textContent = shortTime(elapsedMs());
  $("np-label").textContent = t.label || "studying";
  $("np-pause").textContent = t.running ? "Pause" : "Resume";
  el.classList.toggle("paused", !t.running);
}

function goToTimer() {
  const tab = document.querySelector('nav.tabs button[data-p="home"]');
  if (tab) tab.click();
  const card = $("tm-start") && $("tm-start").closest(".card");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
}
/* One clock for the whole app, started once and never stopped. It runs whether
   or not you have a timer going, because other people's clocks have to tick too.
   Every displayed time is derived from started_at, so a throttled background tab
   catches up the instant it is foregrounded rather than drifting. */
/* ---------------------------------------------------------------------------
   Two things that stop a forgotten timer telling everybody lies.

   A timer left running overnight is the commonest way this app produces a
   wrong number: fourteen hours appears on the board, the leaderboard believes
   it, and the person has to notice and fix it. Five hours is past any real
   unbroken sitting and well short of a night's sleep, so that is where it
   stops itself — paused, not discarded, and clamped to the cap so the figure
   waiting for you is a plausible one you can still adjust before saving.

   And a paused timer stops beating. The strip works out who is here from how
   recently a timer checked in, so a pause that no longer checks in falls off
   it by itself after a while, instead of a session paused yesterday lunchtime
   still sitting between two people who are actually working.
   --------------------------------------------------------------------------- */
const TIMER_CAP_MS    = 5 * 60 * 60e3;   /* auto-pause a run this long */
const PAUSED_FRESH_MS = 30 * 60e3;       /* how long a pause stays on the strip */

function autoPauseIfStale() {
  if (!localTimer || !localTimer.running) return false;
  if (elapsedMs() < TIMER_CAP_MS) return false;
  localTimer.acc_ms = TIMER_CAP_MS;      /* clamp: the rest was not studying */
  localTimer.running = false;
  paintTimer();
  pushTimer();
  toast("Timer paused itself at five hours. Adjust the minutes when you save it.", 6000);
  return true;
}

function startClock() {
  if (tickHandle) return;
  tickHandle = setInterval(() => {
    if (autoPauseIfStale()) return;      /* it repainted and pushed already */
    paintTimer();
    /* While your timer is actually running, touch updated_at now and then so
       everybody else can tell "still going" from "closed the laptop". A paused
       one deliberately does not, which is what lets it go quiet on its own. */
    if (localTimer && localTimer.running && Date.now() - lastBeat > 60000) {
      lastBeat = Date.now(); pushTimer(true);
    }
  }, 1000);
}
function restoreTimer() {
  const row = DB.timers.find(t => t.user_id === UID);
  if (row) { localTimer = row; timerLive = true; }   /* we just read it, so it exists */
  paintTimer();
  startClock();
}
/* ---------------------------------------------------------------------------
   Mirroring your timer into live_timers.

   The row is keyed on user_id, so every tab and device you have open writes
   to the same one. That matters more than it sounds. A tab left open on a
   phone still believes its timer is running, and a blind upsert from its
   heartbeat puts a session you already finished back on the board carrying
   its own stale started_at — so everyone else's screen flips between that
   and the truth every sixty seconds.

   So a press of a button is authoritative: it upserts, or it deletes. A
   heartbeat only ever touches a row that is already there, and if there is
   nothing to touch it takes the hint and drops the timer here too.
   --------------------------------------------------------------------------- */

/* Tabs belonging to one person also agree among themselves, so two of them
   can never sit pushing different started_at values into the one row. */
let timerChannel = null;
try { timerChannel = new BroadcastChannel("studytrack-timer"); } catch (e) { timerChannel = null; }

function announceTimer() {
  if (!timerChannel || !UID) return;
  try { timerChannel.postMessage({ uid: UID, timer: localTimer }); } catch (e) { /* no listeners */ }
}
if (timerChannel) timerChannel.onmessage = ev => {
  const m = ev && ev.data;
  if (!m || !UID || m.uid !== UID) return;
  localTimer = m.timer || null;
  timerLive = !!localTimer;       /* the tab that pressed the button wrote the row */
  lastBeat = Date.now();
  try { paintTimer(); startClock(); } catch (e) { /* not up yet */ }
};

async function pushTimer(beat) {
  if (!localTimer) {
    if (beat) return;             /* nothing of ours to beat for */
    timerWriteStart();
    const { error } = await sb.from("live_timers").delete().eq("user_id", UID);
    timerWriteEnd();
    if (error) {
      /* The row is still on the table. Saying nothing here is what made the
         old bug so baffling: the card cleared, the crew went on seeing the
         timer, and nothing on screen admitted the difference. The next poll
         adopts the row back so Discard can be pressed again. */
      toast("Could not stop the timer — " + error.message, 4600);
      return;
    }
    timerLive = false;
    announceTimer();
    return;
  }
  const row = {
    user_id: UID, label: localTimer.label, subject_id: localTimer.subject_id, area_id: localTimer.area_id,
    started_at: localTimer.started_at, acc_ms: localTimer.acc_ms, running: localTimer.running,
    updated_at: new Date().toISOString()
  };



  /* A press of a button, or a beat with nothing on the table yet to mend.
     A beat may only CREATE a row to repair a start that never reached the
     server, which it does within the minute. Past that the server is the
     authority, and creating a row again means a tab left open on a phone can
     resurrect a timer somebody has already stopped — so an older timer falls
     through to the update below, which lets it find out it is gone. */
  if (!beat || (!timerLive && elapsedMs() <= 10 * 60000)) {
    if (!beat) timerWriteStart();
    const { error } = await sb.from("live_timers").upsert(row);
    if (!beat) timerWriteEnd();
    if (!error) timerLive = true;
    if (!beat) announceTimer();
    return;
  }

  const { data, error } = await sb.from("live_timers")
    .update(row).eq("user_id", UID).select("user_id");
  /* An error is the network talking, not a verdict — keep the timer and try
     again on the next beat. */
  if (error || !Array.isArray(data) || data.length) return;

  /* Nothing back, with no error, usually means the row has gone. But a write
     the database refuses also returns no rows and no error, and treating that
     as "finished elsewhere" is what stranded the row in the first place: the
     card cleared, the row stayed, and every button that could have removed it
     went grey. So ask whether it is really gone before believing it. */
  const { data: still, error: checkErr } = await sb.from("live_timers")
    .select("user_id").eq("user_id", UID);
  if (checkErr) return;                         /* ask again on the next beat */
  if (still && still.length) return;            /* still there — the write was refused */

  localTimer = null;
  timerLive = false;
  paintTimer();
  toast("That session was finished in another tab");
}
$("tm-start").addEventListener("click", async () => {
  if (localTimer) { localTimer.running = true; localTimer.started_at = new Date().toISOString(); }
  else {
    const t = readPair("tm-subj", "tm-area");
    if (!t.subject_id) { toast("Add a subject in Setup first"); return; }
    const sj = subjById(t.subject_id), ar = t.area_id ? areaById(t.area_id) : null;
    localTimer = { label: ar ? (sj ? sj.name + " · " + ar.name : ar.name) : (sj ? sj.name : "Study"),
      subject_id: t.subject_id, area_id: t.area_id, acc_ms: 0,
      /* The day this is really happening on, not the one you happen to be
         looking at. CUR follows the date picker on Today, so starting a timer
         after scrolling back through last week used to file the hours you are
         sitting there doing into last week. A stopwatch measures now. */
      started_at: new Date().toISOString(), running: true, day: todayISO() };
  }
  lastBeat = Date.now(); paintTimer(); startClock(); pushTimer();
});
$("tm-pause").addEventListener("click", () => {
  if (!localTimer || !localTimer.running) return;
  localTimer.acc_ms = elapsedMs(); localTimer.running = false;
  paintTimer(); pushTimer();
});
$("tm-cancel").addEventListener("click", () => {
  if (elapsedMs() > 60000 && !confirm("Discard this session without logging it?")) return;
  localTimer = null; paintTimer(); pushTimer();
});
$("tm-stop").addEventListener("click", () => {
  if (!localTimer) return;
  const mins = Math.max(1, Math.round(elapsedMs() / 60000));
  $("ms-subj").innerHTML = subjectOptionsHTML();
  setPair("ms-subj", "ms-area", localTimer.subject_id, localTimer.area_id);
  $("ms-min").value = mins;
  $("ms-note").value = "";
  $("ms-sub").textContent = hms(elapsedMs()) + " on " + fmtLong(localTimer.day || todayISO());
  $("ov-save").classList.add("on");
  setTimeout(() => $("ms-note").focus(), 60);
});
$("ms-discard").addEventListener("click", async () => {
  if (!confirm("Discard this session without logging it?")) return;
  localTimer = null; await pushTimer(); $("ov-save").classList.remove("on"); paintTimer();
});
let savingSession = false;
$("ms-save").addEventListener("click", async () => {
  if (savingSession) return;            /* a double tap must not log it twice */
  const t = readPair("ms-subj", "ms-area");
  const day = (localTimer && localTimer.day) || todayISO();
  savingSession = true;
  $("ms-save").disabled = true;
  let saved = false;
  try { saved = await addSession(day, t, +$("ms-min").value, $("ms-note").value.trim()); }
  finally { savingSession = false; $("ms-save").disabled = false; }

  /* Nothing was written, so the timer stays exactly as it was and the sheet
     stays open with the note still in it. You can fix the minutes, or just
     press save again once the connection is back. */
  if (!saved) return;

  localTimer = null; await pushTimer();
  $("ov-save").classList.remove("on"); paintTimer();
});

/* Answers whether the session actually reached the database. Callers that are
   about to throw away the timer it came from have to know: binning a running
   timer on the strength of a save that never happened loses the hours for
   good, and there is nowhere to get them back from. */
async function addSession(day, target, minutes, note) {
  if (!minutes || minutes < 1) { toast("Minutes needs to be at least 1"); return false; }
  const { error } = await sb.from("sessions").insert({
    user_id: UID, subject_id: target.subject_id, area_id: target.area_id,
    day, minutes, note: note || null });
  if (error) { toast("Could not save — " + error.message, 4600); return false; }
  toast("Logged " + f1(minutes / 60) + " h");
  await refresh();
  return true;
}

/* ---------- manual add ---------- */
document.querySelectorAll("[data-min]").forEach(b => b.addEventListener("click", () => $("f-min").value = b.dataset.min));
$("f-add").addEventListener("click", async () => {
  const t = readPair("f-subj", "f-area");
  if (!t.subject_id) { toast("Add a subject in Setup first"); return; }
  await addSession(CUR, t, +$("f-min").value, $("f-note").value.trim());
  $("f-note").value = "";
});
$("h-date").addEventListener("change", e => { if (e.target.value) { CUR = e.target.value; renderHome(); } });
$("h-goal").addEventListener("change", async e => {
  const v = e.target.value === "" ? null : Number(e.target.value);
  if (v === null) return;
  await sb.from("goals").upsert({ user_id: UID, day: CUR, hours: v });
  await refresh();
});
$("h-goalreset").addEventListener("click", async () => {
  await sb.from("goals").delete().eq("user_id", UID).eq("day", CUR);
  await refresh();
});

/* =========================================================================
   RENDER — shell
   ========================================================================= */
function renderAll() {
  paintSelects();
  renderShell(); renderHome(); renderCrew(); renderMe(); renderSetup();
  try { paintNudgeBar(); } catch (e) { console.error(e); }
  try { paintReminders(); } catch (e) { console.error(e); }
  const tot = crewTotals();
  $("footnote").textContent =
    `${DB.profiles.length} member${DB.profiles.length === 1 ? "" : "s"} · ` +
    `${tot.sessions} sessions logged between everyone · ` +
    `${f1(tot.hours)} hours in total.`;
}
function renderShell() {
  $("crewname").textContent = APP_NAME;
  const crew = String(CFG.CREW_NAME || "").trim();
  const chip = $("crewchip");
  if (crew && !isGenericName(crew)) { chip.textContent = crew; chip.hidden = false; }
  else chip.hidden = true;
  $("meblock").dataset.profile = UID;
  const total = crewTotals().hours;
  $("crewsub").textContent = `${DB.profiles.length} ${DB.profiles.length === 1 ? "member" : "members"} · ${f1(total)} hours logged together`;
  $("me-av").outerHTML = avatarHTML(ME, "lg").replace('class="av lg"', 'class="av lg" id="me-av"');
  $("me-name").textContent = ME.display_name;
  const board = leaderboard(7);
  const i = board.findIndex(r => r.id === UID);
  $("me-rank").textContent = i >= 0 ? `#${i + 1} of ${board.length} this week` : "—";
}

/* =========================================================================
   RENDER — home
   ========================================================================= */
/* Somebody whose updated_at has gone quiet has closed the tab, not kept studying.
   Their own heartbeat is every 60s, so five minutes is forgiving of a flaky line. */
const LIVE_FRESH_MS = 5 * 60e3;

/* Rebuilding this markup every second would kill hover states and flicker the
   avatars, so the DOM is only rebuilt when the set of people actually changes.
   In between, the clock text is updated in place. */
let liveSig = "";

function paintLive(force) {
  const now = Date.now();
  /* With other people hidden this empties both the strip and the header pill,
     which is the whole of what the live view is. */
  const rows = (hidingOthers() ? [] : DB.timers).filter(t => t.user_id !== UID)
    /* A running timer has to have checked in recently. A paused one never
       checks in, so it is shown for a while after the pause and then goes
       quiet — long enough for a break, short enough that yesterday's pause is
       not still sitting on the strip. */
    .filter(t => now - new Date(t.updated_at || 0).getTime() <
                 (t.running ? LIVE_FRESH_MS : PAUSED_FRESH_MS));
  const mine = localTimer ? [Object.assign({}, localTimer, { user_id: UID })] : [];
  const msOf = t => t.acc_ms + (t.running ? now - new Date(t.started_at).getTime() : 0);

  /* You first, then whoever has been at it longest, with the paused ones after
     everybody still going. Deliberately an order that cannot drift between
     rebuilds: two running clocks grow at the same rate so their places never
     swap, a paused one is frozen, and paused sitting below running means a
     frozen clock can never be overtaken into a different row either. Order
     therefore only changes when somebody starts, pauses or stops — which is
     exactly what the signature below already triggers a rebuild on. */
  const all = mine.concat(rows.slice().sort((a, b) =>
    (a.running === b.running) ? msOf(b) - msOf(a) : (a.running ? -1 : 1)));

  /* started_at and acc_ms belong in here. They are what the clock is actually
     derived from, so leaving them out let a changed row be swapped in through
     the cheap in-place path with no rebuild — the number changed and nothing
     else did, which is precisely the glitch people were reporting. They only
     move when somebody starts, pauses or resumes, never on a heartbeat, so
     this costs no extra rebuilds. */
  /* The reaction counts belong in here for the same reason started_at does:
     everything not in the signature is invisible to the cheap path, which only
     rewrites the clock text. A kudos arriving from somebody else has to change
     the signature or it would sit in DB.timerReactions and never be drawn. */
  const rxSig = t => {
    const r = timerRxOf(t.user_id);
    return (r.kudos || []).length + "." + (r.sus || []).length +
           ((r.kudos || []).indexOf(UID) > -1 ? "k" : (r.sus || []).indexOf(UID) > -1 ? "s" : "");
  };
  const sig = all.map(t => [t.user_id, t.running ? 1 : 0, t.label || "",
                            t.started_at, t.acc_ms, rxSig(t)].join("~")).join("|");
  const rebuild = force === true || sig !== liveSig;
  liveSig = sig;

  paintNowBar(all, msOf, rebuild);

  const box = $("livestrip");
  if (!box) return;

  if (!all.length) {
    if (rebuild) box.innerHTML = `<div class="empty" style="width:100%">Nobody is running a timer right now. Be the one who starts.</div>`;
    return;
  }

  if (!rebuild) {
    all.forEach(t => {
      const el = box.querySelector('[data-clock="' + t.user_id + '"]');
      if (el) el.textContent = hms(msOf(t));
    });
    return;
  }

  box.innerHTML = all.map(t => {
    const p = profileOf(t.user_id);
    const w = splitLabel(t.label);
    const mine = t.user_id === UID;
    return `<div class="livecard${mine ? " self" : ""}${t.running ? "" : " paused"} person"
      data-profile="${esc(t.user_id)}" title="See ${esc(p.display_name)}'s full profile"
      style="--lc-subj:${esc(subjectTint(w.subject))}">
      <div class="lc-top">
        ${avatarHTML(p, "sm")}
        <span class="lc-who">${esc(mine ? "You" : p.display_name)}</span>
        ${t.running ? '<span class="dot"></span>' : '<span class="lc-paused">paused</span>'}
      </div>
      <div class="lc-time" data-clock="${esc(t.user_id)}">${hms(msOf(t))}</div>
      <div class="lc-subj">${esc(w.subject)}</div>
      ${w.area ? `<div class="lc-area">${esc(w.area)}</div>` : ""}
      ${timerReactionsHTML(t)}
    </div>`;
  }).join("");

  const sub = $("live-sub");
  if (sub) {
    const running = all.filter(t => t.running).length;
    sub.textContent = running
      ? `${running} ${running === 1 ? "person is" : "people are"} on the clock right now`
      : "Timers update as they run.";
  }
}

/* ---------------------------------------------------------------------------
   A timer row carries its subject and area already joined into one string,
   because that is the only way somebody else's subject can be named at all:
   since clients stopped downloading the whole database they hold their own
   subjects and nobody else's, so there is no id to look up. Splitting on the
   first separator gets them back apart — startTimer builds it subject-first —
   and a label with no separator is left whole rather than guessed at.
   --------------------------------------------------------------------------- */
function splitLabel(label) {
  const s = String(label || "studying");
  const i = s.indexOf(" \u00b7 ");
  return i === -1 ? { subject: s, area: "" }
                  : { subject: s.slice(0, i), area: s.slice(i + 3) };
}

/* Same subject, same colour, on every card and every reload, without needing
   anybody else's subject row. Scanning for who else is on English Advanced is
   the thing people actually do with this strip. */
function subjectTint(name) {
  const k = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/* The header strip: who is on the track right now. */
function paintNowBar(all, msOf, rebuild) {
  const box = $("nowbar");
  if (!box) return;
  const live = all.filter(t => t.running);
  if (!live.length) {
    if (rebuild) { box.innerHTML = ""; box.classList.remove("on"); }
    return;
  }
  const shown = live.slice(0, 5);
  const label = t => {
    const p = profileOf(t.user_id);
    return p.display_name + (t.user_id === UID ? " (you)" : "") +
      " · " + (t.label || "studying") + " · " + hms(msOf(t));
  };

  if (!rebuild) {
    shown.forEach(t => {
      const el = box.querySelector('.nowav[data-profile="' + t.user_id + '"]');
      if (el) el.title = label(t);
    });
    return;
  }

  box.classList.add("on");
  box.innerHTML =
    `<span class="nowlabel"><i class="nowdot"></i><b>${live.length}</b><span class="nowword">studying</span></span>` +
    `<span class="nowavs">` + shown.map(t =>
      `<span class="nowav${t.user_id === UID ? " self" : ""}" data-profile="${esc(t.user_id)}"
        title="${esc(label(t))}">${avatarHTML(profileOf(t.user_id), "sm")}</span>`).join("") +
    (live.length > shown.length ? `<span class="nowmore">+${live.length - shown.length}</span>` : "") +
    `</span>`;
}

/* =========================================================================
   COUNTDOWN

   Two dates that matter to this cohort. Both come out of the same place the
   exam dates do — NESA's timetable has English Paper 1 on the 13th, which is
   where that one is checked against rather than typed in twice.

   A date that has passed simply stops being shown, so this needs no attention
   after the day; once the first paper is behind us the card says so instead of
   counting down to something that has already happened.
   ========================================================================= */
/* English Paper 1 is already in the catalogue, straight off NESA's timetable,
   so it is read from there rather than typed in a second place and left to
   drift apart from it. The literal is only a fallback for a catalogue that
   has not been updated. Valedictory is ours and has nowhere else to live. */
function englishPaper1() {
  const dates = (CAT.papers || [])
    .filter(p => /^English (Advanced|Standard|EAL)/.test(p.subject) && /Paper 1/i.test(p.paper))
    .map(p => p.date).sort();
  return dates[0] || "2026-10-13";
}
const KEY_DATES = () => [
  { on: "2026-09-21",     what: "Valedictory",     note: "last day as a year group" },
  { on: englishPaper1(),  what: "English Paper 1", note: "first HSC exam" }
];

const daysUntil = iso =>
  Math.round((parseD(iso).getTime() - parseD(todayISO()).getTime()) / 864e5);

/* ---------------------------------------------------------------------------
   The class-time warning.

   It is up while school is on and gone from 3:15pm, and once it has gone it
   does not come back that day — every render after the bell leaves it hidden,
   so there is nothing to dismiss and nothing that flickers back.

   The tab is often left open across the bell, so as well as checking the
   clock on every render we set one timer for the exact moment and let it
   pull the sign down while you are looking at it.
   --------------------------------------------------------------------------- */
const CLASSWARN_END_H = 15, CLASSWARN_END_M = 15;   /* 3:15pm, the wearer's own clock */
let classWarnTimer = null;

function paintClassWarn() {
  const box = $("classwarn");
  if (!box) return;

  const now = new Date();
  const bell = new Date(now);
  bell.setHours(CLASSWARN_END_H, CLASSWARN_END_M, 0, 0);
  const left = bell.getTime() - now.getTime();

  if (classWarnTimer) { clearTimeout(classWarnTimer); classWarnTimer = null; }

  if (left <= 0) { box.hidden = true; return; }     /* past the bell: stays down */
  box.hidden = false;
  classWarnTimer = setTimeout(() => {
    classWarnTimer = null;
    const b = $("classwarn");
    if (b) b.hidden = true;
  }, left);
}

function paintCountdown() {
  const box = $("countdown");
  if (!box) return;
  const live = KEY_DATES().map(d => Object.assign({}, d, { left: daysUntil(d.on) }))
                         .filter(d => d.left >= 0)
                         .sort((a, b) => a.left - b.left);
  if (!live.length) {
    box.innerHTML = `<div class="cdcard"><div><div class="cdwhat">The HSC is underway</div>
      <div class="cdwhen">One paper at a time. Keep logging.</div></div></div>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = live.map(d => {
    const today = d.left === 0, near = d.left <= 7;
    return `<div class="cdcard${today ? " today near" : near ? " near" : ""}">
      <div style="text-align:center;min-width:52px">
        <div class="cdnum">${today ? "Today" : d.left}</div>
        ${today ? "" : `<div class="cdunit">${d.left === 1 ? "day" : "days"}</div>`}
      </div>
      <div>
        <div class="cdwhat">${esc(d.what)}</div>
        <div class="cdwhen">${esc(fmtLong(d.on))} · ${esc(d.note)}</div>
      </div>
    </div>`;
  }).join("");
  box.hidden = false;
}

function renderHome() {
  paintClassWarn();
  paintCountdown();
  $("h-title").textContent = CUR === todayISO() ? "Today · " + fmtLong(CUR) : fmtLong(CUR);
  $("h-date").value = CUR;
  $("h-goal").value = goalFor(UID, CUR);

  const g = goalFor(UID, CUR), h = hoursFor(UID, CUR), r = ratioFor(UID, CUR), col = lvlColour(r, h > 0);
  const R = 78, C = 2 * Math.PI * R, pct = g > 0 ? h / g : (h > 0 ? 1 : 0);
  $("ring").innerHTML =
    `<circle cx="100" cy="100" r="${R}" fill="none" stroke="#E8EDEF" stroke-width="17"/>
     <circle cx="100" cy="100" r="${R}" fill="none" stroke="${col}" stroke-width="17" stroke-linecap="round"
       stroke-dasharray="${(C * Math.min(1, pct)).toFixed(1)} ${C}" transform="rotate(-90 100 100)"/>
     <text x="100" y="94" text-anchor="middle" font-size="37" font-weight="700" fill="#12232E">${f1(h)}</text>
     <text x="100" y="116" text-anchor="middle" font-size="12.5" fill="#7B8D98">of ${f1(g)} hours</text>
     <text x="100" y="140" text-anchor="middle" font-size="13" font-weight="600"
       fill="${col === "var(--none)" ? "#7B8D98" : "#12232E"}">${g > 0 ? f0(h / g * 100) + "%" : (h > 0 ? "logged" : "rest day")}</text>`;

  const v = $("h-verdict");
  if (g <= 0) v.textContent = h > 0 ? `Rest day, and you studied anyway. ${f1(h)} hours banked.` : "Rest day. Skipping it will not break your streak.";
  else if (h >= g * 1.2) v.textContent = `Well past it — ${f1(h - g)} hours of credit.`;
  else if (h >= g) v.textContent = "Goal met. Streak intact.";
  else if (h > 0)  v.textContent = `${f1(g - h)} hours to go.`;
  else v.textContent = `Nothing logged yet. Goal is ${f1(g)} hours.`;

  const es = DB.sessions.filter(s => s.user_id === UID && s.day === CUR);
  $("h-count").textContent = es.length ? `${es.length} session${es.length === 1 ? "" : "s"} · ${f1(h)} hours` : "Nothing yet";
  $("h-entries").innerHTML = es.length ? es.map(entryHTML).join("") : `<div class="empty">Nothing logged for this day.</div>`;
  wireEntryActions($("h-entries"));

  $("k-today").textContent = f1(h);
  $("k-today").style.color = col === "var(--none)" ? "var(--ink)" : col;
  $("k-today-d").textContent = g > 0 ? (h >= g ? "Goal met" : f1(g - h) + " short of " + f1(g)) : "Rest day";

  const dayBoard = visiblePeople().map(p => ({ id: p.id, h: hoursFor(p.id, CUR) })).sort((a, b) => b.h - a.h);
  const idx = dayBoard.findIndex(x => x.id === UID);
  $("k-rank").textContent = idx >= 0 ? "#" + (idx + 1) : "—";
  const above = idx > 0 ? dayBoard[idx - 1] : null;
  $("k-rank-d").textContent = above
    ? `${f1(above.h - dayBoard[idx].h)} h behind ${profileOf(above.id).display_name}`
    : (idx === 0 ? "Top of the peloton today" : "—");

  const st = streakFor(UID);
  $("k-streak").textContent = st;
  $("k-streak").style.color = st > 0 ? "var(--good)" : "var(--ink)";
  $("k-streak-d").textContent = "Longest " + longestStreakFor(UID);

  let wk = 0, wkg = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(todayISO(), -i); wk += hoursFor(UID, d); wkg += goalFor(UID, d); }
  $("k-week").textContent = f1(wk);
  $("k-week-d").textContent = `Against ${f1(wkg)} of goals`;

  const rows = visiblePeople().map(p => ({ p, h: hoursFor(p.id, CUR), g: goalFor(p.id, CUR) })).sort((a, b) => b.h - a.h);
  const mx = Math.max(1, ...rows.map(x => Math.max(x.h, x.g)));
  $("todayrail").innerHTML = rows.map(x => {
    const rr = x.g > 0 ? x.h / x.g : (x.h > 0 ? 1 : null);
    return `<div class="rowbar" style="grid-template-columns:190px 1fr 108px">
      <div class="who">${avatarHTML(x.p, "sm")}<span class="nm" style="${x.p.id === UID ? "text-decoration:underline" : ""}">${esc(x.p.display_name)}</span></div>
      <div class="track" style="height:22px">
        <div style="position:absolute;left:${(x.g / mx * 100).toFixed(1)}%;top:0;bottom:0;width:2px;background:#4A6572"></div>
        <div class="fill" style="width:${(x.h / mx * 100).toFixed(1)}%;background:${lvlColour(rr, x.h > 0)}"></div>
      </div>
      <div class="val" style="text-align:right">${f1(x.h)}<span style="color:var(--ink-soft);font-weight:400"> / ${f1(x.g)}</span></div>
    </div>`;
  }).join("");

  paintLive();
}
/* ---------------------------------------------------------------------------
   REACTIONS

   Two answers to somebody's session: kudos, or calling it suspicious. The
   second is the honest half of a public leaderboard — six hours on a Tuesday
   invites a raised eyebrow, and it is better as a button than as a rumour.

   Deliberately not anonymous. Every reaction names who left it, in the title
   and under the count, because an anonymous pile-on aimed at a named person
   is a different and worse thing than a visible one, and everything else
   here is public and named already. The database allows one per person per
   session, so the counts cannot be stacked.
   --------------------------------------------------------------------------- */
const RX_KINDS = [
  { kind: "kudos", icon: "\ud83d\udc4f", label: "Kudos",      verb: "gave kudos" },
  { kind: "sus",   icon: "\ud83e\udd28", label: "Sus",        verb: "called it sus" }
];
const rxOf = id => DB.reactions[id] || { kudos: [], sus: [] };

/* Who, by name, for the tooltip — capped so one popular session cannot build a
   title attribute the length of the room. */
function rxWho(ids, verb) {
  if (!ids || !ids.length) return "";
  const names = ids.slice(0, 12).map(u => (profileOf(u) || {}).display_name || "someone");
  const more = ids.length - names.length;
  return names.join(", ") + (more > 0 ? ` and ${more} more` : "") + " " + verb;
}

function reactionsHTML(s) {
  const r = rxOf(s.id);
  const own = s.user_id === UID;
  const bits = RX_KINDS.map(k => {
    const ids = r[k.kind] || [];
    const mine = ids.indexOf(UID) > -1;
    /* On your own session there is nothing to press, so a count that is zero
       is simply not drawn — an empty row of dead buttons under every entry is
       noise on the one screen you look at most. */
    if (own && !ids.length) return "";
    const title = ids.length ? rxWho(ids, k.verb)
                             : (own ? "" : "Nobody yet \u2014 " + k.label.toLowerCase());
    return `<button type="button" class="rxb rx-${k.kind}${mine ? " on" : ""}${own ? " still" : ""}"
      ${own ? "disabled" : `data-react="${k.kind}" data-rxid="${esc(s.id)}"`}
      title="${esc(title)}"><span aria-hidden="true">${k.icon}</span><span class="rxn">${
        ids.length || ""}</span><span class="rxl">${esc(k.label)}</span></button>`;
  }).join("");
  return bits ? `<div class="rx">${bits}</div>` : "";
}

/* One press. The row is moved locally first so the button answers instantly,
   and put back if the database disagrees. */
async function sendReaction(id, kind) {
  const r = rxOf(id);
  const before = { kudos: (r.kudos || []).slice(), sus: (r.sus || []).slice() };
  const had = before.kudos.indexOf(UID) > -1 ? "kudos"
            : before.sus.indexOf(UID) > -1 ? "sus" : null;
  const next = { kudos: before.kudos.filter(u => u !== UID), sus: before.sus.filter(u => u !== UID) };
  if (kind !== had) next[kind].push(UID);
  DB.reactions[id] = next;
  repaintReactions(id);

  const { data, error } = await sb.rpc("react", { session_id: id, kind: kind === had ? null : kind });
  if (error || (data && data.ok === false)) {
    DB.reactions[id] = before;
    repaintReactions(id);
    const why = (data && data.why) ||
      (/schema cache|could not find the function/i.test((error && error.message) || "")
        ? "Reactions are not set up on the database yet \u2014 run migrate.sql"
        : (error && error.message) || "Could not react");
    toast(why, 4200);
  }
}

/* The same session can be on screen more than once — your own day and the feed
   both draw it — so every copy is redrawn, not just the one that was pressed. */
function repaintReactions(id) {
  const s = DB.sessions.find(x => x.id === id) || DB.feed.find(x => x.id === id)
         || GUEST.sessions.find(x => x.id === id);
  if (!s) return;
  document.querySelectorAll('.entry[data-sid="' + CSS.escape(id) + '"] .rx').forEach(el => {
    const wrap = document.createElement("div");
    wrap.innerHTML = reactionsHTML(s);
    const fresh = wrap.firstElementChild;
    if (fresh) el.replaceWith(fresh); else el.remove();
  });
}

/* ---------------------------------------------------------------------------
   The same two answers, aimed at a clock that is still running. Cheering
   somebody on at 9pm is the half the session reactions cannot do, and a
   four-hour timer still going is the most natural thing here to raise an
   eyebrow at.

   Reactions are stamped with the started_at they were aimed at, so a person
   who stops and starts again does not inherit the last run's: the read drops
   anything that no longer matches, and the database sweeps them on the next
   press. Stopping a timer removes the row and the foreign key takes these
   with it, so nothing has to remember to tidy up.
   --------------------------------------------------------------------------- */
function absorbTimerReactions(res) {
  /* A project that has not run migrate.sql yet has no such table. That is not
     an error worth showing anybody — it just means nobody has reacted. */
  const rows = (res && res.data) || [];
  const next = {};
  rows.forEach(r => {
    const t = (DB.timers || []).find(x => x.user_id === r.owner_id);
    /* Aimed at a run that has since been restarted: no longer about what is
       on the screen, so it is not drawn. */
    if (!t || +new Date(t.started_at) !== +new Date(r.for_started_at)) return;
    const e = next[r.owner_id] || (next[r.owner_id] = { kudos: [], sus: [] });
    (e[r.kind] || []).push(r.user_id);
  });
  DB.timerReactions = next;
}

const timerRxOf = id => DB.timerReactions[id] || { kudos: [], sus: [] };

function timerReactionsHTML(t) {
  if (t.user_id === UID) return "";          /* nothing to press on your own */
  const r = timerRxOf(t.user_id);
  return `<div class="rx lrx">` + RX_KINDS.map(k => {
    const ids = r[k.kind] || [];
    const mine = ids.indexOf(UID) > -1;
    return `<button type="button" class="rxb rx-${k.kind}${mine ? " on" : ""}"
      data-treact="${k.kind}" data-trxid="${esc(t.user_id)}"
      title="${esc(ids.length ? rxWho(ids, k.verb) : k.label)}"
      ><span aria-hidden="true">${k.icon}</span><span class="rxn">${ids.length || ""}</span></button>`;
  }).join("") + `</div>`;
}

async function sendTimerReaction(owner, kind) {
  const before = timerRxOf(owner);
  const had = (before.kudos || []).indexOf(UID) > -1 ? "kudos"
            : (before.sus || []).indexOf(UID) > -1 ? "sus" : null;
  const next = { kudos: (before.kudos || []).filter(u => u !== UID),
                 sus:   (before.sus   || []).filter(u => u !== UID) };
  if (kind !== had) next[kind].push(UID);
  DB.timerReactions[owner] = next;
  paintLive(true);                            /* rare enough to just redraw */

  const { data, error } = await sb.rpc("react_timer",
    { owner_id: owner, kind: kind === had ? null : kind });
  if (error || (data && data.ok === false)) {
    DB.timerReactions[owner] = before;
    paintLive(true);
    toast((data && data.why) ||
      (/schema cache|could not find the function|does not exist/i.test((error && error.message) || "")
        ? "Reactions are not set up on the database yet \u2014 run migrate.sql"
        : (error && error.message) || "Could not react"), 4200);
  }
}

/* Asked for by id, for exactly the rows that can be drawn right now. */
async function loadReactions() {
  if (!sb || !UID) return;
  const ids = [].concat(
    DB.sessions.map(s => s.id),
    DB.feed.map(s => s.id),
    GUEST.sessions.map(s => s.id)
  ).filter(Boolean);
  const uniq = [...new Set(ids)];
  if (!uniq.length) { DB.reactions = {}; return; }
  const { data, error } = await sb.rpc("reactions_for", { ids: uniq });
  /* A project that has not run migrate.sql yet simply has no reactions;
     that is not an error worth putting on anybody's screen. */
  if (error) return;
  const next = {};
  (data || []).forEach(r => {
    next[r.session_id] = { kudos: r.kudos_by || [], sus: r.sus_by || [] };
  });
  DB.reactions = next;
}

function entryHTML(s, withWho) {
  const p = profileOf(s.user_id);
  return `<div class="entry" data-sid="${esc(s.id)}"><div class="top">
    <div>${withWho ? `<span class="wholink" data-profile="${esc(s.user_id)}" title="See ${esc(p.display_name)}'s full profile">${esc(p.display_name)}</span><span style="color:var(--ink-soft);font-size:11.5px"> · </span>` : ""}
      <strong style="color:${colourOf(s)}">${esc(labelOf(s))}</strong>
      ${withWho ? `<span style="color:var(--ink-soft);font-size:11.5px"> · ${fmtD(s.day)}</span>` : ""}</div>
    <div style="text-align:right;font-weight:600">${f1(s.minutes / 60)} h</div>
    ${s.user_id === UID ? `<span class="acts">
      <button class="x pencil" data-edit="${s.id}" title="Edit this session" aria-label="Edit this session">✎</button>
      <button class="x" data-del="${s.id}" title="Remove" aria-label="Remove this session">×</button></span>` : "<span></span>"}
  </div>${s.note ? `<div class="enote">${esc(s.note)}</div>` : ""}${reactionsHTML(s)}</div>`;
}
/* Every list of entries — today, my log, the feed, a profile — gets the same
   two buttons on your own rows, so a session can be fixed wherever you find it. */
/* Take it off the screen the moment the database says it has gone, instead of
   waiting for the next full read to come back — which is a second or two if
   one was already in the air. The read that follows only confirms it. */
function dropSessionLocally(id) {
  /* It might be one of yours, or one you are looking at on somebody's profile,
     or only known from the feed — take it out of whichever holds it. */
  const row = DB.sessions.find(s => s.id === id)
           || GUEST.sessions.find(s => s.id === id)
           || DB.feed.find(s => s.id === id);
  const cut = (arr) => { const i = arr.findIndex(s => s.id === id); if (i >= 0) arr.splice(i, 1); };
  cut(DB.sessions); cut(GUEST.sessions); cut(DB.feed);
  /* and out of the rollup, so the ring, the totals and the board drop it now
     rather than a second later when the read comes back */
  if (row) patchDaily(row.user_id, row.day, -Number(row.minutes || 0), -1);
}

function wireEntryActions(scope) {
  scope.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (b.disabled) return;                      /* no deleting the same row twice */
    b.disabled = true;
    const { error } = await sb.from("sessions").delete().eq("id", b.dataset.del);
    /* This used to be thrown away, so a refused delete looked exactly like a
       successful one: the row sat there and nobody was told why. */
    if (error) { b.disabled = false; toast("Could not delete: " + error.message, 4600); return; }
    dropSessionLocally(b.dataset.del);
    renderAll();
    await refreshEntries();
  }));
  scope.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEdit(b.dataset.edit)));
}

/* =========================================================================
   EDIT A LOGGED SESSION
   -------------------------------------------------------------------------
   Everything about a session is changeable after the fact — what it was
   against, which day it lands on, how long it ran and what you wrote about
   it. The database only ever lets you touch your own rows, so the pencil is
   only drawn on yours in the first place.
   ========================================================================= */
let editingId = null;
let editingOwner = null;    /* whose session is in the sheet — you, unless an admin is moderating */
let openProfileId = null;   /* which profile modal is on screen, so an edit can redraw it */

function openEdit(id) {
  const s = DB.sessions.find(x => x.id === id);
  if (!s) { toast("That session is gone"); return; }
  const mine = s.user_id === UID;
  /* The browser-side half of the check. The database half is the "update own"
     policy in schema.sql, which is what actually decides. */
  if (!mine && !(typeof IS_ADMIN !== "undefined" && IS_ADMIN)) {
    toast("You can only edit your own sessions"); return;
  }

  editingId = id;
  editingOwner = s.user_id;
  $("e-subj").innerHTML = subjectOptionsHTML(s.user_id);
  /* An imported session, or one whose subject has since been deleted, has no
     subject at all — start it on the first one rather than on whatever the
     select happened to be showing. */
  $("e-subj").selectedIndex = 0;
  setPair("e-subj", "e-area", s.subject_id, s.area_id, s.user_id);
  $("e-day").value  = s.day;
  $("e-min").value  = s.minutes;
  $("e-note").value = s.note || "";
  $("me-sub").innerHTML = (mine ? "" :
      `<strong style="color:var(--accent-ink)">Moderating ${esc(profileOf(s.user_id).display_name)}'s session</strong> · `) +
    "Logged " + esc(fmtLong(s.day)) + " · " + f1(s.minutes / 60) + " h at the time";
  $("ov-edit").classList.add("on");
  setTimeout(() => $("e-min").focus(), 60);
}
function closeEdit() { editingId = null; editingOwner = null; $("ov-edit").classList.remove("on"); }

/* A profile modal is built once and left alone, so an edit made from inside
   one has to redraw it or you are looking at the row you just changed. */
async function refreshEntries() {
  await refresh();
  if (openProfileId && $("ov-profile").classList.contains("on")) openProfile(openProfileId);
}

$("e-cancel").addEventListener("click", closeEdit);
document.querySelectorAll("[data-closeedit]").forEach(b => b.addEventListener("click", closeEdit));
$("ov-edit").addEventListener("click", e => { if (e.target.id === "ov-edit") closeEdit(); });
/* Registered before the profile modal's own Escape handler, and it stops the
   event there, so closing the edit sheet does not also close what is behind it. */
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && editingId) { e.stopImmediatePropagation(); closeEdit(); }
});

$("e-del").addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("Delete this session? It cannot be undone.")) return;
  const id = editingId, owner = editingOwner;
  const before = DB.sessions.find(x => x.id === id);
  if (owner && owner !== UID && typeof admLog === "function") {
    await admLog("session.delete", owner, profileOf(owner).display_name,
      before ? `${f1(before.minutes / 60)} h on ${before.day} — ${labelOf(before)}` : "session", before);
  }
  closeEdit();
  const { error } = await sb.from("sessions").delete().eq("id", id);
  if (error) { toast("Could not delete: " + error.message); return; }
  dropSessionLocally(id);
  renderAll();
  toast("Session deleted");
  await refreshEntries();
  if (typeof ADM !== "undefined" && ADM.open) renderAdmin();
});

$("e-save").addEventListener("click", async () => {
  if (!editingId) return;
  const t = readPair("e-subj", "e-area");
  if (!t.subject_id) { toast("Add a subject in Setup first"); return; }
  const day = $("e-day").value;
  if (!day) { toast("Pick a date"); return; }
  const minutes = Math.round(+$("e-min").value);
  if (!minutes || minutes < 1 || minutes > 1440) { toast("Minutes has to be between 1 and 1440"); return; }

  const id = editingId, owner = editingOwner;
  const before = DB.sessions.find(x => x.id === id);
  if (owner && owner !== UID && typeof admLog === "function") {
    await admLog("session.edit", owner, profileOf(owner).display_name,
      `${before ? f1(before.minutes / 60) + " h on " + before.day : "session"} → ${f1(minutes / 60)} h on ${day}`,
      before);
  }
  const { error } = await sb.from("sessions").update({
    subject_id: t.subject_id, area_id: t.area_id,
    day, minutes, note: $("e-note").value.trim() || null }).eq("id", id);
  if (error) { toast("Could not save: " + error.message); return; }
  closeEdit();
  toast("Session updated");
  await refreshEntries();
  if (typeof ADM !== "undefined" && ADM.open) renderAdmin();
});

/* =========================================================================
   RENDER — crew
   ========================================================================= */
/* =========================================================================
   RANKING THE LEADERBOARD

   Subjects are per-person rows — your Physics and my Physics are two
   different rows with two different ids — so the only thing that can tie
   them together across the crew is the name. Normalising trims and folds
   case, which catches most of it. What it cannot catch is shown rather
   than quietly dropped: a one-person "Maths Ext 1" sitting next to a
   five-person "Mathematics Extension 1" in the picker is the cue to go
   and rename one of them. Silently ranking somebody out of a board they
   belong on would be the worse failure by far.
   ========================================================================= */
const subjKey   = n => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
const subjLoose = n => subjKey(n).replace(/[^a-z0-9]/g, "");

/* Two names compared a word at a time. An exact word scores one, otherwise
   they score on how much of their opening they share, which is what nearly
   every abbreviation in a subject list turns out to be — maths/mathematics,
   tech/technology. Measured from both sides so a longer name is not rewarded
   simply for having more words to match against. */
const subjTokens = n => subjKey(n).split(/[^a-z0-9]+/).filter(Boolean);
function tokenSim(a, b) {
  if (a === b) return 1;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i / Math.max(a.length, b.length);
}
function nameSim(a, b) {
  const A = subjTokens(a), B = subjTokens(b);
  if (!A.length || !B.length) return 0;
  const side = (x, y) => x.reduce((n, t) => n + Math.max(...y.map(u => tokenSim(t, u))), 0) / x.length;
  return (side(A, B) + side(B, A)) / 2;
}

/* Every distinct subject anyone takes, with who takes it and how it is spelt. */
function subjectGroups() {
  /* The crew's subject names and who takes them arrive already grouped, from
     crew_subjects() — the database does the counting so this client does not
     have to hold four hundred people's subject rows to do it. The label it
     picks is the spelling the most people use, same rule as before. */
  const out = (DB.crewSubjects || []).map(r => ({
    key: r.key,
    label: r.label,
    loose: subjLoose(r.label),
    takers: new Set(r.takers || [])
  }));
  out.forEach(e => { e.inCatalogue = !!CAT.byName(e.label); });
  /* differing only by spacing or punctuation is almost certainly one subject
     typed two ways, and worth saying out loud */
  out.forEach(e => e.nearMisses = out.filter(o => o !== e && o.loose === e.loose));

  /* That only catches punctuation, and the drift that actually happens is
     abbreviation: "Maths Standard 2" against "Mathematics Standard 2". So a
     name the catalogue does not know is measured against the ones it does,
     and if one course is a clear winner it is offered as the thing you
     probably meant. A tie is left alone — "German X" could be Continuers or
     Extension and only the person who wrote it knows which. */
  out.forEach(e => {
    e.suggest = null;
    if (e.inCatalogue) return;
    const scored = CAT.subjects.map(c => ({ name: c.name, score: nameSim(e.label, c.name) }))
                               .sort((a, b) => b.score - a.score);
    if (scored.length && scored[0].score >= 0.6 &&
        (scored.length < 2 || scored[0].score - scored[1].score >= 0.08)) e.suggest = scored[0].name;
  });
  return out.sort((a, b) => b.takers.size - a.takers.size || a.label.localeCompare(b.label));
}

/* How the board can be ranked. goalHit and streak are whole-day facts about a
   person, not about one subject, so they are offered only on the full board —
   ranking Physics hours while showing an all-subject streak beside them would
   just be two different questions sharing a row. */
const LB_METRICS = {
  hours:    { label: "Hours",          unit: " h", big: r => f1(r.hours),    get: r => r.hours },
  sessions: { label: "Sessions",       unit: "",   big: r => String(r.sessions), get: r => r.sessions },
  best:     { label: "Longest day",    unit: " h", big: r => f1(r.best),     get: r => r.best },
  goalHit:  { label: "Goal hit rate",  unit: "%",  big: r => r.goalHit === null ? "—" : f0(r.goalHit * 100),
              get: r => r.goalHit === null ? -1 : r.goalHit, wholeCrew: true },
  streak:   { label: "Current streak", unit: " d", big: r => String(r.streak || 0),
              get: r => r.streak || 0, wholeCrew: true }
};
/* Average per day is deliberately absent: everyone is divided by the same
   number of days, so it would rank identically to hours. */

function lbMetricFor(metric, subject) {
  const m = LB_METRICS[metric];
  if (!m || (subject && m.wholeCrew)) return "hours";
  return metric;
}

function leaderboard(rangeOverride, opts) {
  const o = opts || {};
  const subject = o.subject || null;
  const metric = lbMetricFor(o.metric || "hours", subject);
  const days = rangeOverride ? (() => { const o = []; for (let i = rangeOverride - 1; i >= 0; i--) o.push(addDays(todayISO(), -i)); return o; })() : rangeDays();
  const set = new Set(days);

  /* Under a subject filter the numbers come from a rollup of that subject
     alone, fetched when the picker changes; the whole-crew rollup otherwise. */
  const src = subject ? (SUBJECT_DAILY.key === subject ? SUBJECT_DAILY.map : new Map()) : DB.daily;
  const cell = (uid, day) => { const e = src.get(uid); const v = e && e.days[day]; return v || [0, 0]; };

  let takers = null;
  if (subject) {
    const g = (DB.crewSubjects || []).find(x => x.key === subject);
    takers = new Set(g ? g.takers : []);
  }
  /* Everybody who takes the subject is on the board, including anyone who has
     not logged to it in this range. Dropping them would turn "first of six"
     into "first of two" without saying so. */
  const people = takers ? visiblePeople().filter(p => takers.has(p.id)) : visiblePeople();

  return people.map(p => {
    const perDay = {};
    let hours = 0, sessions = 0;
    days.forEach(d => {
      const c = cell(p.id, d);
      perDay[d] = c[0] / 60;
      hours += c[0] / 60;
      sessions += c[1];
    });
    const active = days.filter(d => perDay[d] > 0).length;
    const withGoal = days.filter(d => goalFor(p.id, d) > 0);
    const hit = withGoal.filter(d => perDay[d] >= goalFor(p.id, d)).length;
    return { id: p.id, p, hours, sessions, days,
      perDay, active, best: Math.max(0, ...days.map(d => perDay[d])),
      goalHit: subject ? null : (withGoal.length ? hit / withGoal.length : null),
      streak: subject ? null : streakFor(p.id) };
  }).sort((a, b) => LB_METRICS[metric].get(b) - LB_METRICS[metric].get(a) ||
                    b.hours - a.hours ||
                    a.p.display_name.localeCompare(b.p.display_name));
}

/* One subject's rollup, held for as long as that subject is the one on screen.
   Asked for only when the picker changes, not on every repaint. */
const SUBJECT_DAILY = { key: null, map: new Map() };
async function loadSubjectDaily(key) {
  if (!key) { SUBJECT_DAILY.key = null; SUBJECT_DAILY.map = new Map(); return; }
  if (SUBJECT_DAILY.key === key) return;
  try {
    const { data, error } = await sb.rpc("crew_daily_by_subject",
      { since: crewSince(), subject_key: key });
    if (error) return;
    const m = new Map();
    (data || []).forEach(r => m.set(r.user_id, {
      days: r.days || {}, first_day: r.first_day || null,
      total_minutes: Number(r.total_minutes || 0), total_sessions: Number(r.total_sessions || 0)
    }));
    SUBJECT_DAILY.key = key; SUBJECT_DAILY.map = m;
  } catch (e) { /* leave the board empty rather than wrong */ }
}

/* What the board is showing. Deliberately not remembered between visits: it
   opens on the whole crew, ranked on hours, and a filter is something you go
   and ask for. */
let LB_SUBJECT = null;
let LB_METRIC  = "hours";

/* The pickers are rebuilt only when the choices themselves change, never on a
   routine refresh — otherwise an open dropdown would slam shut every few
   seconds and take your selection with it. */
function paintLbControls(groups) {
  const sub = $("lb-subject"), met = $("lb-metric");
  if (!sub || !met) return;

  const sig = groups.map(g => g.key + ":" + g.takers.size).join("|");
  if (sub.dataset.sig !== sig) {
    sub.dataset.sig = sig;
    sub.innerHTML = `<option value="">Everyone, all subjects</option>` + groups.map(g =>
      `<option value="${esc(g.key)}">${esc(g.label)} · ${g.takers.size}${
        g.inCatalogue ? "" : " · custom"}</option>`).join("");
    /* a subject can vanish from under us if its last taker drops it */
    if (LB_SUBJECT && !groups.some(g => g.key === LB_SUBJECT)) LB_SUBJECT = null;
    sub.value = LB_SUBJECT || "";
  }

  const metSig = LB_SUBJECT ? "subject" : "crew";
  if (met.dataset.sig !== metSig) {
    met.dataset.sig = metSig;
    met.innerHTML = Object.keys(LB_METRICS)
      .filter(k => !(LB_SUBJECT && LB_METRICS[k].wholeCrew))
      .map(k => `<option value="${k}">${esc(LB_METRICS[k].label)}</option>`).join("");
    LB_METRIC = lbMetricFor(LB_METRIC, LB_SUBJECT);
    met.value = LB_METRIC;
  }

  if (!sub.dataset.wired) {
    sub.dataset.wired = "1";
    sub.addEventListener("change", async () => {
      LB_SUBJECT = sub.value || null;
      await loadSubjectDaily(LB_SUBJECT);
      renderCrew();
    });
    met.addEventListener("change", () => { LB_METRIC = met.value; renderCrew(); });
  }
}

/* Says out loud when the subject you picked has a twin nobody has noticed, or
   is spelt in a way that will never match anyone else's. */
function paintLbNote(group, groups) {
  const note = $("lb-note");
  if (!note) return;
  const bits = [];
  if (group) {
    bits.push(`Goal hit and streak count whole days across every subject, so they are ` +
              `left blank while one subject is in view.`);
    (group.nearMisses || []).forEach(n => bits.push(
      `Also spelt <b>${esc(n.label)}</b> by ${n.takers.size === 1 ? "one person, who is" : n.takers.size + " people, who are"} ` +
      `ranked separately. Renaming one to match would put everyone on the same board.`));
    if (!group.inCatalogue) {
      /* if the near-miss line above already named it, do not say it twice */
      const said = (group.nearMisses || []).some(n => group.suggest && n.key === subjKey(group.suggest));
      const other = (group.suggest && !said) ? (groups || []).find(g => g.key === subjKey(group.suggest)) : null;
      if (said) group = Object.assign({}, group, { suggest: null });
      bits.push(`<b>${esc(group.label)}</b> is not a catalogue subject name, so it only matches people who spell it exactly the same way.` +
        (group.suggest
          ? ` Did you mean <b>${esc(group.suggest)}</b>${
              other ? `, which ${other.takers.size === 1 ? "one person takes" : other.takers.size + " people take"}` : ""
            }? Renaming would put everyone on the same board.`
          : ""));
    }
  }
  note.innerHTML = bits.join("<br>");
  note.hidden = !bits.length;
}

function renderCrew() {
  const groups = subjectGroups();
  paintLbControls(groups);
  const group = LB_SUBJECT ? groups.find(g => g.key === LB_SUBJECT) || null : null;
  if (LB_SUBJECT && !group) LB_SUBJECT = null;
  LB_METRIC = lbMetricFor(LB_METRIC, LB_SUBJECT);
  paintLbNote(group, groups);

  const board = leaderboard(null, { subject: LB_SUBJECT, metric: LB_METRIC });
  const days = rangeDays();
  const M = LB_METRICS[LB_METRIC];
  const period = RANGE === 0
    ? `All time — ${days.length} days of records`
    : (RANGE === 1 ? "Today only" : `The last ${RANGE} days`);
  $("lb-sub").textContent = period +
    (group ? ` · ${group.label} only, ${group.takers.size} ${group.takers.size === 1 ? "person takes" : "take"} it` : "") +
    (LB_METRIC === "hours" ? "" : ` · ranked on ${M.label.toLowerCase()}`);

  /* podium */
  const top = board.slice(0, 3);
  const order = [1, 0, 2];
  $("podium").innerHTML = order.map(i => {
    const r = top[i]; if (!r) return `<div></div>`;
    return `<div class="pod p${i + 1} person" data-profile="${r.id}" title="See ${esc(r.p.display_name)}'s full profile">
      <div class="rank">#${i + 1}</div>
      ${avatarHTML(r.p, i === 0 ? "xl" : "lg")}
      <div class="hrs">${M.big(r)}<span style="font-size:13px;font-weight:500;color:var(--ink-soft)">${M.unit}</span></div>
      <div class="nm2">${esc(r.p.display_name)}</div>
      <div class="sub2">${r.sessions} session${r.sessions === 1 ? "" : "s"} · ${
        LB_METRIC === "hours" ? `best day ${f1(r.best)} h` : `${f1(r.hours)} h in total`}</div>
    </div>`;
  }).join("");

  /* table */
  const last7 = (() => { const o = []; for (let i = 6; i >= 0; i--) o.push(addDays(todayISO(), -i)); return o; })();
  /* sparklines come straight off whichever rollup the board is reading */
  const sparkSrc = LB_SUBJECT
    ? (SUBJECT_DAILY.key === LB_SUBJECT ? SUBJECT_DAILY.map : new Map())
    : DB.daily;
  const sparkH = {};
  board.forEach(r => {
    const e = sparkSrc.get(r.id);
    const row = {};
    last7.forEach(d => { const c = (e && e.days[d]) || [0, 0]; row[d] = c[0] / 60; });
    sparkH[r.id] = row;
  });

  $("lbtbl").querySelector("tbody").innerHTML = board.map((r, i) => {
    const spark = last7.map(d => (sparkH[r.id] || {})[d] || 0);
    const mx = Math.max(1, ...spark);
    const bars = spark.map((v, j) => {
      /* against a whole-day goal only when the whole day is what is counted */
      const g = LB_SUBJECT ? 0 : goalFor(r.id, last7[j]);
      return `<rect x="${j * 13}" y="${22 - (v / mx) * 22}" width="9" height="${Math.max(1, (v / mx) * 22)}" rx="1.5"
        fill="${lvlColour(g > 0 ? v / g : (v > 0 ? 1 : null), v > 0)}"/>`;
    }).join("");
    const medal = i === 0 ? "var(--gold)" : i === 1 ? "var(--silver)" : i === 2 ? "var(--bronze)" : "var(--ink-soft)";
    return `<tr class="${r.id === UID ? "me" : ""}">
      <td class="l" style="font-weight:700;color:${medal}">${i + 1}</td>
      <td class="l"><div class="who person" data-profile="${r.id}" title="See ${esc(r.p.display_name)}'s full profile">${avatarHTML(r.p, "sm")}<span class="nm">${esc(r.p.display_name)}</span></div></td>
      <td style="font-weight:700">${f1(r.hours)}</td>
      <td>${r.sessions}</td>
      <td>${f1(r.hours / Math.max(1, days.length))}</td>
      <td>${f1(r.best)}</td>
      <td>${r.goalHit === null ? "—" : `<span class="pill" style="background:${lvlColour(r.goalHit, true)}">${f0(r.goalHit * 100)}%</span>`}</td>
      <td style="font-weight:600;color:${r.streak > 0 ? "var(--good)" : "var(--ink-soft)"}">${r.streak === null ? "—" : r.streak}</td>
      <td class="l"><svg width="92" height="24" viewBox="0 0 92 24">${bars}</svg></td>
    </tr>`;
  }).join("");

  drawRace(board, days);
  drawStack(board, days);

  /* head to head. Rebuilt when the set of people actually changes — somebody
     joining, or somebody turning private mode on — and left alone otherwise,
     so an open dropdown is not snatched away on a routine repaint. */
  const people = visiblePeople();
  const peopleSig = people.map(p => p.id + ":" + p.display_name).join("|");
  const A = $("h2h-a"), B = $("h2h-b");
  if (A.dataset.sig !== peopleSig) {
    const keepA = A.value, keepB = B.value;
    const opts = people.map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join("");
    A.innerHTML = opts; B.innerHTML = opts;
    const has = v => people.some(p => p.id === v);
    A.value = has(keepA) ? keepA : UID;
    const other = people.find(p => p.id !== A.value);
    B.value = has(keepB) && keepB !== A.value ? keepB : (other ? other.id : A.value);
    A.dataset.sig = peopleSig;
  }
  if (!A.dataset.wired) {
    A.dataset.wired = "1";
    A.addEventListener("change", () => drawH2H());
    B.addEventListener("change", () => drawH2H());
  }
  drawH2H();

  /* feed */
  const feed = DB.feed;          /* already the 40 newest, crew-wide, from the server */
  $("feed").innerHTML = feed.length
    ? feed.map(s => `<div style="padding:0 16px">${entryHTML(s, true)}</div>`).join("")
    : `<div class="empty" style="margin:18px">Nothing logged yet by anyone.</div>`;
  wireEntryActions($("feed"));
}

function drawRace(board, days) {
  const svg = $("race"); svg.innerHTML = "";
  const W = 620, H = 350, ml = 46, mr = 96, mt = 16, mb = 34, iw = W - ml - mr, ih = H - mt - mb;
  const series = board.slice(0, 8).map(r => {
    let c = 0; return { p: r.p, pts: days.map((d, i) => { c += (r.perDay[d] || 0); return [i, c]; }) };
  });
  const maxY = Math.max(1, ...series.map(s => s.pts.length ? s.pts[s.pts.length - 1][1] : 0)) * 1.08;
  const X = i => ml + (days.length < 2 ? iw / 2 : (i / (days.length - 1)) * iw);
  const Y = v => mt + ih - (v / maxY) * ih;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = maxY * i / ticks;
    svg.appendChild(el("line", { x1: ml, x2: ml + iw, y1: Y(v), y2: Y(v), stroke: "#EDF1F3", "stroke-width": 1 }));
    const t = el("text", { x: ml - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "#7B8D98" });
    t.textContent = f0(v); svg.appendChild(t);
  }
  [0, Math.floor(days.length / 2), days.length - 1].forEach(i => {
    if (i < 0) return;
    const t = el("text", { x: X(i), y: H - 12, "text-anchor": i === 0 ? "start" : (i === days.length - 1 ? "end" : "middle"),
      "font-size": 11, fill: "#7B8D98" });
    t.textContent = fmtD(days[i]).replace(/^\w+,?\s/, ""); svg.appendChild(t);
  });
  series.forEach(s => {
    if (!s.pts.length) return;
    svg.appendChild(el("polyline", { points: s.pts.map(p => X(p[0]) + "," + Y(p[1])).join(" "),
      fill: "none", stroke: s.p.colour || "#7B8D98", "stroke-width": s.p.id === UID ? 3.2 : 2,
      "stroke-linejoin": "round", "stroke-linecap": "round", opacity: s.p.id === UID ? 1 : .8 }));
    const last = s.pts[s.pts.length - 1];
    svg.appendChild(el("circle", { cx: X(last[0]), cy: Y(last[1]), r: 4, fill: "#fff",
      stroke: s.p.colour || "#7B8D98", "stroke-width": 2.2 }));
    const t = el("text", { x: X(last[0]) + 9, y: Y(last[1]) + 4, "font-size": 11,
      fill: s.p.colour || "#7B8D98", "font-weight": s.p.id === UID ? 700 : 600 });
    t.textContent = s.p.display_name.split(" ")[0]; svg.appendChild(t);
  });
  if (!series.length) { const t = el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", "font-size": 13, fill: "#7B8D98" });
    t.textContent = "No sessions in this range yet"; svg.appendChild(t); }
}

function drawStack(board, days) {
  const svg = $("stack"); svg.innerHTML = "";
  const W = 620, H = 350, ml = 44, mr = 14, mt = 16, mb = 34, iw = W - ml - mr, ih = H - mt - mb;
  const people = board.slice(0, 8);
  const totals = days.map(d => people.reduce((a, r) => a + (r.perDay[d] || 0), 0));
  const maxY = Math.max(1, ...totals) * 1.1;
  const bw = iw / Math.max(1, days.length);
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = maxY * i / ticks;
    svg.appendChild(el("line", { x1: ml, x2: ml + iw, y1: mt + ih - (v / maxY) * ih, y2: mt + ih - (v / maxY) * ih,
      stroke: "#EDF1F3", "stroke-width": 1 }));
    const t = el("text", { x: ml - 8, y: mt + ih - (v / maxY) * ih + 4, "text-anchor": "end", "font-size": 11, fill: "#7B8D98" });
    t.textContent = f0(v); svg.appendChild(t);
  }
  days.forEach((d, i) => {
    let y = mt + ih;
    people.forEach(r => {
      const v = r.perDay[d] || 0; if (!v) return;
      const hgt = (v / maxY) * ih;
      const rect = el("rect", { x: ml + i * bw + bw * .12, y: y - hgt, width: bw * .76, height: hgt,
        fill: r.p.colour || "#7B8D98", opacity: r.p.id === UID ? 1 : .82 });
      rect.style.cursor = "pointer";
      rect.addEventListener("mousemove", e => showTT(e, `<b>${esc(r.p.display_name)}</b><em>${fmtD(d)}</em><br>${f1(v)} hours`));
      rect.addEventListener("mouseleave", hideTT);
      svg.appendChild(rect); y -= hgt;
    });
  });
  if (days.length <= 32) days.forEach((d, i) => {
    if (days.length > 16 && i % 2) return;
    const t = el("text", { x: ml + i * bw + bw / 2, y: H - 14, "text-anchor": "middle", "font-size": 10, fill: "#9AA9B1" });
    t.textContent = parseD(d).getDate(); svg.appendChild(t);
  });
}

/* The by-subject split for whichever two people are being compared. */
const H2H_SUBJECTS = { sig: null, by: {} };
async function loadH2HSubjects(a, b, since) {
  const sig = a + "|" + b + "|" + since;
  if (H2H_SUBJECTS.sig === sig) return false;
  try {
    const { data, error } = await sb.rpc("subject_totals", { uids: [a, b], since });
    if (error) return false;
    const by = {};
    (data || []).forEach(r => {
      (by[r.user_id] = by[r.user_id] || {})[r.label || "Other"] = Number(r.minutes || 0) / 60;
    });
    H2H_SUBJECTS.sig = sig; H2H_SUBJECTS.by = by;
    return true;
  } catch (e) { return false; }
}

function drawH2H() {
  const a = $("h2h-a").value, b = $("h2h-b").value;
  if (!a || !b) { $("h2h").innerHTML = `<div class="empty">Not enough members yet.</div>`; return; }
  const days = rangeDays(), set = new Set(days);
  /* The head to head follows the leaderboard's subject, so the whole crew page
     is answering one question at a time. */
  /* Straight off the rollup — every figure here is a sum over days. The split
     by subject is the one thing the rollup cannot answer, so it is fetched for
     these two people alone and cached until the pair or the range changes. */
  const src = LB_SUBJECT ? (SUBJECT_DAILY.key === LB_SUBJECT ? SUBJECT_DAILY.map : new Map()) : DB.daily;
  const stat = uid => {
    const per = {}; let hours = 0, sessions = 0;
    days.forEach(d => {
      const e = src.get(uid); const c = (e && e.days[d]) || [0, 0];
      per[d] = c[0] / 60; hours += c[0] / 60; sessions += c[1];
    });
    const withGoal = days.filter(d => goalFor(uid, d) > 0);
    const hit = withGoal.filter(d => per[d] >= goalFor(uid, d)).length;
    return { p: profileOf(uid), hours, sessions, active: days.filter(d => per[d] > 0).length,
      best: Math.max(0, ...days.map(d => per[d])),
      /* both of these are facts about whole days, so they say nothing about
         one subject and are left off rather than quietly misread */
      streak: LB_SUBJECT ? null : streakFor(uid),
      goalHit: LB_SUBJECT ? null : (withGoal.length ? hit / withGoal.length : null),
      bySub: H2H_SUBJECTS.by[uid] || {} };
  };
  /* Fetch the split if it is not the one we hold, and redraw when it arrives.
     Everything else on this panel is already right without waiting. */
  loadH2HSubjects(a, b, days[0] || todayISO()).then(got => { if (got) drawH2H(); });

  const A = stat(a), B = stat(b);
  const row = (label, va, vb, fmt) => {
    const f = fmt || (x => f1(x));
    const aw = va + vb > 0 ? va / (va + vb) * 100 : 50;
    const win = va === vb ? 0 : (va > vb ? -1 : 1);
    return `<div style="display:grid;grid-template-columns:78px 1fr 78px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--rule-soft)">
      <div style="text-align:right;font-weight:${win === -1 ? 700 : 400};color:${win === -1 ? "var(--ink)" : "var(--ink-mid)"}">${f(va)}</div>
      <div>
        <div style="font-size:11px;color:var(--ink-soft);text-align:center;margin-bottom:4px">${label}</div>
        <div style="display:flex;height:12px;border-radius:2px;overflow:hidden;background:var(--surface-2)">
          <div style="width:${aw}%;background:${A.p.colour}"></div>
          <div style="flex:1;background:${B.p.colour}"></div>
        </div>
      </div>
      <div style="font-weight:${win === 1 ? 700 : 400};color:${win === 1 ? "var(--ink)" : "var(--ink-mid)"}">${f(vb)}</div>
    </div>`;
  };
  const subs = [...new Set([...Object.keys(A.bySub), ...Object.keys(B.bySub)])].sort();
  $("h2h").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:center;margin-bottom:14px">
      <div class="who" style="justify-content:flex-end">${avatarHTML(A.p, "lg")}<span class="nm" style="font-size:15px">${esc(A.p.display_name)}</span></div>
      <div style="font-size:12px;color:var(--ink-soft)">vs</div>
      <div class="who">${avatarHTML(B.p, "lg")}<span class="nm" style="font-size:15px">${esc(B.p.display_name)}</span></div>
    </div>
    ${row(LB_SUBJECT ? "Hours on this subject" : "Hours in range", A.hours, B.hours)}
    ${row("Sessions", A.sessions, B.sessions, f0)}
    ${row("Days active", A.active, B.active, f0)}
    ${row("Longest day", A.best, B.best)}
    ${LB_SUBJECT ? "" : row("Current streak", A.streak, B.streak, f0)}
    ${LB_SUBJECT ? "" : row("Goal hit rate", A.goalHit || 0, B.goalHit || 0, x => f0(x * 100) + "%")}
    ${subs.length ? `<h3 class="sec" style="margin:18px 0 6px">By subject</h3>` +
      subs.map(s => row(s, A.bySub[s] || 0, B.bySub[s] || 0)).join("") : ""}`;
}

/* =========================================================================
   RENDER — me
   ========================================================================= */
function renderMe() {
  const days = allDaysFor(UID);
  const total = DB.sessions.filter(s => s.user_id === UID).reduce((a, s) => a + s.minutes / 60, 0);
  const active = days.filter(d => hoursFor(UID, d) > 0).length;
  $("m-total").textContent = f1(total);
  $("m-total-d").textContent = `${DB.sessions.filter(s => s.user_id === UID).length} sessions`;
  $("m-days").textContent = active;
  $("m-days-d").textContent = days.length ? `Of ${days.length} days since you started` : "Nothing logged yet";
  $("m-long").textContent = longestStreakFor(UID);
  $("m-avg").textContent = active ? f1(total / active) : "0.0";
  $("m-avg-d").textContent = "Only counting days you logged something";

  /* calendar: from first session (or 27 days ago) to the last exam or today+13 */
  const exams = mySubjects(UID).map(s => s.exam_date).filter(Boolean).sort();
  const start = days[0] || addDays(todayISO(), -27);
  const end = exams.length ? exams[exams.length - 1] : addDays(todayISO(), 13);
  const gridStart = addDays(start, -dowIdx(start));
  const weeks = Math.max(1, Math.ceil((daysBetween(gridStart, end) + 1) / 7));
  $("calhead").innerHTML = DOW.map(d => `<div class="calhd">${d}</div>`).join("");
  const heat = $("heat"); heat.innerHTML = "";
  for (let w = 0; w < weeks; w++) for (let r = 0; r < 7; r++) {
    const d = addDays(gridStart, w * 7 + r);
    const div = document.createElement("div");
    if (d < start || d > end) { div.style.cssText = "background:transparent;border:0"; heat.appendChild(div); continue; }
    const h = hoursFor(UID, d), g = goalFor(UID, d), rr = ratioFor(UID, d), fut = d > todayISO();
    div.className = "hmcell" + (d === todayISO() ? " today" : "") + (fut ? " future" : "");
    if (!fut) div.style.background = lvlColour(rr, h > 0);
    div.innerHTML = `<div class="dn">${parseD(d).getDate()}</div>` +
      (h > 0 ? `<div class="hv">${f1(h)}</div>` : (fut && g > 0 ? `<div class="hv" style="color:rgba(18,35,46,.3);font-weight:500">${f1(g)}</div>` : ""));
    div.addEventListener("mousemove", e => showTT(e,
      `<b>${fmtD(d)}</b>${f1(h)} h logged · goal ${f1(g)} h${g > 0 && !fut ? `<br><em>${f0(h / g * 100)}% of goal</em>` : ""}`));
    div.addEventListener("mouseleave", hideTT);
    div.addEventListener("click", () => { CUR = d; renderHome(); document.querySelector('nav.tabs button[data-p="home"]').click(); });
    heat.appendChild(div);
  }
  $("hmleg").innerHTML = [["var(--l5)","120%+"],["var(--l4)","goal met"],["var(--l3)","80–99%"],
    ["var(--l2)","60–79%"],["var(--l1)","40–59%"],["var(--l0)","under 40%"],["var(--none)","nothing"]]
    .map(x => `<span><i class="sw" style="background:${x[0]}"></i>${x[1]}</span>`).join("");

  const wkStart = addDays(todayISO(), -dowIdx(todayISO()));
  $("weekrail").innerHTML = Array.from({ length: 7 }, (_, i) => addDays(wkStart, i)).map(d => {
    const h = hoursFor(UID, d), g = goalFor(UID, d), rr = ratioFor(UID, d);
    return `<div class="rowbar" style="grid-template-columns:84px 1fr 88px">
      <div style="font-size:12px;${d === todayISO() ? "font-weight:700" : ""}">${fmtD(d).replace(/,/, "")}</div>
      <div class="track" style="height:20px"><div class="fill" style="width:${g > 0 ? Math.min(100, h / g * 100).toFixed(1) : (h > 0 ? 100 : 0)}%;background:${lvlColour(rr, h > 0)}"></div></div>
      <div class="val" style="text-align:right;font-size:12px">${f1(h)}<span style="color:var(--ink-soft);font-weight:400"> / ${f1(g)}</span></div>
    </div>`;
  }).join("");

  const cds = mySubjects(UID).filter(s => s.exam_date).sort((a, b) => a.exam_date < b.exam_date ? -1 : 1);
  $("cdrail").innerHTML = cds.length ? cds.map(s => {
    const n = Math.max(0, daysBetween(todayISO(), s.exam_date));
    return `<div class="rowbar" style="grid-template-columns:1fr 62px">
      <div><span class="swatch" style="background:${esc(s.colour)};display:inline-block;margin-right:7px"></span>${esc(s.name)}</div>
      <div class="val" style="color:${n <= 7 ? "var(--loss)" : "var(--ink)"}">${n} d</div></div>`;
  }).join("") : `<div style="font-size:12.5px;color:var(--ink-soft)">Add exam dates to your subjects in Setup to see a countdown.</div>`;

  renderTimetable();

  /* subject + area rails */
  const bySub = {}, byArea = {};
  DB.sessions.filter(s => s.user_id === UID).forEach(s => {
    if (s.subject_id) bySub[s.subject_id] = (bySub[s.subject_id] || 0) + s.minutes / 60;
    if (s.area_id) byArea[s.area_id] = (byArea[s.area_id] || 0) + s.minutes / 60;
  });
  const subs = mySubjects(UID);
  const subTarget = s => myAreas(UID).filter(a => a.subject_id === s.id)
    .reduce((x, a) => x + (Number(a.target_hours) || 0), 0);
  const mxS = Math.max(1, ...subs.map(s => Math.max(bySub[s.id] || 0, subTarget(s))));
  $("subrail").innerHTML = subs.length ? subs.map(s => {
    const l = bySub[s.id] || 0, t = subTarget(s);
    return `<div class="rowbar" style="grid-template-columns:180px 1fr 108px">
      <div style="font-weight:600;color:${esc(s.colour)};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</div>
      <div class="track" style="height:22px">
        ${t ? `<div style="position:absolute;left:${(t / mxS * 100).toFixed(1)}%;top:0;bottom:0;width:2px;background:#4A6572"></div>` : ""}
        <div class="fill" style="width:${(l / mxS * 100).toFixed(1)}%;background:${esc(s.colour)};opacity:.85"></div></div>
      <div class="val" style="text-align:right">${f1(l)}${t ? `<span style="color:var(--ink-soft);font-weight:400"> / ${f1(t)}</span>` : " h"}</div>
    </div>`;
  }).join("") : `<div class="empty">No subjects yet — add them in Setup.</div>`;

  const areas = myAreas(UID);
  const mxA = Math.max(1, ...areas.map(a => Math.max(byArea[a.id] || 0, Number(a.target_hours) || 0)));
  $("arearail").innerHTML = areas.length ? areas.map(a => {
    const s = subjById(a.subject_id) || { colour: "#7B8D98" }, l = byArea[a.id] || 0, t = Number(a.target_hours) || 0;
    return `<div class="rowbar" style="grid-template-columns:220px 1fr 96px">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.name)}">
        <span style="color:${esc(s.colour)};font-weight:700">▍</span> ${esc(a.name)}
        ${a.current_pct != null ? `<span class="pill" style="background:${lvlColour(a.current_pct / 100 >= 1 ? 1.2 : a.current_pct / 90, true)};margin-left:6px">${f0(a.current_pct)}%</span>` : ""}</div>
      <div class="track" style="height:18px">
        ${t ? `<div style="position:absolute;left:${(t / mxA * 100).toFixed(1)}%;top:0;bottom:0;width:2px;background:#4A6572"></div>` : ""}
        <div class="fill" style="width:${(l / mxA * 100).toFixed(1)}%;background:${esc(s.colour)};opacity:.8"></div></div>
      <div class="val" style="text-align:right">${l ? f1(l) : "—"}${t ? `<span style="color:var(--ink-soft);font-weight:400"> / ${f1(t)}</span>` : ""}</div>
    </div>`;
  }).join("") : `<div class="empty">No areas yet. Add them under a subject in Setup.</div>`;

  renderMyLog();
}
let mQ = "";
$("m-search").addEventListener("input", e => { mQ = e.target.value.toLowerCase(); renderMyLog(); });
function renderMyLog() {
  const rows = DB.sessions.filter(s => s.user_id === UID)
    .filter(s => !mQ || (labelOf(s) + " " + (s.mode || "") + " " + (s.note || "")).toLowerCase().includes(mQ));
  $("m-logcount").textContent = `${rows.length} session${rows.length === 1 ? "" : "s"} · ${f1(rows.reduce((a, s) => a + s.minutes / 60, 0))} hours`;
  const byDay = {};
  rows.forEach(s => { (byDay[s.day] = byDay[s.day] || []).push(s); });
  const keys = Object.keys(byDay).sort().reverse();
  $("m-log").innerHTML = keys.length ? keys.map(d =>
    `<div class="daygroup">${fmtLong(d)} · ${f1(byDay[d].reduce((a, s) => a + s.minutes / 60, 0))} h of ${f1(goalFor(UID, d))}</div>
     <div style="padding:0 16px">${byDay[d].map(s => entryHTML(s)).join("")}</div>`).join("")
    : `<div class="empty" style="margin:18px">Nothing matches.</div>`;
  wireEntryActions($("m-log"));
}

/* =========================================================================
   RENDER — setup
   ========================================================================= */
/* =========================================================================
   PRIVATE MODE

   hide_hours is enforced in the database, not here. The row level policy on
   sessions and live_timers drops a private person's rows for everybody except
   themselves and an administrator, so the leaderboard, the charts, the feed,
   the strip and the hours beside a name in chat all lose them at once, without
   a single one of them having to remember to check. That matters because the
   anon key is public: anything hidden only in this file is hidden from nobody.

   hide_others is the opposite kind of switch. It only decides what one person
   is shown, so it cannot be got around in any way that hurts anyone, and it
   lives here.
   ========================================================================= */
const hidingOthers = () => !!(ME && ME.hide_others);
const hidingMine   = () => !!(ME && ME.hide_hours);

/* Everyone whose study is on show, which is everyone except the people who
   asked not to be — and yourself, always, because private mode hides you from
   the others, not from your own stats.

   The database already refuses to hand over their sessions, so their hours are
   genuinely unavailable. But a name still has to be taken off the board: left
   in, a private person sits at the bottom on 0.0 h, which announces both that
   they are here and that they have apparently done nothing. Worse than the
   leak it was meant to close. */
const visiblePeople = () => DB.profiles.filter(p => p.id === UID || !p.hide_hours);

function paintPrivacy() {
  if (!$("s-hidehours")) return;
  $("s-hidehours").checked  = hidingMine();
  $("s-hideothers").checked = hidingOthers();
  const note = $("s-privstate");
  if (note) note.textContent =
    hidingMine() && hidingOthers() ? "You are hidden from the year group, and it is hidden from you."
    : hidingMine()  ? "Your hours are yours alone. You can still see how everyone else is going."
    : hidingOthers()? "You cannot see anybody else's hours. Yours are still on the board for them."
    : "Everything is visible both ways.";
  /* the two surfaces that are entirely about other people */
  const crew = $("p-crew"), home = $("p-home"), solo = $("crew-solo");
  if (crew) crew.classList.toggle("solo", hidingOthers());
  if (home) home.classList.toggle("solo", hidingOthers());
  if (solo) solo.hidden = !hidingOthers();
}

async function savePrivacy() {
  const patch = { hide_hours: $("s-hidehours").checked, hide_others: $("s-hideothers").checked };
  const { error } = await sb.from("profiles").update(patch).eq("id", UID);
  if (error) { toast("Could not save that — " + error.message, 4600); paintPrivacy(); return; }
  Object.assign(ME, patch);
  paintPrivacy();
  renderAll();
  /* turning hide_hours off puts the rows back for everyone, but nobody else's
     client knows to look again until it next reads — so read our own now */
  await refresh();
  toast(patch.hide_hours ? "Your hours are hidden from the year group" : "Your hours are visible again");
}

/* Two people on the same colour is the thing this is all trying to avoid, so
   say so at the moment it happens rather than leaving them to wonder why they
   look alike on the charts. */
function paintColourClash() {
  const note = $("s-colournote");
  if (!note) return;
  const others = colourClash($("s-colour").value);
  if (!others.length) { note.hidden = true; return; }
  const names = others.slice(0, 3).map(p => p.display_name).join(", ");
  const more = others.length > 3 ? ` and ${others.length - 3} more` : "";
  note.innerHTML = `<b>${esc(names)}</b>${more} already ${others.length === 1 ? "has" : "have"} ` +
    `that colour. You will be hard to tell apart on the charts.`;
  note.hidden = false;
}

function renderSetup() {
  paintPrivacy();
  if (!$("s-hidehours").dataset.wired) {
    $("s-hidehours").dataset.wired = "1";
    $("s-hidehours").addEventListener("change", savePrivacy);
    $("s-hideothers").addEventListener("change", savePrivacy);
  }
  $("s-name").value = ME.display_name || "";
  $("s-colour").value = ME.colour || freeProfileColour();
  paintColourClash();
  if (!$("s-colour").dataset.wired) {
    $("s-colour").dataset.wired = "1";
    $("s-colour").addEventListener("input", paintColourClash);
    $("s-colourpick").addEventListener("click", () => {
      $("s-colour").value = freeProfileColour();
      paintColourClash();
    });
  }
  $("s-avpreview").outerHTML = avatarHTML(ME, "xl").replace('class="av xl"', 'class="av xl" id="s-avpreview"');
  $("s-default").value = ME.default_goal != null ? ME.default_goal : 3;
  const wk = Array.isArray(ME.weekday_goals) && ME.weekday_goals.length === 7 ? ME.weekday_goals : [3,3,3,3,3,5,5];
  $("s-wk").innerHTML = DOW.map((d, i) => `<div><label class="fl" style="text-align:center">${d}</label>
    <input type="number" min="0" max="16" step="0.5" id="swk${i}" value="${wk[i]}" style="text-align:center;padding:7px 4px"></div>`).join("");

  const subs = mySubjects(UID);
  $("s-sublist").innerHTML = subs.length ? subs.map(s => {
    const as = myAreas(UID).filter(a => a.subject_id === s.id);
    return `<div class="card" style="margin-bottom:10px;box-shadow:none">
      <div class="body" style="padding:12px 14px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="swatch" style="background:${esc(s.colour)}"></span>
          <input type="text" value="${esc(s.name)}" data-sname="${s.id}" title="Rename this subject"
            style="flex:1;min-width:140px;font-weight:600;font-size:13.5px;padding:5px 8px">
          <input type="date" value="${s.exam_date || ""}" data-sexam="${s.id}" style="width:auto;font-size:12.5px;padding:5px 8px">
          <input type="color" value="${esc(s.colour)}" data-scol="${s.id}">
          <button class="btn ghost sm" data-areas="${s.id}">Areas (${as.length})</button>
          <button class="x" data-subdel="${s.id}" title="Delete subject">×</button>
        </div>
        ${as.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">
          ${as.map(a => `<span class="chip" style="cursor:default">${esc(a.name)}${a.target_hours ? ` · ${f1(a.target_hours)}h` : ""}</span>`).join("")}</div>` : ""}
      </div></div>`;
  }).join("") : `<div class="empty">No subjects yet. Add your first above.</div>`;

  $("s-sublist").querySelectorAll("[data-subdel]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Delete this subject and all its areas? Sessions already logged are kept but lose their label.")) return;
    await sb.from("subjects").delete().eq("id", b.dataset.subdel); await refresh();
  }));
  $("s-sublist").querySelectorAll("[data-scol]").forEach(i => i.addEventListener("change", async () => {
    await sb.from("subjects").update({ colour: i.value }).eq("id", i.dataset.scol); await refresh();
  }));
  $("s-sublist").querySelectorAll("[data-sexam]").forEach(i => i.addEventListener("change", async () => {
    await sb.from("subjects").update({ exam_date: i.value || null }).eq("id", i.dataset.sexam); await refresh();
  }));
  $("s-sublist").querySelectorAll("[data-areas]").forEach(b => b.addEventListener("click", () => openAreas(b.dataset.areas)));
  $("s-sublist").querySelectorAll("[data-sname]").forEach(i => i.addEventListener("change", async () => {
    const n = i.value.trim();
    if (!n) { await refresh(); return; }
    await sb.from("subjects").update({ name: n }).eq("id", i.dataset.sname);
    await refresh(); toast("Subject renamed");
  }));
}
$("s-saveprofile").addEventListener("click", async () => {
  await sb.from("profiles").update({ display_name: $("s-name").value.trim() || ME.display_name,
    colour: $("s-colour").value }).eq("id", UID);
  await refresh(); toast("Profile saved");
});
$("s-avfile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const url = await uploadAvatar(f);
    await sb.from("profiles").update({ avatar_url: url }).eq("id", UID);
    await refresh(); toast("Picture updated"); }
  catch (err) { toast("Upload failed: " + (err.message || err)); }
});
$("s-savegoals").addEventListener("click", async () => {
  const wk = DOW.map((_, i) => Number($("swk" + i).value));
  await sb.from("profiles").update({ weekday_goals: wk, default_goal: Number($("s-default").value) || 0 }).eq("id", UID);
  await refresh(); toast("Goals saved");
});
$("s-addsub").addEventListener("click", async () => {
  const n = $("s-subname").value.trim(); if (!n) return;
  await sb.from("subjects").insert({ user_id: UID, name: n, colour: $("s-subcolour").value,
    exam_date: $("s-subexam").value || null, position: mySubjects(UID).length });
  $("s-subname").value = ""; $("s-subexam").value = "";
  $("s-subcolour").value = PALETTE[mySubjects(UID).length % PALETTE.length];
  await refresh(); toast("Subject added");
});
$("s-subname").addEventListener("keydown", e => { if (e.key === "Enter") $("s-addsub").click(); });

/* Typing a subject in by hand is folded away until it is asked for, so the
   Knox list is what you reach first. Once opened it stays open for the rest
   of the visit — somebody adding one odd subject usually has a second. */
$("s-manualtoggle").addEventListener("click", () => {
  const box = $("s-manual"), open = box.hidden;
  box.hidden = !open;
  $("s-manualtoggle").setAttribute("aria-expanded", String(open));
  $("s-manualtoggle").textContent = open
    ? "Hide the by-hand form" : "Not on the list? Type one in by hand";
  if (open) $("s-subname").focus();
});

/* ---------- areas modal ---------- */
let areaSubject = null;
function openAreas(subjectId) {
  areaSubject = subjectId;
  const s = subjById(subjectId);
  $("ma-title").textContent = s ? s.name : "Areas";
  $("ma-sub").textContent = "Areas are what you actually sit down and revise.";
  paintAreaList();
  $("ov-areas").classList.add("on");
}
function paintAreaList() {
  const as = myAreas(UID).filter(a => a.subject_id === areaSubject);
  $("ma-list").innerHTML = as.length ? as.map(a => `
    <div class="itemrow" style="grid-template-columns:auto 1fr 84px 74px auto;gap:8px;align-items:center">
      <span class="swatch" style="background:${esc((subjById(areaSubject) || {}).colour || "#999")}"></span>
      <input type="text" value="${esc(a.name)}" data-aname="${a.id}" title="Rename this area"
        style="font-size:13px;padding:5px 8px">
      <input type="number" value="${a.target_hours != null ? a.target_hours : ""}" data-atgt="${a.id}"
        min="0" step="0.5" placeholder="target h" title="Target hours" style="font-size:12.5px;padding:5px 6px">
      <input type="number" value="${a.current_pct != null ? a.current_pct : ""}" data-apct="${a.id}"
        min="0" max="100" step="1" placeholder="mark %" title="Mark you currently score" style="font-size:12.5px;padding:5px 6px">
      <button class="x" data-adel="${a.id}" title="Delete area">×</button>
    </div>`).join("") : `<div class="empty">No areas yet for this subject.</div>`;
  $("ma-list").querySelectorAll("[data-adel]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Delete this area? Sessions logged against it are kept but lose the label.")) return;
    await sb.from("areas").delete().eq("id", b.dataset.adel); await refresh(); paintAreaList();
  }));
  const areaField = (attr, col, cast) => $("ma-list").querySelectorAll("[" + attr + "]").forEach(i =>
    i.addEventListener("change", async () => {
      const raw = i.value.trim();
      if (col === "name" && !raw) { paintAreaList(); return; }
      const val = col === "name" ? raw : (raw === "" ? null : cast(raw));
      await sb.from("areas").update({ [col]: val }).eq("id", i.getAttribute(attr));
      await refresh(); paintAreaList();
    }));
  areaField("data-aname", "name", String);
  areaField("data-atgt", "target_hours", Number);
  areaField("data-apct", "current_pct", Number);
}
$("ma-add").addEventListener("click", async () => {
  const n = $("ma-name").value.trim(); if (!n) return;
  await sb.from("areas").insert({ user_id: UID, subject_id: areaSubject, name: n,
    target_hours: $("ma-target").value ? Number($("ma-target").value) : null,
    current_pct: $("ma-pct").value ? Number($("ma-pct").value) : null,
    position: myAreas(UID).filter(a => a.subject_id === areaSubject).length });
  $("ma-name").value = ""; $("ma-target").value = ""; $("ma-pct").value = "";
  await refresh(); paintAreaList();
});
$("ma-name").addEventListener("keydown", e => { if (e.key === "Enter") $("ma-add").click(); });
document.querySelectorAll("[data-closeareas]").forEach(b => b.addEventListener("click", () => $("ov-areas").classList.remove("on")));
$("ov-areas").addEventListener("click", e => { if (e.target.id === "ov-areas") e.currentTarget.classList.remove("on"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { $("ov-areas").classList.remove("on"); } });

/* =========================================================================
   PROFILE VIEW
   Anyone can open anyone. Everything in here is already readable by every
   signed-in member — this just puts it in one place instead of scattered
   across the leaderboard, the feed and the charts.
   ========================================================================= */
async function openProfile(id) {
  const p = profileOf(id);
  const mine = id === UID;
  openProfileId = id;

  /* Their rows, fetched when you ask for them rather than carried around for
     the whole crew the whole time. One person's history is a few tens of
     kilobytes; four hundred people's was the thing that had to go. */
  let all;
  if (mine) {
    all = DB.sessions.slice();
  } else {
    if (GUEST.id !== id) {
      const [se, su, ar] = await Promise.all([
        sb.from("sessions").select("*").eq("user_id", id).order("day", { ascending: false }),
        sb.from("subjects").select("*").eq("user_id", id).order("position"),
        sb.from("areas").select("*").eq("user_id", id).order("position")
      ]);
      GUEST = { id, subjects: su.data || [], areas: ar.data || [], sessions: se.data || [] };
      /* Their whole history has just arrived and none of it has counts yet,
         so ask again now that there are ids to ask about. */
      try { await loadReactions(); } catch (e) { /* counts can wait */ }
    }
    all = GUEST.sessions.slice();
  }
  const byDay = {};
  all.forEach(x => { byDay[x.day] = (byDay[x.day] || 0) + x.minutes / 60; });
  const days = Object.keys(byDay).sort();
  const totalH = all.reduce((a, x) => a + x.minutes / 60, 0);
  const best = days.length ? Math.max(...days.map(d => byDay[d])) : 0;
  const avg = days.length ? totalH / days.length : 0;

  const wk = leaderboard(7);
  const rank = wk.findIndex(r => r.id === id);
  const wkHours = rank >= 0 ? wk[rank].hours : 0;

  /* goal-hit rate across every day since they first logged something */
  let hit = 0, withGoal = 0;
  if (days.length) {
    for (let d = days[0]; d <= todayISO(); d = addDays(d, 1)) {
      const g = goalFor(id, d);
      if (g > 0) { withGoal++; if ((byDay[d] || 0) >= g) hit++; }
    }
  }

  $("pf-head").innerHTML = `
    <div class="pfhead">
      ${avatarHTML(p, "xl")}
      <div class="pfid">
        <h2>${esc(p.display_name)}${mine ? ` <span class="pilltag">you</span>` : ""}</h2>
        <div class="pfmeta">${
          rank >= 0 ? `#${rank + 1} of ${wk.length} this week · ${f1(wkHours)} h` : "no hours this week"}</div>
      </div>
    </div>
    <div class="pfacts">
      ${mine ? `<button class="btn ghost sm" id="pf-signout">Sign out</button>`
             : (() => {
                 const why = nudgeBlockedBecause(id);
                 return `<button class="btn sm" id="pf-nudge"${why ? " disabled" : ""} title="${
                   esc(why ? NUDGE_BLOCK_TEXT[why] : "Tell them to get started")}">Nudge</button>`;
               })()}
      <button class="x" data-closeprofile style="font-size:20px">&times;</button>
    </div>`;

  const so = $("pf-signout");
  if (so) so.addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  const nb = $("pf-nudge");
  if (nb) nb.addEventListener("click", () => sendNudge(id));

  const subs = mySubjects(id), areas = myAreas(id);
  const hSub = {}, hArea = {};
  all.forEach(x => {
    if (x.subject_id) hSub[x.subject_id] = (hSub[x.subject_id] || 0) + x.minutes / 60;
    if (x.area_id) hArea[x.area_id] = (hArea[x.area_id] || 0) + x.minutes / 60;
  });
  const mxSub = Math.max(1, ...subs.map(x => hSub[x.id] || 0));

  const logDays = Object.keys(byDay).sort().reverse();

  $("pf-body").innerHTML = `
    <div class="grid g4 mb16">
      <div class="kpi"><div class="v">${f1(totalH)}</div><div class="k">Hours logged, all time</div>
        <div class="d">${all.length} session${all.length === 1 ? "" : "s"}</div></div>
      <div class="kpi"><div class="v">${days.length}</div><div class="k">Days with something logged</div>
        <div class="d">${days.length ? "since " + fmtD(days[0]) : "nothing yet"}</div></div>
      <div class="kpi"><div class="v">${streakFor(id)}</div><div class="k">Current streak</div>
        <div class="d">Rest days carry it through</div></div>
      <div class="kpi"><div class="v">${f1(avg)}</div><div class="k">Average per active day</div>
        <div class="d">Best day ${f1(best)} h${withGoal ? " · goal hit " + f0(hit / withGoal * 100) + "%" : ""}</div></div>
    </div>

    <h3 class="sec">Hours by subject</h3>
    <div class="rail mb16">${subs.length ? subs.map(x => {
      const v = hSub[x.id] || 0;
      return `<div class="rowbar">
        <div><span class="swatch" style="background:${esc(x.colour)};display:inline-block;margin-right:7px"></span>${esc(x.name)}</div>
        <div class="track"><div class="fill" style="width:${(v / mxSub) * 100}%;background:${esc(x.colour)}"></div></div>
        <div class="val">${f1(v)} h</div></div>`;
    }).join("") : `<div class="empty">No subjects set up.</div>`}</div>

    ${areas.length ? `<h3 class="sec">Areas</h3>
    <div class="mb16" style="max-height:230px;overflow:auto;border:1px solid var(--rule-soft);border-radius:4px">
      ${areas.map(a => {
        const sj = subs.find(x => x.id === a.subject_id);
        return `<div class="itemrow" style="padding:8px 12px">
          <span class="swatch" style="background:${esc((sj || {}).colour || "#999")}"></span>
          <div><strong>${esc(a.name)}</strong>
            <span style="font-size:11.5px;color:var(--ink-soft)"> · ${esc((sj || {}).name || "")}</span></div>
          <div style="font-size:12.5px;color:var(--ink-mid);white-space:nowrap">
            ${f1(hArea[a.id] || 0)} h${a.target_hours ? " / " + f1(a.target_hours) : ""}${
              a.current_pct != null ? " · " + f0(a.current_pct) + "%" : ""}</div>
        </div>`;
      }).join("")}
    </div>` : ""}

    <h3 class="sec">Every session${all.length ? " — " + all.length + " of them, newest first" : ""}</h3>
    <div class="pflog">${logDays.length ? logDays.map(d => `
      <div class="daygroup">${fmtLong(d)} · ${f1(byDay[d])} h of ${f1(goalFor(id, d))}</div>
      <div style="padding:0 14px">${all.filter(x => x.day === d)
        .map(x => entryHTML(x, false)).join("")}</div>`).join("")
      : `<div class="empty">Nothing logged yet.</div>`}</div>`;

  wireEntryActions($("pf-body"));
  $("ov-profile").classList.add("on");
}

/* one listener for every avatar and name in the app */
document.addEventListener("click", e => {
  /* A live card opens a profile and carries reaction buttons, so a press on
     the buttons would do both. Both listeners are on document, where
     stopPropagation does not reach a sibling, so the check belongs here. */
  if (e.target.closest && e.target.closest("[data-treact],[data-react]")) return;
  const t = e.target.closest && e.target.closest("[data-profile]");
  if (t && t.dataset.profile) openProfile(t.dataset.profile);
});

/* And one for every reaction button, for the same reason and one more: a press
   swaps the row it was in for a freshly drawn one, so a listener bound to the
   button would be thrown away by the very click that used it. */
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-react]");
  if (b && b.dataset.rxid) { sendReaction(b.dataset.rxid, b.dataset.react); return; }
  const t = e.target.closest && e.target.closest("[data-treact]");
  if (t && t.dataset.trxid) {
    /* The card underneath opens a profile. A press on the buttons is about the
       timer, not the person, so it stops there. */
    e.stopPropagation();
    sendTimerReaction(t.dataset.trxid, t.dataset.treact);
  }
});
function closeProfile() { openProfileId = null; $("ov-profile").classList.remove("on"); }
document.querySelectorAll("[data-closeprofile]").forEach(b => b.addEventListener("click", closeProfile));
$("ov-profile").addEventListener("click", e => {
  if (e.target.id === "ov-profile") closeProfile();
  if (e.target.closest && e.target.closest("[data-closeprofile]")) closeProfile();
});
document.addEventListener("keydown", e => {
  /* the edit sheet opens on top of a profile — Escape belongs to it first */
  if (e.key === "Escape" && !editingId) closeProfile();
});
$("s-viewme").addEventListener("click", () => openProfile(UID));

/* ---------- admin console ---------- */
$("s-admin").addEventListener("click", () => {
  if (typeof openAdmin === "function") openAdmin();
});
$("adm-close").addEventListener("click", () => {
  if (typeof closeAdmin === "function") closeAdmin();
});

/* =========================================================================
   DELETE MY ACCOUNT
   Tries the delete_own_account() function from schema.sql, which removes the
   auth user and lets the cascades clear everything. If that function is not
   installed yet, clear the rows we are allowed to clear and say so plainly.
   ========================================================================= */
$("nuke").addEventListener("click", async () => {
  const who = (ME && ME.display_name) || "this account";
  if (!confirm(
    "Delete " + who + "?\n\n" +
    "This removes every session, subject, area and goal, the profile itself, and the login. " +
    "You will disappear from the peloton leaderboard.\n\nThere is no undo.")) return;
  const typed = prompt('Type DELETE to confirm.');
  if (typed !== "DELETE") { toast("Not deleted"); return; }

  $("nuke").disabled = true;
  try {
    const { error } = await sb.rpc("delete_own_account");
    if (error) throw error;
    await sb.auth.signOut();
    location.reload();
    return;
  } catch (err) {
    /* function missing — wipe what row-level security lets us wipe */
    try {
      for (const t of ["sessions", "areas", "subjects", "goals", "live_timers"]) {
        await sb.from(t).delete().eq("user_id", UID);
      }
      const { error: pe } = await sb.from("profiles").delete().eq("id", UID);
      if (pe) throw pe;
      await sb.auth.signOut();
      alert("Everything of yours has been deleted.\n\n" +
            "The login itself is still in Supabase — run the latest schema.sql to install " +
            "delete_own_account(), or remove the user under Authentication in the dashboard.");
      location.reload();
    } catch (err2) {
      $("nuke").disabled = false;
      toast("Could not delete: " + ((err2 && err2.message) || err2));
    }
  }
});

/* =========================================================================
   KNOX SUBJECT PICKER
   Catalogue-driven. Used by onboarding and by Setup. Everything it inserts is
   ordinary editable data the moment it lands — nothing here is locked.
   ========================================================================= */
let pkCat = "all", pkHandlers = null;

function openPicker(handlers) {
  pkHandlers = handlers;
  pkCat = "all";
  $("pk-search").value = "";
  $("pk-retired").checked = false;
  const cats = Object.keys(CAT.categories);
  $("pk-cats").innerHTML =
    `<button class="chip" aria-pressed="true" data-pkc="all">All</button>` +
    cats.map(k => `<button class="chip" data-pkc="${k}">${esc(CAT.categories[k].label)}</button>`).join("");
  $("pk-cats").querySelectorAll("[data-pkc]").forEach(b => b.addEventListener("click", () => {
    pkCat = b.dataset.pkc;
    $("pk-cats").querySelectorAll("[data-pkc]").forEach(x =>
      x.setAttribute("aria-pressed", x.dataset.pkc === pkCat ? "true" : "false"));
    paintPicker();
  }));
  paintPicker();
  $("ov-picker").classList.add("on");
  setTimeout(() => $("pk-search").focus(), 30);
}

function paintPicker() {
  const q = $("pk-search").value.trim().toLowerCase();
  const taken = (pkHandlers.taken() || []).map(n => String(n).toLowerCase());
  let list = $("pk-retired").checked ? CAT.subjects : CAT.active;
  if (pkCat !== "all") list = list.filter(s => s.cat === pkCat);
  if (q) list = list.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.catLabel.toLowerCase().includes(q) ||
    s.areas.some(a => a.toLowerCase().includes(q)));

  if (!list.length) {
    $("pk-list").innerHTML = `<div class="empty">Nothing matches “${esc($("pk-search").value)}”. You can still type it in by hand — the app does not mind.</div>`;
    return;
  }

  const groups = {};
  list.forEach(s => { (groups[s.catLabel] = groups[s.catLabel] || []).push(s); });

  $("pk-list").innerHTML = Object.keys(groups).map(g => `
    <h3 class="sec" style="margin:14px 0 7px">${esc(g)}</h3>
    ${groups[g].map(s => {
      const already = taken.indexOf(s.name.toLowerCase()) !== -1;
      const days = s.exams.map(e => fmtD(e.date)).filter((d, i, a) => a.indexOf(d) === i);
      const when = days.length
        ? days.join(" · ") + (s.exams.length > days.length ? " (" + s.exams.length + " papers)" : "")
        : "no written exam";
      /* The whole row is the target, not just the button on the end of it —
         this is mostly used on a phone, and a 44-pixel button beside a
         three-line row is a fiddly thing to hit. */
      return `<div class="pkrow${already ? " picked" : ""}" ${already ? "" : `data-pkadd="${esc(s.name)}"`}
        role="button" tabindex="${already ? -1 : 0}" aria-pressed="${already}">
        <span class="swatch" style="background:${esc(s.colour)}"></span>
        <div>
          <strong>${esc(s.name)}</strong>
          <span style="font-size:11.5px;color:var(--ink-soft)"> · ${s.units} unit${s.units === 1 ? "" : "s"}</span>
          <div style="font-size:11.5px;color:var(--ink-soft)">
            ${esc(when)} · ${s.areas.length} section${s.areas.length === 1 ? "" : "s"}${s.note ? " · " + esc(s.note) : ""}</div>
        </div>
        <span class="pktick">${already ? "✓ Added" : "Add"}</span>
      </div>`;
    }).join("")}`).join("");

  const add = async el => {
    const c = CAT.byName(el.dataset.pkadd);
    if (!c || el.classList.contains("picked")) return;
    el.classList.add("picked");                       /* immediate, before the write */
    try { await pkHandlers.pick(c); } finally { paintPicker(); }
  };
  $("pk-list").querySelectorAll("[data-pkadd]").forEach(el => {
    el.addEventListener("click", () => add(el));
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); add(el); }
    });
  });
  paintPickerCount(taken.length);
}

/* How many you have so far, and a way out that is not the little × in the
   corner — the point being that you are meant to pick several and then leave. */
function paintPickerCount(n) {
  const el = $("pk-count");
  if (!el) return;
  el.textContent = n === 0 ? "Nothing picked yet"
    : n + " subject" + (n === 1 ? "" : "s") + " added";
  const done = $("pk-done");
  if (done) done.textContent = n ? "Done" : "Close";
}

$("pk-search").addEventListener("input", paintPicker);
$("pk-retired").addEventListener("change", paintPicker);
document.querySelectorAll("[data-closepicker]").forEach(b =>
  b.addEventListener("click", () => $("ov-picker").classList.remove("on")));
$("ov-picker").addEventListener("click", e => {
  if (e.target.id === "ov-picker") e.currentTarget.classList.remove("on");
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") $("ov-picker").classList.remove("on");
});

/* Setup tab — same picker, writes straight to the database */
$("s-frompicker").addEventListener("click", () => openPicker({
  taken: () => mySubjects(UID).map(s => s.name),
  pick: async c => {
    const { data } = await sb.from("subjects").insert({
      user_id: UID, name: c.name, colour: c.colour,
      exam_date: c.exam_date, position: mySubjects(UID).length
    }).select().single();
    if (data && c.areas.length) {
      await sb.from("areas").insert(c.areas.map((a, j) => ({
        user_id: UID, subject_id: data.id, name: a, position: j })));
    }
    await refresh();
    toast(c.name + " added with " + c.areas.length + " sections");
  }
}));

/* =========================================================================
   HSC TIMETABLE
   Every written paper for the subjects you actually take, in date order.
   Dates come from the NESA 2026 written exam timetable, matched on subject name.
   ========================================================================= */
function renderTimetable() {
  const el = $("tt-list");
  if (!el) return;
  const mine = mySubjects(UID);
  const papers = [];
  mine.forEach(s => {
    const c = CAT.byName(s.name);
    if (c && c.exams.length) {
      c.exams.forEach(e => papers.push({
        subject: s.name, colour: s.colour, paper: e.paper,
        date: e.date, start: e.start, end: e.end
      }));
    } else if (s.exam_date) {
      papers.push({ subject: s.name, colour: s.colour, paper: null,
        date: s.exam_date, start: null, end: null, custom: true });
    }
  });
  const seen = {};
  const unique = papers.filter(p => {
    const k = p.subject + "|" + p.paper + "|" + p.date + "|" + p.start;
    if (seen[k]) return false;
    seen[k] = 1; return true;
  });
  papers.length = 0;
  Array.prototype.push.apply(papers, unique);
  papers.sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)));

  const offList = mine.filter(s => {
    const c = CAT.byName(s.name);
    return c && !c.exams.length;
  });

  if (!papers.length) {
    el.innerHTML = `<div class="empty">No written papers yet. Add subjects from the Knox list in Setup and their exam dates arrive with them.</div>`;
    $("tt-sub").textContent = "Every written paper you sit, from the NESA 2026 timetable";
    return;
  }

  const today = todayISO();
  const next = papers.find(p => p.date >= today);
  const last = papers[papers.length - 1];
  $("tt-sub").textContent = papers.length + " paper" + (papers.length === 1 ? "" : "s") +
    (next ? " · first up " + fmtD(next.date) + ", " + Math.max(0, daysBetween(today, next.date)) + " days away" : "") +
    " · done " + fmtD(last.date);

  let lastDate = null;
  el.innerHTML = papers.map(p => {
    const n = daysBetween(today, p.date);
    const head = p.date !== lastDate;
    lastDate = p.date;
    const past = n < 0;
    return `${head ? `<div class="daygroup">${fmtLong(p.date)}</div>` : ""}
      <div class="itemrow" style="grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;${past ? "opacity:.45" : ""}">
        <span class="swatch" style="background:${esc(p.colour)}"></span>
        <div>
          <strong>${esc(p.subject)}</strong>
          ${p.paper && p.paper !== p.subject ? `<div style="font-size:11.5px;color:var(--ink-soft)">${esc(p.paper)}</div>` : ""}
          ${p.custom ? `<div style="font-size:11.5px;color:var(--ink-soft)">your own date</div>` : ""}
        </div>
        <div style="font-size:12px;color:var(--ink-mid);white-space:nowrap">${p.start ? esc(p.start + " – " + p.end) : ""}</div>
        <div class="val" style="white-space:nowrap;color:${past ? "var(--ink-soft)" : n <= 7 ? "var(--loss)" : "var(--ink)"}">
          ${past ? "done" : n + " d"}</div>
      </div>`;
  }).join("") + (offList.length ? `<div class="note" style="margin-top:14px">
      No written paper for ${offList.map(s => esc(s.name)).join(", ")} — ${offList.length === 1 ? "it is" : "they are"} assessed by submission or performance, so ${offList.length === 1 ? "it will" : "they will"} not appear above.</div>` : "");
}

/* =========================================================================
   IMPORT / EXPORT
   ========================================================================= */
$("imp-btn").addEventListener("click", () => $("imp-file").click());
$("imp-file").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => runImport(f.name.toLowerCase().endsWith(".csv") ? parseCSV(r.result) : parseJSON(r.result));
  r.readAsText(f);
});
function parseJSON(text) {
  const j = JSON.parse(text);
  const out = [];
  (j.entries || []).forEach(e => {
    out.push({ day: (e.d || e.date || "").slice(0, 10),
      subject: e.subject || guessSubject(e.area || e.unit || ""),
      area: e.area || e.unit || null, minutes: Number(e.mins || e.minutes || 0),
      mode: e.mode || null, note: e.note || null });
  });
  const goals = j.goals || {};
  return { rows: out, goals };
}
function guessSubject(area) {
  const a = String(area);
  if (/Module|Common Module|Craft of Writing/i.test(a)) return "English Advanced";
  if (/Literary Worlds|Upheaval/i.test(a)) return "English Extension 1";
  if (/Christianity|Islam|1945|Religion/i.test(a)) return "Studies of Religion";
  if (/Question Practice|Error Review/i.test(a)) return "Mathematics";
  if (/Operations|Marketing|Finance|HR|Human Resources/i.test(a)) return "Business Studies";
  if (/Data Science|Visualisation|Intelligent|Content|Technical/i.test(a)) return "Enterprise Computing";
  return "Imported";
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], goals: {} };
  const split = l => { const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) { const c = l[i];
      if (q) { if (c === '"') { if (l[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
    out.push(cur); return out; };
  const head = split(lines[0]).map(h => h.trim().toLowerCase());
  const idx = n => head.indexOf(n);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    const day = (c[idx("date")] || "").trim().slice(0, 10);
    const minutes = Number(c[idx("minutes")] || 0);
    if (!day || !minutes) continue;
    rows.push({ day, subject: (c[idx("subject")] || "Imported").trim(),
      area: (c[idx("area")] || "").trim() || null, minutes,
      mode: (c[idx("mode")] || "").trim() || null, note: (c[idx("note")] || "").trim() || null });
  }
  return { rows, goals: {} };
}
async function runImport(parsed) {
  const rep = $("imp-report");
  const rows = parsed.rows.filter(r => r.day && r.minutes > 0);
  if (!rows.length) { rep.innerHTML = `<div class="note bad">Nothing importable found in that file.</div>`; return; }
  rep.innerHTML = `<div class="note">Importing ${rows.length} sessions…</div>`;
  try {
    const subMap = {}, areaMap = {};
    mySubjects(UID).forEach(s => subMap[s.name.toLowerCase()] = s.id);
    myAreas(UID).forEach(a => areaMap[a.subject_id + "|" + a.name.toLowerCase()] = a.id);
    let newSubs = 0, newAreas = 0;
    for (const r of rows) {
      const sn = (r.subject || "Imported").trim();
      if (!subMap[sn.toLowerCase()]) {
        const { data } = await sb.from("subjects").insert({ user_id: UID, name: sn,
          colour: PALETTE[Object.keys(subMap).length % PALETTE.length],
          position: Object.keys(subMap).length }).select().single();
        if (data) { subMap[sn.toLowerCase()] = data.id; newSubs++; }
      }
      const sid = subMap[sn.toLowerCase()];
      if (r.area && sid && !areaMap[sid + "|" + r.area.toLowerCase()]) {
        const { data } = await sb.from("areas").insert({ user_id: UID, subject_id: sid, name: r.area,
          position: 0 }).select().single();
        if (data) { areaMap[sid + "|" + r.area.toLowerCase()] = data.id; newAreas++; }
      }
    }
    const payload = rows.map(r => {
      const sid = subMap[(r.subject || "Imported").toLowerCase()];
      return { user_id: UID, subject_id: sid || null,
        area_id: r.area ? (areaMap[sid + "|" + r.area.toLowerCase()] || null) : null,
        day: r.day, minutes: Math.min(1440, Math.max(1, Math.round(r.minutes))),
        mode: r.mode, note: r.note };
    });
    for (let i = 0; i < payload.length; i += 200) await sb.from("sessions").insert(payload.slice(i, i + 200));
    const gs = Object.keys(parsed.goals || {});
    if (gs.length) {
      const gp = gs.map(d => ({ user_id: UID, day: d, hours: Number(parsed.goals[d]) }))
        .filter(g => !isNaN(g.hours));
      for (let i = 0; i < gp.length; i += 200) await sb.from("goals").upsert(gp.slice(i, i + 200));
    }
    await refresh();
    rep.innerHTML = `<div class="note ok">Imported ${payload.length} sessions, created ${newSubs} subject${newSubs === 1 ? "" : "s"} and ${newAreas} area${newAreas === 1 ? "" : "s"}${gs.length ? `, plus ${gs.length} daily goals` : ""}.</div>`;
    toast("Import finished");
  } catch (e) {
    rep.innerHTML = `<div class="note bad">Import failed: ${esc(e.message || e)}</div>`;
  }
}
$("exp-btn").addEventListener("click", () => {
  const data = {
    profile: { display_name: ME.display_name, colour: ME.colour, default_goal: ME.default_goal, weekday_goals: ME.weekday_goals },
    subjects: mySubjects(UID).map(s => ({ name: s.name, colour: s.colour, exam_date: s.exam_date })),
    areas: myAreas(UID).map(a => ({ subject: (subjById(a.subject_id) || {}).name, name: a.name,
      target_hours: a.target_hours, current_pct: a.current_pct })),
    sessions: DB.sessions.filter(s => s.user_id === UID).map(s => ({ date: s.day,
      subject: (subjById(s.subject_id) || {}).name || null, area: (areaById(s.area_id) || {}).name || null,
      minutes: s.minutes, mode: s.mode, note: s.note })),
    goals: DB.goals.filter(g => g.user_id === UID).reduce((o, g) => (o[g.day] = Number(g.hours), o), {})
  };
  const b = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = "study-crew-" + todayISO() + ".json"; a.click();
});
$("wipe").addEventListener("click", async () => {
  if (!confirm("Delete every session you have logged? Your subjects and goals stay. This cannot be undone.")) return;
  await sb.from("sessions").delete().eq("user_id", UID);
  await refresh(); toast("All your sessions deleted");
});

/* =========================================================================
   STUDY REMINDERS
   Web push, straight to the browser vendors. No third party service, no
   email, no account anywhere: the device registers itself here, and a job
   inside Supabase works out when somebody could do with a nudge.
   ========================================================================= */
const VAPID_PUBLIC_KEY =
  "BKDaGDZxF1RmeuB6AZW6-AWNQClD2B_rt8nxpHWRrUn1O-4l23URyIiWSFRjO12rxiCA5zxNO7FYL1yZHJszSpo";
const NUDGE_URL = String(CFG.SUPABASE_URL || "").replace(/\/+$/, "") + "/functions/v1/nudge";

let PREFS = null;
let swReg = null;

/* The mock harness is excluded: there is no service worker at its scope and
   no backend to push from, so attempting it only litters the console. */
const pushSupported = () => !!sb && !window.STUDYTRACK_MOCK &&
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/* iPadOS reports itself as a Mac, hence the touch check. */
const iOSish = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;

function b64ToBytes(s) {
  const p = "=".repeat((4 - s.length % 4) % 4);
  const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function ensureSW() {
  if (swReg) return swReg;
  swReg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  return swReg;
}

async function loadPrefs() {
  try {
    const { data } = await sb.from("notification_prefs").select("*").eq("user_id", UID);
    PREFS = (data && data[0]) || null;
  } catch (e) { PREFS = null; }
}

async function savePrefs(patch) {
  const row = Object.assign(
    { user_id: UID, push_on: false, remind_at: "19:30:00", quiet_days: [] },
    PREFS || {}, patch,
    {
      /* Rewritten on every save, so a nudge still lands at the right hour
         if someone travels or the clocks change. */
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Sydney",
      updated_at: new Date().toISOString()
    });
  delete row.created_at;
  try {
    const { data, error } = await sb.from("notification_prefs")
      .upsert(row, { onConflict: "user_id" }).select();
    if (error) throw error;
    PREFS = (data && data[0]) || row;
  } catch (e) {
    console.error(e); toast("Could not save your reminder settings"); return false;
  }
  paintReminders();
  return true;
}

async function remindersOn() {
  let perm;
  try { perm = await Notification.requestPermission(); }
  catch (e) { perm = Notification.permission; }
  if (perm !== "granted") {
    toast(perm === "denied" ? "This browser is blocking notifications for the site"
                            : "Reminders need permission to show notifications");
    return false;
  }

  const reg = await ensureSW();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY)
    });
  }

  const j = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert({
    user_id:    UID,
    endpoint:   j.endpoint,
    p256dh:     j.keys.p256dh,
    auth:       j.keys.auth,
    user_agent: String(navigator.userAgent).slice(0, 300)
  }, { onConflict: "endpoint" });
  if (error) { console.error(error); toast("Could not register this device"); return false; }

  return await savePrefs({ push_on: true });
}

async function remindersOff() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) { console.error(e); }
  return await savePrefs({ push_on: false });
}

function paintReminders() {
  if (!$("s-remcard")) return;
  const why = $("s-remwhy"), tog = $("s-remtoggle"), test = $("s-remtest");
  const on  = !!(PREFS && PREFS.push_on);

  paintCalendar();

  if (!pushSupported()) {
    why.classList.remove("hide");
    why.innerHTML = window.STUDYTRACK_MOCK
      ? "<strong>Local test harness.</strong> Reminders need the real app over https, so the switch is off here. The layout below is what everyone actually sees."
      : iOSish() && !standalone()
      ? "<strong>One extra step on iPhone and iPad.</strong> Safari only allows reminders once this is on your Home Screen. Tap Share, then <strong>Add to Home Screen</strong>, open it from there, and the switch below will work."
      : "<strong>This browser will not show notifications.</strong> Usually that is a school or workplace policy switching them off outright, and nothing here can undo it. <strong>Use the calendar reminder below instead</strong> — your calendar delivers that one, so the block does not apply to it.";
    tog.disabled = true; test.disabled = true;
    $("s-remstate").className = "note";
    $("s-remstate").textContent = "Reminders are not available in this browser.";
    return;
  }

  why.classList.add("hide");
  if (Notification.permission === "denied") {
    why.classList.remove("hide");
    why.innerHTML = "<strong>Notifications are blocked for this site.</strong> That can only be undone in the browser's own settings — look for the padlock beside the address bar. If your school manages this browser it may not be undoable at all, in which case use the calendar reminder below.";
  }

  tog.disabled = false;
  tog.textContent = on ? "Turn off" : "Turn on";
  tog.classList.toggle("ghost", on);
  test.disabled = !on;

  const at = String((PREFS && PREFS.remind_at) || "19:30").slice(0, 5);
  $("s-remtime").value = at;

  /* DOW here runs Monday first; Postgres counts Sunday as 0. */
  const quiet = (PREFS && PREFS.quiet_days) || [];
  $("s-remdays").innerHTML = DOW.map((d, i) => {
    const pg = (i + 1) % 7;
    return `<button class="chip" data-quiet="${pg}" aria-pressed="${quiet.indexOf(pg) >= 0}">${d}</button>`;
  }).join("");
  $("s-remdays").querySelectorAll("[data-quiet]").forEach(b => b.addEventListener("click", async () => {
    const pg = Number(b.dataset.quiet);
    await savePrefs({ quiet_days: quiet.indexOf(pg) >= 0 ? quiet.filter(x => x !== pg) : quiet.concat(pg) });
  }));

  const tz = (PREFS && PREFS.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone;
  $("s-remstate").className = "note" + (on ? " ok" : "");
  $("s-remstate").textContent = on
    ? `On. If you have logged nothing by ${at} (${tz}) this device gets a nudge. One a day at most, and never on a day you have skipped.`
    : "Reminders are off. Turning them on asks the browser for permission, once.";
}

if ($("s-remtoggle")) {
  $("s-remtoggle").addEventListener("click", async () => {
    const b = $("s-remtoggle"); b.disabled = true;
    try {
      if (PREFS && PREFS.push_on) { if (await remindersOff()) toast("Reminders off"); }
      else if (await remindersOn()) toast("Reminders on");
    } catch (e) { console.error(e); toast("Could not change that"); }
    finally { b.disabled = false; paintReminders(); }
  });

  $("s-remtime").addEventListener("change", async () => {
    const v = $("s-remtime").value || "19:30";
    if (await savePrefs({ remind_at: v.length === 5 ? v + ":00" : v })) toast("Reminder time saved");
  });

  $("s-remtest").addEventListener("click", async () => {
    const b = $("s-remtest"); b.disabled = true;
    try {
      const { data } = await sb.auth.getSession();
      const tok = data && data.session && data.session.access_token;
      if (!tok) { toast("Sign in again first"); return; }
      const r = await fetch(NUDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ mode: "test" })
      });
      const j = await r.json().catch(() => ({}));
      toast(r.ok && j.sent ? "Sent — watch for the banner"
                           : "Could not send: " + (j.error || r.status));
    } catch (e) { console.error(e); toast("Could not send the test"); }
    finally { b.disabled = false; }
  });
}

/* Runs once after sign-in, and never blocks the app from rendering. */
async function initReminders() {
  if (!$("s-remcard")) return;
  await loadPrefs();
  /* A row for everyone, whether or not push works in this browser: the
     calendar feed is keyed on the token in it, and that is the channel that
     survives a school notification block. */
  if (!PREFS) await savePrefs({});
  if (pushSupported()) {
    try { await ensureSW(); } catch (e) { console.error("service worker:", e); }
    /* If the browser quietly dropped the subscription — cleared data, months
       away — but we still think reminders are on, put it back. */
    try {
      if (PREFS && PREFS.push_on && Notification.permission === "granted") {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        if (!sub) await remindersOn();
      }
    } catch (e) { console.error(e); }
  }
  paintReminders();
}

/* =========================================================================
   THE IN-APP NUDGE
   Notifications can be switched off by policy; a page cannot. So the app
   itself carries the reminder: a bar across the top, the tab title while
   you are looking elsewhere, and a dot on the favicon. No permission is
   asked for any of it, and nothing can block it.
   ========================================================================= */

/* Null means "say nothing" — a rest day, a skipped day, or goal already met. */
function nudgeState() {
  if (!UID || !ME || !DB.sessions) return null;
  const day = todayISO();
  const goal = goalFor(UID, day);
  if (!(goal > 0)) return null;                       /* rest day, never nag */
  const hours = hoursFor(UID, day);
  if (hours >= goal) return null;                     /* done for the day */
  if (PREFS && (PREFS.quiet_days || []).indexOf(new Date().getDay()) >= 0) return null;

  const at = String((PREFS && PREFS.remind_at) || "19:30").slice(0, 5);
  const now = new Date();
  const due = now.getHours() * 60 + now.getMinutes() >=
              Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
  return { goal, hours, due, at, short: goal - hours };
}

/* Declared, not assigned to a const: paintTimer calls into this from far
   earlier in the file, and a const would sit in its temporal dead zone. */
function nudgeDismissed() {
  try { return localStorage.getItem("studytrack-nudge-dismissed") === todayISO(); }
  catch (e) { return false; }   /* private window, or storage switched off */
}

function paintNudgeBar() {
  const bar = $("nudgebar");
  if (!bar) return;
  const s = nudgeState();

  /* One prompt at a time. If a mate has actually nudged you, or said your name
     in chat, that says the same thing with a person attached, and two stacked
     bars is just noise — the Today ring still shows where you stand. */
  if (POKES.length || MENTIONS.length) { bar.className = "hide"; bar.innerHTML = ""; return; }

  if (!s || nudgeDismissed()) { bar.className = "hide"; bar.innerHTML = ""; return; }

  bar.className = s.due ? "due" : "";
  bar.innerHTML =
    `<span class="nb-dot"></span>
     <div class="nb-text">
       <strong>${s.hours > 0 ? f1(s.hours) + " h of " + f1(s.goal) + " h today"
                             : "Nothing logged today"}</strong>
       <span>${s.due ? `${f1(s.short)} h short, and it is past ${s.at}. Twenty minutes still counts.`
                     : `${f1(s.short)} h to go.`}</span>
     </div>
     <button class="btn sm" id="nb-go">Start a session</button>
     <button class="x" id="nb-hide" title="Hide until tomorrow" aria-label="Hide until tomorrow">×</button>`;

  $("nb-go").addEventListener("click", () => {
    const tab = document.querySelector('nav.tabs button[data-p="home"]');
    if (tab) tab.click();
    const start = $("tm-start");
    if (start) { start.scrollIntoView({ block: "center", behavior: "smooth" }); start.focus(); }
  });
  $("nb-hide").addEventListener("click", () => {
    try { localStorage.setItem("studytrack-nudge-dismissed", todayISO()); } catch (e) { /* private window */ }
    paintNudgeBar();
  });
}

/* Fed to paintTimer, which owns document.title on a one second tick. Only
   flashes while the tab is in the background: flickering the title of the
   tab you are actually reading is just irritating. */
function nudgeTitle() {
  const s = nudgeState();
  if (!s || !s.due || !document.hidden || nudgeDismissed()) return APP_NAME;
  return Math.floor(Date.now() / 2000) % 2
    ? APP_NAME
    : "⚠ " + (s.hours > 0 ? f1(s.hours) + " h" : "0 h") + " today";
}

/* A dot on the tab icon. Redraws only when the state actually flips, since
   its caller runs every second. */
let faviconBadged = null;
function paintFavicon() {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (paintFavicon.plain == null) paintFavicon.plain = link.getAttribute("href");

  const s = nudgeState();
  const want = !!(s && s.due && !nudgeDismissed());
  if (want === faviconBadged) return;
  faviconBadged = want;

  if (!want) { link.setAttribute("href", paintFavicon.plain); return; }
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0, 64, 64);
        x.beginPath();
        x.arc(47, 47, 16, 0, Math.PI * 2);
        x.fillStyle = "#E8402A"; x.fill();
        x.lineWidth = 6; x.strokeStyle = "#fff"; x.stroke();
        link.setAttribute("href", c.toDataURL("image/png"));
      } catch (e) { /* canvas blocked — the bar and the title still work */ }
    };
    img.src = paintFavicon.plain;
  } catch (e) { /* ignore */ }
}

/* =========================================================================
   THE CALENDAR FEED
   The channel that survives a notification block, because the reminder is
   delivered by the calendar rather than the browser.
   ========================================================================= */
function calendarURL() {
  if (!PREFS || !PREFS.feed_token) return "";
  return String(CFG.SUPABASE_URL || "").replace(/\/+$/, "") +
         "/functions/v1/calendar?t=" + PREFS.feed_token;
}

function paintCalendar() {
  const box = $("s-calurl");
  if (!box) return;
  const url = calendarURL();
  box.value = url;
  box.placeholder = url ? "" : "Your link will appear here in a moment";
  const on = !!url;
  if ($("s-calcopy"))  $("s-calcopy").disabled  = !on;
  if ($("s-calreset")) $("s-calreset").disabled = !on;
}

if ($("s-calcopy")) {
  $("s-calcopy").addEventListener("click", async () => {
    const v = $("s-calurl").value;
    if (!v) return;
    try { await navigator.clipboard.writeText(v); toast("Link copied"); }
    catch (e) { $("s-calurl").select(); toast("Copy it with Ctrl or Cmd + C"); }
  });

  $("s-calreset").addEventListener("click", async () => {
    if (!confirm("Issue a new calendar link?\n\nThe old one stops working immediately, and you will have to re-add the new one in your calendar.")) return;
    const tok = window.crypto && crypto.randomUUID ? crypto.randomUUID() : null;
    if (!tok) { toast("This browser cannot generate a new link"); return; }
    if (await savePrefs({ feed_token: tok })) toast("New link issued");
  });
}

/* =========================================================================
   CHAT
   -------------------------------------------------------------------------
   One room for the whole year group, and three rules that keep it from
   costing anything:

     · the newest fifty on open, never the whole history, and older ones
       only if you ask — paged on created_at rather than an offset, so page
       forty costs what page one costs;
     · a new message arrives over the socket carrying the row, so it is
       appended where it lands. Nothing re-reads anything;
     · names, colours and hours are already in this client — profiles and
       the daily rollup — so the badge beside somebody's name is a lookup,
       not a query. The whole ornament is free.

   The hours shown are today's, which is what makes the room change through
   the day. Nobody is shown a zero: an empty morning simply has no pill.
   ========================================================================= */
const CHAT_PAGE = 50;

/* ---------------------------------------------------------------------------
   PICTURES

   A photo straight off a phone is three or four megabytes. Four hundred people
   posting those, and everybody else loading them, is the one thing in this app
   that could genuinely cost money — so the picture is redrawn at a sane size in
   the browser before it ever leaves it. A typical camera photo comes out around
   two hundred kilobytes, which is a twentieth of what it was.

   The bucket is private. Links are signed, last an hour, and are asked for in
   one batch per page of messages rather than one at a time — so a URL copied
   out of here stops working, and deleting the file really does take it away.
   --------------------------------------------------------------------------- */
const IMG_MAX_EDGE = 1600;
const IMG_QUALITY  = 0.82;
const IMG_MAX_BYTES = 3 * 1024 * 1024;

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    /* An animated gif would lose its animation on a canvas, so it is passed
       through untouched — the size limit still applies to it. */
    if (file.type === "image/gif") return resolve(file);
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, IMG_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      cv.toBlob(b => b ? resolve(new File([b], "photo.jpg", { type: "image/jpeg" }))
                       : reject(new Error("could not read that image")),
                "image/jpeg", IMG_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("that file is not an image")); };
    img.src = url;
  });
}

/* Signed links, cached until they are nearly expired. */
const SIGNED = new Map();
async function signImages(paths) {
  const now = Date.now();
  const want = [...new Set(paths.filter(Boolean))]
    .filter(p => { const e = SIGNED.get(p); return !e || e.until - now < 5 * 60e3; });
  if (!want.length) return;
  try {
    const { data, error } = await sb.storage.from("chat").createSignedUrls(want, 3600);
    if (error) return;
    (data || []).forEach(r => {
      if (r.signedUrl) SIGNED.set(r.path, { url: r.signedUrl, until: now + 55 * 60e3 });
    });
  } catch (e) { /* the picture simply will not draw; the message still reads */ }
}
const signedFor = path => { const e = SIGNED.get(path); return e ? e.url : null; };

/* What is attached to the message being written, if anything. */
let chatDraftImage = null;   /* { path, name, bytes, preview } */

async function attachImage(file) {
  const btn = $("chat-attach");
  if (!file) return;
  if (!/^image\//.test(file.type)) { chatNote("That is not an image."); return; }
  btn.disabled = true;
  try {
    const shrunk = await shrinkImage(file);
    if (shrunk.size > IMG_MAX_BYTES) {
      chatNote("That picture is still over 3 MB after shrinking. Try a smaller one.");
      return;
    }
    const path = `${UID}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await sb.storage.from("chat").upload(path, shrunk, {
      contentType: shrunk.type, upsert: false
    });
    if (error) { chatNote("Could not upload that — " + error.message); return; }
    chatDraftImage = { path, name: file.name, bytes: shrunk.size,
                       preview: URL.createObjectURL(shrunk) };
    paintChatPreview();
  } catch (e) {
    chatNote(e.message || "Could not read that image.");
  } finally {
    btn.disabled = false;
    $("chat-file").value = "";
  }
}

async function dropDraftImage() {
  const img = chatDraftImage;
  chatDraftImage = null;
  paintChatPreview();
  /* it was uploaded the moment it was picked, so take it away again */
  if (img) { URL.revokeObjectURL(img.preview);
    try { await sb.storage.from("chat").remove([img.path]); } catch (e) {} }
}

function paintChatPreview() {
  const box = $("chat-preview");
  if (!box) return;
  if (!chatDraftImage) { box.hidden = true; box.innerHTML = ""; return; }
  const kb = Math.round(chatDraftImage.bytes / 1024);
  box.innerHTML = `<img src="${esc(chatDraftImage.preview)}" alt="">
    <div class="cp-meta"><div class="cp-name">${esc(chatDraftImage.name)}</div>
      <div>${kb} KB, ready to send</div></div>
    <button class="btn ghost sm" id="cp-drop" type="button">Remove</button>`;
  box.hidden = false;
  $("cp-drop").addEventListener("click", dropDraftImage);
}

function chatNote(text) {
  const n = $("chat-note");
  if (!n) return;
  n.textContent = text;
  n.hidden = !text;
}

/* ---------------------------------------------------------------------------
   MENTIONS

   Display names have spaces in them, so "@Sam Whitfield" cannot be picked out
   of free text reliably — where does the name stop? So the person is chosen
   from a list as you type and their id is remembered alongside the text. What
   gets stored is the list of ids, not a guess made later by re-reading the
   message, which means a mention cannot be faked by typing somebody's name and
   cannot be lost by them changing it.

   At send time each remembered name is checked to still be in the box, so
   deleting "@Sam" also takes Sam off the message.
   --------------------------------------------------------------------------- */
let mentionDraft = [];       /* [{ id, name }] offered so far */
let mentionOpen  = false, mentionIdx = 0, mentionMatches = [], mentionAt = -1;

/* Two boxes now want this: the room's composer and the console's announcement
   box. It is the same interaction against different elements, so the machinery
   takes the ids rather than assuming chat's — one implementation, because the
   copy of it that did not get the bug fix is the one that goes wrong.
   `self` is the one real difference: chat never offers you yourself, an
   announcement does, because an unsigned notice naming a contact is the whole
   reason you would want it. */
let MENTION = { input: "chat-input", list: "mentionbox", after: null, self: false };
function useMentions(input, list, after, self) {
  MENTION = { input: input, list: list, after: after || null, self: !!self };
}

const mentionable = () => DB.profiles
  .filter(p => MENTION.self || p.id !== UID)
  .sort((a, b) => a.display_name.localeCompare(b.display_name));

/* The "@" being typed right now, if the caret is inside one. */
function mentionQuery() {
  const box = $(MENTION.input);
  if (!box) return null;
  const upto = box.value.slice(0, box.selectionStart);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/[\s(]/.test(upto[at - 1])) return null;   /* mid-word @ is an email */
  const q = upto.slice(at + 1);
  if (q.length > 24 || /\n/.test(q)) return null;
  return { at, q };
}

function paintMentionBox() {
  const box = $(MENTION.list);
  if (!box) return;
  if (!mentionOpen || !mentionMatches.length) { box.hidden = true; box.innerHTML = ""; return; }
  box.innerHTML = `<div class="mh">Mention somebody</div>` + mentionMatches.map((p, i) =>
    `<button type="button" role="option" data-mention="${esc(p.id)}"
       aria-selected="${i === mentionIdx}">${avatarHTML(p, "sm")}<span>${esc(p.display_name)}</span></button>`
  ).join("");
  box.hidden = false;
  box.querySelectorAll("[data-mention]").forEach(b =>
    b.addEventListener("mousedown", e => { e.preventDefault(); insertMention(b.dataset.mention); }));
}

function refreshMentionBox() {
  const m = mentionQuery();
  if (!m) { mentionOpen = false; paintMentionBox(); return; }
  const q = m.q.toLowerCase();
  mentionMatches = mentionable()
    .filter(p => !q || p.display_name.toLowerCase().includes(q))
    .slice(0, 6);
  mentionAt = m.at;
  mentionOpen = mentionMatches.length > 0;
  mentionIdx = 0;
  paintMentionBox();
}

function insertMention(id) {
  const p = profileOf(id);
  const box = $(MENTION.input);
  const m = mentionQuery();
  if (!p || !m) return;
  const before = box.value.slice(0, m.at);
  const after  = box.value.slice(box.selectionStart);
  const token  = "@" + p.display_name + " ";
  box.value = before + token + after;
  const caret = (before + token).length;
  box.setSelectionRange(caret, caret);
  if (!mentionDraft.some(x => x.id === id)) mentionDraft.push({ id, name: p.display_name });
  mentionOpen = false;
  paintMentionBox();
  if (MENTION.after) MENTION.after();
  box.focus();
}

/* Only the ones whose name is still in the box actually go on the message. */
const mentionsInText = text =>
  mentionDraft.filter(m => text.includes("@" + m.name)).map(m => m.id);

/* Wrapping the names after escaping, never before — the text is somebody
   else's and must not be able to bring markup with it. */
function withMentions(escaped, ids) {
  (ids || []).forEach(id => {
    const p = profileOf(id);
    if (!p || !p.display_name) return;
    const name = esc("@" + p.display_name);
    const cls = id === UID ? "mention me" : "mention";
    escaped = escaped.split(name).join(`<span class="${cls}">${name}</span>`);
  });
  return escaped;
}

/* ---------------------------------------------------------------------------
   Being mentioned. The same shape as a nudge, because it is the same kind of
   thing — somebody asking for your attention — and the client is already
   listening to every message for the unread dot, so this needs no new
   subscription and no new table.
   --------------------------------------------------------------------------- */
function paintMentionBar() {
  const bar = $("mentionbar");
  if (!bar) return;
  /* A nudge is about whether you are working at all, which is the bigger
     thing, so it keeps the top spot and this waits its turn. */
  if (!MENTIONS.length || POKES.length) { bar.className = "hide"; bar.innerHTML = ""; reconcileBars(); return; }
  const newest = MENTIONS[MENTIONS.length - 1];
  /* An announcement carries no name in the room, so it must not carry one here
     either — naming the admin in the bar would undo the whole point of leaving
     the notice unsigned. It says what kind of thing wants you instead. */
  const headline = newest.announcement
    ? annLabel(newest) + " announcement mentioned you"
    : profileOf(newest.user_id).display_name + " mentioned you in chat";
  const many = MENTIONS.length > 1;
  bar.className = "";
  bar.innerHTML =
    `<span class="pb-icon" aria-hidden="true">${newest.announcement ? "\u25b2" : "💬"}</span>
     <div class="pb-text">
       <strong>${esc(headline)}</strong>
       <span>${esc(many ? MENTIONS.length + " mentions waiting · " : "")}${
         esc((newest.body || "").slice(0, 90) || "sent you a picture")}</span>
     </div>
     <button class="btn sm" id="mb-go">Open chat</button>
     <button class="x" id="mb-hide" title="Dismiss" aria-label="Dismiss">×</button>`;
  reconcileBars();
  $("mb-hide").addEventListener("click", clearMentions);
  $("mb-go").addEventListener("click", () => {
    clearMentions();
    const tab = document.querySelector('nav.tabs button[data-p="chat"]');
    if (tab) tab.click();
  });
}
function clearMentions() { MENTIONS = []; paintMentionBar(); }
function noteMention(m) {
  if (MENTIONS.some(x => x.id === m.id)) return;
  MENTIONS.push(m);
  paintMentionBar();
}

/* Tapping a picture opens it properly. */
function openImageView(url) {
  const ov = document.createElement("div");
  ov.className = "imgview";
  ov.innerHTML = `<button class="x" aria-label="Close">&times;</button><img src="${esc(url)}" alt="">`;
  const shut = () => ov.remove();
  ov.addEventListener("click", e => { if (e.target === ov || e.target.classList.contains("x")) shut(); });
  document.addEventListener("keydown", function esc2(e) {
    if (e.key === "Escape") { shut(); document.removeEventListener("keydown", esc2); }
  });
  document.body.appendChild(ov);
}
let CHAT = { loaded: false, rows: [], oldest: null, unread: 0, atBottom: true, busy: false };
/* Mentions waiting to be seen. paintNudgeBar reads this to decide whether to
   stand aside, the same way it reads POKES. */
let MENTIONS = [];

/* Today's hours, in bands. Four steps and a plain state — few enough to read
   at a glance without a legend, which is the only reason it earns its place. */
const CHAT_TIERS = [
  { at: 8, cls: "t4" },
  { at: 5, cls: "t3" },
  { at: 3, cls: "t2" },
  { at: 1, cls: "t1" }
];
function chatTier(uid) {
  /* Somebody else's hours are exactly what this person asked not to see. Their
     own still show, because that is their number and it is the point. */
  if (uid !== UID && hidingOthers()) return { cls: null, hours: 0 };
  const h = hoursFor(uid, todayISO());
  for (const t of CHAT_TIERS) if (h >= t.at) return { cls: t.cls, hours: h };
  return { cls: null, hours: h };
}

function chatTimeLabel(iso) {
  const d = new Date(iso), now = new Date();
  const hhmm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return hhmm;
  return fmtD(isoOf(d)) + " " + hhmm;
}

/* An announcement is not a chat bubble and does not try to be one. It breaks
   the run of messages deliberately: its own slab, its own colours, and no
   speaker at all. Nothing on it moves — it has to be noticed once, not compete
   with the room around it.

   It is unsigned on purpose. The room reads it as coming from the console
   rather than from a person, which is the whole difference between a notice
   and somebody with a badge telling you what to do. Note that this is what
   the room is SHOWN, not what it could work out: every member can read the
   messages table, and the row still carries the user_id that posted it,
   because the rate limit, the delete policy and the audit log are all keyed
   on it. Anyone who opens the network tab can still see who wrote one. */
/* Null means the plain word. Kept in one place because the badge, the mention
   bar and the console's own list all have to agree on what a notice is called. */
const annLabel = m => ((m && m.ann_label) || "").trim() || "Admin";

function annHTML(m) {
  const canDelete = m.user_id === UID || (typeof IS_ADMIN !== "undefined" && IS_ADMIN);
  return `<div class="ann" data-msg="${esc(m.id)}">
    <div class="ann-top">
      <span class="ann-badge"><i class="fi" aria-hidden="true">\u25b2</i>${esc(annLabel(m))}</span>
      <span class="ann-time">${esc(chatTimeLabel(m.created_at))}</span>
      ${canDelete ? `<button class="ann-del" data-msgdel="${esc(m.id)}"
        title="Delete this announcement">delete</button>` : ""}
    </div>
    <div class="ann-text">${withMentions(esc(m.body), m.mentions)}</div>
  </div>`;
}

function msgHTML(m, prev) {
  if (m.announcement) return annHTML(m);
  const p = profileOf(m.user_id);
  const t = chatTier(m.user_id);
  /* consecutive messages from one person within five minutes share a header */
  const cont = prev && !prev.announcement && prev.user_id === m.user_id &&
               Math.abs(new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60e3;
  const canDelete = m.user_id === UID || (typeof IS_ADMIN !== "undefined" && IS_ADMIN);
  return `<div class="msg${cont ? " cont" : ""}${m.user_id === UID ? " mine" : ""}" data-msg="${esc(m.id)}">
    ${avatarHTML(p, "sm").replace('class="av sm"', `class="av sm${t.cls === "t4" ? " t4ring" : ""}"`)}
    <div class="msgbody">
      <div class="msghead">
        <span class="msgwho person" data-profile="${esc(m.user_id)}"
          style="color:${esc(p.colour || "var(--ink)")}">${esc(p.display_name)}</span>
        ${t.cls ? `<span class="hrpill ${t.cls}" title="${f1(t.hours)} hours logged today">${f1(t.hours)}h</span>` : ""}
        <span class="msgtime">${esc(chatTimeLabel(m.created_at))}</span>
        ${canDelete ? `<button class="msgdel" data-msgdel="${esc(m.id)}" title="Delete this message">delete</button>` : ""}
      </div>
      ${m.body ? `<div class="msgtext">${withMentions(esc(m.body), m.mentions)}</div>` : ""}
      ${m.image_path ? (signedFor(m.image_path)
        ? `<img class="msgimg" src="${esc(signedFor(m.image_path))}" alt="Picture from ${esc(p.display_name)}"
             loading="lazy" data-full="${esc(m.image_path)}">`
        : `<div class="msgimg pending" style="width:160px;height:110px"></div>`) : ""}
    </div>
  </div>`;
}

function paintChat() {
  const log = $("chatlog");
  if (!log) return;
  /* Any picture without a link yet draws as a grey box; this fetches them in
     one go and repaints, rather than a round trip per image. */
  const unsigned = CHAT.rows.map(m => m.image_path).filter(x => x && !signedFor(x));
  if (unsigned.length) signImages(unsigned).then(() => { if (chatIsOpen()) paintChat(); });
  if (!CHAT.rows.length) {
    log.innerHTML = `<div class="chatempty">${CHAT.loaded
      ? "Nothing here yet. Say the first thing."
      : "Loading…"}</div>`;
  } else {
    log.innerHTML = CHAT.rows.map((m, i) => msgHTML(m, CHAT.rows[i - 1])).join("");
  }
  const older = $("chat-older");
  if (older) older.hidden = !CHAT.loaded || CHAT.rows.length < CHAT_PAGE;
  const key = $("chat-key");
  if (key) key.textContent = "The number beside a name is hours logged today";
  wireChatRows();
}

function wireChatRows() {
  $("chatlog").querySelectorAll("[data-msgdel]").forEach(b => b.addEventListener("click", async () => {
    if (b.disabled) return;
    b.disabled = true;
    const id = b.dataset.msgdel;
    const { error } = await sb.from("messages").delete().eq("id", id);
    if (error) { b.disabled = false; toast("Could not delete — " + error.message, 4600); return; }
    chatDrop(id);
  }));
  $("chatlog").querySelectorAll("[data-profile]").forEach(el =>
    el.addEventListener("click", () => openProfile(el.dataset.profile)));
  $("chatlog").querySelectorAll("[data-full]").forEach(el => {
    el.addEventListener("click", () => {
      const u = signedFor(el.dataset.full);
      if (u) openImageView(u);
    });
    /* A picture finishes decoding after the text is laid out and adds its own
       height, so anybody who was reading the newest message would be left
       looking at the one above it. */
    if (!el.complete) el.addEventListener("load", () => chatScrollBottom(false), { once: true });
  });
}

function chatDrop(id) {
  const i = CHAT.rows.findIndex(m => m.id === id);
  if (i >= 0) { CHAT.rows.splice(i, 1); paintChat(); }
}

function chatScrollBottom(force, smooth) {
  const log = $("chatlog");
  if (!log) return;
  if (!(force || CHAT.atBottom)) return;
  if (smooth) log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  else log.scrollTop = log.scrollHeight;
  CHAT.unread = 0;
  paintChatDot();
}

function paintChatDot() {
  const dot = $("chatdot");
  if (dot) dot.hidden = CHAT.unread === 0;
  const jump = $("chat-jump");
  if (jump) jump.hidden = !(CHAT.unread > 0 && chatIsOpen());
}
const chatIsOpen = () => $("p-chat") && $("p-chat").classList.contains("on");

/* The newest page, asked for once — when you first open the tab. */
async function loadChat() {
  if (CHAT.loaded || CHAT.busy || !sb || !UID) return;
  CHAT.busy = true;
  try {
    const { data, error } = await sb.from("messages").select("*")
      .order("created_at", { ascending: false }).limit(CHAT_PAGE);
    if (error) return;
    CHAT.rows = (data || []).slice().reverse();
    CHAT.oldest = CHAT.rows.length ? CHAT.rows[0].created_at : null;
    CHAT.loaded = true;
    paintChat();
    chatScrollBottom(true);
  } finally { CHAT.busy = false; }
}

/* Older ones, a page at a time, keyed on the oldest we hold rather than an
   offset — so the fortieth page costs what the first one did. */
async function loadOlderChat() {
  if (CHAT.busy || !CHAT.oldest) return;
  CHAT.busy = true;
  const btn = $("chat-older");
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
  try {
    const { data, error } = await sb.from("messages").select("*")
      .lt("created_at", CHAT.oldest)
      .order("created_at", { ascending: false }).limit(CHAT_PAGE);
    if (error) return;
    const older = (data || []).slice().reverse();
    const log = $("chatlog");
    const was = log ? log.scrollHeight : 0;
    if (!older.length) { if (btn) { btn.hidden = true; } return; }
    CHAT.rows = older.concat(CHAT.rows);
    CHAT.oldest = CHAT.rows[0].created_at;
    paintChat();
    if (log) log.scrollTop = log.scrollHeight - was;   /* stay where you were reading */
    if (btn && older.length < CHAT_PAGE) btn.hidden = true;
  } finally {
    CHAT.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = "Load older messages"; }
  }
}

/* Arriving over the socket, already carrying the row. */
function onChatInsert(payload) {
  const m = payload && payload.new;
  if (!m || !m.id) return;
  if (CHAT.rows.some(x => x.id === m.id)) return;      /* our own echo */
  /* The socket is already carrying every message for the unread dot, so being
     mentioned costs no extra subscription — just a look at the list. */
  if (m.user_id !== UID && Array.isArray(m.mentions) && m.mentions.indexOf(UID) > -1) noteMention(m);
  if (m.image_path) signImages([m.image_path]).then(() => { if (chatIsOpen()) paintChat(); });
  CHAT.rows.push(m);
  if (CHAT.rows.length > 300) CHAT.rows.splice(0, CHAT.rows.length - 300);
  if (chatIsOpen()) {
    paintChat();
    if (CHAT.atBottom) chatScrollBottom(true);
    else { CHAT.unread++; paintChatDot(); }
  } else if (m.user_id !== UID) {
    CHAT.unread++; paintChatDot();
  }
}
function onChatDelete(payload) {
  const id = payload && payload.old && payload.old.id;
  if (id) chatDrop(id);
}

async function sendChat() {
  const box = $("chat-input"), btn = $("chat-send"), note = $("chat-note");
  const text = (box.value || "").trim();
  const img = chatDraftImage;
  if (!text && !img) return;
  btn.disabled = true;
  note.hidden = true;
  const said = mentionsInText(text);
  const { data, error } = await sb.rpc("send_message", {
    body: text, image_path: img ? img.path : null, mentions: said
  });
  btn.disabled = false;
  if (error) { note.textContent = "Could not send — " + error.message; note.hidden = false; return; }
  if (data && data.ok === false) { note.textContent = data.why || "Could not send"; note.hidden = false; return; }
  box.value = "";
  mentionDraft = [];
  if (img) { URL.revokeObjectURL(img.preview); chatDraftImage = null; paintChatPreview(); }
  paintChatCount();
  autoGrowChat();
  /* realtime will bring the row back; this is just so it feels immediate */
  if (data && data.id && !CHAT.rows.some(x => x.id === data.id)) {
    CHAT.rows.push({ id: data.id, user_id: UID, body: text, created_at: new Date().toISOString(),
                     image_path: img ? img.path : null, mentions: said });
    if (img) signImages([img.path]).then(() => { if (chatIsOpen()) paintChat(); });
    paintChat();
  }
  chatScrollBottom(true);
}

function paintChatCount() {
  const box = $("chat-input"), c = $("chat-count");
  if (!box || !c) return;
  const n = (box.value || "").length;
  c.textContent = n > 400 ? (500 - n) + " left" : "";
  c.classList.toggle("near", n > 460);
}
function autoGrowChat() {
  const box = $("chat-input");
  if (!box) return;
  box.style.height = "auto";
  box.style.height = Math.min(140, box.scrollHeight) + "px";
}

function initChat() {
  const box = $("chat-input");
  if (!box || box.dataset.wired) return;
  box.dataset.wired = "1";
  /* The console's announcement box borrows the same list, so the room claims it
     back on every interaction rather than trusting whatever touched it last. */
  const claim = () => useMentions("chat-input", "mentionbox",
                                  () => { paintChatCount(); autoGrowChat(); }, false);
  box.addEventListener("focus", claim);
  box.addEventListener("input", () => { claim(); paintChatCount(); autoGrowChat(); refreshMentionBox(); });
  box.addEventListener("blur", () => { mentionOpen = false; paintMentionBox(); });
  box.addEventListener("keydown", e => {
    claim();
    /* while the mention list is up it owns the arrows, tab and enter */
    if (mentionOpen && mentionMatches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        mentionIdx = (mentionIdx + (e.key === "ArrowDown" ? 1 : -1) + mentionMatches.length) % mentionMatches.length;
        paintMentionBox();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault(); insertMention(mentionMatches[mentionIdx].id); return;
      }
      if (e.key === "Escape") { e.preventDefault(); mentionOpen = false; paintMentionBox(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $("chat-send").addEventListener("click", sendChat);
  $("chat-attach").addEventListener("click", () => $("chat-file").click());
  $("chat-file").addEventListener("change", e => attachImage(e.target.files[0]));
  /* dropping a picture on the box, and pasting one out of the clipboard */
  const field = $("chatlog").closest(".chatwrap");
  field.addEventListener("dragover", e => { e.preventDefault(); });
  field.addEventListener("drop", e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) { e.preventDefault(); attachImage(f); }
  });
  box.addEventListener("paste", e => {
    const it = [...(e.clipboardData ? e.clipboardData.items : [])]
      .find(i => i.type && /^image\//.test(i.type));
    if (it) { e.preventDefault(); attachImage(it.getAsFile()); }
  });
  $("chat-older").addEventListener("click", loadOlderChat);
  $("chat-jump").addEventListener("click", () => chatScrollBottom(true, true));
  $("chatlog").addEventListener("scroll", () => {
    const log = $("chatlog");
    CHAT.atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    if (CHAT.atBottom && CHAT.unread) { CHAT.unread = 0; paintChatDot(); }
  });
}

/* =========================================================================
   NUDGE YOUR MATES
   A button on someone's profile that prods them to get started. Every rule
   lives in nudge_mate() in the database — the anon key is public, so
   anything checked here could just as easily be skipped here. What follows
   is only about showing the right thing.
   ========================================================================= */
let POKES = [];

/* Why this person cannot be nudged, or null if they can. Mirrors the
   database's rules so the button can explain itself before you press it;
   the server stays the authority either way. */
function nudgeBlockedBecause(id) {
  if (!id || id === UID) return "yourself";
  const t = DB.timers.find(x => x.user_id === id);
  if (t && Date.now() - new Date(t.updated_at || 0).getTime() < LIVE_FRESH_MS) return "studying";
  const halfHourAgo = Date.now() - 30 * 60e3;
  /* The forty newest sessions crew-wide; anybody who logged in the last half
     hour is in there. The database enforces the rule properly in nudge_mate()
     either way — this only decides what the button says before you press it. */
  if (DB.feed.some(s => s.user_id === id &&
      new Date(s.created_at || 0).getTime() > halfHourAgo)) return "recent";
  return null;
}

const NUDGE_BLOCK_TEXT = {
  yourself: "You cannot nudge yourself",
  studying: "They are studying right now",
  recent:   "They logged a session in the last half hour"
};

async function sendNudge(targetId) {
  const btn = $("pf-nudge");
  if (btn) { btn.disabled = true; btn.textContent = "Nudging…"; }
  try {
    const { data, error } = await sb.rpc("nudge_mate", { target: targetId });
    if (error) throw error;
    if (data && data.ok) {
      toast("Nudge sent");
      if (btn) btn.textContent = "Nudged";
      return;
    }
    toast((data && data.reason) || "Could not nudge them");
    if (btn) { btn.disabled = false; btn.textContent = "Nudge"; }
  } catch (e) {
    console.error(e);
    toast("Could not nudge them right now");
    if (btn) { btn.disabled = false; btn.textContent = "Nudge"; }
  }
}

/* ---------- the inbox ---------- */
async function loadPokes() {
  if (!UID || !sb) return;
  try {
    const { data } = await sb.from("nudges")
      .select("id, from_user, created_at")
      .eq("to_user", UID).is("seen_at", null)
      .order("created_at", { ascending: false }).limit(50);
    POKES = data || [];
  } catch (e) { POKES = []; }
  paintPokeBar();
}

/* "Lewis", "Lewis and Sam", "Lewis, Sam and 3 others" */
function pokeNames() {
  const names = [];
  POKES.forEach(n => {
    const p = profileOf(n.from_user);
    const first = String((p && p.display_name) || "Someone").trim().split(/\s+/)[0];
    if (names.indexOf(first) < 0) names.push(first);
  });
  if (names.length === 0) return "Someone";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " and " + names[1];
  const rest = names.length - 2;
  return names[0] + ", " + names[1] + " and " + rest + (rest === 1 ? " other" : " others");
}

function pokeWhen(iso) {
  const t = new Date(iso);
  const time = t.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const day = isoOf(t);
  if (day === todayISO()) return "at " + time;
  if (day === addDays(todayISO(), -1)) return "yesterday at " + time;
  return t.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) + ", " + time;
}

async function dismissPokes() {
  const ids = POKES.map(n => n.id);
  POKES = [];
  paintPokeBar();
  if (!ids.length) return;
  try {
    await sb.from("nudges").update({ seen_at: new Date().toISOString() }).in("id", ids);
  } catch (e) { console.error(e); }
}

/* The inbox loads after the first render, so whichever bar wins has to be
   settled again once it arrives rather than only at render time. */
function reconcileBars() {
  try { paintNudgeBar(); } catch (e) { /* not wired up yet */ }
  try { paintMentionBar(); } catch (e) { /* not wired up yet */ }
}

function paintPokeBar() {
  const bar = $("pokebar");
  if (!bar) return;
  if (!POKES.length) {
    bar.className = "hide"; bar.innerHTML = "";
    reconcileBars();
    return;
  }

  const many = POKES.length > 1;
  bar.className = "";
  bar.innerHTML =
    `<span class="pb-icon" aria-hidden="true">👋</span>
     <div class="pb-text">
       <strong>${esc(pokeNames())} nudged you</strong>
       <span>${many
         ? esc(POKES.length + " nudges, the most recent " + pokeWhen(POKES[0].created_at) + ".")
         : esc(pokeWhen(POKES[0].created_at) + " · they reckon it is about time you got started.")}</span>
     </div>
     <button class="btn sm" id="pb-go">Start a session</button>
     <button class="x" id="pb-hide" title="Dismiss" aria-label="Dismiss">×</button>`;

  reconcileBars();
  $("pb-hide").addEventListener("click", dismissPokes);
  $("pb-go").addEventListener("click", () => {
    dismissPokes();                       /* acting on it counts as reading it */
    const tab = document.querySelector('nav.tabs button[data-p="home"]');
    if (tab) tab.click();
    const start = $("tm-start");
    if (start) { start.scrollIntoView({ block: "center", behavior: "smooth" }); start.focus(); }
  });
}
