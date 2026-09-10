/* In-memory stand-in for supabase-js, used only to exercise the UI locally. */
(function () {
  /* Lets the app skip anything that cannot work against a mock backend,
     such as registering a service worker that does not exist here. */
  window.STUDYTRACK_MOCK = true;

  const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const T = { profiles: [], subjects: [], areas: [], sessions: [], goals: [], live_timers: [], admin_audit: [],
              notification_prefs: [], push_subscriptions: [], notification_log: [] };
  const ME = uid(1);
  const today = () => { const d = new Date(); const p = n => String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
  const add = (s, n) => { const d = new Date(s); d.setDate(d.getDate()+n); const p=x=>String(x).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };

  const joined = n => new Date(Date.now() - n * 864e5).toISOString();
  const people = [
    { id: ME,     display_name: "Lewis Christie", colour: "#2FCFA6", school: "Knox", onboarded: !/onboard=1/.test(location.search), default_goal: 3, weekday_goals: [3,3,3,3,2,5,5] },
    { id: uid(2), display_name: "Sam Whitfield",  colour: "#C0564C", school: "Knox", onboarded: true, default_goal: 4, weekday_goals: [4,4,4,4,3,6,6] },
    { id: uid(3), display_name: "Priya Raman",    colour: "#7A6BB5", school: "Abbotsleigh", onboarded: true, default_goal: 5, weekday_goals: [5,5,5,5,4,7,7] },
    { id: uid(4), display_name: "Tom Beckett",    colour: "#C9A227", school: "Knox", onboarded: true, default_goal: 2, weekday_goals: [2,2,2,2,2,4,4] }
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
    let sort = null, cap = null;
    const api = {
      select() { return api; },
      /* honoured rather than ignored, so local ordering matches production */
      order(col, opts) { sort = { col, asc: !opts || opts.ascending !== false }; return api; },
      limit(n) { cap = n; return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      in(col, vals) { filters.push([col, vals, "in"]); return api; },
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
      update(patch) { const p = Promise.resolve({ data: null, error: null });
        p.eq = (c, v) => { filters.push([c, v]); apply().forEach(r => Object.assign(r, patch));
          return Promise.resolve({ data: null, error: null }); };
        return p; },
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
        op === "in" ? v.includes(r[c]) : r[c] === v));
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
      return cap != null ? out.slice(0, cap) : out;
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
