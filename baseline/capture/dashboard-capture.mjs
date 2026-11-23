// Disposable. Run: node dashboard-capture.mjs <outDir>. Reads dashboard, writes only to outDir.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// DASHBOARD_DIR overrides the checkout (used for the forced run on a temporary copy).
const dashboardDir = path.resolve(process.env.DASHBOARD_DIR ?? path.join(import.meta.dirname, '../../../meta-frames-dashboard'));
const outDir = path.resolve(process.argv[2]);
const { chromium } = createRequire(dashboardDir + '/')('@playwright/test');

const APP = 'http://127.0.0.1:5199';
const API = 'http://127.0.0.1:18999'; // nothing listens here; every call is mocked
const PROPS = `background foreground card card-foreground popover popover-foreground primary primary-foreground
secondary secondary-foreground muted muted-foreground accent accent-foreground destructive border input ring
chart-1 chart-2 chart-3 chart-4 chart-5 sidebar sidebar-foreground sidebar-primary sidebar-primary-foreground
sidebar-accent sidebar-accent-foreground sidebar-border sidebar-ring dot`.split(/\s+/).map((name) => `--${name}`);
// Compile the dashboard's own index.css with its own Tailwind, so every candidate class exists (the page only has used ones).
const viteDir = realpathSync(path.join(dashboardDir, 'node_modules/@tailwindcss/vite'));
const { compile } = createRequire(viteDir + '/')('@tailwindcss/node');
const stylesDir = path.join(dashboardDir, 'src/styles');
const compiler = await compile(readFileSync(path.join(stylesDir, 'index.css'), 'utf8'), {
  base: stylesDir, onDependency: () => {},
});
const MONO_STACK = '"JetBrains Mono Variable", ui-monospace, monospace';
const MONO_FACE = 'JetBrains Mono Variable'; // @font-face family; the font file's own name is 'JetBrains Mono'
const MONO_TEXT = '7f3c9a1e-5b2d-4c8e-9a64-0d1f2e3b4c5d'; // entity-ID-like, as in AuditLogPage.vue:56
const TEXT = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
const compiledCss = compiler.build([...TEXT.map((name) => `text-${name}`), 'p-96', 'font-mono']);
if (PROPS.length !== 32) throw new Error(`expected 32 props, got ${PROPS.length}`);

// A server already on the port would serve a different checkout than DASHBOARD_DIR, so refuse it.
try {
  await fetch(APP);
  throw new Error(`port 5199 is already serving: stop that server first`);
} catch (error) {
  if (error.message.startsWith('port 5199')) throw error;
}
// Own process group: vp starts a child node process, and killing only vp leaves that child running.
// --strictPort makes the spawned Vite exit when another process holds the port, so readiness
// below requires proof that this child owns it: its stdout prints the URL, it is still running,
// and the URL answers.
const server = spawn('vp', ['dev', '--host', '127.0.0.1', '--port', '5199', '--strictPort'], {
  cwd: dashboardDir,
  env: { ...process.env, VITE_API_URL: API },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
let serverOutput = '';
let serverExit = null;
for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { serverOutput += chunk; });
server.on('exit', (code, signal) => { serverExit = { code, signal }; }); // registered before readiness
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const assertServerRunning = (when) => {
  if (!serverExit) return;
  const tail = stripAnsi(serverOutput).trim().split('\n').slice(-10).join('\n');
  throw new Error(`dev server exited ${when} (code ${serverExit.code}, signal ${serverExit.signal}). Last output:\n${tail}`);
};

// OS ownership check for the pre-capture and pre-write guards. The child's exit event can lag
// behind the process, so ask the OS: at least one listener must hold 5199 and every listener must
// be in the spawned child's process group (detached: true makes the group id equal the child pid).
// Any lookup failure fails the guard.
const assertPortOwnedByChild = (when) => {
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) throw new Error(`${command} failed ${when}: ${result.error.message}`);
    return result;
  };
  const listing = run('lsof', ['-nP', '-t', '-iTCP:5199', '-sTCP:LISTEN']);
  const listeners = listing.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (listing.status !== 0 && listeners.length) throw new Error(`lsof exited ${listing.status} ${when}: ${listing.stderr.trim()}`);
  if (listing.status > 1 || (listing.status === 1 && listing.stderr.trim())) throw new Error(`lsof exited ${listing.status} ${when}: ${listing.stderr.trim()}`);
  const groups = listeners.map((pid) => {
    const result = run('ps', ['-o', 'pgid=', '-p', pid]);
    const group = result.stdout.trim();
    if (result.status !== 0 || !group) throw new Error(`ps failed for listener ${pid} ${when}: ${result.stderr.trim() || 'no output'}`);
    return { pid, group };
  });
  const described = groups.map(({ pid, group }) => `pid ${pid} group ${group}`).join(', ') || 'none';
  if (!groups.length || groups.some(({ group }) => Number(group) !== server.pid)) {
    throw new Error(`port 5199 is not owned by the spawned dev server ${when} (spawned group ${server.pid}; listeners: ${described})`);
  }
};

const stocks = [
  ['Kodak', 'Portra 400', 'Color negative'], ['Ilford', 'HP5 Plus', 'B&W negative'],
  ['Fujifilm', 'Velvia 50', 'Color reversal'], ['Kodak', 'Tri-X 400', 'B&W negative'],
  ['CineStill', '800T', 'Color negative'],
].map(([brand, name, kind], index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`, brand, name,
  type: kind === 'Color negative' ? 'color-negative' : kind === 'B&W negative' ? 'bw-negative' : 'color-reversal',
  boxIso: '400', process: 'c41', packaging: '135',
}));

async function waitFor(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    assertServerRunning('before it was ready');
    if (/http:\/\/127\.0\.0\.1:5199\b/.test(stripAnsi(serverOutput))) {
      try {
        if ((await fetch(url)).ok) {
          assertServerRunning('while becoming ready');
          return;
        }
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`dev server did not print its local URL and answer in time. Last output:\n${stripAnsi(serverOutput).trim().split('\n').slice(-10).join('\n')}`);
}

try {
  await waitFor(APP);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
    colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC',
  });
  await context.route(`${API}/**`, (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': APP, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const body = url.pathname === '/auth/me'
      ? { id: 'u1', email: 'baseline@example.com', name: 'Baseline', createdAt: '2026-01-01T00:00:00Z' }
      : url.pathname === '/film-stocks' ? stocks : [];
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  });
  assertPortOwnedByChild('before the capture started');
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto(`${APP}/app/stocks`, { waitUntil: 'networkidle' });
  await page.getByText('Portra 400').first().waitFor();

  // Before fonts load: add the sample and read its computed font-family at once. A fallback
  // rendering cannot be the baseline, so every failure here throws before anything is written.
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const usedFonts = async (selector) => {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    return (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map((font) => ({
      familyName: font.familyName, isCustomFont: font.isCustomFont, glyphCount: font.glyphCount,
    }));
  };
  const monoUsage = async (selector) => {
    const used = await usedFonts(selector);
    if (!used.length || used.some((font) => !font.isCustomFont || !font.familyName.startsWith('JetBrains Mono'))) {
      throw new Error(`mono sample does not render with the loaded ${MONO_FACE} face: ${JSON.stringify(used)}`);
    }
    return used;
  };
  const faceState = () => page.evaluate((face) => [...document.fonts].filter((entry) => entry.family.replaceAll('"', '') === face).map((entry) => entry.status), MONO_FACE);
  const before = await page.evaluate(({ text, face }) => {
    const sample = document.createElement('div');
    sample.id = 'mf-mono-probe'; sample.className = 'font-mono text-xs'; sample.textContent = text;
    document.body.append(sample);
    return {
      computedFontFamily: getComputedStyle(sample).fontFamily,
      faceStatusesAtInsert: [...document.fonts].filter((entry) => entry.family.replaceAll('"', '') === face).map((entry) => entry.status),
    };
  }, { text: MONO_TEXT, face: MONO_FACE });
  if (before.computedFontFamily !== MONO_STACK) throw new Error(`font-mono computed font-family is ${before.computedFontFamily}, expected ${MONO_STACK}`);
  if (!before.faceStatusesAtInsert.length) throw new Error(`no @font-face for ${MONO_FACE}: the Fontsource import is missing`);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => document.fonts.ready);
  const probeFonts = await monoUsage('#mf-mono-probe');
  await page.evaluate(() => document.getElementById('mf-mono-probe').remove());

  const resolveAll = (args) => page.evaluate(({ PROPS, TEXT, dark, compiledCss }) => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    const rootStyle = getComputedStyle(root);
    const probe = document.createElement('div');
    document.body.append(probe);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const bytesOver = (color, backdrop) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const alphaBytes = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const colors = {};
    for (const prop of PROPS) {
      probe.style.backgroundColor = `var(${prop})`;
      const painted = getComputedStyle(probe).backgroundColor;
      colors[prop] = {
        declared: rootStyle.getPropertyValue(prop).trim(),
        painted,
        rgbaAlone: alphaBytes(painted),
        rgbaOverWhite: bytesOver(painted, '#ffffff'),
        rgbaOverBlack: bytesOver(painted, '#000000'),
      };
    }
    const radii = {};
    for (const px of [16, 20]) {
      root.style.fontSize = `${px}px`;
      radii[`${px}px`] = { '--radius': getComputedStyle(root).getPropertyValue('--radius').trim() };
      for (const name of ['sm', 'md', 'lg', 'xl']) {
        radii[`${px}px`][`--radius-${name}`] = {
          viaUtility: (() => { const el = document.createElement('div'); el.className = `rounded-${name}`; document.body.append(el); const v = getComputedStyle(el).borderTopLeftRadius; el.remove(); return v; })(),
        };
      }
    }
    root.style.fontSize = '';
    const fonts = {};
    for (const name of ['heading', 'sans', 'mono']) {
      const el = document.createElement('div'); el.className = `font-${name}`; document.body.append(el);
      fonts[`--font-${name}`] = { declared: rootStyle.getPropertyValue(`--font-${name}`).trim(), computedFontFamily: getComputedStyle(el).fontFamily };
      el.remove();
    }
    const emitted = Object.fromEntries(TEXT.map((name) => [name, {
      '--text': rootStyle.getPropertyValue(`--text-${name}`).trim(),
      '--text--line-height': rootStyle.getPropertyValue(`--text-${name}--line-height`).trim(),
    }]));
    const style = document.createElement('style'); style.textContent = compiledCss; document.head.append(style);
    const text = {};
    for (const name of TEXT) {
      const el = document.createElement('div'); el.className = `text-${name}`; document.body.append(el);
      const cs = getComputedStyle(el);
      text[name] = { emittedAtRuntime: emitted[name], fontSize: cs.fontSize, lineHeight: cs.lineHeight };
      el.remove();
    }
    const spacingEl = document.createElement('div'); document.body.append(spacingEl);
    const spacing = { '--spacing': rootStyle.getPropertyValue('--spacing').trim(), utilities: {} };
    for (const step of ['1', '0.5', '2.5', '4', '96']) {
      spacingEl.className = `p-${step}`;
      spacing.utilities[`p-${step}`] = getComputedStyle(spacingEl).paddingTop;
    }
    spacingEl.remove(); probe.remove(); style.remove();
    return { mode: dark ? 'dark' : 'light', colors, radii, fonts, text, spacing };
  }, args);

  const data = { light: await resolveAll({ PROPS, TEXT, dark: false, compiledCss }), dark: await resolveAll({ PROPS, TEXT, dark: true, compiledCss }) };
  data.monoSample = { text: MONO_TEXT, expectedStack: MONO_STACK, beforeLoad: before, afterLoadUsedFonts: probeFonts, perMode: {} };
  const outputs = new Map();

  for (const mode of ['light', 'dark']) {
    await page.evaluate(({ dark, monoText }) => {
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.getElementById('mf-fixture')?.remove();
      const fixture = document.createElement('div');
      fixture.id = 'mf-fixture';
      fixture.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--card);border:1px solid var(--border);';
      fixture.innerHTML = `<div style="display:flex;gap:4px">${[1, 2, 3, 4, 5].map((n) => `<div style="width:32px;height:32px;background:var(--chart-${n})"></div>`).join('')}</div>
        <div style="display:flex;gap:4px">${['primary', 'secondary', 'muted', 'accent', 'destructive', 'sidebar-primary', 'sidebar-accent'].map((n) => `<div style="width:32px;height:16px;background:var(--${n})"></div>`).join('')}</div>
        <input id="mf-ring" class="rounded-md border border-input bg-background px-2 py-1 text-sm" value="ring" style="outline-offset:2px" />
        <div class="bg-dots" style="height:48px;background-color:var(--background)"></div>
        <div id="mf-mono" class="font-mono text-xs">${monoText}</div>
        <div style="height:16px;background:linear-gradient(90deg,#fff 50%,#000 50%)"><div style="height:16px;width:100%;background:var(--ring)"></div></div>`;
      document.body.append(fixture);
    }, { dark: mode === 'dark', monoText: MONO_TEXT });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.focus('#mf-ring');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // keyboard focus so :focus-visible paints the ring
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const family = await page.evaluate(() => getComputedStyle(document.getElementById('mf-mono')).fontFamily);
    if (family !== MONO_STACK) throw new Error(`${mode}: sample font-family is ${family}, expected ${MONO_STACK}`);
    data.monoSample.perMode[mode] = { computedFontFamily: family, usedFonts: await monoUsage('#mf-mono'), faceStatuses: await faceState() };
    outputs.set(`dashboard-${mode}.png`, await page.screenshot({ fullPage: true, animations: 'disabled' }));
  }
  data.loadedFontFaces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => `${face.family} ${face.weight}`); });
  if (!data.loadedFontFaces.some((face) => face.startsWith(`${MONO_FACE} `))) throw new Error(`${MONO_FACE} is not among the loaded faces: ${data.loadedFontFaces}`);
  console.log('browser', browser.version());
  outputs.set('dashboard-resolved.json', JSON.stringify(data, null, 2) + '\n');
  outputs.set('browser-version.txt', browser.version() + '\n');
  await browser.close();
  assertPortOwnedByChild('before writing outputs');
  // Every check passed: only now touch the output directory.
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of outputs) writeFileSync(path.join(outDir, name), content);
} finally {
  stop();
}
