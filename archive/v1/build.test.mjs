import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const source = read("tokens.json");
const configSource = read("config.json");
const generator = read("build.mjs");
const pin = read(".node-version");
const spec = read("../docs/ai-workflow/spec-design-tokens.md");
const tokenAt = (tokens, path) => path.split(".").reduce((group, key) => group[key], tokens);
const run = (file, cwd) => spawnSync(process.execPath, [file, "--inspect"], { cwd, encoding: "utf8" });

function specPalette() {
  const rows = [];
  for (const line of spec.split("\n")) {
    const cells = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    if (cells.length !== 5 || !/^(gray\.|olive\.|orange\.|sand\.|local$)/.test(cells[1])) continue;
    for (const index of [1, 3]) {
      if (cells[index] !== "local") rows.push(["color." + cells[index], cells[index + 1]]);
    }
  }
  return rows;
}

function decodeOklch(css) {
  const [lightness, chroma, hue = 0] = css.match(/^oklch\(([^)]+)\)/)[1]
    .split(" / ")[0].split(" ").map((component) => component === "none" ? 0 : Number(component));
  const radians = hue * Math.PI / 180;
  const axisA = chroma * Math.cos(radians);
  const axisB = chroma * Math.sin(radians);
  const long = (lightness + 0.3963377774 * axisA + 0.2158037573 * axisB) ** 3;
  const medium = (lightness - 0.1055613458 * axisA - 0.0638541728 * axisB) ** 3;
  const short = (lightness - 0.0894841775 * axisA - 1.2914855480 * axisB) ** 3;
  // Direct OKLab to linear sRGB matrix, independent of the generator's XYZ path.
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short,
  ].map((channel) => {
    const linear = Math.min(1, Math.max(0, channel));
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  });
}

const dashboardSizes = "xs sm base lg xl 2xl 3xl 4xl 5xl 6xl 7xl 8xl 9xl".split(" ");
const appSizes = "p10-5 p11 p11-5 p12 p12-5 p13 p19".split(" ");

test("inspect matches the spec palette, dimensions, fonts and consumers", () => {
  const tokens = JSON.parse(source);
  const config = JSON.parse(configSource);
  const result = run(join(import.meta.dirname, "build.mjs"), tmpdir());
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const blocks = new Map();
  let fields;
  for (const line of result.stdout.trimEnd().split("\n")) {
    if (!line.startsWith(" ")) {
      fields = {};
      blocks.set(line, fields);
    } else {
      const separator = line.indexOf(":");
      fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }

  const palette = specPalette();
  assert.equal(palette.filter(([, value]) => !value.startsWith("oklch")).length, 67);
  const expectedPaths = new Set(["color.gray.288"]);
  palette.push(["color.gray.288", "0xFFA1A1AA"]);
  for (const [path, value] of palette) {
    expectedPaths.add(path);
    const token = tokenAt(tokens, path).$value;
    const preview = blocks.get(path);
    if (value.startsWith("oklch")) {
      const [lightness, chroma, hue, alpha = 100] = value.match(/[\d.]+/g).map(Number);
      assert.deepEqual(token, { colorSpace: "oklch", components: [lightness, chroma, hue], alpha: alpha / 100 }, path);
      const css = chroma === 0 ? preview.css.replace(" 0 none", " 0 0") : preview.css;
      assert.equal(css, value + "  [source as authored]", path);
    } else {
      const argb = value.startsWith("#") ? "0xFF" + value.slice(1).toUpperCase() : value;
      const [alpha, ...components] = argb.slice(2).match(/../g).map((byte) => parseInt(byte, 16) / 255);
      assert.deepEqual(token, { colorSpace: "srgb", components, alpha }, path);
      assert.equal(preview.argb, argb + "  [exact]", path);
      assert.deepEqual(decodeOklch(preview.css), components.map((component) => Math.round(component * 255)), path);
    }
  }
  assert.match(blocks.get("color.orange.435-a45").css, / \/ 45%\)/);
  assert.match(blocks.get("color.orange.354").argb, /CLIPPED.*b=-/);

  const dimensions = {
    "radius.paper": [0.45, "rem"],
    "radius.surface": [4, "px"],
    "radius.stamp": [2, "px"],
    "spacing.step": [0.25, "rem"],
    "spacing.s20": [20, "px"],
    "spacing.s14": [14, "px"],
  };
  for (const [names, values, unit] of [
    [dashboardSizes, [0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.875, 2.25, 3, 3.75, 4.5, 6, 8], "rem"],
    [appSizes, [10.5, 11, 11.5, 12, 12.5, 13, 19], "px"],
  ]) {
    names.forEach((name, index) => { dimensions["type.size." + name] = [values[index], unit]; });
  }
  for (const [path, [value, unit]] of Object.entries(dimensions)) {
    expectedPaths.add(path);
    assert.deepEqual(tokenAt(tokens, path).$value, { value, unit }, path);
    assert.equal(blocks.get(path).value, value + unit, path);
    if (config.targets.dashboard[path]) assert.equal(unit, "rem", path);
  }

  for (const [name, value, dart, css] of [
    ["space-grotesk", "Space Grotesk", "SpaceGrotesk", { family: "Space Grotesk Variable", fallback: ["ui-sans-serif", "sans-serif"] }],
    ["geist-mono", "Geist Mono", "GeistMono", { family: "Geist Mono Variable", fallback: ["ui-monospace", "monospace"] }],
    ["jetbrains-mono", "JetBrains Mono", "JetBrainsMono"],
  ]) {
    const path = "font.family." + name;
    expectedPaths.add(path);
    const metadata = { dart: { family: dart }, ...(css ? { css } : {}) };
    assert.deepEqual(tokenAt(tokens, path), { $value: value, $extensions: { "com.metaframes": metadata } }, path);
  }
  assert.deepEqual(new Set(blocks.keys()), expectedPaths);
  for (const [path, preview] of blocks) {
    const consumers = Object.entries(config.targets).flatMap(([target, members]) =>
      members[path] ? [target + ": " + members[path].join(", ")] : [],
    );
    assert.ok(consumers.length, path);
    assert.equal(preview.consumers, consumers.join(" | "), path);
  }
});

function generatorFixture(context, changes) {
  const directory = mkdtempSync(join(tmpdir(), "mf-token-test-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const tools = join(directory, "design-tokens");
  mkdirSync(tools);
  for (const [name, content] of Object.entries({
    "build.mjs": generator,
    "tokens.json": source,
    "config.json": configSource,
    ".node-version": pin,
    ...changes,
  })) {
    if (content !== null) writeFileSync(join(tools, name), content);
  }
  return { directory, tools, script: join(tools, "build.mjs") };
}

function rejectsInput(context, changes, expected) {
  const { directory, script } = generatorFixture(context, changes);
  const result = run(script, directory);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr || "unexpected successful exit");
  assert.ok(result.stderr.includes("error: " + expected), result.stderr);
  assert.doesNotMatch(result.stderr, /TypeError:/);
}

const mutate = (json, change) => {
  const value = JSON.parse(json);
  change(value);
  return JSON.stringify(value);
};
const changeTokens = (change) => ({ "tokens.json": mutate(source, change) });
const changeConfig = (change) => ({ "config.json": mutate(configSource, change) });

for (const [name, changes, expected] of [
  ["missing source", { "tokens.json": null }, "design-tokens/tokens.json: source missing"],
  ["invalid JSON", { "tokens.json": "{" }, "design-tokens/tokens.json: invalid JSON"],
  ["wrong type", changeTokens((tokens) => { tokens.radius.paper.$type = "color"; }), "radius.paper: wrong $type"],
  ["invalid unit", changeTokens((tokens) => { tokens.radius.paper.$value.unit = "em"; }), "radius.paper: invalid unit"],
  ["duplicate path", { "tokens.json": source.replace('"435":', '"435": {}, "435":') }, "color.orange.435: duplicate path"],
  ["missing member", changeConfig((config) => { config.targets.dashboard["color.orange.missing"] = ["probe"]; }), "color.orange.missing: targets.dashboard entry does not resolve"],
  ["empty consumers", changeConfig((config) => { config.targets.dashboard["radius.paper"] = []; }), "radius.paper: targets.dashboard consumers must be"],
  ["unconsumed leaf", changeConfig((config) => { delete config.targets.dashboard["radius.paper"]; }), "radius.paper: leaf is not consumed"],
  ["dashboard px dimension", changeTokens((tokens) => { tokens.radius.paper.$value.unit = "px"; }), "radius.paper: dashboard dimension must use unit rem"],
  ["dashboard RGB round trip", changeTokens((tokens) => { tokens.color.orange["190"].$value.components = [0, 184 / 255, 193 / 255]; }), "color.orange.190: oklch round trip fails"],
  ["missing Node pin", { ".node-version": null }, "design-tokens/.node-version: Node pin file missing"],
  ["Node pin mismatch", { ".node-version": "0.0.0\n" }, "design-tokens/.node-version: needs Node 0.0.0"],
  ["falsy source root", { "tokens.json": "false" }, "design-tokens/tokens.json: root must be an object"],
  ["falsy config root", { "config.json": "null" }, "design-tokens/config.json: root must be an object"],
  ["missing dashboard font registration", changeTokens((tokens) => { delete tokens.font.family["geist-mono"].$extensions["com.metaframes"].css; }), "font.family.geist-mono:"],
  ["null CSS font metadata", changeTokens((tokens) => { tokens.font.family["geist-mono"].$extensions["com.metaframes"].css = null; }), "font.family.geist-mono:"],
]) {
  test("rejects " + name, (context) => rejectsInput(context, changes, expected));
}

for (const [target, family, name] of [["dashboard", "gray", "0-a05"], ["app", "gray", "790"]]) {
  test("rejects generated " + target + " name collisions", (context) => {
    // a name without a hyphen splits after its first digit: 790 collides with 7.90
    const [first, second] = name.includes("-") ? name.split("-") : [name.slice(0, 1), name.slice(1)];
    const collision = "color." + family + "." + first + "." + second;
    rejectsInput(context, {
      ...changeTokens((tokens) => { tokens.color[family][first] = { [second]: tokens.color[family][name] }; }),
      ...changeConfig((config) => { config.targets[target][collision] = ["probe"]; }),
    }, collision + ": generated " + target + " name");
  });
}

test("rejects an invalid hyphen sequence in a Dart member name", (context) => {
  rejectsInput(context, {
    ...changeTokens((tokens) => { tokens.color.orange["190-"] = tokens.color.orange["190"]; }),
    ...changeConfig((config) => { config.targets.app["color.orange.190-"] = ["probe"]; }),
  }, "color.orange.190-:");
});

for (const extensions of [null, []]) {
  const shape = extensions === null ? "null" : "array";
  test("rejects " + shape + " font extensions", (context) => {
    rejectsInput(context, changeTokens((tokens) => {
      tokens.font.family["geist-mono"].$extensions = extensions;
    }), "font.family.geist-mono:");
  });
  test("rejects " + shape + " colour extensions", (context) => {
    rejectsInput(context, changeTokens((tokens) => {
      tokens.color.orange["435"].$extensions = extensions;
    }), "color.orange.435:");
  });
}

for (const [field, value] of [["fallback", []], ["family", ""]]) {
  test("rejects an empty dashboard font " + field, (context) => {
    rejectsInput(context, changeTokens((tokens) => {
      tokens.font.family["geist-mono"].$extensions["com.metaframes"].css[field] = value;
    }), "font.family.geist-mono:");
  });
}

test("rejects a numeric JSON member name before collecting paths", (context) => {
  rejectsInput(context, {
    "tokens.json": source.replace('"435":', '17:'),
  }, "design-tokens/tokens.json: invalid JSON");
});

test("rejects a membership array containing a numeric path segment", (context) => {
  rejectsInput(context, changeConfig((config) => {
    config.targets.dashboard = [["color", "orange", 17]];
  }), "targets.dashboard:");
});

function emitterFixture(context, changes) {
  const { directory, tools, script } = generatorFixture(context, changes);
  const targets = Object.values(JSON.parse(configSource).outputs).map((path) => ({
    path: resolve(tools, path),
    name: path.slice(3),
  }));
  for (const { path } of targets) mkdirSync(dirname(path), { recursive: true });
  return {
    directory,
    targets,
    emit: (flags = [], nodeFlags = []) => spawnSync(process.execPath, [...nodeFlags, script, ...flags], {
      cwd: directory,
      encoding: "utf8",
    }),
  };
}

function expectSuccess(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

test("emits CSS and Dart samples and regenerates identical bytes", (context) => {
  const { targets: [css, dart], emit } = emitterFixture(context, changeTokens((tokens) => {
    tokens.color.gray["33"].$value.alpha = 128 / 255;
  }));
  expectSuccess(emit());
  const snapshot = [css, dart].map(({ path }) => readFileSync(path));
  for (const line of [
    '--mf-color-orange-435: oklch(0.565 0.178 37);',
    '--mf-color-orange-190: oklch(0.8098 0.1228 53.07);',
    '--mf-color-orange-435-a45: oklch(0.565 0.178 37 / 45%);',
    '--mf-radius-paper: 0.45rem;',
    '--mf-font-family-space-grotesk: "Space Grotesk Variable";',
  ]) assert.ok(snapshot[0].includes(line), line);
  for (const line of [
    'static const Color colorOrange190 = Color(0xFFFFAA73);',
    'static const Color colorGray33 = Color(0x80F4F4F5);',
    'static const double radiusSurface = 4.0;',
    "static const String fontFamilySpaceGrotesk = 'SpaceGrotesk';",
  ]) assert.ok(snapshot[1].includes(line), line);
  expectSuccess(emit(["--check"]));
  for (const { path } of [css, dart]) rmSync(path);
  expectSuccess(emit());
  assert.deepEqual([css, dart].map(({ path }) => readFileSync(path)), snapshot);
});

for (const [name, change] of [
  ["a missing file", () => null],
  ["a one-byte change", (text) => text.replace("GENERATED FILE", "gENERATED FILE")],
  ["extra trailing bytes", (text) => text + "\n "],
  ["a CRLF line ending", (text) => text.replace("\n", "\r\n")],
]) {
  test("--check reports " + name + " for either target and writes nothing", (context) => {
    const { targets, emit } = emitterFixture(context);
    expectSuccess(emit());
    const originals = targets.map(({ path }) => readFileSync(path, "utf8"));
    for (const [index, target] of targets.entries()) {
      const altered = change(originals[index]);
      if (altered === null) rmSync(target.path);
      else writeFileSync(target.path, altered);
      const result = emit(["--check"]);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes("error: " + target.name + ": " + (altered === null ? "missing" : "differs")));
      if (altered === null) assert.throws(() => readFileSync(target.path), { code: "ENOENT" });
      else assert.equal(readFileSync(target.path, "utf8"), altered);
      assert.equal(readFileSync(targets[1 - index].path, "utf8"), originals[1 - index]);
      writeFileSync(target.path, originals[index]);
    }
  });
}

for (const [name, changes, diagnostic] of [
  ["dashboard px", changeTokens((tokens) => { tokens.radius.paper.$value.unit = "px"; }), "radius.paper: dashboard dimension"],
  ["app rem", changeTokens((tokens) => { tokens.radius.surface.$value.unit = "rem"; }), "radius.surface: app dimension"],
  ["app OKLCH", changeConfig((config) => { config.targets.app["color.orange.435"] = ["probe"]; }), "color.orange.435: app colour is OKLCH-only"],
  ["app fractional alpha byte", changeTokens((tokens) => { tokens.color.gray["33"].$value.alpha = 0.45; }), "color.gray.33: app colour alpha or channel"],
]) {
  test("writes neither target when validation rejects " + name, (context) => {
    const { targets, emit } = emitterFixture(context, changes);
    for (const { path, name } of targets) writeFileSync(path, name);
    const result = emit();
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes("error: " + diagnostic), result.stderr);
    for (const { path, name } of targets) {
      assert.equal(readFileSync(path, "utf8"), name);
      assert.deepEqual(readdirSync(dirname(path)), [name.split("/").at(-1)]);
    }
  });
}

test("removes pending temporary files after a rename fails", (context) => {
  const { directory, targets, emit } = emitterFixture(context);
  const fault = join(directory, "fail-rename.mjs");
  writeFileSync(fault, `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to.endsWith("design_tokens.g.dart")) throw new Error("simulated Dart rename failure");
      rename(from, to);
    };
    syncBuiltinESMExports();
  `);
  const result = emit([], ["--import", fault]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /simulated Dart rename failure/);
  for (const { path } of targets) {
    assert.equal(readdirSync(dirname(path)).filter((name) => name.includes(".tmp-")).length, 0, path);
  }
});

test("reports the rename failure first and continues after a cleanup failure", (context) => {
  const { directory, targets: [css, dart], emit } = emitterFixture(context);
  const fault = join(directory, "fail-rename-and-cleanup.mjs");
  writeFileSync(fault, `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const rename = fs.renameSync;
    const remove = fs.rmSync;
    fs.renameSync = (from, to) => {
      if (to.endsWith("design-tokens.generated.css")) throw new Error("simulated CSS rename failure");
      rename(from, to);
    };
    fs.rmSync = (path, options) => {
      if (path.includes("design-tokens.generated.css.tmp-")) throw new Error("simulated CSS temp removal failure");
      remove(path, options);
    };
    syncBuiltinESMExports();
  `);
  const result = emit([], ["--import", fault]);
  assert.equal(result.status, 1, result.stderr);
  const [first, heading, cleanup, recovery] = result.stderr.trimEnd().split("\n");
  assert.equal(first, "error: " + css.name + ": write failed (simulated CSS rename failure)");
  assert.match(heading, /^Could not remove these temporary files\./);
  const remaining = readdirSync(dirname(css.path));
  assert.equal(remaining.length, 1);
  assert.match(remaining[0], /^design-tokens\.generated\.css\.tmp-\d+$/);
  assert.equal(cleanup, "  " + join(dirname(css.name), remaining[0]) + ": simulated CSS temp removal failure");
  assert.equal(recovery, "Rerun node design-tokens/build.mjs, then --check.");
  assert.deepEqual(readdirSync(dirname(dart.path)), []);
});
