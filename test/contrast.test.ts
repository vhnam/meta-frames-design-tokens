import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { canonical, readSource } from '../src/oracle.ts';

const { leaves } = readSource(
  readFileSync(join(import.meta.dirname, '../tokens/tokens.json'), 'utf8'),
);

const PREFIX = 'semantic.color.';
const TEXT_MINIMUM = 4.5;
const CONTROL_MINIMUM = 3;
const MODES = ['light', 'dark'] as const;

// [foreground, background] pairs, relative to PREFIX.
const textPairs: [string, string][] = [
  ...['canvas', 'surface', 'surface-raised', 'subtle'].map((bg): [string, string] => [
    'fg.default',
    `bg.${bg}`,
  ]),
  ['fg.muted', 'bg.canvas'],
  ['fg.muted', 'bg.surface'],
  ['fg.on-primary', 'action.primary'],
  ['fg.on-accent', 'action.accent'],
  ['fg.on-danger', 'action.danger'],
  ['fg.inverse', 'bg.inverse'],
  ...['success', 'warning', 'danger', 'info', 'neutral'].map((name): [string, string] => [
    `status.${name}.fg`,
    `status.${name}.bg`,
  ]),
  ...['c41', 'e6', 'ecn2', 'bw'].map((name): [string, string] => [
    `process.${name}.fg`,
    `process.${name}.bg`,
  ]),
  ['highlight.fg', 'highlight.bg'],
  ...['activate', 'deactivate'].flatMap((name): [string, string][] => [
    [`${name}.fg`, `${name}.bg`],
    [`${name}.fg-hover`, `${name}.bg-hover`],
  ]),
];

const controlPairs: [string, string][] = ['border.control', 'border.focus'].flatMap(
  (border): [string, string][] => [
    [border, 'bg.canvas'],
    [border, 'bg.surface'],
  ],
);

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(path: string, mode: 'light' | 'dark'): number {
  const {
    r: red,
    g: green,
    b: blue,
    a: alpha,
  } = canonical(leaves, PREFIX + path, mode) as {
    r: number;
    g: number;
    b: number;
    a: number;
  };
  assert.equal(alpha, 255, `${PREFIX + path} (${mode}) must be opaque, alpha is ${alpha}`);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function ratio(foreground: string, background: string, mode: 'light' | 'dark'): number {
  const [light, dark] = [luminance(foreground, mode), luminance(background, mode)].sort(
    (first, second) => second - first,
  );
  return (light! + 0.05) / (dark! + 0.05);
}

for (const [pairs, minimum] of [
  [textPairs, TEXT_MINIMUM],
  [controlPairs, CONTROL_MINIMUM],
] as const) {
  for (const [foreground, background] of pairs) {
    for (const mode of MODES) {
      test(`${foreground} on ${background} (${mode}) is at least ${minimum}:1`, () => {
        const value = ratio(foreground, background, mode);
        assert.ok(
          value >= minimum,
          `${PREFIX}${foreground} on ${PREFIX}${background} (${mode}): ${value.toFixed(2)}:1 is below ${minimum}:1`,
        );
      });
    }
  }
}
