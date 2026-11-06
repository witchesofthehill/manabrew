# Parity baseline

A baseline is a reproducible snapshot of engine parity, not a test run. The
contract suite is the gate. The baseline says which gate we are starting from,
what the fuzz generator cannot exercise, and which failure families are largest.

Run it with:

```bash
yarn parity:baseline
```

## What it measures

| Layer             | Question                                                   | Source                                   |
| ----------------- | ---------------------------------------------------------- | ---------------------------------------- |
| Static capability | Which cards can the parser and effect registry not handle? | `parity --inventory`                     |
| Exercise coverage | Which cards can the fuzz generator not put in a deck?      | inventory exclusions                     |
| Contract          | Do the known regression entries still agree?               | `regression.json` single-matchup entries |
| Matrix            | Do the representative decks agree across seeds?            | `regression.json` matrix entries         |
| Discovery         | Do random legal decks agree?                               | `parity --fuzz`                          |
| Coverage          | Which pool cards were actually played?                     | `covered_cards` union                    |

Static capability and exercise coverage are separate on purpose. The old
`84.5%` pool figure was read as engine completeness, but most of the excluded
cards are excluded by the generator, not by the engine.

## Current snapshot

Measured on this branch after merging `main`, with a harness jar rebuilt from
the current sources and both fixes in "Fuzz errors" applied. Before the two
fixes, 7 of 50 fuzz iterations passed and 7 more could not produce a verdict
at all.

Static inventory:

- Pool: **28,712 / 33,975** (84.5%).
- Exclusions: 845 multi-faced, 1,631 no mana cost, 2,686 unusable type, 5
  parse failures, 89 unimplemented effects.
- Missing effect APIs: `FlipCoin` (47 cards), `Empower` (30), `Recruit` (8),
  and 4 cards hitting the `SubAbility` depth limit.
- Only 94 cards are blocked by the engine. The other 5,162 exclusions are
  generator scope.

Contract, matrix, and fuzz:

- Suite: **188 / 224 pass**, 35 failures, 1 error (`starter_animar`, seed 46:
  `ControlPlayerEffect` registers a delayed trigger whose `ControlPlayerCleanup`
  text is not an ability, so the trigger cannot be built).
- Matrix: **126 / 126 pass** (3 seeds × 7 decks).
- Fuzz: **8 / 50 pass**, 42 failures, 0 errors. Every iteration now produces a
  verdict.
- Coverage: **924 / 28,712** pool cards exercised (3.2 %). Another 167 cards
  the suite plays are outside the pool because they are artifacts or nonbasic
  lands — the exact type filter the generator applies.

Red entries:

| Entry                   | Result               |
| ----------------------- | -------------------- |
| `kaalia_regression`     | 0 / 10               |
| `ashling`               | 6 / 10               |
| `starter_bant_rhythm`   | 2 / 10               |
| `starter_animar`        | 4 / 10, plus 1 error |
| `worldShaper`           | 0 / 1                |
| `teval`                 | 0 / 1                |
| `payments`              | 18 / 20              |
| `realMonoBlackSacrice2` | 18 / 20              |
| `jund`                  | 19 / 20              |
| `staticability`         | 19 / 20              |

Failure clusters, by first divergence (suite + fuzz together):

| Count | Field                              |
| ----: | ---------------------------------- |
|    15 | `players[*].graveyard`             |
|    14 | `players[*].life`                  |
|    12 | `players[*].hand`                  |
|    12 | `players[*].library_size`          |
|     6 | `players[*].battlefield[*].power`  |
|     6 | `players[*].battlefield[*].tapped` |
|     5 | `players[*].library_top`           |
|     4 | `players[*].battlefield.count`     |
|     2 | `players[*].exile`                 |

The remaining two clusters are the game that loses its snapshot and the
`starter_animar` panic, which never produces one.

Every cluster is reported at Untap, so the divergences are detected at the
first snapshot after the turn that produced them; the turn number in the
cluster examples is the turn that diverged.

### Fuzz errors

The 7 fuzz errors were not divergences. Both causes are fixed.

- **3 engine panics** (iterations 0, 3, 49): the parity-profile drift guard in
  `damage_deal_effect.rs` fired — `compiled DealDamage amount diverged from
string params`. `damage_deal_effect.rs` carried its own partial amount
  evaluator (literal, `X`, `SVar`, with a `_ => 0` fallback) next to the
  canonical `AmountExpr::resolve_for_spell_ability`, so a card whose amount is
  a nested SVar expression evaluated to 0 on the compiled path while the string
  path — the one that mirrors `AbilityUtils.calculateAmount` — returned the
  real value. The duplicate evaluator is gone; `resolve_damage_amount` goes to
  the canonical resolver, and the drift guard still compares it against the
  string path. The three iterations now run to completion.
- **3 Java hangs and 1 OOM** (iterations 20, 32, 35, 30): the Java engine spun
  in `forge.game.mana.ManaCostBeingPaid.addManaCost` while paying a keyword
  cost. `GameActionUtil.addExtraKeywordCost` asks the controller for a
  multikicker count with `max = Integer.MAX_VALUE`; the harness agent drew
  uniformly from that whole range, and merging billions of copies of the cost
  made `toManaCost()` grow an `ArrayList` until the JVM hung or died.
  `DeterministicController.chooseNumberForKeywordCost` now counts how many
  times the cost stays payable, the way `PlayerControllerAi` does, and draws
  in `[0, min(payable, 20)]`. The 20 matches the cap the Rust engine already
  applies to its own multikicker bound. The four iterations now run to
  completion.

### Decisions the engines do not share

These were found while triaging the suite and are not yet fixed. Neither is a
rules bug in the usual sense: the two sides compute different bounds for the
same decision, so the games part before any effect resolves differently.

- **X announcement.** For a spell with X in its mana cost, Rust announces X by
  running the engine's own max-affordable loop and then overwrites
  `sa.x_mana_cost_paid` with that value (`cast_spell.rs`), discarding whatever
  the agent announced. Java keeps the agent's announcement, which Forge then
  bounds by what can be paid. The two bounds are not the same number.
  Reproducer: `starter_bant_rhythm` seed 43, turn 10, `Nature's Rhythm`. The
  cast and the payment are identical on both sides (four sources tapped, plus
  the extra `{G}` from `Badgermole Cub`), and both agents reach the search at
  RNG call 58. Rust resolves X=5 and offers 19 library candidates; Java's
  fetch list has 16, the set for X=4. The extra candidates change which card
  the agent picks, so the games part there and every later cluster in that
  entry (`life`, `graveyard`, `tapped`) is downstream of it.
- **Optional keyword costs.** Rust models kicker, buyback, multikicker and
  replicate as engine-side agent hooks (`choose_kicker`, `choose_buyback`,
  `choose_multikicker`, `choose_replicate`); the parity agent overrides none
  of them, so Rust always declines. Java routes all of them through
  `chooseNumberForKeywordCost` inside `addExtraKeywordCost`, one call per
  keyword in the host's keyword order, and the Java agent pays whenever the
  cost is payable and the draw says so. Games with those cards cannot agree
  until the Rust decision points have the same order, bounds, and names.

## How to read a run

`target/parity-baseline/<sha>/` contains:

- `manifest.json` — git state, binary and jar hashes, cardset hash, cache mode,
  fuzz seed, and whether Java sources are newer than the jar.
- `summary.json` / `summary.md` — the numbers and failure clusters.
- `inventory.json` — every pool card plus exclusion counts.
- `suite/` and `matrix/` — raw reports and stderr logs per entry.
- `fuzz.json` — the merged fuzz report.
- `fuzz-chunk-<n>.json` and `fuzz-chunk-<n>.log` — one file per fuzz
  iteration, so a killed fuzz phase keeps the iterations that finished.

A run is only comparable when the manifest matches: the same jar, binary,
cardset, seeds, deck list, and max-turn budget. The Java trace cache is keyed by
a source hash, so record whether the cache was enabled.

## Gating plan

The baseline starts as a report, not a gate:

1. Report only. Keep the numbers visible long enough to trust them.
2. Gate the contract suite at 100% of non-quarantined entries. Every
   `parity_ignore.json` entry needs a reason.
3. Gate deltas. The pool percentage must not fall, the matrix must not regress
   against the previous baseline, and every new fuzz cluster needs triage.

The fuzz pass rate is a health metric, not a gate, until the generator covers
artifacts, nonbasic lands, planeswalkers, DFCs, and Commander decks.

## Known limits

- The prebuilt harness jar in `forge-harness/target/` may be two-player only.
  It can be rebuilt
  without a host JDK or Maven from the parity Dockerfile:

  ```bash
  docker buildx build --target java-builder --load \
    -t manabrew-harness-builder:local \
    -f manabrew-rs/crates/parity/Dockerfile .
  docker create --name harness-builder manabrew-harness-builder:local
  docker cp harness-builder:/build/forge-harness/target/forge-harness-jar-with-dependencies.jar \
    forge-harness/target/forge-harness-jar-with-dependencies.jar
  docker rm harness-builder
  node scripts/harness.mjs update-checksum
  ```

  The rebuilt jar includes the three- and four-player pods, and the baseline
  runs `fourPlayerCommanderSmoke` against them.

- The fuzz generator only builds decks from single-faced creatures, instants,
  sorceries, enchantments, and basic lands. Artifacts, nonbasic lands,
  planeswalkers, battles, DFCs, and commanders are invisible to it.
- The `unusable type` count is a generator limit, not an engine limit. Do not
  read it as unsupported cards.
- The missing-effect histogram records the first missing API per card. A card
  can need more than one API; the histogram ranks the first blocker, which is
  what determines whether the card enters the pool.
- The fuzz pass rate is not a health metric yet. The generator cannot build
  decks with artifacts, nonbasic lands, planeswalkers, battles, DFCs, or
  commanders, so a failing iteration is as likely to be a card the corpus never
  exercised as a rules divergence.

## Next actions

1. Stop `ControlPlayerEffect` from panicking. It registers a delayed trigger
   whose `execute_svar` is `"ControlPlayerCleanup"`, which is not an ability, so
   `AbilityFactory::build_spell_ability_from_host_card` panics when the trigger
   resolves (`starter_animar`, seed 46). Java performs the same cleanup with
   `Game.getCleanup().addUntil(Runnable)`; the port needs that delayed action
   instead of a trigger carrying invented text.
2. Make X announcement one shared decision. Rust should keep the announced
   value and let payment bound it the way Forge does, or both sides should
   compute the same bound — one of the two, deliberately. Until then every
   X-spell entry can diverge at resolution.
3. Align the optional keyword decisions: give the Rust hooks the same order and
   bounds as `addExtraKeywordCost`, and implement them in the parity agent, so
   kicker/multikicker/replicate/buyback games become comparable.
4. Triage the contract-suite failures into clusters and fix the largest family
   first: `players[*].graveyard` (17) and `players[*].life` (16), carried by
   `kaalia_regression`, `ashling`, and `starter_bant_rhythm`. Re-read
   `starter_bant_rhythm` after step 2 — the X mismatch accounts for its turn-10
   cascade.
5. Expand the generator to artifacts and nonbasic lands. This is the largest
   immediate coverage gain.
6. Add planeswalkers, then DFCs, then Commander deck construction.
7. Port the missing effect APIs by card count: `FlipCoin` (47), `Empower` (30),
   `Recruit` (8), and the four cards hitting the `SubAbility` depth limit.

## Reproduce

```bash
yarn parity:baseline --out target/parity-baseline/<sha>
```

`--no-suite`, `--no-matrix`, and `--fuzz 0` scope the run. `--no-cache` reruns
every Java matchup instead of reading the trace cache.

A full run is long: the regression suite is 224 matchups and takes about half
an hour with a cold Java trace cache. Two things keep it survivable.

- The runner writes `summary.json` and `summary.md` after every phase, so a
  killed run still leaves a usable aggregate.
- `--resume` reuses the reports already sitting in the output directory
  instead of re-running them. Combine it with the phase flags to finish a
  baseline in minutes:

  ```bash
  yarn parity:baseline --resume --fuzz 50
  ```

The fuzz phase runs one iteration per process (`--fuzz-chunk`, default 1) with
a wall-clock limit per chunk (`--fuzz-timeout`, default 600 s). A fuzz game can
hang the Java engine — the harness then has to be killed, and the chunk is
recorded as a fuzz error instead of stalling the baseline. The chunk files
(`fuzz-chunk-<n>.json`) are reused by `--resume`, so a finished chunk is never
paid for twice.

Run it detached when the suite is the long pole, so a shell session cap cannot
kill it mid-phase:

```bash
setsid nohup node scripts/parity-baseline.mjs --resume \
  > target/parity-baseline/<sha>/run.log 2>&1 < /dev/null &
```
