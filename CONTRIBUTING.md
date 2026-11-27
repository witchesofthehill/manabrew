# Contributing toManabrew

First things first, thanks so much for helping. The easiest contributions to review are small,
issue-backed, reproducible, and checked locally before the PR is opened.

**Manabrew Engine and its parity tooling are deprecated.** Do not open PRs
against either unless a maintainer explicitly requests the work. Report
gameplay issues against the runtime you used. Forge powers regular play.

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
5. **Open a PR from your fork.** Include the issue, what changed, and the exact
   checks you ran.
6. **Respond to review.** Maintainers review on a best-effort basis and may ask
   for changes before merging.

GitHub adds component labels based on the changed paths when a PR opens. It
does not remove labels.

- `UI` covers React components, views, and the Pixi board.
- `manabrew-engine` covers the Rust rules engine.
- `forge-engine` covers the Forge submodule. Changes to `forge-harness/` get
  `forge-harness` instead.
- `manabrew-protocol` covers the Rust game and relay protocol crates, the
  `@manabrew/protocol` TypeScript package, and the generated types in `bindings/`.
- `manabot` covers the bot crate, its WASM adapter, and its browser worker.

## Start with an issue

For anything larger than a typo, start from an existing issue or open one first.

Good issue reports include:

- what you expected;
- what happened instead;
- steps to reproduce;
- the runtime, format, decks, and sequence of plays for gameplay bugs;
- screenshots or short screen recordings for UI bugs;
- platform information for Tauri, WASM, or multiplayer problems;
- one of the issue templates, when possible.

## Development setup

After forking, clone your fork and follow the README setup:

- [Getting Started](./README.md#getting-started)
- [Common Commands](./README.md#common-commands)

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

Use AI to navigate the active code, find relevant checks, or draft documentation.
Verify gameplay claims against the rules and the runtime involved. See
[docs/AI_USAGE.md](./docs/AI_USAGE.md) for scope and review expectations.

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

## Releasing

Releases are continuous and automatic — there is no release branch, release
PR, or manual bump step. On every merge to `main`, CI (`release.yml`) runs
`cargo xtask release`, which:

1. Computes a bump for **each crate independently** (non-lockstep) from the
   conventional commits since that crate's last release tag, parsed by
   [git-cliff](https://git-cliff.org). A commit counts for every crate whose
   files it touches: breaking (`!` or `BREAKING CHANGE:`) → major (pre-1.0
   crates bump 0.x → 0.x+1, cargo's incompatibility boundary), `feat` →
   minor, `fix`/`perf`/`refactor`/`revert` and unconventional messages →
   patch, `docs`/`style`/`chore`/`test`/`build`/`ci` → no bump. Crates that
   depend on a released crate get at least a patch. The desktop app (the
   plain `vX.Y.Z` tags) is the exception: commits bump it at most minor.
   Nothing depends on the app's API, so an app major is a product decision.
   To cut one, hand-set the version.
2. Commits `chore(release): …` straight to `main` with the new versions
   (Cargo.tomls, `package.json`/`tauri.conf.json` mirrors, `Cargo.lock`,
   `CHANGELOG.md`, `ops/manifest.json`).
3. Tags each released crate (`<crate>-vX.Y.Z`; the desktop app owns the plain
   `vX.Y.Z` tags), creates the GitHub Release with notes, and lets the tag
   push kick off the installer builds while the manifest deploys to
   `play.manabrew.app/manifest.json` for the auto-updaters.
4. Publishes pending crates to crates.io (idempotent, allowlisted by
   `publish` flags in each Cargo.toml).

What this means for your PR:

- **The squash-merge title is the commit that drives versioning** — write it
  as a proper conventional commit. A breaking change bumps major on _every_
  crate the PR touches (the app caps at minor); if that's too broad, split
  the PR. For per-commit granularity, use a merge commit instead of
  squashing.
- The **Release plan** check on the PR shows exactly what would be released
  on merge.
- To force a specific version (e.g. cutting a milestone), hand-set it in the
  crate's `Cargo.toml` in the PR: the release run honors any version ahead of
  the last tag. Preview locally with `cargo xtask plan` (needs `git-cliff` on
  PATH: `brew install git-cliff`).

## What not to include

- Card images.
- Secrets, API keys, tokens, or local `.env` files.
- Large unrelated refactors attached to bug fixes.
- Generated artifacts unless the repository already tracks that artifact type.
- Changes to vendored Forge files unless the issue is specifically about
  maintaining the Java reference or harness.

## License

By contributing, you agree that your contribution is licensed under the same
license as the file you changed. Most of the repository is AGPL-3.0-or-later. The
vendored `forge/` tree stays GPL-3.0-or-later. The
protocol specification under `website/src/content/docs/protocol/`
([docs.manabrew.app/protocol](https://docs.manabrew.app/protocol/)) is CC-BY-4.0.
