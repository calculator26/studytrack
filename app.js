/* =========================================================================
   STUDY CREW
   A shared study tracker. Everyone logs their own subjects, areas and goals;
   everyone can see everyone else. Supabase for auth + data, static hosting.
   ========================================================================= */
"use strict";

const CFG = window.CREW_CONFIG || {};
const MODES = ["Consolidate","Drill","Write to time","Timed paper","Review","Notes","Reading","Other"];
const PALETTE = ["#3E7CA6","#C0564C","#3FA98A","#C9A227","#7A6BB5","#D98C3F","#2B6177","#B0577E"];

let sb = null;
try {
  if (window.supabase && CFG.SUPABASE_URL && !/YOUR-PROJECT/.test(CFG.SUPABASE_URL)) {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }
} catch (e) { console.error(e); }

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
const DB = { profiles: [], subjects: [], areas: [], sessions: [], goals: [], timers: [] };
let CUR = todayISO();
let RANGE = 7;
let localTimer = null, tickHandle = null;

const profileOf = id => DB.profiles.find(p => p.id === id) || {id, display_name:"Unknown", colour:"#7B8D98"};
const mySubjects = uid => DB.subjects.filter(s => s.user_id === uid);
const myAreas    = uid => DB.areas.filter(a => a.user_id === uid);
const areaById   = id => DB.areas.find(a => a.id === id);
const subjById   = id => DB.subjects.find(s => s.id === id);

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
const hoursFor = (uid, day) => DB.sessions
  .filter(s => s.user_id === uid && s.day === day)
  .reduce((a, s) => a + s.minutes / 60, 0);

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
  const ds = DB.sessions.filter(s => s.user_id === uid).map(s => s.day).sort();
  return ds[0] || null;
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
    const all = DB.sessions.map(s => s.day).sort();
    const start = all[0] || t;
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
  $("au-title").textContent = up ? "Join the crew" : (CFG.CREW_NAME || "Study Crew");
  $("au-lede").textContent  = up ? "Make an account so the others can see how you are going."
                                 : "Sign in to see how the crew is going.";
  $("au-go").textContent    = up ? "Create account" : "Sign in";
  $("au-namefield").style.display = up ? "" : "none";
  $("au-swtext").textContent = up ? "Already have an account?" : "No account yet?";
  $("au-switch").textContent = up ? "Sign in" : "Create one";
  $("au-pass").setAttribute("autocomplete", up ? "new-password" : "current-password");
}
$("au-switch").addEventListener("click", () => { authMode = authMode === "up" ? "in" : "up"; authMsg(); paintAuthMode(); });
$("au-go").addEventListener("click", doAuth);
["au-email","au-pass","au-name"].forEach(id =>
  $(id).addEventListener("keydown", e => { if (e.key === "Enter") doAuth(); }));

async function doAuth() {
  const email = $("au-email").value.trim().toLowerCase();
  const pass  = $("au-pass").value;
  const name  = $("au-name").value.trim();
  if (!email || !pass) { authMsg("err", "Email and password are both needed."); return; }
  const allow = CFG.ALLOWED_EMAILS || [];
  if (authMode === "up" && allow.length && !allow.map(x => x.toLowerCase()).includes(email)) {
    authMsg("err", "That email is not on the invite list for this crew."); return;
  }
  $("au-go").disabled = true; authMsg();
  try {
    if (authMode === "up") {
      if (!name) { authMsg("err", "Pick a display name."); $("au-go").disabled = false; return; }
      const { error } = await sb.auth.signUp({ email, password: pass, options: { data: { display_name: name } } });
      if (error) throw error;
      const { error: e2 } = await sb.auth.signInWithPassword({ email, password: pass });
      if (e2) { authMsg("ok", "Account created. Check your email to confirm, then sign in."); authMode = "in"; paintAuthMode(); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
  } catch (err) {
    authMsg("err", err.message || "That did not work.");
  } finally { $("au-go").disabled = false; }
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
    ["au-email","au-pass","au-go","au-switch"].forEach(id => $(id).style.display = "none");
    return;
  }
  paintAuthMode();
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((_e, s) => { if (!s) { show("auth"); } });
})();

async function onSession(session) {
  if (!session) { show("auth"); return; }
  UID = session.user.id;
  show("boot");
  await loadAll();
  ME = DB.profiles.find(p => p.id === UID);
  if (!ME) {
    await sb.from("profiles").insert({ id: UID, display_name: session.user.email.split("@")[0] });
    await loadAll(); ME = DB.profiles.find(p => p.id === UID);
  }
  if (!ME.onboarded) { startOnboarding(); return; }
  show("app");
  subscribeRealtime();
  restoreTimer();
  renderAll();
}

async function loadAll() {
  const [pr, su, ar, se, go, ti] = await Promise.all([
    sb.from("profiles").select("*"),
    sb.from("subjects").select("*").order("position"),
    sb.from("areas").select("*").order("position"),
    sb.from("sessions").select("*").order("day", { ascending: false }).limit(20000),
    sb.from("goals").select("*"),
    sb.from("live_timers").select("*")
  ]);
  DB.profiles = pr.data || []; DB.subjects = su.data || []; DB.areas = ar.data || [];
  DB.sessions = se.data || []; DB.goals = go.data || []; DB.timers = ti.data || [];
  DB.profiles.forEach(p => {
    if (typeof p.weekday_goals === "string") { try { p.weekday_goals = JSON.parse(p.weekday_goals); } catch (e) { p.weekday_goals = null; } }
  });
}
let refreshing = false;
async function refresh(rerender) {
  if (refreshing) return; refreshing = true;
  try { await loadAll(); ME = DB.profiles.find(p => p.id === UID) || ME; if (rerender !== false) renderAll(); }
  finally { refreshing = false; }
}
function subscribeRealtime() {
  try {
    sb.channel("crew")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions"    }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "live_timers" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles"    }, () => refresh())
      .subscribe();
  } catch (e) { /* realtime is a bonus, not a requirement */ }
  setInterval(() => refresh(), 90000);
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
  $("ob-colour").value = ME.colour || "#2FCFA6";
  $("ob-avpreview").textContent = initials(ME.display_name);
  $("ob-avpreview").style.background = ME.colour || "#2FCFA6";
  $("ob-quick").innerHTML = `<div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px">
      Tap your subjects. Each one arrives with its 2026 exam date and its course sections already in it.</div>
    <button class="btn" id="ob-openpicker" style="margin-bottom:4px">Choose from the Knox subject list</button>
    <div style="font-size:11.5px;color:var(--ink-soft);margin-top:7px">Not on the list, or Knox calls it something else? Type it in below instead.</div>`;
  $("ob-openpicker").addEventListener("click", () => openPicker({
    taken: () => obSubjects.map(s => s.name),
    pick: c => { addObSubject(c.name, c.exam_date, c.colour, c.areas.slice()); }
  }));
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
    let avatar_url = ME.avatar_url || null;
    if (obAvatarFile) avatar_url = await uploadAvatar(obAvatarFile);
    const wk = DOW.map((_, i) => Number($("obwk" + i).value));
    await sb.from("profiles").update({
      display_name: $("ob-name").value.trim(),
      school: $("ob-school").value.trim() || null,
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
}));
$("rangechips").querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => {
  $("rangechips").querySelectorAll("[data-r]").forEach(x => x.setAttribute("aria-pressed", "false"));
  b.setAttribute("aria-pressed", "true"); RANGE = +b.dataset.r; renderCrew();
}));

/* =========================================================================
   SELECTS  (subject / area pickers built from the signed-in user's own data)
   ========================================================================= */
function areaOptions() {
  const subs = mySubjects(UID);
  if (!subs.length) return `<option value="">Add a subject in Setup first</option>`;
  return subs.map(s => {
    const as = myAreas(UID).filter(a => a.subject_id === s.id);
    return `<optgroup label="${esc(s.name)}">
      <option value="s:${s.id}">${esc(s.name)} — general</option>
      ${as.map(a => `<option value="a:${a.id}">${esc(a.name)}</option>`).join("")}
    </optgroup>`;
  }).join("");
}
function paintSelects() {
  const html = areaOptions();
  ["f-area","tm-area","ms-area"].forEach(id => { const v = $(id).value; $(id).innerHTML = html; if (v) $(id).value = v; });
  const m = MODES.map(x => `<option>${x}</option>`).join("");
  ["f-mode","tm-mode","ms-mode"].forEach(id => { if (!$(id).innerHTML) $(id).innerHTML = m; });
}
function splitTarget(v) {
  if (!v) return { subject_id: null, area_id: null };
  if (v.startsWith("a:")) { const a = areaById(v.slice(2)); return { subject_id: a ? a.subject_id : null, area_id: a ? a.id : null }; }
  return { subject_id: v.slice(2), area_id: null };
}
function labelOf(s) {
  if (s.area_id) { const a = areaById(s.area_id); if (a) return a.name; }
  if (s.subject_id) { const x = subjById(s.subject_id); if (x) return x.name; }
  return "Study";
}
function colourOf(s) {
  const sub = s.subject_id ? subjById(s.subject_id) : null;
  return (sub && sub.colour) || "#7B8D98";
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
  document.title = (t && t.running ? "▶ " + hms(elapsedMs()).slice(0, 5) + " — " : "") + (CFG.CREW_NAME || "Study Crew");
  paintLive();
}
function startTick() { if (tickHandle) clearInterval(tickHandle); tickHandle = setInterval(paintTimer, 1000); }
function restoreTimer() {
  const row = DB.timers.find(t => t.user_id === UID);
  if (row) { localTimer = row; if (row.running) startTick(); }
  paintTimer();
}
async function pushTimer() {
  if (!localTimer) { await sb.from("live_timers").delete().eq("user_id", UID); }
  else {
    await sb.from("live_timers").upsert({
      user_id: UID, label: localTimer.label, subject_id: localTimer.subject_id, area_id: localTimer.area_id,
      started_at: localTimer.started_at, acc_ms: localTimer.acc_ms, running: localTimer.running,
      updated_at: new Date().toISOString()
    });
  }
}
$("tm-start").addEventListener("click", async () => {
  if (localTimer) { localTimer.running = true; localTimer.started_at = new Date().toISOString(); }
  else {
    const v = $("tm-area").value;
    if (!v) { toast("Add a subject in Setup first"); return; }
    const t = splitTarget(v);
    const opt = $("tm-area").selectedOptions[0];
    localTimer = { label: (opt ? opt.textContent.trim() : "Study") + " · " + $("tm-mode").value,
      subject_id: t.subject_id, area_id: t.area_id, acc_ms: 0,
      started_at: new Date().toISOString(), running: true, mode: $("tm-mode").value, day: CUR };
  }
  paintTimer(); startTick(); pushTimer();
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
  $("ms-area").innerHTML = areaOptions();
  $("ms-area").value = localTimer.area_id ? "a:" + localTimer.area_id : (localTimer.subject_id ? "s:" + localTimer.subject_id : "");
  $("ms-mode").value = localTimer.mode || MODES[0];
  $("ms-min").value = mins;
  $("ms-note").value = "";
  $("ms-sub").textContent = hms(elapsedMs()) + " on " + fmtLong(localTimer.day || CUR);
  $("ov-save").classList.add("on");
  setTimeout(() => $("ms-note").focus(), 60);
});
$("ms-discard").addEventListener("click", async () => {
  if (!confirm("Discard this session without logging it?")) return;
  localTimer = null; await pushTimer(); $("ov-save").classList.remove("on"); paintTimer();
});
$("ms-save").addEventListener("click", async () => {
  const t = splitTarget($("ms-area").value);
  const day = (localTimer && localTimer.day) || CUR;
  await addSession(day, t, $("ms-mode").value, +$("ms-min").value, $("ms-note").value.trim());
  localTimer = null; await pushTimer();
  $("ov-save").classList.remove("on"); paintTimer();
});

async function addSession(day, target, mode, minutes, note) {
  if (!minutes || minutes < 1) { toast("Minutes needs to be at least 1"); return; }
  const { error } = await sb.from("sessions").insert({
    user_id: UID, subject_id: target.subject_id, area_id: target.area_id,
    day, minutes, mode, note: note || null });
  if (error) { toast("Could not save: " + error.message); return; }
  toast("Logged " + f1(minutes / 60) + " h");
  await refresh();
}

/* ---------- manual add ---------- */
document.querySelectorAll("[data-min]").forEach(b => b.addEventListener("click", () => $("f-min").value = b.dataset.min));
$("f-add").addEventListener("click", async () => {
  const v = $("f-area").value; if (!v) { toast("Add a subject in Setup first"); return; }
  await addSession(CUR, splitTarget(v), $("f-mode").value, +$("f-min").value, $("f-note").value.trim());
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
  $("footnote").textContent =
    `${DB.profiles.length} member${DB.profiles.length === 1 ? "" : "s"} · ` +
    `${DB.sessions.length} sessions logged between everyone · ` +
    `${f1(DB.sessions.reduce((a, s) => a + s.minutes / 60, 0))} hours in total.`;
}
function renderShell() {
  $("crewname").textContent = CFG.CREW_NAME || "Study Crew";
  const total = DB.sessions.reduce((a, s) => a + s.minutes / 60, 0);
  $("crewsub").textContent = `${DB.profiles.length} members · ${f1(total)} hours logged together`;
  $("me-av").outerHTML = avatarHTML(ME, "lg").replace('class="av lg"', 'class="av lg" id="me-av"');
  $("me-name").textContent = ME.display_name;
  const board = leaderboard(7);
  const i = board.findIndex(r => r.id === UID);
  $("me-rank").textContent = i >= 0 ? `#${i + 1} of ${board.length} this week` : "—";
}

/* =========================================================================
   RENDER — home
   ========================================================================= */
function paintLive() {
  const now = Date.now();
  const rows = DB.timers.filter(t => t.user_id !== UID)
    .filter(t => now - new Date(t.updated_at).getTime() < 8 * 3600e3);
  const mine = localTimer ? [{ ...localTimer, user_id: UID }] : [];
  const all = mine.concat(rows);
  const box = $("livestrip");
  if (!box) return;
  if (!all.length) { box.innerHTML = `<div class="empty" style="width:100%">Nobody is running a timer right now. Be the one who starts.</div>`; return; }
  box.innerHTML = all.map(t => {
    const p = profileOf(t.user_id);
    const ms = t.acc_ms + (t.running ? now - new Date(t.started_at).getTime() : 0);
    return `<div class="livecard ${t.user_id === UID ? "self" : ""}">
      ${avatarHTML(p, "")}
      <div style="min-width:0">
        <div class="t">${hms(ms)}${t.running ? "" : ' <span style="font-size:11px;color:var(--ink-soft);font-weight:500">paused</span>'}</div>
        <div class="s">${esc(p.display_name)} · ${esc(t.label || "studying")}</div>
      </div>
      ${t.running ? '<div class="dot" style="margin-left:auto"></div>' : ""}
    </div>`;
  }).join("");
}

function renderHome() {
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
  wireDeletes($("h-entries"));

  $("k-today").textContent = f1(h);
  $("k-today").style.color = col === "var(--none)" ? "var(--ink)" : col;
  $("k-today-d").textContent = g > 0 ? (h >= g ? "Goal met" : f1(g - h) + " short of " + f1(g)) : "Rest day";

  const dayBoard = DB.profiles.map(p => ({ id: p.id, h: hoursFor(p.id, CUR) })).sort((a, b) => b.h - a.h);
  const idx = dayBoard.findIndex(x => x.id === UID);
  $("k-rank").textContent = idx >= 0 ? "#" + (idx + 1) : "—";
  const above = idx > 0 ? dayBoard[idx - 1] : null;
  $("k-rank-d").textContent = above
    ? `${f1(above.h - dayBoard[idx].h)} h behind ${profileOf(above.id).display_name}`
    : (idx === 0 ? "Top of the crew today" : "—");

  const st = streakFor(UID);
  $("k-streak").textContent = st;
  $("k-streak").style.color = st > 0 ? "var(--good)" : "var(--ink)";
  $("k-streak-d").textContent = "Longest " + longestStreakFor(UID);

  let wk = 0, wkg = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(todayISO(), -i); wk += hoursFor(UID, d); wkg += goalFor(UID, d); }
  $("k-week").textContent = f1(wk);
  $("k-week-d").textContent = `Against ${f1(wkg)} of goals`;

  const rows = DB.profiles.map(p => ({ p, h: hoursFor(p.id, CUR), g: goalFor(p.id, CUR) })).sort((a, b) => b.h - a.h);
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
function entryHTML(s, withWho) {
  const p = profileOf(s.user_id);
  return `<div class="entry"><div class="top">
    <div>${withWho ? `<span style="color:var(--ink-soft);font-size:11.5px">${esc(p.display_name)} · </span>` : ""}
      <strong style="color:${colourOf(s)}">${esc(labelOf(s))}</strong>
      <span style="color:var(--ink-soft);font-size:11.5px"> · ${esc(s.mode || "")}${withWho ? " · " + fmtD(s.day) : ""}</span></div>
    <div style="text-align:right;font-weight:600">${f1(s.minutes / 60)} h</div>
    ${s.user_id === UID ? `<button class="x" data-del="${s.id}" title="Remove">×</button>` : "<span></span>"}
  </div>${s.note ? `<div class="enote">${esc(s.note)}</div>` : ""}</div>`;
}
function wireDeletes(scope) {
  scope.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    await sb.from("sessions").delete().eq("id", b.dataset.del); await refresh();
  }));
}

/* =========================================================================
   RENDER — crew
   ========================================================================= */
function leaderboard(rangeOverride) {
  const days = rangeOverride ? (() => { const o = []; for (let i = rangeOverride - 1; i >= 0; i--) o.push(addDays(todayISO(), -i)); return o; })() : rangeDays();
  const set = new Set(days);
  return DB.profiles.map(p => {
    const ss = DB.sessions.filter(s => s.user_id === p.id && set.has(s.day));
    const hours = ss.reduce((a, s) => a + s.minutes / 60, 0);
    const perDay = {}; days.forEach(d => perDay[d] = 0);
    ss.forEach(s => perDay[s.day] += s.minutes / 60);
    const active = days.filter(d => perDay[d] > 0).length;
    const withGoal = days.filter(d => goalFor(p.id, d) > 0);
    const hit = withGoal.filter(d => perDay[d] >= goalFor(p.id, d)).length;
    return { id: p.id, p, hours, sessions: ss.length, days,
      perDay, active, best: Math.max(0, ...days.map(d => perDay[d])),
      goalHit: withGoal.length ? hit / withGoal.length : null,
      streak: streakFor(p.id) };
  }).sort((a, b) => b.hours - a.hours);
}

function renderCrew() {
  const board = leaderboard();
  const days = rangeDays();
  $("lb-sub").textContent = RANGE === 0
    ? `All time — ${days.length} days of records`
    : (RANGE === 1 ? "Today only" : `The last ${RANGE} days`);

  /* podium */
  const top = board.slice(0, 3);
  const order = [1, 0, 2];
  $("podium").innerHTML = order.map(i => {
    const r = top[i]; if (!r) return `<div></div>`;
    return `<div class="pod p${i + 1}">
      <div class="rank">#${i + 1}</div>
      ${avatarHTML(r.p, i === 0 ? "xl" : "lg")}
      <div class="hrs">${f1(r.hours)}<span style="font-size:13px;font-weight:500;color:var(--ink-soft)"> h</span></div>
      <div class="nm2">${esc(r.p.display_name)}</div>
      <div class="sub2">${r.sessions} session${r.sessions === 1 ? "" : "s"} · best day ${f1(r.best)} h</div>
    </div>`;
  }).join("");

  /* table */
  const last7 = (() => { const o = []; for (let i = 6; i >= 0; i--) o.push(addDays(todayISO(), -i)); return o; })();
  $("lbtbl").querySelector("tbody").innerHTML = board.map((r, i) => {
    const spark = last7.map(d => hoursFor(r.id, d));
    const mx = Math.max(1, ...spark);
    const bars = spark.map((v, j) =>
      `<rect x="${j * 13}" y="${22 - (v / mx) * 22}" width="9" height="${Math.max(1, (v / mx) * 22)}" rx="1.5"
        fill="${lvlColour(goalFor(r.id, last7[j]) > 0 ? v / goalFor(r.id, last7[j]) : (v > 0 ? 1 : null), v > 0)}"/>`).join("");
    const medal = i === 0 ? "var(--gold)" : i === 1 ? "var(--silver)" : i === 2 ? "var(--bronze)" : "var(--ink-soft)";
    return `<tr class="${r.id === UID ? "me" : ""}">
      <td class="l" style="font-weight:700;color:${medal}">${i + 1}</td>
      <td class="l"><div class="who">${avatarHTML(r.p, "sm")}<span class="nm">${esc(r.p.display_name)}</span></div></td>
      <td style="font-weight:700">${f1(r.hours)}</td>
      <td>${r.sessions}</td>
      <td>${f1(r.hours / Math.max(1, days.length))}</td>
      <td>${f1(r.best)}</td>
      <td>${r.goalHit === null ? "—" : `<span class="pill" style="background:${lvlColour(r.goalHit, true)}">${f0(r.goalHit * 100)}%</span>`}</td>
      <td style="font-weight:600;color:${r.streak > 0 ? "var(--good)" : "var(--ink-soft)"}">${r.streak}</td>
      <td class="l"><svg width="92" height="24" viewBox="0 0 92 24">${bars}</svg></td>
    </tr>`;
  }).join("");

  drawRace(board, days);
  drawStack(board, days);

  /* head to head */
  const opts = DB.profiles.map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join("");
  if (!$("h2h-a").dataset.built) {
    $("h2h-a").innerHTML = opts; $("h2h-b").innerHTML = opts;
    $("h2h-a").value = UID;
    const other = DB.profiles.find(p => p.id !== UID);
    if (other) $("h2h-b").value = other.id;
    $("h2h-a").dataset.built = "1";
    $("h2h-a").addEventListener("change", () => drawH2H());
    $("h2h-b").addEventListener("change", () => drawH2H());
  }
  drawH2H();

  /* feed */
  const feed = DB.sessions.slice().sort((a, b) => (b.created_at || "") < (a.created_at || "") ? -1 : 1).slice(0, 40);
  $("feed").innerHTML = feed.length
    ? feed.map(s => `<div style="padding:0 16px">${entryHTML(s, true)}</div>`).join("")
    : `<div class="empty" style="margin:18px">Nothing logged yet by anyone.</div>`;
  wireDeletes($("feed"));
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

function drawH2H() {
  const a = $("h2h-a").value, b = $("h2h-b").value;
  if (!a || !b) { $("h2h").innerHTML = `<div class="empty">Not enough members yet.</div>`; return; }
  const days = rangeDays(), set = new Set(days);
  const stat = uid => {
    const ss = DB.sessions.filter(s => s.user_id === uid && set.has(s.day));
    const hours = ss.reduce((x, s) => x + s.minutes / 60, 0);
    const per = {}; days.forEach(d => per[d] = 0); ss.forEach(s => per[s.day] += s.minutes / 60);
    const withGoal = days.filter(d => goalFor(uid, d) > 0);
    const hit = withGoal.filter(d => per[d] >= goalFor(uid, d)).length;
    const bySub = {};
    ss.forEach(s => { const n = s.subject_id ? (subjById(s.subject_id) || {}).name || "Other" : "Other";
      bySub[n] = (bySub[n] || 0) + s.minutes / 60; });
    return { p: profileOf(uid), hours, sessions: ss.length, active: days.filter(d => per[d] > 0).length,
      best: Math.max(0, ...days.map(d => per[d])), streak: streakFor(uid),
      goalHit: withGoal.length ? hit / withGoal.length : null, bySub };
  };
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
    ${row("Hours in range", A.hours, B.hours)}
    ${row("Sessions", A.sessions, B.sessions, f0)}
    ${row("Days active", A.active, B.active, f0)}
    ${row("Longest day", A.best, B.best)}
    ${row("Current streak", A.streak, B.streak, f0)}
    ${row("Goal hit rate", A.goalHit || 0, B.goalHit || 0, x => f0(x * 100) + "%")}
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
  wireDeletes($("m-log"));
}

/* =========================================================================
   RENDER — setup
   ========================================================================= */
function renderSetup() {
  $("s-name").value = ME.display_name || "";
  $("s-school").value = ME.school || "";
  $("s-colour").value = ME.colour || "#2FCFA6";
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
    school: $("s-school").value.trim() || null, colour: $("s-colour").value }).eq("id", UID);
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
      return `<div class="itemrow" style="grid-template-columns:auto 1fr auto;gap:10px;align-items:center">
        <span class="swatch" style="background:${esc(s.colour)}"></span>
        <div>
          <strong>${esc(s.name)}</strong>
          <span style="font-size:11.5px;color:var(--ink-soft)"> · ${s.units} unit${s.units === 1 ? "" : "s"}</span>
          <div style="font-size:11.5px;color:var(--ink-soft)">
            ${esc(when)} · ${s.areas.length} section${s.areas.length === 1 ? "" : "s"}${s.note ? " · " + esc(s.note) : ""}</div>
        </div>
        <button class="btn ${already ? "ghost" : ""} sm" data-pkadd="${esc(s.name)}" ${already ? "disabled" : ""}
          style="${already ? "opacity:.5" : ""}">${already ? "Added" : "Add"}</button>
      </div>`;
    }).join("")}`).join("");

  $("pk-list").querySelectorAll("[data-pkadd]").forEach(b => b.addEventListener("click", async () => {
    const c = CAT.byName(b.dataset.pkadd);
    if (!c) return;
    b.disabled = true;
    try { await pkHandlers.pick(c); } finally { paintPicker(); }
  }));
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
