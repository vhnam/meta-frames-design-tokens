// Style Dictionary hooks and validators for meta-frames-design-tokens/v2/tokens.json.
// Source profile, reference graph, mode projection, bindings checks, native value transforms and
// the CSS and Dart formats (one fragment per mode). No file writes: build.mjs owns the filesystem.
import StyleDictionary from "style-dictionary";

export const MODES = ["light", "dark"];
export const LAYERS = ["primitive", "semantic", "component"];
const MODE_KEY = "com.metaframes.modes";
const TYPES = ["color", "dimension", "fontFamily", "fontWeight", "number", "duration", "cubicBezier"];
const META_KEYS = ["$type", "$value", "$description", "$extensions"];
// Every path segment becomes part of a CSS custom property and a Dart identifier.
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WHOLE_REFERENCE = /^\{([^{}]+)\}$/;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const inRange = (value, low, high) => isNumber(value) && value >= low && value <= high;

// ---- leaf index ----

/** Walks the tree. Returns Map(path -> { path, layer, type, value, extensions }). */
export function collectLeaves(tree, errors) {
  const leaves = new Map();
  const walk = (node, trail, inheritedType) => {
    const type = node.$type ?? inheritedType;
    for (const [name, child] of Object.entries(node)) {
      const parent = trail.join(".") || "(root)";
      if (name.startsWith("$")) {
        if (!META_KEYS.includes(name)) {
          errors.push(`${parent}: ambiguous path segment ${JSON.stringify(name)} (starts with $)`);
        }
        continue;
      }
      if (name === "" || /[.{}]/.test(name)) {
        errors.push(`${parent}: ambiguous path segment ${JSON.stringify(name)} (empty, or contains . { or })`);
        continue;
      }
      if (!SEGMENT.test(name)) {
        errors.push(`${parent}: ambiguous path segment ${JSON.stringify(name)} (must match ${SEGMENT.source}: the name becomes a CSS and a Dart identifier)`);
        continue;
      }
      const childTrail = [...trail, name];
      const childPath = childTrail.join(".");
      if (!isObject(child)) {
        errors.push(`${childPath}: must be a group or a token object`);
      } else if ("$value" in child) {
        addLeaf(childTrail, child, child.$type ?? type);
      } else {
        walk(child, childTrail, type);
      }
    }
  };
  const addLeaf = (trail, leaf, type) => {
    const leafPath = trail.join(".");
    if (trail.length < 2 || !LAYERS.includes(trail[0])) {
      return errors.push(`${leafPath}: token is not inside a layer (${LAYERS.join(", ")})`);
    }
    if ("$extensions" in leaf && !isObject(leaf.$extensions)) {
      errors.push(`${leafPath}: $extensions must be an object`);
    }
    if (type === undefined) {
      return errors.push(`${leafPath}: missing $type (none on the token or any parent group)`);
    }
    if (!TYPES.includes(type)) {
      return errors.push(`${leafPath}: unsupported $type ${JSON.stringify(type)} (accepted: ${TYPES.join(", ")})`);
    }
    leaves.set(leafPath, { path: leafPath, layer: trail[0], type, value: leaf.$value, extensions: leaf.$extensions });
  };
  walk(tree, [], undefined);
  return leaves;
}

// ---- source profile: literals on primitives ----

const HEX_COLOR = /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const PX = /^(?:\d+(?:\.\d+)?)px$/;
const MS = /^\d+ms$/;

function literalProblem(leaf) {
  const { type, value, path } = leaf;
  const segments = path.split(".");
  switch (type) {
    case "color":
      return typeof value === "string" && HEX_COLOR.test(value) ? null : "color must be # plus six or eight hex digits";
    case "dimension":
      return typeof value === "string" && PX.test(value) && Number.isFinite(parseFloat(value))
        ? null
        : 'dimension must be a finite nonnegative decimal followed by "px"';
    case "fontFamily":
      return Array.isArray(value) && value.length && value.every((name) => typeof name === "string" && name)
        ? null
        : "fontFamily must be a nonempty array of nonempty strings";
    case "fontWeight":
      return Number.isInteger(value) && value >= 100 && value <= 900 && value % 100 === 0
        ? null
        : "fontWeight must be an integer from 100 to 900 in steps of 100";
    case "number":
      if (!isNumber(value)) return "number must be a finite JSON number";
      if (hasRole(segments, "line-height") && value <= 0) return "line height must be positive";
      if (hasRole(segments, "opacity") && !inRange(value, 0, 1)) return "opacity must be within [0, 1]";
      return null;
    case "duration":
      return typeof value === "string" && MS.test(value) ? null : 'duration must be integral nonnegative milliseconds with "ms"';
    case "cubicBezier":
      return Array.isArray(value) && value.length === 4 && value.every(isNumber) &&
        inRange(value[0], 0, 1) && inRange(value[2], 0, 1)
        ? null
        : "cubicBezier must be four finite numbers, the first and third within [0, 1]";
    default:
      return null;
  }
}

/** Source profile checks that do not depend on the mode. */
export function validateProfile(tree) {
  const errors = [];
  const leaves = collectLeaves(tree, errors);
  for (const leaf of leaves.values()) {
    if (leaf.layer !== "primitive") continue;
    const problem = literalProblem(leaf);
    if (problem) errors.push(`${leaf.path}: ${problem}, found ${JSON.stringify(leaf.value)}`);
  }
  return { errors, leaves };
}

// ---- mode projection (spec rule 3) ----

/**
 * Returns { tree, errors }: a copy of the tree with the mode selected. Light keeps $value.
 * Dark promotes the dark value into $value. The tree argument is never changed.
 * Only dark reads the declaration, so only the dark run checks it.
 */
export function projectMode(tree, mode) {
  const errors = [];
  const projected = structuredClone(tree);
  const declaredAt = (node) => (isObject(node.$extensions) ? node.$extensions[MODE_KEY] : undefined);
  const walk = (node, trail, inheritedType) => {
    const type = node.$type ?? inheritedType;
    if (mode === "dark" && declaredAt(node) !== undefined) {
      const groupPath = trail.join(".") || "(root)";
      errors.push(
        groupPath === "semantic.color" || groupPath.startsWith("semantic.color.")
          ? `[${mode}] ${groupPath}: mode declaration on a group (only semantic colour leaves have modes)`
          : `[${mode}] ${groupPath}: mode declaration outside semantic.color`,
      );
    }
    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith("$") || !isObject(child)) continue;
      const childTrail = [...trail, name];
      if ("$value" in child) project(child, childTrail, child.$type ?? type);
      else walk(child, childTrail, type);
    }
  };
  const project = (leaf, trail, type) => {
    const leafPath = trail.join(".");
    const declared = declaredAt(leaf);
    const semanticColor = leafPath.startsWith("semantic.color.");
    if (mode !== "dark") return;
    if (declared !== undefined && !semanticColor) {
      return errors.push(`[${mode}] ${leafPath}: mode declaration outside semantic.color`);
    }
    if (!semanticColor) return;
    if (type !== "color") {
      if (declared !== undefined) {
        errors.push(`[${mode}] ${leafPath}: mode declaration on a ${type} leaf (only colour leaves have modes)`);
      }
      return;
    }
    if (!isObject(declared)) {
      return errors.push(`[${mode}] ${leafPath}: missing dark value ($extensions["${MODE_KEY}"].dark)`);
    }
    for (const key of Object.keys(declared)) {
      if (key !== "dark") errors.push(`[${mode}] ${leafPath}: unknown mode ${JSON.stringify(key)} (accepted: dark)`);
    }
    if (declared.dark === undefined) {
      errors.push(`[${mode}] ${leafPath}: missing dark value ($extensions["${MODE_KEY}"].dark)`);
    } else {
      leaf.$value = declared.dark;
    }
  };
  walk(projected, [], undefined);
  return { tree: projected, errors };
}

// ---- reference graph (spec rules 2 and 5) ----

/** Follows whole references from a leaf. Stops at a literal, a missing target or a repeat. */
export function chainFrom(leaves, start) {
  const chain = [start];
  let current = leaves.get(start);
  while (current) {
    const target = typeof current.value === "string" ? WHOLE_REFERENCE.exec(current.value)?.[1] : undefined;
    if (!target) break;
    chain.push(target);
    if (chain.indexOf(target) !== chain.length - 1) break;
    current = leaves.get(target);
  }
  return chain;
}

const describe = (leaves, path) => chainFrom(leaves, path).join(" -> ");

/** Graph checks for one projected mode. Appends "[mode] path: cause (chain: ...)" messages. */
export function validateGraph(leaves, mode, errors) {
  const groups = new Set();
  for (const leafPath of leaves.keys()) {
    const segments = leafPath.split(".");
    for (let length = 1; length < segments.length; length += 1) groups.add(segments.slice(0, length).join("."));
  }
  const reportedCycles = new Set();
  for (const leaf of leaves.values()) {
    if (leaf.layer === "primitive") continue;
    const fail = (cause) => errors.push(`[${mode}] ${leaf.path}: ${cause} (chain: ${describe(leaves, leaf.path)})`);
    if (typeof leaf.value !== "string") {
      fail("value must be one whole brace reference");
      continue;
    }
    const match = WHOLE_REFERENCE.exec(leaf.value);
    if (!match) {
      fail(
        /[{}]/.test(leaf.value)
          ? `malformed reference ${JSON.stringify(leaf.value)} (a value must be exactly one {path})`
          : `${leaf.layer} value must be one whole brace reference, found literal ${JSON.stringify(leaf.value)}`,
      );
      continue;
    }
    const target = leaves.get(match[1]);
    if (!target) {
      fail(groups.has(match[1]) ? `reference target ${match[1]} is a group` : `reference target ${match[1]} does not exist`);
      continue;
    }
    const chain = chainFrom(leaves, leaf.path);
    const repeat = chain.indexOf(chain.at(-1));
    if (repeat !== chain.length - 1) {
      const cycle = chain.slice(repeat);
      const key = [...new Set(cycle)].sort().join("|");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        fail(`reference cycle ${cycle.join(" -> ")}`);
      }
    }
    const distance = LAYERS.indexOf(leaf.layer) - LAYERS.indexOf(target.layer);
    if (distance === 0) fail(`same-layer edge to ${target.path}`);
    else if (distance < 0) fail(`reversed edge to ${target.path} (${leaf.layer} must not reference ${target.layer})`);
    else if (distance > 1) fail(`skipped layer: ${leaf.layer} references ${target.layer} at ${target.path}`);
    if (leaf.type !== target.type) fail(`type mismatch: ${leaf.type} references ${target.type} at ${target.path}`);
  }
}

/** True when a path segment names the role itself or ends with it (disabled-opacity). */
const hasRole = (segments, role) => segments.some((segment) => segment === role || segment.endsWith(`-${role}`));

/** Opacity and line-height bounds on the resolved value, whenever any hop of the chain has that role. */
export function validateBounds(leaves, mode, errors) {
  for (const leaf of leaves.values()) {
    if (leaf.layer === "primitive" || leaf.type !== "number") continue;
    const chain = chainFrom(leaves, leaf.path);
    const end = leaves.get(chain.at(-1));
    if (end?.layer !== "primitive" || !isNumber(end.value)) continue;
    const segments = chain.flatMap((hop) => hop.split("."));
    const problem =
      (hasRole(segments, "opacity") && !inRange(end.value, 0, 1) && "opacity must be within [0, 1]") ||
      (hasRole(segments, "line-height") && end.value <= 0 && "line height must be positive");
    if (problem) errors.push(`[${mode}] ${leaf.path}: ${problem}, resolved ${end.value} (chain: ${chain.join(" -> ")})`);
  }
}

const cssName = (leafPath) => `--mf-${leafPath.replaceAll(".", "-")}`;
const dartName = (leafPath) =>
  leafPath.split(/[.-]/).map((word, index) => (index ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join("");

// Dart class per plan decision 5: colours live in DesignTokensLight/Dark, other values in DesignTokens.
const dartClass = (leaf) => (leaf.type === "color" ? "DesignTokensLight/DesignTokensDark" : "DesignTokens");

/**
 * Two semantic or component paths must not produce the same CSS name (one :root/.dark namespace) or
 * the same Dart field name in one class. Public dashboard names are kept out of --mf- in validateBindings.
 */
export function validateNames(leaves, errors) {
  const namers = [
    ["CSS", (leaf) => ["", cssName(leaf.path)]],
    ["Dart", (leaf) => [dartClass(leaf), dartName(leaf.path)]],
  ];
  for (const [kind, convert] of namers) {
    const seen = new Map();
    for (const leaf of leaves.values()) {
      if (leaf.layer === "primitive") continue;
      const [scope, name] = convert(leaf);
      const key = `${scope} ${name}`;
      const where = scope ? ` in ${scope}` : "";
      if (seen.has(key)) errors.push(`name collision: ${seen.get(key)} and ${leaf.path} both produce the ${kind} name ${name}${where}`);
      else seen.set(key, leaf.path);
    }
  }
}

// ---- bindings (data from bindings.json) ----

/**
 * Lists every public binding as { platform, name, target, kind } for the inspector and the checks.
 * kind is the required target: "color" or "dimension" (a leaf of that type), "text" (a
 * semantic.text.<role> group) or "leaf" (a leaf of any type).
 */
export function listBindings(bindings) {
  const list = [];
  const dashboard = bindings.dashboard ?? {};
  for (const entry of dashboard.colors ?? []) {
    for (const name of entry.properties ?? []) list.push({ platform: "dashboard", name, target: entry.source, kind: "color" });
  }
  for (const [name, target] of Object.entries(dashboard.scalars ?? {})) {
    list.push({ platform: "dashboard", name, target, kind: "dimension" });
  }
  for (const [name, target] of Object.entries(dashboard.text ?? {})) list.push({ platform: "dashboard", name, target, kind: "text" });
  for (const role of Object.values(bindings.fonts?.roles ?? {})) {
    if (typeof role.dashboard?.property === "string") list.push({ platform: "dashboard", name: role.dashboard.property, role });
  }
  const app = bindings.app ?? {};
  for (const [field, target] of Object.entries(app.colorScheme ?? {})) {
    list.push({ platform: "app", name: `ColorScheme.${field}`, target, kind: "color" });
  }
  if (app.inversePrimary) {
    const { field, source } = app.inversePrimary;
    list.push({ platform: "app", name: `ColorScheme.${field}`, target: source, kind: "color", opposite: true });
  }
  for (const [name, target] of Object.entries(app.text ?? {})) list.push({ platform: "app", name, target, kind: "text" });
  for (const [name, target] of Object.entries(app.theme ?? {})) list.push({ platform: "app", name, target, kind: "leaf" });
  for (const [name, target] of Object.entries(bindings.nav ?? {})) {
    list.push({ platform: "app", name: `nav.${name}`, target, kind: "color" });
  }
  return list;
}

/** The bindings that point at a path (a leaf, or a group that contains it). */
export function bindingsAt(list, leafPath) {
  return list.filter(
    ({ target }) => typeof target === "string" && target && (target === leafPath || leafPath.startsWith(`${target}.`)),
  );
}

/** Role of a semantic font-family path on one platform, or undefined. */
export function fontRole(bindings, leafPath, platform) {
  const entry = bindings.fonts?.paths?.[leafPath];
  const name = isObject(entry) ? entry[platform] : entry;
  return name === undefined ? undefined : { name, ...bindings.fonts.roles?.[name] };
}

const TEXT_ROLE = /^semantic\.text\.[^.]+$/;
// Every bound text role must carry these members: both platforms read each one.
const TEXT_MEMBERS = [["font-family", "fontFamily"], ["font-size", "dimension"], ["line-height", "number"], ["font-weight", "fontWeight"]];

export function validateBindings(bindings, leaves, errors) {
  const groups = new Set();
  for (const leafPath of leaves.keys()) {
    const segments = leafPath.split(".");
    for (let length = 1; length < segments.length; length += 1) groups.add(segments.slice(0, length).join("."));
  }
  const claimed = new Map();
  for (const binding of listBindings(bindings)) {
    const key = `${binding.platform} ${binding.name}`;
    if (claimed.has(key)) {
      errors.push(`bindings.json: ${binding.platform} public name ${binding.name} is claimed by two bindings (${claimed.get(key)} and ${binding.target ?? "font role"})`);
    }
    claimed.set(key, binding.target ?? "font role");
    if (binding.platform === "dashboard" && typeof binding.name === "string" && binding.name.startsWith("--mf-")) {
      errors.push(`bindings.json: dashboard public name ${binding.name} uses the generated --mf- namespace`);
    }
    if (binding.role) continue;
    const prefix = `bindings.json: ${binding.platform} binding ${binding.name}:`;
    const { target, kind } = binding;
    if (typeof target !== "string" || !target) {
      errors.push(`${prefix} target must be a token path string, found ${JSON.stringify(target)}`);
      continue;
    }
    const leaf = leaves.get(target);
    if (!leaf && !groups.has(target)) {
      errors.push(`${prefix} target path ${target} does not exist`);
    } else if (kind === "text") {
      if (leaf || !TEXT_ROLE.test(target)) {
        errors.push(`${prefix} target path ${target} must be a semantic.text.<role> group`);
        continue;
      }
      for (const [member, type] of TEXT_MEMBERS) {
        const found = leaves.get(`${target}.${member}`);
        if (!found) errors.push(`${prefix} text role ${target} has no ${member} leaf`);
        else if (found.type !== type) errors.push(`${prefix} ${target}.${member} is a ${found.type} leaf, a ${type} leaf is required`);
      }
    } else if (!leaf) {
      errors.push(`${prefix} target path ${target} is a group, a leaf is required`);
    } else if (kind !== "leaf" && leaf.type !== kind) {
      errors.push(`${prefix} target path ${target} is a ${leaf.type} leaf, a ${kind} leaf is required`);
    }
  }
  const roles = bindings.fonts?.roles ?? {};
  const paths = bindings.fonts?.paths ?? {};
  for (const [roleName, role] of Object.entries(roles)) {
    if (typeof role.dashboard?.property !== "string" || typeof role.dashboard?.stack !== "string" || typeof role.app !== "string") {
      errors.push(`bindings.json: fonts.roles.${roleName} needs dashboard.property, dashboard.stack and app`);
    }
  }
  for (const [fontPath, entry] of Object.entries(paths)) {
    if (leaves.get(fontPath)?.type !== "fontFamily") {
      errors.push(`bindings.json: fonts.paths ${fontPath}: not a fontFamily leaf`);
    }
    const named = isObject(entry) ? [entry.dashboard, entry.app] : [entry];
    for (const roleName of named) {
      if (!roles[roleName]) errors.push(`bindings.json: fonts.paths ${fontPath}: unknown role ${JSON.stringify(roleName)}`);
    }
  }
  for (const leaf of leaves.values()) {
    if (leaf.layer !== "primitive" && leaf.type === "fontFamily" && !(leaf.path in paths)) {
      errors.push(`${leaf.path}: font-family path has no role in bindings.json fonts.paths`);
    }
  }
}

// Names the formats add on top of the leaf names (leaf names are checked in validateNames).
const SCALAR_PLACEMENT = { "--radius": "root", "--spacing": "theme" };
const PUBLIC_NAME = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXT_STEP = /^--text-[a-z0-9]+$/;

export function validateOutputNames(bindings, errors) {
  const names = new Map();
  const claim = (name, where) => {
    if (names.has(name)) errors.push(`name collision: ${name} is produced twice in the dashboard output (${names.get(name)} and ${where})`);
    else names.set(name, where);
  };
  for (const binding of listBindings(bindings)) {
    if (binding.platform !== "dashboard") continue;
    if (typeof binding.name !== "string" || !PUBLIC_NAME.test(binding.name)) {
      errors.push(`bindings.json: dashboard public name ${JSON.stringify(binding.name)} must match ${PUBLIC_NAME.source}: it becomes a CSS custom property`);
    }
    claim(binding.name, binding.target ?? "font role");
  }
  for (const name of Object.keys(bindings.dashboard?.scalars ?? {})) {
    if (!(name in SCALAR_PLACEMENT)) errors.push(`bindings.json: dashboard binding ${name}: no placement for this scalar (known: ${Object.keys(SCALAR_PLACEMENT).join(", ")})`);
  }
  for (const name of Object.keys(bindings.dashboard?.text ?? {})) {
    if (!TEXT_STEP.test(name)) {
      errors.push(`bindings.json: dashboard binding ${name}: a text step name must look like --text-<step>`);
      continue;
    }
    claim(`${name}--line-height`, `${name} companion`);
    claim(`${name}--font-weight`, `${name} companion`);
  }
  for (const [roleName, role] of Object.entries(bindings.fonts?.roles ?? {})) {
    if (typeof role.app === "string" && !/^[A-Za-z0-9_]+$/.test(role.app)) {
      errors.push(`bindings.json: fonts.roles.${roleName}: app registration ${JSON.stringify(role.app)} must be letters, digits and underscores`);
    }
  }
  for (const leafPath of Object.keys(bindings.app?.colorScheme ?? {})) {
    if (leafPath === "colorScheme") errors.push("name collision: ColorScheme field colorScheme");
  }
}

// ---- native values (spec value table) ----
// Dimensions use a transitive transform: it runs on every dimension leaf after its reference
// resolves, so each leaf picks its CSS unit from its own path, whatever unit its target carries.
// A leaf whose last segment is font-size gets rem (16 px per rem). Every other dimension gets px.
// Multiplying or dividing by 16 is exact in binary floating point, so no precision is lost.

const dartDouble = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const cssFamily = (name) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : `"${name}"`);

/** CSS value of one dimension leaf from its resolved value (px, or rem from a font-size target). */
export function cssDimension(path, value) {
  const match = /^(.+)(px|rem)$/.exec(value);
  if (!match) throw new Error(`${path.join(".")}: resolved dimension ${JSON.stringify(value)} is not px or rem`);
  const px = match[2] === "rem" ? parseFloat(match[1]) * 16 : parseFloat(match[1]);
  return path.at(-1) === "font-size" ? `${px / 16}rem` : `${px}px`;
}

export function cssValue(type, value) {
  switch (type) {
    case "fontFamily":
      return value.map(cssFamily).join(", ");
    case "cubicBezier":
      return `cubic-bezier(${value.join(", ")})`;
    default:
      return String(value);
  }
}

export function dartValue(type, value) {
  switch (type) {
    case "color": {
      const digits = value.slice(1).toUpperCase();
      return `0x${digits.length === 6 ? `FF${digits}` : digits.slice(6) + digits.slice(0, 6)}`;
    }
    case "dimension":
      return dartDouble(parseFloat(value));
    case "fontFamily":
      return `[${value.map((name) => `'${name}'`).join(", ")}]`;
    case "fontWeight":
      return `FontWeight.w${value}`;
    case "number":
      return dartDouble(value);
    case "duration":
      return `Duration(milliseconds: ${value.slice(0, -2).replace(/^0+(?=\d)/, "")})`;
    case "cubicBezier":
      return `Cubic(${value.map(dartDouble).join(", ")})`;
    default:
      return String(value);
  }
}

// ---- formats: one fragment per mode, joined by build.mjs ----

const emitted = (dictionary) => dictionary.allTokens.filter((token) => token.path[0] !== "primitive");
const byPath = (dictionary) => new Map(dictionary.allTokens.map((token) => [token.path.join("."), token]));

export function headerLines({ sourcePath, sourceDigest, generatorDigest, generatorFiles }) {
  return [
    "GENERATED FILE. DO NOT EDIT.",
    `Source: ${sourcePath} (not in Git), sha256 ${sourceDigest}`,
    `Generator: sha256 ${generatorDigest} of ${generatorFiles.join(", ")} (meta-frames-design-tokens/, sorted by path)`,
    "Regenerate: node meta-frames-design-tokens/build.mjs. Verify: node meta-frames-design-tokens/build.mjs --check",
  ];
}

/** CSS fragment for one mode. Light: @theme inline and :root. Dark: .dark. */
function formatCss(mode, bindings) {
  return ({ dictionary }) => {
    const tokens = byPath(dictionary);
    // The dashboard formatter (vp check) lowercases hex digits, so the file carries lowercase hex.
    // The digits and the alpha-last order are the authored ones.
    const value = (token) => {
      if (token.$type === "fontFamily") return fontRole(bindings, token.path.join("."), "dashboard").dashboard.stack;
      return token.$type === "color" ? token.$value.toLowerCase() : token.$value;
    };
    const publicColors = (bindings.dashboard.colors ?? []).flatMap((entry) =>
      entry.properties.map((property) => `  ${property}: var(${cssName(entry.source)});`),
    );
    const colorVars = emitted(dictionary)
      .filter((token) => mode === "light" || token.$type === "color")
      .map((token) => `  ${cssName(token.path.join("."))}: ${value(token)};`);
    if (mode === "dark") return [".dark {", ...colorVars, ...publicColors, "}"].join("\n");
    const theme = Object.values(bindings.fonts.roles).map((role) => `  ${role.dashboard.property}: ${role.dashboard.stack};`);
    const scalars = Object.entries(bindings.dashboard.scalars);
    for (const [name, target] of scalars) {
      if (SCALAR_PLACEMENT[name] === "theme") theme.push(`  ${name}: ${tokens.get(target).$value};`);
    }
    for (const [name, role] of Object.entries(bindings.dashboard.text)) {
      theme.push(
        `  ${name}: ${tokens.get(`${role}.font-size`).$value};`,
        `  ${name}--line-height: ${tokens.get(`${role}.line-height`).$value};`,
        `  ${name}--font-weight: ${tokens.get(`${role}.font-weight`).$value};`,
      );
    }
    const rootScalars = scalars
      .filter(([name]) => SCALAR_PLACEMENT[name] === "root")
      .map(([name, target]) => `  ${name}: var(${cssName(target)});`);
    return ["@theme inline {", ...theme, "}", "", ":root {", ...colorVars, ...publicColors, ...rootScalars, "}"].join("\n");
  };
}

const DART_TYPES = {
  color: "Color",
  dimension: "double",
  fontFamily: "String",
  fontWeight: "FontWeight",
  number: "double",
  duration: "Duration",
  cubicBezier: "Cubic",
};

/** One static const line, wrapped the way dart format wraps it (80 columns). */
export function dartDeclaration(type, name, expression) {
  const head = `  static const ${type} ${name} = `;
  if (head.length + expression.length + 1 <= 80) return `${head}${expression};`;
  const call = /^(\w+)\((.*)\)$/.exec(expression);
  if (call && `${head}${call[1]}(`.length <= 80) {
    return [`${head}${call[1]}(`, ...call[2].split(", ").map((argument) => `    ${argument},`), "  );"].join("\n");
  }
  return `${head.trimEnd()}\n      ${expression};`;
}

/** Dart fragment for one mode. Light: DesignTokens and DesignTokensLight. Dark: DesignTokensDark. */
function formatDart(mode, bindings) {
  const className = mode === "light" ? "DesignTokensLight" : "DesignTokensDark";
  const opposite = mode === "light" ? "DesignTokensDark" : "DesignTokensLight";
  return ({ dictionary }) => {
    const shared = [];
    const colors = [];
    for (const token of emitted(dictionary)) {
      const leafPath = token.path.join(".");
      const name = dartName(leafPath);
      if (token.$type === "color") colors.push(dartDeclaration("Color", name, `Color(${token.$value})`));
      else if (token.$type === "fontFamily") {
        shared.push(dartDeclaration("String", name, `'${fontRole(bindings, leafPath, "app").app}'`));
      } else shared.push(dartDeclaration(DART_TYPES[token.$type], name, token.$value));
    }
    const fields = Object.entries(bindings.app.colorScheme).map(([field, source]) => `    ${field}: ${dartName(source)},`);
    const { field, source } = bindings.app.inversePrimary;
    const scheme = [
      "  static const ColorScheme colorScheme = ColorScheme(",
      `    brightness: Brightness.${mode},`,
      ...fields,
      `    ${field}: ${opposite}.${dartName(source)},`,
      "  );",
    ];
    const classText = (name, members) => [`abstract final class ${name} {`, ...members, "}"].join("\n");
    const own = classText(className, [...colors, "", ...scheme]);
    return mode === "light" ? [classText("DesignTokens", shared), own].join("\n\n") : own;
  };
}

// ---- Style Dictionary instance (one per mode, both platforms) ----

const noBindings = () => {
  throw new Error("formatting needs the bindings: pass them to createDictionary");
};

/** Builds a fresh dictionary for one mode from the parsed source. The source object is not changed. */
export async function createDictionary(tree, mode, bindings) {
  const dictionary = new StyleDictionary({
    tokens: structuredClone(tree),
    log: { warnings: "error", verbosity: "silent" },
    preprocessors: ["mf/mode"],
    hooks: {
      preprocessors: {
        "mf/mode": (tokens) => {
          const { tree: projected, errors } = projectMode(tokens, mode);
          if (errors.length) throw new Error(errors.join("\n"));
          return projected;
        },
      },
      formats: bindings
        ? { "mf/css": formatCss(mode, bindings), "mf/dart": formatDart(mode, bindings) }
        : { "mf/css": noBindings, "mf/dart": noBindings },
      transforms: {
        // The full path is the unique name, so Style Dictionary's collision warning only fires on a real clash.
        "mf/name": { type: "name", transform: (token) => token.path.join(".") },
        "mf/css": {
          type: "value",
          transform: (token) => cssValue(token.$type, token.$value),
        },
        "mf/css/dimension": {
          type: "value",
          transitive: true,
          filter: (token) => token.$type === "dimension",
          transform: (token) => cssDimension(token.path, token.$value),
        },
        "mf/dart": {
          type: "value",
          transform: (token) => dartValue(token.$type, token.$value),
        },
      },
    },
    platforms: {
      css: { transforms: ["mf/name", "mf/css", "mf/css/dimension"], files: [{ destination: "fragment.css", format: "mf/css" }] },
      dart: { transforms: ["mf/name", "mf/dart"], files: [{ destination: "fragment.dart", format: "mf/dart" }] },
    },
  });
  await dictionary.hasInitialized;
  return dictionary;
}

/** Resolved native values for one mode: Map(path -> { css, dart }). */
export async function nativeValues(dictionary) {
  const values = new Map();
  const [css, dart] = await Promise.all([dictionary.getPlatformTokens("css"), dictionary.getPlatformTokens("dart")]);
  for (const token of css.allTokens) values.set(token.path.join("."), { css: token.$value });
  for (const token of dart.allTokens) values.get(token.path.join(".")).dart = token.$value;
  return values;
}

/** The CSS and Dart fragments of one mode, in memory (the formatting API writes nothing). */
export async function formatFragments(dictionary) {
  const [[css], [dart]] = await Promise.all([dictionary.formatPlatform("css"), dictionary.formatPlatform("dart")]);
  return { css: css.output, dart: dart.output };
}

/** Joins the two mode fragments into the final file texts. */
export function assemble({ header, light, dark }) {
  const comment = (prefix) => header.map((line) => `${prefix}${line}`.trimEnd());
  return {
    css: ["/*", ...comment(" * "), " */", "", light.css, "", dark.css, ""].join("\n"),
    dart: [...comment("// "), "", "import 'package:flutter/material.dart';", "", light.dart, "", dark.dart, ""].join("\n"),
  };
}

/** Runs every source check. Returns { errors, leaves, modes: { light, dark } } with projected leaves. */
export function analyze(tree, bindings) {
  const profile = validateProfile(tree);
  const errors = [...profile.errors];
  const modes = {};
  if (errors.length) return { errors, leaves: profile.leaves, modes };
  validateNames(profile.leaves, errors);
  for (const mode of MODES) {
    const { tree: projected, errors: modeErrors } = projectMode(tree, mode);
    errors.push(...modeErrors);
    const leaves = collectLeaves(projected, []);
    validateGraph(leaves, mode, errors);
    validateBounds(leaves, mode, errors);
    modes[mode] = leaves;
  }
  validateBindings(bindings, profile.leaves, errors);
  validateOutputNames(bindings, errors);
  return { errors, leaves: profile.leaves, modes };
}
