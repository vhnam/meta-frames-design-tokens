// Compares capture JSON with the independent expectations in oracle.ts. Reads files, writes nothing.
// Run: node compare.ts <dashboard-resolved.json | app-resolved.json> [...]
// Exit 0: no mismatch. Exit 1: at least one mismatch (printed with property, mode, expected, actual).
// Exit 2: unreadable input or a bad command line.
// Alpha colours are compared as painted over white and over black (the dashboard values come from a
// canvas, which rounds each channel, so channels may differ by 1 and focus-ring mixes by 2).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_FAMILY, canonical as oracleCanonical, COLOR_SCHEME, cssNameOf, DASHBOARD_PUBLIC, expectedApp as oracleExpectedApp,
  DASHBOARD_RADII, expectedCss as oracleExpectedCss, FONT_ROLES, INVERSE_PRIMARY, RADIUS_PATH, readSource, semanticAndComponentPaths, TEXT_STEPS,
} from '../oracle.ts';

// Parsed capture JSON (the file boundary). Every read below goes through ?. and a run-time check, so a
// missing field is a reported mismatch, not a crash.
type Tree = any;
type Mismatch = { scope: string; mode: string; property: string; expected: string; actual: string };
type Report = {
  scope: string;
  checks: number;
  mismatches: Mismatch[];
  expect(mode: string, property: string, passed: boolean, expected: unknown, actual: unknown): void;
};
// The oracle's structured values are read at arbitrary keys here, as the capture is.
const canonical = oracleCanonical as (leaves: Tree, path: Tree, mode: string) => Tree;
const expectedCss = oracleExpectedCss as (leaves: Tree) => Tree;
const expectedApp = oracleExpectedApp as (leaves: Tree) => Tree;

const here = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['light', 'dark'];
const ROOT_SIZES = ['16px', '20px']; // required in both modes, whatever the capture lists
// CSS outline-style keywords that paint. none, hidden, empty, null and non-strings fail.
const PAINTED_OUTLINE_STYLES = new Set(['auto', 'solid', 'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset']);
const show = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));
const close = (left: unknown, right: unknown, tolerance = 1e-6): boolean => typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) <= tolerance;

/** Collects checks. `expect` records one comparison; a mismatch keeps its property, mode, expected and actual. */
function createReport(scope: string): Report {
  const report = { scope, checks: 0, mismatches: [] } as unknown as Report;
  report.expect = (mode, property, passed, expected, actual) => {
    report.checks += 1;
    if (!passed) report.mismatches.push({ scope, mode, property, expected: show(expected), actual: show(actual) });
  };
  return report;
}

const paint = ({ r, g, b }: Tree, alpha: number, backdrop: number): number[] => [r, g, b].map((channel) => Math.round(channel * alpha + backdrop * (1 - alpha)));
const bytesOfArgb = (argb: number): Tree => ({ r: (argb >>> 16) & 255, g: (argb >>> 8) & 255, b: argb & 255, a: argb >>> 24 });
const hex = ({ r, g, b, a }: Tree): string => `#${[r, g, b, a].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
const withinBytes = (left: Tree, right: Tree, tolerance: number): boolean => Array.isArray(left) && left.length === right.length && left.every((byte, index) => Math.abs(byte - right[index]) <= tolerance);

/**
 * Compares an expected colour with a painted measurement { rgbaAlone, rgbaOverWhite, rgbaOverBlack }.
 * Opaque colours must match exactly. Alpha colours match on the alpha byte and on both composites.
 */
function expectPainted(report: Report, mode: string, property: string, expected: Tree, painted: Tree, tolerance = 1): void {
  const alpha = expected.a / 255;
  const wanted = {
    alone: [expected.r, expected.g, expected.b, expected.a],
    overWhite: [...paint(expected, alpha, 255), 255],
    overBlack: [...paint(expected, alpha, 0), 255],
  };
  const actual = painted ? { alone: painted.rgbaAlone, overWhite: painted.rgbaOverWhite, overBlack: painted.rgbaOverBlack } : null;
  const limit = expected.a === 255 ? 0 : tolerance;
  const passed = actual
    && (expected.a === 255 ? withinBytes(actual.alone, wanted.alone, 0) : Math.abs(actual.alone[3] - expected.a) <= tolerance)
    && withinBytes(actual.overWhite, wanted.overWhite, limit)
    && withinBytes(actual.overBlack, wanted.overBlack, limit);
  report.expect(mode, property, Boolean(passed), { color: hex(expected), ...wanted }, actual ?? 'missing');
}

const oppositeOf = (mode: string): string => (mode === 'light' ? 'dark' : 'light');

/** Parses `<number><unit>` strings. */
const measure = (text: unknown): { number: number; unit: string } | null => {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem)?$/.exec(String(text ?? '').trim());
  return match ? { number: Number(match[1]), unit: match[2] ?? '' } : null;
};

function expectDeclared(report: Report, mode: string, property: string, type: string, canon: Tree, declared: Tree): void {
  let wanted: string;
  let passed: unknown;
  if (type === 'dimension') {
    const actual = measure(declared);
    wanted = `${canon.cssNumber}${canon.cssUnit}`;
    passed = actual && actual.unit === canon.cssUnit && close(actual.number, canon.cssNumber);
  } else if (type === 'fontWeight' || type === 'number') {
    wanted = String(canon);
    passed = declared !== '' && close(Number(declared), Number(canon));
  } else if (type === 'duration') {
    wanted = `${canon.milliseconds}ms`;
    passed = declared === wanted;
  } else if (type === 'cubicBezier') {
    wanted = `cubic-bezier(${canon.join(', ')})`;
    passed = String(declared).replaceAll(' ', '') === wanted.replaceAll(' ', '');
  } else {
    return; // authored font-family leaves are bound to roles and compared as stacks
  }
  report.expect(mode, property, Boolean(passed), wanted, declared);
}

/** Dashboard capture (schema 2) against the oracle. */
export function compareDashboard(data: Tree, leaves: Tree): Report {
  const report = createReport('dashboard');
  const expected = expectedCss(leaves);
  const publicPath = new Map<string, string>(DASHBOARD_PUBLIC);
  const tokenPath = new Map(semanticAndComponentPaths(leaves).map((tokenName) => [cssNameOf(tokenName), tokenName]));
  const colorOf = (tokenName: Tree, mode: string): Tree => canonical(leaves, tokenName, mode);
  for (const mode of MODES) {
    const view = data.modes?.[mode];
    if (!view) {
      report.expect(mode, 'mode', false, 'captured', 'missing');
      continue;
    }
    for (const [name, wanted] of expected.root) {
      const entry = view.properties?.[name];
      if (wanted.kind === 'var' && name === '--radius') {
        expectDeclared(report, mode, name, 'dimension', { cssNumber: canonical(leaves, RADIUS_PATH, mode).px, cssUnit: 'px' }, entry?.declared);
      } else if (wanted.kind === 'var') {
        expectPainted(report, mode, name, colorOf(publicPath.get(name), mode), entry);
      } else if (wanted.kind === 'stack') {
        report.expect(mode, name, entry?.declared === wanted.stack.join(', '), wanted.stack.join(', '), entry?.declared);
      } else if (wanted.type === 'color') {
        expectPainted(report, mode, name, colorOf(tokenPath.get(name), mode), entry);
      } else {
        expectDeclared(report, mode, name, wanted.type, wanted.canon, entry?.declared);
      }
    }
    for (const [name, tokenName] of publicPath) expectPainted(report, mode, `swatch ${name}`, colorOf(tokenName, mode), view.swatches?.[name]);

    const sidebar = [
      ['container', 'backgroundColor', '--sidebar'], ['container', 'color', '--sidebar-foreground'],
      ['active', 'backgroundColor', '--sidebar-accent'], ['active', 'color', '--sidebar-accent-foreground'],
      ['idle', 'color', '--sidebar-foreground'],
      ['primary', 'backgroundColor', '--sidebar-primary'], ['primary', 'color', '--sidebar-primary-foreground'],
    ];
    for (const [state, field, name] of sidebar) {
      expectPainted(report, mode, `sidebar ${state} ${field}`, colorOf(publicPath.get(name), mode), view.sidebar?.[state]?.[field]);
    }

    // The focus ring is `--ring` at the 50% utility opacity, applied once.
    const ring = colorOf(publicPath.get('--ring'), mode);
    const half = { ...ring, a: ring.a * 0.5 };
    const focus = view.focusRing;
    report.expect(mode, 'focus ring :focus-visible', focus?.matchesFocusVisible === true, true, focus?.matchesFocusVisible);
    // The outline must be able to paint: a width above 0 and a style other than none, hidden or empty.
    // A record without either field is a mismatch. The width is not compared with component.focus-ring.width:
    // the dashboard keeps its `outline-ring/50` base rule, which sets colour only.
    const outlineWidth = focus?.outlineWidth === undefined ? null : measure(focus.outlineWidth)?.number;
    report.expect(mode, 'focus ring outline width', outlineWidth! > 0, 'above 0', focus?.outlineWidth ?? 'missing');
    report.expect(mode, 'focus ring outline style', typeof focus?.outlineStyle === 'string' && PAINTED_OUTLINE_STYLES.has(focus.outlineStyle), 'not none or hidden', focus?.outlineStyle ?? 'missing');
    expectPainted(report, mode, 'focus ring outline', half, focus && { rgbaAlone: [ring.r, ring.g, ring.b, Math.round(half.a)], rgbaOverWhite: focus.rgbaOverWhite, rgbaOverBlack: focus.rgbaOverBlack }, 2);

    report.expect(mode, 'bg-dots size', view.dots?.backgroundSize === '16px 16px', '16px 16px', view.dots?.backgroundSize);
    report.expect(mode, 'bg-dots colour', Boolean(view.dots?.dotPainted) && String(view.dots?.backgroundImage).includes(view.dots.dotPainted), `gradient contains ${view.dots?.dotPainted}`, view.dots?.backgroundImage);

    for (const [role, { stack, property }] of Object.entries(FONT_ROLES)) {
      report.expect(mode, `${property} computed`, view.fonts?.[property]?.computedFontFamily === stack.join(', '), stack.join(', '), view.fonts?.[property]?.computedFontFamily);
      report.expect(mode, `${role} sample face`, data.faces?.probes?.[role]?.usedFonts?.length > 0 && data.faces.probes[role].usedFonts.every((font: Tree) => font.isCustomFont), 'custom face', data.faces?.probes?.[role]?.usedFonts);
    }
    report.expect(mode, 'audit ID sample', view.audit?.fontFamily === FONT_ROLES.mono.stack.join(', ') && view.audit.usedFonts?.length > 0 && view.audit.usedFonts.every((font: Tree) => font.isCustomFont && font.familyName.startsWith('JetBrains Mono')), 'JetBrains Mono face', view.audit);

    for (const size of ROOT_SIZES) {
      const root = Number.parseFloat(size);
      const sized = view.sizes?.[size];
      report.expect(mode, `root size ${size} record`, Boolean(sized?.text), 'text measurements', sized ? Object.keys(sized) : 'missing');
      for (const [step] of TEXT_STEPS) {
        const fontSize = expected.theme.get(`--text-${step}`).canon.cssNumber * root;
        const lineHeight = expected.theme.get(`--text-${step}--line-height`).canon * fontSize;
        const weight = expected.theme.get(`--text-${step}--font-weight`).canon;
        const actual = sized?.text?.[step];
        report.expect(mode, `text-${step} font-size @${size}`, close(measure(actual?.fontSize)?.number, fontSize, 0.01), `${fontSize}px`, actual?.fontSize);
        report.expect(mode, `text-${step} line-height @${size}`, close(measure(actual?.lineHeight)?.number, lineHeight, 0.01), `${lineHeight}px`, actual?.lineHeight);
        report.expect(mode, `text-${step} font-weight @${size}`, close(Number(actual?.fontWeight), Number(weight)), String(weight), actual?.fontWeight);
      }
      const spacing = expected.theme.get('--spacing').canon.px;
      for (const [utility, actual] of Object.entries(sized?.spacing ?? {})) {
        const wanted = Number(utility.slice(2)) * spacing;
        report.expect(mode, `${utility} @${size}`, close(measure(actual)?.number, wanted, 0.01), `${wanted}px`, actual);
      }
      for (const [utility, tokenName] of Object.entries(DASHBOARD_RADII)) {
        const wanted = canonical(leaves, tokenName, mode).px;
        const actual = sized?.radii?.[utility];
        const measured = measure(actual);
        report.expect(mode, `${utility} @${size}`, measured?.unit === 'px' && close(measured.number, wanted, 0.01), `${wanted}px`, actual);
      }
    }
  }
  for (const [role, { stack }] of Object.entries(FONT_ROLES)) {
    const face = stack[0].replaceAll('"', '');
    report.expect('all', `${role} face loaded`, (data.faces?.loaded ?? []).some((entry: string) => entry.startsWith(`${face} `)), `${face} loaded`, data.faces?.loaded);
  }
  return report;
}

/** App capture (schema 2) against the oracle. */
export function compareApp(data: Tree, leaves: Tree): Report {
  const report = createReport('app');
  const wanted = expectedApp(leaves);
  const colorOf = (tokenName: Tree, mode: string): Tree => canonical(leaves, tokenName, mode);
  // Compares an argb capture with an expected colour: argb exact, then painted over white and black.
  const expectArgb = (mode: string, property: string, expected: Tree, actual: Tree): void => {
    const bytes = typeof actual?.argb === 'number' ? bytesOfArgb(actual.argb) : null;
    const same = bytes && ['r', 'g', 'b', 'a'].every((channel) => bytes[channel] === expected[channel]);
    report.expect(mode, property, Boolean(same), hex(expected), bytes ? hex(bytes) : 'missing');
    if (expected.a === 255 && same) return;
    const alpha = bytes ? (typeof actual.alphaExact === 'number' ? actual.alphaExact : bytes.a / 255) : 0;
    for (const [label, backdrop] of [['white', 255], ['black', 0]] as [string, number][]) {
      const expectedPaint = paint(expected, expected.a / 255, backdrop);
      const actualPaint = bytes ? paint(bytes, alpha, backdrop) : 'missing';
      report.expect(mode, `${property} over ${label}`, bytes && withinBytes(actualPaint, expectedPaint, 0), expectedPaint, actualPaint);
    }
  };
  for (const family of Object.values(APP_FAMILY)) {
    const widths = data.fonts?.[family];
    const recorded = typeof widths?.registeredWidth === 'number' && typeof widths?.fallbackWidth === 'number';
    report.expect('all', `${family} asset loaded`, recorded && widths.registeredWidth !== widths.fallbackWidth, 'one width record, registered width differs from fallback', widths ?? 'missing');
  }
  for (const mode of MODES) {
    const view = data[mode];
    if (!view) {
      report.expect(mode, 'mode', false, 'captured', 'missing');
      continue;
    }
    for (const [field, tokenName] of COLOR_SCHEME) {
      expectArgb(mode, `colorScheme.${field}`, colorOf(tokenName, mode), { argb: view.colorScheme?.[field] });
    }
    expectArgb(mode, 'colorScheme.inversePrimary', colorOf(INVERSE_PRIMARY, oppositeOf(mode)), { argb: view.colorScheme?.inversePrimary });
    const expected = wanted[mode];
    expectArgb(mode, 'card background', expected.card, view.surfaces?.card);
    expectArgb(mode, 'dialog background', expected.dialog, view.surfaces?.dialog);
    const nav = [
      ['bar', 'backgroundColor'], ['indicatorFill', 'indicatorColor'], ['selectedIcon', 'iconSelected'],
      ['selectedLabel', 'labelSelected'], ['idleIcon', 'iconUnselected'], ['idleLabel', 'labelUnselected'],
    ];
    for (const [name, field] of nav) expectArgb(mode, `nav ${name}`, expected.nav[name], view.nav?.[field]);
    expectArgb(mode, 'input focus border', expected.inputFocus.color, view.inputFocus?.color);
    report.expect(mode, 'input focus width', close(view.inputFocus?.width, expected.inputFocus.width), expected.inputFocus.width, view.inputFocus?.width);

    // Disabled text and icon: onSurface at the disabled opacity, applied once, checked before byte quantization.
    for (const field of ['textButtonForeground', 'textButtonIcon']) {
      const actual = view.disabled?.[field];
      const bytes = typeof actual?.argb === 'number' ? bytesOfArgb(actual.argb) : null;
      const base = expected.disabled.base;
      report.expect(mode, `disabled ${field} alpha`, close(actual?.alphaExact, expected.disabled.alpha), expected.disabled.alpha, actual?.alphaExact);
      report.expect(mode, `disabled ${field} colour`, Boolean(bytes) && bytes.r === base.r && bytes.g === base.g && bytes.b === base.b, hex({ ...base, a: 255 }).slice(0, 7), bytes ? hex(bytes).slice(0, 7) : 'missing');
      for (const [label, backdrop] of [['white', 255], ['black', 0]] as [string, number][]) {
        const expectedPaint = paint(base, expected.disabled.alpha, backdrop);
        const actualPaint = bytes && typeof actual.alphaExact === 'number' ? paint(bytes, actual.alphaExact, backdrop) : 'missing';
        report.expect(mode, `disabled ${field} over ${label}`, withinBytes(actualPaint, expectedPaint, 0), expectedPaint, actualPaint);
      }
    }

    for (const [slot, expectation] of wanted.text) {
      const actual = view.text?.[slot];
      for (const field of ['family', 'size', 'height', 'weight']) {
        const same = typeof expectation[field] === 'number' ? close(actual?.[field], expectation[field]) : actual?.[field] === expectation[field];
        report.expect(mode, `text.${slot}.${field}`, same, expectation[field], actual?.[field]);
      }
    }
    for (const [name, expectation] of wanted.sizes) {
      for (const [field, value] of Object.entries(expectation)) {
        const actual = view.sizes?.[name]?.[field];
        report.expect(mode, `sizes.${name}.${field}`, typeof value === 'number' ? close(actual, value) : actual === value, value, actual);
      }
    }
    for (const [name, radius] of wanted.radii) report.expect(mode, `radii.${name}`, close(view.radii?.[name], radius), radius, view.radii?.[name]);
    for (const kind of ['filled', 'outlined']) {
      const box = view.button?.[kind];
      const horizontal = wanted.button.paddingX;
      const vertical = wanted.button.paddingY;
      for (const [field, value] of [['paddingLeft', horizontal], ['paddingRight', horizontal], ['paddingTop', vertical], ['paddingBottom', vertical], ['minHeight', wanted.button.minHeight]]) {
        report.expect(mode, `button.${kind}.${field}`, close(box?.[field], value), value, box?.[field]);
      }
    }

    // Rendered samples: the style that reached the paragraph, at both text scales.
    const sampleSlot = { body: 'bodyMedium', data: 'labelMedium', heading: 'headlineMedium' };
    for (const [scale, samples] of Object.entries<Tree>(view.samples ?? {})) {
      for (const [name, slot] of Object.entries(sampleSlot)) {
        const expectation = wanted.text.get(slot);
        for (const field of ['family', 'weight', 'size']) {
          const same = typeof expectation[field] === 'number' ? close(samples[name]?.[field], expectation[field]) : samples[name]?.[field] === expectation[field];
          report.expect(mode, `sample ${name}.${field} @${scale}x`, same, expectation[field], samples[name]?.[field]);
        }
        const base = view.samples?.['1.0']?.[name];
        const height = samples[name]?.boxHeight;
        const scaled = Number(scale) * base?.boxHeight; // letter spacing does not scale, so only the height is checked
        // Pixel rounding at scale 1.0 moves the box by under one pixel, so the allowed error is one pixel per scale unit.
        const passed = Number.isFinite(scaled) && Number.isFinite(height) && Math.abs(height - scaled) <= Number(scale);
        report.expect(mode, `sample ${name} height ratio @${scale}x`, passed, `${scaled} ±${Number(scale)} px`, height ?? 'missing');
      }
    }
    report.expect(mode, 'text scales captured', ['1.0', '2.0'].every((scale) => view.samples?.[scale]), '1.0 and 2.0', Object.keys(view.samples ?? {}));
  }
  return report;
}

export function compareFile(file: string): Report {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const { leaves } = readSource(readFileSync(path.join(here, '../tokens.json'), 'utf8'));
  if (data.modes) return compareDashboard(data, leaves);
  if (data.light && data.dark) return compareApp(data, leaves);
  throw new Error(`${file}: neither a dashboard capture (modes) nor an app capture (light and dark)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node compare.ts <dashboard-resolved.json | app-resolved.json> [...]');
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    let report: Report;
    try {
      report = compareFile(file);
    } catch (error) {
      console.error(`${file}: ${(error as Error).message}`);
      process.exit(2);
    }
    for (const mismatch of report.mismatches) {
      console.log(`${mismatch.scope} ${mismatch.mode} ${mismatch.property}: expected ${mismatch.expected}, actual ${mismatch.actual}`);
    }
    console.log(`${file}: ${report.checks} checks, ${report.mismatches.length} mismatches`);
    total += report.mismatches.length;
  }
  process.exit(total ? 1 : 0);
}
