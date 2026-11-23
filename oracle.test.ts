import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
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
  APP_TEXT_SLOTS,
  expectedApp as oracleExpectedApp,
} from "./oracle.ts";
import { compareApp, compareDashboard } from "./v2/capture/compare.ts";

// A parsed or captured JSON document that a test reads at arbitrary keys.
type Tree = any;
// The oracle's structured results are read at arbitrary keys in these tests.
const canonical = oracleCanonical as (leaves: Tree, path: Tree, mode: Tree) => Tree;
const expectedCss = oracleExpectedCss as (leaves: Tree) => Tree;
const expectedDart = oracleExpectedDart as (leaves: Tree) => Tree;
const expectedApp = oracleExpectedApp as (leaves: Tree) => Tree;
// A map whose missing key is a test failure at the property read: get() is typed as present.
type Present<Value> = { get(key: string): Value } & Map<string, Value>;

const here = import.meta.dirname;
const sourceText = readFileSync(join(here, "v2/tokens.json"), "utf8");
const cssPath = join(here, "../meta-frames-dashboard/src/styles/design-tokens.generated.css");
const dartPath = join(here, "../meta-frames-app/lib/ui/core/design_tokens.g.dart");

// ---- parsers for the generated files ----

function parseCss(text: string) {
  const blocks: Record<string, Present<string>> = {};
  const duplicates: string[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = selector!.trim();
    const properties = new Map<string, string>() as Present<string>;
    for (const declaration of body!.split(";")) {
      const trimmed = declaration.trim();
      if (!trimmed) continue;
      const split = trimmed.indexOf(": ");
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
  const clean = text.replace(/^\s*\/\/.*$/gm, "");
  for (const [, name, body] of clean.matchAll(/abstract final class (\w+) \{([\s\S]*?)\n\}/g)) {
    const fields = new Map<string, { type: string; expression: string }>() as Present<{ type: string; expression: string }>;
    for (const statement of body!.replace(/\s+/g, " ").split(";")) {
      const match = /^\s*static const (\w+) (\w+) = (.+)$/.exec(statement);
      // dart format may wrap a call over lines and add a trailing comma: compare the call itself
      if (match) fields.set(match[2]!, { type: match[1]!, expression: match[3]!.trim().replace(/\(\s+/g, "(").replace(/,?\s*\)$/, ")") });
    }
    classes[name!] = fields;
  }
  return classes;
}

function dartCanon(type: string, expression: string) {
  const number = (text: string) => (/^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN);
  switch (type) {
    case "Color": {
      const match = /^Color\(0x([0-9A-F]{8})\)$/.exec(expression);
      if (!match) return null;
      const byte = (index: number) => parseInt(match[1].slice(index * 2, index * 2 + 2), 16);
      return { a: byte(0), r: byte(1), g: byte(2), b: byte(3) };
    }
    case "double":
      return number(expression);
    case "FontWeight":
      return Number(/^FontWeight\.w(\d00)$/.exec(expression)?.[1]);
    case "Duration":
      return { milliseconds: /^Duration\(milliseconds: (\d+)\)$/.exec(expression)?.[1] };
    case "Cubic":
      return /^Cubic\((.+)\)$/.exec(expression)?.[1].split(", ").map(number);
    case "String":
      return /^'([A-Za-z0-9_]+)'$/.exec(expression)?.[1];
    default:
      return null;
  }
}

// ---- comparison ----

const same = isDeepStrictEqual;

function cssMatches(actual: Tree, expected: Tree) {
  if (actual === undefined) return false;
  if (expected.kind === "var") return actual === `var(${expected.name})`;
  if (expected.kind === "stack") return actual === expected.stack.join(", ");
  const { type, canon } = expected;
  switch (type) {
    case "color":
      return /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(actual) && same(parseHex(actual), canon);
    case "dimension": {
      const match = /^(\d[\d.e-]*)(px|rem)$/.exec(actual);
      return Boolean(match) && match![2] === canon.cssUnit && Number(match![1]) === canon.cssNumber;
    }
    case "fontWeight":
    case "number":
      return /^[\d.]+$/.test(actual) && Number(actual) === canon;
    case "duration":
      return /^(\d+)ms$/.exec(actual)?.[1] === canon.milliseconds;
    case "cubicBezier": {
      const numbers = /^cubic-bezier\((.+)\)$/.exec(actual)?.[1].split(", ").map(Number);
      return same(numbers, canon);
    }
    default:
      return false;
  }
}

/** Compares generated texts with the oracle. Returns a list of mismatch descriptions. */
export function compareOutputs(source: Tree, cssText: string, dartText: string) {
  const mismatches: string[] = [];
  const note = (where: string, expected: Tree, actual: Tree) => mismatches.push(`${where}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
  const { leaves } = readSource(source);
  const css = parseCss(cssText);
  for (const duplicate of css.duplicates) note("css duplicate property", "once", duplicate);
  const wantedCss = expectedCss(leaves);
  const selectors = { theme: "@theme inline", root: ":root", dark: ".dark" };
  for (const [name, selector] of Object.entries(selectors)) {
    const actual = css.blocks[selector];
    if (!actual) {
      note(`css ${selector}`, "a block", "missing");
      continue;
    }
    for (const [property, expected] of (wantedCss as Tree)[name]) {
      if (!cssMatches(actual.get(property), expected)) note(`css ${selector} ${property}`, expected, actual.get(property));
    }
    for (const property of actual.keys()) {
      if (!(wantedCss as Tree)[name].has(property)) note(`css ${selector} ${property}`, "no such property", actual.get(property));
    }
  }
  const dart = parseDart(dartText);
  const wantedDart = expectedDart(leaves);
  const classes = { DesignTokens: wantedDart.shared, DesignTokensLight: wantedDart.light, DesignTokensDark: wantedDart.dark };
  for (const [className, wanted] of Object.entries(classes)) {
    const actual = dart[className!];
    if (!actual) {
      note(`dart ${className}`, "a class", "missing");
      continue;
    }
    for (const [field, expected] of wanted) {
      const found = actual.get(field);
      const canon = found && found.type === expected.type ? dartCanon(found.type, found.expression) : undefined;
      if (!same(canon, expected.canon)) note(`dart ${className}.${field}`, expected, found);
    }
    const allowed = new Set([...wanted.keys(), "colorScheme"]);
    for (const field of actual.keys()) if (!allowed.has(field)) note(`dart ${className}.${field}`, "no such field", actual.get(field));
  }
  for (const mode of ["light", "dark"]) {
    const className = mode === "light" ? "DesignTokensLight" : "DesignTokensDark";
    const scheme = dart[className]?.get("colorScheme");
    const wanted = wantedDart.schemes[mode];
    const body = scheme && /^ColorScheme\((.*)\)$/.exec(scheme.expression)?.[1];
    const actual = new Map((body ?? "").split(",").map((part: Tree) => part.trim()).filter(Boolean).map((part: Tree) => part.split(/:\s*/)));
    if (!scheme || scheme.type !== "ColorScheme" || !body) note(`dart ${className}.colorScheme`, "a ColorScheme", scheme);
    for (const [field, expected] of wanted) if (actual.get(field) !== expected) note(`dart ${className}.colorScheme.${field}`, expected, actual.get(field));
    for (const field of actual.keys()) if (!wanted.has(field)) note(`dart ${className}.colorScheme.${field}`, "no such argument", actual.get(field));
  }
  return mismatches;
}

const cssText = () => readFileSync(cssPath, "utf8");
const dartText = () => readFileSync(dartPath, "utf8");

// ---- tests ----

test("the generated files agree with the oracle: 0 mismatches", () => {
  assert.deepEqual(compareOutputs(sourceText, cssText(), dartText()), []);
});

test("the oracle covers 184 semantic and component leaves and the spec tables", () => {
  const { leaves } = readSource(sourceText);
  assert.equal(semanticAndComponentPaths(leaves).length, 184);
  assert.equal(DASHBOARD_PUBLIC.length, 32);
  assert.equal(COLOR_SCHEME.length + 1, 31);
  const css = expectedCss(leaves);
  assert.equal(css.root.size, 184 + 32 + 1);
  const colours = semanticAndComponentPaths(leaves).filter((path) => leaves.get(path)!.type === "color").length;
  assert.equal(css.dark.size, colours + 32);
  assert.equal(css.theme.size, 3 + 1 + 7 * 3);
});

test("selected values: nav indicator, scrim alpha order, chart order, font fallback order", () => {
  const { leaves } = readSource(sourceText);
  assert.deepEqual(canonical(leaves, "component.nav.indicator", "light"), parseHex("#047857"));
  assert.deepEqual(canonical(leaves, "component.nav.indicator", "dark"), parseHex("#34D399"));
  const css = parseCss(cssText());
  const dart = parseDart(dartText());
  assert.equal(css.blocks[":root"].get("--mf-semantic-color-bg-scrim"), "#0f172a99");
  assert.equal(dart.DesignTokensLight.get("semanticColorBgScrim").expression, "Color(0x990F172A)");
  const chartSources = [1, 2, 3, 4, 5].map((step) => css.blocks[":root"].get(`--chart-${step}`));
  assert.deepEqual(chartSources, [1, 2, 3, 4, 5].map((step) => `var(--mf-semantic-color-chart-${step})`));
  assert.equal(css.blocks["@theme inline"].get("--font-sans"), FONT_ROLES.body.stack.join(", "));
  assert.equal(dart.DesignTokens.get("semanticTextLabelFontFamily").expression, "'JetBrainsMono'");
  assert.equal(css.blocks[":root"].get("--mf-semantic-text-label-font-family"), FONT_ROLES.body.stack.join(", "));
});

test("the nav bindings and inversePrimary point at the specified opposite and same-mode values", () => {
  const { leaves } = readSource(sourceText);
  const dart = parseDart(dartText());
  for (const [binding, path] of Object.entries(NAV)) {
    for (const [mode, className] of [["light", "DesignTokensLight"], ["dark", "DesignTokensDark"]]) {
      const field = dart[className].get(dartNameOf(path));
      assert.ok(field, `${binding} ${mode}`);
      assert.deepEqual(dartCanon("Color", field.expression), canonical(leaves, path, mode), `${binding} ${mode}`);
    }
  }
  assert.match(dart.DesignTokensLight.get("colorScheme").expression, new RegExp(`inversePrimary: DesignTokensDark\\.${dartNameOf(INVERSE_PRIMARY)}`));
  assert.match(dart.DesignTokensDark.get("colorScheme").expression, new RegExp(`inversePrimary: DesignTokensLight\\.${dartNameOf(INVERSE_PRIMARY)}`));
  assert.equal(cssNameOf("component.nav.indicator"), "--mf-component-nav-indicator");
});

test("the oracle detects a changed colour, a swapped alpha order and a wrong font stack", () => {
  const css = cssText();
  const dart = dartText();
  const detects = (name: string, changedCss: string, changedDart: string) => {
    const found = compareOutputs(sourceText, changedCss, changedDart);
    assert.ok(found.length > 0, name);
  };
  detects("one hex digit", css.replace("--mf-component-nav-indicator: #047857;", "--mf-component-nav-indicator: #047858;"), dart);
  detects("css alpha first", css.replace("#0f172a99", "#990f172a"), dart);
  detects("dart alpha last", css, dart.replace("0x990F172A", "0x0F172A99"));
  detects("font stack order", css.replace('"Space Grotesk Variable", ui-sans-serif, sans-serif', 'ui-sans-serif, "Space Grotesk Variable", sans-serif'), dart);
  detects("dark value in light", css.replace(/(\.dark \{[\s\S]*?--mf-component-nav-indicator: )#34d399/, "$1#047857"), dart);
  detects("scheme brightness", css, dart.replace("brightness: Brightness.dark", "brightness: Brightness.light"));
  detects("inverse primary same mode", css, dart.replace(/inversePrimary: DesignTokensDark/, "inversePrimary: DesignTokensLight"));
  detects("duplicate property", css.replace(":root {\n", ":root {\n  --background: red;\n"), dart);
  detects("extra dart field", css, dart.replace("abstract final class DesignTokens {\n", "abstract final class DesignTokens {\n  static const double extra = 1.0;\n"));
});

test("the oracle detects wrong bindings even when the light colours match", () => {
  const { leaves } = readSource(sourceText);
  assert.deepEqual(
    canonical(leaves, "semantic.color.bg.surface", "light"),
    canonical(leaves, "semantic.color.bg.surface-raised", "light"),
  );
  const wrongCss = cssText().replace(
    "--card: var(--mf-semantic-color-bg-surface);",
    "--card: var(--mf-semantic-color-bg-surface-raised);",
  );
  const wrongDart = dartText().replace(
    "surfaceContainerLow: semanticColorBgSurface,",
    "surfaceContainerLow: semanticColorBgSurfaceRaised,",
  );
  const mismatches = compareOutputs(sourceText, wrongCss, wrongDart);
  assert.ok(mismatches.some((entry) => entry.startsWith("css :root --card:")));
  assert.ok(mismatches.some((entry) => entry.startsWith("dart DesignTokensLight.colorScheme.surfaceContainerLow:")));
});

test("the nav bindings match the independent nav table", () => {
  const bindings = JSON.parse(readFileSync(join(here, "bindings.json"), "utf8"));
  assert.deepEqual(bindings.nav, {
    bar: NAV.bar,
    divider: NAV.divider,
    "indicator-fill": NAV.indicatorFill,
    "selected-icon": NAV.selectedIcon,
    "selected-label": NAV.selectedLabel,
    "idle-icon": NAV.idleIcon,
    "idle-label": NAV.idleLabel,
    "active-row-bg": NAV.activeRowBackground,
  });
});

// ---- Slice 4: decision 7 app expectations and the capture comparison ----

const hexByte = (hexText: string) => parseHex(hexText);

test("decision 7 expectations hold the plan's literal values", () => {
  const { leaves } = readSource(sourceText);
  const wanted = expectedApp(leaves);
  const slot = (name: string) => wanted.text.get(name);
  assert.deepEqual(slot("displayLarge"), { family: "SpaceGrotesk", size: 30, height: 1.25, weight: 700 });
  assert.deepEqual(slot("headlineSmall"), { family: "SpaceGrotesk", size: 24, height: 1.25, weight: 600 });
  assert.deepEqual(slot("titleLarge"), { family: "SpaceGrotesk", size: 20, height: 1.375, weight: 600 });
  assert.deepEqual(slot("titleMedium"), { family: "SpaceGrotesk", size: 18, height: 1.375, weight: 600 });
  assert.deepEqual(slot("labelMedium"), { family: "JetBrainsMono", size: 14, height: 1.25, weight: 500 });
  // labelSmall takes the caption metrics but keeps the Mono family
  assert.deepEqual(slot("labelSmall"), { family: "JetBrainsMono", size: 12, height: 1.375, weight: 400 });
  assert.deepEqual(slot("bodyLarge"), { family: "GeistMono", size: 16, height: 1.5, weight: 400 });
  assert.deepEqual(slot("bodyMedium"), { family: "GeistMono", size: 14, height: 1.5, weight: 400 });
  assert.deepEqual(slot("bodySmall"), { family: "GeistMono", size: 12, height: 1.375, weight: 400 });
  assert.equal(wanted.text.size, 15);
  assert.equal(new Set(APP_TEXT_SLOTS.map(([name]) => name)).size, 15);
  assert.deepEqual(wanted.sizes.get("buttonText"), { size: 14, family: "JetBrainsMono", weight: 500 });
  assert.equal(wanted.sizes.get("navLabel").size, 12);
  assert.equal(wanted.radii.get("card"), 8);
  assert.equal(wanted.radii.get("navIndicator"), 6);
  assert.deepEqual(wanted.button, { paddingX: 16, paddingY: 0, minHeight: 48 });
  assert.deepEqual(wanted.light.inputFocus, { color: hexByte("#059669"), width: 2 });
  assert.deepEqual(wanted.dark.inputFocus.color, hexByte("#34d399"));
  assert.deepEqual(wanted.light.disabled, { base: hexByte("#0f172a"), alpha: 0.38 });
});

const argbOf = ({ r, g, b, a }: Tree) => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
const colorEntry = (color: Tree, alphaExact = color.a / 255) => ({ argb: argbOf(color), alphaExact });

/** An app capture that matches the oracle exactly. */
function perfectApp(leaves: Tree): Tree {
  const wanted = expectedApp(leaves);
  const box = { paddingLeft: 16, paddingRight: 16, paddingTop: 0, paddingBottom: 0, minHeight: 48 };
  const view = (mode: Tree) => {
    const expected = wanted[mode];
    const disabled = { argb: argbOf({ ...expected.disabled.base, a: Math.round(expected.disabled.alpha * 255) }), alphaExact: expected.disabled.alpha };
    const sample = (slotName: string, scale: Tree) => ({ ...wanted.text.get(slotName), boxHeight: 20 * scale });
    return {
      colorScheme: {
        ...Object.fromEntries(COLOR_SCHEME.map(([field, path]) => [field, argbOf(canonical(leaves, path, mode))])),
        inversePrimary: argbOf(canonical(leaves, INVERSE_PRIMARY, mode === "light" ? "dark" : "light")),
      },
      surfaces: { card: colorEntry(expected.card), dialog: colorEntry(expected.dialog) },
      nav: {
        backgroundColor: colorEntry(expected.nav.bar),
        indicatorColor: colorEntry(expected.nav.indicatorFill),
        iconSelected: colorEntry(expected.nav.selectedIcon),
        labelSelected: colorEntry(expected.nav.selectedLabel),
        iconUnselected: colorEntry(expected.nav.idleIcon),
        labelUnselected: colorEntry(expected.nav.idleLabel),
      },
      inputFocus: { color: colorEntry(expected.inputFocus.color), width: expected.inputFocus.width },
      disabled: { textButtonForeground: disabled, textButtonIcon: disabled },
      text: Object.fromEntries(wanted.text),
      sizes: Object.fromEntries(wanted.sizes),
      radii: Object.fromEntries(wanted.radii),
      button: { filled: box, outlined: box },
      samples: Object.fromEntries(
        [1, 2].map((scale) => [`${scale}.0`, { body: sample("bodyMedium", scale), data: sample("labelMedium", scale), heading: sample("headlineMedium", scale) }]),
      ),
    };
  };
  return {
    schema: 2,
    fonts: Object.fromEntries(Object.values(FONT_ROLES).map(({ registration }) => [registration, { registeredWidth: 300, fallbackWidth: 660 }])),
    light: view("light"),
    dark: view("dark"),
  };
}

const clone = (value: Tree) => JSON.parse(JSON.stringify(value));
const flagged = (report: Tree, mode: Tree, property: string) => report.mismatches.find((entry: Tree) => entry.mode === mode && entry.property === property);

test("compareApp accepts a capture that matches the oracle", () => {
  const { leaves } = readSource(sourceText);
  const report = compareApp(perfectApp(leaves), leaves);
  assert.deepEqual(report.mismatches, []);
  assert.ok(report.checks > 250);
});

test("compareApp reports each decision 7 regression with property, mode, expected and actual", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectApp(leaves);
  capture.dark.disabled.textButtonForeground.alphaExact = 0.38 * 0.38; // opacity applied twice
  capture.light.inputFocus.width = 1.5;
  capture.light.radii.card = 4;
  capture.dark.text.labelSmall.weight = 500;
  capture.light.text.labelSmall.family = "GeistMono";
  capture.light.button.filled.minHeight = null;
  capture.dark.colorScheme.shadow = argbOf({ ...parseHex("#0f172a"), a: 255 }); // alpha byte lost
  capture.fonts.GeistMono.fallbackWidth = capture.fonts.GeistMono.registeredWidth;
  capture.dark.samples["2.0"].data.boxHeight = 20;
  const report = compareApp(capture, leaves);
  assert.deepEqual(flagged(report, "dark", "disabled textButtonForeground alpha"), {
    scope: "app", mode: "dark", property: "disabled textButtonForeground alpha", expected: "0.38", actual: String(0.38 * 0.38),
  });
  assert.ok(flagged(report, "dark", "disabled textButtonForeground over white"));
  assert.ok(flagged(report, "light", "input focus width"));
  assert.deepEqual(flagged(report, "light", "radii.card"), { scope: "app", mode: "light", property: "radii.card", expected: "8", actual: "4" });
  assert.ok(flagged(report, "dark", "text.labelSmall.weight"));
  assert.ok(flagged(report, "light", "text.labelSmall.family"));
  assert.ok(flagged(report, "light", "button.filled.minHeight"));
  assert.ok(flagged(report, "dark", "colorScheme.shadow"));
  assert.ok(flagged(report, "dark", "colorScheme.shadow over white"), "an alpha colour is compared over white");
  assert.ok(flagged(report, "all", "GeistMono asset loaded"));
  assert.ok(flagged(report, "dark", "sample data height ratio @2.0x"));
});

const measureOf = (color: Tree) => {
  const alpha = color.a / 255;
  const over = (backdrop: Tree) => [...[color.r, color.g, color.b].map((channel) => Math.round(channel * alpha + backdrop * (1 - alpha))), 255];
  return { painted: "x", rgbaAlone: [color.r, color.g, color.b, color.a], rgbaOverWhite: over(255), rgbaOverBlack: over(0) };
};

/** A dashboard capture that matches the oracle exactly. */
function perfectDashboard(leaves: Tree): Tree {
  const expected = expectedCss(leaves);
  const publicPath = new Map(DASHBOARD_PUBLIC);
  const tokenPath = new Map(semanticAndComponentPaths(leaves).map((path) => [cssNameOf(path), path]));
  const declared = ({ type, canon }: Tree) =>
    type === "dimension" ? `${canon.cssNumber}${canon.cssUnit}`
      : type === "duration" ? `${canon.milliseconds}ms`
        : type === "cubicBezier" ? `cubic-bezier(${canon.join(", ")})`
          : String(canon);
  const view = (mode: Tree) => {
    const properties: Tree = {};
    for (const [name, wanted] of expected.root) {
      if (wanted.kind === "var" && name === "--radius") properties[name] = { declared: "6px" };
      else if (wanted.kind === "var") properties[name] = { declared: "", ...measureOf(canonical(leaves, publicPath.get(name), mode)) };
      else if (wanted.kind === "stack") properties[name] = { declared: wanted.stack.join(", ") };
      else if (wanted.type === "color") properties[name] = { declared: "", ...measureOf(canonical(leaves, tokenPath.get(name), mode)) };
      else properties[name] = { declared: declared(wanted) };
    }
    const publicColor = (name: string) => measureOf(canonical(leaves, publicPath.get(name), mode));
    const ring = canonical(leaves, publicPath.get("--ring"), mode);
    const sizes: Tree = {};
    for (const size of ["16px", "20px"]) {
      const root = Number.parseFloat(size);
      const text: Tree = {};
      for (const [step] of [["xs"], ["sm"], ["base"], ["lg"], ["xl"], ["2xl"], ["3xl"]]) {
        const fontSize = expected.theme.get(`--text-${step}`).canon.cssNumber * root;
        text[step] = {
          fontSize: `${fontSize}px`,
          lineHeight: `${expected.theme.get(`--text-${step}--line-height`).canon * fontSize}px`,
          fontWeight: String(expected.theme.get(`--text-${step}--font-weight`).canon),
        };
      }
      sizes[size] = { text, spacing: { "p-1": "4px", "p-4": "16px" }, radii: {} };
    }
    return {
      properties,
      swatches: Object.fromEntries([...publicPath.keys()].map((name) => [name, publicColor(name)])),
      sidebar: {
        container: { backgroundColor: publicColor("--sidebar"), color: publicColor("--sidebar-foreground") },
        active: { backgroundColor: publicColor("--sidebar-accent"), color: publicColor("--sidebar-accent-foreground") },
        idle: { color: publicColor("--sidebar-foreground") },
        primary: { backgroundColor: publicColor("--sidebar-primary"), color: publicColor("--sidebar-primary-foreground") },
      },
      fonts: Object.fromEntries(Object.values(FONT_ROLES).map(({ property, stack }) => [property, { computedFontFamily: stack.join(", ") }])),
      sizes,
      focusRing: {
        matchesFocusVisible: true,
        outlineWidth: "1px",
        outlineStyle: "auto",
        ...(({ rgbaOverWhite, rgbaOverBlack }) => ({ rgbaOverWhite, rgbaOverBlack }))(measureOf({ ...ring, a: ring.a * 0.5 })),
      },
      dots: { backgroundSize: "16px 16px", dotPainted: "dot", backgroundImage: "radial-gradient(dot 1px, transparent 1px)" },
      audit: { fontFamily: FONT_ROLES.mono.stack.join(", "), usedFonts: [{ familyName: "JetBrains Mono", isCustomFont: true }] },
    };
  };
  const probes = Object.fromEntries(Object.keys(FONT_ROLES).map((role) => [role, { usedFonts: [{ isCustomFont: true }] }]));
  return {
    schema: 2,
    rootSizes: ["16px", "20px"],
    faces: { probes, loaded: Object.values(FONT_ROLES).map(({ stack }) => `${stack[0].replaceAll('"', "")} 100 900`) },
    modes: { light: view("light"), dark: view("dark") },
  };
}

test("compareDashboard accepts a capture that matches the oracle", () => {
  const { leaves } = readSource(sourceText);
  const report = compareDashboard(perfectDashboard(leaves), leaves);
  assert.deepEqual(report.mismatches, []);
  assert.ok(report.checks > 600);
});

test("compareDashboard reports each regression with property, mode, expected and actual", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  capture.modes.dark.properties["--mf-semantic-color-bg-canvas"] = { declared: "", ...measureOf(parseHex("#f8fafc")) }; // light value in dark
  capture.modes.light.swatches["--chart-3"] = measureOf(parseHex("#000000"));
  capture.modes.light.sizes["20px"].text["3xl"].fontWeight = "400"; // v2 display weight is 700
  capture.modes.light.sizes["20px"].spacing["p-1"] = "5px"; // spacing follows the root size
  capture.modes.dark.focusRing.rgbaOverWhite = [0, 0, 0, 255];
  capture.modes.light.sidebar.idle.color = measureOf(parseHex("#0f172a"));
  capture.modes.light.fonts["--font-mono"].computedFontFamily = "ui-monospace, monospace";
  capture.modes.light.dots.backgroundSize = "20px 20px";
  const report = compareDashboard(capture, leaves);
  assert.ok(flagged(report, "dark", "--mf-semantic-color-bg-canvas"));
  assert.ok(flagged(report, "light", "swatch --chart-3"));
  assert.deepEqual(flagged(report, "light", "text-3xl font-weight @20px"), {
    scope: "dashboard", mode: "light", property: "text-3xl font-weight @20px", expected: "700", actual: "400",
  });
  assert.deepEqual(flagged(report, "light", "p-1 @20px"), {
    scope: "dashboard", mode: "light", property: "p-1 @20px", expected: "4px", actual: "5px",
  });
  assert.ok(flagged(report, "dark", "focus ring outline"));
  assert.ok(flagged(report, "light", "sidebar idle color"));
  assert.ok(flagged(report, "light", "--font-mono computed"));
  assert.ok(flagged(report, "light", "bg-dots size"));
});

test("compareDashboard rejects a capture with no 20px root measurements", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  capture.rootSizes = ["16px"];
  delete capture.modes.light.sizes["20px"];
  delete capture.modes.dark.sizes["20px"];

  const report = compareDashboard(capture, leaves);
  for (const mode of ["light", "dark"]) {
    assert.ok(report.mismatches.some((item: Tree) => item.mode === mode && item.property.includes("20px")), mode);
  }
});

test("compareDashboard rejects a focus ring with no visible outline", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  Object.assign(capture.modes.light.focusRing, { outlineStyle: "none", outlineWidth: "0px" });

  const report = compareDashboard(capture, leaves);
  assert.ok(report.mismatches.some((item: Tree) => item.mode === "light" && item.property.startsWith("focus ring")));
});

test("compareDashboard requires a nonempty used-font sample", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  capture.faces.probes.heading.usedFonts = [];
  capture.modes.dark.audit.usedFonts = [];

  const report = compareDashboard(capture, leaves);
  assert.ok(flagged(report, "light", "heading sample face"));
  assert.ok(flagged(report, "dark", "audit ID sample"));
});

test("compareApp requires width evidence for every registered family", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectApp(leaves);
  delete capture.fonts.GeistMono;

  const report = compareApp(capture, leaves);
  assert.ok(flagged(report, "all", "GeistMono asset loaded"));
});

// ---- Slice 4 fix round 1 ----

test("compareDashboard requires both root sizes in both modes whatever the capture lists", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  capture.rootSizes = ["16px", "20px", "24px"];
  delete capture.modes.dark.sizes["16px"];
  const report = compareDashboard(capture, leaves);
  assert.ok(flagged(report, "dark", "root size 16px record"));
  assert.ok(!report.mismatches.some((item: Tree) => item.mode === "light" && item.property.startsWith("root size")));
});

test("compareDashboard accepts a visible focus ring and rejects a hidden style or non-numeric width", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  Object.assign(capture.modes.light.focusRing, { outlineStyle: "auto", outlineWidth: "1px" });
  assert.deepEqual(compareDashboard(capture, leaves).mismatches, []);
  Object.assign(capture.modes.light.focusRing, { outlineStyle: "hidden" });
  Object.assign(capture.modes.dark.focusRing, { outlineStyle: "auto", outlineWidth: "thin" });
  const report = compareDashboard(capture, leaves);
  assert.ok(flagged(report, "light", "focus ring outline style"));
  assert.ok(flagged(report, "dark", "focus ring outline width"));
});

test("compareApp requires a width record for every registered family and rejects an empty fonts object", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectApp(leaves);
  capture.fonts = {};
  const report = compareApp(capture, leaves);
  for (const family of ["SpaceGrotesk", "GeistMono", "JetBrainsMono"]) assert.ok(flagged(report, "all", `${family} asset loaded`), family);
  delete capture.fonts;
  assert.equal(compareApp(capture, leaves).mismatches.filter((item: Tree) => item.property.endsWith("asset loaded")).length, 3);
});

test("compareDashboard reports each missing focus outline field", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  Object.assign(capture.modes.light.focusRing, { outlineStyle: "auto" });
  Object.assign(capture.modes.dark.focusRing, { outlineWidth: "1px" });
  delete capture.modes.light.focusRing.outlineWidth;
  delete capture.modes.dark.focusRing.outlineStyle;

  const report = compareDashboard(capture, leaves);
  const missing = [
    ["light", "focus ring outline width"],
    ["dark", "focus ring outline style"],
  ].filter(([mode, property]) => !flagged(report, mode, property));
  assert.deepEqual(missing, []);
});

// ---- Slice 4 fix round 2 ----

test("compareDashboard reports a focus ring record without outline width or style as missing", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  assert.deepEqual(compareDashboard(capture, leaves).mismatches, []);
  delete capture.modes.light.focusRing.outlineWidth;
  delete capture.modes.dark.focusRing.outlineStyle;
  capture.modes.light.focusRing.outlineStyle = "";
  const report = compareDashboard(capture, leaves);
  assert.deepEqual(flagged(report, "light", "focus ring outline width"), {
    scope: "dashboard", mode: "light", property: "focus ring outline width", expected: "above 0", actual: "missing",
  });
  assert.deepEqual(flagged(report, "dark", "focus ring outline style"), {
    scope: "dashboard", mode: "dark", property: "focus ring outline style", expected: "not none or hidden", actual: "missing",
  });
  assert.ok(flagged(report, "light", "focus ring outline style"), "an empty style fails");
  delete capture.modes.dark.focusRing;
  assert.ok(flagged(compareDashboard(capture, leaves), "dark", "focus ring outline width"), "a missing record fails and does not throw");
});

test("compareDashboard rejects a null or non-string outline style", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectDashboard(leaves);
  capture.modes.light.focusRing.outlineStyle = null;
  capture.modes.dark.focusRing.outlineStyle = 1;

  const report = compareDashboard(capture, leaves);
  const missing = ["light", "dark"].filter((mode) => !flagged(report, mode, "focus ring outline style"));
  assert.deepEqual(missing, []);
});

test("compareApp sample height check allows pixel rounding and rejects a sample that does not scale", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectApp(leaves);
  capture.light.samples["1.0"].data.boxHeight = 18; // 17.5 px line, rounded up
  capture.light.samples["2.0"].data.boxHeight = 35;
  assert.deepEqual(compareApp(capture, leaves).mismatches, []);

  capture.light.samples["2.0"].data.boxHeight = 18; // did not scale
  const flaggedCheck = flagged(compareApp(capture, leaves), "light", "sample data height ratio @2.0x");
  assert.deepEqual(flaggedCheck, {
    scope: "app", mode: "light", property: "sample data height ratio @2.0x", expected: "36 ±2 px", actual: "18",
  });
});

test("compareApp accepts the exact height tolerance and reports missing samples", () => {
  const { leaves } = readSource(sourceText);
  const capture = perfectApp(leaves);
  const heightCheck = "sample data height ratio @2.0x";
  capture.light.samples["2.0"].data.boxHeight = 42;
  assert.deepEqual(compareApp(capture, leaves).mismatches, []);

  capture.light.samples["2.0"].data.boxHeight = 43;
  assert.ok(flagged(compareApp(capture, leaves), "light", heightCheck));

  delete capture.light.samples["2.0"].data;
  delete capture.dark.samples["1.0"].data;
  const report = compareApp(capture, leaves);
  assert.equal(flagged(report, "light", heightCheck)?.actual, "missing");
  assert.ok(flagged(report, "dark", heightCheck));
});

// ---- Slice 3 fix round 1: readSource and dimension validation ----

const changedSource = (change: (tree: Tree) => void) => {
  const tree = JSON.parse(sourceText);
  change(tree);
  return JSON.stringify(tree);
};

test("readSource rejects a root that is not an object", () => {
  assert.throws(() => readSource("42"), { message: "oracle: v2/tokens.json root must be an object" });
  assert.throws(() => readSource("[]"), { message: "oracle: v2/tokens.json root must be an object" });
  assert.throws(() => readSource("null"), { message: "oracle: v2/tokens.json root must be an object" });
});

test("readSource names a child that is not an object", () => {
  const text = changedSource((tree: Tree) => { tree.primitive.radius.sm = 7; });
  assert.throws(() => readSource(text), { message: "oracle: primitive.radius.sm must be an object" });
});

for (const value of [6, "6em", "-6px", "px"]) {
  test(`a dimension leaf with ${JSON.stringify(value)} is named, not converted`, () => {
    const text = changedSource((tree: Tree) => { tree.primitive.radius.md.$value = value; });
    const { leaves } = readSource(text);
    assert.throws(() => canonical(leaves, "primitive.radius.md", "light"), {
      message: `oracle: primitive.radius.md: dimension must be a px string, found ${JSON.stringify(value)}`,
    });
    assert.throws(() => expectedApp(leaves), { message: /oracle: primitive\.radius\.md: dimension must be a px string/ });
  });
}

test("a dimension leaf too large to be finite is named, not converted", () => {
  const value = `1${"0".repeat(400)}px`;
  const text = changedSource((tree: Tree) => { tree.primitive.radius.md.$value = value; });
  const { leaves } = readSource(text);
  assert.throws(() => canonical(leaves, "primitive.radius.md", "light"), {
    message: `oracle: primitive.radius.md: dimension must be a px string, found ${JSON.stringify(value)}`,
  });
});
