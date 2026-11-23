# Design tokens baseline (Slice 1)

Not in Git. Captured 2026-11-21 before any token migration. Production code unchanged.

## Repositories

| Repo | HEAD SHA | `git status --porcelain --untracked-files=all` |
| --- | --- | --- |
| meta-frames-app | 0ccb92b20abaacd6413bc172c42fac5367f04ccf | (empty, clean) |
| meta-frames-dashboard | 86ae0ce63fa2b357241ab6332646e3aba20f10a4 | (empty, clean) |

## Files

- `dashboard/dashboard-resolved.json`: for `light` (`:root`) and `dark` (`.dark`): all 32 properties (declared string, painted `background-color`, RGBA bytes alone / over white / over black), `--radius` and `rounded-sm/md/lg/xl` at 16px and 20px root, `--font-heading`/`--font-sans`, `--spacing` and `p-*` utilities, `--text-*` and `--text-*--line-height` with browser-computed px.
- `dashboard/dashboard-light.png`, `dashboard/dashboard-dark.png`: full page of `/app/stocks` (sidebar, dots, keyboard focus ring), plus an injected fixture (5 chart swatches, 7 role swatches, focused input, dot tile, ring over a white/black split).
- `dashboard/browser-version.txt`.
- `app/app-resolved.json`: `toARGB32()` of 31 explicit `ColorScheme` fields (every field in spec § Flutter bindings; `brightness` is not a colour), nav background/indicator/label/icon colours for selected and unselected, disabled text/icon colour with exact alpha (`alphaExact`, before byte quantization).
- `app/{scaffold,card,dialog,navbar}-{light,dark}.png`: goldens, 400x400 at device pixel ratio 1.0.
- `capture/dashboard-capture.mjs`, `capture/app_baseline_test.dart`: disposable scripts.

## Versions

- Node: v26.13.1
- Browser: Chromium 159.0.8154.6 (Playwright 1.65.1, headless, bundled build)
- vp: vp v1.7.0  Local vite-plus: 
- Flutter: Flutter 3.47.9 • channel stable • https://github.com/flutter/flutter.git;Framework • revision c197ca5199 (3 weeks ago) • 2026-10-29 10:10:20 -0400;Engine • hash 9e025265bef30b838c0c1b68cad19decf97048f2 (revision 89c39edfdf) (24 days ago) • 2026-10-27 19:51:20.000Z;
- Dart: Dart SDK version: 3.13.7 (stable) (Thu Oct 22 14:28:57 2026 -0700) on "macos_arm64"
- OS: Darwin 27.2.0 27.2

## Capture settings

Dashboard: `vp dev --host 127.0.0.1 --port 5199 --strictPort` with `VITE_API_URL=http://127.0.0.1:18999` (nothing listens; Playwright routes mock `/auth/me` and `/film-stocks` with 5 stocks, all other calls return `[]`). Viewport 1280x800, device scale 1, `reducedMotion: reduce`, locale en-US, timezone UTC, `localStorage.theme=light` then class `.dark` toggled, animations and transitions forced off, `document.fonts.ready` awaited (loaded: Geist Mono Variable, Space Grotesk Variable). Full-page PNG. No chart page exists in the dashboard, so chart colours are checked by swatches in the fixture and by the JSON.
Tailwind emits only used theme variables, so `--text-*` at runtime is partial (`emittedAtRuntime`). The capture script compiles the dashboard's own `src/styles/index.css` with `@tailwindcss/node` (resolved from the real path of `node_modules/@tailwindcss/vite`; nothing installed) for candidates `text-xs` to `text-9xl` and `p-96`, injects that CSS into the page, and measures computed `fontSize` and `lineHeight` of one element per class in `:root` and in `.dark`, and the padding of `p-96` (384px). The injected style is removed before screenshots. `rounded-*` resolved through utility classes already in the page CSS.

Determinism (fix round 1): the capture ran twice on the same trees (both repos clean at the SHAs above, Node, Chromium and Playwright as listed). `dashboard-resolved.json`, `dashboard-light.png`, `dashboard-dark.png` and `browser-version.txt` are byte-identical across the two runs (`cmp`). Against the first baseline the PNGs are byte-identical; the JSON differs only by the removed `themeCss` fields and `p-96` 0px -> 384px.

App: `FLUTTER_ROOT=<sdk> BASELINE_OUT=design-tokens/baseline/app flutter test --packages=<app>/.dart_tool/package_config.json --update-goldens design-tokens/baseline/capture/app_baseline_test.dart`, run from `meta-frames-app`. Fonts loaded from `assets/fonts/*.ttf` and the SDK MaterialIcons font via `FontLoader`. Text scale 1.0. Goldens use the host `flutter_tester` renderer; compare on the same OS and Flutter version.
To compare later: rerun without `--update-goldens` (goldens resolve to `../app/` from the test file), and diff the JSON.

## Slice 3d: dashboard baseline with JetBrains Mono (2026-11-21)

Nam's JetBrains Mono change is in the dashboard working tree and is part of this baseline. The Slice 1 dashboard set moved unchanged to `dashboard-slice1/`. `dashboard/` is the new set, and is the one for the zero-pixel comparison (spec § Acceptance evidence 1, "Dashboard font baseline"). The app baseline in `app/` is unchanged. The file list and settings above describe Slice 1; the capture script now also does the following.

- Adds `font-mono` to the compiled candidates and probes `--font-mono` (`fonts["--font-mono"]` in the JSON: declared and computed font-family).
- Adds one fixture sample, `font-mono text-xs`, with an entity-ID-like string (as in `AuditLogPage.vue:56`), shown in both mode PNGs.
- `monoSample` in the JSON: `beforeLoad` (computed font-family and the status of every `JetBrains Mono Variable` face at insert; the used face goes `unloaded` -> `loading` at style recalculation), `afterLoadUsedFonts` and `perMode.{light,dark}` (computed font-family, Chromium's platform fonts for the node via `CSS.getPlatformFontsForNode`, face statuses). Chromium names the used font `JetBrains Mono` (the font file's name) with `isCustomFont: true`.
- Fails (exit 1, nothing written) if: the computed font-family is not `"JetBrains Mono Variable", ui-monospace, monospace`; no `@font-face` for the family exists; the sample does not render with a custom JetBrains Mono face in either mode; or the face is not among the loaded faces. Outputs are collected in memory and written only after every check passes.
- Refuses to start if port 5199 already serves something, and kills the whole dev-server process group on exit. Before this change a `vp dev` child process could outlive a run and serve later runs; it served the same working tree, so no recorded value changed (rerun outputs equal the earlier ones byte for byte).
- Env `DASHBOARD_DIR` points the script at another checkout (used for the forced run).

Results: two runs on the same tree gave byte-identical `dashboard-resolved.json`, both PNGs and `browser-version.txt`. The JSON differs from `dashboard-slice1/` only in `light.fonts.--font-mono`, `dark.fonts.--font-mono`, `monoSample` and `loadedFontFaces` (adds `JetBrains Mono Variable 100 800`). Forced run on a temporary dashboard copy with the Fontsource import removed: exit 1 (`no @font-face for JetBrains Mono Variable: the Fontsource import is missing`), output directory not created.

| Repo | HEAD SHA | `git status --porcelain --untracked-files=all` |
| --- | --- | --- |
| meta-frames-app | 0ccb92b20abaacd6413bc172c42fac5367f04ccf | ?? lib/ui/core/design_tokens.g.dart |
| meta-frames-dashboard | 86ae0ce63fa2b357241ab6332646e3aba20f10a4 | M package.json;  M pnpm-lock.yaml;  M src/styles/index.css; ?? src/styles/design-tokens.generated.css |

Dashboard working-tree files (sha256):

```
b2fce02dd3cf538acdf979cafcc60f531523b05d3bbe497a17978cfde6f92b33  package.json
f3dd95cb6f7c2d28690d92c523da2d9d3e0a0b8c7639ae21e8cb06b4dcca8cd4  pnpm-lock.yaml
1a853be9ae90f7fe4a894dce56a841883cc6582a62b0a9ed27863db8e1184e6b  src/styles/index.css
dd095b3b7dffec2b704e6dac999bfb8ff646d4d00dc5e67768c2dd7d92d70a94  src/styles/design-tokens.generated.css
```

App generated file (sha256):

```
5c383a4ea5eba71b77e888260f7614c983184caaf39ef53e50a2f3f6b770219b  lib/ui/core/design_tokens.g.dart
```

## SHA-256 (baseline files)

```
2f8bd02656e96be6d46751a9d26cb52d365431bbd1ceec0480e64b3cdb9bec67  dashboard-slice1/browser-version.txt
1edcedf15b86cc45c2e4af519ec6453a560a1bb10db967c13ebc25a350dafe9d  dashboard-slice1/dashboard-dark.png
2baa83b9219a57c2015a0296ddfb2671ba7920863decbe5fa87dd589c54a883b  dashboard-slice1/dashboard-light.png
59ecae7053be42c5aefa287928911f53ef4e8bd4831dd1d2825803eeddeeb531  dashboard-slice1/dashboard-resolved.json
2f8bd02656e96be6d46751a9d26cb52d365431bbd1ceec0480e64b3cdb9bec67  dashboard/browser-version.txt
e16e81722f7aa031ecc276610d99593653895a2f5866f9d8c00465a94fb9b73f  dashboard/dashboard-dark.png
09086203a5e7c80c1763a1226a6467ae6f283a464095d69f1933f825297a0d1c  dashboard/dashboard-light.png
7d76061a8c8aa6b8e8f9947501ea75e8bcc8fb6e41eb5d65dc1e976f95aa04cf  dashboard/dashboard-resolved.json
71a535d8d383f32f1d2ec64548fd02899476a8ba581423e351022841a1cfcd3c  app/app-resolved.json
b280d782a6528104cb7506da4219012660e8345acea7cdbc1ca1dcf844cb8dbb  app/card-dark.png
11cd9a074c559187520e51228e93b2db4a59bc1278c91ef05bb40cac53d8b51a  app/card-light.png
346fced8b882f2516b7969b7dadb3641b9c622c99a0a5323b52bc5268f124908  app/dialog-dark.png
eafbd92f541a17a304a5981ff64379a1202d35939b8d3392a356e65667bf8820  app/dialog-light.png
f364eedbd00c2cc12fc12285109b38c88156f19da7fb839c697f4a8f43034666  app/navbar-dark.png
481c523a68f198c904c1abd9a60a1f48c632895962abf3575de21b76f89d9915  app/navbar-light.png
b35395fd7065950c689f638336346a7a00b6ba43ded28f8706ba9e9c65d419e3  app/scaffold-dark.png
8bbdce244841cf18a1c9fae70a1492e923c00771860c7c72ace37f26c1384638  app/scaffold-light.png
```

v1 baselines are frozen before-images. v2 evidence lives in `design-tokens/v2/evidence/`.
