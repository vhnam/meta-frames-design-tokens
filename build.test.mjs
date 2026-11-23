import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = import.meta.dirname;
const read = (name) => readFileSync(join(here, name), "utf8");
const source = read("v2/tokens.json");
const files = {
  "build.mjs": read("build.mjs"),
  "build.ts": read("build.ts"),
  "hooks.ts": read("hooks.ts"),
  "bindings.json": read("bindings.json"),
  "package.json": read("package.json"),
  "package-lock.json": read("package-lock.json"),
  ".node-version": read(".node-version"),
  "v2/tokens.json": source,
};
const bindingsSource = files["bindings.json"];
const tokenAt = (tokens, path) => path.split(".").reduce((group, key) => group[key], tokens);

// ---- fixture: a temporary workspace with the tool files and the real node_modules ----

function snapshot(root) {
  const state = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.name === "node_modules") continue;
      if (entry.isDirectory()) walk(full);
      else state[full.slice(root.length)] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return state;
}

function fixture(context, changes = {}, { siblings = ["meta-frames-dashboard", "meta-frames-app"], installedLock = true, installedVersion } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mf-token-test-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const tools = join(directory, "meta-frames-design-tokens");
  for (const [name, content] of Object.entries({ ...files, ...changes })) {
    if (content === null) continue;
    mkdirSync(dirname(join(tools, name)), { recursive: true });
    writeFileSync(join(tools, name), content);
  }
  for (const name of siblings) mkdirSync(join(directory, name));
  // node_modules entries are links to the real install, so a test can drop or replace one entry.
  const modules = join(tools, "node_modules");
  const realModules = join(here, "node_modules");
  mkdirSync(modules);
  for (const entry of readdirSync(realModules)) {
    if (entry === ".package-lock.json" || (installedVersion && entry === "style-dictionary")) continue;
    symlinkSync(join(realModules, entry), join(modules, entry));
  }
  if (installedLock) copyFileSync(join(realModules, ".package-lock.json"), join(modules, ".package-lock.json"));
  if (installedVersion) {
    mkdirSync(join(modules, "style-dictionary"));
    writeFileSync(join(modules, "style-dictionary", "package.json"), JSON.stringify({ version: installedVersion }));
  }
  return { directory, script: join(tools, "build.mjs") };
}

const run = (script, directory, flags = ["--inspect"]) =>
  spawnSync(process.execPath, [script, ...flags], { cwd: directory, encoding: "utf8" });

/** Runs --inspect on a changed copy. The run must fail with `expected` and write nothing. */
function rejectsInput(context, changes, expected, options) {
  const { directory, script } = fixture(context, changes, options);
  const before = snapshot(directory);
  const result = run(script, directory);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr || "unexpected successful exit");
  assert.ok(result.stderr.includes(`error: ${expected}`), result.stderr);
  assert.doesNotMatch(result.stderr, /TypeError:/);
  assert.equal(result.stdout, "");
  assert.deepEqual(snapshot(directory), before);
}

function acceptsInput(context, changes) {
  const { directory, script } = fixture(context, changes);
  const before = snapshot(directory);
  const result = run(script, directory);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(directory), before);
  return parseInspect(result.stdout);
}

const mutate = (json, change) => {
  const value = JSON.parse(json);
  change(value);
  return JSON.stringify(value, null, 2);
};
const changeSource = (change) => ({ "v2/tokens.json": mutate(source, change) });
const changeBindings = (change) => ({ "bindings.json": mutate(bindingsSource, change) });
const firstLeaf = (tokens, group) => {
  const walk = (node, trail) => {
    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith("$")) continue;
      if ("$value" in child) return [...trail, name].join(".");
      const found = walk(child, [...trail, name]);
      if (found) return found;
    }
  };
  return walk(tokenAt(tokens, group), [group]);
};

/** Parses --inspect output into Map("mode path" -> { field: value }) plus the summary lines. */
function parseInspect(output) {
  const blocks = new Map();
  const summary = {};
  let fields;
  for (const line of output.trimEnd().split("\n")) {
    if (line.startsWith("summary ")) {
      const [, mode, count] = /^summary (\w+): (\d+)/.exec(line);
      summary[mode] = Number(count);
    } else if (!line.startsWith(" ")) {
      fields = {};
      blocks.set(line, fields);
    } else {
      const separator = line.indexOf(":");
      fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return { blocks, summary };
}

// ---- the real source ----

test("the source file is the reviewed snapshot with the spec counts", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), "04e51a389123747a5b4dbfbe13e6f47d7083e28c4aaf02469a1fc46b1217baa9");
  const counts = { primitive: 0, semantic: 0, component: 0 };
  let colorsWithDark = 0;
  const walk = (node, trail) => {
    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith("$")) continue;
      if ("$value" in child) {
        counts[trail[0]] += 1;
        if (trail.slice(0, 2).join(".") === "semantic.color" && child.$extensions?.["com.metaframes.modes"]?.dark) colorsWithDark += 1;
      } else {
        walk(child, [...trail, name]);
      }
    }
  };
  walk(JSON.parse(source), []);
  assert.deepEqual(counts, { primitive: 102, semantic: 106, component: 78 });
  assert.equal(colorsWithDark, 39);
});

test("inspect lists every leaf for each mode, resolves modes and writes nothing", (context) => {
  const { directory, script } = fixture(context);
  const before = snapshot(directory);
  const result = run(script, directory);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(directory), before);
  const { blocks, summary } = parseInspect(result.stdout);
  assert.deepEqual(summary, { light: 184, dark: 184 });
  assert.equal([...blocks.keys()].filter((key) => key.startsWith("primitive ")).length, 102);
  for (const mode of ["light", "dark"]) {
    assert.equal([...blocks.keys()].filter((key) => key.startsWith(`${mode} `)).length, 184);
  }
  const indicator = (mode) => blocks.get(`${mode} component.nav.indicator`);
  assert.equal(indicator("light").css, "#047857");
  assert.equal(indicator("dark").css, "#34D399");
  assert.match(indicator("dark").chain, /component\.nav\.indicator -> semantic\.color\.action\.accent -> primitive\.color\.emerald\.400/);
  assert.equal(blocks.get("primitive primitive.color.scrim").dart, "0x990F172A");
  assert.equal(blocks.get("primitive primitive.color.scrim").css, "#0F172A99");
  // non-colour values are the same in both modes
  assert.equal(blocks.get("light semantic.text.body.font-size").css, blocks.get("dark semantic.text.body.font-size").css);
  assert.equal(blocks.get("light semantic.text.body.font-size").css, "1rem");
  assert.equal(blocks.get("light semantic.text.body.font-size").dart, "16.0");
});

test("inspect shows the authored font chain and the bound output per platform", (context) => {
  const { directory, script } = fixture(context);
  const { blocks } = parseInspect(run(script, directory).stdout);
  const heading = blocks.get("light semantic.text.display.font-family");
  assert.equal(heading.authored, "Inter, ui-sans-serif, system-ui, sans-serif");
  assert.match(heading["output.dashboard"], /^"Space Grotesk Variable", ui-sans-serif, sans-serif/);
  assert.match(heading["output.app"], /^SpaceGrotesk/);
  const label = blocks.get("dark semantic.text.label.font-family");
  assert.match(label["output.dashboard"], /^"Geist Mono Variable", ui-monospace, monospace/);
  assert.match(label["output.app"], /^JetBrainsMono/);
});

test("without a flag the runner exits nonzero and writes nothing", (context) => {
  const { directory, generate } = generateFixture(context, { "bindings.json": null });
  const before = snapshot(directory);
  const result = generate();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta-frames-design-tokens\/bindings\.json: bindings missing/);
  assert.deepEqual(snapshot(directory), before);
});

test("rejects an unknown flag", (context) => {
  const { directory, script } = fixture(context);
  const result = run(script, directory, ["--write"]);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("usage:"));
});

// ---- accepted shapes ----

test("accepts a forward reference (component group before primitives)", (context) => {
  const tokens = JSON.parse(source);
  const reordered = { $description: tokens.$description, component: tokens.component, semantic: tokens.semantic, primitive: tokens.primitive };
  const { summary } = acceptsInput(context, { "v2/tokens.json": JSON.stringify(reordered) });
  assert.deepEqual(summary, { light: 184, dark: 184 });
});

test("accepts a shared target", (context) => {
  const { blocks } = acceptsInput(context, changeSource((tokens) => {
    const canvas = tokenAt(tokens, "semantic.color.bg.canvas");
    const surface = tokenAt(tokens, "semantic.color.bg.surface");
    surface.$value = canvas.$value;
    surface.$extensions["com.metaframes.modes"].dark = canvas.$extensions["com.metaframes.modes"].dark;
  }));
  assert.equal(blocks.get("light semantic.color.bg.surface").css, blocks.get("light semantic.color.bg.canvas").css);
  assert.equal(blocks.get("dark semantic.color.bg.surface").css, blocks.get("dark semantic.color.bg.canvas").css);
});

test("accepts an explicit identical light and dark pair", (context) => {
  const { blocks } = acceptsInput(context, changeSource((tokens) => {
    const canvas = tokenAt(tokens, "semantic.color.bg.canvas");
    canvas.$extensions["com.metaframes.modes"].dark = canvas.$value;
  }));
  assert.equal(blocks.get("light semantic.color.bg.canvas").css, blocks.get("dark semantic.color.bg.canvas").css);
});

test("one source gives light, dark, light again without a change (rule 4)", async () => {
  const hooks = await import("./hooks.ts");
  const tree = JSON.parse(source);
  const original = structuredClone(tree);
  const indicator = async (mode) => (await hooks.nativeValues(await hooks.createDictionary(tree, mode))).get("component.nav.indicator").css;
  assert.equal(await indicator("light"), "#047857");
  assert.equal(await indicator("dark"), "#34D399");
  assert.equal(await indicator("light"), "#047857");
  assert.deepEqual(tree, original);
  const first = hooks.projectMode(tree, "light").tree;
  hooks.projectMode(tree, "dark");
  assert.deepEqual(hooks.projectMode(tree, "light").tree, first);
});

// ---- rejected input ----

const colorLeaf = "primitive.color.slate.50";
const canvas = "semantic.color.bg.canvas";
const surface = "semantic.color.bg.surface";
const tokens = JSON.parse(source);
const spaceLeaf = firstLeaf(tokens, "primitive.space");

for (const [name, changes, expected] of [
  ["missing source", { "v2/tokens.json": null }, "meta-frames-design-tokens/v2/tokens.json: source missing"],
  ["invalid JSON", { "v2/tokens.json": "{" }, "meta-frames-design-tokens/v2/tokens.json: invalid JSON"],
  ["falsy source root", { "v2/tokens.json": "false" }, "meta-frames-design-tokens/v2/tokens.json: root must be an object"],
  ["duplicate key", { "v2/tokens.json": source.replace('"white": {', '"white": {"$value": "#FFFFFF"}, "white": {') }, "primitive.color.white: duplicate path in meta-frames-design-tokens/v2/tokens.json"],
  ["missing type", changeSource((value) => { delete value.primitive.color.$type; }), `${colorLeaf}: missing $type`],
  ["unsupported type", changeSource((value) => { value.primitive.color.$type = "gradient"; }), `${colorLeaf}: unsupported $type "gradient"`],
  ["invalid colour literal", changeSource((value) => { tokenAt(value, colorLeaf).$value = "#12345"; }), `${colorLeaf}: color must be # plus six or eight hex digits`],
  ["invalid unit", changeSource((value) => { tokenAt(value, spaceLeaf).$value = "4em"; }), `${spaceLeaf}: dimension must be`],
  ["negative dimension", changeSource((value) => { tokenAt(value, spaceLeaf).$value = "-4px"; }), `${spaceLeaf}: dimension must be`],
  ["bad font weight", changeSource((value) => { value.primitive.font.weight.bold.$value = 750; }), "primitive.font.weight.bold: fontWeight must be"],
  ["empty font family", changeSource((value) => { value.primitive.font.family.sans.$value = []; }), "primitive.font.family.sans: fontFamily must be"],
  ["opacity above 1", changeSource((value) => { value.primitive.opacity["38"].$value = 1.5; }), "primitive.opacity.38: opacity must be within [0, 1]"],
  ["zero line height", changeSource((value) => { value.primitive.font["line-height"].tight.$value = 0; }), "primitive.font.line-height.tight: line height must be positive"],
  ["fractional duration", changeSource((value) => { value.primitive.duration.fast.$value = "10.5ms"; }), "primitive.duration.fast: duration must be"],
  ["cubic out of range", changeSource((value) => { value.primitive.easing.standard.$value = [2, 0, 0, 1]; }), "primitive.easing.standard: cubicBezier must be"],
  ["ambiguous segment with a dot", changeSource((value) => { value.primitive.color["a.b"] = { $value: "#FFFFFF" }; }), 'primitive.color: ambiguous path segment "a.b"'],
  ["ambiguous segment with a brace", changeSource((value) => { value.primitive.color["{x}"] = { $value: "#FFFFFF" }; }), 'primitive.color: ambiguous path segment "{x}"'],
  ["ambiguous segment starting with $", changeSource((value) => { value.primitive.color.$bad = { $value: "#FFFFFF" }; }), 'primitive.color: ambiguous path segment "$bad"'],
  ["literal in a semantic leaf", changeSource((value) => { tokenAt(value, canvas).$value = "#FFFFFF"; }), `[light] ${canvas}: semantic value must be one whole brace reference, found literal "#FFFFFF"`],
  ["malformed reference", changeSource((value) => { tokenAt(value, canvas).$value = `prefix {${colorLeaf}}`; }), `[light] ${canvas}: malformed reference`],
  ["missing reference target", changeSource((value) => { tokenAt(value, canvas).$value = "{primitive.color.nope}"; }), `[light] ${canvas}: reference target primitive.color.nope does not exist (chain: ${canvas} -> primitive.color.nope)`],
  ["group reference target", changeSource((value) => { tokenAt(value, canvas).$value = "{primitive.color.slate}"; }), `[light] ${canvas}: reference target primitive.color.slate is a group`],
  ["self cycle", changeSource((value) => { tokenAt(value, canvas).$value = `{${canvas}}`; }), `[light] ${canvas}: reference cycle ${canvas} -> ${canvas}`],
  ["multi-leaf cycle", changeSource((value) => {
    tokenAt(value, canvas).$value = `{${surface}}`;
    tokenAt(value, surface).$value = `{${canvas}}`;
  }), `[light] ${canvas}: reference cycle ${canvas} -> ${surface} -> ${canvas}`],
  ["skipped layer", changeSource((value) => { tokenAt(value, "component.nav.bg").$value = `{${colorLeaf}}`; }), `[light] component.nav.bg: skipped layer: component references primitive at ${colorLeaf} (chain: component.nav.bg -> ${colorLeaf})`],
  ["same-layer edge", changeSource((value) => { tokenAt(value, canvas).$value = `{${surface}}`; }), `[light] ${canvas}: same-layer edge to ${surface}`],
  ["reversed edge", changeSource((value) => { tokenAt(value, canvas).$value = "{component.nav.bg}"; }), `[light] ${canvas}: reversed edge to component.nav.bg`],
  ["type mismatch", changeSource((value) => { tokenAt(value, canvas).$value = `{${spaceLeaf}}`; }), `[light] ${canvas}: type mismatch: color references dimension at ${spaceLeaf}`],
  ["dark-only type mismatch", changeSource((value) => { tokenAt(value, canvas).$extensions["com.metaframes.modes"].dark = `{${spaceLeaf}}`; }), `[dark] ${canvas}: type mismatch: color references dimension at ${spaceLeaf} (chain: ${canvas} -> ${spaceLeaf})`],
  ["dark-only missing target", changeSource((value) => { tokenAt(value, canvas).$extensions["com.metaframes.modes"].dark = "{primitive.color.nope}"; }), `[dark] ${canvas}: reference target primitive.color.nope does not exist`],
  ["missing dark value", changeSource((value) => { delete tokenAt(value, canvas).$extensions; }), `[dark] ${canvas}: missing dark value`],
  ["unknown mode", changeSource((value) => { tokenAt(value, canvas).$extensions["com.metaframes.modes"].dim = `{${colorLeaf}}`; }), `[dark] ${canvas}: unknown mode "dim"`],
  ["mode declaration on a primitive", changeSource((value) => { tokenAt(value, colorLeaf).$extensions = { "com.metaframes.modes": { dark: `{${colorLeaf}}` } }; }), `[dark] ${colorLeaf}: mode declaration outside semantic.color`],
  ["mode declaration on a component", changeSource((value) => { tokenAt(value, "component.nav.bg").$extensions = { "com.metaframes.modes": { dark: `{${surface}}` } }; }), "[dark] component.nav.bg: mode declaration outside semantic.color"],
  ["non-object extensions", changeSource((value) => { tokenAt(value, canvas).$extensions = []; }), `${canvas}: $extensions must be an object`],
  ["missing bindings file", { "bindings.json": null }, "meta-frames-design-tokens/bindings.json: bindings missing"],
  ["binding target missing", changeBindings((value) => { value.dashboard.colors[2].source = "semantic.color.bg.nope"; }), "bindings.json: dashboard binding --card: target path semantic.color.bg.nope does not exist"],
  ["app binding target missing", changeBindings((value) => { value.app.colorScheme.primary = "semantic.color.action.nope"; }), "bindings.json: app binding ColorScheme.primary: target path semantic.color.action.nope does not exist"],
  ["public name claimed twice", changeBindings((value) => { value.dashboard.colors.push({ properties: ["--background"], source: canvas }); }), "bindings.json: dashboard public name --background is claimed by two bindings"],
  ["duplicate key in bindings", { "bindings.json": bindingsSource.replace('"outputs": {', '"outputs": {}, "outputs": {') }, "outputs: duplicate path in meta-frames-design-tokens/bindings.json"],
  ["missing dashboard section", changeBindings((value) => { delete value.dashboard; }), "bindings.json: dashboard must be an object"],
  ["missing dashboard.scalars", changeBindings((value) => { delete value.dashboard.scalars; }), "bindings.json: dashboard.scalars must be an object"],
  ["missing dashboard.text", changeBindings((value) => { delete value.dashboard.text; }), "bindings.json: dashboard.text must be an object"],
  ["dashboard colors missing", changeBindings((value) => { delete value.dashboard.colors; }), "bindings.json: dashboard.colors must be an array"],
  ["dashboard colors null", changeBindings((value) => { value.dashboard.colors = null; }), "bindings.json: dashboard.colors must be an array"],
  ["dashboard colors object", changeBindings((value) => { value.dashboard.colors = { background: "semantic.color.bg.canvas" }; }), "bindings.json: dashboard.colors must be an array"],
  ["dashboard colors string", changeBindings((value) => { value.dashboard.colors = "semantic.color.bg.canvas"; }), "bindings.json: dashboard.colors must be an array"],
  ["dashboard color entry without properties", changeBindings((value) => { delete value.dashboard.colors[0].properties; }), "bindings.json: dashboard.colors[0].properties must be an array"],
  ["dashboard color entry without source, empty properties", changeBindings((value) => { value.dashboard.colors.push({ properties: [] }); }), "bindings.json: dashboard.colors[26].source must be a nonempty string, found undefined"],
  ["dashboard color entry without source, with properties", changeBindings((value) => { delete value.dashboard.colors[0].source; }), "bindings.json: dashboard.colors[0].source must be a nonempty string, found undefined"],
  ["dashboard color entry with an empty source", changeBindings((value) => { value.dashboard.colors[0].source = ""; }), 'bindings.json: dashboard.colors[0].source must be a nonempty string, found ""'],
  ["dashboard color property that is not a string", changeBindings((value) => { value.dashboard.colors[0].properties.push(7); }), "bindings.json: dashboard.colors[0].properties[1] must be a string, found 7"],
  ["missing app section", changeBindings((value) => { delete value.app; }), "bindings.json: app must be an object"],
  ["missing app.colorScheme", changeBindings((value) => { delete value.app.colorScheme; }), "bindings.json: app.colorScheme must be an object"],
  ["missing app.inversePrimary", changeBindings((value) => { delete value.app.inversePrimary; }), "bindings.json: app.inversePrimary must be an object"],
  ["missing app.inversePrimary.field", changeBindings((value) => { delete value.app.inversePrimary.field; }), "bindings.json: app.inversePrimary.field must be a nonempty string"],
  ["missing app.inversePrimary.source", changeBindings((value) => { delete value.app.inversePrimary.source; }), "bindings.json: app binding ColorScheme.inversePrimary: target must be a token path string, found undefined"],
  ["missing fonts section", changeBindings((value) => { delete value.fonts; }), "bindings.json: fonts must be an object"],
  ["missing fonts section (existing check)", changeBindings((value) => { delete value.fonts; }), "semantic.text.display.font-family: font-family path has no role in bindings.json fonts.paths"],
  ["missing fonts.roles", changeBindings((value) => { delete value.fonts.roles; }), "bindings.json: fonts.roles must be an object"],
  ["missing fonts.roles (existing check)", changeBindings((value) => { delete value.fonts.roles; }), 'bindings.json: fonts.paths semantic.text.display.font-family: unknown role "heading"'],
  ["font role without dashboard.property", changeBindings((value) => { delete value.fonts.roles.heading.dashboard.property; }), "bindings.json: fonts.roles.heading needs dashboard.property, dashboard.stack and app"],
  ["font role without dashboard.stack", changeBindings((value) => { delete value.fonts.roles.heading.dashboard.stack; }), "bindings.json: fonts.roles.heading needs dashboard.property, dashboard.stack and app"],
  ["font role without app", changeBindings((value) => { delete value.fonts.roles.heading.app; }), "bindings.json: fonts.roles.heading needs dashboard.property, dashboard.stack and app"],
  ["font path without a role", changeBindings((value) => { delete value.fonts.paths["semantic.text.data.font-family"]; }), "semantic.text.data.font-family: font-family path has no role"],
  ["unknown font role", changeBindings((value) => { value.fonts.paths["semantic.text.data.font-family"] = "serif"; }), 'bindings.json: fonts.paths semantic.text.data.font-family: unknown role "serif"'],
  ["font path that is not a font", changeBindings((value) => { value.fonts.paths[canvas] = "body"; }), `bindings.json: fonts.paths ${canvas}: not a fontFamily leaf`],
  ["missing Node pin", { ".node-version": null }, "meta-frames-design-tokens/.node-version: Node pin file missing"],
  ["Node pin mismatch", { ".node-version": "0.0.0\n" }, "meta-frames-design-tokens/.node-version: needs Node 0.0.0"],
  ["lockfile version mismatch", { "package-lock.json": mutate(files["package-lock.json"], (lock) => { lock.packages["node_modules/style-dictionary"].version = "0.0.1"; }) }, "meta-frames-design-tokens/package-lock.json: node_modules/style-dictionary is 0.0.1"],
  ["range in the manifest", { "package.json": mutate(files["package.json"], (manifest) => { manifest.dependencies["style-dictionary"] = "^5.6.0"; }) }, "meta-frames-design-tokens/package.json: style-dictionary must be pinned to an exact version"],
]) {
  test(`rejects ${name}`, (context) => rejectsInput(context, changes, expected));
}

test("rejects a wrong installed version", (context) => {
  rejectsInput(context, {}, "meta-frames-design-tokens/node_modules/style-dictionary: installed style-dictionary is 0.0.0", { installedVersion: "0.0.0" });
});

test("rejects an install that did not come from npm ci", (context) => {
  rejectsInput(context, {}, "meta-frames-design-tokens/node_modules/.package-lock.json: file missing", { installedLock: false });
});

for (const missing of ["meta-frames-dashboard", "meta-frames-app"]) {
  test(`rejects a missing ${missing} checkout`, (context) => {
    rejectsInput(context, {}, `${missing}: sibling checkout missing`, {
      siblings: ["meta-frames-dashboard", "meta-frames-app"].filter((name) => name !== missing),
    });
  });
}

test("reports a skipped layer reached through a dark override", (context) => {
  const nav = "component.nav.bg";
  const changes = changeSource((tree) => {
    tokenAt(tree, canvas).$extensions["com.metaframes.modes"].dark = `{${nav}}`;
    tokenAt(tree, nav).$value = `{${colorLeaf}}`;
  });
  rejectsInput(context, changes, `[dark] ${nav}: skipped layer: component references primitive at ${colorLeaf} (chain: ${nav} -> ${colorLeaf})`);
});

test("reports a cycle and its repeated path from an incoming dark edge", (context) => {
  const nav = "component.nav.bg";
  const changes = changeSource((tree) => {
    tokenAt(tree, canvas).$extensions["com.metaframes.modes"].dark = `{${surface}}`;
    tokenAt(tree, surface).$extensions["com.metaframes.modes"].dark = `{${nav}}`;
  });
  rejectsInput(context, changes, `[dark] ${canvas}: reference cycle ${surface} -> ${nav} -> ${surface} (chain: ${canvas} -> ${surface} -> ${nav} -> ${surface})`);
});

test("rejects a reference in a primitive", (context) => {
  rejectsInput(context, changeSource((tree) => {
    tokenAt(tree, colorLeaf).$value = "{primitive.color.white}";
  }), `${colorLeaf}: color must be`);
});

test("resolves a component font size through both aliases in both modes", (context) => {
  const { blocks } = acceptsInput(context, {});
  for (const mode of ["light", "dark"]) {
    const button = blocks.get(`${mode} component.button.font-size`);
    assert.equal(button.css, "0.875rem");
    assert.equal(button.dart, "14.0");
  }
});

test("applies rem to a font-size role that shares a generic dimension", (context) => {
  const role = "semantic.text.label.font-size";
  const { blocks } = acceptsInput(context, changeSource((tree) => {
    tree.primitive.measure = { $type: "dimension", shared: { $value: "18px" } };
    tokenAt(tree, role).$value = "{primitive.measure.shared}";
    tree.semantic.space.gap.xs.$value = "{primitive.measure.shared}";
  }));
  for (const mode of ["light", "dark"]) {
    assert.equal(blocks.get(`${mode} component.button.font-size`).css, "1.125rem", mode);
    assert.equal(blocks.get(`${mode} semantic.space.gap.xs`).css, "18px", mode);
  }
});

test("rejects disabled opacity above 1 after renaming its primitive group", (context) => {
  rejectsInput(context, changeSource((tree) => {
    tree.primitive.alpha = tree.primitive.opacity;
    delete tree.primitive.opacity;
    tree.primitive.alpha["38"].$value = 1.5;
    tree.semantic.opacity.disabled.$value = "{primitive.alpha.38}";
  }), "[light] semantic.opacity.disabled:");
});

test("rejects a mode declaration on a group outside semantic.color", (context) => {
  rejectsInput(context, changeSource((tree) => {
    tree.primitive.color.$extensions = { "com.metaframes.modes": { dark: "{primitive.color.white}" } };
  }), "[dark] primitive.color: mode declaration outside semantic.color");
});

test("rejects a mode declaration on a number inside semantic.color", (context) => {
  rejectsInput(context, changeSource((tree) => {
    tree.semantic.color.measure = {
      $type: "number",
      $value: "{primitive.font.line-height.tight}",
      $extensions: { "com.metaframes.modes": { dark: "{primitive.font.line-height.normal}" } },
    };
  }), "[dark] semantic.color.measure:");
});

test("rejects distinct token paths that produce the same public names", async () => {
  const { analyze } = await import("./hooks.ts");
  const tree = JSON.parse(source);
  tree.component["button-font"] = { size: { ...tree.component.button["font-size"] } };
  const { errors } = analyze(tree, JSON.parse(bindingsSource));
  assert.match(errors.join("\n"), /collision[^\n]*--mf-component-button-font-size/i);
  assert.match(errors.join("\n"), /collision[^\n]*componentButtonFontSize/i);
});

test("rejects a group target for a Flutter ColorScheme field", (context) => {
  rejectsInput(context, changeBindings((value) => {
    value.app.colorScheme.primary = "semantic.color.action";
  }), "bindings.json: app binding ColorScheme.primary:");
});

test("preserves a duration above Number.MAX_SAFE_INTEGER in the Dart literal", (context) => {
  const { blocks } = acceptsInput(context, changeSource((tree) => {
    tree.primitive.duration.fast.$value = "9007199254740993ms";
  }));
  assert.equal(blocks.get("primitive primitive.duration.fast").dart, "Duration(milliseconds: 9007199254740993)");
});

test("preserves a fractional font size when converting px to rem", (context) => {
  const { blocks } = acceptsInput(context, changeSource((tree) => {
    tree.primitive.font.size.sm.$value = "0.0001px";
  }));
  const { css } = blocks.get("light component.button.font-size");
  assert.match(css, /rem$/);
  assert.equal(Number.parseFloat(css), 0.0001 / 16);
});

test("keeps component spacing in px when it aliases a font-size leaf", (context) => {
  const { blocks } = acceptsInput(context, changeSource((tree) => {
    tree.component.button.gap.$value = "{semantic.text.label.font-size}";
  }));
  for (const mode of ["light", "dark"]) {
    const gap = blocks.get(`${mode} component.button.gap`);
    assert.equal(gap.dart, "14.0");
    assert.equal(gap.css, "14px");
  }
});

test("rejects an invalid opacity when only the component slot names the role", (context) => {
  rejectsInput(context, changeSource((tree) => {
    tree.primitive.alpha = { $type: "number", large: { $value: 1.5 } };
    tree.semantic.alpha = { $type: "number", large: { $value: "{primitive.alpha.large}" } };
    tree.component.button["disabled-opacity"].$value = "{semantic.alpha.large}";
  }), "[light] component.button.disabled-opacity: opacity must be within [0, 1]");
});

test("rejects a public alias that claims a generated CSS name", (context) => {
  rejectsInput(context, changeBindings((value) => {
    value.dashboard.colors[0].properties.push("--mf-semantic-color-bg-canvas");
  }), "bindings.json: dashboard public name --mf-semantic-color-bg-canvas");
});

test("accepts equal Dart field names when the tokens use separate classes", (context) => {
  acceptsInput(context, changeSource((tree) => {
    tree.component.button["track-2"] = { $type: "dimension", $value: "{semantic.space.gap.xs}" };
    tree.component.button.track2 = { $type: "color", $value: "{semantic.color.bg.canvas}" };
  }));
});

test("rejects a dashboard text binding to a non-text group", (context) => {
  rejectsInput(context, changeBindings((value) => {
    value.dashboard.text["--text-base"] = "semantic.color.bg";
  }), "bindings.json: dashboard binding --text-base:");
});

test("rejects a text-role group as the target of an app radius binding", (context) => {
  rejectsInput(context, changeBindings((value) => {
    value.app.theme.kRadius = "semantic.text.body";
  }), "bindings.json: app binding kRadius:");
});

test("reports an invalid app theme target by binding name", (context) => {
  rejectsInput(context, changeBindings((value) => {
    value.app.theme.kRadius = null;
  }), "bindings.json: app binding kRadius:");
});

test("rejects a dimension leaf as the target of a Flutter ColorScheme field", (context) => {
  rejectsInput(context, changeBindings((value) => {
    value.app.colorScheme.primary = "semantic.space.gap.xs";
  }), "bindings.json: app binding ColorScheme.primary:");
});

test("removes leading zeros from a Dart duration without losing integer precision", (context) => {
  const { blocks } = acceptsInput(context, changeSource((tree) => {
    tree.primitive.duration.fast.$value = "000ms";
    tree.primitive.duration.normal.$value = "09007199254740993ms";
  }));
  assert.equal(blocks.get("primitive primitive.duration.fast").dart, "Duration(milliseconds: 0)");
  assert.equal(blocks.get("primitive primitive.duration.normal").dart, "Duration(milliseconds: 9007199254740993)");
});

test("keeps zero and fractional dimensions through per-leaf unit changes", (context) => {
  const { blocks } = acceptsInput(context, changeSource((tree) => {
    tree.primitive.measure = {
      $type: "dimension",
      zero: { $value: "0px" },
      "font-size": { $value: "12.125px" },
    };
    tree.semantic.space.gap.xs.$value = "{primitive.measure.font-size}";
    tree.component.button["font-size"].$value = "{semantic.space.gap.xs}";
    tree.semantic.text.label["font-size"].$value = "{primitive.measure.zero}";
  }));
  assert.equal(blocks.get("primitive primitive.measure.zero").css, "0px");
  for (const mode of ["light", "dark"]) {
    const gap = blocks.get(`${mode} semantic.space.gap.xs`);
    const font = blocks.get(`${mode} component.button.font-size`);
    const label = blocks.get(`${mode} semantic.text.label.font-size`);
    assert.equal(gap.css, "12.125px");
    assert.equal(font.css, "0.7578125rem");
    assert.equal(font.dart, "12.125");
    assert.equal(label.css, "0rem");
    assert.equal(label.dart, "0.0");
  }
});

test("reports the dimension path when the CSS transform receives an unexpected unit", async () => {
  const { cssDimension } = await import("./hooks.ts");
  assert.throws(
    () => cssDimension(["component", "button", "gap"], "4em"),
    /component\.button\.gap:.*4em/,
  );
});

test("applies suffixed opacity and line-height bounds to primitives", async () => {
  const { validateProfile } = await import("./hooks.ts");
  const { errors } = validateProfile({
    primitive: {
      $type: "number",
      "disabled-opacity": { $value: 1.5 },
      "compact-line-height": { $value: 0 },
    },
  });
  assert.match(errors.join("\n"), /primitive\.disabled-opacity: opacity must be within/);
  assert.match(errors.join("\n"), /primitive\.compact-line-height: line height must be positive/);
});

test("rejects a mode declaration on a group inside semantic.color", (context) => {
  rejectsInput(context, changeSource((tree) => {
    tree.semantic.color.bg.$extensions = { "com.metaframes.modes": { dark: "{primitive.color.white}" } };
  }), "[dark] semantic.color.bg: mode declaration on a group");
});

test("rejects a bound text role that lacks a required line height", (context) => {
  rejectsInput(context, changeSource((tree) => {
    delete tree.semantic.text.body["line-height"];
  }), "bindings.json: dashboard binding --text-base:");
});

test("checks the presence and type of each text role member for both platforms", async () => {
  const { analyze } = await import("./hooks.ts");
  const tree = JSON.parse(source);
  const bindings = JSON.parse(bindingsSource);
  const members = {
    "font-family": "fontFamily",
    "font-size": "dimension",
    "line-height": "number",
    "font-weight": "fontWeight",
  };
  const boundNames = ["dashboard binding --text-base", "app binding textTheme.bodyLarge"];
  assert.deepEqual(analyze(tree, bindings).errors, []);

  for (const [member, type] of Object.entries(members)) {
    const fixture = structuredClone(tree);
    delete fixture.semantic.text.body[member];
    const missing = analyze(fixture, bindings).errors;
    fixture.semantic.text.body[member] = { $type: "color", $value: "{primitive.color.white}" };
    const mistyped = analyze(fixture, bindings).errors;

    for (const name of boundNames) {
      const prefix = `bindings.json: ${name}:`;
      assert.ok(missing.includes(`${prefix} text role semantic.text.body has no ${member} leaf`));
      assert.ok(mistyped.includes(`${prefix} semantic.text.body.${member} is a color leaf, a ${type} leaf is required`));
    }
  }
});

// ---- Slice 3: formats, headers, check, writes ----

const CSS_OUTPUT = "meta-frames-dashboard/src/styles/design-tokens.generated.css";
const DART_OUTPUT = "meta-frames-app/lib/ui/core/design_tokens.g.dart";
const sha = (value) => createHash("sha256").update(value).digest("hex");

function generateFixture(context, changes) {
  const made = fixture(context, changes);
  mkdirSync(join(made.directory, dirname(CSS_OUTPUT)), { recursive: true });
  mkdirSync(join(made.directory, dirname(DART_OUTPUT)), { recursive: true });
  const outputs = { css: join(made.directory, CSS_OUTPUT), dart: join(made.directory, DART_OUTPUT) };
  return { ...made, outputs, generate: (flags = [], nodeFlags = []) => spawnSync(process.execPath, [...nodeFlags, made.script, ...flags], { cwd: made.directory, encoding: "utf8" }) };
}

const outputBytes = ({ outputs }) => [readFileSync(outputs.css), readFileSync(outputs.dart)];

test("generate writes both files, and a second run gives identical bytes", (context) => {
  const made = generateFixture(context);
  const first = made.generate();
  assert.equal(first.status, 0, first.stderr);
  const bytes = outputBytes(made);
  const second = made.generate();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /unchanged/);
  assert.deepEqual(outputBytes(made), bytes);
  assert.equal(made.generate(["--check"]).status, 0);
});

test("headers carry the source digest and one generator digest, with no timestamp", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  const [css, dart] = outputBytes(made).map(String);
  const sourceDigest = sha(source);
  const generator = (text) => /Generator: sha256 ([0-9a-f]{64}) of/.exec(text)[1];
  for (const text of [css, dart]) {
    assert.ok(text.includes(`Source: meta-frames-design-tokens/v2/tokens.json (not in Git), sha256 ${sourceDigest}`));
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}|\/Users\/|\/tmp\//);
    assert.ok(text.includes("Regenerate: node meta-frames-design-tokens/build.mjs. Verify: node meta-frames-design-tokens/build.mjs --check"));
  }
  assert.equal(generator(css), generator(dart));
  assert.ok(!css.includes("\r") && css.endsWith("\n") && dart.endsWith("\n"));
});

test("the generator digest follows the manifest and ignores the tests", (context) => {
  const digestOf = (changes) => {
    const made = generateFixture(context, changes);
    assert.equal(made.generate().status, 0);
    return /Generator: sha256 ([0-9a-f]{64})/.exec(String(readFileSync(made.outputs.css)))[1];
  };
  const base = digestOf({});
  assert.equal(digestOf({}), base);
  assert.notEqual(digestOf({ "package.json": mutate(files["package.json"], (manifest) => { manifest.description = "changed"; }) }), base);
});

test("fonts: CSS emits the dashboard stack, Dart the registration, and Inter never appears", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  const [css, dart] = outputBytes(made).map(String);
  assert.doesNotMatch(css + dart, /Inter/);
  assert.match(css, /--mf-semantic-text-label-font-family: "Geist Mono Variable", ui-monospace, monospace;/);
  assert.match(dart, /semanticTextLabelFontFamily = 'JetBrainsMono';/);
  assert.match(css, /--text-xs--line-height: 1\.375;/);
});

test("--check fails for a missing output and for a one-byte change, and names the file", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  const css = readFileSync(made.outputs.css);
  const dart = readFileSync(made.outputs.dart);
  rmSync(made.outputs.css);
  let result = made.generate(["--check"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`error: ${CSS_OUTPUT}: missing`), result.stderr);
  writeFileSync(made.outputs.css, css);
  const changed = Buffer.from(dart);
  changed[changed.length - 2] ^= 1;
  writeFileSync(made.outputs.dart, changed);
  const before = snapshot(made.directory);
  result = made.generate(["--check"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`error: ${DART_OUTPUT}: stale or edited`), result.stderr);
  assert.ok(!result.stderr.includes(CSS_OUTPUT));
  assert.deepEqual(snapshot(made.directory), before);
});

test("--check reports every affected destination", (context) => {
  const made = generateFixture(context);
  const result = made.generate(["--check"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`${CSS_OUTPUT}: missing`) && result.stderr.includes(`${DART_OUTPUT}: missing`), result.stderr);
});

test("an invalid graph leaves both outputs byte-identical", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  const bytes = outputBytes(made);
  writeFileSync(join(made.directory, "meta-frames-design-tokens/v2/tokens.json"), mutate(source, (tree) => { tokenAt(tree, canvas).$value = `{${surface}}`; }));
  const result = made.generate();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("same-layer edge"), result.stderr);
  assert.deepEqual(outputBytes(made), bytes);
  assert.equal(readdirSync(join(made.directory, "meta-frames-design-tokens")).includes(".build.lock"), false);
});

test("an existing lock fails the build and is not deleted", (context) => {
  const made = generateFixture(context);
  const lock = join(made.directory, "meta-frames-design-tokens/.build.lock");
  writeFileSync(lock, "");
  const result = made.generate();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("meta-frames-design-tokens/.build.lock"), result.stderr);
  assert.equal(readFileSync(lock, "utf8"), "");
  assert.throws(() => readFileSync(made.outputs.css));
  assert.throws(() => readFileSync(made.outputs.dart));
});

test("the lock is gone after a successful build", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  assert.equal(readdirSync(join(made.directory, "meta-frames-design-tokens")).includes(".build.lock"), false);
});

test("--inspect and --check do not take the lock", (context) => {
  const made = generateFixture(context);
  const lock = join(made.directory, "meta-frames-design-tokens/.build.lock");
  writeFileSync(lock, "");
  assert.equal(made.generate(["--inspect"]).status, 0);
  assert.equal(made.generate(["--check"]).status, 1);
  assert.ok(!made.generate(["--check"]).stderr.includes("lock"));
});

function faultFixture(context, body) {
  const made = generateFixture(context);
  const fault = join(made.directory, "fault.mjs");
  writeFileSync(fault, `import fs from "node:fs";\n${body}`);
  return { ...made, fault };
}

test("a failed second rename reports the error first, removes the temporary file and says to regenerate", (context) => {
  const made = faultFixture(context, `
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to.endsWith("design_tokens.g.dart")) throw new Error("simulated Dart rename failure");
      rename(from, to);
    };
  `);
  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split("\n")[0], `error: ${DART_OUTPUT}: write failed (simulated Dart rename failure)`);
  assert.match(result.stderr, /Pending temporary files removed/);
  assert.match(result.stderr, /Rerun node meta-frames-design-tokens\/build\.mjs, then --check/);
  assert.equal(readdirSync(dirname(made.outputs.dart)).length, 0);
  assert.equal(readdirSync(dirname(made.outputs.css)).length, 1);
  assert.equal(readdirSync(join(made.directory, "meta-frames-design-tokens")).includes(".build.lock"), false);
});

test("a cleanup failure is named after the original error", (context) => {
  const made = faultFixture(context, `
    const rename = fs.renameSync;
    const remove = fs.rmSync;
    fs.renameSync = (from, to) => {
      if (to.endsWith("design_tokens.g.dart")) throw new Error("simulated Dart rename failure");
      rename(from, to);
    };
    fs.rmSync = (target, options) => {
      if (String(target).includes("design_tokens.g.dart.tmp-")) throw new Error("simulated cleanup failure");
      remove(target, options);
    };
  `);
  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  const lines = result.stderr.split("\n");
  assert.equal(lines[0], `error: ${DART_OUTPUT}: write failed (simulated Dart rename failure)`);
  assert.match(result.stderr, /Could not remove these temporary files/);
  assert.match(result.stderr, /design_tokens\.g\.dart\.tmp-\d+: simulated cleanup failure/);
});

test("a missing destination directory fails before any write", (context) => {
  const made = generateFixture(context);
  rmSync(dirname(made.outputs.dart), { recursive: true });
  const result = made.generate();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`${DART_OUTPUT}: destination directory missing`), result.stderr);
  assert.throws(() => readFileSync(made.outputs.css));
});

test("rejects a public name that collides with a text-step companion", (context) => {
  rejectsInput(context, changeBindings((value) => {
    value.dashboard.colors.push({ properties: ["--text-xs--line-height"], source: canvas });
  }), "name collision: --text-xs--line-height is produced twice in the dashboard output");
});

test("rejects a scalar with no placement and a malformed text step name", (context) => {
  rejectsInput(context, changeBindings((value) => { value.dashboard.scalars["--gap"] = "semantic.space.gap.xs"; }), "bindings.json: dashboard binding --gap: no placement for this scalar");
  rejectsInput(context, changeBindings((value) => {
    value.dashboard.text["--size-xs"] = value.dashboard.text["--text-xs"];
    delete value.dashboard.text["--text-xs"];
  }), "bindings.json: dashboard binding --size-xs: a text step name must look like --text-<step>");
});

test("rejects a Dart font registration that is not a plain identifier", (context) => {
  rejectsInput(context, changeBindings((value) => { value.fonts.roles.mono.app = "Jet'Brains"; }), "bindings.json: fonts.roles.mono: app registration");
});

test("the source digest comes from the same read as the parse", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  assert.ok(String(readFileSync(made.outputs.dart)).includes(`sha256 ${sha(source)}`));
  const changed = mutate(source, (tree) => { tree.$description = "changed"; });
  writeFileSync(join(made.directory, "meta-frames-design-tokens/v2/tokens.json"), changed);
  assert.equal(made.generate().status, 0);
  assert.ok(String(readFileSync(made.outputs.dart)).includes(`sha256 ${sha(changed)}`));
});

test("a failure staging the second output preserves both live files", (context) => {
  const made = faultFixture(context, `
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (String(file).includes("design_tokens.g.dart.tmp-")) throw new Error("simulated second staging failure");
      write(file, ...args);
    };
  `);
  writeFileSync(made.outputs.css, "previous CSS");
  writeFileSync(made.outputs.dart, "previous Dart");
  const before = snapshot(made.directory);
  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.startsWith(`error: ${DART_OUTPUT}: write failed (simulated second staging failure)`));
  assert.deepEqual(snapshot(made.directory), before);
});

// ---- Slice 3 fix round 1 ----

for (const [name, change, expected] of [
  ["a dashboard output outside the planned path", (value) => { value.outputs.dashboard = "../meta-frames-dashboard/src/styles/other.css"; }, "bindings.json: outputs.dashboard:"],
  ["an app output outside the planned path", (value) => { value.outputs.app = "../meta-frames-app/lib/ui/core/other.dart"; }, "bindings.json: outputs.app:"],
  ["an output that leaves the workspace", (value) => { value.outputs.app = "../../elsewhere/design_tokens.g.dart"; }, "bindings.json: outputs.app:"],
  ["both outputs on one path", (value) => { value.outputs.dashboard = value.outputs.app; }, "bindings.json: outputs.dashboard and outputs.app resolve to the same path"],
  ["a missing output", (value) => { delete value.outputs.app; }, "bindings.json: outputs.app:"],
]) {
  test(`rejects ${name} in every mode and writes nothing`, (context) => {
    const made = generateFixture(context, changeBindings(change));
    mkdirSync(join(made.directory, "elsewhere"), { recursive: true });
    const before = snapshot(made.directory);
    for (const flags of [["--inspect"], ["--check"], []]) {
      const result = made.generate(flags);
      assert.equal(result.status, 1, `${flags} ${result.stderr}`);
      assert.ok(result.stderr.includes(`error: ${expected}`), result.stderr);
      assert.deepEqual(snapshot(made.directory), before, String(flags));
    }
  });
}

test("accepts a path segment named like a JavaScript word (undefined-gap)", (context) => {
  const made = generateFixture(context, changeSource((tree) => {
    tree.component.button["undefined-gap"] = tree.component.button.gap;
    delete tree.component.button.gap;
  }));
  const result = made.generate();
  assert.equal(result.status, 0, result.stderr);
  assert.match(String(readFileSync(made.outputs.css)), /--mf-component-button-undefined-gap: /);
  assert.match(String(readFileSync(made.outputs.dart)), /componentButtonUndefinedGap = /);
});

for (const segment of ["gap inline", "Gap", "gap_inline", "-gap", "gap-", "gap--inline", "gap;inline"]) {
  test(`rejects the path segment ${JSON.stringify(segment)} at the source, before any write`, (context) => {
    const made = generateFixture(context, changeSource((tree) => {
      tree.component.button[segment] = tree.component.button.gap;
      delete tree.component.button.gap;
    }));
    for (const flags of [["--inspect"], []]) {
      const result = made.generate(flags);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(`error: component.button: ambiguous path segment ${JSON.stringify(segment)}`), result.stderr);
    }
    assert.throws(() => readFileSync(made.outputs.css));
    assert.throws(() => readFileSync(made.outputs.dart));
  });
}

test("--check reports stale CSS together with a missing app directory", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  writeFileSync(made.outputs.css, `${readFileSync(made.outputs.css, "utf8")}/* edit */\n`);
  rmSync(dirname(made.outputs.dart), { recursive: true });
  const result = made.generate(["--check"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`error: ${CSS_OUTPUT}: stale or edited`), result.stderr);
  assert.ok(result.stderr.includes(`error: ${DART_OUTPUT}: missing`), result.stderr);
  assert.ok(!result.stderr.includes("destination directory missing"));
});

test("a failed close of the lock reports the close error and leaves no lock", (context) => {
  const made = faultFixture(context, `
    const open = fs.openSync;
    const close = fs.closeSync;
    let lockDescriptor;
    fs.openSync = (target, ...rest) => {
      const descriptor = open(target, ...rest);
      if (String(target).endsWith(".build.lock")) lockDescriptor = descriptor;
      return descriptor;
    };
    fs.closeSync = (descriptor) => {
      if (descriptor === lockDescriptor) throw new Error("simulated close failure");
      close(descriptor);
    };
  `);
  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("meta-frames-design-tokens/.build.lock: cannot close the lock (simulated close failure)"), result.stderr);
  assert.equal(readdirSync(join(made.directory, "meta-frames-design-tokens")).includes(".build.lock"), false);
  assert.throws(() => readFileSync(made.outputs.css));
});

const framedDigest = (named) => {
  const hash = createHash("sha256");
  const frame = (bytes) => {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length).update(bytes);
  };
  for (const [name, bytes] of [...named].sort(([left], [right]) => (left < right ? -1 : 1))) {
    frame(Buffer.from(name, "utf8"));
    frame(bytes);
  }
  return hash.digest("hex");
};

test("bindings that change after the startup read do not reach the digest or the output", (context) => {
  const made = faultFixture(context, `
    const read = fs.readFileSync;
    let changed = false;
    fs.readFileSync = (target, ...rest) => {
      const bytes = read(target, ...rest);
      if (!changed && String(target).endsWith("bindings.json")) {
        changed = true;
        fs.writeFileSync(target, String(bytes).replace('"source": "semantic.color.bg.canvas"', '"source": "semantic.color.bg.surface"'));
      }
      return bytes;
    };
  `);
  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 0, result.stderr);
  const css = String(readFileSync(made.outputs.css));
  assert.match(css, /--background: var\(--mf-semantic-color-bg-canvas\);/);
  const original = ["bindings.json", "build.mjs", "build.ts", "hooks.ts", "package-lock.json", "package.json", ".node-version"].map((name) => [name, Buffer.from(files[name])]);
  assert.equal(/Generator: sha256 ([0-9a-f]{64})/.exec(css)[1], framedDigest(original));
});

test("each generator input is read once during a generate run", (context) => {
  const made = faultFixture(context, `
    const read = fs.readFileSync;
    const names = [".node-version", "bindings.json", "build.mjs", "build.ts", "hooks.ts", "package-lock.json", "package.json"];
    const seen = [];
    fs.readFileSync = (target, ...rest) => {
      const name = String(target).split("/").pop();
      if (names.includes(name) && !String(target).includes("node_modules")) seen.push(name);
      return read(target, ...rest);
    };
    process.on("exit", () => fs.writeFileSync(process.env.READ_LOG, seen.join("\\n")));
  `);
  const log = join(made.directory, "reads.log");
  const result = spawnSync(process.execPath, ["--import", made.fault, made.script], { cwd: made.directory, encoding: "utf8", env: { ...process.env, READ_LOG: log } });
  assert.equal(result.status, 0, result.stderr);
  const reads = readFileSync(log, "utf8").split("\n");
  const count = (name) => reads.filter((read) => read === name).length;
  // The four data files are read once, by the startup snapshot. build.mjs, build.ts and hooks.ts are read
  // once by the snapshot and once by Node's module loader (the documented limit).
  for (const name of [".node-version", "bindings.json", "package-lock.json", "package.json"]) assert.equal(count(name), 1, name);
  for (const name of ["build.mjs", "build.ts", "hooks.ts"]) assert.ok(count(name) >= 1 && count(name) <= 2, name);
});

test("a Node without type stripping reports the entry error and writes nothing", (context) => {
  const made = generateFixture(context);
  const before = snapshot(made.directory);
  const result = spawnSync(process.execPath, ["--no-strip-types", made.script], { cwd: made.directory, encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.startsWith("error: meta-frames-design-tokens/.node-version: this Node cannot run TypeScript"), result.stderr);
  assert.doesNotMatch(result.stderr, /ERR_UNKNOWN_FILE_EXTENSION|\n\s+at /);
  assert.equal(result.stdout, "");
  assert.deepEqual(snapshot(made.directory), before);
  assert.throws(() => readFileSync(made.outputs.css));
  assert.throws(() => readFileSync(made.outputs.dart));
});

test("an unsupported extension in a later hook import keeps the runner diagnostic", (context) => {
  const { directory, script } = fixture(context, {
    "hooks.ts": 'await import("./unsupported.txt");\n' + files["hooks.ts"],
    "unsupported.txt": "",
  });
  const before = snapshot(directory);
  const result = run(script, directory, []);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /^error: TypeError \[ERR_UNKNOWN_FILE_EXTENSION\]:.*unsupported\.txt/m);
  assert.doesNotMatch(result.stderr, /this Node cannot run TypeScript/);
  assert.equal(result.stdout, "");
  assert.deepEqual(snapshot(directory), before);
});

test("rejects non-string and traversing destination values in every mode", (context) => {
  for (const target of [42, "../meta-frames-app/lib/ui/core/../theme.dart"]) {
    const made = generateFixture(context, changeBindings((value) => {
      value.outputs.app = target;
    }));
    const before = snapshot(made.directory);
    for (const flags of [["--inspect"], ["--check"], []]) {
      const result = made.generate(flags);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /bindings\.json: outputs\.app:/);
      assert.deepEqual(snapshot(made.directory), before);
    }
  }
});

test("does not overwrite a file reached through a linked destination directory", (context) => {
  const made = generateFixture(context);
  const redirect = join(made.directory, "redirected-app");
  const original = join(redirect, "design_tokens.g.dart");
  mkdirSync(redirect);
  writeFileSync(original, "unrelated file");
  rmSync(dirname(made.outputs.dart), { recursive: true });
  symlinkSync(redirect, dirname(made.outputs.dart), "dir");

  const result = made.generate();
  assert.ok(readFileSync(original, "utf8") === "unrelated file", "redirected file changed");
  assert.equal(result.status, 1);
});

test("rejects an invalid CSS public identifier before writing outputs", (context) => {
  const made = generateFixture(context, changeBindings((value) => {
    value.dashboard.colors[0].properties[0] = "--background undefined";
  }));
  const before = snapshot(made.directory);
  const result = made.generate();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--background undefined/);
  assert.deepEqual(snapshot(made.directory), before);
});

test("reports the cause of an input snapshot read failure", (context) => {
  const made = faultFixture(context, `
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
      if (String(file).endsWith("/bindings.json")) {
        throw Object.assign(new Error("simulated permission denial"), { code: "EACCES" });
      }
      return read(file, ...args);
    };
  `);
  const before = snapshot(made.directory);
  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bindings\.json:.*simulated permission denial/);
  assert.deepEqual(snapshot(made.directory), before);
});

// ---- Slice 3 fix round 2 ----

test("refuses a destination file that is a symbolic link and leaves its target alone", (context) => {
  const made = generateFixture(context);
  const target = join(made.directory, "elsewhere.dart");
  writeFileSync(target, "unrelated file");
  symlinkSync(target, made.outputs.dart);
  const result = made.generate();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`error: ${DART_OUTPUT}: destination is a symbolic link`), result.stderr);
  assert.equal(readFileSync(target, "utf8"), "unrelated file");
  assert.throws(() => readFileSync(made.outputs.css));
});

test("a linked destination directory gives an error that names both paths, and writes nothing", (context) => {
  const made = generateFixture(context);
  const redirect = join(made.directory, "redirected-css");
  mkdirSync(redirect);
  rmSync(dirname(made.outputs.css), { recursive: true });
  symlinkSync(redirect, dirname(made.outputs.css), "dir");
  const result = made.generate();
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`error: ${CSS_OUTPUT}: destination directory resolves to .*redirected-css, expected .*meta-frames-dashboard/src/styles`));
  assert.deepEqual(readdirSync(redirect), []);
  assert.deepEqual(readdirSync(dirname(made.outputs.dart)), []);
});

test("--check reports a linked destination directory as an error for that destination only", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  const redirect = join(made.directory, "redirected-app");
  mkdirSync(redirect);
  copyFileSync(made.outputs.dart, join(redirect, "design_tokens.g.dart"));
  rmSync(dirname(made.outputs.dart), { recursive: true });
  symlinkSync(redirect, dirname(made.outputs.dart), "dir");
  const result = made.generate(["--check"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`error: ${DART_OUTPUT}: destination directory resolves to`), result.stderr);
  assert.ok(!result.stderr.includes(`${CSS_OUTPUT}:`));
});

test("an ordinary destination tree passes the link checks", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  assert.equal(made.generate(["--check"]).status, 0);
});

for (const name of ["--Background", "--a_b", "--a;b", "--a--b", "--", "-a", "--a b", "--a:b"]) {
  test(`rejects the dashboard public name ${JSON.stringify(name)} before writing`, (context) => {
    const made = generateFixture(context, changeBindings((value) => {
      value.dashboard.colors[0].properties[0] = name;
    }));
    const before = snapshot(made.directory);
    for (const flags of [["--inspect"], []]) {
      const result = made.generate(flags);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(`bindings.json: dashboard public name ${JSON.stringify(name)}`), result.stderr);
    }
    assert.deepEqual(snapshot(made.directory), before);
  });
}

test("rejects a font role property and a scalar that are not valid custom property names", (context) => {
  const roleMade = generateFixture(context, changeBindings((value) => { value.fonts.roles.mono.dashboard.property = "--font mono"; }));
  assert.ok(roleMade.generate().stderr.includes('bindings.json: dashboard public name "--font mono"'));
  const scalarMade = generateFixture(context, changeBindings((value) => { value.dashboard.scalars["--Radius"] = value.dashboard.scalars["--radius"]; delete value.dashboard.scalars["--radius"]; }));
  assert.ok(scalarMade.generate().stderr.includes('bindings.json: dashboard public name "--Radius"'));
});

for (const [file, label] of [[".node-version", "Node pin"], ["package-lock.json", "lockfile"], ["package.json", "manifest"]]) {
  test(`reports the cause when the ${label} cannot be read (not "missing")`, (context) => {
    const made = faultFixture(context, `
      const read = fs.readFileSync;
      fs.readFileSync = (target, ...rest) => {
        if (String(target).endsWith("/${file}") && !String(target).includes("node_modules")) {
          throw Object.assign(new Error("simulated permission denial"), { code: "EACCES" });
        }
        return read(target, ...rest);
      };
    `);
    const before = snapshot(made.directory);
    const result = made.generate(["--inspect"], ["--import", made.fault]);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`error: meta-frames-design-tokens/${file}: cannot read (simulated permission denial)`), result.stderr);
    assert.doesNotMatch(result.stderr, /missing/);
    assert.deepEqual(snapshot(made.directory), before);
  });
}

test("a missing file is still reported as missing, with no read error", (context) => {
  rejectsInput(context, { "package-lock.json": null }, "meta-frames-design-tokens/package-lock.json: file missing");
});

test("generates and checks through a linked checkout root", (context) => {
  const made = generateFixture(context);
  const checkout = join(made.directory, "meta-frames-app");
  const linkedCheckout = join(made.directory, "linked-app-checkout");
  mkdirSync(join(linkedCheckout, "lib/ui/core"), { recursive: true });
  rmSync(checkout, { recursive: true });
  symlinkSync(linkedCheckout, checkout, "dir");

  const result = made.generate();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(made.outputs.dart), readFileSync(join(linkedCheckout, "lib/ui/core/design_tokens.g.dart")));
  const check = made.generate(["--check"]);
  assert.equal(check.status, 0, check.stderr);
});

test("--check reports a linked output and a missing peer without reading the link", (context) => {
  const made = generateFixture(context);
  const target = join(made.directory, "linked-directory");
  mkdirSync(target);
  symlinkSync(target, made.outputs.css, "dir");

  const result = made.generate(["--check"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`error: ${CSS_OUTPUT}: destination is a symbolic link`), result.stderr);
  assert.ok(result.stderr.includes(`error: ${DART_OUTPUT}: missing`), result.stderr);
});

test("rejects an empty font-role public property before writing outputs", (context) => {
  const made = generateFixture(context, changeBindings((value) => {
    value.fonts.roles.mono.dashboard.property = "";
  }));
  const before = snapshot(made.directory);
  const result = made.generate();
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(snapshot(made.directory), before);
});

test("does not write outside the checkout if the destination parent changes during staging", (context) => {
  const made = faultFixture(context, `
    import path from "node:path";
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (String(file).includes("design_tokens.g.dart.tmp-")) {
        if (!fs.existsSync(path.resolve("meta-frames-design-tokens/.build.lock"))) throw new Error("expected a held build lock");
        const parent = path.dirname(file);
        fs.renameSync(parent, parent + "-saved");
        fs.symlinkSync(path.resolve("redirected"), parent, "dir");
      }
      return write(file, ...args);
    };
  `);
  const redirect = join(made.directory, "redirected");
  const original = join(redirect, "design_tokens.g.dart");
  mkdirSync(redirect);
  writeFileSync(original, "unrelated file");

  const result = made.generate([], ["--import", made.fault]);
  assert.ok(readFileSync(original, "utf8") === "unrelated file", "redirected file changed");
  assert.equal(result.status, 1);
});

test("--check reports an unreadable output with its cause and still checks the peer", (context) => {
  const made = generateFixture(context);
  assert.equal(made.generate().status, 0);
  chmodSync(made.outputs.css, 0o000);
  rmSync(made.outputs.dart);

  const result = made.generate(["--check"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`error: ${CSS_OUTPUT}: cannot read (EACCES`), result.stderr);
  assert.ok(result.stderr.includes(`error: ${DART_OUTPUT}: missing`), result.stderr);
});

test("generate reports a destination read error before replacing either output", (context) => {
  const made = faultFixture(context, `
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
      if (String(file).endsWith("/design-tokens.generated.css")) {
        throw Object.assign(new Error("simulated permission denial"), { code: "EACCES" });
      }
      return read(file, ...args);
    };
  `);
  writeFileSync(made.outputs.css, "prior CSS");
  writeFileSync(made.outputs.dart, "prior Dart");
  const before = snapshot(made.directory);

  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes(`error: ${CSS_OUTPUT}: cannot read (simulated permission denial)`), result.stderr);
  assert.deepEqual(snapshot(made.directory), before);
});

test("reports any staged file left in a parent moved before the second link check", (context) => {
  const made = faultFixture(context, `
    import path from "node:path";
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      write(file, ...args);
      if (String(file).includes("design_tokens.g.dart.tmp-")) {
        const parent = path.dirname(file);
        fs.renameSync(parent, parent + "-saved");
        fs.symlinkSync(path.resolve("redirected"), parent, "dir");
      }
    };
  `);
  const redirect = join(made.directory, "redirected");
  mkdirSync(redirect);
  const existing = join(redirect, "design_tokens.g.dart");
  writeFileSync(existing, "unrelated file");
  writeFileSync(made.outputs.css, "prior CSS");
  writeFileSync(made.outputs.dart, "prior Dart");

  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(existing, "utf8"), "unrelated file");
  assert.equal(readFileSync(made.outputs.css, "utf8"), "prior CSS");
  const movedParent = `${dirname(made.outputs.dart)}-saved`;
  assert.equal(readFileSync(join(movedParent, "design_tokens.g.dart"), "utf8"), "prior Dart");
  for (const file of readdirSync(movedParent).filter((name) => name.includes(".tmp-"))) {
    assert.ok(result.stderr.includes(`core-saved/${file}`), `unreported staging file ${file}\n${result.stderr}`);
  }
});

test("names a staged file whose parent moved out of reach before the second link check", (context) => {
  const made = faultFixture(context, `
    import path from "node:path";
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      write(file, ...args);
      if (String(file).includes("design_tokens.g.dart.tmp-")) {
        fs.renameSync(path.dirname(file), path.resolve("elsewhere"));
      }
    };
  `);
  writeFileSync(made.outputs.css, "prior CSS");
  writeFileSync(made.outputs.dart, "prior Dart");

  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(made.outputs.css, "utf8"), "prior CSS");
  const left = readdirSync(join(made.directory, "elsewhere")).filter((name) => name.includes(".tmp-"));
  assert.equal(left.length, 1);
  assert.ok(result.stderr.includes(`its directory moved after staging; find ${left[0]} and delete it`), result.stderr);
  assert.doesNotMatch(result.stderr, /Pending temporary files removed/);
});

test("cleanup preserves a same-named file that the generator did not stage", (context) => {
  const made = faultFixture(context, `
    import path from "node:path";
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (String(file).includes("design_tokens.g.dart.tmp-")) {
        write(file, "unrelated file");
        const parent = path.dirname(file);
        fs.renameSync(parent, parent + "-saved");
        fs.symlinkSync(path.resolve("redirected"), parent, "dir");
      }
      return write(file, ...args);
    };
  `);
  const redirect = join(made.directory, "redirected");
  mkdirSync(redirect);
  writeFileSync(made.outputs.css, "prior CSS");
  writeFileSync(made.outputs.dart, "prior Dart");

  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(made.outputs.css, "utf8"), "prior CSS");
  const movedParent = `${dirname(made.outputs.dart)}-saved`;
  const foreignTemp = readdirSync(movedParent).find((name) => name.startsWith("design_tokens.g.dart.tmp-"));
  assert.ok(foreignTemp, "cleanup removed a file it did not stage");
  assert.equal(readFileSync(join(movedParent, foreignTemp), "utf8"), "unrelated file");
  for (const file of readdirSync(redirect).filter((name) => name.includes(".tmp-"))) {
    assert.ok(result.stderr.includes(`redirected/${file}`), `unreported staging file ${file}\n${result.stderr}`);
  }
});

test("a replacement parent directory stops generation before either rename", (context) => {
  const made = faultFixture(context, `
    import path from "node:path";
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      write(file, ...args);
      if (String(file).includes("design_tokens.g.dart.tmp-")) {
        const parent = path.dirname(file);
        fs.renameSync(parent, parent + "-saved");
        fs.mkdirSync(parent);
      }
    };
  `);
  writeFileSync(made.outputs.css, "prior CSS");
  writeFileSync(made.outputs.dart, "prior Dart");

  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.ok(readFileSync(made.outputs.css, "utf8") === "prior CSS", "CSS was replaced before the app staging path was checked");
  assert.equal(readFileSync(join(`${dirname(made.outputs.dart)}-saved`, "design_tokens.g.dart"), "utf8"), "prior Dart");
});

test("a same-named file at the staging path is not overwritten or deleted", (context) => {
  const made = generateFixture(context);
  writeFileSync(made.outputs.css, "prior CSS");
  writeFileSync(made.outputs.dart, "prior Dart");
  const fault = join(made.directory, "fault.mjs");
  writeFileSync(fault, `import fs from "node:fs";
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (String(file).includes("design_tokens.g.dart.tmp-")) write(file, "foreign file");
      return write(file, ...args);
    };
  `);

  const result = made.generate([], ["--import", fault]);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(made.outputs.css, "utf8"), "prior CSS");
  const foreign = readdirSync(dirname(made.outputs.dart)).filter((name) => name.includes(".tmp-"));
  assert.equal(foreign.length, 1);
  assert.equal(readFileSync(join(dirname(made.outputs.dart), foreign[0]), "utf8"), "foreign file");
  assert.ok(result.stderr.includes("it is not the file this run staged"), result.stderr);
});

test("a staging identity read failure stops both renames and names the pending file", (context) => {
  const made = faultFixture(context, `
    const lstat = fs.lstatSync;
    fs.lstatSync = (file, ...args) => {
      if (String(file).includes("design_tokens.g.dart.tmp-")) {
        throw Object.assign(new Error("simulated staging stat failure"), { code: "EIO" });
      }
      return lstat(file, ...args);
    };
  `);
  writeFileSync(made.outputs.css, "prior CSS");
  writeFileSync(made.outputs.dart, "prior Dart");
  const before = outputBytes(made);

  const result = made.generate([], ["--import", made.fault]);
  assert.equal(result.status, 1);
  assert.match(result.stderr.split("\n")[0], /simulated staging stat failure/);
  assert.deepEqual(outputBytes(made), before);
  assert.ok(!readdirSync(dirname(made.outputs.css)).some((name) => name.includes(".tmp-")));
  const pending = readdirSync(dirname(made.outputs.dart)).find((name) => name.startsWith("design_tokens.g.dart.tmp-"));
  assert.ok(pending, "the file without a recorded identity must stay for manual cleanup");
  assert.ok(result.stderr.includes(`Could not remove these temporary files. Delete them by hand:\n  meta-frames-app/lib/ui/core/${pending}`), result.stderr);
});
