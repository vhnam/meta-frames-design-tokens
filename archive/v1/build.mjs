// Design token generator: validates tokens.json (beside this file) against config.json, prints
// every token with --inspect, writes both generated files, and verifies them with --check.
// Node standard library only. Run from anywhere: all paths resolve from this file.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const scriptDir = import.meta.dirname;
// This script lives in the untracked workspace directory design-tokens/. The repositories are its
// siblings: ../meta-frames-dashboard and ../meta-frames-app.
const workspaceRoot = path.resolve(scriptDir, "..");
const tokensFile = path.join(scriptDir, "tokens.json");
const configFile = path.join(scriptDir, "config.json");
const nodeVersionFile = path.join(scriptDir, ".node-version");
const scriptFile = path.join(scriptDir, "build.mjs");

const TARGETS = ["dashboard", "app"];
const EXPECTED_TYPE = {
  color: "color",
  radius: "dimension",
  spacing: "dimension",
  type: "dimension",
  font: "fontFamily",
};
const UNITS = ["px", "rem"];
const COLOR_SPACES = ["oklch", "srgb"];
// Hyphen-separated words: no leading, trailing or double hyphen (an empty word breaks Dart names).
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTENSION_KEY = "com.metaframes";
// Channels further out of gamut than this (after sRGB encoding) are flagged. Below it is rounding noise.
// Precision of the OKLCH tuple the dashboard emitter writes for an sRGB source (decimals).
const EMIT_DECIMALS = { lightness: 4, chroma: 4, hue: 2 };
const GAMUT_EPSILON = 1e-6;
const ACHROMATIC_CHROMA = 1e-6;

const relative = (file) => path.relative(workspaceRoot, file);
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

// ---- startup ----

function assertNodeVersion() {
  if (!existsSync(nodeVersionFile)) {
    console.error(`error: ${relative(nodeVersionFile)}: Node pin file missing`);
    process.exit(1);
  }
  const pin = readFileSync(nodeVersionFile, "utf8").trim();
  if (process.version !== `v${pin}`) {
    console.error(
      `error: ${relative(nodeVersionFile)}: needs Node ${pin}, running ${process.version}`,
    );
    process.exit(1);
  }
}

// ---- JSON with duplicate-key detection (JSON.parse keeps only the last duplicate) ----

/** Returns the dotted path of every object key that appears twice. Input must be valid JSON. */
function findDuplicateKeys(text) {
  const duplicates = [];
  let position = 0;
  const skipSpace = () => {
    while (" \t\r\n".includes(text[position])) position += 1;
  };
  const readString = () => {
    const start = position;
    position += 1;
    while (text[position] !== '"') position += text[position] === "\\" ? 2 : 1;
    position += 1;
    return JSON.parse(text.slice(start, position));
  };
  const readValue = (trail) => {
    skipSpace();
    const opener = text[position];
    if (opener === "{") {
      position += 1;
      const seen = new Set();
      skipSpace();
      if (text[position] === "}") {
        position += 1;
        return;
      }
      for (;;) {
        skipSpace();
        const key = readString();
        const childTrail = [...trail, key];
        if (seen.has(key)) duplicates.push(childTrail.join("."));
        seen.add(key);
        skipSpace();
        position += 1; // ":"
        readValue(childTrail);
        skipSpace();
        const separator = text[position];
        position += 1;
        if (separator === "}") return;
      }
    } else if (opener === "[") {
      position += 1;
      skipSpace();
      if (text[position] === "]") {
        position += 1;
        return;
      }
      for (;;) {
        readValue(trail);
        skipSpace();
        const separator = text[position];
        position += 1;
        if (separator === "]") return;
      }
    } else if (opener === '"') {
      readString();
    } else {
      while (!",}] \t\r\n".includes(text[position]) && position < text.length) position += 1;
    }
  };
  readValue([]);
  return duplicates;
}

function readJson(file, label, errors) {
  if (!existsSync(file)) {
    errors.push(`${relative(file)}: ${label} missing`);
    return null;
  }
  const text = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    errors.push(`${relative(file)}: invalid JSON (${error.message})`);
    return null;
  }
  if (!isObject(parsed)) {
    errors.push(`${relative(file)}: root must be an object`);
    return null;
  }
  for (const duplicate of findDuplicateKeys(text)) {
    errors.push(`${duplicate}: duplicate path in ${relative(file)}`);
  }
  return parsed;
}

// ---- token validation ----

function validateColor(leafPath, value, errors) {
  if (!isObject(value)) return errors.push(`${leafPath}: color value must be an object`);
  if (!COLOR_SPACES.includes(value.colorSpace)) {
    return errors.push(
      `${leafPath}: unsupported colorSpace ${JSON.stringify(value.colorSpace)} (accepted: ${COLOR_SPACES.join(", ")})`,
    );
  }
  const { components, alpha } = value;
  if (!Array.isArray(components) || components.length !== 3 || !components.every(isNumber)) {
    return errors.push(`${leafPath}: components must be three finite numbers`);
  }
  if (!isNumber(alpha) || alpha < 0 || alpha > 1) {
    errors.push(`${leafPath}: alpha must be a number from 0 to 1`);
  }
  if (value.colorSpace === "srgb" && components.some((channel) => channel < 0 || channel > 1)) {
    errors.push(`${leafPath}: srgb components must be from 0 to 1`);
  }
  if (value.colorSpace === "oklch") {
    const [lightness, chroma, hue] = components;
    if (lightness < 0 || lightness > 1) errors.push(`${leafPath}: oklch lightness must be 0 to 1`);
    if (chroma < 0) errors.push(`${leafPath}: oklch chroma must not be negative`);
    if (hue < 0 || hue > 360) errors.push(`${leafPath}: oklch hue must be 0 to 360`);
  }
}

function validateDimension(leafPath, value, errors) {
  if (!isObject(value)) return errors.push(`${leafPath}: dimension value must be an object`);
  if (!UNITS.includes(value.unit)) {
    errors.push(
      `${leafPath}: invalid unit ${JSON.stringify(value.unit)} (accepted: ${UNITS.join(", ")})`,
    );
  }
  if (!isNumber(value.value)) errors.push(`${leafPath}: dimension value must be a finite number`);
}

function validateFontFamily(leafPath, value, extensions, errors) {
  const names = Array.isArray(value) ? value : [value];
  if (!names.length || !names.every((name) => typeof name === "string" && name)) {
    errors.push(`${leafPath}: fontFamily value must be a non-empty string or list of strings`);
  }
  const meta = extensions?.[EXTENSION_KEY];
  if (typeof meta?.dart?.family !== "string" || !meta.dart.family) {
    errors.push(`${leafPath}: $extensions.${EXTENSION_KEY}.dart.family missing`);
  }
  const css = meta?.css;
  if (css !== undefined && !isObject(css)) {
    errors.push(`${leafPath}: $extensions.${EXTENSION_KEY}.css must be an object`);
  } else if (css !== undefined) {
    const fallback = css.fallback;
    if (typeof css.family !== "string" || !css.family) {
      errors.push(`${leafPath}: $extensions.${EXTENSION_KEY}.css.family must be a string`);
    }
    if (!Array.isArray(fallback) || !fallback.every((name) => typeof name === "string")) {
      errors.push(`${leafPath}: $extensions.${EXTENSION_KEY}.css.fallback must be a string list`);
    }
  }
}

/** $extensions, when declared on any group or leaf, must be a plain object. */
function extensionsShapeOk(node, nodePath, errors) {
  if (!("$extensions" in node) || isObject(node.$extensions)) return true;
  errors.push(`${nodePath}: $extensions must be an object`);
  return false;
}

/** Walks the DTCG tree. Returns Map(path -> { type, value, extensions }). */
function collectLeaves(tokens, errors) {
  const leaves = new Map();
  const walk = (node, trail, inheritedType) => {
    const here = trail.join(".");
    const type = node.$type ?? inheritedType;
    extensionsShapeOk(node, here || relative(tokensFile), errors);
    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith("$")) continue;
      const childPath = [...trail, name].join(".");
      if (!NAME_PATTERN.test(name)) {
        errors.push(`${childPath}: invalid name (lowercase letters and digits in hyphen-separated words; no leading, trailing or double hyphen)`);
        continue;
      }
      if (!isObject(child)) {
        errors.push(`${childPath}: must be a group or a token object`);
        continue;
      }
      if ("$value" in child) {
        collectLeaf(childPath, child, child.$type ?? type);
      } else {
        walk(child, [...trail, name], type);
      }
    }
    if (here && !Object.keys(node).some((name) => !name.startsWith("$"))) {
      errors.push(`${here}: empty group`);
    }
  };
  const collectLeaf = (leafPath, leaf, type) => {
    const rootName = leafPath.split(".")[0];
    const expected = EXPECTED_TYPE[rootName];
    if (!expected) return errors.push(`${leafPath}: unknown top-level group ${rootName}`);
    leaves.set(leafPath, { type, value: leaf.$value, extensions: leaf.$extensions });
    const extensionsOk = extensionsShapeOk(leaf, leafPath, errors);
    if (type !== expected) {
      return errors.push(
        `${leafPath}: wrong $type ${JSON.stringify(type)}, expected "${expected}"`,
      );
    }
    if (type === "color") validateColor(leafPath, leaf.$value, errors);
    if (type === "dimension") validateDimension(leafPath, leaf.$value, errors);
    if (type === "fontFamily" && extensionsOk) {
      validateFontFamily(leafPath, leaf.$value, leaf.$extensions, errors);
    }
  };
  if (!isObject(tokens)) {
    errors.push(`${relative(tokensFile)}: root must be an object`);
    return leaves;
  }
  walk(tokens, [], undefined);
  return leaves;
}

// ---- config validation ----

const cssName = (leafPath) => `--mf-${leafPath.replaceAll(".", "-")}`;
const dartName = (leafPath) =>
  leafPath
    .split(".")
    .flatMap((segment) => segment.split("-"))
    .map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join("");

/** Returns { outputs, targets } where targets[target] is Map(leafPath -> consumers[]). */
function loadConfig(leaves, errors) {
  const config = readJson(configFile, "config", errors);
  const targets = { dashboard: new Map(), app: new Map() };
  const outputs = {};
  if (!config) return { outputs, targets };
  for (const target of TARGETS) {
    const output = config.outputs?.[target];
    if (typeof output !== "string" || !output) {
      errors.push(`outputs.${target}: output path missing in ${relative(configFile)}`);
    } else {
      outputs[target] = output;
    }
    const members = config.targets?.[target];
    if (!isObject(members)) {
      errors.push(`targets.${target}: missing in ${relative(configFile)}`);
      continue;
    }
    for (const [leafPath, consumers] of Object.entries(members)) {
      if (!leaves.has(leafPath)) {
        errors.push(
          `${leafPath}: targets.${target} entry does not resolve to a leaf in ${relative(tokensFile)}`,
        );
        continue;
      }
      if (
        !Array.isArray(consumers) ||
        !consumers.length ||
        !consumers.every((item) => typeof item === "string" && item)
      ) {
        errors.push(`${leafPath}: targets.${target} consumers must be a non-empty string list`);
        continue;
      }
      targets[target].set(leafPath, consumers);
    }
  }
  for (const leafPath of leaves.keys()) {
    if (!TARGETS.some((target) => targets[target].has(leafPath))) {
      errors.push(`${leafPath}: leaf is not consumed by any target in ${relative(configFile)}`);
    }
  }
  if (!errors.length) checkDashboardRules(leaves, targets.dashboard, errors);
  checkCollisions("dashboard", targets.dashboard, cssName, errors);
  checkCollisions("app", targets.app, dartName, errors);
  return { outputs, targets };
}

/** Nam decision 8: dashboard dimensions are rem, dashboard sRGB colours survive the OKLCH round trip. */
function checkDashboardRules(leaves, members, errors) {
  for (const leafPath of members.keys()) {
    const { type, value } = leaves.get(leafPath);
    if (type === "dimension" && value.unit !== "rem") {
      errors.push(`${leafPath}: dashboard dimension must use unit rem, found ${value.unit}`);
    }
    if (type === "fontFamily") {
      const css = leaves.get(leafPath).extensions?.[EXTENSION_KEY]?.css;
      if (!css?.family || !css.fallback?.length || css.fallback.some((name) => !name)) {
        errors.push(
          `${leafPath}: dashboard fontFamily needs $extensions.${EXTENSION_KEY}.css with a family and a non-empty fallback list`,
        );
      }
    }
    if (type === "color" && value.colorSpace === "srgb") {
      const { tuple, got, want } = roundTrip(value.components);
      if (got.some((byte, index) => byte !== want[index])) {
        errors.push(
          `${leafPath}: oklch round trip fails at ${JSON.stringify(EMIT_DECIMALS)} decimals: tuple ${cssOklch(tuple, 1)} gives bytes ${got.join(",")}, source bytes ${want.join(",")}`,
        );
      }
    }
  }
}

function checkCollisions(target, members, toName, errors) {
  const owners = new Map();
  for (const leafPath of members.keys()) {
    const name = toName(leafPath);
    const first = owners.get(name);
    if (first) {
      errors.push(`${leafPath}: generated ${target} name ${name} collides with ${first}`);
    } else {
      owners.set(name, leafPath);
    }
  }
}

// ---- CSS Color 4 conversions (full precision, no intermediate rounding) ----

const LINEAR_SRGB_TO_XYZ = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LINEAR_SRGB = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const XYZ_TO_LMS = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LMS_TO_XYZ = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const OKLAB_TO_LMS = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];

const multiply = (matrix, vector) =>
  matrix.map((row) => row.reduce((sum, weight, index) => sum + weight * vector[index], 0));
const toLinear = (channel) => {
  const magnitude = Math.abs(channel);
  const linear = magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4;
  return Math.sign(channel) * linear;
};
const fromLinear = (channel) => {
  const magnitude = Math.abs(channel);
  const encoded =
    magnitude > 0.0031308 ? 1.055 * magnitude ** (1 / 2.4) - 0.055 : 12.92 * magnitude;
  return Math.sign(channel) * encoded;
};
const roundHalfUp = (value) => Math.floor(value + 0.5);

/** sRGB (nonlinear 0..1) -> [L, C, H] with full precision. */
function srgbToOklch(srgb) {
  const xyz = multiply(LINEAR_SRGB_TO_XYZ, srgb.map(toLinear));
  const lms = multiply(XYZ_TO_LMS, xyz).map(Math.cbrt);
  const [lightness, axisA, axisB] = multiply(LMS_TO_OKLAB, lms);
  const chroma = Math.hypot(axisA, axisB);
  const hue = ((Math.atan2(axisB, axisA) * 180) / Math.PI + 360) % 360;
  return [lightness, chroma, hue];
}

/** [L, C, H] -> nonlinear sRGB channels, not clipped, may lie outside 0..1. */
function oklchToSrgb([lightness, chroma, hue]) {
  const radians = (hue * Math.PI) / 180;
  const lab = [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
  const lms = multiply(OKLAB_TO_LMS, lab).map((channel) => channel ** 3);
  const xyz = multiply(LMS_TO_XYZ, lms);
  return multiply(XYZ_TO_LINEAR_SRGB, xyz).map(fromLinear);
}

const percent = (alpha) => Number((alpha * 100).toPrecision(12));
// Tuples that are authored or emitted keep their numeric hue. Only a derived preview of an
// achromatic sRGB colour (hue is numeric noise) may print "none".
const cssOklch = ([lightness, chroma, hue], alpha, powerlessHue = false) => {
  const hueText = powerlessHue && chroma < ACHROMATIC_CHROMA ? "none" : String(hue);
  const alphaText = alpha === 1 ? "" : ` / ${percent(alpha)}%`;
  return `oklch(${lightness} ${chroma} ${hueText}${alphaText})`;
};

/** The OKLCH tuple the dashboard emitter writes for an sRGB source, at EMIT_DECIMALS. */
function emittedTuple(srgb) {
  const [lightness, chroma, hue] = srgbToOklch(srgb);
  const round = (value, decimals) => Number(value.toFixed(decimals));
  const roundedChroma = round(chroma, EMIT_DECIMALS.chroma);
  const roundedHue = roundedChroma === 0 ? 0 : round(hue, EMIT_DECIMALS.hue) % 360;
  return [round(lightness, EMIT_DECIMALS.lightness), roundedChroma, roundedHue];
}

const toBytes = (srgb) =>
  srgb.map((channel) => roundHalfUp(Math.min(1, Math.max(0, channel)) * 255));

/** Bytes after tuple -> sRGB -> round half up, next to the source bytes. */
function roundTrip(srgb) {
  const tuple = emittedTuple(srgb);
  return { tuple, got: toBytes(oklchToSrgb(tuple)), want: toBytes(srgb) };
}

/** Both previews for one colour leaf. Neither is build input. */
function colorViews({ colorSpace, components, alpha }, dashboardMember) {
  let srgb;
  let oklch;
  let cssView;
  let flags;
  const notes = [];
  if (colorSpace === "srgb") {
    srgb = components;
    if (dashboardMember) {
      oklch = emittedTuple(components);
      cssView = `${cssOklch(oklch, alpha)}  [emitted tuple at ${JSON.stringify(EMIT_DECIMALS)}; round trip to source bytes ok]`;
    } else {
      oklch = srgbToOklch(components);
      cssView = `${cssOklch(oklch, alpha, true)}  [derived from srgb source, not emitted]`;
    }
  } else {
    srgb = oklchToSrgb(components);
    oklch = components;
    cssView = `${cssOklch(components, alpha)}  [source as authored]`;
    notes.push("converted from oklch");
  }
  const outOfGamut = srgb
    .map((channel, index) => ({ name: "rgb"[index], channel }))
    .filter(({ channel }) => channel < -GAMUT_EPSILON || channel > 1 + GAMUT_EPSILON);
  const bytes = srgb.map((channel) => roundHalfUp(Math.min(1, Math.max(0, channel)) * 255));
  const alphaByte = roundHalfUp(alpha * 255);
  const exact = (value) => Math.abs(value - roundHalfUp(value)) < 1e-9;
  const quantized = !(srgb.every((channel) => exact(channel * 255)) && exact(alpha * 255));
  if (quantized && colorSpace === "srgb") notes.push("quantized");
  if (colorSpace === "oklch") notes.push("quantized to bytes");
  if (outOfGamut.length) {
    flags = outOfGamut.map(({ name, channel }) => `${name}=${channel}`).join(", ");
    notes.push(`CLIPPED, out of sRGB gamut before clipping: ${flags}`);
  }
  const hex = [alphaByte, ...bytes]
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join("");
  if (alpha < 1 && !exact(alpha * 255))
    notes.push(`alpha ${alpha} -> byte ${alphaByte} (not exact)`);
  const argbView = `0x${hex}  [${notes.length ? notes.join("; ") : "exact"}]`;
  return { cssView, argbView };
}

// ---- inspect ----

function inspect(leaves, targets) {
  for (const [leafPath, leaf] of leaves) {
    const consumers = TARGETS.filter((target) => targets[target].has(leafPath)).map(
      (target) => `${target}: ${targets[target].get(leafPath).join(", ")}`,
    );
    console.log(leafPath);
    console.log(`  type:      ${leaf.type}`);
    console.log(`  consumers: ${consumers.join(" | ")}`);
    if (leaf.type === "color") {
      const { cssView, argbView } = colorViews(leaf.value, targets.dashboard.has(leafPath));
      console.log(`  css:       ${cssView}`);
      console.log(`  argb:      ${argbView}`);
    } else if (leaf.type === "dimension") {
      console.log(`  value:     ${leaf.value.value}${leaf.value.unit}`);
    } else {
      const meta = leaf.extensions[EXTENSION_KEY];
      console.log(`  value:     ${[leaf.value].flat().join(", ")}`);
      if (meta.css) {
        console.log(`  css:       "${meta.css.family}", ${meta.css.fallback.join(", ")}`);
      }
      console.log(`  dart:      ${meta.dart.family}`);
    }
  }
}

// ---- emitters ----

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const isExactByte = (value) => Math.abs(value - Math.round(value)) < 1e-9;

/** One digest over the generator inputs, in this order: build.mjs, config.json, .node-version. */
const generatorDigest = () =>
  sha256(Buffer.concat([scriptFile, configFile, nodeVersionFile].map((file) => readFileSync(file))));

const headerLines = (sourceDigest) => [
  "GENERATED FILE. DO NOT EDIT.",
  "Source: design-tokens/tokens.json (not in Git), sha256 " + sourceDigest,
  "Generator: sha256 " +
    generatorDigest() +
    " of design-tokens/build.mjs, config.json and .node-version, in that order",
  "Regenerate: node design-tokens/build.mjs. Verify: node design-tokens/build.mjs --check",
];

function cssValue(leaf) {
  const { type, value, extensions } = leaf;
  if (type === "dimension") return `${value.value}${value.unit}`;
  if (type === "fontFamily") return `"${extensions[EXTENSION_KEY].css.family}"`;
  if (value.colorSpace === "oklch") return cssOklch(value.components, value.alpha);
  return cssOklch(emittedTuple(value.components), value.alpha);
}

function emitCss(leaves, members, sourceDigest) {
  const lines = [
    "/*",
    ...headerLines(sourceDigest).map((line) => ` * ${line}`),
    " */",
    "",
    ":root {",
  ];
  for (const [leafPath, leaf] of leaves) {
    if (members.has(leafPath)) lines.push(`  ${cssName(leafPath)}: ${cssValue(leaf)};`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

const dartDouble = (number) => (Number.isInteger(number) ? `${number}.0` : String(number));

/** Returns the Dart type and initializer for a leaf, or null after pushing an error. */
function dartField(leafPath, leaf, errors) {
  const { type, value, extensions } = leaf;
  if (type === "fontFamily") {
    return ["String", `'${extensions[EXTENSION_KEY].dart.family}'`];
  }
  if (type === "dimension") {
    if (value.unit !== "px") {
      errors.push(`${leafPath}: app dimension must use unit px, found ${value.unit}`);
      return null;
    }
    return ["double", dartDouble(value.value)];
  }
  if (value.colorSpace !== "srgb") {
    errors.push(`${leafPath}: app colour is OKLCH-only, no exact Dart colour`);
    return null;
  }
  const bytes = value.components.map((channel) => channel * 255);
  if (!bytes.every(isExactByte) || !isExactByte(value.alpha * 255)) {
    errors.push(`${leafPath}: app colour alpha or channel is not an exact byte`);
    return null;
  }
  const hex = [value.alpha * 255, ...bytes]
    .map((byte) => Math.round(byte).toString(16).toUpperCase().padStart(2, "0"))
    .join("");
  return ["Color", `Color(0x${hex})`];
}

function emitDart(leaves, members, sourceDigest, errors) {
  const fields = [];
  for (const [leafPath, leaf] of leaves) {
    if (!members.has(leafPath)) continue;
    const field = dartField(leafPath, leaf, errors);
    if (field) fields.push(`  static const ${field[0]} ${dartName(leafPath)} = ${field[1]};`);
  }
  return [
    ...headerLines(sourceDigest).map((line) => `// ${line}`),
    "",
    "import 'dart:ui' show Color;",
    "",
    "abstract final class DesignTokens {",
    // dart format breaks a statement longer than 80 columns after the "="
    ...fields.map((line) => {
      if (line.length <= 80) return line;
      const split = line.indexOf(" = ");
      return `${line.slice(0, split + 2)}\n      ${line.slice(split + 3)}`;
    }),
    "}",
    "",
  ].join("\n");
}

/** Builds both outputs in memory. Returns [{ file, text }] and pushes errors without throwing. */
function buildOutputs(leaves, targets, outputs, errors) {
  const sourceDigest = sha256(readFileSync(tokensFile));
  const dart = emitDart(leaves, targets.app, sourceDigest, errors);
  const css = emitCss(leaves, targets.dashboard, sourceDigest);
  return [
    { file: path.resolve(scriptDir, outputs.dashboard), text: css },
    { file: path.resolve(scriptDir, outputs.app), text: dart },
  ];
}

function compareWithDisk(files) {
  return files.map(({ file, text }) => {
    if (!existsSync(file)) return { file, state: "missing" };
    return { file, state: readFileSync(file, "utf8") === text ? "same" : "differs" };
  });
}

/**
 * Temp file next to each target, then rename over it (atomic per file). On any failure every temp
 * file not yet renamed is removed, the failing file is named, and the process exits 1. A file
 * renamed before the failure is not rolled back (spec: per-file replacement), so the message tells
 * the user to rerun the generator and --check.
 */
function writeOutputs(files) {
  const pending = files.map(({ file, text }) => ({ file, text, temp: `${file}.tmp-${process.pid}` }));
  let failing;
  try {
    for (const entry of pending) {
      failing = entry.file;
      writeFileSync(entry.temp, entry.text, "utf8");
    }
    for (const entry of pending) {
      failing = entry.file;
      renameSync(entry.temp, entry.file);
      entry.temp = null;
    }
  } catch (error) {
    console.error(`error: ${relative(failing)}: write failed (${error.message})`);
    const stuck = [];
    for (const { temp } of pending) {
      if (!temp) continue;
      try {
        rmSync(temp, { force: true });
      } catch (removeError) {
        stuck.push(`${relative(temp)}: ${removeError.message}`);
      }
    }
    if (stuck.length) {
      console.error("Could not remove these temporary files. Delete them by hand:");
      for (const line of stuck) console.error(`  ${line}`);
    } else {
      console.error("Pending temporary files removed.");
    }
    console.error("Rerun node design-tokens/build.mjs, then --check.");
    process.exit(1);
  }
}

// ---- main ----

function main() {
  assertNodeVersion();
  const flags = process.argv.slice(2);
  const known = ["--inspect", "--check"];
  const unknown = flags.filter((flag) => !known.includes(flag));
  if (unknown.length || flags.length > 1) {
    console.error(
      `usage: node build.mjs [--inspect | --check]  (unknown: ${unknown.join(" ") || "extra flags"})`,
    );
    process.exit(2);
  }

  const errors = [];
  const tokens = readJson(tokensFile, "source", errors);
  const leaves = tokens ? collectLeaves(tokens, errors) : new Map();
  const { targets, outputs } = tokens ? loadConfig(leaves, errors) : { targets: null };
  const files =
    !errors.length && flags[0] !== "--inspect" ? buildOutputs(leaves, targets, outputs, errors) : [];
  if (errors.length) {
    for (const message of errors) console.error(`error: ${message}`);
    console.error(`${errors.length} error(s). Nothing written.`);
    process.exit(1);
  }
  if (flags[0] === "--inspect") {
    inspect(leaves, targets);
    return;
  }
  const states = compareWithDisk(files);
  if (flags[0] === "--check") {
    const bad = states.filter(({ state }) => state !== "same");
    for (const { file, state } of bad) console.error(`error: ${relative(file)}: ${state}`);
    if (bad.length) process.exit(1);
    console.log(`ok: ${states.length} generated files match`);
    return;
  }
  writeOutputs(files);
  for (const { file, state } of states) {
    console.log(`${state === "same" ? "unchanged" : "wrote"} ${relative(file)}`);
  }
}

main();
