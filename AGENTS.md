# Design tokens generator

`tokens.json` is the source of truth. `build.ts` reads it with `bindings.json` and writes two generated files into the sibling repositories:

- `../meta-frames-dashboard/src/styles/design-tokens.generated.css`
- `../meta-frames-app/lib/ui/core/design_tokens.g.dart`

The script resolves all paths from its own location. Both sibling checkouts must exist next to this repository.

## Toolchain

- Use pnpm (`packageManager` in `package.json`). Do not use npm or yarn, and do not add `package-lock.json`.
- `package.json` `engines.node` pins Node. `pnpm-workspace.yaml` sets `engineStrict: true`, so `pnpm install` fails on another Node. `build.ts` also stops if `process.version` is not the pin.
- Node runs the `.ts` files directly (type stripping). Do not add `tsx`, a bundler, or `.mjs` / `.js` entry files. Keep `erasableSyntaxOnly` code: no `enum`, no `namespace`, no parameter properties.
- `package.json` pins `style-dictionary` to an exact version. Do not use a range.

## Commands

Run from this repository unless the line says otherwise.

| Task                                            | Command                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Install                                         | `pnpm install --frozen-lockfile`                                                    |
| Generate both files                             | `pnpm build` (or `node meta-frames-design-tokens/build.ts` from the workspace root) |
| Check that both files match the source          | `pnpm check`                                                                        |
| Check the source and print a summary, no writes | `node build.ts --inspect`                                                           |
| Format                                          | `pnpm format`                                                                       |
| Lint                                            | `pnpm lint`                                                                         |
| Type check                                      | `pnpm typecheck`                                                                    |
| Test                                            | `pnpm test`                                                                         |

## Rules

- Do not edit the generated files by hand. Change `tokens.json` or `bindings.json`, run `pnpm build`, then `pnpm check`.
- A change to a generator input changes the `Generator:` sha in both headers. The generator inputs are `bindings.json`, `build.ts`, `hooks.ts`, `package.json` and `pnpm-lock.yaml`. Regenerate after the change, and commit each generated file in its own repository.
- `oracle.ts` computes the expected values without the generator. Do not import `build.ts`, `hooks.ts`, `bindings.json` or Style Dictionary into `oracle.ts`.
- `build.ts` reads each generator input once at startup. Later checks and the digest use those bytes. Keep that rule when you add an input.

## Validation

Before review, run in this repository: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check`. Lefthook (`lefthook.yml`) runs format (fixes and restages), lint, typecheck and check on pre-commit, and format check and test on pre-push. oxfmt (`.oxfmtrc.json`) does not format `tokens.json`, `bindings.json` or `pnpm-lock.yaml`: their bytes go into the generated headers. If a generated file changed, also run the checks of that repository (see the workspace `AGENTS.md`, Workflow §4).

## Git Commits

- Do not add a `Co-Authored-By` trailer (or any other Claude attribution) to commit messages. Write the subject and body only.
- Write each commit message to the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/#specification) specification.

## Changelog

- Keep `CHANGELOG.md` in the [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format, with versions that follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
- Add every user-facing change under `## [Unreleased]`, in the matching section: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` or `Security`.
- To release, rename `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a new empty `## [Unreleased]` above it, update the compare links at the bottom of the file, set `version` in `package.json`, commit, and tag the commit `vX.Y.Z`.
- A token change that users can see also goes in the `CHANGELOG.md` of each client repository, in the same commit as its regenerated file.

## Naming

- Do not use single-character variable names, including callback parameters, loop indices and destructured values. Name the thing it holds: `roll`, `stock`, `index`, `event`, not `r`, `s`, `i`, `e`. `_` for an unused parameter is allowed. `pnpm lint` enforces it (oxlint `id-length` in `.oxlintrc.json`).
