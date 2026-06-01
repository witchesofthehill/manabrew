# ManaBrew — Agent Guide

ManaBrew is a Tauri desktop/web client for Magic: The Gathering, powered by a Rust rewrite of the [Forge](https://github.com/Card-Forge/forge) rules engine.

- **UI**: React + TypeScript under `src/`, Tauri shell under `src-tauri/`
- **Engine**: Rust workspace under `forge-engine/crates/`, the rules engine being ported from Java
- **Java reference**: `forge/` — read-only; the source of truth for parity
- **Parity harness**: `forge-engine/crates/forge-parity/` — runs Rust and Java side-by-side and compares traces

The engine is incomplete. Most day-to-day work is **finding parity bugs** with `yarn parity` and fixing them.

## Prime directive: root-cause, not symptom

Every engine fix must restore long-term correctness of the underlying mechanic — not patch the one card that triggered the bug report. If a single card seems to need a special case, that is almost always wrong: the general rule lives somewhere in Forge — find it, port it, mirror it.

Before writing the fix:

1. Read the corresponding Java file in `forge/forge-game/`.
2. Identify the rule the Rust port is missing, not the symptom that exposed it.
3. Mirror Forge's logic — same file names, same symbol names, same control flow.

Symptom-only fixes will be rejected in review. Full workflow: `docs/agents/ENGINE_BUGFIX_WORKFLOW.md`.

## Code-quality discipline

The project is large; every line is a long-term liability. Before adding code:

- **Read first.** Inspect the Java counterpart and the existing Rust file. Use the `scan-feature-parity` skill to confirm names/paths.
- **Mirror Java structure exactly.** Same file names (snake_case), same module layout, same method names. Do not invent. See `docs/agents/PARITY_PHILOSOPHY.md`.
- **Extend before creating.** Prefer adding to the existing file that already mirrors the Java side over a new one.
- **No premature abstraction.** Three similar lines beat a clever generic. No defensive code at internal boundaries. No speculative error handling.
- **Bound the change.** A bugfix touching 12 files needs justification. If it can be one or two, do that.
- **Do not add comments.** This is a hard rule, not a preference — the maintainer has repeatedly rejected over-commented diffs. The default for any new code (fields, methods, constants, blocks) is **zero comments**. Do not write doc-comments for self-explanatory members. Do not narrate what the code does — the reader can read code. A comment is allowed _only_ when intent is genuinely unrecoverable from the code itself: a hidden invariant, a "keep in sync with X" parity constraint, a workaround for a specific upstream bug, a non-obvious quirk mirroring Java. Matching the comment density of surrounding code is **not** a justification. Never narrate the edit: no "this used to be X", no "previously we …", no "added to handle …". When unsure, write nothing. Good naming and small functions are the documentation.

## Navigation map — read this before every task

Sub-AGENTS.md files are not auto-discovered by Codex or by Claude Code's parent-directory scan. **Consult this table at the start of any task** and read every file whose scope your change touches.

| File                                                             | Read it before                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/AGENTS.md`                                                  | Any change under `src/`                                                     |
| `src/components/game/AGENTS.md`                                  | Any change under `src/components/game/` (game board, modals, panels, zones) |
| `src/components/companion/AGENTS.md`                             | Any change under `src/components/companion/` (paper-play life tracker)      |
| `src-tauri/AGENTS.md`                                            | Any change under `src-tauri/`                                               |
| `forge-engine/AGENTS.md`                                         | Any Rust engine work — workspace map and engine module map                  |
| `forge-engine/crates/forge-engine/src/ability/effects/AGENTS.md` | Adding or modifying a `*_effect.rs` (most parity work)                      |
| `forge-engine/crates/forge-parity/AGENTS.md`                     | Investigating a parity divergence or editing `regression.json`              |
| `forge/AGENTS.md`                                                | Anything under `forge/` (read-only warning)                                 |
| `forge-harness/src/main/java/forge/harness/AGENTS.md`            | Any change under `forge-harness/` (parity/host/common package boundaries)   |
| `scripts/AGENTS.md`                                              | Adding or running a build/parity script                                     |

Topic spinoffs (cross-cut multiple folders):

| File                                    | Read it when                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `docs/agents/PARITY_PHILOSOPHY.md`      | Any engine work                                                                                          |
| `docs/agents/ENGINE_BUGFIX_WORKFLOW.md` | Investigating a parity divergence                                                                        |
| `docs/agents/UI_THEME_RULES.md`         | Any UI change that involves color                                                                        |
| `docs/forge-dsl-semantics.md`           | Any engine work touching abilities, triggers, replacements, static abilities, costs, SVars, or the stack |
| `docs/forge-dsl-grammar.md`             | Parser / IR changes, or when interpreting card-script syntax                                             |

These files start minimal and grow over time. If a section outgrows its file, split it into a new doc under `docs/agents/` and add it to this map.

## Before every commit

Run these three checks **for every commit**, no exceptions. They apply regardless of which part of the codebase you touched.

### 1. Lint, format, and typecheck

```bash
yarn lint:all      # eslint + prettier --check + tsc + cargo fmt --check + cargo clippy -D warnings
```

If lint fails, do **not** bypass it. Fix the underlying issue, or run:

```bash
yarn fix:all       # eslint --fix + prettier --write + cargo fmt + tsc
yarn format:all    # prettier --write + cargo fmt (formatting only — no lint or typecheck)
```

Never use `--no-verify` to skip the commit-msg or pre-commit hooks. If a hook fails, fix the cause.

### 2. Keep AGENTS.md current

Re-read every AGENTS.md whose scope overlaps the files you changed. If anything in those files is now inaccurate — a moved or renamed path, a deleted module, a removed convention, an outdated workflow step, a stale code example — update it in the same commit. Use the navigation map above to find which files apply.

Stale guidance is worse than missing guidance: it actively misleads future agents and slowly erodes trust in this whole system. Treat AGENTS.md files as part of the code — when the code moves, they move with it.

### 3. Write a Conventional Commits message

The `commit-msg` git hook (`commitlint` + `@commitlint/config-conventional`) rejects anything else.

**Format:** `<type>(<scope>)?: <subject>`

- **Allowed types:** `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.
- **Subject:** lowercase, no trailing period, ≤72 chars.
- **Scope** (optional): the area of the change — `engine`, `ui`, `parity`, `tauri`, `agents`, `lint`, etc.
- **Breaking changes:** `feat!: …` or include a `BREAKING CHANGE:` footer.

**Examples:**

```
feat(engine): wire mana cost parser
fix(ui): clamp deck list height on small screens
refactor(staticability): unify layer dispatch
docs(agents): document SVar lazy resolution rule
chore: bump prettier
perf(carddb): avoid re-parsing SVars on card load
```

The PR body itself must follow `.github/pull_request_template.md`: `Summary`, `Why`, `Test plan`, `Build artifacts` in that order. Tick `Build macOS .dmg` / `Build Windows .exe` only when the PR should produce installers on merge.

## Workflow rules

- **Branch + PR** — never push to `main`. Never push code automatically; wait for an explicit push command.
- **Pull with merge, never rebase.** When integrating `main` into a feature branch, or pulling someone else's work, use `git merge` (or `git pull` with `pull.rebase=false`) — never `git rebase`, never `git pull --rebase`. The repo's history convention is merge-based; rebasing rewrites already-pushed commits and creates divergence for collaborators. This applies to every branch, every time.
- **No unit tests** unless explicitly asked.
- **UI work** must reference `docs/STYLE_GUIDELINES.md` (and `docs/agents/UI_THEME_RULES.md` for colors).
- **Non-trivial tasks** load the `crew-orchestrator` skill first (DISCOVER → PLAN → APPROVAL → EXECUTE → REVIEW → TEST). Trivial tasks (one-liners, simple questions, file renames) skip it.

## Hygiene

If something in the project surprises you, flag it to the developer and add a note to the AGENTS.md file most relevant to the surprise so future agents avoid the same trap. Do not leave behind scratch `.md` files; use a repo-local tmp directory if you need scratch space.
