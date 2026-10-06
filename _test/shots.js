/* Screenshots of every new surface, at laptop and phone widths, against the
   mock backend:  node _test/shots.js <out dir>   Also fails on any page error. */
const { setup } = require('./browser');
const out = process.argv[2] || '.';
(async () => {
  const b = await setup();
  const errs = [];
  for (const [tag, vp] of [['laptop', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: tag === 'phone' ? 2 : 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message));
    /* the daily recap is somebody else's surface; mark it seen so it stays out of the way */
    await p.addInitScript(() => { const d = new Date(), z = n => String(n).padStart(2, '0');
      localStorage.setItem('st.recap.00000000-0000-4000-8000-000000000001', d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())); });
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(tag + ' console: ' + m.text()); });
    await p.goto(b.base + '/_test/index.html', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${tag}-cele.png` });
    const close = await p.$('#pl-cele [data-plclose]:not([data-plgo])');
    if (close) { await close.click(); await p.waitForTimeout(400); }
    await p.screenshot({ path: `${out}/${tag}-top.png` });
    const day = await p.$('#pl-day');
    if (day) await day.screenshot({ path: `${out}/${tag}-day.png` });
    await p.click('#pl-day [data-plview="week"]'); await p.waitForTimeout(200);
    await (await p.$('#pl-day')).screenshot({ path: `${out}/${tag}-week.png` });
    await p.click('#pl-day [data-plview="pattern"]'); await p.waitForTimeout(200);
    await (await p.$('#pl-day')).screenshot({ path: `${out}/${tag}-pattern.png` });
    await p.click('#pl-day [data-plview="day"]');
    await p.click('nav.tabs button[data-p="me"]'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/${tag}-me.png`, fullPage: true });
    await p.click('nav.tabs button[data-p="crew"]'); await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}/${tag}-crew.png`, fullPage: true });
    await p.click('[data-profile="00000000-0000-4000-8000-000000000003"]');
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${tag}-profile.png` });
    await p.close();
  }
  await b.close();
  if (errs.length) { console.log(errs.join('\n')); process.exit(1); }
  console.log('shots ok');
})().catch(e => { console.error(e); process.exit(1); });
