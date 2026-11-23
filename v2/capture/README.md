# Design tokens v2 capture harness (Slice 4)

Not in Git. Read-only on both clients. Disposable scripts, same idea as `baseline/capture/` (frozen).

## Files

- `dashboard-capture.mjs`: copy of `baseline/capture/dashboard-capture.mjs` (sha256 `a45ae031992d…`), extended.
- `app_capture_test.dart`: copy of `baseline/capture/app_baseline_test.dart` (sha256 `4b06cda12526…`), extended.
- `compare.mjs`: compares a capture JSON with the expectations in `../../oracle.ts`.
- Property names, spec stacks and the expected values come from `oracle.ts`. It imports nothing from the generator.

## Run

From the workspace root.

```
node meta-frames-design-tokens/v2/capture/dashboard-capture.mjs <outDir>
(cd meta-frames-app && FLUTTER_ROOT=<flutter sdk> CAPTURE_OUT=<absolute outDir> flutter test \
  --packages=$PWD/.dart_tool/package_config.json ../meta-frames-design-tokens/v2/capture/app_capture_test.dart)
node meta-frames-design-tokens/v2/capture/compare.mjs <outDir>/dashboard-resolved.json <outDir>/app-resolved.json
```

- `--packages` must be an absolute path. A relative path fails with "must be an absolute path".
- The Dart test runs from its own folder. No file is copied into the app tree.
- Env `DASHBOARD_DIR` points the dashboard capture at another checkout. Env `APP_DIR` points the app capture at another folder that holds `assets/fonts/` (used for the font probes).
- `compare.mjs` exits 0 for no mismatch, 1 for mismatches (one line each: scope, mode, property, expected, actual), 2 for unreadable input.

## Dashboard capture (`dashboard-resolved.json`, schema 2)

- Per mode (`light`, `dark`):
  - `properties`: every `:root` property from the oracle (184 `--mf-` leaves, the 32 public properties, `--radius`): declared string, and for colours the painted value and RGBA bytes alone, over white and over black.
  - `swatches`: `bg-<name>` utility sample for each public colour (includes chart 1 to 5).
  - `sidebar`: container, active, idle and primary item colours.
  - `fonts`: computed family for `font-heading`, `font-sans` and `font-mono`.
  - `sizes.16px` and `sizes.20px`: computed size, line height and weight for `text-xs` to `text-3xl` (and `text-4xl`, recorded only), `p-*` padding, `--radius` and `rounded-*`.
  - `focusRing`: `:focus-visible` state and the outline colour over white and black.
  - `dots`: `bg-dots` background image and size.
  - `audit`: the `font-mono` audit ID sample, its used faces and face statuses.
- `faces`: one sample per face (Space Grotesk, Geist Mono, JetBrains Mono) with its computed family and the platform fonts used, and the faces that loaded.
- PNG: `dashboard-{light,dark}.png` and `dashboard-{light,dark}-20px.png` (root size 20 px).
- The run fails and writes nothing if a face has no `@font-face`, a sample does not use the loaded custom face, a computed family differs from the spec stack, or a face is not loaded.
- Fixture colours are read through Tailwind utilities compiled from the dashboard's own `index.css`.
  Before adoption the `--mf-` properties are not defined, so they read as empty. That is expected.

### Listener guard

`lsof -nP -iTCP:5199 -sTCP:LISTEN -Fpn` gives one `n` line for each listening socket. The guard passes only if there is exactly one listener, on `127.0.0.1:5199`, and `ps -o pgid=` gives the spawned process group for its PID. It runs before the capture and before the write. It fails on:

- an IPv6 or wildcard listener,
- a second listener, in either family and in the same group or not,
- a listener in another group,
- no listener,
- an `lsof` error (exit above 1, or exit 1 with output on stderr) or a `ps` error.

## App capture (`app-resolved.json`, schema 2, and `goldens/*.png`)

- Per mode:
  - `colorScheme`: ARGB of the 31 explicit fields.
  - `surfaces` (card, dialog), `nav` colours, `inputFocus` colour and width.
  - `disabled`: text and icon colour with `alphaExact` (the alpha before byte quantization).
  - `text`: the 15 `TextTheme` slots as rendered inside `MaterialApp` (family, size, line-height multiplier, weight). The theme alone has no Material sizes until `MaterialApp` localizes it.
  - `sizes`, `radii`, `button` padding and minimum height.
  - `samples`: rendered body (`bodyMedium`), data (`labelMedium`, mono) and heading (`headlineMedium`) at text scale 1.0 and 2.0: family, weight, size and laid-out box.
- `fonts`: width of a sample string in each registered family and in an unregistered family.
- Goldens: scaffold, card, dialog, nav selected, nav idle, disabled controls, body text, data text, for both modes at text scale 1.0 and 2.0 (32 files, 400x640, device pixel ratio 1.0). The test writes them, it does not compare.
- Fails when a font asset is missing, or when a family renders with the same width as an unregistered one (the asset did not load).

## What `compare.mjs` checks

- Dashboard: every `--mf-` property and public property in both modes, each public colour swatch, sidebar states, the focus ring (`--ring` at 50%, applied once), `bg-dots` size and colour, font stacks and loaded faces, `text-xs` to `text-3xl` size, line height and weight at 16 px and 20 px, and `p-*` padding from `--spacing`.
  Not compared (no expectation in the oracle): `rounded-*` utilities and `text-4xl`.
- App: all 31 scheme fields (`inversePrimary` from the opposite mode), card and dialog background, nav colours, input focus colour and width, disabled alpha applied once, the 15 text slots, the size bindings, radii, button padding and minimum height, rendered samples at both scales, font assets.
- Alpha colours are compared over white and over black. Opaque colours must match exactly. Alpha-colour channels and the dashboard canvas values may differ by 1 (focus ring: 2).

## Probes

`meta-frames-design-tokens/v2/evidence/pre-adoption/probes/run-probes.mjs [listener|fonts]` runs the listener and font probes. A fake `vp` (`fake-vp.mjs`) opens real sockets. Result lines are in `pre-adoption/probes.txt`.
Node has no `reusePort` on macOS (`ENOTSUP`), so the two same-group listeners use one IPv4 and one IPv6 socket in two processes of the spawned group.

## Open dependencies

- None. No capture value depends on open decisions 1 to 3.
