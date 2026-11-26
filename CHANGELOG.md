# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Color roles: `primitive.color.violet` and `primitive.color.brand.stripe`; `semantic.color.process.{c41,e6,ecn2,bw}`, `highlight`, `activate`, `deactivate` and `brand.stripe`; components `chip.highlight`, `button.activate`, `button.deactivate` and `auth-card.stripe`.

## [0.2.0] - 2026-11-23

### Changed

- The generated Dart file imports `package:material_ui/material_ui.dart` instead of `package:flutter/material.dart`.
- Folder layout: sources in `src/`, tests in `test/`, token data in `tokens/`. Run the generator with `node src/build.ts`.
- oxfmt sorts imports (`sortImports` in `.oxfmtrc.json`) and puts a blank line between import groups.

### Added

- `.vscode/settings.json` and `.vscode/extensions.json`: oxc is the default formatter in the editor.
- Trivy scan (`trivy fs`, HIGH and CRITICAL) in the Lefthook pre-push job.

## [0.1.0] - 2026-11-23

### Added

- `tokens.json` as the single source of truth for design tokens.
- `build.ts` generator (Style Dictionary 5.6.0) that writes the dashboard CSS
  (`meta-frames-dashboard/src/styles/design-tokens.generated.css`) and the app Dart
  (`meta-frames-app/lib/ui/core/design_tokens.g.dart`), with `--inspect` and `--check` modes.
- `oracle.ts`, an independent check of the generated files against `tokens.json`.
- pnpm scripts: `build`, `check`, `format`, `format:check`, `lint`, `typecheck`, `test`. Node is pinned in `engines.node`.
- oxfmt (`.oxfmtrc.json`), oxlint (`.oxlintrc.json`) and Lefthook Git hooks (`lefthook.yml`).

[Unreleased]: https://github.com/vhnam/meta-frames-design-tokens/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vhnam/meta-frames-design-tokens/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vhnam/meta-frames-design-tokens/releases/tag/v0.1.0
