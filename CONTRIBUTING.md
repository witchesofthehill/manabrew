# Contributing to manabrew

Thanks for helping. This project is public pre-release software, so the best
contributions are small, reproducible, and easy to review.

## Start with an issue

For anything larger than a typo, start from an existing issue or open one first.
Good issue reports include:

- what you expected;
- what happened instead;
- steps to reproduce;
- deck names, seed, and `yarn parity:test` command when the bug is engine-side;
- screenshots or short screen recordings for UI bugs;
- platform information for Tauri, WASM, or multiplayer problems.

Use the issue templates when possible. They are designed to capture the details
that usually decide whether a report is immediately actionable.

## Development setup

Install the main dependencies:

```bash
yarn install
```

Run the desktop client:

```bash
yarn dev
```

Run the web client:

```bash
yarn dev:web
```

Build the Java Forge harness when doing parity work:

```bash
yarn build:harness
```

Then run a parity matchup:

```bash
yarn parity:test -- --deck1 red_burn --deck2 green_stompy --seed 42 --max-turns 20
```

## Engine contribution workflow

The engine is a Rust port of Forge. Do not fix engine bugs by guessing from card
text alone.

1. Reproduce the divergence with `yarn parity` or `yarn parity:test`.
2. Identify the Forge mechanic involved: effect, trigger, replacement, static
   ability, cost, mana, combat, zone change, or state-based action.
3. Read the Java source under `forge/forge-game/`.
4. Read the Rust counterpart under `forge-engine/crates/forge-engine/`.
5. Port the missing rule in the matching Rust module.
6. Re-run the failing parity command.
7. Run the narrowest additional parity coverage that could catch a regression.

If the fix seems to require a card-specific branch, stop and look for the
general Forge rule that card is exercising.

Required background:

- [docs/agents/PARITY_PHILOSOPHY.md](./docs/agents/PARITY_PHILOSOPHY.md)
- [docs/agents/ENGINE_BUGFIX_WORKFLOW.md](./docs/agents/ENGINE_BUGFIX_WORKFLOW.md)
- [docs/forge-dsl-semantics.md](./docs/forge-dsl-semantics.md)
- [docs/FORGE_PARITY_AND_IR.md](./docs/FORGE_PARITY_AND_IR.md)

## UI contribution workflow

For UI work, read:

- [docs/STYLE_GUIDELINES.md](./docs/STYLE_GUIDELINES.md)
- [docs/agents/UI_THEME_RULES.md](./docs/agents/UI_THEME_RULES.md) when changing
  colors

Keep UI logic out of the rules engine. The engine decides legality and produces
prompts; the UI renders state and returns player choices.

## AI-assisted contributions

AI tools are allowed, but the author of the PR is responsible for the result.
Do not submit generated code you cannot explain.

Use AI where it is strongest here:

- comparing Java and Rust files;
- summarizing parity traces;
- generating mechanical ports that are then reviewed line by line;
- producing inventories and documentation drafts.

Avoid using AI as a rules oracle. Forge Java behavior and parity traces are the
source of truth. See [docs/AI_USAGE.md](./docs/AI_USAGE.md).

## Commit format

Use Conventional Commits:

```text
fix(engine): apply replacement effects during combat damage
docs(readme): explain manabrew naming status
feat(ui): add deck import progress state
```

Allowed types are `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`,
`test`, `build`, `ci`, and `revert`.

Every commit should include a DCO signoff:

```text
Signed-off-by: Your Name <you@example.com>
```

You can add this automatically with:

```bash
git commit -s
```

## Pull requests

Before opening a PR:

```bash
yarn lint:all
```

For engine PRs, also include the exact parity commands you ran. For UI PRs,
include the browsers or platforms you checked.

PR descriptions should use this structure:

```markdown
## Summary

## Why

## Test plan

## Build artifacts
```

## What not to include

- Card images.
- Secrets, API keys, tokens, or local `.env` files.
- Large unrelated refactors attached to bug fixes.
- Generated artifacts unless the repository already tracks that artifact type.
- Changes to vendored Forge files unless the issue is specifically about
  maintaining the Java reference or harness.

## License

By contributing, you agree that your contribution is licensed under the same
license as the file you changed. Most of the repository is GPL-3.0-or-later.
`docs/PROTOCOL.md` is CC-BY-4.0.
