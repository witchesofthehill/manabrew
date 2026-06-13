# Contributing to ManaBrew

First things first, thanks so much for helping. The easiest contributions to review are small,
issue-backed, reproducible, and checked locally before the PR is opened.

## Contribution flow

Use this path for most contributions:

1. **Pick up an issue.** Start from an existing issue, or open one before doing
   larger work. Make sure you assign the issue to yourself, and put it as "InProgress" so other people don't pick up the same issue as you
2. **Fork the repository.** Create your own fork and make changes on a branch in
   that fork.
3. **Implement the change.** Keep the patch focused on the issue. Avoid
   unrelated refactors.
4. **Check correctness locally.** Run the relevant commands before asking for
   review.
5. **Open a PR from your fork.** Include the issue, what changed, the exact
   checks you ran, and any regression entry added for engine work.
6. **Respond to review.** Maintainers review on a best-effort basis and may ask
   for changes before merging.

## Start with an issue

For anything larger than a typo, start from an existing issue or open one first.

Good issue reports include:

- what you expected;
- what happened instead;
- steps to reproduce;
- deck names, seed, and `yarn parity:test` command when the bug is engine-side;
- screenshots or short screen recordings for UI bugs;
- platform information for Tauri, WASM, or multiplayer problems;
- one of the issue templates, when possible.

## Development setup

After forking, clone your fork and follow the README setup:

- [Getting Started](./README.md#getting-started)
- [Common Commands](./README.md#common-commands)
- [Parity Harness](./README.md#parity-harness)

Use the parity section when working on engine issues; engine PRs should include
the exact parity commands you ran.

## Engine contribution workflow

The engine is a Rust port of Forge. Do not fix engine bugs by guessing from card
text alone. A good engine PR shows both the root cause and the parity commands
that prove the fix.

1. Reproduce the divergence with `yarn parity` or `yarn parity:test`.
2. Identify the mechanic involved: effect, trigger, replacement, static
   ability, cost, mana, combat, zone change, or state-based action.
3. Familiarize yourself with the rules, or the java forge reference implementation.
4. Fix the wrongly implemented rule in the matching Rust module.
5. Re-run the failing parity command.
6. Run the narrowest additional parity coverage that could catch a regression.
7. Include those commands and results in the PR description.

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

AI tools are allowed and encouraged, but the author of the PR is responsible for the result.
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

Keep the PR reviewable:

- Link the issue it fixes or explains.
- Describe the behavior change, not just the files touched.
- Mention any known limitations or follow-up work.
- Do not mix unrelated cleanup with a bug fix.

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
