const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const UID = "11111111-1111-1111-1111-111111111111";

/* A stub that records what the app asks Supabase to do, and can pretend to be
   either a normal load or a landing from a reset link. */
const stub = (mode) => `
window.__calls = [];
window.supabase = { createClient: () => {
  const sess = { user: { id: ${JSON.stringify(UID)}, email:"l@x.com", user_metadata:{display_name:"Lewis"} } };
  const has = ${mode === 'recovery-pkce' ? 'true' : mode === 'recovery-hash' ? 'true' : 'false'};
  let cb = null;
  const res = (d) => { const p = Promise.resolve({data:d, error:null});
    p.select=()=>p;p.eq=()=>p;p.or=()=>p;p.order=()=>p;p.limit=()=>p;p.gt=()=>p;p.lt=()=>p;p.in=()=>p;
    p.insert=()=>p;p.update=()=>p;p.delete=()=>p;p.upsert=()=>p;return p; };
  const rows = { profiles:[{id:${JSON.stringify(UID)},display_name:"Lewis",colour:"#E8402A",onboarded:true}],
                 subjects:[],areas:[],sessions:[],goals:[],live_timers:[],timer_reactions:[],messages:[] };
  return {
    from:(t)=>res(rows[t]||[]),
    rpc:(fn)=>{const p=Promise.resolve({data:null,error:null});p.select=()=>p;return p;},
    storage:{from:()=>({createSignedUrls:async()=>({data:[],error:null}),remove:async()=>({error:null})})},
    channel:()=>({on(){return this},subscribe(){return this}}), removeChannel:()=>{},
    auth:{
      getSession: async () => ({ data: { session: has ? sess : null } }),
      onAuthStateChange: (fn) => { cb = fn;
        ${mode === 'recovery-pkce' ? 'setTimeout(()=>fn("PASSWORD_RECOVERY", sess), 60);' : ''}
        return { data:{ subscription:{ unsubscribe(){} } } }; },
      resetPasswordForEmail: async (email, opts) => {
        __calls.push(["resetPasswordForEmail", email, opts && opts.redirectTo]);
        return { error: null }; },
      updateUser: async (attrs) => {
        __calls.push(["updateUser", attrs.password ? "password:"+attrs.password.length+"chars" : ""]);
        return { data:{user:sess.user}, error: null }; },
      signInWithPassword: async () => ({ data:{session:sess}, error:null }),
      signUp: async () => ({ data:{session:sess}, error:null }),
      signOut: async () => ({}), getUser: async () => ({ data:{ user: sess.user } })
    }
  };
}};`;

const url = (mode) => 'http://127.0.0.1:8899/index.html' +
  (mode === 'recovery-hash' ? '#access_token=fake&refresh_token=fake&token_type=bearer&type=recovery' : '');

(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (label, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : '** FAIL **'}  ${label}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`);
    if (!cond) fail++;
  };

  // ---------- 1. the ordinary sign-in screen ----------
  console.log('\n--- forgot-password link on the sign-in screen ---');
  let p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(stub('normal'));
  await p.goto(url('normal'), { waitUntil:'networkidle' });
  await p.waitForTimeout(400);
  ok('link is visible on sign in', await p.locator('#au-forgot').isVisible());
  await p.click('[data-authmode="up"]'); await p.waitForTimeout(150);
  ok('and hidden on create-account', !(await p.locator('#au-forgot').isVisible()));
  await p.click('[data-authmode="in"]'); await p.waitForTimeout(150);

  // ---------- 2. asking for the link ----------
  console.log('\n--- asking for a reset link ---');
  await p.click('#au-forgot'); await p.waitForTimeout(200);
  const st = await p.evaluate(() => ({
    title: document.getElementById('au-title').textContent,
    btn:   document.getElementById('au-go').textContent,
    passShown: document.getElementById('au-passfield').style.display !== 'none',
    tabsShown: document.querySelector('.authseg').style.display !== 'none'
  }));
  ok('switches to the reset screen', /reset/i.test(st.title), st.title);
  ok('button says what it does', /link/i.test(st.btn), st.btn);
  ok('no password box on it', !st.passShown);
  ok('the sign-in / join tabs step aside', !st.tabsShown);

  await p.fill('#au-email', 'someone@knox.nsw.edu.au');
  await p.click('#au-go'); await p.waitForTimeout(300);
  const call = await p.evaluate(() => __calls.find(c => c[0] === 'resetPasswordForEmail'));
  ok('asks Supabase to send it', !!call, call);
  ok('with a redirect back to the app', !!call && /index\.html$|\/$/.test(call[2] || ''), call && call[2]);
  const msg = await p.locator('#au-msg').textContent();
  ok('says nothing about whether the account exists', /if there is an account/i.test(msg), msg.trim().slice(0,60));

  await p.click('#au-back'); await p.waitForTimeout(150);
  ok('can get back to signing in', /welcome|knox/i.test(await p.locator('#au-title').textContent()));
  await p.close();

  // ---------- 3 & 4. coming back from the link, both flows ----------
  for (const mode of ['recovery-hash', 'recovery-pkce']) {
    console.log(`\n--- coming back from the link (${mode.split('-')[1]} flow) ---`);
    const q = await b.newPage();
    q.on('pageerror', e => errs.push(e.message));
    await q.addInitScript(stub(mode));
    await q.goto(url(mode), { waitUntil:'networkidle' });
    await q.waitForTimeout(600);
    const r = await q.evaluate(() => ({
      auth: !document.getElementById('auth').classList.contains('hide'),
      app:  !document.getElementById('app').classList.contains('hide'),
      title: document.getElementById('au-title').textContent,
      two:  document.getElementById('au-pass2field').style.display !== 'none'
    }));
    ok('does NOT drop them straight into the app', !r.app && r.auth, {app:r.app, auth:r.auth});
    ok('asks for a new password', /new password/i.test(r.title), r.title);
    ok('and for it twice', r.two);

    // mismatch is caught
    await q.fill('#au-pass', 'abcdef12'); await q.fill('#au-pass2', 'different');
    await q.click('#au-go'); await q.waitForTimeout(250);
    ok('rejects two that do not match', /not the same/i.test(await q.locator('#au-msg').textContent()));
    // too short is caught
    await q.fill('#au-pass', 'abc'); await q.fill('#au-pass2', 'abc');
    await q.click('#au-go'); await q.waitForTimeout(250);
    ok('rejects a short one', /6 characters/i.test(await q.locator('#au-msg').textContent()));
    // and a good one goes through
    await q.fill('#au-pass', 'a-good-one-99'); await q.fill('#au-pass2', 'a-good-one-99');
    await q.click('#au-go'); await q.waitForTimeout(900);
    const saved = await q.evaluate(() => __calls.find(c => c[0] === 'updateUser'));
    ok('saves the new password', !!saved, saved);
    ok('and then lets them into the app',
       await q.evaluate(() => !document.getElementById('app').classList.contains('hide')));
    await q.close();
  }

  console.log('\npage errors: ' + (errs.length ? [...new Set(errs)].join(' | ') : 'none'));
  if (errs.length) fail++;
  console.log(fail ? `\nRESULT: ** ${fail} FAILED **` : '\nRESULT: ALL PASSED');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
