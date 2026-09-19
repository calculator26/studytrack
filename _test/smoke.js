/* Loads the REAL index.html with a stubbed Supabase, signs a fake member in,
   and walks every tab. Catches "X is not defined" in the code paths that only
   run once somebody is actually signed in — which a component harness never
   reaches, and which is exactly how noteLiveSoon got shipped missing. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const UID = "11111111-1111-1111-1111-111111111111";
const STUB = `
window.supabase = {
  createClient: () => {
    const rows = {
      profiles: [{id:${JSON.stringify(UID)}, display_name:"Lewis", colour:"#E8402A", onboarded:true, created_at:"2026-01-01"}],
      subjects: [{id:"s1", user_id:${JSON.stringify(UID)}, name:"Biology", colour:"#3FA98A", position:0}],
      areas: [{id:"a1", user_id:${JSON.stringify(UID)}, subject_id:"s1", name:"Module 6", position:0}],
      sessions: [{id:"x1", user_id:${JSON.stringify(UID)}, day:new Date().toISOString().slice(0,10), minutes:90, subject_id:"s1", area_id:"a1", note:"hi", created_at:new Date().toISOString()}],
      goals: [], live_timers: [], timer_reactions: [], messages: [], admin_audit: []
    };
    const res = (data) => { const p = Promise.resolve({data, error:null});
      p.select=()=>p; p.eq=()=>p; p.or=()=>p; p.order=()=>p; p.limit=()=>p; p.gt=()=>p; p.lt=()=>p;
      p.in=()=>p; p.single=()=>p; p.insert=()=>p; p.update=()=>p; p.delete=()=>p; p.upsert=()=>p; return p; };
    const rpcData = { crew_daily:[], crew_subjects:[], reactions_for:[], live_history:[], note_live:1, note:null, is_admin:false };
    return {
      from: (t) => res(rows[t] || []),
      rpc: (fn) => { const p = Promise.resolve({data: rpcData[fn] !== undefined ? rpcData[fn] : null, error:null});
                     p.select=()=>p; return p; },
      storage: { from: () => ({ createSignedUrls: async()=>({data:[],error:null}), remove: async()=>({error:null}) }) },
      channel: () => ({ on(){return this}, subscribe(){return this} }),
      removeChannel: () => {},
      auth: {
        getSession: async () => ({ data: { session: { user: { id: ${JSON.stringify(UID)}, email:"l@x.com", user_metadata:{display_name:"Lewis"} } } } }),
        onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe(){} } } }),
        signOut: async () => ({}), getUser: async () => ({ data:{ user:{ id:${JSON.stringify(UID)} } } })
      }
    };
  }
};
`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') { const t = m.text();
    if (!/Failed to load resource|ERR_|net::/.test(t)) errs.push('console: ' + t); } });

  await p.addInitScript(STUB);
  await p.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  const shown = await p.evaluate(() => ({
    app:  !document.getElementById('app').classList.contains('hide'),
    auth: !document.getElementById('auth').classList.contains('hide'),
    boot: !document.getElementById('boot').classList.contains('hide'),
    fail: !!document.querySelector('.bootfail')
  }));
  console.log('after sign-in:', JSON.stringify(shown));

  for (const tab of ['crew','chat','me','setup','home']) {
    await p.evaluate(t => { const b = document.querySelector(`nav.tabs button[data-p="${t}"]`); if (b) b.click(); }, tab);
    await p.waitForTimeout(400);
  }
  console.log('walked every tab');
  console.log(errs.length ? 'ERRORS:\n  ' + [...new Set(errs)].join('\n  ') : 'no page errors');
  /* The app being on screen is not the same as the app being well: a throw in
     onSession happens AFTER show("app"), so the page can look fine while every
     sign-in is failing. The verdict is errors-and-state together, never state
     alone — which is the mistake that let this ship. */
  const bad = errs.length || !shown.app || shown.fail;
  console.log(bad ? 'RESULT: ** FAILED **' : 'RESULT: PASSED');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
