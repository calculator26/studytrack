/* =========================================================================
   PLAN — the exam calendar, the countdown and the lead-up chart
   -------------------------------------------------------------------------
   The run-in to the HSC, counted a day at a time. Four places show it:

     · the masthead (desktop): your next paper and every one after it on a
       little line from today to your last exam
     · Today: the countdown card, the fortnight ahead, and one useful nudge
     · Calendar: the lead-up chart (every subject, every day, what you did
       and what you plan to do, up to each exam), a month view with the year
       group's exams, the things worth knowing about your timetable, and the
       timetable itself
     · plans you make here, saved to study_plan (plan.sql) and yours alone

   Exam dates and times come from catalogue.js, which is NESA's 2026 HSC
   written exam timetable checked line by line against the published PDF.
   A subject is matched to its course with catFor() in app.js, so a name
   typed by hand ("maths advanced") still finds its papers.

   app.js calls in through planRender(), planTabOpened() and
   planPaintCountdown(), each guarded so the app works without this file.
   ========================================================================= */

const PLN = {
  plans: new Map(),          /* "day|subject_id" -> hours */
  plansLoaded: false, plansAt: 0,
  back: 14,                  /* how many days of history the chart shows */
  cohort: false,             /* month view: show the year group's exams */
  pick: null,                /* the chart cell whose detail is open */
  dayPick: null,             /* the month-view day whose detail is open */
  undo: null                 /* the plan before "Suggest a plan" */
};

/* ---------------------------------------------------------------------------
   Times and exams
   --------------------------------------------------------------------------- */
function plnClock(t) {                       /* "9.50 am" | "12 noon" -> [h, m] */
  const s = String(t || "").trim().toLowerCase();
  if (/noon/.test(s)) return [12, 0];
  const m = /^(\d{1,2})[.:](\d{2})\s*(am|pm)$/.exec(s);
  if (!m) return null;
  let h = +m[1] % 12;
  if (m[3] === "pm") h += 12;
  return [h, +m[2]];
}
function plnAt(day, t, fallbackHour) {
  const d = parseD(day), c = plnClock(t);
  if (c) d.setHours(c[0], c[1], 0, 0); else d.setHours(fallbackHour == null ? 9 : fallbackHour, 0, 0, 0);
  return d;
}
const plnTime = t => String(t || "").replace(/\s+/g, "").replace("noon", "pm").replace(/^12pm$/, "12pm");
function plnShort(name) {
  return String(name || "")
    .replace(/^Mathematics/, "Maths").replace(/Advanced/, "Adv").replace(/Standard/, "Std")
    .replace(/Extension/, "Ext").replace(/Studies of Religion/, "SOR").replace(/Health and Movement Science/, "HMS")
    .replace(/Earth and Environmental Science/, "EES").replace(/Business Studies/, "Business")
    .replace(/Enterprise Computing/, "Ent. Computing").replace(/Software Engineering/, "Software Eng")
    .replace(/Industrial Technology/, "Industrial Tech").replace(/Investigating Science/, "Inv. Science")
    .replace(/Design and Technology/, "D&T").replace(/ and /g, " & ");
}
function plnRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return `rgba(123,141,152,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* Both of these are asked for on every hover, so each answer is kept for a
   second; anything that changes them repaints through planRender anyway. */
const PLN_MEMO = { ex: null, exAt: 0, st: null, stAt: 0 };
function plnDirty() { PLN_MEMO.ex = PLN_MEMO.st = null; }

/* Your papers, in order, plus anything that needs fixing. */
function plnExams() {
  if (PLN_MEMO.ex && Date.now() - PLN_MEMO.exAt < 1000) return PLN_MEMO.ex;
  PLN_MEMO.ex = plnExamsNow(); PLN_MEMO.exAt = Date.now();
  return PLN_MEMO.ex;
}
function plnExamsNow() {
  const list = [], unlinked = [], wrong = [], noPaper = [];
  mySubjects(UID).forEach(s => {
    const c = catFor(s.name);
    if (c && c.exams && c.exams.length) {
      c.exams.forEach((e, i) => list.push({
        sid: s.id, subject: s.name, course: c.name, colour: s.colour || c.colour,
        paper: e.paper, label: c.exams.length > 1 ? "P" + (i + 1) : "Exam",
        date: e.date, start: e.start, end: e.end,
        at: plnAt(e.date, e.start), endAt: plnAt(e.date, e.end), official: true
      }));
      /* a date typed against the subject that is not the real one */
      if (s.exam_date && !c.exams.some(e => e.date === s.exam_date)) wrong.push({ s, c });
    } else if (c) {
      noPaper.push(s);
    } else if (s.exam_date && /^2026-1[0-2]-\d\d$/.test(s.exam_date)) {
      list.push({ sid: s.id, subject: s.name, course: s.name, colour: s.colour, paper: null, label: "Exam",
        date: s.exam_date, start: null, end: null, at: plnAt(s.exam_date, null, 9),
        endAt: plnAt(s.exam_date, null, 12), official: false });
    } else {
      unlinked.push(s);
    }
  });
  list.sort((a, b) => a.at - b.at || a.subject.localeCompare(b.subject));
  return { list, unlinked, wrong, noPaper };
}

/* What to say about the time until a paper. */
function plnUntil(ex, now, precise) {
  now = now || new Date();
  if (now >= ex.endAt) return { done: true, big: "Done", unit: "" };
  if (now >= ex.at) return { live: true, big: "Now", unit: "good luck" };
  const ms = ex.at - now, h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60;
  /* The headline countdowns go to the hour: "6d 14h", then "17h 05m" on the
     last day. Only when the paper has a real start time. */
  if (precise && ex.start && h >= 24) return { big: `${Math.floor(h / 24)}d ${h % 24}h`, unit: "to go" };
  if (precise && ex.start) return { soon: true, today: daysBetween(todayISO(), ex.date) === 0, big: `${h}h ${pad(m)}m`, unit: "to go" };
  const days = daysBetween(todayISO(), ex.date);
  if (days >= 2) return { big: String(days), unit: "days" };
  if (days === 1) return { soon: true, big: "Tomorrow", unit: ex.start ? "at " + plnTime(ex.start) : "" };
  return { soon: true, today: true, big: h ? `${h}h ${pad(m)}m` : `${m}m`, unit: "to go" };
}
/* "6d 14h" with the letters drawn smaller than the figures. */
const plnBig = u => esc(u.big).replace(/(\d)([dhm])\b/g, '$1<small>$2</small>');

/* All the HSC exam days, for the "Day 7" marks. */
let PLN_HSCDAYS = null;
function plnHscDays() {
  if (PLN_HSCDAYS) return PLN_HSCDAYS;
  const days = [...new Set((CAT.papers || []).map(p => p.date))].sort();
  PLN_HSCDAYS = new Map(days.map((d, i) => [d, i + 1]));
  return PLN_HSCDAYS;
}
/* NESA's own week numbers: week 1 is the week of English Paper 1. */
function plnHscWeek(day) {
  const days = [...plnHscDays().keys()];
  if (!days.length) return null;
  const w1 = addDays(days[0], -dowIdx(days[0]));
  const last = days[days.length - 1];
  if (day < w1 || day > addDays(last, 6 - dowIdx(last))) return null;
  return Math.floor(daysBetween(w1, day) / 7) + 1;
}

/* ---------------------------------------------------------------------------
   Your hours, by subject and day
   --------------------------------------------------------------------------- */
function plnStudied() {
  if (PLN_MEMO.st && Date.now() - PLN_MEMO.stAt < 1000) return PLN_MEMO.st;
  PLN_MEMO.st = plnStudiedNow(); PLN_MEMO.stAt = Date.now();
  return PLN_MEMO.st;
}
function plnStudiedNow() {
  const cells = new Map(), lists = new Map(), lastDay = new Map();
  DB.sessions.filter(s => s.user_id === UID).forEach(s => {
    const k = s.day + "|" + (s.subject_id || "none");
    cells.set(k, (cells.get(k) || 0) + Number(s.minutes || 0));
    (lists.get(k) || lists.set(k, []).get(k)).push(s);
    if (s.subject_id && (!lastDay.get(s.subject_id) || s.day > lastDay.get(s.subject_id))) lastDay.set(s.subject_id, s.day);
  });
  /* a session running now counts towards today, as it does everywhere */
  const live = liveMsFor(UID);
  if (live && typeof localTimer !== "undefined" && localTimer) {
    const k = todayISO() + "|" + (localTimer.subject_id || "none");
    cells.set(k, (cells.get(k) || 0) + live / 60000);
    if (localTimer.subject_id) lastDay.set(localTimer.subject_id, todayISO());
  }
  return { cells, lists, lastDay };
}
const plnPlan = (day, sid) => PLN.plans.get(day + "|" + sid) || 0;
function plnPlanDay(day) {
  let h = 0;
  PLN.plans.forEach((v, k) => { if (k.startsWith(day + "|")) h += v; });
  return h;
}

/* ---------------------------------------------------------------------------
   Plans: read once, written through set_plan / set_plans
   --------------------------------------------------------------------------- */
async function plnLoadPlans(force) {
  if (!sb || !UID) return;
  if (!force && PLN.plansLoaded && Date.now() - PLN.plansAt < 10 * 60e3) return;
  PLN.plansAt = Date.now();
  try {
    const { data, error } = await sb.from("study_plan").select("day,subject_id,hours").gte("day", addDays(todayISO(), -60));
    if (error) { PLN.plansLoaded = true; return; }   /* not migrated: no plans */
    PLN.plans = new Map((data || []).map(r => [r.day + "|" + r.subject_id, Number(r.hours) || 0]));
    PLN.plansLoaded = true;
    planRender();
  } catch (e) { PLN.plansLoaded = true; }
}
async function plnSetPlan(day, sid, hours) {
  const k = day + "|" + sid, before = PLN.plans.get(k);
  if (hours > 0) PLN.plans.set(k, Math.round(hours * 4) / 4); else PLN.plans.delete(k);
  plnRepaint();
  const { data, error } = await sb.rpc("set_plan", { p_day: day, p_subject: sid, p_hours: hours });
  if (error || (data && data.ok === false)) {
    if (before) PLN.plans.set(k, before); else PLN.plans.delete(k);
    plnRepaint();
    toast((data && data.why) || "Could not save that plan" + (error ? " — " + error.message : ""), 4200);
  }
}
async function plnSetPlans(rows, quiet) {
  if (!rows.length) return true;
  rows.forEach(r => { const k = r.day + "|" + r.subject_id; if (r.hours > 0) PLN.plans.set(k, r.hours); else PLN.plans.delete(k); });
  plnRepaint();
  const { data, error } = await sb.rpc("set_plans", { rows });
  if (error || (data && data.ok === false)) {
    toast((data && data.why) || "Could not save the plan" + (error ? " — " + error.message : ""), 4200);
    plnLoadPlans(true);
    return false;
  }
  if (!quiet) plnLoadPlans(true);
  return true;
}

/* "Suggest a plan": fills days that have nothing planned, from today to your
   last paper. Each day gets your goal for it (3 hours if you have none) in
   half-hour blocks, shared between subjects whose exam is still ahead:
   nearer exams get more, the day before an exam is mostly that subject,
   anything left alone for a few days gets pulled back in, and a day with an
   exam of its own stays light. Days you have already planned are left alone. */
function plnSuggest(exams) {
  const today = todayISO(), now = new Date();
  const { lastDay } = plnStudied();
  const ahead = exams.filter(e => e.endAt > now);
  if (!ahead.length) return [];
  const lastExam = ahead[ahead.length - 1].date;
  const startDay = now.getHours() >= 18 ? addDays(today, 1) : today;
  const touched = new Map(lastDay);
  const rows = [];
  for (let d = startDay; d < lastExam; d = addDays(d, 1)) {
    if (plnPlanDay(d) > 0) {              /* yours: respect it, and count it */
      PLN.plans.forEach((v, k) => { const [day, sid] = k.split("|"); if (day === d) touched.set(sid, d); });
      continue;
    }
    const prof = profileOf(UID);
    const wk = Array.isArray(prof.weekday_goals) && prof.weekday_goals.length === 7 ? prof.weekday_goals[dowIdx(d)] : null;
    if (wk !== null && wk !== "" && Number(wk) === 0) continue;          /* your rest day */
    let budget = goalFor(UID, d);
    if (!(budget > 0)) budget = 3;
    budget = Math.min(budget, 8);
    const examToday = ahead.some(e => e.date === d);
    if (examToday) budget = Math.min(budget, 1.5);
    if (d === today) budget = Math.max(0, budget - minutesTodayFor() / 60);
    /* subjects with a paper after this day, nearest first */
    const next = new Map();
    ahead.forEach(e => { if (e.date > d && !next.has(e.sid)) next.set(e.sid, e); });
    if (!next.size || budget < 0.5) continue;
    const weights = [];
    next.forEach((e, sid) => {
      const gap = daysBetween(d, e.date);
      let w = 1 / Math.pow(gap + 1.5, 1.05);
      if (gap === 1) w *= 4.5; else if (gap <= 3) w *= 1.8;
      const idle = touched.get(sid) ? daysBetween(touched.get(sid), d) : 9;
      if (idle >= 3) w *= 1.4 + Math.min(idle, 8) * 0.06;
      weights.push([sid, w]);
    });
    weights.sort((a, b) => b[1] - a[1]);
    const top = weights.slice(0, budget >= 3 ? 4 : 2);
    const sum = top.reduce((a, x) => a + x[1], 0);
    const blocks = Math.round(budget * 2);
    let given = 0;
    const share = top.map(([sid, w]) => { const b = Math.floor(blocks * w / sum); given += b; return { sid, b, r: blocks * w / sum - b }; });
    share.sort((a, b) => b.r - a.r);
    for (let i = 0; given < blocks; i = (i + 1) % share.length) { share[i].b++; given++; }
    share.forEach(x => {
      if (x.b > 0) { rows.push({ day: d, subject_id: x.sid, hours: x.b / 2 }); touched.set(x.sid, d); }
    });
  }
  return rows;
}
const minutesTodayFor = () => { const v = DB.daily.get(UID); return (typeof dayCell === "function" ? dayCell(UID, todayISO())[0] : (v && v.days[todayISO()] || [0])[0]) || 0; };

/* ---------------------------------------------------------------------------
   THE MASTHEAD: one line, the next paper and how long until it. It never
   makes the header taller: if it would push anything onto a second line,
   it steps aside.
   --------------------------------------------------------------------------- */
function planPaintStrip(X) {
  const el = $("examstrip");
  if (!el) return;
  const now = new Date();
  const nx = X.list.find(e => e.endAt > now);
  if (!nx) { el.hidden = true; return; }
  const u = plnUntil(nx, now, true);
  const when = u.live ? "now" : /\d[dhm]$/.test(u.big) ? u.big : (u.big + (u.unit && !u.soon ? " " + u.unit : "") + (u.soon && u.unit ? " · " + u.unit : ""));
  const html = `<button type="button" class="xs-pill" data-plgo="cal" title="${esc(nx.subject + (nx.paper ? " · " + nx.paper : "") + " · " + fmtLong(nx.date) + (nx.start ? " · " + nx.start + " – " + nx.end : ""))}">
      <span class="xs-k">${u.live ? "In the exam" : "Next exam"}</span>
      <span class="xs-n" style="--c:${esc(nx.colour)}">${esc(plnShort(nx.subject))}${nx.label !== "Exam" ? " " + esc(nx.label) : ""}</span>
      <span class="xs-v">${esc(when)}</span>
    </button>`;
  if (el.dataset.sig !== html) { el.innerHTML = html; el.dataset.sig = html; }
  el.hidden = false;
  plnStripFit();
}
function plnStripFit() {
  const el = $("examstrip"), mast = el && el.parentElement;
  if (!el || el.hidden || !mast) return;
  el.classList.remove("xs-off");
  const kids = [...mast.children].filter(k => k.offsetParent);
  const top = kids.length ? kids[0].offsetTop : 0;
  if (kids.some(k => Math.abs(k.offsetTop + k.offsetHeight / 2 - (top + kids[0].offsetHeight / 2)) > 12)) el.classList.add("xs-off");
}
window.addEventListener("resize", () => { try { plnStripFit(); } catch (e) {} });

/* ---------------------------------------------------------------------------
   TODAY: the countdown card
   --------------------------------------------------------------------------- */
const PLN_CALC = /^(Mathematics|Physics|Chemistry|Biology|Earth and Environmental|Investigating Science|Science Extension)/;
function plnChecklist(ex) {
  const items = [
    `Arrive by <b>${esc(plnTime(minusMinutes(ex.start, 30)) || "30 minutes early")}</b>, half an hour before reading time`,
    "Your student card and NESA number",
    "Black pens, plus spares",
    "A clear water bottle, label off"
  ];
  if (PLN_CALC.test(ex.course)) items.push("An approved calculator, with fresh batteries");
  items.push("Phone and smartwatch off and left outside the room");
  return `<ul class="xc-check">${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}
function minusMinutes(t, mins) {
  const c = plnClock(t);
  if (!c) return "";
  let m = c[0] * 60 + c[1] - mins;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}.${pad(mm)} ${h < 12 ? "am" : "pm"}`;
}

function plnTip(X, now) {
  const today = todayISO();
  const ahead = X.list.filter(e => e.endAt > now);
  if (!ahead.length) return null;
  const nx = ahead[0], days = daysBetween(today, nx.date);
  if (now >= nx.at) {
    const after = ahead[1];
    return { text: `In the exam until <b>${esc(plnTime(nx.end) || "it finishes")}</b>.${after ? ` Next up: <b>${esc(after.subject)}${after.label !== "Exam" ? " " + after.label : ""}</b>, ${daysBetween(today, after.date) === 0 ? "later today" : daysBetween(today, after.date) === 1 ? "tomorrow" : esc(fmtD(after.date))}${after.start ? " at " + esc(plnTime(after.start)) : ""}.` : " It's your last one."}` };
  }
  if (days === 0 && now < nx.at) return { check: nx, text: `<b>${esc(nx.subject)}</b> today at ${esc(plnTime(nx.start) || "the usual time")}. You've done the work. Read the question twice.` };
  if (days === 1) return { check: nx, text: `<b>${esc(nx.subject)}</b> tomorrow at ${esc(plnTime(nx.start) || "the usual time")}. Light review today, then a proper night's sleep. It's worth more than a late cram.` };
  const { lastDay } = plnStudied();
  const neglected = [...new Map(ahead.filter(e => daysBetween(today, e.date) <= 21).map(e => [e.sid, e])).values()]
    .map(e => ({ e, idle: lastDay.get(e.sid) ? daysBetween(lastDay.get(e.sid), today) : 99 }))
    .filter(x => x.idle >= 4).sort((a, b) => b.idle - a.idle || a.e.at - b.e.at)[0];
  if (neglected) return { text: neglected.idle >= 99
    ? `Nothing logged for <b>${esc(neglected.e.subject)}</b> yet, and its exam is in ${daysBetween(today, neglected.e.date)} days.`
    : `You haven't logged <b>${esc(neglected.e.subject)}</b> in ${neglected.idle} days. Its exam is in ${daysBetween(today, neglected.e.date)}.` };
  const dbl = plnDoubles(ahead).find(d => daysBetween(today, d.date) <= 12);
  if (dbl) return { text: `Heads up: <b>${esc(fmtD(dbl.date))}</b> has ${dbl.list.length} of your papers (${dbl.list.map(e => esc(plnShort(e.subject)) + " " + (plnClock(e.start) && plnClock(e.start)[0] < 12 ? "AM" : "PM")).join(", ")}). Plan the day before for both.` };
  const gap = plnGaps(ahead)[0];
  if (gap && gap.days >= 4) return { text: `Your longest stretch is <b>${gap.days} days</b> before ${esc(plnShort(gap.to.subject))} (${esc(fmtD(gap.to.date))}). That's the window for your biggest revision push.` };
  return { text: `${plnStudyDays(ahead)} study days left before your last paper. Plan them on the Calendar tab.` };
}
function plnDoubles(list) {
  const by = {};
  list.forEach(e => { (by[e.date] = by[e.date] || []).push(e); });
  return Object.keys(by).sort().filter(d => new Set(by[d].map(e => e.sid)).size > 1 || by[d].length > 1 && by[d][0].label === "Exam")
    .map(d => ({ date: d, list: by[d] }));
}
function plnGaps(list) {
  const days = [...new Set(list.map(e => e.date))].sort(), out = [];
  for (let i = 1; i < days.length; i++) {
    const g = daysBetween(days[i - 1], days[i]) - 1;
    if (g > 0) out.push({ days: g, from: list.find(e => e.date === days[i - 1]), to: list.find(e => e.date === days[i]) });
  }
  return out.sort((a, b) => b.days - a.days);
}
function plnStudyDays(ahead) {
  if (!ahead.length) return 0;
  const examDays = new Set(ahead.map(e => e.date));
  let n = 0;
  for (let d = todayISO(); d <= ahead[ahead.length - 1].date; d = addDays(d, 1)) if (!examDays.has(d)) n++;
  return n;
}

function planPaintCountdown() {
  const box = $("countdown");
  if (!box || !UID) return false;
  const X = plnExams(), now = new Date();
  const ahead = X.list.filter(e => e.endAt > now);
  if (!X.list.length) { box.dataset.sig = ""; return false; }   /* no exams: app.js keeps its own */
  const today = todayISO();
  if (!ahead.length) {
    box.dataset.sig = "";
    box.innerHTML = `<div class="xc xc-done"><div class="xc-hero"><div class="xc-k">That's the HSC</div>
      <div class="xc-big" style="font-size:30px">Done 🎓</div><div class="xc-what">All ${X.list.length} of your papers are behind you.</div></div></div>`;
    box.hidden = false;
    return true;
  }
  const nx = ahead[0], u = plnUntil(nx, now, true);
  const { cells } = plnStudied();
  /* the fortnight ahead, a cell a day */
  const strip = Array.from({ length: 14 }, (_, i) => addDays(today, i)).map(d => {
    const es = X.list.filter(e => e.date === d);
    let done = 0; mySubjects(UID).forEach(s => { done += (cells.get(d + "|" + s.id) || 0); });
    done += cells.get(d + "|none") || 0;
    const plan = plnPlanDay(d);
    const hrs = d === today ? done / 60 : plan;
    return `<button type="button" class="xc-day${d === today ? " on" : ""}${es.length ? " ex" : ""}${dowIdx(d) > 4 ? " we" : ""}" data-plday="${d}"
      title="${esc(fmtD(d) + (es.length ? " · " + es.map(e => e.subject + (e.label !== "Exam" ? " " + e.label : "")).join(", ") : "") + (d === today ? " · " + hm(done / 60) + " today" : plan ? " · " + f1(plan) + " h planned" : ""))}">
      <span class="xd-w">${d === today ? "Today" : DOW[dowIdx(d)]}</span>
      <span class="xd-n">${parseD(d).getDate()}</span>
      <span class="xd-e">${es.slice(0, 2).map(e => `<i style="background:${esc(e.colour)}" title="${esc(e.subject)}"></i>`).join("")}</span>
      <span class="xd-h">${es.length ? esc(plnShort(es[0].subject).split(" ")[0]) : hrs ? f1(hrs) + "h" : ""}</span>
    </button>`;
  }).join("");
  const chips = ahead.slice(0, 9).map(e => {
    const n = daysBetween(today, e.date);
    return `<span class="xc-chip" style="--c:${esc(e.colour)}" title="${esc(e.subject + (e.paper ? " · " + e.paper : "") + " · " + fmtD(e.date) + (e.start ? " · " + e.start : ""))}">
      <b>${esc(plnShort(e.subject))}${e.label !== "Exam" ? " " + e.label : ""}</b><span>${n === 0 ? "today" : n === 1 ? "tmrw" : n + "d"}</span></span>`;
  }).join("");
  const tip = plnTip(X, now);
  const html = `<div class="xc${u.soon || u.live ? " soon" : ""}" style="--c:${esc(nx.colour)}">
    <div class="xc-hero">
      <div class="xc-k">${u.live ? "In the exam room" : "Next exam"}${plnHscDays().get(nx.date) ? ` · HSC day ${plnHscDays().get(nx.date)}` : ""}</div>
      <div class="xc-big">${plnBig(u)}${u.unit && !u.soon ? `<span>${esc(u.unit)}</span>` : ""}</div>
      <div class="xc-what">${esc(nx.subject)}${nx.paper && nx.paper !== nx.subject && nx.label !== "Exam" ? `<small>${esc(nx.paper)}</small>` : ""}</div>
      <div class="xc-when">${esc(fmtLong(nx.date))}${nx.start ? " · " + esc(nx.start + " – " + nx.end) : ""}</div>
    </div>
    <div class="xc-side">
      <div class="xc-chips">${chips}${ahead.length > 9 ? `<span class="xc-more">+${ahead.length - 9}</span>` : ""}</div>
      <div class="xc-days">${strip}</div>
      ${tip ? `<div class="xc-tip">${tip.text}${tip.check ? plnChecklist(tip.check) : ""}</div>` : ""}
    </div>
    <button type="button" class="xc-open" data-plgo="cal">Calendar →</button>
  </div>`;
  /* repainted on every refresh and every minute while somebody studies:
     only touched when it would actually look different */
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  box.hidden = false;
  return true;
}

/* ---------------------------------------------------------------------------
   CALENDAR: the hero numbers
   --------------------------------------------------------------------------- */
function plnHero(X) {
  const now = new Date(), today = todayISO();
  const ahead = X.list.filter(e => e.endAt > now);
  const done = X.list.length - ahead.length;
  const { cells } = plnStudied();
  let last7 = 0, plan7 = 0;
  for (let i = 0; i < 7; i++) {
    const p = addDays(today, -i), f = addDays(today, i + 1);
    cells.forEach((m, k) => { if (k.startsWith(p + "|")) last7 += m / 60; });
    plan7 += plnPlanDay(f);
  }
  const nx = ahead[0];
  const u = nx ? plnUntil(nx, now, true) : null;
  const last = X.list.length ? X.list[X.list.length - 1] : null;
  return `<div class="xh">
    <div class="xh-next" style="--c:${esc(nx ? nx.colour : "var(--accent)")}">
      ${nx ? `<div class="xh-k">${u.live ? "In the exam room now" : "Next exam"}</div>
        <div class="xh-big" id="xh-big">${plnBig(u)}${u.unit && !u.soon ? `<span>${esc(u.unit)}</span>` : ""}</div>
        <div class="xh-what">${esc(nx.subject)}${nx.label !== "Exam" ? " · " + esc(nx.paper || nx.label) : ""}</div>
        <div class="xh-when">${esc(fmtLong(nx.date))}${nx.start ? " · " + esc(nx.start + " – " + nx.end) : ""}</div>`
      : X.list.length ? `<div class="xh-k">That's the HSC</div><div class="xh-big">Done</div><div class="xh-what">Every paper is behind you. Go and enjoy it.</div>`
      : `<div class="xh-k">No exams yet</div><div class="xh-what">Add your subjects from the Knox list in Setup and every paper arrives with them.</div>`}
    </div>
    <div class="xh-tile"><span>Papers done</span><b>${done}<small> / ${X.list.length}</small></b>
      <i class="xh-bar"><i style="width:${X.list.length ? (done / X.list.length * 100).toFixed(1) : 0}%"></i></i></div>
    <div class="xh-tile"><span>Study days left</span><b>${plnStudyDays(ahead)}</b><small>to ${last ? esc(fmtD(last.date)) : "—"}, not counting exam days</small></div>
    <div class="xh-tile"><span>Last 7 days</span><b>${f1(last7)}<small> h</small></b><small>${plan7 ? f1(plan7) + " h planned for the next 7" : "nothing planned for the next 7 yet"}</small></div>
  </div>`;
}

/* ---------------------------------------------------------------------------
   CALENDAR: things to fix
   --------------------------------------------------------------------------- */
function plnFixHTML(X) {
  const items = [];
  X.wrong.forEach(({ s, c }) => {
    const off = c.exams.map(e => fmtD(e.date)).join(" and ");
    items.push(`<div class="xf-row"><span class="swatch" style="background:${esc(s.colour)}"></span>
      <div><b>${esc(s.name)}</b> has its exam date set to <b>${esc(fmtD(s.exam_date) + (s.exam_date.slice(0, 4) !== "2026" ? " " + s.exam_date.slice(0, 4) : ""))}</b>. NESA has it on <b>${esc(off)}</b>.</div>
      <button class="btn sm" data-plfix="${esc(s.id)}" data-plcourse="${esc(c.name)}">Fix the date</button></div>`);
  });
  const skipped = plnNotCourses();
  const unlinked = X.unlinked.filter(s => !skipped.includes(s.id));
  if (unlinked.length) {
    const opts = (CAT.active || CAT.subjects || []).filter(c => c.exams && c.exams.length)
      .map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
    unlinked.forEach(s => items.push(`<div class="xf-row"><span class="swatch" style="background:${esc(s.colour)}"></span>
      <div><b>${esc(s.name)}</b> isn't linked to an HSC exam. If it's an HSC course, pick it:</div>
      <span class="xf-pick"><select data-pllink="${esc(s.id)}"><option value="">Choose…</option>${opts}</select>
        <button class="btn ghost sm" type="button" data-plskip="${esc(s.id)}" title="Stop asking about this one">Not an HSC course</button></span></div>`));
  }
  if (!items.length) return "";
  return `<div class="card mb16 xf"><header><div><h2>Check your exams</h2>
    <div class="sub">So your countdown and calendar are right. Changing this updates the subject in Setup too.</div></div></header>
    <div class="body">${items.join("")}</div></div>`;
}
/* subjects you have told us are not HSC courses, so we stop asking */
const PLN_SKIP_KEY = () => "st.notcourse." + UID;
function plnNotCourses() { try { return JSON.parse(localStorage.getItem(PLN_SKIP_KEY()) || "[]"); } catch (e) { return []; } }
function plnSkipCourse(sid) {
  try { localStorage.setItem(PLN_SKIP_KEY(), JSON.stringify(plnNotCourses().concat([sid]))); } catch (e) { /* once a visit, then */ }
  $("cal-fix").innerHTML = plnFixHTML(plnExams());
}
async function plnFixSubject(sid, courseName, rename) {
  const c = CAT.byName(courseName);
  if (!c) return;
  const patch = { exam_date: c.exams.length ? c.exams[0].date : null };
  if (rename) patch.name = c.name;
  const { error } = await sb.from("subjects").update(patch).eq("id", sid);
  if (error) { toast("Could not change that — " + error.message, 4200); return; }
  const s = DB.subjects.find(x => x.id === sid);
  if (s) Object.assign(s, patch);
  toast(`${c.name}: ${c.exams.length ? c.exams.map(e => fmtD(e.date)).join(" and ") : "no written paper"}`);
  plnDirty();
  if (typeof refresh === "function") refresh(); else planRender();
}

/* ---------------------------------------------------------------------------
   CALENDAR: the lead-up chart
   --------------------------------------------------------------------------- */
function plnChartRows(X) {
  const subs = mySubjects(UID);
  const firstExam = new Map();
  X.list.forEach(e => { if (!firstExam.has(e.sid)) firstExam.set(e.sid, e); });
  const withExam = subs.filter(s => firstExam.has(s.id)).sort((a, b) => firstExam.get(a.id).at - firstExam.get(b.id).at);
  const others = subs.filter(s => !firstExam.has(s.id));
  return { withExam, others };
}
function plnChartDays(X) {
  const today = todayISO();
  const last = plnHscEnd(X) || addDays(today, 21);
  let start = PLN.back === 0
    ? (DB.sessions.filter(s => s.user_id === UID).map(s => s.day).sort()[0] || addDays(today, -14))
    : addDays(today, -PLN.back);
  if (start < "2026-09-01") start = "2026-09-01";
  const end = last > addDays(today, 7) ? last : addDays(today, 7);
  const days = [];
  for (let d = start; d <= end && days.length < 200; d = addDays(d, 1)) days.push(d);
  return days;
}

function plnChartHTML(X) {
  const today = todayISO(), now = new Date();
  const days = plnChartDays(X);
  const { cells, lists, lastDay } = plnStudied();
  const { withExam, others } = plnChartRows(X);
  const examAt = new Map();                       /* day|sid -> [exam] */
  X.list.forEach(e => { const k = e.date + "|" + e.sid; (examAt.get(k) || examAt.set(k, []).get(k)).push(e); });
  const lastExamOf = new Map();
  X.list.forEach(e => lastExamOf.set(e.sid, e));
  const otherRows = others.filter(s => days.some(d => cells.get(d + "|" + s.id)));
  const noneRow = days.some(d => cells.get(d + "|none"));
  /* the colour scale: the busiest tenth of your cells is full strength */
  const vals = [];
  days.forEach(d => { withExam.concat(otherRows).forEach(s => { const m = cells.get(d + "|" + s.id); if (m) vals.push(m); }); });
  vals.sort((a, b) => a - b);
  const full = Math.max(90, vals.length ? vals[Math.floor(vals.length * 0.9)] : 120);
  const alpha = m => (0.14 + 0.86 * Math.pow(Math.min(1, m / full), 0.8)).toFixed(3);

  const N = days.length;
  let h = `<div class="gx" style="--n:${N}">`;
  /* header: the HSC weeks, then the days */
  h += `<div class="gx-lab gx-corner"><span>Subject</span><small>exam · days · hours</small></div>`;
  let i = 0;
  while (i < N) {
    const d = days[i], w = plnHscWeek(d);
    let j = i;
    while (j + 1 < N && plnHscWeek(days[j + 1]) === w && (w !== null || parseD(days[j + 1]).getMonth() === parseD(d).getMonth())) j++;
    const label = w ? `HSC week ${w}` : parseD(d).toLocaleDateString("en-AU", { month: "long" });
    h += `<div class="gx-band${w ? " hsc" : ""}" style="grid-column:span ${j - i + 1}">${j - i >= 1 ? esc(label) : ""}</div>`;
    i = j + 1;
  }
  h += `<div class="gx-lab gx-corner2"></div>`;
  days.forEach(d => {
    const hd = plnHscDays().get(d);
    h += `<div class="gx-dh${d === today ? " today" : ""}${d < today ? " past" : ""}${dowIdx(d) > 4 ? " we" : ""}${parseD(d).getDate() === 1 ? " m1" : ""}" title="${esc(fmtLong(d) + (hd ? " · HSC day " + hd : ""))}">
      <span>${d === today ? "Now" : DOW[dowIdx(d)].slice(0, 1)}</span><b>${parseD(d).getDate()}</b>${hd ? `<i>D${hd}</i>` : ""}</div>`;
  });

  const rowHTML = (s, kind) => {
    const exs = X.list.filter(e => e.sid === s.id);
    const nx = exs.find(e => e.endAt > now);
    const finished = exs.length && !nx;
    let tot = 0;
    days.forEach(d => { tot += cells.get(d + "|" + s.id) || 0; });
    const idle = lastDay.get(s.id) ? daysBetween(lastDay.get(s.id), today) : null;
    const warn = nx && (idle === null || idle >= 4) && daysBetween(today, nx.date) <= 21;
    const meta = finished ? "Done ✓"
      : nx ? `${esc(fmtD(nx.date).replace(/^\w+, /, ""))} · ${Math.max(0, daysBetween(today, nx.date))}d`
      : kind === "other" ? "no exam" : "";
    let r = `<div class="gx-lab${finished ? " fin" : ""}" style="--c:${esc(s.colour || "#7B8D98")}" data-gxrow="${esc(s.id)}"
      title="${esc(s.name + (nx ? " · " + (nx.paper || "Exam") + " on " + fmtLong(nx.date) + (nx.start ? " at " + nx.start : "") : "") + " · " + f1(tot / 60) + " h shown" + (idle !== null ? " · last studied " + (idle === 0 ? "today" : idle + " days ago") : " · nothing logged yet"))}">
      <i></i><div><b>${esc(plnShort(s.name))}</b><small>${meta}${meta ? " · " : ""}${f1(tot / 60)}h${warn ? ` <em title="Not studied for ${idle === null ? "a while" : idle + " days"}">${idle === null ? "not started" : idle + "d idle"}</em>` : ""}</small></div></div>`;
    const lastEx = lastExamOf.get(s.id);
    days.forEach(d => {
      const k = d + "|" + s.id, m = cells.get(k) || 0, ex = examAt.get(k), plan = plnPlan(d, s.id);
      const after = lastEx && d > lastEx.date;
      const cls = ["gx-c"];
      if (d === today) cls.push("today");
      if (d < today) cls.push("past");
      if (dowIdx(d) > 4) cls.push("we");
      let style = "", body = "";
      if (ex) {
        cls.push("ex");
        const gone = ex.every(e => e.endAt <= now);
        if (gone) cls.push("gone");
        style = `--c:${esc(s.colour)}`;
        body = `<b>${gone ? "✓" : esc(ex.map(e => e.label === "Exam" ? "EXAM" : e.label).join("+"))}</b>`;
      } else if (after) {
        cls.push("after");
      } else if (d >= today && plan && !m) {
        cls.push("plan");
        style = `--c:${esc(s.colour)}`;
        body = `<span>${f1(plan).replace(/\.0$/, "")}</span>`;
      } else if (m > 0) {
        cls.push("on");
        style = `background:${plnRgba(s.colour, alpha(m))};--tx:${m / full > .55 ? "#fff" : "var(--ink)"}`;
        if (m >= 15) body = `<span>${f1(m / 60).replace(/\.0$/, "")}</span>`;
        if (plan && d <= today) cls.push(m / 60 >= plan ? "met" : "short");
      } else if (d > today) {
        cls.push("fut");
      }
      r += `<div class="${cls.join(" ")}" style="${style}" data-gx="${d}|${esc(s.id)}">${body}</div>`;
    });
    return r;
  };
  withExam.forEach(s => { h += rowHTML(s, "exam"); });
  if (otherRows.length || noneRow) h += `<div class="gx-sep" style="grid-column:1 / span ${N + 1}"></div>`;
  otherRows.forEach(s => { h += rowHTML(s, "other"); });
  /* totals: done (past), planned (future), against your goal */
  h += `<div class="gx-lab gx-totlab"><i></i><div><b>Total</b><small>hours a day</small></div></div>`;
  days.forEach(d => {
    let m = 0; cells.forEach((v, k) => { if (k.startsWith(d + "|")) m += v; });
    const hrs = m / 60, plan = plnPlanDay(d), g = goalFor(UID, d);
    const fut = d > today;
    const v = fut ? plan : hrs;
    const col = fut ? "transparent" : lvlColour(g > 0 ? hrs / g : (hrs > 0 ? 1 : null), hrs > 0);
    h += `<div class="gx-c gx-tot${fut ? " fut" : ""}${d === today ? " today" : ""}" style="--t:${col}"
      data-tip="${esc("<b>" + esc(fmtD(d)) + "</b>" + (fut ? (plan ? `${f1(plan)} h planned` : "Nothing planned") : `${hm(hrs)} studied` + (g ? ` of ${f1(g)} h goal` : "")))}">
      ${v >= 0.1 ? `<span>${f1(v).replace(/\.0$/, "")}</span>` : ""}</div>`;
  });
  h += `</div>`;
  return h;
}

function plnLegend() {
  return `<div class="gx-legend">
    <span><i class="lg-on"></i>Studied (darker is more)</span>
    <span><i class="lg-plan"></i>Planned</span>
    <span><i class="lg-ex"></i>Exam</span>
    <span><i class="lg-today"></i>Today</span>
    <span><i class="lg-after"></i>After that exam</span>
    <span class="gx-hint">Tap a past day to see the sessions · tap a day ahead to plan it</span>
  </div>`;
}

function plnCellTip(day, sid) {
  const s = subjById(sid) || { name: "No subject", colour: "#7B8D98" };
  const { lists, cells } = plnStudied();
  const k = day + "|" + sid, m = cells.get(k) || 0, plan = plnPlan(day, sid);
  const X = plnExams();
  const ex = X.list.filter(e => e.date === day && e.sid === sid);
  let t = `<b>${esc(fmtD(day))} · ${esc(s.name)}</b>`;
  ex.forEach(e => { t += `EXAM · ${esc(e.paper || e.subject)}${e.start ? `<br>${esc(e.start + " – " + e.end)}` : ""}<br>`; });
  const ss = (lists.get(k) || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  ss.forEach(x => {
    const ar = x.area_id && areaById(x.area_id);
    const end = x.created_at ? new Date(x.created_at) : null;
    const st = end ? new Date(end.getTime() - x.minutes * 60000) : null;
    t += `${st && x.day === isoOf(end) ? esc(clockOf(st)) + " · " : ""}${esc(ar ? ar.name : s.name)} · ${hm(x.minutes / 60)}<br>`;
  });
  if (m && !ss.length) t += `${hm(m / 60)} running now<br>`;
  if (m) t += `<em>${hm(m / 60)} studied${plan ? ` · ${f1(plan)} h planned ${m / 60 >= plan ? "✓" : ""}` : ""}</em>`;
  else if (day >= todayISO()) t += plan ? `<em>${f1(plan)} h planned · tap to change</em>` : `<em>Tap to plan this day</em>`;
  else if (!ex.length) t += `<em>Nothing logged</em>`;
  return t;
}

function plnDetailHTML(day, sid) {
  const s = subjById(sid);
  if (!s) return "";
  const { lists, cells } = plnStudied();
  const k = day + "|" + sid, ss = (lists.get(k) || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const m = cells.get(k) || 0, plan = plnPlan(day, sid);
  return `<div class="gx-detail" style="--c:${esc(s.colour)}">
    <div class="gxd-h"><i></i><b>${esc(fmtLong(day))} · ${esc(s.name)}</b>
      <span>${m ? hm(m / 60) + " studied" : "nothing logged"}${plan ? ` · ${f1(plan)} h planned` : ""}</span>
      <button class="x" data-gxclose aria-label="Close">&times;</button></div>
    ${ss.length ? `<div class="gxd-list">${ss.map(x => {
      const ar = x.area_id && areaById(x.area_id);
      const end = x.created_at ? new Date(x.created_at) : null, st = end ? new Date(end.getTime() - x.minutes * 60000) : null;
      return `<div class="gxd-row"><span>${st && x.day === isoOf(end) ? esc(clockOf(st)) + "–" + esc(clockOf(end)) : "time not recorded"}</span>
        <b>${esc(ar ? ar.name : "Whole subject")}</b><span>${hm(x.minutes / 60)}</span>${x.note ? `<small>${esc(x.note)}</small>` : ""}</div>`;
    }).join("")}</div>` : ""}
    <div class="gxd-acts"><button class="btn sm" data-gxlog="${day}|${esc(sid)}">Log ${esc(plnShort(s.name))} for ${day === todayISO() ? "today" : "this day"}</button></div>
  </div>`;
}

/* the little chooser for planning a day ahead */
function plnOpenPop(cell, day, sid) {
  plnClosePop();
  const s = subjById(sid);
  if (!s) return;
  const cur = plnPlan(day, sid);
  const pop = document.createElement("div");
  pop.className = "gx-pop"; pop.id = "gx-pop";
  pop.innerHTML = `<div class="gxp-h" style="--c:${esc(s.colour)}"><i></i><b>${esc(plnShort(s.name))}</b><span>${esc(fmtD(day))}</span></div>
    <div class="gxp-opts">${[0.5, 1, 1.5, 2, 3, 4].map(v => `<button type="button" data-gxp="${v}" class="${cur === v ? "on" : ""}">${v}h</button>`).join("")}</div>
    <div class="gxp-foot">${cur ? `<button type="button" data-gxp="0" class="gxp-clear">Remove plan</button>` : `<span>Hours to plan</span>`}</div>`;
  document.body.appendChild(pop);
  const r = cell.getBoundingClientRect(), w = pop.offsetWidth, ph = pop.offsetHeight;
  let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
  if (y + ph > innerHeight - 8) y = r.top - ph - 8;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + "px";
  pop.style.top = Math.max(8, y) + "px";
  pop.addEventListener("click", e => {
    const b = e.target.closest("[data-gxp]");
    if (!b) return;
    plnClosePop();
    plnSetPlan(day, sid, Number(b.dataset.gxp));
  });
  setTimeout(() => document.addEventListener("click", plnPopAway, true), 0);
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("gx-pop")) plnClosePop(); });
function plnPopAway(e) { if (!e.target.closest || !e.target.closest("#gx-pop")) plnClosePop(); }
function plnClosePop() {
  const p = $("gx-pop");
  if (p) p.remove();
  document.removeEventListener("click", plnPopAway, true);
}

/* ---------------------------------------------------------------------------
   CALENDAR: the month view
   --------------------------------------------------------------------------- */
function plnCohortExams() {
  /* every course somebody in the year group takes, with how many take it */
  const by = new Map();
  (DB.crewSubjects || []).forEach(g => {
    const c = catFor(g.label);
    if (!c || !c.exams || !c.exams.length) return;
    const n = Array.isArray(g.takers) ? g.takers.length : (g.takers && g.takers.size) || 0;
    const cur = by.get(c.name);
    by.set(c.name, { c, n: (cur ? cur.n : 0) + n });
  });
  const days = new Map();
  by.forEach(({ c, n }) => c.exams.forEach(e => {
    (days.get(e.date) || days.set(e.date, []).get(e.date)).push({ name: c.name, paper: e.paper, start: e.start, end: e.end, n, colour: c.colour });
  }));
  days.forEach(list => list.sort((a, b) => b.n - a.n));
  return days;
}
/* The last day of the HSC: the calendar and the chart run to here for
   everyone, so neither stops the day your own papers finish. */
function plnHscEnd(X) {
  let end = [...plnHscDays().keys()].pop() || "";
  if (X.list.length && X.list[X.list.length - 1].date > end) end = X.list[X.list.length - 1].date;
  return end;
}
/* One calendar, not a page a month: from the start of this month to the
   week the year group's last paper falls in, so it carries straight on
   into November. */
function plnMonthsHTML(X) {
  const today = todayISO();
  const t0 = parseD(today);
  const first = isoOf(new Date(t0.getFullYear(), t0.getMonth(), 1));
  const last = [plnHscEnd(X), addDays(today, 21)].sort().pop();
  const start = addDays(first, -dowIdx(first)), end = addDays(last, 6 - dowIdx(last));
  const { cells } = plnStudied();
  const cohort = PLN.cohort ? plnCohortExams() : null;
  const mine = new Map();
  X.list.forEach(e => (mine.get(e.date) || mine.set(e.date, []).get(e.date)).push(e));
  const mon = d => parseD(d).toLocaleDateString("en-AU", { month: "long" });
  const title = mon(first) === mon(last) ? parseD(first).toLocaleDateString("en-AU", { month: "long", year: "numeric" })
    : `${mon(first)} – ${mon(last)} ${parseD(last).getFullYear()}`;
  let h = `<div class="mc"><div class="mc-title">${esc(title)}</div>
    <div class="mc-grid">${DOW.map(d => `<span class="mc-dow">${d}</span>`).join("")}`;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dt = parseD(d), dn = dt.getDate();
    const es = mine.get(d) || [], hd = plnHscDays().get(d);
    let m = 0; cells.forEach((v, k) => { if (k.startsWith(d + "|")) m += v; });
    const plan = plnPlanDay(d);
    const co = cohort && cohort.get(d);
    const label = dn === 1 ? dt.toLocaleDateString("en-AU", { month: "short" }) + " " + dn : String(dn);
    h += `<button type="button" class="mc-day${d === today ? " today" : ""}${d < today ? " past" : ""}${es.length ? " ex" : ""}${dowIdx(d) > 4 ? " we" : ""}${dn === 1 ? " m1" : ""}${PLN.dayPick === d ? " sel" : ""}" data-mcday="${d}">
      <span class="mc-n">${esc(label)}${hd ? `<i>D${hd}</i>` : ""}</span>
      ${es.map(e => `<span class="mc-ex" style="--c:${esc(e.colour)}"><b>${esc(plnShort(e.subject))}${e.label !== "Exam" ? " " + e.label : ""}</b>${e.start ? `<small>${esc(plnTime(e.start))}</small>` : ""}</span>`).join("")}
      ${co && !es.length ? `<span class="mc-co">${co.length} paper${co.length === 1 ? "" : "s"} · ${co.reduce((a, x) => a + x.n, 0)} sitting</span>` : ""}
      ${co && es.length && co.length > es.length ? `<span class="mc-co">+${co.length - es.length} more</span>` : ""}
      ${d <= today ? `<span class="mc-h">${m >= 6 ? f1(m / 60) + "h" : ""}</span>` : plan ? `<span class="mc-h pl" title="${f1(plan)} h planned"><b>${f1(plan).replace(/\.0$/, "")}h</b><small> planned</small></span>` : ""}
    </button>`;
  }
  return h + `</div></div>`;
}
function plnDayDetailHTML(d, X) {
  const es = X.list.filter(e => e.date === d);
  const co = plnCohortExams().get(d) || [];
  const { cells, lists } = plnStudied();
  const studied = [];
  mySubjects(UID).forEach(s => { const m = cells.get(d + "|" + s.id); if (m) studied.push([s, m]); });
  const planned = mySubjects(UID).map(s => [s, plnPlan(d, s.id)]).filter(x => x[1] > 0);
  const hd = plnHscDays().get(d);
  return `<div class="mcd">
    <div class="mcd-h"><b>${esc(fmtLong(d))}</b>${hd ? `<span>HSC day ${hd}${plnHscWeek(d) ? " · week " + plnHscWeek(d) : ""}</span>` : ""}<button class="x" data-mcclose aria-label="Close">&times;</button></div>
    ${es.length ? `<div class="mcd-sec">Your exams</div>${es.map(e => `<div class="mcd-ex" style="--c:${esc(e.colour)}"><i></i><div><b>${esc(e.subject)}</b><small>${esc(e.paper || "")}</small></div><span>${esc(e.start ? e.start + " – " + e.end : "time TBC")}</span></div>`).join("")}` : ""}
    ${co.length ? `<div class="mcd-sec">The year group's exams</div><div class="mcd-co">${co.map(c => `<span style="--c:${esc(c.colour)}"><b>${esc(c.name)}</b>${c.paper && c.paper !== c.name ? " · " + esc(c.paper) : ""} · ${esc(c.start)}${c.n ? ` · <em>${c.n} of us</em>` : ""}</span>`).join("")}</div>` : (hd ? "" : `<div class="mcd-none">No HSC exams on this day.</div>`)}
    ${studied.length ? `<div class="mcd-sec">You studied</div><div class="mcd-co">${studied.map(([s, m]) => `<span style="--c:${esc(s.colour)}"><b>${esc(s.name)}</b> · ${hm(m / 60)}</span>`).join("")}</div>` : ""}
    ${planned.length ? `<div class="mcd-sec">Planned</div><div class="mcd-co">${planned.map(([s, h]) => `<span style="--c:${esc(s.colour)}"><b>${esc(s.name)}</b> · ${f1(h)} h</span>`).join("")}</div>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------------------
   CALENDAR: heads-up — the shape of your timetable, said plainly
   --------------------------------------------------------------------------- */
function plnHeadsHTML(X) {
  const now = new Date(), today = todayISO();
  const ahead = X.list.filter(e => e.endAt > now);
  if (!X.list.length) return `<div class="empty">Add your subjects in Setup and this fills with what's worth knowing about your timetable.</div>`;
  const items = [];
  const first = X.list[0], last = X.list[X.list.length - 1];
  items.push(["cal", `Your HSC runs <b>${esc(fmtD(first.date))}</b> to <b>${esc(fmtD(last.date))}</b>: ${X.list.length} paper${X.list.length === 1 ? "" : "s"} over ${daysBetween(first.date, last.date) + 1} days.`]);
  plnDoubles(ahead).forEach(d => items.push(["two", `<b>Double day, ${esc(fmtD(d.date))}</b>: ${d.list.map(e => esc(plnShort(e.subject)) + (e.label !== "Exam" ? " " + e.label : "") + " at " + esc(plnTime(e.start))).join(" and ")}. Revise both the day before.`]));
  /* runs of exam days in a row */
  const ds = [...new Set(ahead.map(e => e.date))].sort();
  for (let i = 0; i < ds.length;) {
    let j = i;
    while (j + 1 < ds.length && daysBetween(ds[j], ds[j + 1]) === 1) j++;
    if (j - i >= 1) {
      const names = ds.slice(i, j + 1).map(d => ahead.filter(e => e.date === d).map(e => esc(plnShort(e.subject)) + (e.label !== "Exam" ? " " + e.label : "")).join(" + "));
      items.push(["run", `<b>${j - i + 1} days in a row</b> from ${esc(fmtD(ds[i]))}: ${names.join(", then ")}. Get the later ones ready before the run starts.`]);
    }
    i = j + 1;
  }
  const gaps = plnGaps(ahead).filter(g => g.days >= 3).slice(0, 2);
  gaps.forEach(g => items.push(["gap", `<b>${g.days} free days</b> between ${esc(plnShort(g.from.subject))} (${esc(fmtD(g.from.date))}) and ${esc(plnShort(g.to.subject))} (${esc(fmtD(g.to.date))}). Your best window for ${esc(plnShort(g.to.subject))}.`]));
  if (ahead.length && daysBetween(today, ahead[0].date) > 0) {
    const free = daysBetween(today, ahead[0].date);
    items.push(["clock", `<b>${free} day${free === 1 ? "" : "s"}</b> until your first paper${ahead[0] === X.list[0] ? "" : " still to come"}, ${esc(plnShort(ahead[0].subject))}.`]);
  }
  /* the year group: who sits your papers with you */
  const co = plnCohortExams();
  const shared = ahead.map(e => { const c = (co.get(e.date) || []).find(x => x.name === e.course); return c && c.n > 1 ? [e, c.n] : null; }).filter(Boolean);
  if (shared.length) {
    const big = shared.slice().sort((a, b) => b[1] - a[1])[0];
    items.push(["crew", `<b>${big[1]} of the year group</b> sit ${esc(big[0].course)} with you on ${esc(fmtD(big[0].date))}.`]);
  }
  /* the year group's pace on your next subject */
  const crew7 = typeof PL !== "undefined" && PL.subjects && PL.subjects[7];
  if (crew7 && ahead.length) {
    const nx = ahead[0], row = crew7.find(r => catFor(r.label) && catFor(r.label).name === nx.course);
    if (row && row.people) {
      const { cells } = plnStudied();
      let mine = 0; for (let i = 0; i < 7; i++) mine += cells.get(addDays(today, -i) + "|" + nx.sid) || 0;
      items.push(["pace", `${esc(nx.course)}, last 7 days: you <b>${f1(mine / 60)} h</b>, the year group's average <b>${f1(row.minutes / row.people / 60)} h</b> per person who studied it.`]);
    }
  }
  const icon = { cal: "📅", two: "⚠️", run: "🔁", gap: "🪟", clock: "⏳", crew: "👥", pace: "📈" };
  return `<div class="xhd">${items.map(([k, t]) => `<div class="xhd-row"><span>${icon[k] || "•"}</span><div>${t}</div></div>`).join("")}</div>`;
}

/* ---------------------------------------------------------------------------
   Export: your exams into any calendar app, or as text to send someone
   --------------------------------------------------------------------------- */
function plnICS(X) {
  /* Sydney is on daylight time (UTC+11) from 4 October 2026, which covers
     every paper; written out in UTC so no calendar app can misread it. */
  const z = (d, t, off) => {
    const c = plnClock(t), p = d.split("-").map(Number);
    const u = new Date(Date.UTC(p[0], p[1] - 1, p[2], c[0] - (off || 11), c[1]));
    return u.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const escI = s => String(s || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Knox Study Track//HSC 2026//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", "X-WR-CALNAME:My HSC exams 2026"];
  X.list.forEach(e => {
    const uid = "hsc2026-" + (e.course + "-" + (e.paper || "") + "-" + e.date).toLowerCase().replace(/[^a-z0-9]+/g, "-") + "@studytrack";
    lines.push("BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + stamp);
    if (e.start && plnClock(e.start)) lines.push("DTSTART:" + z(e.date, e.start), "DTEND:" + z(e.date, e.end));
    else lines.push("DTSTART;VALUE=DATE:" + e.date.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addDays(e.date, 1).replace(/-/g, ""));
    lines.push("SUMMARY:" + escI("HSC: " + e.subject + (e.label !== "Exam" && e.paper ? " – " + e.paper.split("—")[0].trim() : "")),
      "DESCRIPTION:" + escI((e.paper ? e.paper + "\n" : "") + (e.start ? e.start + " – " + e.end + " (NESA 2026 timetable)\n" : "") + "Arrive 30 minutes early. Good luck."),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + escI("HSC tomorrow: " + e.subject), "TRIGGER:-PT15H", "END:VALARM",
      "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function plnText(X) {
  let last = "";
  return "My HSC 2026\n" + X.list.map(e => {
    const head = e.date !== last ? "\n" + fmtLong(e.date) + "\n" : "";
    last = e.date;
    return head + "  " + e.subject + (e.label !== "Exam" && e.paper ? " – " + e.paper : "") + (e.start ? "  " + e.start + " – " + e.end : "");
  }).join("\n");
}

/* ---------------------------------------------------------------------------
   Mounting and painting
   --------------------------------------------------------------------------- */
function plnMount() {
  if ($("cal-gantt")) return;
  const p = $("p-cal");
  if (!p) return;
  const tt = $("tt-list") && $("tt-list").closest(".card");
  p.insertAdjacentHTML("afterbegin", `
    <div id="cal-hero" class="mb16"></div>
    <div id="cal-fix"></div>
    <div class="card mb16" id="cal-gantt-card">
      <header><div><h2>Your lead-up</h2>
        <div class="sub">Every subject, every day, to each exam. Colour is how much you studied; dashed is what you've planned.</div></div>
        <div class="controls">
          <button class="chip" data-plback="14">2 weeks back</button><button class="chip" data-plback="28">4 weeks</button><button class="chip" data-plback="0">Everything</button>
        </div></header>
      <div class="body">
        <div class="gx-tools">
          <button class="btn sm" id="pl-suggest" type="button">✨ Suggest a plan</button>
          <button class="btn ghost sm" id="pl-undo" type="button" hidden>Undo suggestion</button>
          <button class="btn ghost sm" id="pl-clear" type="button">Clear plan</button>
          <span class="gx-toolnote" id="pl-note"></span>
        </div>
        <div class="gx-wrap" id="cal-gantt"></div>
        <div id="cal-legend"></div>
        <div id="cal-detail"></div>
      </div>
    </div>
    <div class="grid gCal mb16">
      <div class="card" id="cal-month-card">
        <header><div><h2>Calendar</h2><div class="sub">Your exams, what you studied and what you've planned. Tap a day for the detail.</div></div>
          <div class="controls"><button class="chip" id="pl-cohort" type="button" aria-pressed="false">Year group's exams</button></div></header>
        <div class="body"><div class="mc-wrap" id="cal-months"></div><div id="cal-daydetail"></div></div>
      </div>
      <div class="card" id="cal-heads-card">
        <header><div><h2>Worth knowing</h2><div class="sub">The shape of your timetable</div></div></header>
        <div class="body" id="cal-heads"></div>
      </div>
    </div>`);
  if (tt) {
    p.appendChild(tt);
    const head = tt.querySelector("header");
    if (head && !$("pl-ics")) head.insertAdjacentHTML("beforeend", `<div class="controls">
      <button class="btn ghost sm" id="pl-ics" type="button" title="Download your exams for Apple, Google or Outlook calendar">📅 Add to my calendar</button>
      <button class="btn ghost sm" id="pl-copy" type="button">Copy</button></div>`);
  }
  plnWire(p);
}

function plnWire(p) {
  p.addEventListener("click", async e => {
    const back = e.target.closest("[data-plback]");
    if (back) { PLN.back = Number(back.dataset.plback); plnPaintChart(); return; }
    if (e.target.closest("#pl-cohort")) { PLN.cohort = !PLN.cohort; plnPaintMonths(); return; }
    if (e.target.closest("[data-gxclose]")) { PLN.pick = null; $("cal-detail").innerHTML = ""; return; }
    if (e.target.closest("[data-mcclose]")) { PLN.dayPick = null; plnPaintMonths(); return; }
    const log = e.target.closest("[data-gxlog]");
    if (log) { const [d, sid] = log.dataset.gxlog.split("|"); plnGoLog(d, sid); return; }
    const skip = e.target.closest("[data-plskip]");
    if (skip) { plnSkipCourse(skip.dataset.plskip); return; }
    const fix = e.target.closest("[data-plfix]");
    if (fix) { fix.disabled = true; plnFixSubject(fix.dataset.plfix, fix.dataset.plcourse); return; }
    const md = e.target.closest("[data-mcday]");
    if (md) { PLN.dayPick = PLN.dayPick === md.dataset.mcday ? null : md.dataset.mcday; plnPaintMonths(); return; }
    const c = e.target.closest("[data-gx]");
    if (c) {
      const [d, sid] = c.dataset.gx.split("|");
      hideTT();
      /* a day ahead: plan it. Today or before: what you did */
      if (d > todayISO() && !c.classList.contains("ex") && !c.classList.contains("after")) { plnOpenPop(c, d, sid); return; }
      PLN.pick = d + "|" + sid;
      $("cal-detail").innerHTML = plnDetailHTML(d, sid);
      $("cal-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (e.target.closest("#pl-suggest")) { plnRunSuggest(); return; }
    if (e.target.closest("#pl-undo")) { plnRunUndo(); return; }
    if (e.target.closest("#pl-clear")) { plnRunClear(); return; }
    if (e.target.closest("#pl-ics")) { plnDownloadICS(); return; }
    if (e.target.closest("#pl-copy")) { plnCopy(); return; }
  });
  p.addEventListener("change", e => {
    const sel = e.target.closest("[data-pllink]");
    if (sel && sel.value) plnFixSubject(sel.dataset.pllink, sel.value, true);
  });
  p.addEventListener("mousemove", e => {
    const c = e.target.closest("[data-gx]");
    if (c) { const [d, sid] = c.dataset.gx.split("|"); showTT(e, plnCellTip(d, sid)); return; }
    const t = e.target.closest("[data-tip]");
    if (t) { showTT(e, t.dataset.tip); return; }
  });
  $("cal-gantt").addEventListener("mouseleave", hideTT);
}

function plnGoLog(day, sid) {
  CUR = day;
  const tab = document.querySelector('nav.tabs button[data-p="home"]');
  if (tab) tab.click();
  try { renderHome(); } catch (e) { /* the form is still there */ }
  if (typeof setPair === "function") setPair("f-subj", "f-area", sid, "", UID);
  const f = $("f-subj");
  if (f) { f.closest(".card").scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => { const m = $("f-min"); if (m) m.focus(); }, 400); }
  toast(`Logging ${(subjById(sid) || {}).name || "study"} for ${day === todayISO() ? "today" : fmtD(day)}`);
}

async function plnRunSuggest() {
  const X = plnExams();
  const before = new Map(PLN.plans);
  const rows = plnSuggest(X.list);
  if (!rows.length) { toast(X.list.some(e => e.endAt > new Date()) ? "Nothing to suggest: every day before your last exam already has a plan." : "No exams ahead to plan for.", 4200); return; }
  const hrs = rows.reduce((a, r) => a + r.hours, 0), ds = new Set(rows.map(r => r.day)).size;
  PLN.undo = { before, rows };
  const ok = await plnSetPlans(rows);
  if (ok) {
    $("pl-undo").hidden = false;
    $("pl-note").textContent = `Planned ${f1(hrs)} h over ${ds} day${ds === 1 ? "" : "s"}, nearest exams first. Tap any day to change it.`;
  }
}
async function plnRunUndo() {
  if (!PLN.undo) return;
  const { before, rows } = PLN.undo;
  PLN.undo = null;
  $("pl-undo").hidden = true;
  $("pl-note").textContent = "";
  await plnSetPlans(rows.map(r => ({ day: r.day, subject_id: r.subject_id, hours: before.get(r.day + "|" + r.subject_id) || 0 })));
}
async function plnRunClear() {
  const today = todayISO();
  const rows = [...PLN.plans.keys()].map(k => k.split("|")).filter(([d]) => d >= today).map(([d, sid]) => ({ day: d, subject_id: sid, hours: 0 }));
  if (!rows.length) { toast("You have nothing planned to clear."); return; }
  if (!confirm(`Clear your plan for ${new Set(rows.map(r => r.day)).size} days ahead? What you've already studied is untouched.`)) return;
  PLN.undo = null; $("pl-undo").hidden = true; $("pl-note").textContent = "";
  await plnSetPlans(rows);
}
function plnDownloadICS() {
  const X = plnExams();
  if (!X.list.length) { toast("No exams to export yet."); return; }
  const blob = new Blob([plnICS(X)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-hsc-exams-2026.ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Open the file to add every paper, with a reminder the evening before.", 4200);
}
async function plnCopy() {
  const X = plnExams();
  try { await navigator.clipboard.writeText(plnText(X)); toast("Timetable copied"); }
  catch (e) { toast("Could not copy on this browser"); }
}

function plnPaintChart() {
  const g = $("cal-gantt");
  if (!g) return;
  const X = plnExams();
  document.querySelectorAll("[data-plback]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.plback) === PLN.back)));
  if (!mySubjects(UID).length) { g.innerHTML = `<div class="empty">Add your subjects in Setup and your lead-up appears here.</div>`; return; }
  const keepLeft = g.dataset.drawn ? g.scrollLeft : null;
  g.innerHTML = plnChartHTML(X);
  $("cal-legend").innerHTML = plnLegend();
  const cw = parseFloat(getComputedStyle(g.querySelector(".gx")).getPropertyValue("--cw")) || 34;
  if (keepLeft === null) {
    const days = plnChartDays(X), ti = days.indexOf(todayISO());
    g.scrollLeft = Math.max(0, (ti - 4) * cw);
    g.dataset.drawn = "1";
  } else g.scrollLeft = keepLeft;
  if (PLN.pick) { const [d, sid] = PLN.pick.split("|"); $("cal-detail").innerHTML = plnDetailHTML(d, sid); }
}
function plnPaintMonths() {
  const el = $("cal-months");
  if (!el) return;
  const X = plnExams();
  $("pl-cohort") && $("pl-cohort").setAttribute("aria-pressed", String(PLN.cohort));
  el.innerHTML = plnMonthsHTML(X);
  $("cal-daydetail").innerHTML = PLN.dayPick ? plnDayDetailHTML(PLN.dayPick, X) : "";
}
function plnPaintCal() {
  const p = $("p-cal");
  if (!p || !p.classList.contains("on")) return;
  plnMount();
  const X = plnExams();
  $("cal-hero").innerHTML = plnHero(X);
  $("cal-fix").innerHTML = plnFixHTML(X);
  plnPaintChart();
  plnPaintMonths();
  $("cal-heads").innerHTML = plnHeadsHTML(X);
  if (typeof renderTimetable === "function") { try { renderTimetable(); } catch (e) { console.error(e); } }
}
/* after a plan changes: only what shows plans */
function plnRepaint() {
  try {
    if ($("p-cal") && $("p-cal").classList.contains("on")) { plnPaintChart(); plnPaintMonths(); $("cal-hero").innerHTML = plnHero(plnExams()); }
    planPaintCountdown();
  } catch (e) { console.error("plan", e); }
}

function planRender() {
  if (!UID || !ME) return;
  plnDirty();
  try {
    plnMount();
    const X = plnExams();
    planPaintStrip(X);
    planPaintCountdown();
    plnPaintCal();
    plnLoadPlans();
  } catch (e) { console.error("plan", e); }
}
function planTabOpened(tab) {
  if (tab === "cal") { try { plnPaintCal(); } catch (e) { console.error("plan", e); } }
}

/* Anything marked data-plgo="cal" opens the Calendar tab; a day in the
   Today strip opens it with that day picked in the month view. */
document.addEventListener("click", e => {
  const go = e.target.closest && e.target.closest("[data-plgo], [data-plday]");
  if (!go) return;
  if (go.dataset.plday) PLN.dayPick = go.dataset.plday;
  const tab = document.querySelector('nav.tabs button[data-p="cal"]');
  if (tab) tab.click();
  if (go.dataset.plday) setTimeout(() => { const m = $("cal-month-card"); if (m) m.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
});

/* The countdown moves by itself: once every 30 seconds is plenty for a
   figure in minutes, and only while the page is in view. */
setInterval(() => {
  if (!UID || !ME || document.hidden) return;
  try {
    const X = plnExams();
    planPaintStrip(X);
    const nx = X.list.find(e => e.endAt > new Date());
    if (nx && $("p-home") && $("p-home").classList.contains("on")) planPaintCountdown();
    const xb = $("xh-big");
    if (nx && xb && $("p-cal") && $("p-cal").classList.contains("on")) {
      const u = plnUntil(nx, new Date(), true);
      const h = plnBig(u) + (u.unit && !u.soon ? `<span>${esc(u.unit)}</span>` : "");
      if (xb.innerHTML !== h) xb.innerHTML = h;
    }
  } catch (e) { /* next time */ }
}, 30000);

if (typeof UID !== "undefined" && UID && typeof ME !== "undefined" && ME) planRender();
