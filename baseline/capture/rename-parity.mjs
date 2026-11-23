// Disposable. Slice 3b parity check for the foundation colour rename.
// Run: node design-tokens/baseline/capture/rename-parity.mjs <savedDir>
// savedDir holds the pre-rename tokens.json, config.json, design-tokens.generated.css,
// design_tokens.g.dart and inspect.txt. The new files are read from the workspace.
import { deepStrictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const workspace = path.resolve(import.meta.dirname, "../../..");
const savedDir = path.resolve(process.argv[2]);
const failures = { table: [], value: [], consumer: [], name: [], count: [], other: [] };
const fail = (kind, message) => failures[kind].push(message);

const readSaved = (name) => readFileSync(path.join(savedDir, name), "utf8");
const readNew = (relativePath) => readFileSync(path.join(workspace, relativePath), "utf8");
const oldTokens = JSON.parse(readSaved("tokens.json"));
const oldConfig = JSON.parse(readSaved("config.json"));
const newTokens = JSON.parse(readNew("design-tokens/tokens.json"));
const newConfig = JSON.parse(readNew("design-tokens/config.json"));
const oldCss = readSaved("design-tokens.generated.css");
const oldDart = readSaved("design_tokens.g.dart");
const newCss = readNew("meta-frames-dashboard/src/styles/design-tokens.generated.css");
const newDart = readNew("meta-frames-app/lib/ui/core/design_tokens.g.dart");

// ---- table ----
const spec = readNew("docs/ai-workflow/spec-design-tokens.md");
const rows = [];
for (const line of spec.split("\n")) {
  const cells = line.split("|").map((cell) => cell.trim());
  const oldMatch = cells[1]?.match(/^`(color\.(?:neutral|brand)\.[^`]+)`$/);
  if (!oldMatch) continue;
  const strip = (cell) => cell.replaceAll("`", "");
  rows.push({
    oldPath: oldMatch[1],
    newPath: strip(cells[2]),
    css: strip(cells[5]),
    dart: strip(cells[6]).replace(/^DesignTokens\./, ""),
  });
}
if (rows.length !== 61) fail("table", `table has ${rows.length} rows, expected 61`);

// ---- leaves ----
function flatten(node, trail = [], leaves = new Map(), inheritedType) {
  const type = node.$type ?? inheritedType;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    if ("$value" in child) leaves.set([...trail, key].join("."), child);
    else flatten(child, [...trail, key], leaves, type);
  }
  return leaves;
}
const oldLeaves = flatten(oldTokens);
const newLeaves = flatten(newTokens);
const oldColours = new Set([...oldLeaves.keys()].filter((key) => key.startsWith("color.")));
const newColours = new Set([...newLeaves.keys()].filter((key) => key.startsWith("color.")));
const tableOld = new Set(rows.map((row) => row.oldPath));
const tableNew = new Set(rows.map((row) => row.newPath));

for (const row of rows) {
  if (!oldLeaves.has(row.oldPath)) fail("table", `old path not in old source: ${row.oldPath}`);
  if (!newLeaves.has(row.newPath)) fail("table", `new path not in new source: ${row.newPath}`);
}
for (const key of oldColours) if (!tableOld.has(key)) fail("table", `old leaf not in table: ${key}`);
for (const key of newColours) if (!tableNew.has(key)) fail("table", `new leaf not in table: ${key}`);
if (tableOld.size !== rows.length) fail("table", "two table rows share an old path");
if (tableNew.size !== rows.length) fail("table", "two old paths map to one new path");
for (const key of oldLeaves.keys()) {
  if (!key.startsWith("color.") && !newLeaves.has(key)) fail("table", `non-colour leaf lost: ${key}`);
}

// ---- values (deep equality of the whole leaf object) ----
for (const row of rows) {
  try {
    deepStrictEqual(newLeaves.get(row.newPath), oldLeaves.get(row.oldPath));
  } catch {
    fail("value", `${row.oldPath} -> ${row.newPath}: leaf object differs`);
  }
}
for (const key of oldLeaves.keys()) {
  if (key.startsWith("color.")) continue;
  try {
    deepStrictEqual(newLeaves.get(key), oldLeaves.get(key));
  } catch {
    fail("value", `${key}: non-colour leaf changed`);
  }
}

// ---- consumers and membership ----
const map = new Map(rows.map((row) => [row.oldPath, row.newPath]));
try {
  deepStrictEqual(newConfig.outputs, oldConfig.outputs);
} catch {
  fail("consumer", "config outputs changed");
}
for (const target of ["dashboard", "app"]) {
  const oldMembers = oldConfig.targets[target];
  const newMembers = newConfig.targets[target];
  for (const [oldKey, consumers] of Object.entries(oldMembers)) {
    const mapped = map.get(oldKey) ?? oldKey;
    if (!(mapped in newMembers)) {
      fail("consumer", `${target}: membership lost for ${oldKey} -> ${mapped}`);
      continue;
    }
    try {
      deepStrictEqual(newMembers[mapped], consumers);
    } catch {
      fail("consumer", `${target}: consumer list differs for ${oldKey} -> ${mapped}`);
    }
  }
  const expectedKeys = new Set(Object.keys(oldMembers).map((key) => map.get(key) ?? key));
  for (const key of Object.keys(newMembers)) {
    if (!expectedKeys.has(key)) fail("consumer", `${target}: new membership ${key}`);
  }
  if (Object.keys(newMembers).length !== Object.keys(oldMembers).length) {
    fail("consumer", `${target}: member count changed`);
  }
}

// ---- generated names and values ----
const cssName = (leafPath) => `--mf-${leafPath.replaceAll(".", "-")}`;
const dartName = (leafPath) =>
  leafPath
    .split(".")
    .flatMap((segment) => segment.split("-"))
    .map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join("");
const parseCss = (text) =>
  new Map([...text.matchAll(/^ {2}(--mf-[a-z0-9-]+): ([^;]+);$/gm)].map((match) => [match[1], match[2]]));
const parseDart = (text) =>
  new Map(
    [...text.matchAll(/static const (Color|double|String) (\w+) =\s+([^;]+);/g)].map((match) => [
      match[2],
      match[3],
    ]),
  );
const oldCssMap = parseCss(oldCss);
const newCssMap = parseCss(newCss);
const oldDartMap = parseDart(oldDart);
const newDartMap = parseDart(newDart);

for (const row of rows) {
  const dashboardMember = row.newPath in newConfig.targets.dashboard;
  const appMember = row.newPath in newConfig.targets.app;
  const wantCss = cssName(row.newPath);
  const wantDart = dartName(row.newPath);
  if (row.css === "—") {
    if (dashboardMember) fail("name", `${row.newPath}: table has a dash but the dashboard emits it`);
    if (newCssMap.has(wantCss)) fail("name", `${row.newPath}: unexpected CSS property ${wantCss}`);
  } else {
    if (row.css !== wantCss) fail("name", `${row.newPath}: table CSS ${row.css}, derived ${wantCss}`);
    if (!dashboardMember) fail("name", `${row.newPath}: table names a CSS property but not a dashboard member`);
    if (!newCssMap.has(row.css)) fail("name", `${row.newPath}: CSS property ${row.css} missing`);
  }
  if (row.dart === "—") {
    if (appMember) fail("name", `${row.newPath}: table has a dash but the app emits it`);
    if (newDartMap.has(wantDart)) fail("name", `${row.newPath}: unexpected Dart field ${wantDart}`);
  } else {
    if (row.dart !== wantDart) fail("name", `${row.newPath}: table Dart ${row.dart}, derived ${wantDart}`);
    if (!appMember) fail("name", `${row.newPath}: table names a Dart field but not an app member`);
    if (!newDartMap.has(row.dart)) fail("name", `${row.newPath}: Dart field ${row.dart} missing`);
  }
  // values by mapped name, compared as text
  if (row.css !== "—" && oldCssMap.get(cssName(row.oldPath)) !== newCssMap.get(row.css)) {
    fail("value", `${row.oldPath} -> ${row.css}: CSS value ${oldCssMap.get(cssName(row.oldPath))} -> ${newCssMap.get(row.css)}`);
  }
  if (row.dart !== "—" && oldDartMap.get(dartName(row.oldPath)) !== newDartMap.get(row.dart)) {
    fail("value", `${row.oldPath} -> ${row.dart}: Dart value ${oldDartMap.get(dartName(row.oldPath))} -> ${newDartMap.get(row.dart)}`);
  }
}
// every non-colour value by name
for (const [name, value] of oldCssMap) {
  if (!name.startsWith("--mf-color-") && newCssMap.get(name) !== value) fail("value", `CSS ${name} changed`);
}
for (const [name, value] of oldDartMap) {
  if (!name.startsWith("color") && newDartMap.get(name) !== value) fail("value", `Dart ${name} changed`);
}

// ---- counts ----
for (const [label, actual, expected] of [
  ["old leaves", oldLeaves.size, 90],
  ["new leaves", newLeaves.size, 90],
  ["old CSS properties", oldCssMap.size, 54],
  ["new CSS properties", newCssMap.size, 54],
  ["old Dart fields", oldDartMap.size, 44],
  ["new Dart fields", newDartMap.size, 44],
]) {
  if (actual !== expected) fail("count", `${label}: ${actual}, expected ${expected}`);
}

// ---- non-colour lines of the generated files ----
const withoutColours = (text, colourPattern) =>
  text
    .split("\n")
    .filter((line) => !colourPattern.test(line) && !/(Source: design-tokens\/tokens\.json .*|Generator: .*) sha256 [0-9a-f]{64}( of .*)?$/.test(line) && !/Generator: sha256 /.test(line))
    .join("\n");
if (withoutColours(oldCss, /^ {2}--mf-color-/) !== withoutColours(newCss, /^ {2}--mf-color-/)) {
  fail("other", "CSS non-colour lines changed");
}
if (withoutColours(oldDart, /^ {2}static const Color /) !== withoutColours(newDart, /^ {2}static const Color /)) {
  fail("other", "Dart non-colour lines changed");
}
// The generator digest hashes build.mjs + config.json + .node-version, and config.json is renamed in
// this slice, so the digest must change. Check it equals the recomputed value, and that build.mjs
// and .node-version are untouched.
const generatorLine = (text) => text.match(/Generator: sha256 ([0-9a-f]{64})/)[1];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const inputs = ["build.mjs", "config.json", ".node-version"].map((name) => readFileSync(path.join(workspace, "design-tokens", name)));
const recomputed = sha256(Buffer.concat(inputs));
if (generatorLine(newCss) !== recomputed || generatorLine(newDart) !== recomputed) {
  fail("other", "generator digest in a header does not equal the recomputed build.mjs + config.json + .node-version digest");
}
if (!sha256(inputs[0]).startsWith("377ad4ebfe63")) fail("other", "build.mjs changed (expected sha256 prefix 377ad4ebfe63)");
if (generatorLine(oldCss) === generatorLine(newCss)) fail("other", "generator digest did not change although config.json did");

// ---- inspect output per leaf, under the new paths ----
function parseInspect(text) {
  const blocks = new Map();
  let fields;
  for (const line of text.trimEnd().split("\n")) {
    if (!line.startsWith(" ")) {
      fields = {};
      blocks.set(line, fields);
    } else {
      const separator = line.indexOf(":");
      fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return blocks;
}
const inspectRun = spawnSync(process.execPath, [path.join(workspace, "design-tokens/build.mjs"), "--inspect"], { encoding: "utf8" });
const oldInspect = parseInspect(readSaved("inspect.txt"));
const newInspect = parseInspect(inspectRun.stdout);
for (const [oldKey, fields] of oldInspect) {
  const mapped = map.get(oldKey) ?? oldKey;
  try {
    deepStrictEqual(newInspect.get(mapped), fields);
  } catch {
    fail("other", `inspect view differs: ${oldKey} -> ${mapped}`);
  }
}
if (newInspect.size !== oldInspect.size) fail("count", "inspect block count changed");

// ---- summary ----
const total = Object.values(failures).flat().length;
for (const [kind, messages] of Object.entries(failures)) for (const message of messages) console.error(`${kind}: ${message}`);
console.log(
  `${rows.length} mapped, ${failures.value.length} value changes, ${failures.consumer.length} consumer changes, ${failures.name.length} name mismatches` +
    ` (table ${failures.table.length}, count ${failures.count.length}, other ${failures.other.length})`,
);
process.exit(total ? 1 : 0);
