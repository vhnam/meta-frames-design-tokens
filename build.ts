// Design token generator, v2 runner: preflight, validation, --inspect, --check and generate.
// Run from anywhere: all paths resolve from this file.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type * as HooksModule from "./hooks.ts";
import type { Analysis, Bindings, BindingEntry, Leaf, Leaves, Mode, NativeValue } from "./hooks.ts";

type Hooks = typeof HooksModule;
type JsonObject = Record<string, unknown>;
type Outputs = { file: string; text: string }[];
type LinkProblem = { file: string; message: string };
const errnoCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;
const messageOf = (error: unknown): string => (error as Error).message;

const scriptDir = import.meta.dirname;
// This script lives in the untracked workspace directory meta-frames-design-tokens/. The repositories are its
// siblings: ../meta-frames-dashboard and ../meta-frames-app.
const workspaceRoot = path.resolve(scriptDir, "..");
const sourceFile = path.join(scriptDir, "tokens.json");
const bindingsFile = path.join(scriptDir, "bindings.json");
const manifestFile = path.join(scriptDir, "package.json");
const installedDir = path.join(scriptDir, "node_modules", "style-dictionary");
const lockPath = path.join(scriptDir, ".build.lock");
// Files that decide the output besides the source. Sorted by relative path in the digest.
const GENERATOR_FILES = ["bindings.json", "build.ts", "hooks.ts", "package.json", "pnpm-lock.yaml"];
// One read of the five generator inputs at startup. Every later use (checks, parse, digest) takes
// these bytes. Limit: build.ts and hooks.ts are also loaded by Node itself and can change between
// this read and that load.
// Only ENOENT means missing (null). Any other read error is kept as the Error and reported where
// the file is used.
const readOrNull = (file: string): Buffer | Error | null => {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    return errnoCode(error) === "ENOENT" ? null : (error as Error);
  }
};
const inputs = new Map(GENERATOR_FILES.map((name) => [path.join(scriptDir, name), readOrNull(path.join(scriptDir, name))]));
/** Bytes of a file (from the startup snapshot for a generator input), null when missing, or the read Error. */
const loadBytes = (file: string): Buffer | Error | null => (inputs.has(file) ? inputs.get(file)! : readOrNull(file));
const unreadable = (file: string, error: Error): string => `${relative(file)}: cannot read (${error.message})`;
const SIBLINGS = ["meta-frames-dashboard", "meta-frames-app"];

const relative = (file: string): string => path.relative(workspaceRoot, file);
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

// ---- startup ----

function assertNodeVersion(): void {
  const manifestBytes = loadBytes(manifestFile);
  if (manifestBytes instanceof Error) {
    console.error(`error: ${unreadable(manifestFile, manifestBytes)}`);
    process.exit(1);
  }
  if (!manifestBytes) {
    console.error(`error: ${relative(manifestFile)}: file missing`);
    process.exit(1);
  }
  let pin: unknown;
  try {
    pin = ((JSON.parse(manifestBytes.toString("utf8")) as JsonObject).engines as JsonObject | undefined)?.node;
  } catch (error) {
    console.error(`error: ${relative(manifestFile)}: invalid JSON (${messageOf(error)})`);
    process.exit(1);
  }
  if (typeof pin !== "string" || !/^\d+\.\d+\.\d+$/.test(pin)) {
    console.error(`error: ${relative(manifestFile)}: engines.node must be an exact version, found ${pin === undefined ? "undefined" : JSON.stringify(pin)}`);
    process.exit(1);
  }
  if (process.version !== `v${pin}`) {
    console.error(`error: ${relative(manifestFile)}: engines.node needs Node ${pin}, running ${process.version}`);
    process.exit(1);
  }
}

function readPackageJson(file: string, errors: string[]): JsonObject | null {
  const bytes = loadBytes(file);
  if (bytes instanceof Error) {
    errors.push(unreadable(file, bytes));
    return null;
  }
  if (!bytes) {
    errors.push(`${relative(file)}: file missing`);
    return null;
  }
  try {
    return JSON.parse(bytes.toString("utf8")) as JsonObject;
  } catch (error) {
    errors.push(`${relative(file)}: invalid JSON (${messageOf(error)})`);
    return null;
  }
}

/** Compiler version, locked installation and sibling checkouts. Returns the error list. */
function preflight(): string[] {
  const errors: string[] = [];
  const manifest = readPackageJson(manifestFile, errors);
  const installed = readPackageJson(path.join(installedDir, "package.json"), errors);
  const wanted = (manifest?.dependencies as JsonObject | undefined)?.["style-dictionary"] as string | undefined;
  if (manifest && !/^\d+\.\d+\.\d+$/.test(wanted ?? "")) {
    errors.push(`${relative(manifestFile)}: style-dictionary must be pinned to an exact version, found ${JSON.stringify(wanted)}`);
  }
  if (installed && installed.version !== wanted) {
    errors.push(`${relative(installedDir)}: installed style-dictionary is ${installed.version}, ${relative(manifestFile)} wants ${wanted}. Run pnpm install --frozen-lockfile in meta-frames-design-tokens/`);
  }
  for (const name of ["build.ts", "hooks.ts"]) {
    const bytes = inputs.get(path.join(scriptDir, name));
    if (!bytes || bytes instanceof Error) {
      errors.push(bytes instanceof Error ? unreadable(path.join(scriptDir, name), bytes) : `${name}: file missing`);
    }
  }
  const lockFile = path.join(scriptDir, "pnpm-lock.yaml");
  const lockBytes = inputs.get(lockFile);
  if (!lockBytes || lockBytes instanceof Error) {
    errors.push(lockBytes instanceof Error ? unreadable(lockFile, lockBytes) : `${relative(lockFile)}: file missing`);
  }
  for (const name of SIBLINGS) {
    const directory = path.join(workspaceRoot, name);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      errors.push(`${name}: sibling checkout missing at ${directory}`);
    }
  }
  return errors;
}

// ---- JSON with duplicate-key detection (JSON.parse keeps only the last duplicate) ----

/** Returns the dotted path of every object key that appears twice. Input must be valid JSON. */
function findDuplicateKeys(text: string): string[] {
  const duplicates: string[] = [];
  let position = 0;
  const skipSpace = () => {
    while (" \t\r\n".includes(text[position]!)) position += 1;
  };
  const readString = () => {
    const start = position;
    position += 1;
    while (text[position] !== '"') position += text[position] === "\\" ? 2 : 1;
    position += 1;
    return JSON.parse(text.slice(start, position));
  };
  const readValue = (trail: string[]): void => {
    skipSpace();
    const opener = text[position];
    if (opener === "{") {
      position += 1;
      const seen = new Set<string>();
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
      while (!",}] \t\r\n".includes(text[position]!) && position < text.length) position += 1;
    }
  };
  readValue([]);
  return duplicates;
}

/**
 * Reads a JSON object file once as bytes. Pushes errors and returns null when unusable.
 * `keep`, when given, receives the bytes of that same read as keep.bytes.
 */
function readJson(file: string, label: string, errors: string[], keep?: { bytes?: Buffer }): JsonObject | null {
  const bytes = loadBytes(file);
  if (bytes instanceof Error) {
    errors.push(unreadable(file, bytes));
    return null;
  }
  if (!bytes) {
    errors.push(`${relative(file)}: ${label} missing`);
    return null;
  }
  if (keep) keep.bytes = bytes;
  const text = bytes.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    errors.push(`${relative(file)}: invalid JSON (${messageOf(error)})`);
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

// ---- flags ----

function parseFlags(): string | undefined {
  const flags = process.argv.slice(2);
  const known = ["--inspect", "--check"];
  const unknown = flags.filter((flag) => !known.includes(flag));
  if (unknown.length || flags.length > 1) {
    console.error(
      `usage: node build.ts [--inspect | --check]  (unknown: ${unknown.join(" ") || "extra flags"})`,
    );
    process.exit(2);
  }
  return flags[0];
}

// ---- inspect ----

const chainText = (hooks: Hooks, leaves: Leaves, leafPath: string): string => hooks.chainFrom(leaves, leafPath).join(" -> ");

function bindingLines(hooks: Hooks, bindings: Bindings, list: BindingEntry[], leaf: Leaf, mode: Mode): string[] {
  const names = (platform: "dashboard" | "app"): string[] => {
    const found = hooks.bindingsAt(list, leaf.path).filter((binding) => binding.platform === platform);
    return found.map((binding) => {
      if (!binding.opposite) return binding.name;
      const scheme = mode === "light" ? "dark" : "light";
      return `${binding.name} (in the ${scheme} scheme)`;
    });
  };
  const roleBound = (platform: "dashboard" | "app"): string[] => {
    const role = hooks.fontRole(bindings, leaf.path, platform);
    return role ? [`${platform === "dashboard" ? role.dashboard!.property : "font role"} = ${role.name}`] : [];
  };
  const dashboard = [...names("dashboard"), ...(leaf.type === "fontFamily" ? roleBound("dashboard") : [])];
  const app = names("app");
  return [`  bindings.dashboard: ${dashboard.join(", ") || "none"}`, `  bindings.app: ${app.join(", ") || "none"}`];
}

function inspect(hooks: Hooks, bindings: Bindings, analysis: Analysis, values: Record<Mode, Map<string, NativeValue>>): void {
  const list = hooks.listBindings(bindings);
  const lines: string[] = [];
  const show = (heading: string, leaf: Leaf, mode: Mode, nativeValues: NativeValue): void => {
    lines.push(`${heading} ${leaf.path}`, `  type: ${leaf.type}`, `  chain: ${chainText(hooks, analysis.modes[mode ?? "light"]!, leaf.path)}`);
    if (leaf.type === "fontFamily" && leaf.layer !== "primitive") {
      const authored = nativeValues.css;
      lines.push(`  authored: ${authored}`);
      for (const platform of ["dashboard", "app"] as const) {
        const role = hooks.fontRole(bindings, leaf.path, platform)!;
        lines.push(
          `  output.${platform}: ${platform === "dashboard" ? role.dashboard!.stack : role.app}  [role ${role.name}]`,
        );
      }
    } else {
      lines.push(`  css: ${nativeValues.css}`, `  dart: ${nativeValues.dart}`);
    }
    if (leaf.layer !== "primitive") lines.push(...bindingLines(hooks, bindings, list, leaf, mode));
  };
  for (const leaf of analysis.modes.light!.values()) {
    if (leaf.layer === "primitive") show("primitive", leaf, "light", values.light.get(leaf.path)!);
  }
  for (const mode of hooks.MODES) {
    let count = 0;
    for (const leaf of analysis.modes[mode]!.values()) {
      if (leaf.layer === "primitive") continue;
      count += 1;
      show(mode, leaf, mode, values[mode].get(leaf.path)!);
    }
    lines.push(`summary ${mode}: ${count} semantic and component leaves`);
  }
  console.log(lines.join("\n"));
}

// ---- digests ----

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Frames each UTF-8 path and each file's raw bytes with its byte length (8 bytes, big endian). */
function generatorDigest(): string {
  const hash = createHash("sha256");
  const frame = (bytes: Buffer): void => {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length).update(bytes);
  };
  for (const name of [...GENERATOR_FILES].sort()) {
    frame(Buffer.from(name, "utf8"));
    frame(inputs.get(path.join(scriptDir, name)) as Buffer);
  }
  return hash.digest("hex");
}

// ---- outputs ----

const EXPECTED_OUTPUTS: Record<"dashboard" | "app", string> = {
  dashboard: path.join(workspaceRoot, "meta-frames-dashboard", "src", "styles", "design-tokens.generated.css"),
  app: path.join(workspaceRoot, "meta-frames-app", "lib", "ui", "core", "design_tokens.g.dart"),
};

/** Both bindings.json outputs must be exactly the two planned destinations, and different. */
function checkDestinations(bindings: JsonObject, errors: string[]): void {
  const resolved: Record<string, string | null> = {};
  for (const [name, expected] of Object.entries(EXPECTED_OUTPUTS)) {
    const value = (bindings.outputs as JsonObject | undefined)?.[name];
    resolved[name] = typeof value === "string" ? path.resolve(scriptDir, value) : null;
    if (resolved[name] !== expected) {
      errors.push(`bindings.json: outputs.${name}: ${resolved[name] ?? JSON.stringify(value)} must be exactly ${expected}`);
    }
  }
  if (resolved.dashboard && resolved.dashboard === resolved.app) {
    errors.push("bindings.json: outputs.dashboard and outputs.app resolve to the same path");
  }
}

/**
 * Each destination's parent directory must resolve (symbolic links followed) to the planned folder
 * inside its real checkout, and the destination file itself must not be a link. Returns
 * [{ file, message }]. A parent that does not exist is left to the missing-directory report.
 */
function linkProblems(files: Outputs): LinkProblem[] {
  const planned: [keyof typeof EXPECTED_OUTPUTS, string, string[]][] = [
    ["dashboard", "meta-frames-dashboard", ["src", "styles"]],
    ["app", "meta-frames-app", ["lib", "ui", "core"]],
  ];
  const problems: LinkProblem[] = [];
  for (const [name, checkout, folders] of planned) {
    const file = EXPECTED_OUTPUTS[name];
    if (!files.some((entry) => entry.file === file)) continue;
    let actual: string;
    try {
      actual = fs.realpathSync(path.dirname(file));
    } catch (error) {
      if (errnoCode(error) === "ENOENT") continue;
      problems.push({ file, message: `${relative(file)}: cannot resolve the destination directory (${messageOf(error)})` });
      continue;
    }
    const expected = path.join(fs.realpathSync(path.join(workspaceRoot, checkout)), ...folders);
    if (actual !== expected) {
      problems.push({ file, message: `${relative(file)}: destination directory resolves to ${actual}, expected ${expected}` });
    }
    try {
      if (fs.lstatSync(file).isSymbolicLink()) problems.push({ file, message: `${relative(file)}: destination is a symbolic link` });
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") problems.push({ file, message: `${relative(file)}: cannot inspect the destination (${messageOf(error)})` });
    }
  }
  return problems;
}

/** Builds both file texts in memory from the validated source. */
async function buildOutputs(hooks: Hooks, source: JsonObject, sourceBytes: Buffer, bindings: Bindings & JsonObject): Promise<{ files: Outputs; errors: string[] }> {
  const fragments = {} as Record<Mode, { css: string; dart: string }>;
  for (const mode of hooks.MODES) {
    fragments[mode] = await hooks.formatFragments(await hooks.createDictionary(source, mode, bindings));
  }
  const header = hooks.headerLines({
    sourcePath: relative(sourceFile),
    sourceDigest: sha256(sourceBytes),
    generatorDigest: generatorDigest(),
    generatorFiles: [...GENERATOR_FILES].sort(),
  });
  const texts = hooks.assemble({ header, light: fragments.light, dark: fragments.dark });
  const errors: string[] = [];
  const outputs = bindings.outputs as Record<string, string>;
  const files: Outputs = [
    { file: path.resolve(scriptDir, outputs.dashboard!), text: texts.css },
    { file: path.resolve(scriptDir, outputs.app!), text: texts.dart },
  ];
  for (const { file, text } of files) {
    if (!text.includes("GENERATED FILE. DO NOT EDIT.") || !text.endsWith("\n") || text.includes("\r")) {
      errors.push(`${relative(file)}: generated text failed validation`);
    }
  }
  return { files, errors };
}

/** Compares each built file with disk. Files in skip (rejected by linkProblems) are not read. */
function compareWithDisk(files: Outputs, skip: Set<string> = new Set()): { file: string; state: string }[] {
  return files
    .filter(({ file }) => !skip.has(file))
    .map(({ file, text }) => {
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(file);
      } catch (error) {
        return { file, state: errnoCode(error) === "ENOENT" ? "missing" : `cannot read (${messageOf(error)})` };
      }
      return { file, state: bytes.equals(Buffer.from(text, "utf8")) ? "same" : "stale or edited" };
    });
}

/**
 * Temporary file next to each destination, then rename over it. A failure reports the original
 * error first, removes every temporary file not yet renamed and names any file it cannot remove.
 * A file renamed before the failure is not rolled back, so the message tells the user to rerun the
 * generator and --check.
 * Each temporary file is created exclusively and its device and inode are recorded. No rename runs
 * unless every temporary file is still at its path with that identity, and cleanup deletes only a
 * file with that identity.
 * shortcut: the identity is read right after the write, and a change between the last check and the
 * rename is not caught (Node has no openat/renameat); the build lock only stops other generator runs.
 * Upgrade if the generator ever runs where others can write the checkouts.
 */
type Pending = { file: string; text: string; temp: string | null; dir?: fs.Stats; id?: fs.Stats };
function writeOutputs(files: Outputs): void {
  const pending: Pending[] = files.map(({ file, text }) => ({ file, text, temp: `${file}.tmp-${process.pid}` }));
  const sameFile = (stat: fs.Stats, id: fs.Stats): boolean => stat.isFile() && stat.dev === id.dev && stat.ino === id.ino;
  const stillStaged = ({ temp, id }: Pending): boolean => {
    try {
      return Boolean(id) && sameFile(fs.lstatSync(temp!), id!);
    } catch {
      return false;
    }
  };
  let failing = "";
  try {
    for (const entry of pending) {
      failing = entry.file;
      // Directory identity: lets cleanup name a temporary file whose directory was renamed.
      entry.dir = fs.statSync(path.dirname(entry.temp!));
      fs.writeFileSync(entry.temp!, entry.text, { encoding: "utf8", flag: "wx" });
      try {
        entry.id = fs.lstatSync(entry.temp!);
      } catch (error) {
        throw new Error(`${relative(entry.temp!)}: staged file not found after the write (${messageOf(error)})`);
      }
    }
    const moved: LinkProblem[] = [
      ...files
        .filter(({ file }) => !fs.existsSync(path.dirname(file)))
        .map(({ file }) => ({ file, message: `${relative(file)}: destination directory missing` })),
      ...linkProblems(files),
      ...pending
        .filter((entry) => !stillStaged(entry))
        .map(({ file, temp }) => ({ file, message: `${relative(temp!)}: staged file changed or moved after the write` })),
    ];
    if (moved.length) {
      failing = moved[0].file;
      throw new Error(moved.map(({ message }) => message).join("; "));
    }
    for (const entry of pending) {
      failing = entry.file;
      fs.renameSync(entry.temp!, entry.file);
      entry.temp = null;
    }
  } catch (error) {
    console.error(`error: ${relative(failing)}: write failed (${messageOf(error)})`);
    const stuck: string[] = [];
    for (const entry of pending) {
      const { temp, dir } = entry;
      if (!temp || !dir) continue;
      if (stillStaged(entry)) {
        try {
          fs.rmSync(temp, { force: true });
        } catch (removeError) {
          stuck.push(`${relative(temp)}: ${messageOf(removeError)}`);
        }
        continue;
      }
      if (!entry.id && !fs.existsSync(temp) && stagingDirectory(temp, dir) === path.dirname(temp)) continue;
      const where = stagingDirectory(temp, dir);
      if (where === path.dirname(temp)) stuck.push(`${relative(temp)}: not removed, it is not the file this run staged; check it and delete it by hand`);
      else if (where) stuck.push(`${relative(path.join(where, path.basename(temp)))}: not removed, its directory moved after staging; check it and delete it by hand`);
      else stuck.push(`${relative(temp)}: its directory moved after staging; find ${path.basename(temp)} and delete it`);
    }
    if (stuck.length) {
      console.error("Could not remove these temporary files. Delete them by hand:");
      for (const line of stuck) console.error(`  ${line}`);
    } else {
      console.error("Pending temporary files removed.");
    }
    console.error("Rerun node meta-frames-design-tokens/build.ts, then --check.");
    process.exit(1);
  }
}

/**
 * Current path of the directory a temporary file was staged in: its original path, or a sibling it
 * was renamed to (same device and inode). Null when it cannot be found. Used only to name a file.
 * shortcut: a directory moved anywhere other than a sibling is not found; the caller names the file instead.
 */
function stagingDirectory(temp: string, dir: fs.Stats): string | null {
  const original = path.dirname(temp);
  const same = (candidate: string): boolean => {
    try {
      const stat = fs.statSync(candidate);
      return stat.isDirectory() && stat.dev === dir.dev && stat.ino === dir.ino;
    } catch {
      return false;
    }
  };
  if (same(original)) return original;
  let siblings: string[];
  try {
    siblings = fs.readdirSync(path.dirname(original));
  } catch {
    return null;
  }
  for (const name of siblings) {
    const candidate = path.join(path.dirname(original), name);
    if (same(candidate)) return candidate;
  }
  return null;
}

/** One writer per workspace: exclusive create. An existing lock is never deleted by a failed attempt. */
function takeLock(): void {
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, "wx");
  } catch (error) {
    fail([
      errnoCode(error) === "EEXIST"
        ? `${relative(lockPath)}: another build holds the lock. Wait for it, or delete the file if no build is running`
        : `${relative(lockPath)}: cannot create the lock (${messageOf(error)})`,
    ]);
  }
  // Cleanup is registered before the close, so a failed close still removes the owned lock.
  process.on("exit", () => fs.rmSync(lockPath, { force: true }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    fail([`${relative(lockPath)}: cannot close the lock (${messageOf(error)})`]);
  }
}

// ---- main ----

async function main(): Promise<void> {
  assertNodeVersion();
  const flag = parseFlags();

  const errors = preflight();
  if (errors.length) fail(errors);

  // Imported after preflight: hooks.ts needs the locked Style Dictionary install.
  const hooks = await import("./hooks.ts");
  const bindings = readJson(bindingsFile, "bindings", errors);
  // One read of the source feeds the digest, duplicate detection and parsing.
  const sourceRead: { bytes?: Buffer } = {};
  const source = readJson(sourceFile, "source", errors, sourceRead);
  if (!source || !bindings) fail(errors);
  checkDestinations(bindings, errors);
  if (errors.length) fail(errors);

  const analysis = hooks.analyze(source, bindings);
  errors.push(...analysis.errors);
  if (errors.length) fail(errors);

  if (flag === "--inspect") {
    const values = {} as Record<Mode, Map<string, NativeValue>>;
    for (const mode of hooks.MODES) values[mode] = await hooks.nativeValues(await hooks.createDictionary(source, mode));
    inspect(hooks, bindings, analysis, values);
    return;
  }

  if (!flag) takeLock();
  const built = await buildOutputs(hooks, source, sourceRead.bytes!, bindings);
  // A missing directory fails a generate. --check counts it as a missing file for that destination.
  const links = linkProblems(built.files);
  if (!flag) {
    for (const { file } of built.files) {
      if (!fs.existsSync(path.dirname(file))) built.errors.push(`${relative(file)}: destination directory missing`);
    }
    built.errors.push(...links.map(({ message }) => message));
  }
  if (built.errors.length) fail(built.errors);
  const states = compareWithDisk(built.files, new Set(links.map(({ file }) => file)));
  if (!flag) {
    const blocked = states.filter(({ state }) => state.startsWith("cannot read"));
    if (blocked.length) fail(blocked.map(({ file, state }) => `${relative(file)}: ${state}`));
  }
  if (flag === "--check") {
    const bad = states.filter(({ state }) => state !== "same");
    for (const { file, state } of bad) console.error(`error: ${relative(file)}: ${state}`);
    for (const { message } of links) console.error(`error: ${message}`);
    if (bad.length || links.length) {
      console.error("Run node meta-frames-design-tokens/build.ts, then --check again.");
      process.exit(1);
    }
    console.log(`ok: ${states.length} generated files match`);
    return;
  }
  writeOutputs(built.files);
  for (const { file, state } of states) console.log(`${state === "same" ? "unchanged" : "wrote"} ${relative(file)}`);
}

function fail(errors: string[]): never {
  for (const message of errors) console.error(`error: ${message}`);
  console.error(`${errors.length} error(s). Nothing written.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`error: ${(error as Error).stack ?? error}`);
  process.exit(1);
});
