// Slice 4 probes. Run from the workspace root: node meta-frames-design-tokens/capture/probes/run-probes.ts [listener|fonts]
// Listener probes open real sockets through a fake `vp` (fake-vp.ts) and run the real dashboard-capture.ts.
// Font probes run the real captures against a temporary dashboard copy or a temporary app asset folder.
// Each failing probe must exit nonzero and write nothing. Prints one line per probe, exits 1 if any probe misbehaves.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = import.meta.dirname;
const root = path.resolve(here, '../../..'); // the workspace root: capture/probes is three levels below it
const capture = path.join(here, '..', 'dashboard-capture.ts');
const appTest = path.join(here, '..', 'app_capture_test.dart');
const workDir = mkdtempSync(path.join(tmpdir(), 'mf-probes-'));
let failures = 0;
const report = (name: string, passed: boolean, detail: string): void => {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const shim = (name: string, body: string): void => {
  mkdirSync(path.join(workDir, 'bin'), { recursive: true });
  const file = path.join(workDir, 'bin', name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
};
shim('vp', `exec "${process.execPath}" "${path.join(here, 'fake-vp.ts')}"`);

const portListeners = () => spawnSync('lsof', ['-nP', '-iTCP:5199', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

// Runs the capture. stopOn: a pattern in the output after which the run is stopped (the passing probe).
type CaptureRun = { code: number | null; output: string; outDir: string; stopped: boolean };
type CaptureOptions = { mode: string; extraBin?: string; env?: Record<string, string>; stopOn?: RegExp; outName: string; dashboardDir?: string };
function runCapture({ mode, extraBin, env = {}, stopOn, outName, dashboardDir }: CaptureOptions): Promise<CaptureRun> {
  return new Promise((resolve) => {
    const outDir = path.join(workDir, outName);
    const pathDirs = [path.join(workDir, 'bin'), ...(extraBin ? [path.join(workDir, extraBin)] : [])];
    const child = spawn(process.execPath, [capture, outDir], {
      env: { ...process.env, PATH: `${pathDirs.join(':')}:${process.env.PATH}`, FAKE_VP_MODE: mode, FAKE_VP_DIR: workDir, ...(dashboardDir && { DASHBOARD_DIR: dashboardDir }), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let stopped = false;
    const onData = (chunk: Buffer) => {
      output += chunk;
      if (stopOn && !stopped && stopOn.test(output)) { stopped = true; child.kill('SIGTERM'); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => resolve({ code, output, outDir, stopped }));
  });
}
const stopForeign = () => {
  const file = path.join(workDir, 'foreign.pid');
  if (existsSync(file)) { try { process.kill(-Number(readFileSync(file, 'utf8')), 'SIGTERM'); } catch {} rmSync(file); }
};

async function listenerProbes() {
  mkdirSync(path.join(workDir, 'fail-lsof'), { recursive: true });
  mkdirSync(path.join(workDir, 'fail-ps'), { recursive: true });
  for (const [dir, name, body] of [['fail-lsof', 'lsof', 'echo "lsof: simulated failure" >&2; exit 2'], ['fail-ps', 'ps', 'echo "ps: simulated failure" >&2; exit 1']]) {
    const file = path.join(workDir, dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
  type Probe = { name: string; mode: string; extraBin?: string; stopOn?: RegExp; pass?: (run: CaptureRun) => unknown; fail?: RegExp | ((run: CaptureRun) => unknown) };
  const cases: Probe[] = [
    { name: 'one owned IPv4 listener passes', mode: 'owned', stopOn: /port guard ok before the capture started/, pass: (run: CaptureRun) => run.stopped && /port guard ok before the capture started: pid \d+ group \d+ 127\.0\.0\.1:5199/.test(run.output) },
    { name: 'IPv6-only listener fails', mode: 'ipv6-only', fail: /not owned by the spawned dev server before the capture started.*found 1 \(pid \d+ group \d+ \[::1\]:5199\)/s },
    { name: 'two listeners in the same group fail', mode: 'two-same-group', fail: (run: CaptureRun) => {
      const found = /found 2 \(pid \d+ group (\d+) (\S+), pid \d+ group (\d+) (\S+)\)/.exec(run.output);
      return found && found[1] === found[3] && /in group (\d+)/.exec(run.output)?.[1] === found[1] && [found[2], found[4]].sort().join() === '127.0.0.1:5199,[::1]:5199';
    } },
    { name: 'listener in a different group fails', mode: 'foreign-group', fail: (run: CaptureRun) => {
      const match = /in group (\d+); found 1 \(pid \d+ group (\d+) 127\.0\.0\.1:5199\)/.exec(run.output);
      return match && match[1] !== match[2];
    } },
    { name: 'no listener fails', mode: 'none', fail: /found 0 \(none\)/ },
    { name: 'lsof failure fails', mode: 'lsof-fail', extraBin: 'fail-lsof', fail: /lsof exited 2 before the capture started: lsof: simulated failure/ },
    { name: 'ps failure fails', mode: 'ps-fail', extraBin: 'fail-ps', fail: /ps failed for listener \d+ before the capture started: ps: simulated failure/ },
  ];
  for (const [index, entry] of cases.entries()) {
    const run = await runCapture({ ...entry, outName: `out-${index}` });
    stopForeign();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const wrote = existsSync(run.outDir);
    const clean = portListeners().length === 0;
    const matched = entry.pass ? entry.pass(run) : (entry.fail instanceof RegExp ? entry.fail.test(run.output) : entry.fail!(run));
    const exitOk = entry.pass ? true : run.code !== 0;
    const message = run.output.split('\n').find((line) => /^(Error|.*Error): |^port guard ok/.test(line)) ?? run.output.trim().split('\n').at(-1)!;
    report(entry.name, Boolean(matched) && exitOk && !wrote && clean, `exit ${run.code}, output dir ${wrote ? 'WRITTEN' : 'not created'}, port ${clean ? 'free' : 'STILL HELD'}; ${message.trim().slice(0, 240)}`);
  }
}

async function fontProbes() {
  // Dashboard: a real `vp dev` on a copy without the JetBrains Mono import. The fake vp is not used.
  const source = path.join(root, 'meta-frames-dashboard');
  const copy = path.join(workDir, 'dashboard-copy');
  cpSync(source, copy, { recursive: true, filter: (file) => !/\/(node_modules|\.git|dist)(\/|$)/.test(file) });
  symlinkSync(path.join(source, 'node_modules'), path.join(copy, 'node_modules'));
  const css = path.join(copy, 'src/styles/index.css');
  const text = readFileSync(css, 'utf8');
  const removed = text.replace('@import "@fontsource-variable/jetbrains-mono";\n', '');
  if (removed === text) throw new Error('the JetBrains Mono import line was not found in the copy');
  writeFileSync(css, removed);
  const outDir = path.join(workDir, 'out-font');
  const result = spawnSync(process.execPath, [capture, outDir], { env: { ...process.env, DASHBOARD_DIR: copy }, encoding: 'utf8', timeout: 240000 });
  const output = `${result.stdout}${result.stderr}`;
  report('dashboard capture without the JetBrains Mono import fails', result.status !== 0 && /no @font-face for JetBrains Mono Variable/.test(output) && !existsSync(outDir),
    `exit ${result.status}, output dir ${existsSync(outDir) ? 'WRITTEN' : 'not created'}; ${(output.split('\n').find((line) => /no @font-face/.test(line)) ?? output.trim().split('\n').at(-1)!).trim().slice(0, 200)}`);

  // Dashboard: dark-mode font-sans falls back to ui-monospace. A copy with copied dependencies, as a linked
  // node_modules makes Chromium fall back to a system font in every mode.
  const darkCopy = path.join(workDir, 'dashboard-dark-copy');
  mkdirSync(darkCopy);
  spawnSync('rsync', ['-a', '--exclude', '/.git', '--exclude', '/dist', `${source}/`, `${darkCopy}/`], { stdio: 'inherit' }); // cpSync breaks pnpm symlinks
  const darkCss = path.join(darkCopy, 'src/styles/index.css');
  writeFileSync(darkCss, `${readFileSync(darkCss, 'utf8')}\n.dark .font-sans { font-family: ui-monospace, monospace; }\n`);
  const darkOut = path.join(workDir, 'out-dark-fallback');
  const darkResult = spawnSync(process.execPath, [capture, darkOut], { env: { ...process.env, DASHBOARD_DIR: darkCopy }, encoding: 'utf8', timeout: 240000 });
  const darkOutput = `${darkResult.stdout}${darkResult.stderr}`;
  report('dashboard capture with a dark-mode font-sans fallback fails', darkResult.status !== 0 && /dark mode, \d+px root: --font-sans sample does not render with the loaded Geist Mono Variable face/.test(darkOutput) && !existsSync(darkOut),
    `exit ${darkResult.status}, output dir ${existsSync(darkOut) ? 'WRITTEN' : 'not created'}; ${(darkOutput.split('\n').find((line) => /dark mode/.test(line)) ?? darkOutput.trim().split('\n').at(-1)!).trim().slice(0, 220)}`);

  // App: an asset folder with one font missing, then one font that is not a font file.
  const fontDir = (name: string, build: (dir: string) => void): string => {
    const dir = path.join(workDir, name);
    mkdirSync(path.join(dir, 'assets/fonts'), { recursive: true });
    for (const file of readdirSync(path.join(root, 'meta-frames-app/assets/fonts'))) cpSync(path.join(root, 'meta-frames-app/assets/fonts', file), path.join(dir, 'assets/fonts', file));
    build(path.join(dir, 'assets/fonts'));
    return dir;
  };
  const sdk = process.env.FLUTTER_ROOT ?? path.resolve(spawnSync('which', ['flutter'], { encoding: 'utf8' }).stdout.trim(), '../..');
  for (const [name, build, pattern] of ([
    ['app capture with one font asset missing fails', (dir: string) => rmSync(path.join(dir, 'JetBrainsMono.ttf')), /PathNotFoundException|No such file|Cannot open file/],
    ['app capture with one font asset not a font fails', (dir: string) => writeFileSync(path.join(dir, 'JetBrainsMono.ttf'), 'not a font'), /renders like an unregistered family|JetBrainsMono|font/i],
  ] as [string, (dir: string) => void, RegExp][])) {
    const appDir = fontDir(`app-${name.split(' ').slice(-3).join('-')}`, build);
    const outAppDir = path.join(workDir, `out-app-${name.length}`);
    const appRoot = path.join(root, 'meta-frames-app');
    const result = spawnSync('flutter', ['test', `--packages=${path.join(appRoot, '.dart_tool/package_config.json')}`, appTest], {
      cwd: appRoot, env: { ...process.env, FLUTTER_ROOT: sdk, CAPTURE_OUT: outAppDir, APP_DIR: appDir }, encoding: 'utf8', timeout: 300000,
    });
    const output = `${result.stdout}${result.stderr}`;
    const wrote = existsSync(outAppDir);
    report(name, result.status !== 0 && pattern.test(output) && !wrote, `exit ${result.status}, output dir ${wrote ? 'WRITTEN' : 'not created'}; ${(output.split('\n').find((line) => pattern.test(line)) ?? output.trim().split('\n').at(-1)!).trim().slice(0, 200)}`);
  }
}

try {
  const which = process.argv[2] ?? 'all';
  if (which === 'listener' || which === 'all') await listenerProbes();
  if (which === 'fonts' || which === 'all') await fontProbes();
} finally {
  stopForeign();
  rmSync(workDir, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
