# Engine bugfix workflow

The standard loop for fixing a parity divergence.

## 1. Reproduce

```bash
yarn parity <test-name>
# or for a custom matchup:
yarn parity:test -- --deck1 <deck> --deck2 <deck> --seed <N> --max-turns <N>
```

The harness prints the first divergence: phase, active player, the field that disagrees, the Rust value, and the Java value. See `docs/PARITY_TESTING.md` for env vars (`FORGE_RNG_TRACE`, `FORGE_TRIGGER_TRACE`, `FORGE_LIFE_TRACE`).

## 2. Locate the missing rule

A divergence is a **symptom**. Find the rule.

- Identify the Forge mechanic involved (a trigger, a replacement, a static ability, a cost, a layer interaction).
- Open the Java file that owns that mechanic in `forge/forge-game/src/main/java/forge/game/`.
- Read it. Compare it to the Rust counterpart. The bug is almost always a missing branch, a missing replacement-effect callsite, a missing layer in `staticability/`, or a missing trigger registration.

If you can't tell which mechanic is involved, narrow the trace: re-run with the trace flags above and bisect by phase.

## 3. Fix the rule, not the card

The fix lives where the Java rule lives. Mirror Java's structure.

- If Java has the logic in `GameAction.checkStateEffects`, the Rust fix goes in the corresponding `action.rs` / state-based-action path. Not in the card script. Not in the effect.
- If a single card seems to need a special case, you almost certainly missed a general rule. Ask: "what would happen if a different card hit this same code path? Would it work?"

## 4. Verify

```bash
# the specific test
yarn parity <test-name>

# the full matrix (3 seeds × 7 decks = 126 matchups)
yarn parity:test -- --matrix --seeds 42,100,999 \
  --decks red_burn,green_stompy,white_aggro,black_control,comprehensive_test,trigger_expanded,staticability_test
```

Don't ship a fix that passes the failing matchup but regresses another. The matrix is the gate.

## 5. Lock the fix in

If the divergence wasn't already covered by an entry in `regression.json`, add one. See `manabrew-rs/crates/parity/AGENTS.md`.

## Rules of thumb

- **Read before writing.** Always open the Java file first.
- **Touch the smallest surface.** A bugfix that rewrites a module is a refactor in disguise.
- **Don't disable parity tests** to ship a fix. If a test legitimately needs to be ignored (e.g. known Java-side RNG gap), document it in `parity_ignore.json` with a written reason.
- **Mirror clippy disables.** If your file needs a new `#![allow(...)]`, the Java code probably justifies it. See `docs/agents/PARITY_PHILOSOPHY.md`.
