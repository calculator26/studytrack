/* =========================================================================
   PLANNER — the day's to-do list, on the Calendar tab
   -------------------------------------------------------------------------
   One card under the countdown hero. For whichever day you are looking at:

     · Top 3: up to three starred to-dos, the ones that make the day a good
       one whatever else happens. Choosing them is most of the value.
     · Schedule: to-dos with a time block, in order, with your exams on the
       day as fixed blocks and a "now" line through today.
     · Anytime: everything else.

   A to-do can carry a subject; on today, ▶ starts the session timer on that
   subject so the work is logged as hours. Anything left unticked when its
   day ends moves to today (todo_carry in planner.sql) and says where it came
   from, losing its time block and star so today's plan is chosen fresh.

   Stored in study_todos (planner.sql): yours alone, written only through
   todo_save / todo_delete / todo_carry. plan.js calls plannerPaint() when
   the Calendar tab is drawn, guarded, so the app works without this file.
   ========================================================================= */

const TD = {
  list: [],               /* every to-do from a fortnight back onwards */
  loaded: false, missing: false, at: 0,
  day: null,              /* the day on show; null is today */
  edit: null,             /* the to-do loaded into the form */
  busy: false
};

const tdDay = () => TD.day || todayISO();
const tdHHMM = t => t ? String(t).slice(0, 5) : "";
const tdMins = t => { const m = /^(\d\d):(\d\d)/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
/* "13:30:00" -> "1.30 pm", the way exam times are written everywhere else */
function tdClock(t) {
  const m = tdMins(t);
  if (m === null) return "";
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}.${pad(m % 60)} ${h < 12 ? "am" : "pm"}`;
}
const tdSpan = x => x.start_time ? tdClock(x.start_time) + (x.end_time ? " – " + tdClock(x.end_time) : "") : "";

/* ---------------------------------------------------------------------------
   Reading and writing
   --------------------------------------------------------------------------- */
async function tdLoad(force) {
  if (!sb || !UID) return;
  if (!force && TD.loaded && Date.now() - TD.at < 5 * 60e3) return;
  TD.at = Date.now();
  try {
    /* once a day per device: yesterday's leftovers come forward first */
    let carried = 0;
    const ck = "studytrack-todo-carry-" + UID;
    let last = null;
    try { last = localStorage.getItem(ck); } catch (e) { /* private window */ }
    if (last !== todayISO()) {
      const { data } = await sb.rpc("todo_carry");
      if (data && data.ok) {
        carried = data.carried || 0;
        try { localStorage.setItem(ck, todayISO()); } catch (e) { /* private window */ }
      }
    }
    const { data, error } = await sb.from("study_todos")
      .select("id,day,title,subject_id,start_time,end_time,priority,done,carried_from,position,created_at")
      .gte("day", addDays(todayISO(), -14));
    if (error) { TD.missing = true; TD.loaded = true; plannerPaint(); return; }
    TD.missing = false;
    TD.list = data || [];
    TD.loaded = true;
    plannerPaint();
    if (carried) toast(`${carried} unfinished to-do${carried === 1 ? "" : "s"} carried over to today`, 3600);
  } catch (e) { TD.loaded = true; }
}

/* Saves optimistically and puts it back if the database says no. */
async function tdSave(id, patch) {
  const before = id ? TD.list.find(x => x.id === id) : null;
  const undo = before ? Object.assign({}, before) : null;
  if (before) { Object.assign(before, patch); plannerPaint(); }
  const { data, error } = await sb.rpc("todo_save", { p_id: id || null, p: patch });
  if (error || !data || data.ok === false) {
    if (before) { Object.assign(before, undo); plannerPaint(); }
    toast((data && data.why) || "Could not save that" + (error ? " — " + error.message : ""), 4200);
    return null;
  }
  const row = data.todo;
  if (row) {
    const i = TD.list.findIndex(x => x.id === row.id);
    if (i >= 0) TD.list[i] = row; else TD.list.push(row);
  }
  plannerPaint();
  return row;
}
async function tdDelete(id) {
  const i = TD.list.findIndex(x => x.id === id);
  if (i < 0) return;
  const [gone] = TD.list.splice(i, 1);
  if (TD.edit === id) tdResetForm();
  plannerPaint();
  const { data, error } = await sb.rpc("todo_delete", { p_id: id });
  if (error || (data && data.ok === false)) {
    TD.list.splice(i, 0, gone);
    plannerPaint();
    toast((data && data.why) || "Could not delete that", 4200);
  }
}

/* ---------------------------------------------------------------------------
   Drawing
   --------------------------------------------------------------------------- */
function tdMount() {
  if ($("cal-planner")) return true;
  const hero = $("cal-hero");
  if (!hero) return false;
  hero.insertAdjacentHTML("afterend", `
    <div class="card mb16" id="cal-planner">
      <header><div><h2>Day planner</h2><div class="sub" id="td-sub"></div></div>
        <div class="controls">
          <button class="chip" type="button" data-tdnav="-1" aria-label="Previous day">‹</button>
          <button class="chip" type="button" data-tdnav="0">Today</button>
          <button class="chip" type="button" data-tdnav="1" aria-label="Next day">›</button>
        </div></header>
      <div class="body">
        <div id="td-stats"></div>
        <form class="td-form" id="td-form" autocomplete="off">
          <input type="text" id="td-title" maxlength="200" placeholder="What needs doing? e.g. Chem 2023 paper, Q21–30" aria-label="To-do">
          <select id="td-subj" aria-label="Subject"></select>
          <span class="td-times">
            <input type="time" id="td-start" step="300" aria-label="Starts">
            <span>–</span>
            <input type="time" id="td-end" step="300" aria-label="Ends">
          </span>
          <label class="td-starbox" title="Make it one of the day's Top 3"><input type="checkbox" id="td-pri"><span>★ Top 3</span></label>
          <span class="td-formbtns">
            <button class="btn sm" type="submit" id="td-add">Add</button>
            <button class="btn ghost sm" type="button" id="td-cancel" hidden>Cancel</button>
          </span>
        </form>
        <div class="td-cols" id="td-cols"></div>
      </div>
    </div>`);
  tdWire();
  return true;
}

function tdSubjectOptions() {
  return `<option value="">No subject</option>` +
    mySubjects(UID).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
}

function tdRow(x) {
  const s = x.subject_id ? subjById(x.subject_id) : null;
  const isToday = x.day === todayISO();
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const st = tdMins(x.start_time), et = tdMins(x.end_time);
  const now = isToday && !x.done && st !== null && st <= nowM && (et === null ? nowM < st + 60 : nowM < et);
  const meta = [
    x.start_time ? `<span class="td-time">${esc(tdSpan(x))}</span>` : "",
    s ? `<span class="td-subj" style="--c:${esc(s.colour || "#7B8D98")}">${esc(s.name)}</span>` : "",
    x.carried_from ? `<span class="td-carry" title="First planned for ${esc(fmtLong(x.carried_from))}">↻ from ${esc(fmtD(x.carried_from))}</span>` : "",
    now ? `<span class="td-nowtag">Now</span>` : ""
  ].filter(Boolean).join("");
  const canTime = isToday && s && !x.done;
  return `<div class="td-row${x.done ? " done" : ""}${now ? " now" : ""}${x.priority ? " pri" : ""}" style="--c:${esc(s ? s.colour || "#7B8D98" : "var(--rule)")}">
    <button type="button" class="td-chk" data-tdtick="${esc(x.id)}" aria-pressed="${x.done}" aria-label="${x.done ? "Mark not done" : "Mark done"}"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></button>
    <div class="td-main"><div class="td-t">${esc(x.title)}</div>${meta ? `<div class="td-m">${meta}</div>` : ""}</div>
    <div class="td-act">
      ${canTime ? `<button type="button" class="td-go" data-tdgo="${esc(x.id)}" title="Start the timer on ${esc(s.name)}">▶</button>` : ""}
      <button type="button" class="td-ic${x.priority ? " on" : ""}" data-tdstar="${esc(x.id)}" title="${x.priority ? "Take out of Top 3" : "Make it Top 3"}" aria-pressed="${x.priority}">★</button>
      <button type="button" class="td-ic" data-tdedit="${esc(x.id)}" title="Edit">✎</button>
      <button type="button" class="td-ic" data-tddel="${esc(x.id)}" title="Delete" aria-label="Delete">×</button>
    </div>
  </div>`;
}

function plannerPaint() {
  const p = $("p-cal");
  if (!p || !p.classList.contains("on") || !UID) return;
  if (!tdMount()) return;
  tdLoad();
  const day = tdDay(), today = todayISO(), past = day < today;
  const nav = document.querySelector('[data-tdnav="0"]');
  if (nav) nav.setAttribute("aria-pressed", String(day === today));
  $("td-sub").textContent = day === today
    ? "Today, " + fmtLong(day) + ". Pick your Top 3, block out the time, tick things off."
    : fmtLong(day) + (past ? ". Unfinished to-dos from here moved to today." : ". Plan it ahead.");
  const sel = $("td-subj");
  const opts = tdSubjectOptions();
  if (sel.dataset.sig !== opts) { const v = sel.value; sel.innerHTML = opts; sel.value = v; sel.dataset.sig = opts; }
  $("td-form").hidden = past || TD.missing;

  if (TD.missing) {
    $("td-stats").innerHTML = "";
    $("td-cols").innerHTML = `<div class="empty">The planner isn't switched on yet. Whoever runs Study Track needs to run <b>planner.sql</b> in Supabase once.</div>`;
    return;
  }
  if (!TD.loaded) { $("td-cols").innerHTML = `<div class="empty">Loading your list…</div>`; return; }

  const items = TD.list.filter(x => x.day === day)
    .sort((a, b) => (a.start_time || "99").localeCompare(b.start_time || "99") || a.position - b.position || String(a.created_at).localeCompare(String(b.created_at)));
  const top = items.filter(x => x.priority);
  const timed = items.filter(x => !x.priority && x.start_time);
  const any = items.filter(x => !x.priority && !x.start_time);

  /* the numbers that say how the day is going */
  const done = items.filter(x => x.done).length;
  let schedMins = 0;
  items.forEach(x => { const a = tdMins(x.start_time), b = tdMins(x.end_time); if (a !== null && b !== null) schedMins += b - a; });
  const goal = goalFor(UID, day);
  const planned = typeof plnPlanDay === "function" ? plnPlanDay(day) : 0;
  const topDone = top.filter(x => x.done).length;
  $("td-stats").innerHTML = items.length ? `<div class="td-stats">
      <div class="td-prog"><b>${done}<small> / ${items.length} done</small></b><i class="td-bar"><i style="width:${(done / items.length * 100).toFixed(1)}%"></i></i></div>
      <div class="td-stat"><span>Top 3</span><b>${top.length ? `${topDone}/${top.length}` : "—"}</b></div>
      <div class="td-stat"><span>Time blocked</span><b>${hm(schedMins / 60)}</b><small>${goal ? `of a ${f1(goal)} h goal` : "no goal set"}${planned ? ` · ${f1(planned)} h planned on the chart` : ""}</small></div>
    </div>
    ${top.length && topDone === top.length ? `<div class="td-win">Top ${top.length === 1 ? "one" : top.length} done. That's the day won. Anything else is a bonus.</div>` : ""}` : "";

  /* the schedule: your timed to-dos, your exams, and where now is */
  const exams = typeof plnExams === "function" ? plnExams().list.filter(e => e.date === day) : [];
  const blocks = timed.map(x => ({ at: tdMins(x.start_time), html: tdRow(x) }))
    .concat(exams.map(e => {
      const c = plnClock(e.start);
      return { at: c ? c[0] * 60 + c[1] : 0, html: `<div class="td-row td-exam" style="--c:${esc(e.colour)}">
        <span class="td-pen">✎</span>
        <div class="td-main"><div class="td-t">${esc(e.subject)}${e.label !== "Exam" ? " " + esc(e.label) : ""} exam</div>
        <div class="td-m">${e.start ? `<span class="td-time">${esc(plnTime(e.start))} – ${esc(plnTime(e.end))}</span>` : ""}${e.paper ? `<span>${esc(e.paper)}</span>` : ""}</div></div></div>` };
    }))
    .sort((a, b) => a.at - b.at);
  if (day === today && blocks.length) {
    const n = new Date(), nowM = n.getHours() * 60 + n.getMinutes();
    const i = blocks.findIndex(b => b.at > nowM);
    const line = { at: nowM, html: `<div class="td-nowline"><span>${esc(tdClock(pad(n.getHours()) + ":" + pad(n.getMinutes())))}</span></div>` };
    if (i < 0) blocks.push(line); else blocks.splice(i, 0, line);
  }

  const slots = past ? "" : Array.from({ length: Math.max(0, 3 - top.length) }, (_, i) =>
    `<button type="button" class="td-slot" data-tdslot="1">${top.length + i + 1}. ${i === 0 && !top.length ? "What would make today a win? Star it." : "Star another"}</button>`).join("");
  $("td-cols").innerHTML = `
    <section class="td-sec td-top3"><h3>Top 3</h3>${top.map(x => tdRow(x)).join("")}${slots}</section>
    <section class="td-sec td-sched"><h3>Schedule</h3>${blocks.length ? blocks.map(b => b.html).join("")
      : `<div class="td-none">${past ? "Nothing was blocked out." : "Give a to-do a start time and it lands here, in order."}</div>`}</section>
    <section class="td-sec td-any"><h3>Anytime</h3>${any.length ? any.map(x => tdRow(x)).join("")
      : `<div class="td-none">${past ? "Nothing here." : "To-dos without a time go here."}</div>`}</section>`;
}

/* ---------------------------------------------------------------------------
   The form and the buttons
   --------------------------------------------------------------------------- */
function tdResetForm() {
  TD.edit = null;
  ["td-title", "td-start", "td-end"].forEach(id => { $(id).value = ""; });
  $("td-subj").value = "";
  $("td-pri").checked = false;
  $("td-add").textContent = "Add";
  $("td-cancel").hidden = true;
}

function tdWire() {
  $("td-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (TD.busy) return;
    const title = $("td-title").value.trim();
    if (!title) { $("td-title").focus(); return; }
    const st = $("td-start").value, et = $("td-end").value;
    if (et && !st) { toast("Give it a start time too"); return; }
    if (st && et && et <= st) { toast("It has to finish after it starts"); return; }
    const pri = $("td-pri").checked;
    const others = TD.list.filter(x => x.day === tdDay() && x.priority && x.id !== TD.edit).length;
    if (pri && others >= 3) { toast("You already have a Top 3 for this day. Unstar one first.", 3600); return; }
    const patch = { title, subject_id: $("td-subj").value || "", start_time: st || "", end_time: et || "", priority: pri };
    if (!TD.edit) patch.day = tdDay();
    TD.busy = true;
    try {
      const row = await tdSave(TD.edit, patch);
      if (row) { tdResetForm(); $("td-title").focus(); }
    } finally { TD.busy = false; }
  });
  $("td-cancel").addEventListener("click", tdResetForm);
  /* a start time with no end gets an hour, which can be changed */
  $("td-start").addEventListener("change", () => {
    const m = tdMins($("td-start").value);
    if (m !== null && !$("td-end").value && m < 23 * 60) $("td-end").value = pad(Math.floor((m + 60) / 60)) + ":" + pad(m % 60);
  });

  $("cal-planner").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.tdnav !== undefined) {
      const n = Number(d.tdnav);
      TD.day = n === 0 ? null : addDays(tdDay(), n);
      if (TD.day === todayISO()) TD.day = null;
      tdResetForm();
      plannerPaint();
      return;
    }
    if (d.tdtick) { const x = TD.list.find(t => t.id === d.tdtick); if (x) tdSave(x.id, { done: !x.done }); return; }
    if (d.tdstar) {
      const x = TD.list.find(t => t.id === d.tdstar);
      if (!x) return;
      if (!x.priority && TD.list.filter(t => t.day === x.day && t.priority).length >= 3) { toast("Top 3 is full. Unstar one first.", 3200); return; }
      tdSave(x.id, { priority: !x.priority });
      return;
    }
    if (d.tddel) { tdDelete(d.tddel); return; }
    if (d.tdedit) {
      const x = TD.list.find(t => t.id === d.tdedit);
      if (!x) return;
      TD.edit = x.id;
      $("td-title").value = x.title;
      $("td-subj").value = x.subject_id || "";
      $("td-start").value = tdHHMM(x.start_time);
      $("td-end").value = tdHHMM(x.end_time);
      $("td-pri").checked = !!x.priority;
      $("td-add").textContent = "Save";
      $("td-cancel").hidden = false;
      $("td-form").hidden = false;
      $("td-title").focus();
      return;
    }
    if (d.tdslot) { $("td-pri").checked = true; $("td-title").focus(); return; }
    if (d.tdgo) { tdStartTimer(d.tdgo); return; }
  });
}

/* ▶ on a to-do: the session timer on Today, set to that subject and started.
   The to-do's own words stay private: the timer shows the subject, as it
   always has, on the year group's "studying now" strip. */
function tdStartTimer(id) {
  const x = TD.list.find(t => t.id === id);
  if (!x || !x.subject_id) return;
  if (typeof localTimer !== "undefined" && localTimer) {
    toast(localTimer.running ? "A timer is already running. Finish it first." : "You have a paused timer. Finish or discard it first.", 3600);
    const tab = document.querySelector('nav.tabs button[data-p="home"]');
    if (tab) tab.click();
    return;
  }
  const tab = document.querySelector('nav.tabs button[data-p="home"]');
  if (tab) tab.click();
  setPair("tm-subj", "tm-area", x.subject_id, null);
  const start = $("tm-start");
  if (!start) return;
  start.click();
  start.scrollIntoView({ block: "center", behavior: "smooth" });
  toast(`Timer started on ${(subjById(x.subject_id) || {}).name || "that subject"}. Tick the to-do off when you're done.`, 3600);
}

/* "Open in the day planner" from a day picked in the month view. */
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-tdplan]");
  if (!b) return;
  TD.day = b.dataset.tdplan === todayISO() ? null : b.dataset.tdplan;
  if ($("cal-planner")) tdResetForm();
  plannerPaint();
  const c = $("cal-planner");
  if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* Keep "now" honest while the Calendar tab is open. */
setInterval(() => {
  if (document.hidden || !$("cal-planner")) return;
  if (TD.day && TD.day !== todayISO()) return;
  try { plannerPaint(); } catch (e) { /* next time */ }
}, 60000);

if (typeof UID !== "undefined" && UID) { try { plannerPaint(); } catch (e) { console.error("planner", e); } }
