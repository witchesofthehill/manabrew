# phase-ai `policies/` subsystem — port characterization

Source: `phase-rs/phase` @ `crates/phase-ai/src/policies/` (64 files, ~1 MB).
Sits on top of the effect-classification foundation specced in
`foundation-classification.md`. This doc describes the framework shape, how a
policy plugs into the AI's decision/search, a batching of all policies by the
engine knowledge they need, which ones depend on the IR-classification
foundation, and a recommended port order.

---

## 1. Framework shape

Two parallel policy families, two traits, two registries.

### 1.1 Tactical policies (the 47 in-game policies)

Trait (`registry.rs`):

```rust
pub trait TacticalPolicy: Send + Sync {
    fn id(&self) -> PolicyId;
    fn decision_kinds(&self) -> &'static [DecisionKind];
    fn activation(&self, features: &DeckFeatures, state: &GameState, player: PlayerId) -> Option<f32>;
    fn verdict(&self, ctx: &PolicyContext<'_>) -> PolicyVerdict;
}
```

- **`id`** — stable `PolicyId` enum tag (55 variants; tactical + mulligan share
  one enum).
- **`decision_kinds`** — which `DecisionKind`s this policy fires on. The registry
  pre-buckets policies by kind so only relevant ones run per decision:
  ```rust
  pub enum DecisionKind {
      Mulligan, PlayLand, CastSpell, ActivateAbility, ActivateManaAbility,
      SelectTarget, DeclareAttackers, DeclareBlockers, ManaPayment, ChooseX,
  }
  ```
- **`activation`** — a soft gate / weight. `None` ⇒ policy is inert for this
  state (e.g. wrong archetype, deck lacks the relevant density). `Some(f32)` ⇒
  a multiplier applied to the verdict's score. Reads only `DeckFeatures` (deck
  archetype/commitment metadata, computed once per session) + coarse
  `GameState`/`PlayerId`. Cheap; runs before the expensive `verdict`.
- **`verdict`** — the actual judgment for one candidate action:
  ```rust
  pub enum PolicyVerdict {
      Reject { reason: PolicyReason },          // hard veto of this candidate
      Score  { delta: f64, reason: PolicyReason }, // additive score nudge
  }
  pub struct PolicyReason { kind: &'static str, facts: Vec<(&'static str, i64)> }
  ```
  `Reject` removes the candidate from consideration; `Score { delta }` is summed
  into the candidate's heuristic value. `PolicyReason` is a structured,
  string-free trace (a tag + integer facts) for explainability — no freeform
  prose.

### 1.2 The context a policy gets (`context.rs`)

```rust
pub struct PolicyContext<'a> {
    pub state: &'a GameState,                 // full game snapshot
    pub decision: &'a AiDecisionContext,      // what the engine is asking (waiting_for)
    pub candidate: &'a CandidateAction,       // the one action being judged
    pub ai_player: PlayerId,
    pub config: &'a AiConfig,
    pub context: &'a AiContext,               // session-level (DeckFeatures per player, plan)
    pub cast_facts: Option<CastFacts<'a>>,    // pre-computed effect profile of the candidate spell
}
```

Helper methods give policies pre-digested signals so they don't each re-walk the
IR: `strategic_intent()`, `penalties()`, `can_afford_projection()`,
`source_object()`, `effects() -> Vec<&Effect>`, `cast_facts()`,
`effect_profile() -> Option<EffectProfile>`,
`has_legal_opponent_creature_target(filter, source, is_relevant)`.

**`CastFacts` / `EffectProfile` is the bridge to the foundation layer.** This is
exactly the `cast_facts.rs` profile that `foundation-classification.md` §0
identifies as phase-ai's only shipped category layer (the 7 booleans
`has_search_library / has_draw / has_token_creation / has_reveal_hand_or_discard
/ has_counter_spell / has_direct_removal_text / has_mass_damage_or_mass_shrink_text`).
Policies read these flags rather than classifying spells themselves.

### 1.3 Mulligan policies (the 11 in `mulligan/`)

A **separate trait and registry** — mulligan is a one-shot binary keep/ship, not
a ranking among candidates:

```rust
pub trait MulliganPolicy: Send + Sync {
    fn id(&self) -> PolicyId;
    fn evaluate(&self, hand: &[ObjectId], state: &GameState, features: &DeckFeatures,
                plan: &PlanSnapshot, turn_order: TurnOrder, mulligans_taken: u8) -> MulliganScore;
}
pub enum MulliganScore {
    ForceKeep { reason }, ForceMulligan { reason }, Score { delta: f64, reason },
}
```

`MulliganRegistry::evaluate_hand()` aggregates with three-way precedence: any
`ForceKeep` wins (overrides `ForceMulligan`); else any `ForceMulligan` ships;
else `sum(delta) > 0` keeps. Returns a `MulliganDecision { keep, per-policy trace }`.
Context is the opening hand + `DeckFeatures` + `PlanSnapshot` + `TurnOrder`
(OnPlay/OnDraw) + mulligans-taken count.

### 1.4 How a policy plugs into the search/decision

`PolicyRegistry::verdicts(ctx) -> Vec<(PolicyId, PolicyVerdict)>` is the
integration point (`registry.rs`):

1. `classify_decision(ctx.decision.waiting_for, ctx.candidate.action)` → a
   `DecisionKind`.
2. Look up the pre-built `by_kind: HashMap<DecisionKind, Vec<usize>>` to get only
   the policies registered for that kind.
3. For each: call `activation(...)`; skip on `None`; else call `verdict(ctx)` and
   scale `Score.delta *= activation` (`Reject` passes through unscaled).
4. Return the `(id, verdict)` list to the caller, which folds them into the
   candidate's score (sum of deltas) and honours any `Reject` as a veto.

The registry is a single `OnceLock` instance (policies are stateless, `Send +
Sync`), built once via `Default`. **Registration is manual** — `Default` pushes
each `Box<dyn TacticalPolicy>` into a `Vec`; no macro. Porting = implement the
trait + add one line to the `Default` constructor.

So on manabrew the wiring is: a candidate-action enumerator hands each candidate
+ a `PolicyContext` (built from `forge-engine-core` game state + a `CastFacts`
computed via the foundation classifier) to `PolicyRegistry::verdicts`, then the
existing eval/search (forge-ai `eval.rs`) consumes the deltas/rejections.

---

## 2. Shared infrastructure these policies stand on

Beyond the foundation classifier, the policies depend on a thin shared layer that
must be ported first or alongside:

- **`registry.rs`** — traits, enums, dispatch loop (§1).
- **`context.rs`** — `PolicyContext`, `cast_facts()`, `effect_profile()`,
  `effects()`, target-legality helpers, `collect_ability_effects`.
- **`strategy_helpers.rs`** — board/threat math reused everywhere:
  `is_own_main_phase`, `board_presence_score(&GameObject)`,
  `best_proactive_cast_score`, `visible_opponent_creature_value`,
  `untapped_opponent_blocker_value`, `targetable_threat_value`,
  `battlefield_pressure_delta`, `opponent_lethal_damage`, `ai_can_block`,
  `sacrifice_cost`, `count_counterspells_in_hand`.
- **`activation.rs`** — archetype×turn activation scaling (`arch_times_turn`).
- **`effect_classify.rs`** — the **polarity** axis (`EffectPolarity {
  Beneficial, Harmful, Contextual }`, `effect_polarity(&Effect)`,
  `is_spell_beneficial`, `targeted_object_impact`, `aura_polarity`). This is the
  *separate axis* called out in foundation §3 — orthogonal to `EffectCategory`,
  ported over `Effect`/`StaticMode` inputs, not folded into the category enum.
- **`mulligan/mod.rs`** — `MulliganPolicy`, `MulliganScore`, `MulliganRegistry`,
  `TurnOrder`, `PlanSnapshot`.

Also assumed present on the engine side: `zone_eval::available_mana`,
`DeckFeatures` (session feature extraction), `castable_probabilities` /
`ThreatAwareness` (opponent threat model), `strategic_intent`,
`remaining_deck_view`.

---

## 3. Policy batches by engine knowledge required

Sizes in bytes. "Foundation-dependent" = needs the IR effect-category /
`CastFacts` / `EffectProfile` layer from `foundation-classification.md`.

### Batch 0 — Framework + shared infra (port first; everything blocks on this)
`mod.rs` (1.3K), `registry.rs` (15.7K), `context.rs` (23.3K),
`strategy_helpers.rs` (10.1K), `activation.rs` (1.0K),
`effect_classify.rs` (23.2K, polarity axis), `mulligan/mod.rs` (12.5K).
Needs: trait/enum scaffolding, `PolicyContext` wiring to `forge-engine-core`,
the polarity classifier over `Effect`. Depends on foundation only for the
`cast_facts()`/`effect_profile()` accessors (wire them to the foundation
classifier's `CastFacts` analogue).

### Batch A — Pure board / mana / phase / combat state (NO foundation needed)
These read battlefield, hands (counts), mana, phase, turn, keywords, P/T — no
"what does this spell do" classification.
- `board_development.rs` (3.1K)
- `tempo_curve.rs` (10.1K)
- `mana_efficiency.rs` (15.0K)
- `hold_mana_up.rs` (15.6K) — untapped mana sources, cheapest-instant-in-hand,
  own-main + empty-stack gating. (Reads `min_instant_cmc_in_hand`; "is instant"
  is a card-type check, not effect classification.)
- `land_sequencing.rs` (10.8K)
- `landfall_timing.rs` (17.4K)
- `ramp_timing.rs` (18.7K) — uses ramp *features*, not per-spell IR classify.
- `aggro_pressure.rs` (19.0K)
- `lethality_awareness.rs` (8.8K)
- `life_total_resource.rs` (10.1K)
- `combat_tax.rs` (12.8K)
- `tempo`/anthem: `anthem_priority.rs` (11.7K), `tribal_lord_priority.rs` (11.2K)
- `planeswalker_loyalty.rs` (16.0K)
- `equipment_priority.rs` (12.9K)
- `interaction_reservation.rs` (4.5K)
- `stack_awareness.rs` (22.3K) — reads the stack; targeting/response timing.
- `land_animation.rs` (14.7K) — manlands; mostly type/keyword + combat math.

### Batch B — Polarity axis only (needs `effect_classify.rs`, not the category layer)
Self-harm / protection / "is this good or bad for me" — depend on
`EffectPolarity`, which Batch 0 ports.
- `anti_self_harm.rs` (142.7K — by far the largest; exhaustive
  per-effect-polarity guard tables; budget accordingly)
- `reactive_self_protection.rs` (26.1K)
- `downside_awareness.rs` (11.0K)
- `spellskite_priority.rs` (11.4K)
- `control_change_awareness.rs` (14.6K)

### Batch C — Effect-CATEGORY classification (DEPENDS ON THE FOUNDATION)
These gate on `CastFacts`/`EffectProfile` flags or `Effect` category matching —
i.e. they ask "is this a tutor / draw / discard / board wipe / mill / copy / sac
outlet". Each maps to a foundation tier:
- `tutor.rs` (22.4K) — `facts.has_search_library()` ⇒ foundation **Tutor**
  (+ `remaining_deck_view`). Clean-tier flag.
- `hand_disruption.rs` (23.6K) — `facts.has_reveal_hand_or_discard()` +
  `Effect::DiscardCard`/`RevealHand` ⇒ foundation **Discard**. Clean tier.
- `card_advantage.rs` (7.5K) — `has_draw` ⇒ **Draw**. Clean tier.
- `board_wipe_telegraph.rs` (16.0K) — classifies *opponent* spells as board
  wipes via `castable_probabilities(...).board_wipe` (threat model) ⇒
  **BoardWipe**. Needs both the category layer and the threat model.
- `sweeper_timing.rs` (12.3K) — own board wipes ⇒ **BoardWipe**
  (`has_mass_damage_or_mass_shrink_text`).
- `mill_targeting.rs` (9.4K) — **Mill**.
- `copy_value.rs` (25.8K) — **Copy** (category clean, value-of-copy hard per
  foundation §3 — port the gate, defer the deep value model).
- `sacrifice_value.rs` (7.3K) + `free_outlet_activation.rs` (18.4K) — **SacOutlet**
  (cost-side `CostPart::Sacrifice` signal, foundation "needs-work" tier).
- `blight_value.rs` (7.8K), `recursion_awareness.rs` (9.7K) — graveyard /
  reanimation / recursion ⇒ **Reanimation**/**Mill** zone-direction tier.
- `evasion_removal_priority.rs` (12.0K) — **Removal** (targeted) classification.
- `effect_timing.rs` (16.6K), `synergy_casting.rs` (9.9K),
  `spellslinger_casting.rs` (24.3K), `combo_line.rs` (14.7K) — read effect
  profiles to time/sequence effect types; depend on the category layer broadly.
- `condition_gated_activation.rs` (11.7K), `x_value.rs` (16.9K) — read
  ability/effect shape (X spells, conditional activation) — lighter foundation
  coupling but still IR-shape aware.
- `plus_one_counters.rs` (24.6K), `tokens_wide.rs` (18.1K) — **Counters** /
  **Tokens** categories (clean tier) + go-wide board math.
- `redundancy_avoidance.rs` (75.4K — second largest; effect-equivalence /
  "I already have this effect" dedup; leans hard on category classification).
- `etb_value.rs` (4.7K) — ETB-trigger value; uses `CastFacts.immediate_etb_triggers`.
- `combat_tax`/`anthem` already in A; do not double-count.

### Batch D — Mulligan (separate trait; needs DeckFeatures + hand classification)
All gate on `DeckFeatures.*.commitment` and classify opening-hand cards by
**parts-based predicates** (e.g. `is_ramp_piece_parts(core_types, abilities,
static_defs)`) — i.e. structural effect classification of a card, NOT card
names. These reuse the foundation's category predicates applied to a `Card`/DB
entry (foundation §4: same logic runs on `ParsedCardScript` pre-game).
- `mulligan/keepables_by_land_count.rs` (19.1K) — land-count only; **no
  foundation** (Batch A-equivalent; port with framework).
- `mulligan/tribal_density.rs` (8.6K) — tribe/type counts; light.
- `mulligan/ramp_keepables.rs` (14.9K) — **Ramp** parts predicate.
- `mulligan/landfall_keepables.rs` (9.9K) — landfall/land synergy.
- `mulligan/aggro_keepables.rs` (14.8K) — curve/creature density.
- `mulligan/aristocrats_keepables.rs` (12.9K) — **SacOutlet**/sac fodder.
- `mulligan/plus_one_counters_keepables.rs` (13.7K) — **Counters**.
- `mulligan/tokens_wide_keepables.rs` (14.5K) — **Tokens**.
- `mulligan/spellslinger_keepables.rs` (15.5K) — instant/sorcery density.
- `mulligan/cedh_keepables.rs` (22.6K) — fast mana / **Tutor** / combo pieces.

### Not policies
`tests/` subdir and `policies/tests.rs`-style modules — port last as parity checks.

---

## 4. Which policies depend on the IR-classification foundation

**Hard dependents (Batch C + classifying mulligan policies):** `tutor`,
`hand_disruption`, `card_advantage`, `board_wipe_telegraph`, `sweeper_timing`,
`mill_targeting`, `copy_value`, `sacrifice_value`, `free_outlet_activation`,
`blight_value`, `recursion_awareness`, `evasion_removal_priority`,
`effect_timing`, `synergy_casting`, `spellslinger_casting`, `combo_line`,
`condition_gated_activation`, `x_value`, `plus_one_counters`, `tokens_wide`,
`redundancy_avoidance`, `etb_value`; and mulligan `ramp_keepables`,
`landfall_keepables`, `aristocrats_keepables`, `plus_one_counters_keepables`,
`tokens_wide_keepables`, `spellslinger_keepables`, `cedh_keepables`.

**Polarity-only dependents (need `effect_classify.rs`, the separate axis, not the
category enum):** `anti_self_harm`, `reactive_self_protection`,
`downside_awareness`, `spellskite_priority`, `control_change_awareness`.

**No foundation dependency (Batch A + land-count mulligan):** `board_development`,
`tempo_curve`, `mana_efficiency`, `hold_mana_up`, `land_sequencing`,
`landfall_timing`, `ramp_timing`, `aggro_pressure`, `lethality_awareness`,
`life_total_resource`, `combat_tax`, `anthem_priority`, `tribal_lord_priority`,
`planeswalker_loyalty`, `equipment_priority`, `interaction_reservation`,
`stack_awareness`, `land_animation`, `mulligan/keepables_by_land_count`,
`mulligan/tribal_density`.

Note the granularity matters: the foundation's **clean tier** (Draw,
Counterspell, BoardWipe, Discard, Counters, Tokens, Pump) unblocks
`card_advantage`, `hand_disruption`, `sweeper_timing`, `plus_one_counters`,
`tokens_wide` immediately. The **needs-work tier** (Tutor, Removal, Mill,
Reanimation, SacOutlet, Bounce, Ramp) gates `tutor`, `evasion_removal_priority`,
`mill_targeting`, `blight_value`, `recursion_awareness`, `sacrifice_value`,
`free_outlet_activation`. The **deferred tier** (copy-value, drain correlation,
SVar-modal) means `copy_value` and `redundancy_avoidance` port their *gates* but
defer their deepest value models.

---

## 5. Recommended port order

1. **Foundation classifier** (`foundation-classification.md` build order steps
   1–3): clean tier → `classify_change_zone` direction → sac-outlet + ramp. This
   unblocks most of Batch C.
2. **Batch 0 — framework + infra.** `registry.rs`, `context.rs` (wire
   `cast_facts()`/`effect_profile()` to the foundation), `strategy_helpers.rs`,
   `activation.rs`, `mulligan/mod.rs`, `effect_classify.rs` (polarity). Add the
   `verdicts` dispatch into forge-ai's existing eval/search. Nothing scores yet,
   but the pipeline is live.
3. **Batch A — no-foundation tactical policies.** Cheapest correctness wins;
   validate the dispatch end-to-end with policies that only need board/mana/phase
   state. Start with the smallest (`board_development`, `interaction_reservation`)
   to shake out the harness, then the timing/curve set.
4. **Batch C clean-tier dependents.** `card_advantage`, `hand_disruption`,
   `sweeper_timing`, `tokens_wide`, `plus_one_counters`, `etb_value` — they only
   need the foundation flags already shipped in step 1.
5. **Batch C needs-work-tier dependents.** `tutor`, `mill_targeting`,
   `blight_value`, `recursion_awareness`, `sacrifice_value`,
   `free_outlet_activation`, `evasion_removal_priority` — gated on the
   zone-direction + cost-side foundation work.
6. **Batch B — polarity policies.** `downside_awareness`, `spellskite_priority`,
   `control_change_awareness`, `reactive_self_protection`, then **`anti_self_harm`
   last** (142 KB — its own multi-session sub-project; the polarity layer must be
   fully ported and trusted first).
7. **Batch C heavy / deferred-value.** `effect_timing`, `synergy_casting`,
   `spellslinger_casting`, `combo_line`, `condition_gated_activation`, `x_value`,
   `copy_value`, then **`redundancy_avoidance` last** (75 KB; depends on broad,
   trustworthy category coverage).
8. **Batch D — mulligan.** Land-count + tribal first (no foundation), then the
   archetype-keepables in the same category-tier order as their tactical twins;
   `cedh_keepables` last (touches tutor + fast-mana + combo classification).
9. **`tests/`** — port as parity fixtures throughout, finalize at the end.

Driving principle (matches AGENTS.md root-cause rule): port the **foundation
category once**, have every policy read it through `CastFacts`/`EffectProfile`
accessors, and never let an individual policy re-implement "what does this card
do" inline.
