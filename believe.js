/* =========================================================================
   BELIEVE — exam days
   -------------------------------------------------------------------------
   From midnight on the day of a paper, everyone sitting it gets a band at the
   top of every tab: the paper, a live countdown, one short line and the
   year's Believe sign. Anyone can wish the people sitting a paper good luck,
   and the people sitting it see how many did, and who.

   Nothing shows before the first HSC paper. profiles.believe_demo shows the
   band early on your own next paper, so it can be looked at (believe.sql).
   ========================================================================= */
const BLV = { wishes: new Map(), loadedKey: "", at: 0, busy: new Set(), open: null };
/* next to this script, wherever the page that loaded it lives */
const BLV_IMG = document.currentScript && document.currentScript.src ? new URL("believe.webp", document.currentScript.src).href : "believe.webp";

const blvDemo = () => !!(ME && ME.believe_demo);
function blvHscSpan() {
  const days = [...plnHscDays().keys()];
  return days.length ? [days[0], days[days.length - 1]] : null;
}
/* The day the band is about: today, or with the preview on, the day of your
   next paper. Null when there is nothing to show. */
function blvDay(X, now) {
  const today = todayISO();
  if (blvDemo()) {
    const nx = X.list.find(e => e.endAt > now);
    return nx ? nx.date : today;
  }
  const span = blvHscSpan();
  if (!span || today < span[0] || today > span[1]) return null;
  return today;
}

/* Every paper on a day, one entry per sitting: English Standard and Advanced
   sit the same Paper 1 at the same time, so they are one sitting. */
function blvSittings(day) {
  const by = new Map();
  (CAT.papers || []).filter(p => p.date === day).forEach(p => {
    const key = `${p.date}|${p.start}|${p.paper}`;
    const s = by.get(key) || by.set(key, { key, date: p.date, start: p.start, end: p.end, paper: p.paper, courses: [], colour: p.colour }).get(key);
    if (!s.courses.includes(p.subject)) s.courses.push(p.subject);
  });
  const sitting = new Map();
  plnCohortExams().forEach(list => list.forEach(c => sitting.set(c.name + "|" + c.paper + "|" + c.start, c.n)));
  return [...by.values()].map(s => Object.assign(s, {
    at: plnAt(s.date, s.start), endAt: plnAt(s.date, s.end), title: blvTitle(s),
    n: s.courses.reduce((a, c) => a + (sitting.get(c + "|" + s.paper + "|" + s.start) || 0), 0)
  })).sort((a, b) => a.at - b.at);
}
function blvTitle(s) {
  const short = String(s.paper || "").split(" — ")[0].trim();
  if (s.courses.length > 1) {
    const words = s.courses.map(c => c.split(" "));
    const common = [];
    for (let i = 0; words.every(w => w[i] && w[i] === words[0][i]); i++) common.push(words[0][i]);
    return (common.join(" ") || s.courses[0]) + " " + short;
  }
  const c = s.courses[0];
  const course = CAT.byName(c);
  if (!short || short === c) return c;
  return course && course.exams && course.exams.length > 1 && /^Paper \d/.test(short) ? `${c} ${short}` : `${c} · ${short}`;
}

/* One line, the same all day for a given paper. */
function blvLine(s, state, left) {
  if (state === "live") return `Pens down at ${plnTime(s.end)}.`;
  if (state === "done") return left ? `${left} to go. Rest up tonight.` : "That's the HSC. Done.";
  if (!left) return "Last one. Leave it all in there.";
  const lines = ["You've done the work. Good luck.", "Deep breath. You know this.", "Read the question twice. Back yourself.",
                 "Trust the prep. Good luck.", "One paper. Your best. Go get it."];
  let h = 0; for (const ch of s.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return lines[h % lines.length];
}

/* ---- wishes ----------------------------------------------------------- */
async function blvLoad(day, force) {
  if (!day || typeof sb === "undefined") return;
  if (!force && BLV.loadedKey === day && Date.now() - BLV.at < 45000) return;
  BLV.at = Date.now(); BLV.loadedKey = day;
  try {
    const { data, error } = await sb.rpc("exam_wishes_on", { p_dates: [day] });
    if (error) return;
    BLV.wishes = new Map(Object.entries(data || {}));
    believeRender(true);
  } catch (e) { /* next time */ }
}
async function blvWish(key, on) {
  if (BLV.busy.has(key)) return;
  BLV.busy.add(key);
  const w = BLV.wishes.get(key) || { n: 0, who: [], mine: false };
  const was = Object.assign({}, w, { who: (w.who || []).slice() });
  /* show it at once, put it back if the database says no */
  w.mine = on; w.n = Math.max(0, (w.n || 0) + (on ? 1 : -1));
  w.who = (w.who || []).filter(id => id !== UID);
  if (on && !(ME && ME.hide_hours)) w.who.unshift(UID);
  BLV.wishes.set(key, w);
  believeRender(true);
  try {
    const { data, error } = await sb.rpc("wish_luck", { p_date: key.slice(0, 10), p_sitting: key, p_on: on });
    if (error || !data || data.ok === false) throw new Error((data && data.why) || (error && error.message) || "Could not send");
    w.n = data.n;
    if (on) toast("Sent. Good luck to them.");
  } catch (e) {
    BLV.wishes.set(key, was);
    toast(e.message || "Could not send");
  }
  BLV.busy.delete(key);
  believeRender(true);
}

function blvWho(w, n) {
  const ids = (w && w.who) || [];
  const shown = ids.slice(0, 5).map(id => avatarHTML(profileOf(id), "sm")).join("");
  return `<span class="blv-faces">${shown}</span><span>${n === 1 ? "1 person has" : n + " people have"} wished you luck</span>`;
}
function blvWhoList(w) {
  const ids = (w && w.who) || [];
  const rest = Math.max(0, (w.n || 0) - ids.length);
  return `<div class="blv-list">${ids.map(id => { const p = profileOf(id); return `<span class="blv-person" data-profile="${esc(id)}">${avatarHTML(p, "sm")}<b>${esc(id === UID ? "You" : p.display_name)}</b></span>`; }).join("")}${
    rest ? `<span class="blv-more">+${rest} more</span>` : ""}</div>`;
}
function blvWishBtn(s, label) {
  const w = BLV.wishes.get(s.key) || {};
  return `<button type="button" class="blv-wish${w.mine ? " on" : ""}" data-blvwish="${esc(s.key)}" aria-pressed="${w.mine ? "true" : "false"}">${
    w.mine ? "Wished ✓" : esc(label || "Wish them luck")}</button>`;
}

/* ---- paint ------------------------------------------------------------ */
function blvHidden(day) { try { return localStorage.getItem("st.blv." + UID) === day; } catch (e) { return false; } }
function blvSetHidden(day, on) { try { on ? localStorage.setItem("st.blv." + UID, day) : localStorage.removeItem("st.blv." + UID); } catch (e) { /* this visit only */ } }

function believeRender(quiet) {
  const box = $("believe");
  if (!box || !UID || !ME) return;
  let html = "";
  try { html = blvHTML(); } catch (e) { console.error("believe", e); html = ""; }
  if (!html) { if (!box.hidden) { box.hidden = true; box.innerHTML = ""; box.dataset.sig = ""; } return; }
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  box.hidden = false;
  if (!quiet) blvLoad(box.dataset.day);
}

function blvHTML() {
  const now = new Date(), X = plnExams();
  const day = blvDay(X, now);
  const box = $("believe");
  if (!day) return "";
  box.dataset.day = day;
  const demo = blvDemo();
  const all = blvSittings(day);
  const mineKeys = new Set(X.list.filter(e => e.date === day && e.official).map(e => `${e.date}|${e.start}|${e.paper}`));
  const mine = all.filter(s => mineKeys.has(s.key));
  const others = all.filter(s => !mineKeys.has(s.key) && s.n > 0 && s.endAt > now);
  const left = X.list.filter(e => e.endAt > now).length;

  if (mine.length) {
    const cur = mine.find(s => s.endAt > now) || mine[mine.length - 1];
    const state = cur.endAt <= now ? "done" : now >= cur.at ? "live" : "pre";
    const u = plnUntil(cur, now, true);
    if (blvHidden(day)) {
      return `<button type="button" class="blv-slim" data-blvshow>${state === "pre" ? `<b>Believe</b> · ${esc(cur.title)} in ${esc(u.big)}` : state === "live" ? `<b>Believe</b> · in the exam now` : `<b>${esc(cur.title)}</b> · done`}<span>Show</span></button>`;
    }
    const w = BLV.wishes.get(cur.key) || { n: 0, who: [], mine: false };
    const kicker = demo && day !== todayISO()
      ? `<span class="blv-tag">Preview, only you can see this</span>${esc(fmtD(day))} · ${esc(plnTime(cur.start))}`
      : state === "pre" ? `Today · ${esc(plnTime(cur.start))}` : state === "live" ? "Right now" : "Today";
    const big = state === "pre" ? `in ${plnBig(u)}` : state === "live" ? "In the exam" : "Done.";
    const sitters = Math.max(0, cur.n - 1);
    return `<section class="blv blv-${state}" style="--c:${esc(cur.colour || "#4652A0")}" aria-label="Exam day">
      <div class="blv-body">
        <div class="blv-k">${kicker}</div>
        <div class="blv-title">${esc(cur.title)}</div>
        <div class="blv-big">${big}</div>
        <div class="blv-msg">${esc(blvLine(cur, state, state === "done" ? left : left - 1))}</div>
        <div class="blv-row">
          ${w.n ? `<button type="button" class="blv-pill" data-blvopen="${esc(cur.key)}">${blvWho(w, w.n)}</button>` : ""}
          ${state !== "done" && sitters ? blvWishBtn(cur, `Wish the other ${sitters} luck`) : ""}
        </div>
        ${BLV.open === cur.key && w.n ? blvWhoList(w) : ""}
        ${others.length ? `<div class="blv-also"><span>Also today</span>${others.map(s => `<span class="blv-chip">${esc(s.title)} · ${esc(plnTime(s.start))} · ${s.n} sitting ${blvWishBtn(s)}</span>`).join("")}</div>` : ""}
      </div>
      <img class="blv-img" src="${BLV_IMG}" alt="Believe" width="2000" height="1295" decoding="async">
      <button type="button" class="blv-x" data-blvhide aria-label="Make this smaller for today" title="Make this smaller for today">&times;</button>
    </section>`;
  }

  /* Nothing of yours today: the papers the year group is sitting, and a way
     to wish them luck. */
  if (!others.length) return "";
  if (blvHidden(day)) return `<button type="button" class="blv-slim lite" data-blvshow><b>Today in the HSC</b> · ${others.length} paper${others.length === 1 ? "" : "s"}<span>Show</span></button>`;
  return `<section class="blv lite" aria-label="Today in the HSC">
    <img class="blv-mark" src="${BLV_IMG}" alt="Believe" width="2000" height="1295" decoding="async">
    <div class="blv-body">
      <div class="blv-k">${demo && day !== todayISO() ? `<span class="blv-tag">Preview</span>${esc(fmtD(day))}` : "Today in the HSC"}</div>
      <div class="blv-sits">${others.map(s => {
        const w = BLV.wishes.get(s.key) || {};
        return `<div class="blv-sit" style="--c:${esc(s.colour)}"><i></i><div><b>${esc(s.title)}</b><small>${esc(plnTime(s.start))} · ${s.n} of us sitting${w.n ? ` · ${w.n} wished them luck` : ""}</small></div>${blvWishBtn(s)}</div>`;
      }).join("")}</div>
    </div>
    <button type="button" class="blv-x" data-blvhide aria-label="Make this smaller for today" title="Make this smaller for today">&times;</button>
  </section>`;
}

document.addEventListener("click", e => {
  const box = $("believe");
  if (!box || !box.contains(e.target)) return;
  const wb = e.target.closest("[data-blvwish]");
  if (wb) { const k = wb.dataset.blvwish; blvWish(k, !(BLV.wishes.get(k) || {}).mine); return; }
  const op = e.target.closest("[data-blvopen]");
  if (op) { BLV.open = BLV.open === op.dataset.blvopen ? null : op.dataset.blvopen; believeRender(true); return; }
  if (e.target.closest("[data-blvhide]")) { blvSetHidden(box.dataset.day, true); believeRender(true); return; }
  if (e.target.closest("[data-blvshow]")) { blvSetHidden(box.dataset.day, false); believeRender(true); }
});

/* The countdown moves; the wishes come in. Only while the page is in view. */
setInterval(() => {
  if (!UID || !ME || document.hidden) return;
  try { believeRender(true); const box = $("believe"); if (box && !box.hidden) blvLoad(box.dataset.day); } catch (e) { /* next time */ }
}, 30000);

if (typeof UID !== "undefined" && UID && typeof ME !== "undefined" && ME) believeRender();
