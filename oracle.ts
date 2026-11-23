// Independent expected values for the generated files. This file imports nothing from the
// generator: no Style Dictionary, no hooks.ts, no bindings.json. It walks the source JSON on its
// own and holds the spec tables, transcribed by hand from
// docs/ai-workflow/spec-design-tokens-v2.md (Dashboard bindings, Flutter bindings, Font delivery)
// and plan decisions 6 and 7.

// ---- the oracle's own types (not shared with the generator) ----

type Mode = 'light' | 'dark';
interface SourceLeaf {
  type: string | undefined;
  value: unknown;
  dark: unknown;
}
type Leaves = Map<string, SourceLeaf>;
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface DimensionCanon {
  px: number;
  cssUnit: 'rem' | 'px';
  cssNumber: number;
}
type Canon =
  | Rgba
  | DimensionCanon
  | { milliseconds: string }
  | { authored: unknown }
  | number
  | unknown[];
type CssExpectation =
  | { kind: 'stack'; stack: string[] }
  | { kind: 'value'; type: string | undefined; canon: Canon }
  | { kind: 'var'; name: string };
type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ---- spec: dashboard public properties (path starts at semantic.color) ----
export const DASHBOARD_PUBLIC = [
  ['--background', 'bg.canvas'],
  ['--foreground', 'fg.default'],
  ['--card-foreground', 'fg.default'],
  ['--popover-foreground', 'fg.default'],
  ['--secondary-foreground', 'fg.default'],
  ['--accent-foreground', 'fg.default'],
  ['--card', 'bg.surface'],
  ['--popover', 'bg.surface-raised'],
  ['--primary', 'action.primary'],
  ['--primary-foreground', 'fg.on-primary'],
  ['--secondary', 'action.secondary'],
  ['--muted', 'bg.subtle'],
  ['--accent', 'bg.subtle'],
  ['--muted-foreground', 'fg.muted'],
  ['--destructive', 'action.danger'],
  ['--border', 'border.default'],
  ['--input', 'border.control'],
  ['--ring', 'border.focus'],
  ['--chart-1', 'chart.1'],
  ['--chart-2', 'chart.2'],
  ['--chart-3', 'chart.3'],
  ['--chart-4', 'chart.4'],
  ['--chart-5', 'chart.5'],
  ['--sidebar', 'bg.surface'],
  ['--sidebar-foreground', 'fg.muted'],
  ['--sidebar-primary', 'action.accent'],
  ['--sidebar-primary-foreground', 'fg.on-accent'],
  ['--sidebar-accent', 'bg.subtle'],
  ['--sidebar-accent-foreground', 'fg.default'],
  ['--sidebar-border', 'border.default'],
  ['--sidebar-ring', 'border.focus'],
  ['--dot', 'border.default'],
].map(([property, source]) => [property!, `semantic.color.${source}`] as [string, string]);

// ---- spec: Flutter ColorScheme (path starts at semantic.color) ----
export const COLOR_SCHEME = [
  ['primary', 'action.primary'],
  ['onPrimary', 'fg.on-primary'],
  ['primaryContainer', 'bg.subtle'],
  ['onPrimaryContainer', 'fg.default'],
  ['secondary', 'action.secondary'],
  ['onSecondary', 'fg.default'],
  ['secondaryContainer', 'bg.subtle'],
  ['onSecondaryContainer', 'fg.default'],
  ['tertiary', 'action.accent'],
  ['onTertiary', 'fg.on-accent'],
  ['tertiaryContainer', 'status.success.bg'],
  ['onTertiaryContainer', 'status.success.fg'],
  ['error', 'action.danger'],
  ['onError', 'fg.on-danger'],
  ['errorContainer', 'status.danger.bg'],
  ['onErrorContainer', 'status.danger.fg'],
  ['surface', 'bg.canvas'],
  ['onSurface', 'fg.default'],
  ['onSurfaceVariant', 'fg.muted'],
  ['surfaceContainerLowest', 'bg.canvas'],
  ['surfaceContainerLow', 'bg.surface'],
  ['surfaceContainer', 'bg.surface'],
  ['surfaceContainerHigh', 'bg.subtle'],
  ['surfaceContainerHighest', 'bg.surface-raised'],
  ['outline', 'border.control'],
  ['outlineVariant', 'border.default'],
  ['inverseSurface', 'bg.inverse'],
  ['onInverseSurface', 'fg.inverse'],
  ['shadow', 'bg.scrim'],
  ['scrim', 'bg.scrim'],
].map(([field, source]) => [field!, `semantic.color.${source}`] as [string, string]);
// inversePrimary reads action.primary from the opposite mode.
export const INVERSE_PRIMARY = 'semantic.color.action.primary';

// ---- spec: navigation (Flutter bindings paragraph) ----
export const NAV: Record<string, string> = {
  bar: 'component.nav.bg',
  divider: 'component.nav.border',
  indicatorFill: 'component.nav.indicator',
  selectedIcon: 'semantic.color.fg.on-accent',
  selectedLabel: 'component.nav.item-fg-active',
  idleIcon: 'component.nav.item-fg',
  idleLabel: 'component.nav.item-fg',
  activeRowBackground: 'component.nav.item-bg-active',
};

// ---- spec: font delivery ----
export const FONT_ROLES: Record<
  string,
  { stack: string[]; registration: string; property: string }
> = {
  heading: {
    stack: ['"Space Grotesk Variable"', 'ui-sans-serif', 'sans-serif'],
    registration: 'SpaceGrotesk',
    property: '--font-heading',
  },
  body: {
    stack: ['"Geist Mono Variable"', 'ui-monospace', 'monospace'],
    registration: 'GeistMono',
    property: '--font-sans',
  },
  mono: {
    stack: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
    registration: 'JetBrainsMono',
    property: '--font-mono',
  },
};
// [semantic.text role, dashboard role, flutter role]
const TEXT_FONTS: [string, string, string][] = [
  ['display', 'heading', 'heading'],
  ['heading-1', 'heading', 'heading'],
  ['heading-2', 'heading', 'heading'],
  ['heading-3', 'heading', 'heading'],
  ['body', 'body', 'body'],
  ['body-sm', 'body', 'body'],
  ['caption', 'body', 'body'],
  ['data', 'mono', 'mono'],
  ['label', 'body', 'mono'],
];

// ---- plan decision 6: dashboard text steps; radius and spacing ----
const TEXT_STEPS: [string, string][] = [
  ['xs', 'caption'],
  ['sm', 'body-sm'],
  ['base', 'body'],
  ['lg', 'heading-3'],
  ['xl', 'heading-2'],
  ['2xl', 'heading-1'],
  ['3xl', 'display'],
];
const RADIUS_PATH = 'semantic.radius.control';
const SPACING_PATH = 'semantic.space.gap.xs';

// ---- independent source walk ----

/** Parses the source text. Returns { leaves: Map(path -> { type, value, dark }) } with inherited types. */
export function readSource(text: string): { leaves: Leaves } {
  const tree: unknown = JSON.parse(text);
  if (!isObject(tree)) throw new Error('oracle: tokens.json root must be an object');
  const leaves: Leaves = new Map();
  const walk = (node: JsonObject, trail: string[], inherited: string | undefined): void => {
    const type = (node.$type ?? inherited) as string | undefined;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      if (!isObject(child))
        throw new Error(`oracle: ${[...trail, key].join('.')} must be an object`);
      const entry = child;
      if ('$value' in entry) {
        const extensions = entry.$extensions;
        const declared = isObject(extensions) ? extensions['com.metaframes.modes'] : undefined;
        const modes = isObject(declared) ? declared : undefined;
        leaves.set([...trail, key].join('.'), {
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
function resolve(
  leaves: Leaves,
  path: string,
  mode: Mode,
): { type: string | undefined; value: unknown } {
  const type = leaves.get(path)?.type;
  let current = path;
  for (let hops = 0; hops < 10; hops += 1) {
    const leaf = leaves.get(current);
    if (!leaf) throw new Error(`oracle: no leaf ${current} (from ${path})`);
    const value = mode === 'dark' && leaf.dark !== undefined ? leaf.dark : leaf.value;
    if (typeof value !== 'string' || !/^\{.+\}$/.test(value)) {
      // Spec dimension row: a nonnegative finite decimal followed by "px".
      if (
        type === 'dimension' &&
        !(
          typeof value === 'string' &&
          /^\d+(?:\.\d+)?px$/.test(value) &&
          Number.isFinite(parseFloat(value))
        )
      ) {
        throw new Error(
          `oracle: ${current}: dimension must be a px string, found ${JSON.stringify(value)}`,
        );
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
  const own = path.split('.').at(-1);
  switch (type) {
    case 'color':
      return parseHex(value as string);
    case 'dimension': {
      const px = parseFloat(value as string);
      return {
        px,
        cssUnit: own === 'font-size' ? 'rem' : 'px',
        cssNumber: own === 'font-size' ? px / 16 : px,
      };
    }
    case 'fontWeight':
    case 'number':
      return value as number;
    case 'duration':
      return { milliseconds: (value as string).slice(0, -2).replace(/^0+(?=\d)/, '') };
    case 'cubicBezier':
      return value as unknown[];
    case 'fontFamily':
      return { authored: value };
    default:
      throw new Error(`oracle: unsupported type ${type} at ${path}`);
  }
}

export const semanticAndComponentPaths = (leaves: Leaves): string[] =>
  [...leaves.keys()].filter((path) => !path.startsWith('primitive.'));
export const cssNameOf = (path: string): string => `--mf-${path.replaceAll('.', '-')}`;
export const dartNameOf = (path: string): string =>
  path
    .split(/[.-]/)
    .map((word, index) => (index ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join('');

/** Role of a semantic text font-family path: [dashboard role, flutter role]. */
function fontRolesOf(path: string): [string, string] | null {
  const match = /^semantic\.text\.([^.]+)\.font-family$/.exec(path);
  const row = match && TEXT_FONTS.find(([role]) => role === match[1]);
  return row ? [row[1], row[2]] : null;
}

// ---- expected CSS and Dart content (canonical, platform-neutral where possible) ----

const css = (leaves: Leaves, path: string, mode: Mode): CssExpectation => {
  const roles = fontRolesOf(path);
  return roles
    ? { kind: 'stack', stack: FONT_ROLES[roles[0]]!.stack }
    : { kind: 'value', type: leaves.get(path)!.type, canon: canonical(leaves, path, mode) };
};

/** Expected property values per selector: { theme, root, dark } as Map(property -> expectation). */
export function expectedCss(leaves: Leaves): {
  theme: Map<string, CssExpectation>;
  root: Map<string, CssExpectation>;
  dark: Map<string, CssExpectation>;
} {
  const theme = new Map<string, CssExpectation>();
  for (const role of Object.values(FONT_ROLES))
    theme.set(role.property, { kind: 'stack', stack: role.stack });
  theme.set('--spacing', css(leaves, SPACING_PATH, 'light'));
  for (const [step, role] of TEXT_STEPS) {
    theme.set(`--text-${step}`, css(leaves, `semantic.text.${role}.font-size`, 'light'));
    theme.set(
      `--text-${step}--line-height`,
      css(leaves, `semantic.text.${role}.line-height`, 'light'),
    );
    theme.set(
      `--text-${step}--font-weight`,
      css(leaves, `semantic.text.${role}.font-weight`, 'light'),
    );
  }
  const paths = semanticAndComponentPaths(leaves);
  const publicAliases = DASHBOARD_PUBLIC.map(([property, path]): [string, CssExpectation] => [
    property,
    { kind: 'var', name: cssNameOf(path) },
  ]);
  const root = new Map<string, CssExpectation>(
    paths.map((path) => [cssNameOf(path), css(leaves, path, 'light')]),
  );
  for (const [property, expectation] of publicAliases) root.set(property, expectation);
  root.set('--radius', { kind: 'var', name: cssNameOf(RADIUS_PATH) });
  const dark = new Map<string, CssExpectation>(
    paths
      .filter((path) => leaves.get(path)!.type === 'color')
      .map((path) => [cssNameOf(path), css(leaves, path, 'dark')]),
  );
  for (const [property, expectation] of publicAliases) dark.set(property, expectation);
  return { theme, root, dark };
}

const DART_TYPE: Record<string, string> = {
  color: 'Color',
  dimension: 'double',
  fontFamily: 'String',
  fontWeight: 'FontWeight',
  number: 'double',
  duration: 'Duration',
  cubicBezier: 'Cubic',
};

/** Expected Dart fields per class, and the ColorScheme arguments for each mode. */
export function expectedDart(leaves: Leaves) {
  const paths = semanticAndComponentPaths(leaves);
  const fields = (mode: Mode) =>
    new Map<string, { type: string; canon: Canon }>(
      paths
        .filter((path) => leaves.get(path)!.type === 'color')
        .map((path) => [dartNameOf(path), { type: 'Color', canon: canonical(leaves, path, mode) }]),
    );
  const shared = new Map<string, { type: string | undefined; canon: Canon | string }>();
  for (const path of paths) {
    const { type } = leaves.get(path)!;
    if (type === 'color') continue;
    const roles = fontRolesOf(path);
    shared.set(dartNameOf(path), {
      type: DART_TYPE[type!],
      canon:
        type === 'fontFamily'
          ? FONT_ROLES[roles![1]]!.registration
          : type === 'dimension'
            ? (canonical(leaves, path, 'light') as DimensionCanon).px
            : canonical(leaves, path, 'light'),
    });
  }
  const scheme = (mode: Mode) => {
    const opposite = mode === 'light' ? 'DesignTokensDark' : 'DesignTokensLight';
    return new Map<string, string>([
      ['brightness', `Brightness.${mode}`],
      ...COLOR_SCHEME.map(([field, path]): [string, string] => [field, dartNameOf(path)]),
      ['inversePrimary', `${opposite}.${dartNameOf(INVERSE_PRIMARY)}`],
    ]);
  };
  return {
    shared,
    light: fields('light'),
    dark: fields('dark'),
    schemes: { light: scheme('light'), dark: scheme('dark') },
  };
}
