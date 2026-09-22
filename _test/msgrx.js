const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const UID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const EMOJI = ["\u{1F44D}","❤️","\u{1F602}","\u{1F525}","\u{1F480}","\u{1F440}","\u{1F389}","\u{1F62D}"];

const STUB = `
window.__rpc = []; window.__fail = false; window.__rt = {};
window.supabase = { createClient: () => {
  const sess = { user: { id:${JSON.stringify(UID)}, email:"l@x.com", user_metadata:{display_name:"Lewis"} } };
  const msgs = [
    {id:"m1", user_id:${JSON.stringify(OTHER)}, body:"anyone got the Mod B notes", mentions:[], created_at:new Date(Date.now()-600000).toISOString()},
    {id:"m2", user_id:${JSON.stringify(UID)},  body:"yeah one sec", mentions:[], created_at:new Date(Date.now()-300000).toISOString()}
  ];
  const rows = { profiles:[
      {id:${JSON.stringify(UID)},display_name:"Lewis",colour:"#E8402A",onboarded:true},
      {id:${JSON.stringify(OTHER)},display_name:"Sam Ng",colour:"#3E7CA6",onboarded:true}],
    subjects:[],areas:[],sessions:[],goals:[],live_timers:[],timer_reactions:[],messages:msgs };
  const res=(d)=>{const p=Promise.resolve({data:d,error:null});
    p.select=()=>p;p.eq=()=>p;p.or=()=>p;p.order=()=>p;p.limit=()=>p;p.gt=()=>p;p.lt=()=>p;p.in=()=>p;
    p.insert=()=>p;p.update=()=>p;p.delete=()=>p;p.upsert=()=>p;return p;};
  return {
    from:(t)=>res(rows[t]||[]),
    rpc:(fn,args)=>{ __rpc.push([fn,args]);
      let d=null;
      if(fn==="chat_emoji") d=${JSON.stringify(EMOJI)};
      else if(fn==="message_reactions_for") d=[{message_id:"m1",emoji:"\u{1F525}",by_ids:[${JSON.stringify(OTHER)}]}];
      else if(fn==="react_message") { if(__fail) return Promise.resolve({data:{ok:false,why:"Three reactions each per message is the limit"},error:null}); d={ok:true}; }
      const p=Promise.resolve({data:d,error:null}); p.select=()=>p; return p; },
    storage:{from:()=>({createSignedUrls:async()=>({data:[],error:null}),remove:async()=>({error:null})})},
    channel:()=>({ on(evt,filt,cb){ if(filt&&filt.table==="message_reactions"){ __rt[filt.event]=cb; } return this; },
                   subscribe(){return this} }),
    removeChannel:()=>{},
    auth:{ getSession:async()=>({data:{session:sess}}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
      signOut:async()=>({}), getUser:async()=>({data:{user:sess.user}}) }
  };
}};`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:900,height:760}, deviceScaleFactor:2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let fail = 0;
  const ok = (l, c, x) => { console.log(`  ${c?'PASS':'** FAIL **'}  ${l}${x!==undefined?'  -> '+JSON.stringify(x):''}`); if(!c) fail++; };

  await p.addInitScript(STUB);
  await p.goto('http://127.0.0.1:8899/index.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('nav.tabs button[data-p="chat"]').click());
  await p.waitForTimeout(900);

  console.log('\n--- what is on a message to start with ---');
  ok('existing reaction is shown', await p.locator('[data-msg="m1"] .mrx:not(.add)').count() === 1);
  ok('  with its count', (await p.locator('[data-msg="m1"] .mrx-n').first().textContent()) === '1');
  ok('an add button on every message', await p.locator('[data-msg="m2"] [data-mrxadd]').count() === 1);
  ok('the palette came from the database',
     !!(await p.evaluate(() => __rpc.find(c => c[0] === 'chat_emoji'))));

  console.log('\n--- the picker ---');
  await p.click('[data-msg="m2"] [data-mrxadd]'); await p.waitForTimeout(200);
  ok('opens', await p.locator('[data-msg="m2"] .mrxpick').isVisible());
  ok('with all eight', await p.locator('[data-msg="m2"] .mrxpick button').count() === 8);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Escape closes it', await p.locator('.mrxpick').count() === 0);

  console.log('\n--- adding one ---');
  await p.click('[data-msg="m2"] [data-mrxadd]'); await p.waitForTimeout(150);
  await p.click(`[data-msg="m2"] .mrxpick button[data-mrx="\u{1F602}"]`); await p.waitForTimeout(350);
  const call = await p.evaluate(() => __rpc.filter(c => c[0]==='react_message').pop());
  ok('calls react_message with the message and emoji', !!call, call);
  ok('chip appears, mine, count 1',
     await p.locator('[data-msg="m2"] .mrx.on .mrx-n').first().textContent() === '1');
  ok('picker closed itself', await p.locator('.mrxpick').count() === 0);

  console.log('\n--- toggling it off ---');
  await p.click(`[data-msg="m2"] .mrx.on`); await p.waitForTimeout(350);
  ok('chip goes away', await p.locator('[data-msg="m2"] .mrx:not(.add)').count() === 0);

  console.log('\n--- joining one somebody else left ---');
  await p.click(`[data-msg="m1"] .mrx:not(.add)`); await p.waitForTimeout(350);
  ok('count goes to 2', await p.locator('[data-msg="m1"] .mrx-n').first().textContent() === '2');
  ok('and it is marked as mine', await p.locator('[data-msg="m1"] .mrx.on').count() === 1);

  console.log('\n--- somebody else reacts, over realtime ---');
  await p.evaluate((o) => __rt['INSERT']({ new:{ message_id:"m2", user_id:o, emoji:"\u{1F389}" } }), OTHER);
  await p.waitForTimeout(300);
  ok('appears without a reload', await p.locator('[data-msg="m2"] .mrx:not(.add)').count() === 1);
  ok('  not marked as mine', await p.locator('[data-msg="m2"] .mrx.on').count() === 0);
  await p.evaluate((o) => __rt['DELETE']({ old:{ message_id:"m2", user_id:o, emoji:"\u{1F389}" } }), OTHER);
  await p.waitForTimeout(300);
  ok('and disappears when they take it back', await p.locator('[data-msg="m2"] .mrx:not(.add)').count() === 0);

  console.log('\n--- the server says no ---');
  await p.evaluate(() => { __fail = true; });
  const wasCount = await p.locator('[data-msg="m1"] .mrx-n').first().textContent();
  await p.click('[data-msg="m1"] [data-mrxadd]'); await p.waitForTimeout(150);
  await p.click(`[data-msg="m1"] .mrxpick button[data-mrx="\u{1F480}"]`); await p.waitForTimeout(500);
  ok('the optimistic chip is rolled back',
     await p.locator(`[data-msg="m1"] .mrx[data-mrx="\u{1F480}"]`).count() === 0);
  ok('  and the rest is untouched',
     await p.locator('[data-msg="m1"] .mrx-n').first().textContent() === wasCount);
  const toastTxt = await p.locator('#toast').textContent();
  ok('  with the reason shown', /limit/i.test(toastTxt), toastTxt.trim().slice(0,50));

  await p.evaluate(() => { __fail = false; });
  await p.locator('#chatlog').screenshot({ path: process.argv[2] + '/msgrx.png' });
  console.log('\npage errors: ' + (errs.length ? [...new Set(errs)].join(' | ') : 'none'));
  if (errs.length) fail++;
  console.log(fail ? `\nRESULT: ** ${fail} FAILED **` : '\nRESULT: ALL PASSED');
  await b.close();
  process.exit(fail?1:0);
})();
