/* What every browser test shares, so each one runs with a single command on
   any machine:  node _test/smoke.js

   Three things used to be assumed and each broke a run somewhere:

   * Where Playwright lives. The tests named one sandbox's install path. Now
     it is looked for as playwright, then playwright-core, locally, in the
     global npm folder, and at that old path. Install either once with
     npm i -g playwright-core

   * Which browser. Full playwright brings its own Chromium; playwright-core
     does not, so if there is none the installed Google Chrome is used.

   * That the CDN is unreachable. index.html loads the real supabase-js from
     cdn.jsdelivr.net, and when it arrives it replaces the stub a test put on
     window.supabase — the app then meets the real client, nobody is signed
     in, and the test fails at the sign-in screen for no reason to do with the
     code. That only passed where the network happened to block the CDN. Every
     page made here blocks it, so the stub always survives.

   And the page is served by the test itself, from the repository root, on a
   free port — no separate server to remember to start. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findPlaywright() {
  const roots = [__dirname, process.cwd()];
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (e) {}
  roots.push('/opt/node22/lib/node_modules');
  for (const name of ['playwright', 'playwright-core']) {
    for (const root of roots) {
      try { return require(require.resolve(name, { paths: [root] })); } catch (e) {}
    }
  }
  throw new Error('Playwright not found. Install it once with: npm i -g playwright-core');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    let file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () =>
    ok({ base: 'http://127.0.0.1:' + server.address().port, close: () => server.close() })));
}

const CHROME = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
}[process.platform];

async function setup() {
  const { chromium } = findPlaywright();
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    if (!CHROME || !fs.existsSync(CHROME)) throw e;
    browser = await chromium.launch({ executablePath: CHROME });
  }
  const site = await serve();
  const newPage = async (opts) => {
    const p = await browser.newPage(opts);
    await p.route(/cdn\.jsdelivr\.net/, r => r.abort());
    return p;
  };
  const close = async () => { await browser.close(); site.close(); };
  return { base: site.base, newPage, close };
}

module.exports = { setup };
