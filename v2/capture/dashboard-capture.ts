// Disposable. Run: node dashboard-capture.ts <outDir>. Reads dashboard, writes only to outDir.
// v2 copy of baseline/capture/dashboard-capture.mjs (sha256 a45ae031992d…). Changes: the listener guard
// (Slice 3d WARN 3), all --mf- and public properties, painted samples, text steps and spacing at two
// root sizes, and the three font faces. Property names and spec values come from oracle.ts, which
// imports nothing from the generator. Every check runs before anything is written.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DASHBOARD_PUBLIC, expectedCss, FONT_ROLES, readSource, TEXT_STEPS } from '../../oracle.ts';

// DASHBOARD_DIR overrides the checkout (used for the forced run on a temporary copy).
// Playwright objects and capture results are untyped at the boundary; every check below is a run-time check.
type Tree = any;
type Face = { role: string; property: string; className: string; stack: string; face: string; prefix: string };

const dashboardDir = path.resolve(process.env.DASHBOARD_DIR ?? path.join(import.meta.dirname, '../../../meta-frames-dashboard'));
const outDir = path.resolve(process.argv[2]);
const { chromium } = createRequire(dashboardDir + '/')('@playwright/test');

const APP = 'http://127.0.0.1:5199';
const LISTENER_NAME = '127.0.0.1:5199';
const API = 'http://127.0.0.1:18999'; // nothing listens here; every call is mocked
const ROOT_SIZES = [16, 20];

const { leaves } = readSource(readFileSync(path.join(import.meta.dirname, '../tokens.json'), 'utf8'));
const expected = expectedCss(leaves);
const PUBLIC_NAMES = DASHBOARD_PUBLIC.map(([property]) => property);
if (PUBLIC_NAMES.length !== 32) throw new Error(`expected 32 public properties, got ${PUBLIC_NAMES.length}`);
// Every property under :root (the --mf- leaves, the public properties and --radius) and which of them are colours.
const ROOT_NAMES = [...expected.root.keys()];
const COLOR_NAMES = [...expected.dark.keys()];
const UTILITY_COLORS = PUBLIC_NAMES.map((name) => name.slice(2)); // bg-<name> exists for each --color-<name> alias
const TEXT = [...TEXT_STEPS.map(([step]) => step), '4xl']; // 4xl keeps the Tailwind default: recorded, not compared
const SPACING = ['0.5', '1', '2.5', '4', '96'];
// [role, utility class, face family from the spec stack, platform family prefix, property]
const FACES: Face[] = Object.entries(FONT_ROLES).map(([role, { stack, property }]) => ({
  role, property, className: `font-${property.slice('--font-'.length)}`,
  stack: stack.join(', '), face: stack[0]!.replaceAll('"', ''),
  prefix: stack[0]!.replaceAll('"', '').replace(/ Variable$/, ''),
}));
if (FACES.length !== 3) throw new Error(`expected 3 font roles, got ${FACES.length}`);

// Compile the dashboard's own index.css with its own Tailwind, so every candidate class exists (the page only has used ones).
const viteDir = realpathSync(path.join(dashboardDir, 'node_modules/@tailwindcss/vite'));
const { compile } = createRequire(viteDir + '/')('@tailwindcss/node');
const stylesDir = path.join(dashboardDir, 'src/styles');
const compiler = await compile(readFileSync(path.join(stylesDir, 'index.css'), 'utf8'), {
  base: stylesDir, onDependency: () => {},
});
const MONO_TEXT = '7f3c9a1e-5b2d-4c8e-9a64-0d1f2e3b4c5d'; // entity-ID-like, as in AuditLogPage.vue:56
const compiledCss = compiler.build([
  ...TEXT.map((name) => `text-${name}`),
  ...SPACING.map((step) => `p-${step}`),
  ...['sm', 'md', 'lg', 'xl'].map((name) => `rounded-${name}`),
  ...UTILITY_COLORS.map((name) => `bg-${name}`),
  'font-heading', 'font-sans', 'font-mono',
]);

// A server already on the port would serve a different checkout than DASHBOARD_DIR, so refuse it.
try {
  await fetch(APP);
  throw new Error(`port 5199 is already serving: stop that server first`);
} catch (error) {
  if ((error as Error).message.startsWith('port 5199')) throw error;
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
const stop = () => { try { process.kill(-server.pid!, 'SIGTERM'); } catch {} };
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1)); // runs the exit handler
let serverOutput = '';
let serverExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { serverOutput += chunk; });
server.on('exit', (code, signal) => { serverExit = { code, signal }; }); // registered before readiness
const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const assertServerRunning = (when: string): void => {
  if (!serverExit) return;
  const tail = stripAnsi(serverOutput).trim().split('\n').slice(-10).join('\n');
  throw new Error(`dev server exited ${when} (code ${serverExit.code}, signal ${serverExit.signal}). Last output:\n${tail}`);
};

// OS ownership guard for the pre-capture and pre-write checks. It reads each listener's socket name
// and PID from `lsof -F pn` (one `n` line per listening socket, either IP family). It passes only
// when there is exactly one listener, it is on 127.0.0.1:5199, and its process group is the spawned
// group (detached: true makes the group id equal the child pid). It fails on no listener, a second
// listener in either family (also in the same group), an IPv6 or wildcard listener, a listener in
// another group, and any lsof or ps error.
const assertPortOwnedByChild = (when: string): void => {
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) throw new Error(`${command} failed ${when}: ${result.error.message}`);
    return result;
  };
  const listing = run('lsof', ['-nP', '-iTCP:5199', '-sTCP:LISTEN', '-Fpn']);
  const noListener = listing.status === 1 && !listing.stdout.trim() && !listing.stderr.trim(); // lsof exit 1, no output: nothing found
  if (listing.status !== 0 && !noListener) throw new Error(`lsof exited ${listing.status} ${when}: ${listing.stderr.trim()}`);
  let pid: string | null = null;
  const listeners: { pid: string | null; name: string; group?: string }[] = [];
  for (const line of listing.stdout.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('n')) listeners.push({ pid, name: line.slice(1) });
  }
  const described = (items: typeof listeners): string => items.map(({ pid: id, name, group }) => `pid ${id} group ${group ?? '?'} ${name}`).join(', ') || 'none';
  for (const listener of listeners) {
    if (!/^\d+$/.test(listener.pid ?? '')) throw new Error(`lsof output has no pid for listener ${listener.name} ${when}`);
    const result = run('ps', ['-o', 'pgid=', '-p', listener.pid!]);
    listener.group = result.stdout.trim();
    if (result.status !== 0 || !listener.group) throw new Error(`ps failed for listener ${listener.pid} ${when}: ${result.stderr.trim() || 'no output'}`);
  }
  const owned = listeners.length === 1 && listeners[0].name === LISTENER_NAME && Number(listeners[0].group) === server.pid;
  if (!owned) {
    throw new Error(`port 5199 is not owned by the spawned dev server ${when}: expected exactly one listener on ${LISTENER_NAME} in group ${server.pid}; found ${listeners.length} (${described(listeners)})`);
  }
  console.log(`port guard ok ${when}: ${described(listeners)}`);
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

async function waitFor(url: string): Promise<void> {
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

let browser;
try {
  await waitFor(APP);
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
    colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC',
  });
  await context.route(`${API}/**`, (route: Tree) => {
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

  // Before fonts load: add one sample per face and read its computed font-family at once. A fallback
  // rendering cannot be the baseline, so every failure here throws before anything is written.
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const usedFonts = async (selector: string) => {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    return (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map((font: Tree) => ({
      familyName: font.familyName, isCustomFont: font.isCustomFont, glyphCount: font.glyphCount,
    }));
  };
  // The sample must render with the loaded custom face, not a fallback.
  const faceUsage = async (selector: string, face: Face) => {
    const used = await usedFonts(selector);
    if (!used.length || used.some((font: Tree) => !font.isCustomFont || !font.familyName.startsWith(face.prefix))) {
      throw new Error(`${face.property} sample does not render with the loaded ${face.face} face: ${JSON.stringify(used)}`);
    }
    return used;
  };
  const faceStates = (face: string) => page.evaluate((name: string) => [...document.fonts].filter((entry) => entry.family.replaceAll('"', '') === name).map((entry) => entry.status), face);
  const before = await page.evaluate(({ faces, text }: { faces: Face[]; text: string }) => Object.fromEntries(faces.map((face: Face) => {
    const sample = document.createElement('div');
    sample.id = `mf-face-${face.role}`; sample.className = `${face.className} text-xs`; sample.textContent = text;
    document.body.append(sample);
    return [face.role, {
      computedFontFamily: getComputedStyle(sample).fontFamily,
      faceStatusesAtInsert: [...document.fonts].filter((entry) => entry.family.replaceAll('"', '') === face.face).map((entry) => entry.status),
    }];
  })), { faces: FACES, text: MONO_TEXT });
  for (const face of FACES) {
    const state = before[face.role];
    if (state.computedFontFamily !== face.stack) throw new Error(`${face.className} computed font-family is ${state.computedFontFamily}, expected ${face.stack}`);
    if (!state.faceStatusesAtInsert.length) throw new Error(`no @font-face for ${face.face}: the Fontsource import is missing`);
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => document.fonts.ready);
  const faceProbes: Tree = {};
  for (const face of FACES) {
    faceProbes[face.role] = { ...before[face.role], expectedStack: face.stack, usedFonts: await faceUsage(`#mf-face-${face.role}`, face) };
  }
  await page.evaluate(() => { for (const probe of document.querySelectorAll('[id^="mf-face-"]')) probe.remove(); });

  const resolveAll = (args: Tree) => page.evaluate(({ rootNames, colorNames, utilityColors, textNames, spacingSteps, rootSizes, faces, dark, compiledCss }: Tree) => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    const rootStyle = getComputedStyle(root);
    const probe = document.createElement('div');
    document.body.append(probe);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const bytesOver = (color: string, backdrop: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const alphaBytes = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const measure = (painted: string) => ({ painted, rgbaAlone: alphaBytes(painted), rgbaOverWhite: bytesOver(painted, '#ffffff'), rgbaOverBlack: bytesOver(painted, '#000000') });
    const style = document.createElement('style'); style.textContent = compiledCss; document.head.append(style);
    const append = (className: string) => { const el = document.createElement('div'); el.className = className; document.body.append(el); return el; };

    const properties: Tree = {};
    for (const name of rootNames) {
      properties[name] = { declared: rootStyle.getPropertyValue(name).trim() };
      if (colorNames.includes(name)) {
        probe.style.backgroundColor = `var(${name})`;
        Object.assign(properties[name], measure(getComputedStyle(probe).backgroundColor));
      }
    }
    const swatches: Tree = {};
    for (const name of utilityColors) {
      const el = append(`bg-${name}`);
      swatches[`--${name}`] = measure(getComputedStyle(el).backgroundColor);
      el.remove();
    }
    const state = (inlineStyle: string) => {
      const el = append('');
      el.setAttribute('style', inlineStyle);
      const computed = getComputedStyle(el);
      const result = { backgroundColor: measure(computed.backgroundColor), color: measure(computed.color) };
      el.remove();
      return result;
    };
    const sidebar = {
      container: state('background:var(--sidebar);color:var(--sidebar-foreground)'),
      active: state('background:var(--sidebar-accent);color:var(--sidebar-accent-foreground)'),
      idle: state('color:var(--sidebar-foreground)'),
      primary: state('background:var(--sidebar-primary);color:var(--sidebar-primary-foreground)'),
    };
    const fonts: Tree = {};
    for (const face of faces) {
      const el = append(face.className);
      fonts[face.property] = { declared: rootStyle.getPropertyValue(face.property).trim(), computedFontFamily: getComputedStyle(el).fontFamily };
      el.remove();
    }
    const sizes: Tree = {};
    for (const px of rootSizes) {
      root.style.fontSize = `${px}px`;
      const text: Tree = {};
      for (const name of textNames) {
        const el = append(`text-${name}`);
        const cs = getComputedStyle(el);
        text[name] = { fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight };
        el.remove();
      }
      const spacing: Tree = {};
      for (const step of spacingSteps) {
        const el = append(`p-${step}`);
        spacing[`p-${step}`] = getComputedStyle(el).paddingTop;
        el.remove();
      }
      const radii: Tree = { '--radius': getComputedStyle(root).getPropertyValue('--radius').trim() };
      for (const name of ['sm', 'md', 'lg', 'xl']) {
        const el = append(`rounded-${name}`);
        radii[`rounded-${name}`] = getComputedStyle(el).borderTopLeftRadius;
        el.remove();
      }
      sizes[`${px}px`] = { text, spacing, radii };
    }
    root.style.fontSize = '';
    probe.remove(); style.remove();
    return { mode: dark ? 'dark' : 'light', properties, swatches, sidebar, fonts, sizes };
  }, args);

  const resolveArgs = {
    rootNames: ROOT_NAMES, colorNames: COLOR_NAMES, utilityColors: UTILITY_COLORS, textNames: TEXT, spacingSteps: SPACING,
    rootSizes: ROOT_SIZES, faces: FACES, compiledCss,
  };
  const data: Tree = { schema: 2, rootSizes: ROOT_SIZES.map((px) => `${px}px`), faces: { probes: faceProbes }, modes: {} };
  const outputs = new Map<string, string | Buffer>();

  for (const mode of ['light', 'dark']) {
    data.modes[mode] = await resolveAll({ ...resolveArgs, dark: mode === 'dark' });
    await page.evaluate(({ dark, monoText }: { dark: boolean; monoText: string }) => {
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.getElementById('mf-fixture')?.remove();
      const fixture = document.createElement('div');
      fixture.id = 'mf-fixture';
      fixture.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--card);border:1px solid var(--border);';
      fixture.innerHTML = `<div style="display:flex;gap:4px">${[1, 2, 3, 4, 5].map((step) => `<div style="width:32px;height:32px;background:var(--chart-${step})"></div>`).join('')}</div>
        <div style="display:flex;gap:4px">${['primary', 'secondary', 'muted', 'accent', 'destructive', 'sidebar-primary', 'sidebar-accent'].map((name) => `<div style="width:32px;height:16px;background:var(--${name})"></div>`).join('')}</div>
        <div id="mf-sidebar" style="background:var(--sidebar);border:1px solid var(--sidebar-border);padding:4px;width:160px">
          <div id="mf-side-active" class="text-sm" style="background:var(--sidebar-accent);color:var(--sidebar-accent-foreground);padding:4px">Active item</div>
          <div id="mf-side-idle" class="text-sm" style="color:var(--sidebar-foreground);padding:4px">Idle item</div>
        </div>
        <input id="mf-ring" class="rounded-md border border-input bg-background px-2 py-1 text-sm" value="ring" style="outline-offset:2px" />
        <div id="mf-dots" class="bg-dots" style="height:48px;background-color:var(--background)"></div>
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
    const fixtureData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const bytesOver = (color: string, backdrop: string) => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const input = getComputedStyle(document.getElementById('mf-ring')!);
      const dots = getComputedStyle(document.getElementById('mf-dots')!);
      const probe = document.createElement('div'); probe.style.backgroundColor = 'var(--dot)'; document.body.append(probe);
      const dotPainted = getComputedStyle(probe).backgroundColor; probe.remove();
      const ringDeclared = getComputedStyle(document.documentElement).getPropertyValue('--ring').trim();
      return {
        focusRing: {
          matchesFocusVisible: document.getElementById('mf-ring')!.matches(':focus-visible'),
          outlineColor: input.outlineColor, outlineWidth: input.outlineWidth, outlineStyle: input.outlineStyle, outlineOffset: input.outlineOffset,
          rgbaOverWhite: bytesOver(input.outlineColor, '#ffffff'), rgbaOverBlack: bytesOver(input.outlineColor, '#000000'), ringDeclared,
        },
        dots: { backgroundImage: dots.backgroundImage, backgroundSize: dots.backgroundSize, dotPainted },
        audit: { fontFamily: getComputedStyle(document.getElementById('mf-mono')!).fontFamily },
      };
    });
    const mono = FACES.find((face) => face.role === 'mono')!;
    if (fixtureData.audit.fontFamily !== mono.stack) throw new Error(`${mode}: audit ID sample font-family is ${fixtureData.audit.fontFamily}, expected ${mono.stack}`);
    fixtureData.audit.text = MONO_TEXT;
    fixtureData.audit.usedFonts = await faceUsage('#mf-mono', mono);
    fixtureData.audit.faceStatuses = await faceStates(mono.face);
    // Every required sample must use its loaded custom face in this mode at each root size. A fallback stops the run.
    for (const px of ROOT_SIZES) {
      await page.evaluate(({ faces, size, text }: { faces: Face[]; size: number; text: string }) => {
        document.documentElement.style.fontSize = `${size}px`;
        for (const face of faces) {
          const sample = document.createElement('div');
          sample.id = `mf-check-${face.role}`; sample.className = `${face.className} text-xs`; sample.textContent = text;
          document.body.append(sample);
        }
      }, { faces: FACES, size: px, text: MONO_TEXT });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => document.fonts.ready);
      try {
        for (const face of FACES) await faceUsage(`#mf-check-${face.role}`, face);
      } catch (error) {
        throw new Error(`${mode} mode, ${px}px root: ${(error as Error).message}`);
      }
      await page.evaluate(() => {
        for (const sample of document.querySelectorAll('[id^="mf-check-"]')) sample.remove();
        document.documentElement.style.fontSize = '';
      });
    }
    Object.assign(data.modes[mode], fixtureData);
    outputs.set(`dashboard-${mode}.png`, await page.screenshot({ fullPage: true, animations: 'disabled' }));
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    outputs.set(`dashboard-${mode}-20px.png`, await page.screenshot({ fullPage: true, animations: 'disabled' }));
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  }
  data.faces.loaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => `${face.family.replaceAll('"', '')} ${face.weight}`); });
  for (const face of FACES) {
    if (!data.faces.loaded.some((entry: string) => entry.startsWith(`${face.face} `))) throw new Error(`${face.face} is not among the loaded faces: ${data.faces.loaded}`);
  }
  console.log('browser', browser.version());
  outputs.set('dashboard-resolved.json', JSON.stringify(data, null, 2) + '\n');
  outputs.set('browser-version.txt', browser.version() + '\n');
  await browser.close();
  assertPortOwnedByChild('before writing outputs');
  // Every check passed: only now touch the output directory.
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of outputs) writeFileSync(path.join(outDir, name), content);
} finally {
  await browser?.close().catch(() => {}); // a failed check must not leave Chromium running
  stop();
}
