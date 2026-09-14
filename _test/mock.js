/* In-memory stand-in for supabase-js, used only to exercise the UI locally. */
(function () {
  /* Lets the app skip anything that cannot work against a mock backend,
     such as registering a service worker that does not exist here. */
  window.STUDYTRACK_MOCK = true;

  const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const T = { profiles: [], subjects: [], areas: [], sessions: [], goals: [], live_timers: [], admin_audit: [],
              notification_prefs: [], push_subscriptions: [], notification_log: [],
              nudges: [], messages: [] };
  const ME = uid(1);
  const today = () => { const d = new Date(); const p = n => String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
  const add = (s, n) => { const d = new Date(s); d.setDate(d.getDate()+n); const p=x=>String(x).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };

  const joined = n => new Date(Date.now() - n * 864e5).toISOString();
  const people = [
    { id: ME,     display_name: "Lewis Christie", colour: "#2FCFA6", onboarded: !/onboard=1/.test(location.search), default_goal: 3, weekday_goals: [3,3,3,3,2,5,5] },
    { id: uid(2), display_name: "Sam Whitfield",  colour: "#C0564C", onboarded: true, default_goal: 4, weekday_goals: [4,4,4,4,3,6,6] },
    { id: uid(3), display_name: "Priya Raman",    colour: "#7A6BB5", onboarded: true, default_goal: 5, weekday_goals: [5,5,5,5,4,7,7] },
    { id: uid(4), display_name: "Tom Beckett",    colour: "#C9A227", onboarded: true, default_goal: 2, weekday_goals: [2,2,2,2,2,4,4] }
  ];
  people.forEach((p, i) => p.created_at = joined(30 - i * 2));
  T.profiles = people;

  /* Reminder prefs for the signed-in stand-in, so the Study reminders card
     and its calendar link render as they would in the real app. */
  T.notification_prefs = [{
    user_id: ME, push_on: false, remind_at: "19:30:00", timezone: "Australia/Sydney",
    quiet_days: [], weekly_digest: true, feed_token: "00000000-0000-4000-8000-0000000000ff"
  }];

  const subjectDefs = [
    ["English Advanced", "#3E7CA6", add(today(), 34), ["Common Module — 1984","Module A — Hag-Seed","Module B — Eliot","Module C — Craft"]],
    ["Business Studies", "#C0564C", add(today(), 47), ["Operations","Marketing","Finance","HR"]],
    ["Mathematics Standard 2", "#3FA98A", add(today(), 40), ["Question Practice","Error Review"]],
    ["Enterprise Computing", "#C9A227", add(today(), 50), ["Content","Technical"]]
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
          created_at: new Date(Date.now() - d * 864e5 - k * 36e5).toISOString() });
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
      [uid(4), 4,   "good luck everyone"]
    ];
    said.forEach(([u, ago, body], i) =>
      T.messages.push({ id: uid(1200 + i), user_id: u, body, created_at: mins(ago) }));
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
    mk({ day: add(today(), -2), minutes: 120, subject_id: B.subject_id, area_id: B.id, note: "twin A" });
    mk({ day: add(today(), -2), minutes: 120, subject_id: B.subject_id, area_id: B.id, note: "twin B — exact duplicate" });
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

  T.live_timers.push({ user_id: uid(3), label: "Module B — Eliot · Write to time", subject_id: null, area_id: null,
    started_at: new Date(Date.now() - 22 * 60000).toISOString(), acc_ms: 0, running: true,
    updated_at: new Date().toISOString() });
  T.live_timers.push({ user_id: uid(2), label: "Finance · Drill", subject_id: null, area_id: null,
    started_at: new Date().toISOString(), acc_ms: 47 * 60000, running: false,
    updated_at: new Date().toISOString() });

  function builder(table) {
    /* pretend the other members' tabs are still open and still beating */
    if (table === "live_timers") {
      const stamp = new Date().toISOString();
      T.live_timers.forEach(r => { if (r.user_id !== ME) r.updated_at = stamp; });
    }
    let rows = T[table] ? T[table].slice() : [];
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
        p.select = () => ({ single: () => Promise.resolve({ data: made[0], error: null }) });
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
          if (name === "crew_daily" || name === "crew_daily_by_subject") {
            const since = String((args && args.since) || "0000-01-01");
            const key = args && args.subject_key;
            const nameOf = id => { const x = T.subjects.find(v => v.id === id); return x ? x.name : null; };
            const norm = n => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
            const per = {};
            T.sessions.forEach(r => {
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
            if (!txt) return Promise.resolve({ data: { ok: false, why: "Nothing to send" }, error: null });
            if (txt.length > 500)
              return Promise.resolve({ data: { ok: false, why: "That is longer than 500 characters" }, error: null });
            if (me && me.chat_muted)
              return Promise.resolve({ data: { ok: false, why: "An administrator has muted you in chat" }, error: null });
            const recent = T.messages.filter(m => m.user_id === ME &&
              Date.now() - new Date(m.created_at).getTime() < 60000).length;
            if (recent >= 10)
              return Promise.resolve({ data: { ok: false, why: "Slow down a moment — ten a minute is the limit" }, error: null });
            const id = uid(1300 + T.messages.length);
            T.messages.push({ id, user_id: ME, body: txt, created_at: new Date().toISOString() });
            return Promise.resolve({ data: { ok: true, id }, error: null });
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
        storage: { from: () => ({ upload: () => Promise.resolve({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
        channel: () => ({ on() { return this; }, subscribe() { return this; } })
      };
    }
  };
  window.CREW_CONFIG = { SUPABASE_URL: "https://mock.supabase.co", SUPABASE_ANON_KEY: "mock", CREW_NAME: "Knox Study Crew", ALLOWED_EMAILS: [] };
})();
