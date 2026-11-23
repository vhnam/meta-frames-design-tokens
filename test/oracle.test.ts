import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import {
  canonical as oracleCanonical,
  COLOR_SCHEME,
  DASHBOARD_PUBLIC,
  expectedCss as oracleExpectedCss,
  expectedDart as oracleExpectedDart,
  FONT_ROLES,
  INVERSE_PRIMARY,
  NAV,
  parseHex,
  readSource,
  semanticAndComponentPaths,
  cssNameOf,
  dartNameOf,
} from '../src/oracle.ts';

// A parsed or captured JSON document that a test reads at arbitrary keys.
type Tree = any;
// The oracle's structured results are read at arbitrary keys in these tests.
const canonical = oracleCanonical as (leaves: Tree, path: Tree, mode: Tree) => Tree;
const expectedCss = oracleExpectedCss as (leaves: Tree) => Tree;
const expectedDart = oracleExpectedDart as (leaves: Tree) => Tree;
// A map whose missing key is a test failure at the property read: get() is typed as present.
type Present<Value> = { get(key: string): Value } & Map<string, Value>;

const here = import.meta.dirname;
const sourceText = readFileSync(join(here, '../tokens/tokens.json'), 'utf8');
const cssPath = join(here, '../../meta-frames-dashboard/src/styles/design-tokens.generated.css');
const dartPath = join(here, '../../meta-frames-app/lib/ui/core/design_tokens.g.dart');

// ---- parsers for the generated files ----

function parseCss(text: string) {
  const blocks: Record<string, Present<string>> = {};
  const duplicates: string[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector, body] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = selector!.trim();
    const properties = new Map<string, string>() as Present<string>;
    for (const declaration of body!.split(';')) {
      const trimmed = declaration.trim();
      if (!trimmed) continue;
      const split = trimmed.indexOf(': ');
      const name = trimmed.slice(0, split);
      if (properties.has(name)) duplicates.push(`${key} ${name}`);
      properties.set(name, trimmed.slice(split + 2));
    }
    blocks[key] = properties;
  }
  return { blocks, duplicates };
}

function parseDart(text: string) {
  const classes: Record<string, Present<{ type: string; expression: string }>> = {};
  const clean = text.replace(/^\s*\/\/.*$/gm, '');
  for (const [, name, body] of clean.matchAll(/abstract final class (\w+) \{([\s\S]*?)\n\}/g)) {
    const fields = new Map<string, { type: string; expression: string }>() as Present<{
      type: string;
      expression: string;
    }>;
    for (const statement of body!.replace(/\s+/g, ' ').split(';')) {
      const match = /^\s*static const (\w+) (\w+) = (.+)$/.exec(statement);
      // dart format may wrap a call over lines and add a trailing comma: compare the call itself
      if (match)
        fields.set(match[2]!, {
          type: match[1]!,
          expression: match[3]!
            .trim()
            .replace(/\(\s+/g, '(')
            .replace(/,?\s*\)$/, ')'),
        });
    }
    classes[name!] = fields;
  }
  return classes;
}

function dartCanon(type: string, expression: string) {
  const number = (text: string) => (/^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN);
  switch (type) {
    case 'Color': {
      const match = /^Color\(0x([0-9A-F]{8})\)$/.exec(expression);
      if (!match) return null;
      const byte = (index: number) => parseInt(match[1].slice(index * 2, index * 2 + 2), 16);
      return { a: byte(0), r: byte(1), g: byte(2), b: byte(3) };
    }
    case 'double':
      return number(expression);
    case 'FontWeight':
      return Number(/^FontWeight\.w(\d00)$/.exec(expression)?.[1]);
    case 'Duration':
      return { milliseconds: /^Duration\(milliseconds: (\d+)\)$/.exec(expression)?.[1] };
    case 'Cubic':
      return /^Cubic\((.+)\)$/.exec(expression)?.[1].split(', ').map(number);
    case 'String':
      return /^'([A-Za-z0-9_]+)'$/.exec(expression)?.[1];
    default:
      return null;
  }
}

// ---- comparison ----

const same = isDeepStrictEqual;

function cssMatches(actual: Tree, expected: Tree) {
  if (actual === undefined) return false;
  if (expected.kind === 'var') return actual === `var(${expected.name})`;
  if (expected.kind === 'stack') return actual === expected.stack.join(', ');
  const { type, canon } = expected;
  switch (type) {
    case 'color':
      return /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(actual) && same(parseHex(actual), canon);
    case 'dimension': {
      const match = /^(\d[\d.e-]*)(px|rem)$/.exec(actual);
      return Boolean(match) && match![2] === canon.cssUnit && Number(match![1]) === canon.cssNumber;
    }
    case 'fontWeight':
    case 'number':
      return /^[\d.]+$/.test(actual) && Number(actual) === canon;
    case 'duration':
      return /^(\d+)ms$/.exec(actual)?.[1] === canon.milliseconds;
    case 'cubicBezier': {
      const numbers = /^cubic-bezier\((.+)\)$/.exec(actual)?.[1].split(', ').map(Number);
      return same(numbers, canon);
    }
    default:
      return false;
  }
}

/** Compares generated texts with the oracle. Returns a list of mismatch descriptions. */
export function compareOutputs(source: Tree, cssText: string, dartText: string) {
  const mismatches: string[] = [];
  const note = (where: string, expected: Tree, actual: Tree) =>
    mismatches.push(
      `${where}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
  const { leaves } = readSource(source);
  const css = parseCss(cssText);
  for (const duplicate of css.duplicates) note('css duplicate property', 'once', duplicate);
  const wantedCss = expectedCss(leaves);
  const selectors = { theme: '@theme inline', root: ':root', dark: '.dark' };
  for (const [name, selector] of Object.entries(selectors)) {
    const actual = css.blocks[selector];
    if (!actual) {
      note(`css ${selector}`, 'a block', 'missing');
      continue;
    }
    for (const [property, expected] of (wantedCss as Tree)[name]) {
      if (!cssMatches(actual.get(property), expected))
        note(`css ${selector} ${property}`, expected, actual.get(property));
    }
    for (const property of actual.keys()) {
      if (!(wantedCss as Tree)[name].has(property))
        note(`css ${selector} ${property}`, 'no such property', actual.get(property));
    }
  }
  const dart = parseDart(dartText);
  const wantedDart = expectedDart(leaves);
  const classes = {
    DesignTokens: wantedDart.shared,
    DesignTokensLight: wantedDart.light,
    DesignTokensDark: wantedDart.dark,
  };
  for (const [className, wanted] of Object.entries(classes)) {
    const actual = dart[className!];
    if (!actual) {
      note(`dart ${className}`, 'a class', 'missing');
      continue;
    }
    for (const [field, expected] of wanted) {
      const found = actual.get(field);
      const canon =
        found && found.type === expected.type ? dartCanon(found.type, found.expression) : undefined;
      if (!same(canon, expected.canon)) note(`dart ${className}.${field}`, expected, found);
    }
    const allowed = new Set([...wanted.keys(), 'colorScheme']);
    for (const field of actual.keys())
      if (!allowed.has(field))
        note(`dart ${className}.${field}`, 'no such field', actual.get(field));
  }
  for (const mode of ['light', 'dark']) {
    const className = mode === 'light' ? 'DesignTokensLight' : 'DesignTokensDark';
    const scheme = dart[className]?.get('colorScheme');
    const wanted = wantedDart.schemes[mode];
    const body = scheme && /^ColorScheme\((.*)\)$/.exec(scheme.expression)?.[1];
    const actual = new Map(
      (body ?? '')
        .split(',')
        .map((part: Tree) => part.trim())
        .filter(Boolean)
        .map((part: Tree) => part.split(/:\s*/)),
    );
    if (!scheme || scheme.type !== 'ColorScheme' || !body)
      note(`dart ${className}.colorScheme`, 'a ColorScheme', scheme);
    for (const [field, expected] of wanted)
      if (actual.get(field) !== expected)
        note(`dart ${className}.colorScheme.${field}`, expected, actual.get(field));
    for (const field of actual.keys())
      if (!wanted.has(field))
        note(`dart ${className}.colorScheme.${field}`, 'no such argument', actual.get(field));
  }
  return mismatches;
}

const cssText = () => readFileSync(cssPath, 'utf8');
const dartText = () => readFileSync(dartPath, 'utf8');

// ---- tests ----

test('the generated files agree with the oracle: 0 mismatches', () => {
  assert.deepEqual(compareOutputs(sourceText, cssText(), dartText()), []);
});

test('the oracle covers 184 semantic and component leaves and the spec tables', () => {
  const { leaves } = readSource(sourceText);
  assert.equal(semanticAndComponentPaths(leaves).length, 184);
  assert.equal(DASHBOARD_PUBLIC.length, 32);
  assert.equal(COLOR_SCHEME.length + 1, 31);
  const css = expectedCss(leaves);
  assert.equal(css.root.size, 184 + 32 + 1);
  const colours = semanticAndComponentPaths(leaves).filter(
    (path) => leaves.get(path)!.type === 'color',
  ).length;
  assert.equal(css.dark.size, colours + 32);
  assert.equal(css.theme.size, 3 + 1 + 7 * 3);
});

test('selected values: nav indicator, scrim alpha order, chart order, font fallback order', () => {
  const { leaves } = readSource(sourceText);
  assert.deepEqual(canonical(leaves, 'component.nav.indicator', 'light'), parseHex('#047857'));
  assert.deepEqual(canonical(leaves, 'component.nav.indicator', 'dark'), parseHex('#34D399'));
  const css = parseCss(cssText());
  const dart = parseDart(dartText());
  assert.equal(css.blocks[':root'].get('--mf-semantic-color-bg-scrim'), '#0f172a99');
  assert.equal(dart.DesignTokensLight.get('semanticColorBgScrim').expression, 'Color(0x990F172A)');
  const chartSources = [1, 2, 3, 4, 5].map((step) => css.blocks[':root'].get(`--chart-${step}`));
  assert.deepEqual(
    chartSources,
    [1, 2, 3, 4, 5].map((step) => `var(--mf-semantic-color-chart-${step})`),
  );
  assert.equal(css.blocks['@theme inline'].get('--font-sans'), FONT_ROLES.body.stack.join(', '));
  assert.equal(dart.DesignTokens.get('semanticTextLabelFontFamily').expression, "'JetBrainsMono'");
  assert.equal(
    css.blocks[':root'].get('--mf-semantic-text-label-font-family'),
    FONT_ROLES.body.stack.join(', '),
  );
});

test('the nav bindings and inversePrimary point at the specified opposite and same-mode values', () => {
  const { leaves } = readSource(sourceText);
  const dart = parseDart(dartText());
  for (const [binding, path] of Object.entries(NAV)) {
    for (const [mode, className] of [
      ['light', 'DesignTokensLight'],
      ['dark', 'DesignTokensDark'],
    ]) {
      const field = dart[className].get(dartNameOf(path));
      assert.ok(field, `${binding} ${mode}`);
      assert.deepEqual(
        dartCanon('Color', field.expression),
        canonical(leaves, path, mode),
        `${binding} ${mode}`,
      );
    }
  }
  assert.match(
    dart.DesignTokensLight.get('colorScheme').expression,
    new RegExp(`inversePrimary: DesignTokensDark\\.${dartNameOf(INVERSE_PRIMARY)}`),
  );
  assert.match(
    dart.DesignTokensDark.get('colorScheme').expression,
    new RegExp(`inversePrimary: DesignTokensLight\\.${dartNameOf(INVERSE_PRIMARY)}`),
  );
  assert.equal(cssNameOf('component.nav.indicator'), '--mf-component-nav-indicator');
});

test('the oracle detects a changed colour, a swapped alpha order and a wrong font stack', () => {
  const css = cssText();
  const dart = dartText();
  const detects = (name: string, changedCss: string, changedDart: string) => {
    const found = compareOutputs(sourceText, changedCss, changedDart);
    assert.ok(found.length > 0, name);
  };
  detects(
    'one hex digit',
    css.replace('--mf-component-nav-indicator: #047857;', '--mf-component-nav-indicator: #047858;'),
    dart,
  );
  detects('css alpha first', css.replace('#0f172a99', '#990f172a'), dart);
  detects('dart alpha last', css, dart.replace('0x990F172A', '0x0F172A99'));
  detects(
    'font stack order',
    css.replace(
      '"Space Grotesk Variable", ui-sans-serif, sans-serif',
      'ui-sans-serif, "Space Grotesk Variable", sans-serif',
    ),
    dart,
  );
  detects(
    'dark value in light',
    css.replace(/(\.dark \{[\s\S]*?--mf-component-nav-indicator: )#34d399/, '$1#047857'),
    dart,
  );
  detects(
    'scheme brightness',
    css,
    dart.replace('brightness: Brightness.dark', 'brightness: Brightness.light'),
  );
  detects(
    'inverse primary same mode',
    css,
    dart.replace(/inversePrimary: DesignTokensDark/, 'inversePrimary: DesignTokensLight'),
  );
  detects('duplicate property', css.replace(':root {\n', ':root {\n  --background: red;\n'), dart);
  detects(
    'extra dart field',
    css,
    dart.replace(
      'abstract final class DesignTokens {\n',
      'abstract final class DesignTokens {\n  static const double extra = 1.0;\n',
    ),
  );
});

test('the oracle detects wrong bindings even when the light colours match', () => {
  const { leaves } = readSource(sourceText);
  assert.deepEqual(
    canonical(leaves, 'semantic.color.bg.surface', 'light'),
    canonical(leaves, 'semantic.color.bg.surface-raised', 'light'),
  );
  const wrongCss = cssText().replace(
    '--card: var(--mf-semantic-color-bg-surface);',
    '--card: var(--mf-semantic-color-bg-surface-raised);',
  );
  const wrongDart = dartText().replace(
    'surfaceContainerLow: semanticColorBgSurface,',
    'surfaceContainerLow: semanticColorBgSurfaceRaised,',
  );
  const mismatches = compareOutputs(sourceText, wrongCss, wrongDart);
  assert.ok(mismatches.some((entry) => entry.startsWith('css :root --card:')));
  assert.ok(
    mismatches.some((entry) =>
      entry.startsWith('dart DesignTokensLight.colorScheme.surfaceContainerLow:'),
    ),
  );
});

test('the nav bindings match the independent nav table', () => {
  const bindings = JSON.parse(readFileSync(join(here, '../tokens/bindings.json'), 'utf8'));
  assert.deepEqual(bindings.nav, {
    bar: NAV.bar,
    divider: NAV.divider,
    'indicator-fill': NAV.indicatorFill,
    'selected-icon': NAV.selectedIcon,
    'selected-label': NAV.selectedLabel,
    'idle-icon': NAV.idleIcon,
    'idle-label': NAV.idleLabel,
    'active-row-bg': NAV.activeRowBackground,
  });
});

// ---- Slice 3 fix round 1: readSource and dimension validation ----

const changedSource = (change: (tree: Tree) => void) => {
  const tree = JSON.parse(sourceText);
  change(tree);
  return JSON.stringify(tree);
};

test('readSource rejects a root that is not an object', () => {
  assert.throws(() => readSource('42'), { message: 'oracle: tokens.json root must be an object' });
  assert.throws(() => readSource('[]'), { message: 'oracle: tokens.json root must be an object' });
  assert.throws(() => readSource('null'), {
    message: 'oracle: tokens.json root must be an object',
  });
});

test('readSource names a child that is not an object', () => {
  const text = changedSource((tree: Tree) => {
    tree.primitive.radius.sm = 7;
  });
  assert.throws(() => readSource(text), {
    message: 'oracle: primitive.radius.sm must be an object',
  });
});

for (const value of [6, '6em', '-6px', 'px']) {
  test(`a dimension leaf with ${JSON.stringify(value)} is named, not converted`, () => {
    const text = changedSource((tree: Tree) => {
      tree.primitive.radius.md.$value = value;
    });
    const { leaves } = readSource(text);
    assert.throws(() => canonical(leaves, 'primitive.radius.md', 'light'), {
      message: `oracle: primitive.radius.md: dimension must be a px string, found ${JSON.stringify(value)}`,
    });
  });
}

test('a dimension leaf too large to be finite is named, not converted', () => {
  const value = `1${'0'.repeat(400)}px`;
  const text = changedSource((tree: Tree) => {
    tree.primitive.radius.md.$value = value;
  });
  const { leaves } = readSource(text);
  assert.throws(() => canonical(leaves, 'primitive.radius.md', 'light'), {
    message: `oracle: primitive.radius.md: dimension must be a px string, found ${JSON.stringify(value)}`,
  });
});
