# MASTER PLAN — Faithful phase-ai port onto manabrew (forge-engine)

Synthesis of all foundation + api + per-module specs in this directory. Target crate:
`forge-engine/crates/forge-ai` (exists; today only `eval.rs`/`stats.rs`/`lib.rs`). Engine
package is `forge-engine` (aliased `forge_engine_core`) + `forge-foundation`.

The whole port is dominated by **three architectural facts** manabrew does not share with
phase-rs, repeated in nearly every spec:

1. **No typed `Effect` AST.** phase keys behaviour off a closed `Effect`/`TargetFilter`/
   `QuantityExpr` enum tree. manabrew keys off an open `ApiType` verb (~210 variants) + a
   loosely-typed `SpellAbilityIr` operand bag, with only 8 numeric APIs lowered to `EffectIr`.
   Every effect/category/polarity read is rebuilt against `(ApiType, &SpellAbilityIr)`.
2. **No reified decision point / no unified action / no pure `apply`.** phase carries
   `WaitingFor` on the state, one `GameAction` enum, and `apply(state, action)`. manabrew is
   push/callback-driven through `PlayerAgent`; combat/mana/triggers live on `GameLoop`, **not**
   `GameState`. There is no single-step reducer.
3. **No deck metadata on state.** No `deck_pools`, no `DeckEntry`, no `CommanderBracketTier`,
   no `Deadline`, no `quick_state_hash`. Decks are consumed at setup and discarded; the bot
   must thread its own decklist in from agent construction.

---

## 1. FOUNDATIONS STATUS

### 1.1 The sim hook — STOPPED, does **not** compile (no code written), no resume story yet

`foundation-sim-hook.md`: **no code change was made**, so nothing compiled (the intended check
was `CARGO_TARGET_DIR=/tmp/mb-ai cargo check -p forge-engine-core`, never run). The task's
proposed one-line hook (wire `advance_from_current` to `run_turn_state_machine`) was correctly
**refused** because it is unsound:

- `run_turn_state_machine` (`game_loop/phase_handler.rs:4`) takes **no entry-phase parameter**
  and hardcodes `let mut state = TurnMachineState::Untap` (`:36`). It unconditionally re-fires
  the `BeginTurn` replacement + `TurnBegin` triggers (`:11-34`) and walks Untap→…→Cleanup from
  the top, re-running untap (resets mana pool), the draw step, and every phase's
  `EnterPhase`/priority window. A "resume" would corrupt the very mid-turn state the AI wants
  to simulate forward from, and the Cleanup arm ends by *advancing the turn*.
- `TurnMachineState` (`game_loop.rs:127`) is private, has 9 variants with a single `Combat`,
  while `PhaseType` has 13 incl. **six** combat sub-phases. **No `PhaseType→TurnMachineState`
  mapping exists**, and `step_combat` runs all of combat as one atomic unit — so a
  `game.turn.phase` inside combat cannot map to a resumable entry.

**Resume story = it does not exist.** A correct resume needs a real turn-state-machine redesign:
(1) split the `BeginTurn`/`TurnBegin` preamble into a separate `begin_turn()`; (2) add a
`PhaseType→TurnMachineState` mapping (decide combat: disallow resuming inside combat, or refactor
`step_combat` into a resumable sub-state machine); (3) decide per-phase whether `EnterPhase`/
`emit_phase_trigger` re-runs on resume (must be skipped or Phase/Always triggers + `BeginPhase`
replacements double-fire — likely needs an entry at the phase's `PriorityWindow`, not its
`EnterPhase`); (4) make `TurnMachineState` `pub(crate)`. **This needs engine-owner design
sign-off before any code.** It is the binding gate on faithful, exact mid-turn projection and on
step-granular `apply`.

The projection/search specs converge on a pragmatic substitute that does **not** require
mid-turn resume: a **`GameLoop::run_until(predicate)`** driver (~40-line engine addition wrapping
the existing turn machine + `abort_signal`) plus a scripted `ProjectionAgent`/`SimUnit`. That is
the recommended path for v1; the mid-turn-resume redesign is a separate, deferrable engine
project.

### 1.2 IR effect-classification design — sound, build-incremental, three tiers

`foundation-classification.md` + `api-ir.md`: a **pure, side-effect-free** classifier in a new
`forge-ai/src/classify.rs`, over `CardState::get_intrinsic_spell_abilities()` →
`(sa.api: ApiType, &sa.ir: SpellAbilityIr)`, walking `sa.sub_ability` for chained effects and
`sa.pay_costs` for cost-side signals. Produces an `EffectCategory` set (Removal, BoardWipe,
Tutor, Ramp, Draw, Counterspell, SacOutlet, Copy, Pump, Lifegain, Discard, Bounce, Mill,
Counters, Tokens, Tapper, Reanimation, Untap, …). The engine ships **no** `ApiType→category`
map by design — forge-ai owns the taxonomy. Three tiers drive build order:

- **Clean tier (verb-only):** Draw, Counterspell, BoardWipe (`*All`), Lifegain, Discard,
  Counters, Tokens, Pump, Tapper/Untap. Reproduces 6 of phase's 7 shipped `EffectProfile` flags
  directly from real IR.
- **Needs-work tier:** Removal (targeted vs burn-to-face needs `valid_tgts`), Bounce/Tutor/Mill/
  Reanimation/exile-Removal (all gated on `ir.origin_zone`/`destination_zone`/`hidden` via a
  shared `classify_change_zone`), SacOutlet (cost-side `CostPart::Sacrifice` filter ≠ `CARDNAME`),
  Ramp (`is_mana_ability`/`ProducedMana`), Copy (tag clean, value hard).
- **Infeasible-at-this-layer / deferred:** cost reducers & "can't"/stax (live in `staticability`,
  not `SpellAbility` IR), SVar-gated modal payloads (lazy-IR invariant — accept partial
  classification, tag `Other`), drain-correlation/copy-value (cross-node, deferred). The
  Beneficial/Harmful/Contextual **polarity** axis (`effect_classify.rs`) is **orthogonal** and
  ported separately over `StaticMode`/`ContinuousModification` inputs — do not fold into
  `EffectCategory`.

Build order: clean tier → `classify_change_zone` → `is_sac_outlet` + `classify_ramp` → defer the
rest. Keep it pure so it also runs on `forge-card-script::ParsedCardScript` pre-game (draft).

---

## 2. DEPENDENCY-ORDERED LAYERS (compile-together groups)

Each layer compiles on the layers below it. "→" = key intra/inter-layer deps. Engine-side
additions are flagged **[ENGINE]**.

### Layer 0 — Foundations & primitives (engine-facing; no phase-ai deps)
- **[ENGINE] Sim adapter** — `SimUnit { game, mana_pools, combat, trigger_handler }` (mirror
  `GameSnapshot`), `apply_as_current(unit, AiAction)`, **`GameLoop::run_until(predicate)`**.
  *Single largest net-new piece; the feasibility gate for projection/planner/search.*
- **[ENGINE, deferred] mid-turn `run_turn_state_machine_from`** — the §1.1 redesign; **not**
  required for v1 (run_until substitutes). Needs design sign-off.
- `util::Deadline` (wall-clock; wasm no-op), `bracket::CommanderBracketTier`, `deck::DeckEntry`.
- `ai_support` shim: `Decision`/`WaitingFor` reification, `AiAction`/`GameAction`/`TargetRef`,
  `CandidateAction`/`TacticalClass`/`AiDecisionContext`, `build_decision_context` over
  `PriorityActionSpace`.
- `classify.rs` (EffectCategory foundation), `ability_chain` (`collect_chain_abilities`).

### Layer 1 — Leaf eval helpers & classification (engine-agnostic math + simple reads)
- `eval.rs` — EvalWeights/**EvalWeightSet**/KeywordBonuses, board_stats, threat_level,
  strategic_intent, creature_combat_value, evaluate_state_breakdown. *Stub* `planner::ValueEstimate`
  + `projection::Projection`. **Critical-path: nearly everything scoring depends on it.**
- `cast_facts.rs` (EffectProfile, CastFacts) → classify/IR.
- `card_advantage.rs`, `mana_colors.rs`, `deck_knowledge.rs`.
- `projection` *types only* (Projection, ProjectionHorizon, VelocitySample, ProjectionKey,
  `threat_velocity`) — leaf; `project_to` deferred to L4.

### Layer 2 — Deck profile, config, polarity, simple detectors
- `deck_profile.rs` (DeckArchetype, DeckProfile, ArchetypeMultipliers) → eval + forge-card-script
  verb parse.
- `strategy_profile.rs` → deck_profile. **(Faithful, zero engine coupling.)**
- `config.rs` (AiConfig, PolicyPenalties, presets) → eval/deck_profile/strategy_profile shapes.
  **(Faithful, pure data.)**
- `zone_eval.rs` → deck_profile + thread `&[ManaPool]`.
- `effect_classify.rs` (polarity axis), `damage_reflection.rs` → classify/Trigger resolution.
- `synergy.rs` (SynergyGraph) → raw-script CardFace classifiers.
- `decision_kind.rs` → `policies::registry::DecisionKind` + ai_support.

### Layer 3 — Features, plan, threat, hints, draft
- `features/*` (landfall **first** — owns fetchland disambiguator — then mana_ramp, control,
  aristocrats, tokens_wide, tribal, plus_one_counters, spellslinger_prowess, aggro_pressure) +
  `features/mod.rs` (DeckFeatures) → IR bridge + deck_profile + strategy_profile. *Net-new
  subsystem; biggest IR-impedance surface.*
- `plan/mod.rs` + `plan/curves.rs` (PlanSnapshot, TempoClass) → features + deck_profile.
  **(curves.rs Faithful, zero engine coupling.)**
- `threat_profile.rs` → deck_knowledge + deck_profile + zone_eval. **(stats Faithful.)**
- `card_hints.rs` (should_play_now) → cast_facts + eval + hand_disruption(stub).
- `draft_eval.rs` → cast_facts + eval + mana_colors.

### Layer 4 — Session, context, projection driver
- `projection::project_to` + `ProjectionAgent` → **[ENGINE] run_until + SimUnit** (L0).
- `session.rs` (AiSession) → features + plan + synergy + projection + `planner::quick_state_hash`
  + injected decks (drop `from_game(state)`; thread decks from agent factory).
- `context.rs` (AiContext) → deck_profile + eval + session + strategy_profile + synergy +
  threat_profile + Deadline + DeckEntry + CommanderBracketTier.

### Layer 5 — Policy framework + policies + combo
- `policies/{mod,registry,context}.rs`, `strategy_helpers.rs`, `activation.rs`, `mulligan/mod.rs`
  → config + context + features + decision_kind + cast_facts + eval + `planner::PolicyPrior` +
  ai_support. **(registry/prior softmax Faithful; context Adapted.)**
- `combo/line.rs` + `combo/detection.rs` (must fetch — not yet specced) → `combo/registry.rs`.
- `stack_awareness.rs`, `hand_disruption.rs` (consumed by card_hints + tactical_gate).
- Tactical policies in batch order: **A** (no foundation) → **C clean-tier** → **C needs-work** →
  **B polarity** (`anti_self_harm` 142 KB last) → **C heavy/deferred** (`redundancy_avoidance`
  75 KB last). Mulligan **D** (land-count/tribal first; `cedh_keepables` last).

### Layer 6 — Combat + gate
- `combat_ai.rs` → config + eval + damage_reflection + projection(optional).
- `tactical_gate.rs` → combat_ai + effect_classify + stack_awareness + policies::context +
  ai_support; threads `Option<&CombatState>`.

### Layer 7 — Search, planner, driver (top)
- `planner/mod.rs` (PlannerServices, SearchBudget, BeamContinuationPlanner, UtilityReducers,
  quick_state_hash, apply_candidate, quiesce) → adapter + eval + policies + context + cast_facts +
  card_hints. **(search math Faithful once adapter exists.)**
- `search.rs` (choose_action, score_candidates, deterministic_choice, softmax) → planner +
  policies + combat_ai + threat_profile + tactical_gate + zone_eval + card_advantage +
  tribute_eval + ai_support.
- `auto_play.rs` → becomes a `PlayerAgent` wrapping `search::choose_action`.
- `tribute_eval.rs` — **Infeasible entry**; ship scorer-only stub, gate off until Tribute exists.

---

## 3. PER-MODULE SUMMARY + MAIN RISK

| Module | One-line summary | Main risk |
|---|---|---|
| sim-hook (engine) | mid-turn resume of the turn state machine | **STOPPED**; needs full turn-machine + combat sub-state redesign + sign-off |
| classify.rs | EffectCategory over ApiType+IR | needs-work tier (zone-direction, sac-outlet, ramp) + deferred SVar/static tiers |
| ai_support (shim) | reify Decision/CandidateAction/AiAction over callbacks | net-new infra; gating dep for policies/search |
| SimUnit/apply/run_until (engine) | one-action sim driver | no pure `apply`; combat/mana/triggers off-GS; clone cost vs time cap |
| eval.rs | static board evaluator (weights verbatim) | raw vs layered P/T; build `commander_lethal_headroom`; per-player zone scan |
| cast_facts.rs | 7 EffectProfile flags + CastFacts | typed Effect→ApiType+IR; trigger `execute` is an SVar, must build override SA |
| card_hints.rs | should_play_now priority [0..1] | Effect→IR; PlayLand→land cast; needs eval+hand_disruption |
| ability_chain | flatten sub_ability chain | leaf type Effect→SpellAbility; trivial |
| card_advantage.rs | resource differential | per-owner battlefield iteration (controller semantics) |
| mana_colors.rs | distinct producible colors of a land | ManaType→u16; ProducedMana coarser, loses "any"-color enumeration |
| zone_eval.rs | archetype-tuned zone quality | DeckArchetype dep; ManaPool off-GS (thread `&[ManaPool]`); haste-aware sickness |
| tribute_eval.rs | CR 702.104 pay/decline scorer | **INFEASIBLE**: no Tribute keyword/prompt/TributeNotPaid in engine |
| deck_profile.rs | archetype classifier + multipliers | typed Effect → raw card-script verb parse |
| strategy_profile.rs | archetype→behavioral multipliers | none (pure data) |
| deck_knowledge.rs | honest remaining-library tracker | decklist not on GS (thread from RegisteredPlayer); lossy name key |
| synergy.rs | per-card deck synergy graph | raw-script predicate fidelity; DeckEntry bridge needs CardDatabase |
| combo/registry.rs | hand-authored win-combo lines | blocked on unspecced combo/line.rs + combo/detection.rs; hardcoded ability_index |
| features/* + mod | per-deck structural archetype classifiers | **highest IR-impedance**; assembled-IR-vs-DSL-strings decision; fetchland disambiguator load-bearing |
| plan/curves.rs | static expected-curve schedule | none (zero engine coupling); upstream DeckFeatures fidelity |
| threat_profile.rs | hypergeometric opponent-hand threat | typed Effect→IR; `TargetFilter::Any`→valid_tgts text; available_mana dep |
| projection.rs | forward-sim to opponent combat horizon | re-architected push-based (ProjectionAgent+run_until); clone cost vs 15 ms cap; determinism |
| session.rs | per-game Arc cache (features/plan/projection) | `deck_pools` absent (inject decks); needs quick_state_hash + project_to |
| context.rs | per-perspective analysis bundle | three local primitives (Deadline/DeckEntry/CommanderBracketTier) substituted |
| decision_kind.rs | WaitingFor→DecisionKind routing | no WaitingFor (per-callback kinds + priority dispatch); loses exhaustive-match safety |
| policies/registry+context | trait + registry + prior softmax + PolicyContext | registry Faithful; context needs R1 Effect + R2 candidate reification + R5 legal-targets query |
| ~47 tactical + 11 mulligan | individual heuristic policies | each re-expressed over category/polarity reads; `anti_self_harm`/`redundancy_avoidance` are sub-projects |
| effect_classify.rs | Beneficial/Harmful/Contextual polarity | separate axis over StaticMode/ContinuousModification inputs |
| damage_reflection.rs | reflect-damage detector + penalty | penalty math Faithful; EventContextAmount has no typed analogue (SVar heuristic) |
| combat_ai.rs | attack/block decision-maker | global→per-player; Option-power→layered; must-attack via requirement set; PW→DefenderId::Permanent |
| tactical_gate.rs | hard/soft pre-scoring filter | Effect shim + CombatState threading; AbilityCondition gate fail-open v1 |
| planner/mod.rs | beam/rollout/quiesce search engine | depends on adapter (`apply_candidate`); clone cost per node |
| search.rs | decision front-end (softmax/scoring) | adapter prerequisite; no WaitingFor/cancel-cast model; math verbatim |
| auto_play.rs | AI-vs-AI driver | no `apply`/WaitingFor → becomes PlayerAgent; per-action event granularity lossy |
| draft_eval.rs | context-free draft-pick scorer | CardFace→Card template; Modal→Charm IR; EffectProfile fidelity |
| config.rs | difficulty presets + tunable penalties | none (engine-agnostic); needs EvalWeightSet shape ported |

---

## 4. RISK REGISTER — Faithful / Adapted / Infeasible

### Faithful (direct port; engine-agnostic math, only renames/stubs)
- `strategy_profile.rs`, `plan/curves.rs` — **zero** engine coupling; 1:1 transcription.
- `config.rs` — pure data/presets; carry every constant byte-for-byte.
- `ability_chain` — verbatim chain walk (leaf type Effect→SpellAbility).
- **Math cores carried verbatim** inside otherwise-Adapted modules: `planner` (SearchBudget,
  UtilityReducers, beam α-β + `0.05`, softmax, `rank_candidates`, `local_combinations`,
  `evaluate_card_value`, MAX_QUIESCE_STEPS=20, cache=256); `registry` prior shift/normalize
  (`0.01` floor, `delta*activation`); `threat_profile` hypergeometric + archetype table; `eval`
  weight tables + threat coefficients; `combat_ai` objective/should-attack/race-clock formulas;
  `damage_reflection` `-12.0` penalty; `card_hints`/`tactical_gate`/`draft_eval` weight tables.
  *These must not drift; they are the AI's behaviour.*

### Adapted (rebuilt against manabrew IR/architecture — the bulk of the work)
- **Effect-typing cluster (R1, pervasive):** `classify.rs`, `cast_facts.rs`, `effect_classify.rs`,
  `card_hints.rs`, `deck_profile.rs`, `threat_profile.rs`, `synergy.rs`, `damage_reflection.rs`,
  `draft_eval.rs`, plus every Batch-C policy — all replace the typed `Effect` enum with
  `(ApiType, &SpellAbilityIr)` matching. Coverage risk: `SearchLibrary`/`Bounce` are not verbs
  (zone-direction on `ChangeZone`); trigger/replacement `execute` is an SVar name (must build an
  override `SpellAbility`, colliding with the lazy-IR invariant — build on demand for the few
  immediate-ETB triggers).
- **Decision/candidate reification (R2):** `ai_support` shim, `decision_kind.rs`, policy
  framework — manabrew never enumerates+scores candidates; build `Decision`/`CandidateAction`/
  `AiDecisionContext` over `PriorityActionSpace` + per-callback context. Loses the
  exhaustive-`WaitingFor`-match safety net.
- **No pure `apply` (R1 of search, HIGH):** `SimUnit` + `apply_as_current` + `run_until` + the
  `planner`/`search`/`projection`/`auto_play` rebuild. Policy/weights faithful; control flow
  necessarily different. Clone cost (deep `Vec<Card>` + GameLoop side-state) vs node budgets and
  the 15 ms/1500 ms caps is the live performance risk.
- **Structural board-model swaps (low, mechanical):** global `state.battlefield`+`objects` →
  per-player `cards_in_zone` scans; `Option<i32>` power → layered `power()` after `is_creature()`
  guard; `commander_lethal_headroom` built from `commander_damage_received` (threshold 21);
  `WaitingFor::GameOver` → `game_over`/`winner`; `AttackTarget::Planeswalker` →
  `DefenderId::Permanent` + loyalty-from-counters. Touches `eval`, `combat_ai`, `card_advantage`,
  `zone_eval`, `projection`, `tactical_gate`.
- **Deck-data plumbing (Adapted):** `deck_knowledge`, `session` (`deck_pools` → injected decks),
  `context`, `synergy` (CardDatabase at build), `features` (DeckEntry bridge) — decklist threaded
  from `RegisteredPlayer`/agent factory, not read off `GameState`.
- **CombatState off-GameState:** `tactical_gate` (and any combat-reading policy) must take
  `Option<&CombatState>` as an argument; `PolicyContext` gains a `combat()` accessor.
- **Mana-model coarseness:** `mana_colors` (`ManaType`→`u16`, `ProducedMana` loses enumerated
  "any" colors), `zone_eval` (pools on `GameLoop`, haste-aware sickness).

### Infeasible (and exactly why)
- **`tribute_eval.rs` — entry point + gating infeasible.** Grep of forge-engine/foundation/
  card-script finds **zero** Tribute references: no Tribute keyword, no ETB pay/decline prompt, no
  `TriggerCondition::TributeNotPaid`, no `WaitingFor::TributeChoice`. The numeric scorer ports
  onto ApiType/EffectIr, but the decision cannot be reached until the **Tribute mechanic is
  implemented in the engine** and routed through a `PlayerAgent` callback. Out of scope for an
  AI-only port. → ship scorer-only; gate off.
- **Mid-turn resume hook — infeasible as a minimal change.** (§1.1) Requires an engine
  turn-state-machine redesign (preamble split + `PhaseType→TurnMachineState` mapping + combat
  sub-state machine + per-phase re-entry decision). v1 sidesteps it with `run_until`.
- **Sub-module infeasible-as-written (not whole modules; degrade gracefully):**
  - `tactical_gate` block A — `AbilityCondition::SourceMatchesFilter` has no typed twin
    (conditions are lazy DSL params) → **fail-open** in v1 (only avoids wasted mana, never
    correctness).
  - `damage_reflection` — `QuantityRef::EventContextAmount` ("amount = damage just received")
    has no typed analogue → SVar/`TriggerCount$DamageAmount` heuristic, test against the 4 named
    cards.
  - Foundation **deferred tier** — cost-reducers/stax (in `staticability`, not SpellAbility IR),
    SVar-gated modal payloads (lazy-IR invariant), `copy_value` deep value model,
    `redundancy_avoidance` drain-correlation → port the *gate*, tag `Other`, defer the value model.

---

## 5. EFFORT ESTIMATE PER LAYER + RECOMMENDED WORKFLOW ORDER

Relative sizing (S ≈ 1-2 days, M ≈ 3-5, L ≈ 1-2 wk, XL ≈ multi-wk). Engine work is the gating
uncertainty.

| Layer | Effort | Notes |
|---|---|---|
| L0 Foundations | **XL** | `SimUnit`/`apply_as_current`/`run_until` is the hardest single deliverable + needs engine review; classify.rs M; ai_support L; mid-turn-resume redesign deferred (own XL). |
| L1 Leaf eval | **M-L** | eval.rs M (math verbatim, ~700 LOC); cast_facts M; card_advantage/mana_colors/deck_knowledge S each. |
| L2 Profile/config/polarity | **M** | config/strategy_profile/deck_profile S-M each; effect_classify M; synergy/zone_eval/damage_reflection S-M. |
| L3 Features/plan/threat | **L-XL** | `features/*` is a net-new subsystem with the worst IR impedance (XL alone); plan/curves S; threat_profile M; draft_eval/card_hints S-M. |
| L4 Session/context/projection | **L** | projection re-architecture L (blocked on L0 run_until); session/context M (mechanical once deps exist). |
| L5 Policy framework + ~58 policies | **XL** | framework L; each policy S-M but **~58 of them**; `anti_self_harm` (142 KB) + `redundancy_avoidance` (75 KB) are individual sub-projects; combo/line+detection must be fetched first. The largest aggregate of the port. |
| L6 Combat/gate | **L** | combat_ai L (3.3 KLOC, math verbatim, access-layer swaps); tactical_gate M (depends on effect_classify shim). |
| L7 Search/planner/driver | **L** | math verbatim; risk is the adapter (L0) + clone-cost tuning; auto_play S as a PlayerAgent. |

### Recommended follow-up implementation workflows (in order)
1. **ENGINE DESIGN SIGN-OFF FIRST** — decide `run_until` + `SimUnit`/`apply_as_current`
   (v1 path) and whether/when the mid-turn-resume redesign is funded. Everything in L4/L6/L7
   blocks on this; do not start search/projection until the adapter shape is agreed.
2. **Foundation classifier** (`classify.rs` clean tier → zone-direction → sac-outlet/ramp) +
   `effect_classify` polarity. Unblocks Batch-C policies, cast_facts, threat_profile, synergy.
3. **Leaf eval + config + deck_profile/strategy_profile** (L1-L2). eval is the critical path —
   port it early and lock its constants.
4. **Features + synergy + plan + threat + draft/hints** (L3). Port `landfall` first
   (fetchland disambiguator feeds aristocrats + mana_ramp); decide assembled-IR vs DSL-string
   detection and document it once.
5. **Policy framework + Batch A → C-clean → C-needs-work → B → C-heavy → D** (L5), wiring
   `verdicts` into forge-ai eval/search incrementally; stub every unported policy
   `activation()->None` so the registry compiles.
6. **ai_support adapter consumers: projection + session + context** (L4) once run_until lands.
7. **combat_ai + tactical_gate** (L6).
8. **planner + search + auto_play** (L7); measure clone cost against the 1500 ms budget, set
   `set_provide_priority_action_space(false)`, small `max_branching`/`max_depth`.
9. **Defer `tribute_eval`** until the Tribute mechanic is built in-engine; ship its scorer behind
   a gate. Port `#[cfg(test)]` fixtures only where explicitly requested (rebuilt against forge IR).
