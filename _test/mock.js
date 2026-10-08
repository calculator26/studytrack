/* In-memory stand-in for supabase-js, used only to exercise the UI locally. */
(function () {
  /* Lets the app skip anything that cannot work against a mock backend,
     such as registering a service worker that does not exist here. */
  window.STUDYTRACK_MOCK = true;

  const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const T = { profiles: [], subjects: [], areas: [], sessions: [], goals: [], live_timers: [], admin_audit: [],
              notification_prefs: [], push_subscriptions: [], notification_log: [],
              nudges: [], messages: [], timer_reactions: [], session_reactions: [], study_plan: [] };
  const ME = uid(1);
  const CAT_MOCK_SITTINGS = ["2026-10-13|9.50 am|Paper 1 — Texts and Human Experiences", "2026-10-13|2.00 pm|Japanese Continuers"];
  const today = () => { const d = new Date(); const p = n => String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
  const add = (s, n) => { const d = new Date(s); d.setDate(d.getDate()+n); const p=x=>String(x).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };

  const joined = n => new Date(Date.now() - n * 864e5).toISOString();
  const people = [
    { id: ME,     display_name: "Lewis Christie", colour: "#2FCFA6", onboarded: !/onboard=1/.test(location.search), default_goal: 3, weekday_goals: [3,3,3,3,2,5,5], believe_demo: /believe=1/.test(location.search) },
    { id: uid(2), display_name: "Sam Whitfield",  colour: "#C0564C", onboarded: true, default_goal: 4, weekday_goals: [4,4,4,4,3,6,6] },
    { id: uid(3), display_name: "Priya Raman",    colour: "#7A6BB5", onboarded: true, default_goal: 5, weekday_goals: [5,5,5,5,4,7,7] },
    { id: uid(4), display_name: "Tom Beckett",    colour: "#C9A227", onboarded: true, default_goal: 2, weekday_goals: [2,2,2,2,2,4,4] }
  ];
  people.forEach((p, i) => p.created_at = joined(30 - i * 2));
  people.forEach(p => { p.hide_hours = false; p.hide_others = false; });
  const EMAIL = {};
  people.forEach(p => { EMAIL[p.id] = p.display_name.toLowerCase().replace(/[^a-z]+/g, ".") + "@student.knox.nsw.edu.au"; });
  T.profiles = people;

  /* Reminder prefs for the signed-in stand-in, so the Study reminders card
     and its calendar link render as they would in the real app. */
  T.notification_prefs = [{
    user_id: ME, push_on: false, remind_at: "19:30:00", timezone: "Australia/Sydney",
    quiet_days: [], weekly_digest: true, feed_token: "00000000-0000-4000-8000-0000000000ff"
  }];

  /* The real 2026 dates, as the onboarding picker fills them in, except
     Enterprise Computing: typed in by hand with the wrong year, the way one
     real member's was, so the Calendar tab's "fix the date" has something
     to fix. */
  const subjectDefs = [
    ["English Advanced", "#3E7CA6", "2026-10-13", ["Common Module — 1984","Module A — Hag-Seed","Module B — Eliot","Module C — Craft"]],
    ["Business Studies", "#C0564C", "2026-10-26", ["Operations","Marketing","Finance","HR","Past papers"]],
    ["Mathematics Standard 2", "#3FA98A", "2026-10-19", ["Question Practice","Error Review"]],
    ["Enterprise Computing", "#C9A227", "2008-10-29", ["Content","Technical"]]
  ];
  let sid = 100, aid = 500, ssid = 1000;
  people.forEach(p => {
    subjectDefs.forEach(([name, colour, exam, areas], i) => {
      const s = { id: uid(sid++), user_id: p.id, name, colour, exam_date: exam, position: i };
      T.subjects.push(s);
      areas.forEach((an, j) => T.areas.push({ id: uid(aid++), user_id: p.id, subject_id: s.id, name: an,
        position: j, target_hours: 10 + j * 4, current_pct: 78 + ((j * 7 + i * 5) % 22) }));
    });
  });

  /* Everyone above is given identical subject names, which is not what real
     data looks like. These four rename one person's subject each so the
     leaderboard's subject matching has something to prove:
       · case and spacing must fold together silently
       · punctuation-only drift must be spotted and called out
       · a genuinely different name must stand on its own, and be marked
         custom rather than silently folded into the catalogue one          */
  const rename = (who, from, to) => {
    const row = T.subjects.find(x => x.user_id === who && x.name === from);
    if (row) row.name = to;
  };
  rename(uid(2), "English Advanced", "english advanced");          /* folds */
  rename(uid(3), "Business Studies", "Business  Studies");         /* folds */
  rename(uid(4), "Enterprise Computing", "Enterprise Computing.");  /* near miss */
  rename(uid(4), "Mathematics Standard 2", "Maths Standard 2");     /* stands alone */
  const notes = ["Two body paragraphs under time. Second ran long.",
    "Section II past paper — 33/40. Marketing was the weak one.",
    "Reworked every error from yesterday's paper.", "Quote table done, 14 memorised.", null, null];
  const modes = ["Consolidate","Drill","Write to time","Timed paper","Review"];
  people.forEach((p, pi) => {
    const areas = T.areas.filter(a => a.user_id === p.id);
    for (let d = 20; d >= 0; d--) {
      const day = add(today(), -d);
      const n = (d + pi) % 5 === 0 ? 0 : 1 + ((d * 3 + pi) % 3);
      for (let k = 0; k < n; k++) {
        const a = areas[(d * 2 + k + pi) % areas.length];
        T.sessions.push({ id: uid(ssid++), user_id: p.id, subject_id: a.subject_id, area_id: a.id,
          day, minutes: [45, 60, 90, 120, 30][(d + k + pi) % 5],
          mode: modes[(d + k) % modes.length], note: notes[(d + k + pi) % notes.length],
          /* filed at a believable time of day: after school, then the evening */
          created_at: (() => {
            const t = new Date(day + "T00:00:00"); t.setHours([16, 19, 21, 8][(k + pi + d) % 4] + k, (d * 7 + pi * 11) % 60);
            return (t.getTime() > Date.now() ? new Date(Date.now() - (k + 1) * 36e5) : t).toISOString();
          })() });
      }
    }
  });
  /* Enough chat to see the grouping, the hour pills and a long message wrap. */
  (function seedChat() {
    const mins = n => new Date(Date.now() - n * 60000).toISOString();
    const said = [
      [uid(3), 190, "has anyone started the Eliot essay yet"],
      [uid(2), 188, "yeah I did a plan last night, the Module B one is brutal"],
      [uid(2), 187, "happy to share my quote table if anyone wants it"],
      [uid(3), 150, "yes please"],
      [uid(4), 96,  "does anyone know if the Standard 2 paper has the formula sheet"],
      [ME,     64,  "it does, it's on the back page"],
      [uid(3), 33,  "just did two hours on Hag-Seed and my brain is soup"],
      [uid(2), 12,  "same. taking a break then doing one more"],
      [uid(4), 4,   "good luck everyone"],
      [uid(2), 2,   "@Lewis Christie did you get question 14 out", [ME]]
    ];
    said.forEach(([u, ago, body, at], i) =>
      T.messages.push({ id: uid(1200 + i), user_id: u, body, mentions: at || [],
                        image_path: null, created_at: mins(ago) }));
  })();

  /* ?dirty=1 seeds one entry per integrity rule so the admin console's
     detection can actually be exercised locally. Off by default. */
  if (/dirty=1/.test(location.search)) {
    const sam = uid(2), pri = uid(3);
    const samAreas = T.areas.filter(a => a.user_id === sam);
    const A = samAreas[0], B = samAreas[1];
    const mk = o => T.sessions.push(Object.assign({ id: uid(ssid++), user_id: sam,
      subject_id: A.subject_id, area_id: A.id, mode: null, note: null,
      created_at: new Date().toISOString() }, o));

    mk({ day: add(today(), -1), minutes: 480, note: "marathon — should flag as a long session" });
    mk({ day: add(today(), 4),  minutes: 60,  note: "dated next week — should flag as future" });
    mk({ day: add(today(), -900), minutes: 90, note: "long before joining — should flag" });
    mk({ day: add(today(), -2), minutes: 120, subject_id: B.subject_id, area_id: B.id, note: "twin — exact duplicate" });
    mk({ day: add(today(), -2), minutes: 120, subject_id: B.subject_id, area_id: B.id, note: "twin — exact duplicate " });
    /* same everything but the description: two real blocks, must NOT flag */
    mk({ day: add(today(), -2), minutes: 120, subject_id: B.subject_id, area_id: B.id, note: "evening block, not a copy" });
    /* exactly five hours is a long session; a minute under is not */
    mk({ day: add(today(), -5), minutes: 300, note: "five hours on the dot — should flag as long" });
    mk({ day: add(today(), -6), minutes: 299, note: "a minute under five hours — must not flag" });
    for (let i = 0; i < 6; i++) mk({ day: add(today(), -3), minutes: 180, note: "impossible day filler " + i });

    T.live_timers.push({ user_id: pri, label: "Left running overnight", subject_id: null, area_id: null,
      started_at: new Date(Date.now() - 11 * 3600e3).toISOString(), acc_ms: 0, running: true,
      updated_at: new Date().toISOString() });
  }

  /* Two mates have prodded you, so the collapsed banner is visible locally. */
  T.nudges.push(
    { id: uid(900), from_user: uid(2), to_user: ME, seen_at: null,
      created_at: new Date(Date.now() - 9 * 60000).toISOString() },
    { id: uid(901), from_user: uid(3), to_user: ME, seen_at: null,
      created_at: new Date(Date.now() - 3 * 60000).toISOString() });

  /* ?stuck=1 reproduces the timer nobody could get rid of: a row of YOUR OWN
     left running for 25 hours. Discarding it has to work from a cold load. */
  if (/stuck=1/.test(location.search)) {
    T.live_timers.push({ user_id: ME, label: "English Advanced", subject_id: null, area_id: null,
      started_at: new Date(Date.now() - 25 * 3600e3).toISOString(), acc_ms: 0, running: true,
      updated_at: new Date(Date.now() - 25 * 3600e3).toISOString() });
  }

  /* ?carry=1: your own timer, begun forty minutes ago and resumed after a
     pause ten minutes ago, so started_at has moved but began_at has not. Two
     sus and a kudos on it, aimed at began_at. They must still show, and must
     land on the session when it is saved. */
  if (/carry=1/.test(location.search)) {
    const began = new Date(Date.now() - 40 * 60000).toISOString();
    T.live_timers.push({ user_id: ME, label: "English Advanced", subject_id: null, area_id: null,
      began_at: began, started_at: new Date(Date.now() - 10 * 60000).toISOString(), acc_ms: 20 * 60000,
      running: true, updated_at: new Date().toISOString() });
    [[2, "sus"], [3, "sus"], [4, "kudos"]].forEach(([n, k]) => T.timer_reactions.push({ owner_id: ME,
      user_id: uid(n), kind: k, for_started_at: began, created_at: new Date().toISOString() }));
  }

  T.live_timers.push({ user_id: uid(3), label: "Module B — Eliot · Write to time", subject_id: null, area_id: null,
    started_at: new Date(Date.now() - 22 * 60000).toISOString(), acc_ms: 0, running: true,
    updated_at: new Date().toISOString() });
  T.live_timers.push({ user_id: uid(2), label: "Finance · Drill", subject_id: null, area_id: null,
    started_at: new Date().toISOString(), acc_ms: 47 * 60000, running: false,
    updated_at: new Date().toISOString() });

  /* ?big=1: the real year group's size, for checking the app stays smooth.
     250 members, sixty days of sessions each, thirty timers running and a
     busy room. */
  if (/big=1/.test(location.search)) {
    const first = ["Sam","Josh","Will","Jack","Tom","Max","Ryan","Aidan","Nick","James","Ben","Harry","Ollie","Luke","Ethan","Noah","Liam","Kai","Leo","Zac"];
    const last = ["Smith","Nguyen","Brown","Wilson","Taylor","Lee","Martin","White","Clark","Hall","Young","King","Wright","Scott","Green"];
    const cols = ["#3E7CA6","#C0564C","#3FA98A","#C9A227","#7A6BB5","#D96C3B","#2F80ED","#B4339C","#0F8FA0","#6B8E23"];
    let sx = 9000, subx = 20000, mx = 30000;
    for (let i = 0; i < 246; i++) {
      const id = uid(100000 + i);
      T.profiles.push({ id, display_name: first[i % 20] + " " + last[(i * 7) % 15], colour: cols[i % 10], onboarded: true,
        default_goal: 2 + (i % 5), weekday_goals: null, created_at: joined(60), hide_hours: i % 23 === 0, hide_others: false });
      const sj = [["English Advanced","#3E7CA6"],["Mathematics Advanced","#3FA98A"],["Business Studies","#C0564C"]].map(([n, c], k) => {
        const r = { id: uid(subx++), user_id: id, name: n, colour: c, exam_date: null, position: k }; T.subjects.push(r); return r; });
      /* a fourth subject, so the year group's papers run later than yours */
      T.subjects.push({ id: uid(subx++), user_id: id, name: ["Chemistry", "Modern History", "Economics", "Japanese Continuers", "Physics", "Agriculture"][i % 6],
        colour: cols[(i + 3) % 10], exam_date: null, position: 3 });
      for (let d = 60; d >= 0; d--) {
        if ((d * 13 + i) % 6 === 0) continue;
        const day = add(today(), -d);
        for (let k = 0; k < 1 + ((d + i) % 3); k++) {
          const mins = [40, 60, 90, 120, 75][(d + k + i) % 5];
          const t = new Date(day + "T00:00:00"); t.setHours(9 + k * 3 + (i % 6), (i * 7) % 60);
          T.sessions.push({ id: uid(sx++), user_id: id, subject_id: sj[(d + k) % 3].id, area_id: null, day, minutes: mins,
            mode: null, note: null, created_at: (t.getTime() > Date.now() ? new Date(Date.now() - 36e5) : t).toISOString() });
        }
      }
      if (i < 30) T.live_timers.push({ user_id: id, label: sj[i % 3].name, subject_id: null, area_id: null,
        started_at: new Date(Date.now() - (5 + i * 3) * 60000).toISOString(), acc_ms: 0, running: i % 4 !== 0,
        updated_at: new Date().toISOString() });
    }
    for (let m = 0; m < 220; m++) T.messages.push({ id: uid(mx++), user_id: uid(100000 + (m * 17) % 246),
      body: ["larp", "who's at macq", "locked in", "anyone have mod b questions?", "sus", "quote of the day pls"][m % 6],
      mentions: [], created_at: new Date(Date.now() - (220 - m) * 4 * 60000).toISOString() });
  }

  /* ?larp=1: larp reports are switched off (the branch larp-reports has
     them), but two of their old alerts are still rows in messages, and the
     room must not show them. Also a busier board — more people, Priya over
     four hours, ten sus on two live timers. */
  if (/larp=1/.test(location.search)) {
    const extra = [["Jack Nolan", "#1f7ea1"], ["Mia Chen", "#831199"], ["Oli Park", "#1a8649"],
                   ["Zac Ford", "#804913"], ["Ben Ng", "#5918d4"]];
    extra.forEach(([n, c], i) => T.profiles.push({ id: uid(5 + i), display_name: n, colour: c, onboarded: true,
      default_goal: 3, weekday_goals: null, hide_hours: false, hide_others: false, created_at: joined(20) }));
    const pri = uid(3), tom = uid(4), sam = uid(2);
    T.sessions.push({ id: uid(ssid++), user_id: pri, subject_id: null, area_id: null, day: today(), minutes: 250,
      note: "Past paper then flashcards", created_at: new Date(Date.now() - 50 * 60000).toISOString() });
    const t = T.live_timers.find(r => r.user_id === pri);
    const st = T.live_timers.find(r => r.user_id === sam);
    [2, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach(n => T.timer_reactions.push({ owner_id: pri, user_id: uid(n), kind: "sus",
      for_started_at: t.started_at, created_at: new Date().toISOString() }));
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach(n => T.timer_reactions.push({ owner_id: sam, user_id: uid(n), kind: "sus",
      for_started_at: st.started_at, created_at: new Date().toISOString() }));
    T.messages.push(
      { id: uid(1290), user_id: sam, body: "LARP ALERT: 5 people think Sam Whitfield is larping.", mentions: [sam],
        image_path: null, created_at: new Date(Date.now() - 26 * 3600e3).toISOString(), larp_trial: uid(801) },
      { id: uid(1291), user_id: tom, body: "LARP ALERT: 5 people think Tom Beckett is larping.", mentions: [tom],
        image_path: null, created_at: new Date(Date.now() - 40 * 60000).toISOString(), larp_trial: uid(800) });
    T.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  function builder(table) {
    /* pretend the other members' tabs are still open and still beating */
    if (table === "live_timers") {
      const stamp = new Date().toISOString();
      T.live_timers.forEach(r => { if (r.user_id !== ME) r.updated_at = stamp; });
    }
    /* Stands in for the row level policy on these two tables: somebody with
       hide_hours on is invisible to everyone but themselves and an admin. The
       real rule is in the database — this is only so the behaviour can be
       exercised locally. */
    const isAdminHere = !/admin=0/.test(location.search);
    let rows = T[table] ? T[table].slice() : [];
    if ((table === "sessions" || table === "live_timers") && !isAdminHere) {
      const hidden = {};
      T.profiles.forEach(p => { if (p.hide_hours && p.id !== ME) hidden[p.id] = 1; });
      rows = rows.filter(r => !hidden[r.user_id]);
    }
    const filters = [];
    let sort = null, cap = null, embed = false, orExpr = "";
    const api = {
      /* The app asks for "*, subjects(name, colour), areas(name)" on the feed,
         so the two names travel with the row instead of this client holding
         everybody's subject tables. Mimicked here rather than ignored. */
      select(cols) { embed = typeof cols === "string" && cols.indexOf("(") > -1; return api; },
      /* PostgREST's or(), used to fetch your own goals plus the window */
      or(expr) { orExpr = String(expr || ""); return api; },
      /* honoured rather than ignored, so local ordering matches production */
      order(col, opts) { sort = { col, asc: !opts || opts.ascending !== false }; return api; },
      limit(n) { cap = n; return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      in(col, vals) { filters.push([col, vals, "in"]); return api; },
      gt(col, val)  { filters.push([col, val, "gt"]);  return api; },
      lt(col, val)  { filters.push([col, val, "lt"]);  return api; },
      gte(col, val) { filters.push([col, val, "gte"]); return api; },
      is(col, val) { filters.push([col, val, "is"]); return api; },
      single() { const r = apply(); return Promise.resolve({ data: r[0] || null, error: null }); },
      insert(payload) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const made = arr.map(o => Object.assign({ id: uid(ssid++), created_at: new Date().toISOString() }, o));
        T[table].push(...made);
        const p = Promise.resolve({ data: made, error: null });
        /* as PostgREST: select() gives back every row inserted, single() the first */
        p.select = () => { const q = Promise.resolve({ data: made, error: null });
                           q.single = () => Promise.resolve({ data: made[0], error: null }); return q; };
        return p;
      },
      upsert(payload) {
        const arr = Array.isArray(payload) ? payload : [payload];
        arr.forEach(o => {
          const key = table === "goals" ? r => r.user_id === o.user_id && r.day === o.day
                    : table === "live_timers" ? r => r.user_id === o.user_id
                    : r => r.id === o.id;
          const i = T[table].findIndex(key);
          if (i >= 0) Object.assign(T[table][i], o); else T[table].push(Object.assign({ id: uid(ssid++) }, o));
        });
        return Promise.resolve({ data: arr, error: null });
      },
      /* An update reports nothing back unless you ask with select(), which is
         how PostgREST behaves — and the timer heartbeat leans on it to tell a
         row it actually touched from a row that is no longer there. */
      update(patch) {
        const run = () => {
          const hit = apply();
          hit.forEach(r => Object.assign(r, patch));
          const rows = hit.map(r => Object.assign({}, r));
          const pr = Promise.resolve({ data: null, error: null });
          pr.select = () => Promise.resolve({ data: rows, error: null });
          return pr;
        };
        const p = Promise.resolve({ data: null, error: null });
        p.eq = (c, v) => { filters.push([c, v]); return run(); };
        p.in = (c, vals) => { filters.push([c, vals, "in"]); return run(); };
        return p;
      },
      delete() { const p = Promise.resolve({ data: null, error: null });
        p.in = (c, v) => { filters.push([c, v, "in"]); const gone = apply();
          T[table] = T[table].filter(r => !gone.includes(r));
          return Promise.resolve({ data: null, error: null }); };
        p.eq = (c, v) => { filters.push([c, v]); const gone = apply();
          T[table] = T[table].filter(r => !gone.includes(r));
          const q = Promise.resolve({ data: null, error: null });
          q.eq = (c2, v2) => { filters.push([c2, v2]); const g2 = apply();
            T[table] = T[table].filter(r => !g2.includes(r)); return Promise.resolve({ data: null, error: null }); };
          return q; };
        return p; },
      then(res) { return Promise.resolve({ data: apply(), error: null }).then(res); }
    };
    function apply() {
      let out = (T[table] || []).filter(r => filters.every(([c, v, op]) =>
        op === "in"  ? v.includes(r[c]) :
        op === "gt"  ? String(r[c]) >  String(v) :
        op === "lt"  ? String(r[c]) <  String(v) :
        op === "gte" ? String(r[c]) >= String(v) :
        r[c] === v));
      if (orExpr) {
        /* only the one shape the app uses: user_id.eq.<id>,day.gte.<date> */
        const parts = orExpr.split(",").map(x => x.split("."));
        out = out.filter(r => parts.some(([col, op, val]) =>
          op === "eq" ? String(r[col]) === val : op === "gte" ? String(r[col]) >= val : false));
      }
      if (sort) {
        const { col, asc } = sort;
        out = out.slice().sort((a, b) => {
          const x = a[col], y = b[col];
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return (x < y ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      out = cap != null ? out.slice(0, cap) : out;
      if (embed) out = out.map(r => {
        const sub = T.subjects.find(x => x.id === r.subject_id);
        const ar  = T.areas.find(x => x.id === r.area_id);
        return Object.assign({}, r, {
          subjects: sub ? { name: sub.name, colour: sub.colour } : null,
          areas:    ar  ? { name: ar.name } : null
        });
      });
      return out;
    }
    return api;
  }

  window.supabase = {
    createClient() {
      return {
        auth: (function () {
          /* Shaped like supabase-js so the real auth flow can be exercised locally.
             ?signedout=1  start on the sign-in screen
             ?taken=1      signUp reports the email as already registered
             ?confirm=1    signUp needs an email confirmation before sign-in works
             ?badpass=1    signInWithPassword rejects                             */
          const q = location.search;
          const flag = n => new RegExp("[?&]" + n + "=1").test(q);
          const session = () => ({ user: { id: ME, email: "lewis@example.com", user_metadata: {} } });
          let signedIn = !flag("signedout");
          let listener = null;
          const fire = (ev, s) => { if (listener) setTimeout(() => listener(ev, s), 0); };
          return {
            getSession: () => Promise.resolve({ data: { session: signedIn ? session() : null } }),
            onAuthStateChange: cb => { listener = cb;
              return { data: { subscription: { unsubscribe() { listener = null; } } } }; },
            signInWithPassword: () => {
              if (flag("badpass"))
                return Promise.resolve({ data: null, error: { message: "Invalid login credentials" } });
              if (flag("confirm") && !signedIn)
                return Promise.resolve({ data: null, error: { message: "Email not confirmed" } });
              signedIn = true;
              const s = session(); fire("SIGNED_IN", s);
              return Promise.resolve({ data: { session: s, user: s.user }, error: null });
            },
            signUp: () => {
              if (flag("taken"))
                return Promise.resolve({ data: { user: { id: ME, identities: [] }, session: null }, error: null });
              if (flag("confirm"))
                return Promise.resolve({ data: { user: { id: ME, identities: [{}] }, session: null }, error: null });
              signedIn = true;
              const s = session(); fire("SIGNED_IN", s);
              return Promise.resolve({ data: { user: s.user, session: s }, error: null });
            },
            signOut: () => { signedIn = false; fire("SIGNED_OUT", null); return Promise.resolve({ error: null }); }
          };
        })(),
        from: builder,
        /* ?admin=0 exercises the non-admin path — the console entry should
           then never appear, and openAdmin() should refuse. */
        rpc: (name, args) => {
          if (name === "delete_own_account") return Promise.resolve({ data: null, error: null });
          /* Mirrors carry_timer_reactions(): the live timer's reactions copied
             onto the session just saved from it. */
          if (name === "carry_timer_reactions") {
            const sid = args && args.session_id, t = T.live_timers.find(r => r.user_id === ME);
            T.session_reactions = T.session_reactions || [];
            if (!t || !T.sessions.some(r => r.id === sid && r.user_id === ME))
              return Promise.resolve({ data: [], error: null });
            const began = t.began_at || t.started_at;
            const made = T.timer_reactions.filter(r => r.owner_id === ME && r.for_started_at === began && r.user_id !== ME)
              .map(r => ({ session_id: sid, user_id: r.user_id, kind: r.kind }));
            T.session_reactions.push(...made);
            return Promise.resolve({ data: made.map(r => ({ user_id: r.user_id, kind: r.kind })), error: null });
          }
          /* Mirrors react_timer(): one reaction per person per run of a timer,
             kudos or sus, and a null kind takes it back. */
          if (name === "react_timer") {
            const owner = args && args.owner_id, kind = args && args.kind;
            const t = T.live_timers.find(r => r.user_id === owner);
            if (!t) return Promise.resolve({ data: { ok: false, why: "They are not on the clock" }, error: null });
            if (owner === ME) return Promise.resolve({ data: { ok: false, why: "Not your own timer" }, error: null });
            T.timer_reactions = T.timer_reactions.filter(r => !(r.owner_id === owner && r.user_id === ME));
            if (kind) T.timer_reactions.push({ owner_id: owner, user_id: ME, kind, for_started_at: t.started_at,
              created_at: new Date().toISOString() });
            return Promise.resolve({ data: { ok: true }, error: null });
          }
          if (name === "reactions_for") {
            const ids = (args && args.ids) || [], by = {};
            (T.session_reactions || []).filter(r => ids.includes(r.session_id)).forEach(r => {
              const e = by[r.session_id] || (by[r.session_id] = { session_id: r.session_id, kudos_by: [], sus_by: [] });
              e[r.kind + "_by"].push(r.user_id);
            });
            return Promise.resolve({ data: Object.values(by), error: null });
          }
          /* Mirrors nudge_mate() so the button can be exercised locally. The
             real rules live in the database; these are only for the harness. */
          if (name === "nudge_mate") {
            const target = args && args.target;
            const say = reason => Promise.resolve({ data: { ok: false, reason }, error: null });
            if (!target || target === ME) return say("You cannot nudge yourself");
            const t = T.live_timers.find(r => r.user_id === target);
            if (t && Date.now() - new Date(t.updated_at || 0).getTime() < 5 * 60000)
              return say("They are studying right now");
            if (T.sessions.some(r => r.user_id === target &&
                Date.now() - new Date(r.created_at || 0).getTime() < 30 * 60000))
              return say("They logged a session in the last half hour");
            const last = T.nudges.filter(n => n.from_user === ME && n.to_user === target)
              .map(n => new Date(n.created_at).getTime()).sort().pop();
            if (last && Date.now() - last < 15 * 60000)
              return say("You have nudged them already. Try again in " +
                Math.max(1, Math.ceil((15 * 60000 - (Date.now() - last)) / 60000)) + " minutes");
            T.nudges.push({ id: uid(950 + T.nudges.length), from_user: ME, to_user: target,
              seen_at: null, created_at: new Date().toISOString() });
            return Promise.resolve({ data: { ok: true }, error: null });
          }
          /* The rollups the app now reads instead of the whole sessions table.
             Same shape as the SQL: days is {"2026-09-14":[minutes,sessions]}. */
          /* A week of hourly peaks shaped like a school day, so the busyness
             graph has something to draw. Same columns as live_history(). */
          if (name === "crew_clock") {
            const since = String((args && args.since) || "0000-01-01");
            const cells = {}, sd = {};
            T.sessions.forEach(r => {
              if (r.day < since || !r.created_at) return;
              const end = new Date(r.created_at).getTime(), start = end - r.minutes * 6e4;
              sd[r.user_id + r.day] = (new Date(r.day + "T00:00:00").getDay() + 6) % 7;
              for (let t = start; t < end;) {
                const d = new Date(t), nx = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
                const k = ((d.getDay() + 6) % 7) + "," + d.getHours();
                cells[k] = (cells[k] || 0) + (Math.min(nx, end) - t) / 6e4; t = nx;
              }
            });
            const byDow = {};
            Object.values(sd).forEach(w => { byDow[w] = (byDow[w] || 0) + 1; });
            /* a few hundred extra student-days, so it reads like the real year group */
            Object.keys(byDow).forEach(w => { byDow[w] = Math.max(byDow[w], 6); });
            return Promise.resolve({ error: null, data: {
              cells: Object.keys(cells).map(k => k.split(",").map(Number).concat([Math.round(cells[k])])),
              student_days: Object.keys(sd).length, student_days_by_dow: byDow } });
          }
          if (name === "crew_subject_hours") {
            const since = String((args && args.since) || "0000-01-01");
            const g = {};
            T.sessions.forEach(r => {
              if (r.day < since) return;
              const sub = T.subjects.find(v => v.id === r.subject_id); if (!sub) return;
              const k = String(sub.name).trim().toLowerCase().replace(/\s+/g, " ");
              const e = (g[k] = g[k] || { label: String(sub.name).trim(), minutes: 0, ppl: {} });
              e.minutes += r.minutes; e.ppl[r.user_id] = 1;
            });
            return Promise.resolve({ error: null, data: Object.values(g)
              .map(e => ({ label: e.label, minutes: e.minutes, people: Object.keys(e.ppl).length }))
              .sort((a, b) => b.minutes - a.minutes) });
          }
          if (name === "kudos_board") {
            return Promise.resolve({ error: null, data: {
              received: [[uid(3), 41], [ME, 33], [uid(2), 20], [uid(4), 6]],
              given: [[uid(2), 57], [ME, 44], [uid(4), 12], [uid(3), 3]] } });
          }
          /* exam-day wishes (believe.sql); a few already in, from the others */
          if (name === "exam_wishes_on") {
            if (!T.exam_wishes) {
              T.exam_wishes = [];
              const others = T.profiles.filter(p => p.id !== ME).slice(0, 40);
              (CAT_MOCK_SITTINGS || []).forEach(k => others.forEach((p, i) => { if (i % 3 !== 2) T.exam_wishes.push({ user_id: p.id, sitting: k, at: i }); }));
            }
            const out = {};
            T.exam_wishes.filter(w => (args.p_dates || []).includes(w.sitting.slice(0, 10))).forEach(w => {
              const o = out[w.sitting] || (out[w.sitting] = { n: 0, who: [], mine: false });
              o.n++; if (w.user_id === ME) o.mine = true;
              const p = T.profiles.find(x => x.id === w.user_id);
              if (p && !p.hide_hours) o.who.unshift(w.user_id);
            });
            return Promise.resolve({ data: out, error: null });
          }
          if (name === "wish_luck") {
            T.exam_wishes = (T.exam_wishes || []).filter(w => !(w.user_id === ME && w.sitting === args.p_sitting));
            if (args.p_on !== false) T.exam_wishes.push({ user_id: ME, sitting: args.p_sitting, at: 999 });
            return Promise.resolve({ data: { ok: true, n: T.exam_wishes.filter(w => w.sitting === args.p_sitting).length }, error: null });
          }
          if (name === "set_plan" || name === "set_plans") {
            const rows = name === "set_plan"
              ? [{ day: args.p_day, subject_id: args.p_subject, hours: Number(args.p_hours) }]
              : (args.rows || []).map(r => ({ day: r.day, subject_id: r.subject_id, hours: Number(r.hours) }));
            let n = 0;
            rows.forEach(r => {
              if (!T.subjects.some(x => x.id === r.subject_id && x.user_id === ME) || r.day < today()) return;
              T.study_plan = T.study_plan.filter(x => !(x.day === r.day && x.subject_id === r.subject_id));
              if (r.hours > 0) T.study_plan.push({ user_id: ME, day: r.day, subject_id: r.subject_id, hours: Math.round(r.hours * 4) / 4 });
              n++;
            });
            return Promise.resolve({ data: { ok: true, written: n, hours: rows[0] && rows[0].hours }, error: null });
          }
          if (name === "reaction_board") {
            const sus = args && args.which === "sus", all = args && args.since < "2001";
            const k = (a, b) => all ? a * 3 : a;
            return Promise.resolve({ error: null, data: sus ? {
              received: [[uid(4), k(9)], [uid(2), k(5)], [ME, k(2)]],
              given: [[uid(3), k(11)], [ME, k(4)], [uid(2), k(1)]] } : {
              received: [[uid(3), k(41)], [ME, k(33)], [uid(2), k(20)], [uid(4), k(6)]],
              given: [[uid(2), k(57)], [ME, k(44)], [uid(4), k(12)], [uid(3), k(3)]] } });
          }
          if (name === "badge_stats") {
            const id = args && args.uid;
            const p = T.profiles.find(x => x.id === id);
            if (!p || (p.hide_hours && id !== ME)) return Promise.resolve({ data: null, error: null });
            const n = parseInt(String(id).slice(-3), 10) || 1;
            return Promise.resolve({ error: null, data: { kudos_received: 40 + n * 37, kudos_given: 20 + n * 61 } });
          }
          if (name === "live_history") {
            const now = Math.floor(Date.now() / 36e5) * 36e5, rows = [];
            for (let h = 24 * 7; h >= 0; h--) {
              const t = new Date(now - h * 36e5), hr = t.getHours();
              const peak = hr < 7 ? 0 : Math.max(0, Math.round(9 - Math.abs(16 - hr) * 0.9 + ((h * 7) % 3)));
              rows.push({ bucket: t.toISOString(), peak });
            }
            const best = Math.max(...rows.map(r => r.peak));
            return Promise.resolve({ error: null, data: rows.map(r =>
              Object.assign(r, { best, first_at: rows[0].bucket })) });
          }
          if (name === "crew_daily" || name === "crew_daily_by_subject") {
            const since = String((args && args.since) || "0000-01-01");
            const key = args && args.subject_key;
            const nameOf = id => { const x = T.subjects.find(v => v.id === id); return x ? x.name : null; };
            const norm = n => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
            const per = {};
            /* same rule the policy applies: hidden from everyone but themselves */
            const blocked = {};
            T.profiles.forEach(x => { if (x.hide_hours && x.id !== ME) blocked[x.id] = 1; });
            T.sessions.forEach(r => {
              if (blocked[r.user_id]) return;
              if (key) { const n = nameOf(r.subject_id); if (!n || norm(n) !== key) return; }
              const u = (per[r.user_id] = per[r.user_id] || { days: {}, first: null, m: 0, n: 0 });
              if (!u.first || r.day < u.first) u.first = r.day;
              u.m += r.minutes; u.n += 1;
              if (r.day >= since) {
                const c = u.days[r.day] || [0, 0];
                u.days[r.day] = [c[0] + r.minutes, c[1] + 1];
              }
            });
            const onlyActive = !!(args && args.only_active);
            return Promise.resolve({ error: null, data: Object.keys(per)
              .filter(u => !onlyActive || Object.keys(per[u].days).length)
              .map(u => ({ user_id: u, days: per[u].days, first_day: per[u].first,
                total_minutes: per[u].m, total_sessions: per[u].n })) });
          }
          if (name === "crew_subjects") {
            const norm = n => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
            const g = {};
            T.subjects.forEach(r => {
              const k = norm(r.name); if (!k) return;
              const e = (g[k] = g[k] || { key: k, spell: {}, takers: {} });
              const sp = String(r.name).trim();
              e.spell[sp] = (e.spell[sp] || 0) + 1;
              e.takers[r.user_id] = 1;
            });
            return Promise.resolve({ error: null, data: Object.keys(g).map(k => ({
              key: k,
              label: Object.keys(g[k].spell).sort((a, b) => g[k].spell[b] - g[k].spell[a] || a.localeCompare(b))[0],
              takers: Object.keys(g[k].takers) })) });
          }
          if (name === "subject_totals") {
            const uids = (args && args.uids) || [], since = String((args && args.since) || "0000-01-01");
            const out = {};
            T.sessions.forEach(r => {
              if (uids.indexOf(r.user_id) === -1 || r.day < since) return;
              const sub = T.subjects.find(v => v.id === r.subject_id);
              const label = sub ? String(sub.name).trim() : "Other";
              const k = r.user_id + "|" + label;
              out[k] = (out[k] || 0) + r.minutes;
            });
            return Promise.resolve({ error: null, data: Object.keys(out).map(k => ({
              user_id: k.split("|")[0], label: k.split("|")[1], minutes: out[k] })) });
          }
          if (name === "send_message") {
            const txt = String((args && args.body) || "").trim();
            const me = T.profiles.find(p => p.id === ME);
            if (!txt && !(args && args.image_path))
              return Promise.resolve({ data: { ok: false, why: "Nothing to send" }, error: null });
            if (txt.length > 500)
              return Promise.resolve({ data: { ok: false, why: "That is longer than 500 characters" }, error: null });
            if (me && me.chat_muted)
              return Promise.resolve({ data: { ok: false, why: "An administrator has muted you in chat" }, error: null });
            const recent = T.messages.filter(m => m.user_id === ME &&
              Date.now() - new Date(m.created_at).getTime() < 60000).length;
            if (recent >= 10)
              return Promise.resolve({ data: { ok: false, why: "Slow down a moment — ten a minute is the limit" }, error: null });
            const img = (args && args.image_path) ? String(args.image_path).trim() : null;
            if (img && img.split("/")[0] !== ME)
              return Promise.resolve({ data: { ok: false, why: "That picture is not yours to post" }, error: null });
            const said = ((args && args.mentions) || [])
              .filter(x => x !== ME && T.profiles.some(p => p.id === x));
            const id = uid(1300 + T.messages.length);
            T.messages.push({ id, user_id: ME, body: txt, image_path: img || null,
              mentions: said, created_at: new Date().toISOString() });
            return Promise.resolve({ data: { ok: true, id }, error: null });
          }
          if (name === "admin_emails") {
            if (/admin=0/.test(location.search)) return Promise.resolve({ data: [], error: null });
            return Promise.resolve({ error: null,
              data: T.profiles.map(p => ({ id: p.id, email: EMAIL[p.id] || "" })) });
          }
          if (name === "is_admin") return Promise.resolve({ data: !/admin=0/.test(location.search), error: null });
          if (name === "admin_delete_user") {
            const id = args && args.target;
            if (!id) return Promise.resolve({ data: null, error: { message: "no user given" } });
            if (id === ME) return Promise.resolve({ data: null, error: { message: "use Delete my account" } });
            ["profiles","subjects","areas","sessions","goals","live_timers"].forEach(t => {
              T[t] = T[t].filter(r => (t === "profiles" ? r.id : r.user_id) !== id);
            });
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: { message: "no such function" } });
        },
        /* Enough of Storage to exercise pictures locally. Files are kept as blob
           URLs in memory — no bucket, but the same call shapes, including the
           signed links the real private bucket needs. */
        storage: { from: (bucket) => ({
          upload: (path, file) => {
            T._files = T._files || {};
            try { T._files[path] = URL.createObjectURL(file); } catch (e) { T._files[path] = ""; }
            return Promise.resolve({ data: { path }, error: null });
          },
          remove: (paths) => {
            T._files = T._files || {};
            (paths || []).forEach(p => { delete T._files[p]; });
            return Promise.resolve({ data: null, error: null });
          },
          createSignedUrls: (paths, secs) => Promise.resolve({
            error: null,
            /* returned as-is: a blob: URL with anything appended stops being a
               valid blob reference, and the real signed link carries its
               signature in the query string anyway */
            data: (paths || []).map(p => ({ path: p,
              signedUrl: (T._files && T._files[p]) || null }))
          }),
          getPublicUrl: () => ({ data: { publicUrl: "" } })
        }) },
        /* Records what is subscribed, so a test can see which tables are live
           and that a background tab lets go of them. */
        channel: (name) => {
          const ch = { name, tables: [], on(ev, f) { if (f && f.table) this.tables.push(f.table); return this; },
                       subscribe() { (window.__rt = window.__rt || []).push(this); return this; } };
          return ch;
        },
        removeChannel: (ch) => { window.__rt = (window.__rt || []).filter(c => c !== ch); }
      };
    }
  };
  window.CREW_CONFIG = { SUPABASE_URL: "https://mock.supabase.co", SUPABASE_ANON_KEY: "mock", CREW_NAME: "Knox Study Track", ALLOWED_EMAILS: [] };
})();
