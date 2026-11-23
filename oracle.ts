// Independent expected values for the generated files. This file imports nothing from the
// generator: no Style Dictionary, no hooks.ts, no bindings.json. It walks the source JSON on its
// own and holds the spec tables, transcribed by hand from
// docs/ai-workflow/spec-design-tokens-v2.md (Dashboard bindings, Flutter bindings, Font delivery)
// and plan decisions 6 and 7.

// ---- the oracle's own types (not shared with the generator) ----

export type Mode = "light" | "dark";
export interface SourceLeaf {
  type: string | undefined;
  value: unknown;
  dark: unknown;
}
export type Leaves = Map<string, SourceLeaf>;
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface DimensionCanon {
  px: number;
  cssUnit: "rem" | "px";
  cssNumber: number;
}
export type Canon = Rgba | DimensionCanon | { milliseconds: string } | { authored: unknown } | number | unknown[];
export type CssExpectation =
  | { kind: "stack"; stack: string[] }
  | { kind: "value"; type: string | undefined; canon: Canon }
  | { kind: "var"; name: string };
type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

// ---- spec: dashboard public properties (path starts at semantic.color) ----
export const DASHBOARD_PUBLIC = [
  ["--background", "bg.canvas"],
  ["--foreground", "fg.default"],
  ["--card-foreground", "fg.default"],
  ["--popover-foreground", "fg.default"],
  ["--secondary-foreground", "fg.default"],
  ["--accent-foreground", "fg.default"],
  ["--card", "bg.surface"],
  ["--popover", "bg.surface-raised"],
  ["--primary", "action.primary"],
  ["--primary-foreground", "fg.on-primary"],
  ["--secondary", "action.secondary"],
  ["--muted", "bg.subtle"],
  ["--accent", "bg.subtle"],
  ["--muted-foreground", "fg.muted"],
  ["--destructive", "action.danger"],
  ["--border", "border.default"],
  ["--input", "border.control"],
  ["--ring", "border.focus"],
  ["--chart-1", "chart.1"],
  ["--chart-2", "chart.2"],
  ["--chart-3", "chart.3"],
  ["--chart-4", "chart.4"],
  ["--chart-5", "chart.5"],
  ["--sidebar", "bg.surface"],
  ["--sidebar-foreground", "fg.muted"],
  ["--sidebar-primary", "action.accent"],
  ["--sidebar-primary-foreground", "fg.on-accent"],
  ["--sidebar-accent", "bg.subtle"],
  ["--sidebar-accent-foreground", "fg.default"],
  ["--sidebar-border", "border.default"],
  ["--sidebar-ring", "border.focus"],
  ["--dot", "border.default"],
].map(([property, source]) => [property!, `semantic.color.${source}`] as [string, string]);

// ---- spec: Flutter ColorScheme (path starts at semantic.color) ----
export const COLOR_SCHEME = [
  ["primary", "action.primary"],
  ["onPrimary", "fg.on-primary"],
  ["primaryContainer", "bg.subtle"],
  ["onPrimaryContainer", "fg.default"],
  ["secondary", "action.secondary"],
  ["onSecondary", "fg.default"],
  ["secondaryContainer", "bg.subtle"],
  ["onSecondaryContainer", "fg.default"],
  ["tertiary", "action.accent"],
  ["onTertiary", "fg.on-accent"],
  ["tertiaryContainer", "status.success.bg"],
  ["onTertiaryContainer", "status.success.fg"],
  ["error", "action.danger"],
  ["onError", "fg.on-danger"],
  ["errorContainer", "status.danger.bg"],
  ["onErrorContainer", "status.danger.fg"],
  ["surface", "bg.canvas"],
  ["onSurface", "fg.default"],
  ["onSurfaceVariant", "fg.muted"],
  ["surfaceContainerLowest", "bg.canvas"],
  ["surfaceContainerLow", "bg.surface"],
  ["surfaceContainer", "bg.surface"],
  ["surfaceContainerHigh", "bg.subtle"],
  ["surfaceContainerHighest", "bg.surface-raised"],
  ["outline", "border.control"],
  ["outlineVariant", "border.default"],
  ["inverseSurface", "bg.inverse"],
  ["onInverseSurface", "fg.inverse"],
  ["shadow", "bg.scrim"],
  ["scrim", "bg.scrim"],
].map(([field, source]) => [field!, `semantic.color.${source}`] as [string, string]);
// inversePrimary reads action.primary from the opposite mode.
export const INVERSE_PRIMARY = "semantic.color.action.primary";

// ---- spec: navigation (Flutter bindings paragraph) ----
export const NAV: Record<string, string> = {
  bar: "component.nav.bg",
  divider: "component.nav.border",
  indicatorFill: "component.nav.indicator",
  selectedIcon: "semantic.color.fg.on-accent",
  selectedLabel: "component.nav.item-fg-active",
  idleIcon: "component.nav.item-fg",
  idleLabel: "component.nav.item-fg",
  activeRowBackground: "component.nav.item-bg-active",
};

// ---- spec: font delivery ----
export const FONT_ROLES: Record<string, { stack: string[]; registration: string; property: string }> = {
  heading: { stack: ['"Space Grotesk Variable"', "ui-sans-serif", "sans-serif"], registration: "SpaceGrotesk", property: "--font-heading" },
  body: { stack: ['"Geist Mono Variable"', "ui-monospace", "monospace"], registration: "GeistMono", property: "--font-sans" },
  mono: { stack: ['"JetBrains Mono Variable"', "ui-monospace", "monospace"], registration: "JetBrainsMono", property: "--font-mono" },
};
// [semantic.text role, dashboard role, flutter role]
export const TEXT_FONTS: [string, string, string][] = [
  ["display", "heading", "heading"],
  ["heading-1", "heading", "heading"],
  ["heading-2", "heading", "heading"],
  ["heading-3", "heading", "heading"],
  ["body", "body", "body"],
  ["body-sm", "body", "body"],
  ["caption", "body", "body"],
  ["data", "mono", "mono"],
  ["label", "body", "mono"],
];

// ---- plan decision 6: dashboard text steps; radius and spacing ----
export const TEXT_STEPS: [string, string][] = [
  ["xs", "caption"],
  ["sm", "body-sm"],
  ["base", "body"],
  ["lg", "heading-3"],
  ["xl", "heading-2"],
  ["2xl", "heading-1"],
  ["3xl", "display"],
];
export const RADIUS_PATH = "semantic.radius.control";
// Dashboard rounded-* utilities (hand-copied from meta-frames-dashboard/src/styles/index.css lines 46-48). rounded-sm is Dashboard composition and is not listed.
export const DASHBOARD_RADII: Record<string, string> = {
  "rounded-md": "semantic.radius.control",
  "rounded-lg": "semantic.radius.surface",
  "rounded-xl": "semantic.radius.surface",
};
export const SPACING_PATH = "semantic.space.gap.xs";

// ---- independent source walk ----

/** Parses the source text. Returns { leaves: Map(path -> { type, value, dark }) } with inherited types. */
export function readSource(text: string): { leaves: Leaves } {
  const tree: unknown = JSON.parse(text);
  if (!isObject(tree)) throw new Error("oracle: v2/tokens.json root must be an object");
  const leaves: Leaves = new Map();
  const walk = (node: JsonObject, trail: string[], inherited: string | undefined): void => {
    const type = (node.$type ?? inherited) as string | undefined;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (!isObject(child)) throw new Error(`oracle: ${[...trail, key].join(".")} must be an object`);
      const entry = child;
      if ("$value" in entry) {
        const extensions = entry.$extensions;
        const declared = isObject(extensions) ? extensions["com.metaframes.modes"] : undefined;
        const modes = isObject(declared) ? declared : undefined;
        leaves.set([...trail, key].join("."), {
          type: (entry.$type ?? type) as string | undefined,
          value: entry.$value,
          dark: modes?.dark,
        });
      } else {
        walk(entry, [...trail, key], type);
      }
    }
  };
  walk(tree, [], undefined);
  return { leaves };
}

/** Follows aliases to the primitive literal. Dark uses the dark value on a semantic colour. */
export function resolve(leaves: Leaves, path: string, mode: Mode): { type: string | undefined; value: unknown } {
  const type = leaves.get(path)?.type;
  let current = path;
  for (let hops = 0; hops < 10; hops += 1) {
    const leaf = leaves.get(current);
    if (!leaf) throw new Error(`oracle: no leaf ${current} (from ${path})`);
    const value = mode === "dark" && leaf.dark !== undefined ? leaf.dark : leaf.value;
    if (typeof value !== "string" || !/^\{.+\}$/.test(value)) {
      // Spec dimension row: a nonnegative finite decimal followed by "px".
      if (type === "dimension" && !(typeof value === "string" && /^\d+(?:\.\d+)?px$/.test(value) && Number.isFinite(parseFloat(value)))) {
        throw new Error(`oracle: ${current}: dimension must be a px string, found ${JSON.stringify(value)}`);
      }
      return { type, value };
    }
    current = value.slice(1, -1);
  }
  throw new Error(`oracle: alias loop at ${path}`);
}

// ---- canonical native values ----

export function parseHex(hex: string): Rgba {
  const digits = hex.slice(1);
  const byte = (index: number): number => parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  return { r: byte(0), g: byte(1), b: byte(2), a: digits.length === 8 ? byte(3) : 255 };
}

/** Expected canonical value of one leaf, for each platform. Canonical forms are plain data. */
export function canonical(leaves: Leaves, path: string, mode: Mode): Canon {
  const { type, value } = resolve(leaves, path, mode);
  const own = path.split(".").at(-1);
  switch (type) {
    case "color":
      return parseHex(value as string);
    case "dimension": {
      const px = parseFloat(value as string);
      return { px, cssUnit: own === "font-size" ? "rem" : "px", cssNumber: own === "font-size" ? px / 16 : px };
    }
    case "fontWeight":
    case "number":
      return value as number;
    case "duration":
      return { milliseconds: (value as string).slice(0, -2).replace(/^0+(?=\d)/, "") };
    case "cubicBezier":
      return value as unknown[];
    case "fontFamily":
      return { authored: value };
    default:
      throw new Error(`oracle: unsupported type ${type} at ${path}`);
  }
}

export const semanticAndComponentPaths = (leaves: Leaves): string[] => [...leaves.keys()].filter((path) => !path.startsWith("primitive."));
export const cssNameOf = (path: string): string => `--mf-${path.replaceAll(".", "-")}`;
export const dartNameOf = (path: string): string =>
  path.split(/[.-]/).map((word, index) => (index ? word[0]!.toUpperCase() + word.slice(1) : word)).join("");

/** Role of a semantic text font-family path: [dashboard role, flutter role]. */
export function fontRolesOf(path: string): [string, string] | null {
  const match = /^semantic\.text\.([^.]+)\.font-family$/.exec(path);
  const row = match && TEXT_FONTS.find(([role]) => role === match[1]);
  return row ? [row[1], row[2]] : null;
}

// ---- expected CSS and Dart content (canonical, platform-neutral where possible) ----

const css = (leaves: Leaves, path: string, mode: Mode): CssExpectation => {
  const roles = fontRolesOf(path);
  return roles
    ? { kind: "stack", stack: FONT_ROLES[roles[0]]!.stack }
    : { kind: "value", type: leaves.get(path)!.type, canon: canonical(leaves, path, mode) };
};

/** Expected property values per selector: { theme, root, dark } as Map(property -> expectation). */
export function expectedCss(leaves: Leaves): { theme: Map<string, CssExpectation>; root: Map<string, CssExpectation>; dark: Map<string, CssExpectation> } {
  const theme = new Map<string, CssExpectation>();
  for (const role of Object.values(FONT_ROLES)) theme.set(role.property, { kind: "stack", stack: role.stack });
  theme.set("--spacing", css(leaves, SPACING_PATH, "light"));
  for (const [step, role] of TEXT_STEPS) {
    theme.set(`--text-${step}`, css(leaves, `semantic.text.${role}.font-size`, "light"));
    theme.set(`--text-${step}--line-height`, css(leaves, `semantic.text.${role}.line-height`, "light"));
    theme.set(`--text-${step}--font-weight`, css(leaves, `semantic.text.${role}.font-weight`, "light"));
  }
  const paths = semanticAndComponentPaths(leaves);
  const publicAliases = DASHBOARD_PUBLIC.map(([property, path]): [string, CssExpectation] => [property, { kind: "var", name: cssNameOf(path) }]);
  const root = new Map<string, CssExpectation>(paths.map((path) => [cssNameOf(path), css(leaves, path, "light")]));
  for (const [property, expectation] of publicAliases) root.set(property, expectation);
  root.set("--radius", { kind: "var", name: cssNameOf(RADIUS_PATH) });
  const dark = new Map<string, CssExpectation>(paths.filter((path) => leaves.get(path)!.type === "color").map((path) => [cssNameOf(path), css(leaves, path, "dark")]));
  for (const [property, expectation] of publicAliases) dark.set(property, expectation);
  return { theme, root, dark };
}

export const DART_TYPE: Record<string, string> = {
  color: "Color",
  dimension: "double",
  fontFamily: "String",
  fontWeight: "FontWeight",
  number: "double",
  duration: "Duration",
  cubicBezier: "Cubic",
};

/** Expected Dart fields per class, and the ColorScheme arguments for each mode. */
export function expectedDart(leaves: Leaves) {
  const paths = semanticAndComponentPaths(leaves);
  const fields = (mode: Mode) =>
    new Map<string, { type: string; canon: Canon }>(
      paths
        .filter((path) => leaves.get(path)!.type === "color")
        .map((path) => [dartNameOf(path), { type: "Color", canon: canonical(leaves, path, mode) }]),
    );
  const shared = new Map<string, { type: string | undefined; canon: Canon | string }>();
  for (const path of paths) {
    const { type } = leaves.get(path)!;
    if (type === "color") continue;
    const roles = fontRolesOf(path);
    shared.set(dartNameOf(path), {
      type: DART_TYPE[type!],
      canon: type === "fontFamily" ? FONT_ROLES[roles![1]]!.registration : type === "dimension" ? (canonical(leaves, path, "light") as DimensionCanon).px : canonical(leaves, path, "light"),
    });
  }
  const scheme = (mode: Mode) => {
    const opposite = mode === "light" ? "DesignTokensDark" : "DesignTokensLight";
    return new Map<string, string>([
      ["brightness", `Brightness.${mode}`],
      ...COLOR_SCHEME.map(([field, path]): [string, string] => [field, dartNameOf(path)]),
      ["inversePrimary", `${opposite}.${dartNameOf(INVERSE_PRIMARY)}`],
    ]);
  };
  return {
    shared,
    light: fields("light"),
    dark: fields("dark"),
    schemes: { light: scheme("light"), dark: scheme("dark") },
  };
}

// ---- plan decision 7: app theme bindings (hand-copied from the plan table; no import from the generator) ----

// Flutter family role -> registration name. Repeats FONT_ROLES on purpose: the table below names roles only.
export const APP_FAMILY: Record<string, string> = { heading: "SpaceGrotesk", body: "GeistMono", mono: "JetBrainsMono" };

// [TextTheme slot, semantic.text role, family role]. Size, line height, weight and family all come from the role.
export const APP_TEXT_SLOTS: [string, string, string][] = [
  ["displayLarge", "display", "heading"],
  ["displayMedium", "display", "heading"],
  ["displaySmall", "display", "heading"],
  ["headlineLarge", "heading-1", "heading"],
  ["headlineMedium", "heading-1", "heading"],
  ["headlineSmall", "heading-1", "heading"],
  ["titleLarge", "heading-2", "heading"],
  ["titleMedium", "heading-3", "heading"],
  ["titleSmall", "label", "mono"],
  ["labelLarge", "label", "mono"],
  ["labelMedium", "label", "mono"],
  ["labelSmall", "caption", "mono"], // caption size, line height and weight; the family stays Mono
  ["bodyLarge", "body", "body"],
  ["bodyMedium", "body-sm", "body"],
  ["bodySmall", "caption", "body"],
];

// Size-only bindings: [name, size path, family role or null, weight path or null].
export const APP_SIZES: [string, string, string | null, string | null][] = [
  ["appBarTitle", "semantic.text.heading-2.font-size", "heading", null],
  ["dialogTitle", "semantic.text.heading-2.font-size", "heading", null],
  ["buttonText", "component.button.font-size", "mono", "component.button.font-weight"],
  ["inputLabel", "semantic.text.label.font-size", "mono", null],
  ["chipLabel", "semantic.text.caption.font-size", "mono", null],
  ["tabLabel", "semantic.text.caption.font-size", "mono", null],
  ["segmentLabel", "semantic.text.caption.font-size", "mono", null],
  ["monoStyleDefault", "semantic.text.caption.font-size", "mono", null],
  ["navLabel", "semantic.text.caption.font-size", "mono", null],
];

// Corner radius paths. surface = kRadius users; control = kCorners ("shape") users.
export const APP_RADII: Record<string, string> = {
  card: "semantic.radius.surface",
  dialog: "semantic.radius.surface",
  bottomSheetTop: "semantic.radius.surface",
  popupMenu: "semantic.radius.surface",
  filledButton: "semantic.radius.control",
  outlinedButton: "semantic.radius.control",
  textButton: "semantic.radius.control",
  floatingActionButton: "semantic.radius.control",
  inputBorder: "semantic.radius.control",
  segmentedButton: "semantic.radius.control",
  navIndicator: "semantic.radius.control",
};

export const APP_BUTTON = {
  paddingX: "component.button.padding-x",
  paddingY: 0, // vertical padding is removed
  minHeight: "component.button.height.lg",
};
export const APP_INPUT_FOCUS = { color: "component.input.border-focus", width: "component.focus-ring.width" };
export const APP_SURFACES = { card: "component.card.bg", dialog: "component.dialog.bg" };
// Disabled text and icon: onSurface (fg.default) at the disabled opacity, applied once.
export const APP_DISABLED = { base: "semantic.color.fg.default", opacity: "semantic.opacity.disabled" };

/** Expected app theme values from the source leaves. Colours are { r, g, b, a } bytes; sizes are plain numbers. */
export function expectedApp(leaves: Leaves) {
  const number = (path: string, mode: Mode = "light"): number => {
    const { type, value } = resolve(leaves, path, mode);
    return type === "dimension" ? parseFloat(value as string) : (value as number);
  };
  const color = (path: string, mode: Mode): Rgba => parseHex(resolve(leaves, path, mode).value as string);
  const text = new Map(
    APP_TEXT_SLOTS.map(([slot, role, family]) => [
      slot,
      {
        family: APP_FAMILY[family]!,
        size: number(`semantic.text.${role}.font-size`),
        height: number(`semantic.text.${role}.line-height`),
        weight: number(`semantic.text.${role}.font-weight`),
      },
    ]),
  );
  const sizes = new Map(
    APP_SIZES.map(([name, sizePath, family, weightPath]) => [
      name,
      { size: number(sizePath), ...(family && { family: APP_FAMILY[family]! }), ...(weightPath && { weight: number(weightPath) }) },
    ]),
  );
  const radii = new Map(Object.entries(APP_RADII).map(([name, path]) => [name, number(path)]));
  const perMode = (mode: Mode) => ({
    card: color(APP_SURFACES.card, mode),
    dialog: color(APP_SURFACES.dialog, mode),
    inputFocus: { color: color(APP_INPUT_FOCUS.color, mode), width: number(APP_INPUT_FOCUS.width) },
    disabled: { base: color(APP_DISABLED.base, mode), alpha: number(APP_DISABLED.opacity) },
    nav: Object.fromEntries(Object.entries(NAV).map(([name, path]) => [name, color(path, mode)])),
  });
  return {
    text,
    sizes,
    radii,
    button: { paddingX: number(APP_BUTTON.paddingX), paddingY: APP_BUTTON.paddingY, minHeight: number(APP_BUTTON.minHeight) },
    light: perMode("light"),
    dark: perMode("dark"),
  };
}
