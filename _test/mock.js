/* In-memory stand-in for supabase-js, used only to exercise the UI locally. */
(function () {
  const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const T = { profiles: [], subjects: [], areas: [], sessions: [], goals: [], live_timers: [] };
  const ME = uid(1);
  const today = () => { const d = new Date(); const p = n => String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
  const add = (s, n) => { const d = new Date(s); d.setDate(d.getDate()+n); const p=x=>String(x).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };

  const people = [
    { id: ME,     display_name: "Lewis Christie", colour: "#2FCFA6", school: "Knox", onboarded: !/onboard=1/.test(location.search), default_goal: 3, weekday_goals: [3,3,3,3,2,5,5] },
    { id: uid(2), display_name: "Sam Whitfield",  colour: "#C0564C", school: "Knox", onboarded: true, default_goal: 4, weekday_goals: [4,4,4,4,3,6,6] },
    { id: uid(3), display_name: "Priya Raman",    colour: "#7A6BB5", school: "Abbotsleigh", onboarded: true, default_goal: 5, weekday_goals: [5,5,5,5,4,7,7] },
    { id: uid(4), display_name: "Tom Beckett",    colour: "#C9A227", school: "Knox", onboarded: true, default_goal: 2, weekday_goals: [2,2,2,2,2,4,4] }
  ];
  T.profiles = people;

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
  T.live_timers.push({ user_id: uid(3), label: "Module B — Eliot · Write to time", subject_id: null, area_id: null,
    started_at: new Date(Date.now() - 22 * 60000).toISOString(), acc_ms: 0, running: true,
    updated_at: new Date().toISOString() });
  T.live_timers.push({ user_id: uid(2), label: "Finance · Drill", subject_id: null, area_id: null,
    started_at: new Date().toISOString(), acc_ms: 47 * 60000, running: false,
    updated_at: new Date().toISOString() });

  function builder(table) {
    let rows = T[table] ? T[table].slice() : [];
    const filters = [];
    const api = {
      select() { return api; },
      order() { return api; },
      limit() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
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
        p.eq = (c, v) => { filters.push([c, v]); const gone = apply();
          T[table] = T[table].filter(r => !gone.includes(r));
          const q = Promise.resolve({ data: null, error: null });
          q.eq = (c2, v2) => { filters.push([c2, v2]); const g2 = apply();
            T[table] = T[table].filter(r => !g2.includes(r)); return Promise.resolve({ data: null, error: null }); };
          return q; };
        return p; },
      then(res) { return Promise.resolve({ data: apply(), error: null }).then(res); }
    };
    function apply() { return (T[table] || []).filter(r => filters.every(([c, v]) => r[c] === v)); }
    return api;
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          getSession: () => Promise.resolve({ data: { session: { user: { id: ME, email: "lewis@example.com" } } } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithPassword: () => Promise.resolve({ error: null }),
          signUp: () => Promise.resolve({ error: null }),
          signOut: () => Promise.resolve({ error: null })
        },
        from: builder,
        storage: { from: () => ({ upload: () => Promise.resolve({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
        channel: () => ({ on() { return this; }, subscribe() { return this; } })
      };
    }
  };
  window.CREW_CONFIG = { SUPABASE_URL: "https://mock.supabase.co", SUPABASE_ANON_KEY: "mock", CREW_NAME: "Knox Study Crew", ALLOWED_EMAILS: [] };
})();
