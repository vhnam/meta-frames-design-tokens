# meta-frames-design-tokens

Design tokens for Meta Frames. `tokens/tokens.json` is the single source of truth. `src/build.ts` generates the
token files for the dashboard (CSS) and the app (Dart).

## Layout

| Path                                        | Purpose                                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens/tokens.json`                        | Source tokens, [DTCG](https://www.designtokens.org/) format. Three layers: `primitive` → `semantic` → `component`.                                              |
| `tokens/bindings.json`                      | Maps tokens to client names: dashboard CSS custom properties, Flutter `ColorScheme` and theme fields, nav colours, font roles. Also names the two output files. |
| `src/build.ts`                              | Generator entry point: preflight, validation, `--inspect`, `--check`, write.                                                                                    |
| `src/hooks.ts`                              | Style Dictionary hooks: reference graph, mode projection, value transforms, CSS and Dart formats.                                                               |
| `src/oracle.ts`                             | Independent expected values. Checks the generated files without the generator code.                                                                             |
| `test/build.test.ts`, `test/oracle.test.ts` | Tests (`node --test`).                                                                                                                                          |

### Light and dark

A semantic colour holds its light value in `$value` and its dark value in
`$extensions["com.metaframes.modes"].dark`. The generator builds each mode by swapping in that value before it resolves
references.

## Outputs

The generator writes into the sibling repositories. Both must be checked out next to this repository:

```
meta-frames/
├── meta-frames-design-tokens/   (this repository)
├── meta-frames-dashboard/       → src/styles/design-tokens.generated.css
└── meta-frames-app/             → lib/ui/core/design_tokens.g.dart
```

Do not edit the generated files by hand. Each file header records the `tokens/tokens.json` sha256 and one sha256 over the
generator inputs (`package.json`, `pnpm-lock.yaml`, `src/build.ts`, `src/hooks.ts`, `tokens/bindings.json`). `--check` fails when a file
does not match.

## Requirements

- Node, at the exact version in `package.json` `engines.node`. Node runs the `.ts` files directly.
- pnpm, at the version in `package.json` `packageManager`.

## Usage

```sh
pnpm install --frozen-lockfile
pnpm build          # write both generated files
pnpm check          # confirm both files match the source
node src/build.ts --inspect   # validate and print each token, no writes
pnpm format          # oxfmt (.oxfmtrc.json)
pnpm lint            # oxlint (.oxlintrc.json)
pnpm typecheck
pnpm test
```

## Change a token

1. Edit `tokens/tokens.json` (or `tokens/bindings.json` to change a client name).
2. Run `pnpm build`, then `pnpm check`.
3. Run `pnpm test`.
4. Commit the regenerated file in each client repository, with a `CHANGELOG.md` entry there if users can see the change.
5. Add the change under `## [Unreleased]` in this repository's [CHANGELOG.md](CHANGELOG.md).

`pnpm install` also installs the Git hooks in `lefthook.yml`: format, lint, typecheck and check on pre-commit, format check and test on pre-push.

See [AGENTS.md](AGENTS.md) for the rules agents follow in this repository.
