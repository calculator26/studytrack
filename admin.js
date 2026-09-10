/* =========================================================================
   STUDY TRACK — ADMIN CONSOLE
   -------------------------------------------------------------------------
   Moderation for the crew: read everything, correct or remove anything,
   and leave a record of having done it.

   WHERE THE SECURITY ACTUALLY IS
   ------------------------------
   Not in this file. Everything here runs in the browser, so treat every
   check below as cosmetic — anyone determined enough can call openAdmin()
   from the console and watch it paint. What stops them is schema.sql:

     * public.is_admin() reads auth.users, which the browser cannot forge.
     * The update/delete policies on every table allow a write only when
       the row is yours OR is_admin() is true.
     * admin_delete_user() re-checks is_admin() inside the function.

   So a non-admin who forces this panel open gets a working-looking screen
   whose every button quietly changes nothing. That is the intended
   failure mode. The gate here exists to keep the door out of sight, not
   to hold it shut.

   Reads are a different matter and worth being honest about: every signed
   in member can already read the whole database — that is what the crew
   view is. The console shows nothing that was ever private.
   ========================================================================= */

let IS_ADMIN = false;
const ADM = {
  open:false,
  tab:"overview",
  q:"",                       /* session search */
  who:"",                     /* session owner filter */
  from:"", to:"",             /* session date filter */
  sel:new Set(),              /* bulk selection of session ids */
  audit:[],
  auditLoaded:false
};

/* Ask the database, not the browser, whether this person is an admin.
   A failure here — the function missing because schema.sql has not been
   re-run — is not an error worth showing anyone: it just means no console. */
async function adminBoot() {
  IS_ADMIN = false;
  try {
    const { data, error } = await sb.rpc("is_admin");
    if (!error && data === true) IS_ADMIN = true;
  } catch (e) { /* older project, no function, no console */ }
  const row = $("s-adminrow");
  if (row) row.hidden = !IS_ADMIN;
  return IS_ADMIN;
}

/* ---------------------------------------------------------------- helpers */
const admPct = (n, d) => d > 0 ? Math.round(n / d * 100) : 0;
const admShort = s => s ? String(s).slice(0, 8) : "—";
function admAvatar(p) {
  const c = (p && p.colour) || "#68738B";
  if (p && p.avatar_url) return `<span class="adm-av"><img src="${esc(p.avatar_url)}" alt=""></span>`;
  return `<span class="adm-av" style="background:${esc(c)}">${esc(initials(p && p.display_name))}</span>`;
}
function admWho(id) {
  const p = profileOf(id);
  return `<span class="adm-who">${admAvatar(p)}<span class="nm">${esc(p.display_name)}</span></span>`;
}
const admSessions = uid => DB.sessions.filter(s => s.user_id === uid);
const admHours = list => list.reduce((a, s) => a + s.minutes / 60, 0);
function admLastActive(uid) {
  const days = admSessions(uid).map(s => s.day).sort();
  return days.length ? days[days.length - 1] : null;
}
function admJoined(p) { return p.created_at ? String(p.created_at).slice(0, 10) : null; }

/* ------------------------------------------------------------- audit trail
   Written before the change, so a row exists even if the write then fails.
   The table has no update or delete policy: an admin can remove a member's
   session but cannot remove the record of having removed it. RLS with no
   policy for a command matches no rows, so an attempt to tamper does not
   error — it simply changes nothing. */
async function admLog(action, targetUser, targetName, summary, snapshot) {
  try {
    await sb.from("admin_audit").insert({
      actor_id: UID,
      actor_name: (ME && ME.display_name) || null,
      action, target_user: targetUser || null, target_name: targetName || null,
      summary: summary || null, snapshot: snapshot || null
    });
    ADM.auditLoaded = false;
  } catch (e) { /* never let logging block the moderation itself */ }
}
async function admLoadAudit() {
  try {
    const { data, error } = await sb.from("admin_audit")
      .select("*").order("created_at", { ascending: false }).limit(300);
    if (!error) { ADM.audit = data || []; ADM.auditLoaded = true; }
  } catch (e) { ADM.audit = []; }
}

/* ============================================================== INTEGRITY
   The point of the console. Every rule below is a *signal*, never a verdict
   — a long session on a Saturday before trials is completely normal, and the
   console says so rather than accusing anyone. Nothing is auto-removed. */
const ADM_RULES = {
  marathon:  { level:"warn",     icon:"◷", label:"Long session",
               why:"One unbroken block over 6 hours." },
  impossible:{ level:"critical", icon:"▲", label:"Impossible day",
               why:"More than 16 hours logged across a single day." },
  future:    { level:"critical", icon:"▲", label:"Future date",
               why:"Dated after today — usually a typo, occasionally not." },
  prejoin:   { level:"serious",  icon:"◆", label:"Before joining",
               why:"Dated before this member's account existed." },
  duplicate: { level:"serious",  icon:"❐", label:"Exact duplicate",
               why:"Same member, day, subject and length as another entry." },
  stale:     { level:"warn",     icon:"◷", label:"Timer left running",
               why:"A live timer has been going for more than 8 hours." }
};

function admFlags() {
  const out = [];
  const today = todayISO();
  const byDay = {};       /* uid|day -> minutes */
  const seen  = {};       /* uid|day|subject|minutes -> first id */

  DB.sessions.forEach(s => {
    const p = profileOf(s.user_id);
    const push = (rule, detail) => out.push({ rule, detail, session:s, user_id:s.user_id });

    if (s.minutes > 360) push("marathon", f1(s.minutes / 60) + " hours in one block");
    if (s.day > today)   push("future", "dated " + fmtD(s.day));

    const joined = admJoined(p);
    if (joined && s.day < joined) push("prejoin", "dated " + fmtD(s.day) + ", joined " + fmtD(joined));

    const dk = s.user_id + "|" + s.day;
    byDay[dk] = (byDay[dk] || 0) + s.minutes;

    const sk = [s.user_id, s.day, s.subject_id || "-", s.area_id || "-", s.minutes].join("|");
    if (seen[sk]) push("duplicate", "matches another entry on " + fmtD(s.day));
    else seen[sk] = s.id;
  });

  Object.keys(byDay).forEach(k => {
    if (byDay[k] <= 960) return;
    const [uid, day] = k.split("|");
    const worst = DB.sessions
      .filter(s => s.user_id === uid && s.day === day)
      .sort((a, b) => b.minutes - a.minutes)[0];
    if (worst) out.push({ rule:"impossible", user_id:uid, session:worst,
      detail:f1(byDay[k] / 60) + " hours total on " + fmtD(day) });
  });

  (DB.timers || []).forEach(t => {
    const ms = (t.acc_ms || 0) + (t.running ? Date.now() - new Date(t.started_at).getTime() : 0);
    if (ms > 8 * 3600e3) out.push({ rule:"stale", user_id:t.user_id, timer:t,
      detail:"running " + f1(ms / 3600e3) + " hours" });
  });

  const order = { critical:0, serious:1, warn:2 };
  return out.sort((a, b) =>
    order[ADM_RULES[a.rule].level] - order[ADM_RULES[b.rule].level] ||
    ((b.session && b.session.day) || "").localeCompare((a.session && a.session.day) || ""));
}
function admFlagPill(rule) {
  const r = ADM_RULES[rule];
  const cls = r.level === "warn" ? "warn" : r.level;
  return `<span class="adm-flag ${cls}" title="${esc(r.why)}"><i class="fi">${r.icon}</i>${esc(r.label)}</span>`;
}

/* ================================================================== SHELL */
function openAdmin() {
  if (!IS_ADMIN) { toast("The console is for administrators"); return; }
  ADM.open = true;
  $("adm").hidden = false;
  document.body.style.overflow = "hidden";
  renderAdmin();
}
function closeAdmin() {
  ADM.open = false;
  $("adm").hidden = true;
  document.body.style.overflow = "";
}
function admGo(tab) { ADM.tab = tab; ADM.sel.clear(); renderAdmin(); }

/* every write goes through here so the panel and the app agree afterwards */
async function admAfterWrite() {
  await refresh();
  if (typeof openProfileId !== "undefined" && openProfileId &&
      $("ov-profile").classList.contains("on")) openProfile(openProfileId);
  if (ADM.open) renderAdmin();
}

const ADM_TABS = [
  ["overview",  "◎", "Overview"],
  ["members",   "☗", "Members"],
  ["sessions",  "▤", "Sessions"],
  ["integrity", "⚑", "Integrity"],
  ["audit",     "⎘", "Audit log"]
];

function renderAdmin() {
  if (!ADM.open) return;
  const flags = admFlags();

  $("adm-rail").innerHTML =
    `<div class="adm-navlabel">Console</div>` +
    ADM_TABS.map(([id, ic, label]) => {
      const n = id === "members" ? DB.profiles.length
              : id === "sessions" ? DB.sessions.length
              : id === "integrity" ? flags.length
              : id === "audit" ? (ADM.audit.length || "") : "";
      return `<button class="adm-nav" data-admtab="${id}" aria-current="${ADM.tab === id}">
        <span class="ic">${ic}</span>${esc(label)}
        ${n !== "" ? `<span class="ct">${n}</span>` : ""}</button>`;
    }).join("") +
    `<div class="adm-railfoot">Signed in as <strong style="color:var(--a-ink)">${esc((ME && ME.display_name) || "admin")}</strong>.
      Every removal is written to the audit log, which nobody can edit.</div>`;

  $("adm-live").innerHTML =
    `<span class="adm-dot"></span><span class="adm-livetext">PRIVILEGED SESSION</span>` +
    (flags.length ? `<span class="adm-livetext"> · </span>
       <span style="color:var(--a-critical)" title="${flags.length} flagged entries">${flags.length} flagged</span>` : ``);

  const body = $("adm-body");
  if (ADM.tab === "overview")  body.innerHTML = admOverview(flags);
  if (ADM.tab === "members")   body.innerHTML = admMembers();
  if (ADM.tab === "sessions")  body.innerHTML = admSessionsView();
  if (ADM.tab === "integrity") body.innerHTML = admIntegrity(flags);
  if (ADM.tab === "audit")     body.innerHTML = admAudit();

  admWire();
}

/* =============================================================== OVERVIEW */
function admOverview(flags) {
  const today = todayISO();
  const totalH = admHours(DB.sessions);
  const todayH = DB.sessions.filter(s => s.day === today).reduce((a, s) => a + s.minutes / 60, 0);
  const wk = []; for (let i = 13; i >= 0; i--) wk.push(addDays(today, -i));
  const perDay = wk.map(d => DB.sessions.filter(s => s.day === d).reduce((a, s) => a + s.minutes / 60, 0));
  const live = (DB.timers || []).filter(t => t.running).length;
  const crit = flags.filter(f => ADM_RULES[f.rule].level === "critical").length;
  const notOnboarded = DB.profiles.filter(p => !p.onboarded).length;

  return `
  <div class="adm-h"><div>
    <h2>Overview</h2>
    <p>The whole crew at a glance. Anything that needs a decision is surfaced under Integrity —
       nothing here is ever removed automatically.</p>
  </div></div>

  <div class="adm-tiles">
    <div class="adm-tile"><div class="v">${DB.profiles.length}</div><div class="k">Members</div>
      <div class="d">${notOnboarded ? notOnboarded + " mid-setup" : "all set up"}</div></div>
    <div class="adm-tile"><div class="v">${DB.sessions.length}</div><div class="k">Sessions logged</div>
      <div class="d">${f1(totalH)} hours all up</div></div>
    <div class="adm-tile"><div class="v">${f1(todayH)}</div><div class="k">Hours logged today</div>
      <div class="d">${DB.sessions.filter(s => s.day === today).length} sessions</div></div>
    <div class="adm-tile"><div class="v">${live}</div><div class="k">Timers running now</div>
      <div class="d">${live ? "live on the crew strip" : "nobody studying"}</div></div>
    <div class="adm-tile ${crit ? "alert" : ""}"><div class="v">${flags.length}</div><div class="k">Flagged entries</div>
      <div class="d">${crit ? crit + " critical" : "nothing critical"}</div></div>
  </div>

  <div class="adm-card">
    <header><div><h3>Crew output, last 14 days</h3>
      <div class="sub">Total hours logged per day by everyone</div></div></header>
    <div class="pad adm-scroll">${admBars(wk, perDay)}</div>
  </div>

  <div class="adm-card">
    <header><div><h3>Most recent activity</h3>
      <div class="sub">The last ten sessions logged by anyone</div></div>
      <button class="adm-btn sm" data-admtab="sessions" style="margin-left:auto">See all sessions</button></header>
    <div class="adm-scroll"><table class="adm-t">
      <thead><tr><th class="l">Member</th><th class="l">Worked on</th><th class="l">Day</th>
        <th>Hours</th><th class="l">Note</th></tr></thead>
      <tbody>${DB.sessions.slice()
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 10).map(s => `<tr>
          <td class="l">${admWho(s.user_id)}</td>
          <td class="l">${esc(labelOf(s))}</td>
          <td class="l adm-mono">${esc(s.day)}</td>
          <td>${f1(s.minutes / 60)}</td>
          <td class="l"><div class="adm-note">${esc(s.note || "—")}</div></td>
        </tr>`).join("") || `<tr><td colspan="5" class="l" style="color:var(--a-ink-soft)">Nothing logged yet.</td></tr>`}
      </tbody></table></div>
  </div>`;
}

/* A single series of magnitude over time: one hue, bars, no legend needed —
   the heading names the series. Values are labelled on hover rather than
   printed on every bar. */
function admBars(days, vals) {
  const W = 760, H = 190, ml = 34, mr = 8, mt = 12, mb = 26;
  const iw = W - ml - mr, ih = H - mt - mb;
  const max = Math.max(1, ...vals);
  const slot = iw / days.length;
  /* Thin marks: the bar never grows past 22px however wide the card gets, and
     it keeps a 2px gap from its neighbour on either side. */
  const bw = Math.min(22, slot - 6);
  const ticks = 3;
  let g = "";
  for (let i = 0; i <= ticks; i++) {
    const v = max * i / ticks, y = mt + ih - (v / max) * ih;
    g += `<line class="grid" x1="${ml}" x2="${ml + iw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>
          <text class="axis" x="${ml - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${f0(v)}</text>`;
  }
  const bars = days.map((d, i) => {
    const v = vals[i];
    const h = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
    const x = ml + i * slot + (slot - bw) / 2, y = mt + ih - h;
    /* 4px rounded end, anchored to the baseline; hover names the day and value */
    return `<g class="adm-bararea"><rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
      width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4"
      fill="var(--a-data)"><title>${esc(fmtD(d))} — ${f1(v)} hours</title></rect></g>`;
  }).join("");
  const labels = days.map((d, i) =>
    (i % 3 === 0 || i === days.length - 1)
      ? `<text class="axis" x="${(ml + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(d.slice(8))}/${esc(d.slice(5,7))}</text>`
      : "").join("");
  return `<svg class="adm-chart" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Total crew hours per day over the last 14 days">${g}${bars}${labels}</svg>`;
}

/* ================================================================ MEMBERS */
function admMembers() {
  const rows = DB.profiles.slice().sort((a, b) =>
    admHours(admSessions(b.id)) - admHours(admSessions(a.id)));

  return `
  <div class="adm-h"><div>
    <h2>Members</h2>
    <p>Everyone with an account. Editing a profile here changes how that person appears to the
       whole crew — their own copy updates the moment they refresh.</p>
  </div></div>

  <div class="adm-warnbox"><strong>Removing an account is final.</strong>
    It deletes their login and cascades through every session, subject, area and goal they own.
    There is no undo and no export first. Clearing sessions is the softer option, and keeps the
    account.</div>

  <div class="adm-card"><div class="adm-scroll"><table class="adm-t">
    <thead><tr>
      <th class="l">Member</th><th class="l">School</th><th class="l">Joined</th>
      <th>Sessions</th><th>Hours</th><th>Streak</th><th class="l">Last active</th>
      <th class="l">State</th><th></th>
    </tr></thead>
    <tbody>${rows.map(p => {
      const ss = admSessions(p.id);
      const last = admLastActive(p.id);
      const stale = last && last < addDays(todayISO(), -14);
      return `<tr>
        <td class="l">${admWho(p.id)}</td>
        <td class="l" style="color:var(--a-ink-mid)">${esc(p.school || "—")}</td>
        <td class="l adm-mono">${esc(admJoined(p) || "—")}</td>
        <td>${ss.length}</td>
        <td style="font-weight:650">${f1(admHours(ss))}</td>
        <td>${streakFor(p.id)}</td>
        <td class="l adm-mono">${last ? esc(last) : "never"}</td>
        <td class="l">${
          !p.onboarded ? `<span class="adm-flag warn"><i class="fi">◷</i>Mid-setup</span>`
          : stale ? `<span class="adm-flag mute"><i class="fi">○</i>Quiet</span>`
          : `<span class="adm-flag good"><i class="fi">●</i>Active</span>`}
          ${p.id === UID ? `<span class="adm-flag mute" style="margin-left:5px">You</span>` : ""}</td>
        <td><div class="adm-act">
          <button class="adm-btn sm" data-admprofile="${esc(p.id)}">View</button>
          <button class="adm-btn sm" data-admedituser="${esc(p.id)}">Edit</button>
          <button class="adm-btn sm danger" data-admwipe="${esc(p.id)}"
            ${ss.length ? "" : "disabled"}>Clear sessions</button>
          <button class="adm-btn sm danger" data-admkill="${esc(p.id)}"
            ${p.id === UID ? "disabled title='Remove your own account from Setup instead'" : ""}>Delete</button>
        </div></td>
      </tr>`;
    }).join("")}</tbody></table></div></div>`;
}

/* ================================================================ SESSIONS */
function admFilteredSessions() {
  const q = ADM.q.toLowerCase();
  return DB.sessions.filter(s => {
    if (ADM.who && s.user_id !== ADM.who) return false;
    if (ADM.from && s.day < ADM.from) return false;
    if (ADM.to && s.day > ADM.to) return false;
    if (!q) return true;
    return (labelOf(s) + " " + (s.note || "") + " " + profileOf(s.user_id).display_name)
      .toLowerCase().includes(q);
  }).sort((a, b) => b.day.localeCompare(a.day) ||
      String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function admSessionsView() {
  const rows = admFilteredSessions();
  const shown = rows.slice(0, 400);
  const selCount = ADM.sel.size;

  return `
  <div class="adm-h"><div>
    <h2>Sessions</h2>
    <p>Every block logged by anyone. Editing opens the same sheet members use, so a correction
       here looks identical to one they would have made themselves.</p>
  </div></div>

  <div class="adm-card"><div class="pad">
    <div class="adm-bar">
      <input class="adm-in adm-grow" id="adm-q" type="text" placeholder="Search notes, subjects, members…"
        value="${esc(ADM.q)}">
      <select class="adm-sel" id="adm-who">
        <option value="">Everyone</option>
        ${DB.profiles.map(p => `<option value="${esc(p.id)}"${ADM.who === p.id ? " selected" : ""}>${esc(p.display_name)}</option>`).join("")}
      </select>
      <input class="adm-in" id="adm-from" type="date" value="${esc(ADM.from)}" title="From this date">
      <input class="adm-in" id="adm-to" type="date" value="${esc(ADM.to)}" title="Up to this date">
      <button class="adm-btn" id="adm-clear">Reset</button>
    </div>
    <div class="adm-sub">${rows.length} session${rows.length === 1 ? "" : "s"} ·
      ${f1(admHours(rows))} hours${rows.length > shown.length
        ? ` · showing the newest ${shown.length}, narrow the filters to see the rest` : ""}</div>
  </div></div>

  ${selCount ? `<div class="adm-selbar">
    <strong>${selCount} selected</strong>
    <span style="color:var(--a-ink-mid)">${f1(admHours(rows.filter(s => ADM.sel.has(s.id))))} hours</span>
    <button class="adm-btn sm" id="adm-selnone" style="margin-left:auto">Clear selection</button>
    <button class="adm-btn sm danger" id="adm-selkill">Delete ${selCount} session${selCount === 1 ? "" : "s"}</button>
  </div>` : ""}

  <div class="adm-card"><div class="adm-scroll"><table class="adm-t">
    <thead><tr>
      <th class="l" style="width:34px"><input type="checkbox" class="adm-ck" id="adm-selall"
        ${selCount && selCount === shown.length ? "checked" : ""}></th>
      <th class="l">Day</th><th class="l">Member</th><th class="l">Worked on</th>
      <th>Hours</th><th class="l">Note</th><th></th>
    </tr></thead>
    <tbody>${shown.length ? shown.map(s => `<tr class="${ADM.sel.has(s.id) ? "sel" : ""}">
      <td class="l"><input type="checkbox" class="adm-ck" data-admsel="${esc(s.id)}"
        ${ADM.sel.has(s.id) ? "checked" : ""}></td>
      <td class="l adm-mono">${esc(s.day)}</td>
      <td class="l">${admWho(s.user_id)}</td>
      <td class="l"><span style="color:${colourOf(s)};font-weight:650">${esc(labelOf(s))}</span></td>
      <td>${f1(s.minutes / 60)}</td>
      <td class="l"><div class="adm-note" title="${esc(s.note || "")}">${esc(s.note || "—")}</div></td>
      <td><div class="adm-act">
        <button class="adm-btn sm" data-admedit="${esc(s.id)}">Edit</button>
        <button class="adm-btn sm danger" data-admdel="${esc(s.id)}">Delete</button>
      </div></td>
    </tr>`).join("") : `<tr><td colspan="7"><div class="adm-empty">Nothing matches those filters.</div></td></tr>`}
    </tbody></table></div></div>`;
}

/* =============================================================== INTEGRITY */
function admIntegrity(flags) {
  const counts = {};
  flags.forEach(f => counts[f.rule] = (counts[f.rule] || 0) + 1);

  return `
  <div class="adm-h"><div>
    <h2>Integrity</h2>
    <p>Entries that look off. Every one of these is a <em>signal</em>, not a verdict — a seven hour
       Saturday before trials is real, and so is a typo'd date. Nothing here has been changed;
       read the note, then decide.</p>
  </div></div>

  ${flags.length ? "" : `<div class="adm-empty" style="padding:44px">
    <div style="font-size:26px;margin-bottom:10px;color:var(--a-good)">●</div>
    Nothing looks wrong. Every session sits inside every rule below.</div>`}

  ${flags.length ? `<div class="adm-tiles">${Object.keys(ADM_RULES).map(r => {
    const n = counts[r] || 0;
    return `<div class="adm-tile ${n && ADM_RULES[r].level === "critical" ? "alert" : ""}">
      <div class="v">${n}</div><div class="k">${esc(ADM_RULES[r].label)}</div>
      <div class="d">${esc(ADM_RULES[r].why)}</div></div>`;
  }).join("")}</div>` : ""}

  ${flags.length ? `<div class="adm-card"><div class="adm-scroll"><table class="adm-t">
    <thead><tr><th class="l">Flag</th><th class="l">Member</th><th class="l">Entry</th>
      <th class="l">Why it is flagged</th><th></th></tr></thead>
    <tbody>${flags.map(f => `<tr>
      <td class="l">${admFlagPill(f.rule)}</td>
      <td class="l">${admWho(f.user_id)}</td>
      <td class="l">${f.session
        ? `<span class="adm-mono">${esc(f.session.day)}</span> · ${esc(labelOf(f.session))} ·
           ${f1(f.session.minutes / 60)} h`
        : `<span style="color:var(--a-ink-mid)">${esc((f.timer && f.timer.label) || "live timer")}</span>`}</td>
      <td class="l" style="color:var(--a-ink-mid)">${esc(f.detail)}</td>
      <td><div class="adm-act">
        ${f.session ? `<button class="adm-btn sm" data-admedit="${esc(f.session.id)}">Edit</button>
          <button class="adm-btn sm danger" data-admdel="${esc(f.session.id)}">Delete</button>`
        : `<button class="adm-btn sm danger" data-admtimer="${esc(f.user_id)}">Stop timer</button>`}
      </div></td>
    </tr>`).join("")}</tbody></table></div></div>` : ""}

  <div class="adm-card">
    <header><div><h3>What each rule looks for</h3>
      <div class="sub">Thresholds live in ADM_RULES and admFlags() in admin.js</div></div></header>
    <div class="pad" style="font-size:12.5px;color:var(--a-ink-mid);line-height:1.75">
      ${Object.keys(ADM_RULES).map(r =>
        `<div style="margin-bottom:7px">${admFlagPill(r)} &nbsp;${esc(ADM_RULES[r].why)}</div>`).join("")}
    </div>
  </div>`;
}

/* =================================================================== AUDIT */
function admAudit() {
  if (!ADM.auditLoaded) {
    admLoadAudit().then(() => { if (ADM.open && ADM.tab === "audit") renderAdmin(); });
    return `<div class="adm-h"><div><h2>Audit log</h2></div></div>
            <div class="adm-empty">Loading…</div>`;
  }
  return `
  <div class="adm-h"><div>
    <h2>Audit log</h2>
    <p>Every removal and every profile change made from this console, oldest at the bottom.
       The table has no update or delete policy in <code>schema.sql</code>, so this record cannot be
       edited or cleared by anyone — including whoever wrote it.</p>
  </div></div>

  ${ADM.audit.length ? `<div class="adm-card"><div class="adm-scroll"><table class="adm-t">
    <thead><tr><th class="l">When</th><th class="l">Admin</th><th class="l">Action</th>
      <th class="l">Affected</th><th class="l">Detail</th></tr></thead>
    <tbody>${ADM.audit.map(a => `<tr>
      <td class="l adm-mono">${esc(String(a.created_at || "").slice(0, 16).replace("T", " "))}</td>
      <td class="l">${esc(a.actor_name || admShort(a.actor_id))}</td>
      <td class="l">${(d => `<span class="adm-flag ${d ? "critical" : "mute"}">
        <i class="fi">${d ? "▲" : "✎"}</i>${esc(a.action)}</span>`)(/delete|wipe|clear/.test(a.action))}</td>
      <td class="l">${esc(a.target_name || admShort(a.target_user))}</td>
      <td class="l" style="color:var(--a-ink-mid)"><div class="adm-note"
        title="${esc(a.snapshot ? JSON.stringify(a.snapshot) : "")}">${esc(a.summary || "—")}</div></td>
    </tr>`).join("")}</tbody></table></div></div>`
  : `<div class="adm-empty">Nothing has been done from the console yet.</div>`}`;
}

/* ================================================================= ACTIONS */
function admWire() {
  const $$ = sel => Array.from($("adm").querySelectorAll(sel));

  $$("[data-admtab]").forEach(b => b.onclick = () => admGo(b.dataset.admtab));
  $$("[data-admprofile]").forEach(b => b.onclick = () => {
    closeAdmin(); openProfile(b.dataset.admprofile);
  });

  /* ---- session edit / delete ---- */
  $$("[data-admedit]").forEach(b => b.onclick = () => openEdit(b.dataset.admedit));
  $$("[data-admdel]").forEach(b => b.onclick = () => admDeleteSession(b.dataset.admdel));

  /* ---- filters ---- */
  const q = $("adm-q");
  if (q) q.oninput = () => {
    ADM.q = q.value; ADM.sel.clear();
    const at = q.selectionStart; renderAdmin();
    const n = $("adm-q"); if (n) { n.focus(); n.setSelectionRange(at, at); }
  };
  const who = $("adm-who");  if (who)  who.onchange  = () => { ADM.who = who.value; ADM.sel.clear(); renderAdmin(); };
  const fr  = $("adm-from"); if (fr)   fr.onchange   = () => { ADM.from = fr.value; renderAdmin(); };
  const to  = $("adm-to");   if (to)   to.onchange   = () => { ADM.to = to.value; renderAdmin(); };
  const cl  = $("adm-clear");if (cl)   cl.onclick    = () => {
    ADM.q = ADM.who = ADM.from = ADM.to = ""; ADM.sel.clear(); renderAdmin();
  };

  /* ---- bulk selection ---- */
  $$("[data-admsel]").forEach(b => b.onchange = () => {
    b.checked ? ADM.sel.add(b.dataset.admsel) : ADM.sel.delete(b.dataset.admsel);
    renderAdmin();
  });
  const all = $("adm-selall");
  if (all) all.onchange = () => {
    ADM.sel.clear();
    if (all.checked) admFilteredSessions().slice(0, 400).forEach(s => ADM.sel.add(s.id));
    renderAdmin();
  };
  const none = $("adm-selnone"); if (none) none.onclick = () => { ADM.sel.clear(); renderAdmin(); };
  const kill = $("adm-selkill"); if (kill) kill.onclick = () => admDeleteSelected();

  /* ---- member actions ---- */
  $$("[data-admedituser]").forEach(b => b.onclick = () => admEditMember(b.dataset.admedituser));
  $$("[data-admwipe]").forEach(b => b.onclick = () => admWipeSessions(b.dataset.admwipe));
  $$("[data-admkill]").forEach(b => b.onclick = () => admDeleteMember(b.dataset.admkill));
  $$("[data-admtimer]").forEach(b => b.onclick = () => admStopTimer(b.dataset.admtimer));
}

async function admDeleteSession(id) {
  const s = DB.sessions.find(x => x.id === id);
  if (!s) return;
  const p = profileOf(s.user_id);
  if (!confirm(`Delete ${p.display_name}'s ${f1(s.minutes / 60)} hour session on ${fmtLong(s.day)}?\n\n` +
    `"${s.note || "no note"}"\n\nThis cannot be undone. It will be recorded in the audit log.`)) return;

  await admLog("session.delete", s.user_id, p.display_name,
    `${f1(s.minutes / 60)} h on ${s.day} — ${labelOf(s)}`, s);
  const { error } = await sb.from("sessions").delete().eq("id", id);
  if (error) { toast("Could not delete: " + error.message); return; }
  ADM.sel.delete(id);
  toast("Session deleted");
  await admAfterWrite();
}

async function admDeleteSelected() {
  const ids = Array.from(ADM.sel);
  if (!ids.length) return;
  const rows = DB.sessions.filter(s => ids.includes(s.id));
  const people = Array.from(new Set(rows.map(s => profileOf(s.user_id).display_name)));
  if (!confirm(`Delete ${ids.length} sessions (${f1(admHours(rows))} hours) belonging to ` +
    `${people.join(", ")}?\n\nThis cannot be undone.`)) return;

  await admLog("session.bulk_delete", rows.length === 1 ? rows[0].user_id : null,
    people.join(", "), `${ids.length} sessions, ${f1(admHours(rows))} hours`, { ids, rows });
  const { error } = await sb.from("sessions").delete().in("id", ids);
  if (error) { toast("Could not delete: " + error.message); return; }
  ADM.sel.clear();
  toast(`${ids.length} sessions deleted`);
  await admAfterWrite();
}

async function admWipeSessions(uid) {
  const p = profileOf(uid);
  const ss = admSessions(uid);
  if (!ss.length) return;
  if (!confirm(`Delete all ${ss.length} of ${p.display_name}'s sessions (${f1(admHours(ss))} hours)?\n\n` +
    `Their account, subjects, areas and goals stay. This cannot be undone.`)) return;

  await admLog("member.clear_sessions", uid, p.display_name,
    `${ss.length} sessions, ${f1(admHours(ss))} hours`, { count: ss.length });
  const { error } = await sb.from("sessions").delete().eq("user_id", uid);
  if (error) { toast("Could not clear: " + error.message); return; }
  toast(`Cleared ${p.display_name}'s sessions`);
  await admAfterWrite();
}

async function admDeleteMember(uid) {
  const p = profileOf(uid);
  if (uid === UID) { toast("Remove your own account from Setup instead"); return; }
  const ss = admSessions(uid);
  const typed = prompt(
    `This deletes ${p.display_name}'s login and everything they own — ` +
    `${ss.length} sessions, ${f1(admHours(ss))} hours, their subjects, areas and goals.\n\n` +
    `There is no undo.\n\nType their display name exactly to confirm:`);
  if (typed === null) return;
  if (typed.trim() !== p.display_name) { toast("Name did not match — nothing deleted"); return; }

  await admLog("member.delete", uid, p.display_name,
    `account removed with ${ss.length} sessions (${f1(admHours(ss))} h)`,
    { profile: p, sessions: ss.length });

  const { error } = await sb.rpc("admin_delete_user", { target: uid });
  if (error) {
    /* The RPC is missing on projects that have not re-run schema.sql. Falling
       back to clearing their rows is better than doing nothing, but it leaves
       the login alive — say so rather than claiming success. */
    await sb.from("sessions").delete().eq("user_id", uid);
    await sb.from("subjects").delete().eq("user_id", uid);
    await sb.from("goals").delete().eq("user_id", uid);
    await sb.from("profiles").delete().eq("id", uid);
    toast("Data cleared, but the login remains — re-run schema.sql for admin_delete_user()", 5200);
    await admAfterWrite();
    return;
  }
  toast(`${p.display_name} removed`);
  await admAfterWrite();
}

async function admStopTimer(uid) {
  const p = profileOf(uid);
  if (!confirm(`Clear ${p.display_name}'s running timer? It drops them off the live strip. ` +
    `Nothing they have logged is touched.`)) return;
  await admLog("timer.clear", uid, p.display_name, "cleared a stale live timer", null);
  const { error } = await sb.from("live_timers").delete().eq("user_id", uid);
  if (error) { toast("Could not clear: " + error.message); return; }
  toast("Timer cleared");
  await admAfterWrite();
}

/* Profile editing reuses the crew's own vocabulary — name, school, colour and
   the default goal. Anything more (avatars, weekday goals) belongs to the
   person, and there is no moderation reason to reach into it. */
async function admEditMember(uid) {
  const p = profileOf(uid);
  const name = prompt(`Display name for this member:`, p.display_name || "");
  if (name === null) return;
  if (!name.trim()) { toast("A display name cannot be empty"); return; }
  const school = prompt(`School (blank for none):`, p.school || "");
  if (school === null) return;

  const patch = { display_name: name.trim(), school: school.trim() || null };
  await admLog("member.edit", uid, p.display_name,
    `name "${p.display_name}" → "${patch.display_name}"` +
    (p.school !== patch.school ? `, school "${p.school || "—"}" → "${patch.school || "—"}"` : ""),
    { before: { display_name: p.display_name, school: p.school } });

  const { error } = await sb.from("profiles").update(patch).eq("id", uid);
  if (error) { toast("Could not save: " + error.message); return; }
  toast("Profile updated");
  await admAfterWrite();
}

/* ==================================================================== BOOT
   app.js calls adminBoot() as soon as a session comes up — but that can happen
   before the browser has even fetched this file, since app.js is parsed first
   and its sign-in resolves on the next microtask. So cover the other order
   too: if a session is already live by the time we load, ask now. */
if (typeof UID !== "undefined" && UID) adminBoot();

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && ADM.open && !editingId) { e.stopImmediatePropagation(); closeAdmin(); }
});
