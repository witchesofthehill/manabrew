# Port spec — phase-ai decision helpers

Modules covered: `ability_chain.rs`, `auto_play.rs`, `decision_kind.rs`,
`damage_reflection.rs` (from `phase-rs/phase` `crates/phase-ai/src/`).

Target: a `forge-ai` crate over the manabrew Forge-DSL engine
(`forge-engine/crates/forge-engine`). Engine API maps cited from
`tmp/phaseai-port/api-{state,ir,combat-mana,sim}.md`; engine source cited as
`forge-engine/crates/forge-engine/src/<path>:<line>`.

Key architectural fact that frames everything below: **Phase is an
event-sourced reducer engine** — `apply(state, player, action) -> {events,
log}`, the pending decision is a typed `WaitingFor` enum, and ability effects
are a strongly-typed `Effect` AST. **manabrew is a callback/driver engine** —
`GameLoop` drives the turn and calls back into a `PlayerAgent` trait
(`agent/mod.rs:23`); there is no `WaitingFor`, no `apply`, and ability effects
are not a typed AST but `ApiType` verbs + a lowered `SpellAbilityIr` operand
bag, with trigger effects stored as a card-script string resolved through a
`SpellAbility`. This makes two of the four modules (`ability_chain`,
`damage_reflection`) faithfully portable, and two (`auto_play`,
`decision_kind`) **architecture-bound adaptations** rather than literal ports.

---

## 1. `ability_chain.rs`

### (1) What it does
A single tiny helper. `collect_chain_effects(ability)` flattens an
`AbilityDefinition`'s effect chain — its primary `effect` plus every
`sub_ability.effect` down the single-linked `sub_ability` list — into a
`Vec<&Effect>` in chain order. Feature detectors and policies use it to ask
"does this ability's *set* of effects include both X and Y" (e.g. search the
library AND put a land onto the battlefield). Pure structural walk, no weights.

Verbatim body:
```rust
pub(crate) fn collect_chain_effects(ability: &AbilityDefinition) -> Vec<&Effect> {
    let mut effects: Vec<&Effect> = vec![&ability.effect];
    let mut current = &ability.sub_ability;
    while let Some(sub) = current {
        effects.push(&sub.effect);
        current = &sub.sub_ability;
    }
    effects
}
```

### (2) Phase types read → manabrew equivalent
| Phase | Use | manabrew equivalent | Cite |
|---|---|---|---|
| `engine::types::ability::AbilityDefinition` | the ability object | `SpellAbility` | `spellability/mod.rs:99` (api-ir.md §2) |
| `AbilityDefinition.effect: Effect` | primary effect (always present, typed) | `SpellAbility.api: Option<ApiType>` + `SpellAbility.ir: SpellAbilityIr` | `spellability/mod.rs:104,125` |
| `AbilityDefinition.sub_ability: Option<Box<...>>` | chained effect | `SpellAbility.sub_ability: Option<Box<SpellAbility>>` | `spellability/mod.rs:138` |
| `engine::types::ability::Effect` | the typed effect node | **NO 1:1 equivalent** — manabrew has no typed `Effect` enum; a "link" is the pair `(api, ir)` on each `SpellAbility`. Closest typed slice is `EffectIr` but only 8 APIs are lowered (api-ir.md §3) | `ability/ability_ir.rs:16` |

Note: manabrew already ships `SpellAbility::find_sub_ability_by_type(api) ->
Option<&SpellAbility>` (`spellability/mod.rs:676`) which walks the same chain;
the port adds the *collect-all* variant the callers need.

### (3) Faithful-port plan (skeleton — body is engine-agnostic, port verbatim)
A "chain effect" in manabrew is the whole `SpellAbility` link (you classify it
by reading `.api` and `.ir`), so return `&SpellAbility` rather than a typed
`Effect`. The loop is identical.
```rust
use forge_engine::spellability::SpellAbility;

/// Walk `ability` plus each `sub_ability` in turn, in chain order.
pub(crate) fn collect_chain_abilities(ability: &SpellAbility) -> Vec<&SpellAbility> {
    let mut chain: Vec<&SpellAbility> = vec![ability];
    let mut current = &ability.sub_ability;
    while let Some(sub) = current {
        chain.push(sub);                       // sub: &Box<SpellAbility> derefs to &SpellAbility
        current = &sub.sub_ability;
    }
    chain
}
```
Callers that matched `matches!(effect, Effect::Foo { .. })` become
`link.api == Some(ApiType::Foo)` plus `link.ir.*` refinements (the api-ir.md
classifier shape, §"Recommended classifier shape"). If a caller truly only
needs the typed numeric effects, expose a parallel
`collect_chain_effect_irs(ability) -> Vec<&EffectIr>` filtering on
`link.ir.effect.as_ref()`.

### (4) Dependencies on other phase-ai modules
None. It is the leaf building block `features/*` and `policies/*` import.

### (5) Risks
Low. The only semantic gap: Phase's `Effect` is one typed node per link;
manabrew's link carries an untyped `ApiType` + operand bag, so downstream
callers that pattern-matched `Effect` need rewriting against `(api, ir)`. The
*walk itself* ports verbatim. No infeasibility.

---

## 2. `auto_play.rs`

### (1) What it does
Drives AI-vs-AI / AI-seat auto-play. `run_ai_actions(state, ai_players,
ai_configs)` loops: determine the acting AI seat, ask the search policy for an
action, apply it, record the result; stop when a non-AI player must act or the
game ends. One `AiActionResult` is produced per AI action so the caller can
stream per-action state updates with animation timing.

Exact logic and constants to carry over **verbatim**:
- `const MAX_AI_ACTIONS_PER_SEQUENCE: usize = 200;` — safety cap (doc: "not
  CR-derived"; typical sequences 30–50 actions). Loop is `for _ in
  0..MAX_AI_ACTIONS_PER_SEQUENCE`.
- Actor selection (CR 103.5 fallback): `state.waiting_for.acting_player()` →
  `Some(p) if ai_players.contains(&p)` use `p`; `Some(_)` → `break` (human's
  turn); `None` → fall back to first AI in
  `state.waiting_for.acting_players()` that is in `ai_players`, else `break`.
- Missing config for seat → `tracing::warn!` "AI seat has no config — stopping
  AI loop" + `break`.
- `choose_action(...)` returns `None` → warn "choose_action returned None —
  stopping AI loop" + `break`.
- `apply(state, actor, action.clone())` `Ok(result)` → push
  `AiActionResult { action, state: state.clone(), events: result.events,
  log_entries: result.log_entries }`; `Err(e)` → `tracing::error!` "AI action
  apply failed — stopping" + `break`.
- After loop, if `results.len() >= MAX_AI_ACTIONS_PER_SEQUENCE` → warn "AI
  action loop hit safety cap — possible infinite loop".
- RNG: `let mut rng = rand::rng();` passed to `choose_action`.

### (2) Phase types read → manabrew equivalent
| Phase | Use | manabrew equivalent | Cite |
|---|---|---|---|
| `engine::types::game_state::GameState` | the mutated state | `GameState` | `game.rs:92` (api-state.md) |
| `state.waiting_for: WaitingFor` | pending decision + who acts | **NO equivalent.** manabrew has no pending-decision value on the state; the `GameLoop` *pushes* each decision into a `PlayerAgent` callback. Closest "whose turn to act" is `game.turn.priority_player` (`phase/mod.rs:149`) / `game.active_player()` (`game.rs:458`) during priority windows | — |
| `state.waiting_for.acting_player() -> Option<PlayerId>` | single actor | **NO equivalent** (see above) | — |
| `state.waiting_for.acting_players() -> Vec<PlayerId>` | simultaneous-mulligan actors | **NO equivalent**; manabrew handles mulligans inside `GameLoop::setup`/London path calling `mulligan_decision` per seat (`agent/mod.rs:64`, api-sim.md §3) | — |
| `engine::types::actions::GameAction` | chosen action | `PlayerAction` | `player/actions/player_action.rs:11` (api-combat-mana.md) |
| `engine::game::engine::apply(state, player, action) -> Result<{events, log_entries}, _>` | the reducer | **NO equivalent.** manabrew never exposes `apply(action)->events`; mutation happens inside `GameLoop` via `PlayerAction::run(self, &mut PlayerController, …) -> PlayerActionOutcome` (`player_action.rs:95`) and the loop drivers `GameLoop::run`/`run_turn`/`step_combat` | api-combat-mana.md, api-sim.md §2 |
| `engine::types::events::GameEvent` (`result.events`) | per-action events | **NO direct equivalent.** Side-effects surface as `GameNotification` pushed to agents via `PlayerAgent::notify` (`agent/mod.rs:1021`) and entries in `GameLoop.game_log: GameLog` (`game_loop.rs:42`) | api-sim.md §2 |
| `engine::types::log::GameLogEntry` (`result.log_entries`) | per-action log | `GameLog` entries on `GameLoop.game_log` | `game_loop.rs:42` |
| `crate::config::AiConfig` | per-seat config | other phase-ai module (out of scope) — define a `forge_ai::config::AiConfig` | — |
| `crate::search::choose_action` | the policy/search entry | other phase-ai module (out of scope) | — |

### (3) Faithful-port plan
This module **cannot be ported as a free `apply`-loop** because manabrew has no
reducer surface. There are two faithful target shapes; pick (A) for parity with
manabrew's architecture, keep the constants/log strings verbatim either way.

**(A) Recommended — wrap the search policy in a `PlayerAgent` (no auto-loop of
our own).** manabrew already loops for us inside `GameLoop`. `choose_action`'s
result becomes the body of `PlayerAgent::choose_action`. The
`MAX_AI_ACTIONS_PER_SEQUENCE` safety cap and the warn/error strings are
preserved as an internal guard inside the agent (count actions returned for one
priority sequence). Skeleton:
```rust
pub const MAX_AI_ACTIONS_PER_SEQUENCE: usize = 200; // verbatim; safety invariant, not CR-derived

pub struct AiAgent {
    player: PlayerId,
    config: AiConfig,
    rng: rand::rngs::ThreadRng,
    actions_this_sequence: usize,
}

impl PlayerAgent for AiAgent {
    fn choose_action(
        &mut self,
        player: PlayerId,
        action_space: Option<&PriorityActionSpace>,
        request_action_space: &mut dyn FnMut() -> PriorityActionSpace,
    ) -> PlayerAction {
        if self.actions_this_sequence >= MAX_AI_ACTIONS_PER_SEQUENCE {
            tracing::warn!(count = self.actions_this_sequence,
                "AI action loop hit safety cap — possible infinite loop");
            return PlayerAction::PassPriority;
        }
        let space = action_space.cloned().unwrap_or_else(|| request_action_space());
        match crate::search::choose_action(/* game read view */, player, &self.config, &mut self.rng) {
            Some(a) => { self.actions_this_sequence += 1; a }      // PlayerAction
            None => {
                tracing::warn!(player = ?player, "choose_action returned None — stopping AI loop");
                PlayerAction::PassPriority
            }
        }
    }
    // mulligan_decision / choose_attackers / choose_blockers / choose_targets_for ... -> route to policies
}
```
Reset `actions_this_sequence = 0` when priority leaves the seat (e.g. in
`snapshot_state`/`notify` on phase change). Drive a full AI-vs-AI game with
`run_hosted_multiplayer_game(..., agent_factory: |pid| Box::new(AiAgent::new(pid, cfg)))`
(api-sim.md §5) or a hand-rolled `GameLoop::setup` + `run_turn` loop (api-sim.md
§"Driving simulation").

**(B) Literal `run_ai_actions` over a `GameLoop` step API.** Only viable if a
step-granular `apply`-like surface is added. The nearest primitive is
`PlayerAction::run(self, &mut PlayerController, …) -> PlayerActionOutcome`
(`player_action.rs:95`); a faithful loop would build/borrow a
`PlayerController`, call `run` per chosen action, and synthesize the
`AiActionResult { action, state: game.clone(), events, log_entries }` from
`GameLoop.game_log` deltas and emitted `GameNotification`s. `state.clone()` is a
**full deep copy of `Vec<Card>` with per-card IR** (api-sim.md §1) — expensive;
do it only if the per-action streaming requirement is real. The "acting AI
seat" check maps to: during a priority window the actor is
`game.turn.priority_player`; auto-play only while
`ai_players.contains(&priority_player)`, else stop. Mulligan simultaneity (the
`acting_players()` fallback) maps to manabrew's per-seat `mulligan_decision`
sequencing inside `setup`, so the fallback branch is **not needed** under (A)
and is structurally absent under (B).

`AiActionResult` ports as-is but `events`/`log_entries` types change:
```rust
pub struct AiActionResult {
    pub action: PlayerAction,
    pub state: GameState,
    pub events: Vec<GameNotification>,   // was Vec<GameEvent>
    pub log_entries: Vec<GameLogEntry>,  // GameLog entries
}
```

### (4) Dependencies on other phase-ai modules
- `crate::config::AiConfig` (per-seat config) — out of scope, must exist.
- `crate::search::choose_action` (the search/policy entry that returns the
  action) — out of scope; this is the brain. `auto_play` is just its driver.

### (5) Risks
- **Infeasible as a literal port.** No `apply(action)->events` reducer and no
  `WaitingFor`. Must be re-expressed as a `PlayerAgent` (shape A) — an
  adaptation, not a transcription. Flag to reviewer.
- The per-action `events` granularity (Phase returns events from each `apply`)
  has no clean manabrew analogue; `GameNotification`/`GameLog` deltas are the
  best reconstruction and may not be 1:1.
- `state.clone()` per action is O(total cards × per-card IR) (api-sim.md §1) —
  performance risk if the streaming loop is kept.
- The actor-selection CR-103.5 simultaneous-mulligan fallback dissolves into
  manabrew's per-seat mulligan callback; preserve the *intent* (advance one AI
  decision at a time) but the code shape differs.
- **Carry over verbatim regardless:** `MAX_AI_ACTIONS_PER_SEQUENCE = 200`, the
  three log strings, and the cap-check after the loop.

---

## 3. `decision_kind.rs`

### (1) What it does
`classify(waiting_for: &WaitingFor, action: &GameAction) -> DecisionKind`. Maps
the engine's current pending-decision (`WaitingFor`, ~140 variants) plus, for
priority, the candidate action, onto a coarse `DecisionKind` used as the
**routing key** for `PolicyRegistry`: each policy declares the `DecisionKind`s
it fires on; the registry only runs policies whose list contains the classified
kind. The `match` is exhaustive over `WaitingFor` by design (adding a variant =
compile error here, so no decision silently bypasses routing).

The full routing table to carry over **verbatim** (CR cites are Phase's, keep
as comments only if helpful):
- `MulliganDecision | MulliganBottomCards | OpeningHandBottomCards` → `Mulligan`
- `ManaPayment | PhyrexianPayment` → `ManaPayment`
- `ChooseXValue` → `ChooseX`
- `TargetSelection | TriggerTargetSelection | MultiTargetSelection |
  CopyRetarget | RetargetChoice | DistributeAmong | MoveCountersDistribution`
  → `SelectTarget`
- `DeclareAttackers` → `DeclareAttackers`
- `DeclareBlockers` → `DeclareBlockers`
- `UntapChoice` → `ActivateAbility`
- `ExertChoice` → `DeclareAttackers` (CR 508.1g: exert-as-attack)
- `CombatTaxPayment { context, .. }` → `match context {
  CombatTaxContext::Attacking => DeclareAttackers, CombatTaxContext::Blocking
  => DeclareBlockers }` (CR 508.1d + 509.1c)
- `Priority { .. }` → dispatch on `action`:
  - `GameAction::PlayLand { .. }` → `PlayLand`
  - `GameAction::CastSpell { .. }` → `CastSpell`
  - `GameAction::ActivateAbility { .. }` → `ActivateAbility`
  - `GameAction::TapLandForMana { .. } | UntapLandForMana { .. }` →
    `ActivateManaAbility`
  - `_` → `ActivateAbility` (catch-all: PassPriority/special actions are
    activation-adjacent)
- **All remaining ~90 `WaitingFor` variants** (ReplacementChoice, OrderTriggers,
  ScryChoice, DigChoice, …, AssignCombatDamage, PayAmountChoice, GameOver,
  MiracleReveal, CoinFlipKeepChoice, ActivationCostOneOfChoice, …) →
  `ActivateAbility` (catch-all bucket; policies opt in explicitly).

`DecisionKind` value set (from `crate::policies::registry::DecisionKind`):
`Mulligan, ManaPayment, ChooseX, SelectTarget, DeclareAttackers,
DeclareBlockers, ActivateAbility, PlayLand, CastSpell, ActivateManaAbility`.

### (2) Phase types read → manabrew equivalent
| Phase | Use | manabrew equivalent | Cite |
|---|---|---|---|
| `engine::types::game_state::WaitingFor` (+ all variants) | the pending decision | **NO equivalent.** Decisions are not a state-held enum; each is a distinct `PlayerAgent` method invocation by `GameLoop` | `agent/mod.rs:23`, api-sim.md §3 |
| `WaitingFor::Priority` | priority window | `PlayerAgent::choose_action(player, action_space, request_action_space)` | `agent/mod.rs:121` |
| `WaitingFor::MulliganDecision/...` | mulligan | `mulligan_decision` (`agent/mod.rs:64`), `choose_cards_to_bottom` (`:93`) | api-sim.md §3 |
| `WaitingFor::ManaPayment/PhyrexianPayment` | pay mana | `pay_mana_cost(...) -> ManaCostAction` (`agent/mod.rs:941`), `choose_phyrexian_pay_life` (`:872`) | api-combat-mana.md |
| `WaitingFor::ChooseXValue` | X | `choose_x_value(player, max_x, source) -> u32` | `agent/mod.rs:865` |
| `WaitingFor::TargetSelection/Multi/Trigger/Retarget/DistributeAmong` | targeting | `choose_targets_for` (`:279`), `choose_target_card/player/any` (`:296/288/315`), `choose_entities_for_effect` (`:708`) | api-sim.md §3 |
| `WaitingFor::DeclareAttackers` | attacks | `choose_attackers(player, available, possible_defenders)` | `agent/mod.rs:131` |
| `WaitingFor::ExertChoice` | exert | `exert_attackers` | `agent/mod.rs:142` |
| `WaitingFor::DeclareBlockers` | blocks | `choose_blockers(player, attackers, available_blockers, max)` | `agent/mod.rs:156` |
| `WaitingFor::CombatTaxPayment{context}` + `CombatTaxContext::{Attacking,Blocking}` | attack/block tax | `pay_combat_cost(...) -> CombatCostAction` (`agent/mod.rs:883`); context is *implicit* in which combat step invokes it. **No `CombatTaxContext` enum** | api-combat-mana.md |
| `WaitingFor::UntapChoice` | untap-for-cost | `choose_tap_type_for_cost`/cost callbacks | `agent/mod.rs:695` |
| ~90 mechanical variants (Scry/Dig/Surveil/Discard/Mode/Vote/Clash/…) | misc forced choices | the corresponding named `PlayerAgent::choose_*` defaults | api-sim.md §3 (full list) |
| `engine::types::actions::GameAction::{PlayLand,CastSpell,ActivateAbility,TapLandForMana,UntapLandForMana}` | priority candidate | `PlayerAction::{CastSpell(PlayOption), ActivateAbility(AbilityRef), ActivateMana(CardId,opt), UndoMana(CardId), PassPriority, …}` — **note: NO `PlayLand` variant**; lands are cast via `CastSpell(PlayOption)` whose `PlayOption.card_id` is a land (`PlayCardMode::BackFaceLand` for MDFC backs). `PlayLand` must be detected as `CastSpell` of a land card (`Card::is_land`, `card/mod.rs:1026`) | `player_action.rs:11`, api-combat-mana.md |
| `crate::policies::registry::DecisionKind` | output enum | other phase-ai module (out of scope) — define `forge_ai::policies::registry::DecisionKind` | — |

### (3) Faithful-port plan
Because manabrew dispatches decisions by *which callback fires*, there are two
faithful shapes. The `DecisionKind` enum itself and the priority-action routing
table port **verbatim**.

**(A) Per-callback classification (idiomatic for manabrew).** Replace the giant
`WaitingFor` match with a thin `DecisionKind` constant per `PlayerAgent`
callback (the callback *is* the `WaitingFor` discriminant), keeping only the
**priority-time `PlayerAction` dispatch** as real logic — that is the one place
manabrew also needs runtime classification:
```rust
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub enum DecisionKind {
    Mulligan, ManaPayment, ChooseX, SelectTarget, DeclareAttackers,
    DeclareBlockers, ActivateAbility, PlayLand, CastSpell, ActivateManaAbility,
}

/// Priority-window classification — the only context where manabrew, like
/// Phase, must dispatch on the candidate action. Mirrors Phase's
/// `WaitingFor::Priority` arm verbatim.
pub fn classify_priority_action(action: &PlayerAction, game: &GameState) -> DecisionKind {
    match action {
        // Phase PlayLand has no PlayerAction analogue: a land is CastSpell of a land card.
        PlayerAction::CastSpell(opt) if game.card(opt.card_id).is_land() => DecisionKind::PlayLand,
        PlayerAction::CastSpell(_) => DecisionKind::CastSpell,
        PlayerAction::ActivateAbility(_) => DecisionKind::ActivateAbility,
        PlayerAction::ActivateMana(_, _) | PlayerAction::UndoMana(_) => DecisionKind::ActivateManaAbility,
        // PassPriority, Concede, PayCost, SelectCard/Player, TargetEntity, FinishTargeting, …
        _ => DecisionKind::ActivateAbility,
    }
}

// Per-callback fixed kinds (the WaitingFor → DecisionKind table, minus Priority):
pub const KIND_MULLIGAN: DecisionKind = DecisionKind::Mulligan;            // mulligan_decision / choose_cards_to_bottom
pub const KIND_MANA_PAYMENT: DecisionKind = DecisionKind::ManaPayment;     // pay_mana_cost / choose_phyrexian_pay_life
pub const KIND_CHOOSE_X: DecisionKind = DecisionKind::ChooseX;             // choose_x_value
pub const KIND_SELECT_TARGET: DecisionKind = DecisionKind::SelectTarget;   // choose_targets_for / choose_target_*
pub const KIND_DECLARE_ATTACKERS: DecisionKind = DecisionKind::DeclareAttackers; // choose_attackers / exert_attackers / attack-tax
pub const KIND_DECLARE_BLOCKERS: DecisionKind = DecisionKind::DeclareBlockers;   // choose_blockers / block-tax
// everything else (scry/dig/surveil/mode/vote/discard/replacement/order-triggers/…) -> ActivateAbility catch-all
```
For combat-tax routing, manabrew has no `CombatTaxContext` value; instead route
by the *step*: when `pay_combat_cost` is called during attacker declaration →
`DeclareAttackers`, during blocker declaration → `DeclareBlockers`
(`GameLoop::step_combat` order, `game_loop/combat_phase.rs`). Pass that context
in from the call site.

**(B) Literal `WaitingFor` match.** Only if a `WaitingFor`-equivalent decision
enum is introduced (it does not exist today). Not recommended — it would mean
building a parallel decision-state machine the engine does not use.

### (4) Dependencies on other phase-ai modules
- `crate::policies::registry::DecisionKind` (the output enum) — define it; the
  whole module exists to feed `PolicyRegistry`.
- Consumers: every policy in `crate::policies::*` keys off the returned kind.

### (5) Risks
- **No `WaitingFor`** → the exhaustive-match safety property (compile error on
  new decision variants) is **lost**; manabrew gains decision types by adding
  `PlayerAgent` methods, which won't force an update here. Mitigation: centralize
  the per-callback `DecisionKind` constants so each new callback must pick one.
- **`PlayLand` has no `PlayerAction` variant** — must be reconstructed as
  `CastSpell` of a land (shown above). Faithful but a real behavioral subtlety.
- `CombatTaxContext` (Attacking/Blocking) is absent — must be supplied by the
  call site (combat step) instead of read off the decision. Adaptation.
- The ~90-way catch-all → `ActivateAbility` ports trivially as the default; no
  risk there. Net: feasible, but as an **adaptation** mapping callbacks↔kinds,
  not a literal `match` transcription.

---

## 4. `damage_reflection.rs`

### (1) What it does
Detects damage-reflection triggered abilities (doc names: **Jackal Pup, Boros
Reckoner, Spiteful Sliver, Spitemare**) and computes a board-evaluation
penalty for the AI attacking into such a creature.

Public surface:
- `has_damage_reflection_to_player(object: &GameObject) -> bool` — any trigger
  satisfies `damage_reflection_to_player_trigger` (reflects the received damage
  out to a player/opponent, e.g. Spiteful Sliver / Spitemare).
- `has_damage_reflection_to_controller(object: &GameObject) -> bool` — any
  trigger satisfies `damage_reflection_to_controller_trigger` (reflects to its
  own controller, e.g. Jackal Pup / Boros Reckoner).
- `is_event_context_damage_to_player(effect: &Effect) -> bool`.
- `opponent_creature_reflection_penalty(state, object_id, ai_player, damage:
  i32) -> f64` — **the weight-bearing function.**

Private predicates:
- `damage_reflection_to_player_trigger(trigger) -> bool`:
  1. `trigger.mode != TriggerMode::DamageReceived` → `false`.
  2. `trigger.valid_card` must be `None` or `TargetFilter::SelfRef`
     (self-scoped) → else `false`.
  3. `trigger.execute` must be `Some` → else `false`.
  4. `is_event_context_damage_to_player(&execute.effect)` must hold, AND
  5. the deal-damage target is NOT `TargetFilter::Controller`
     (via `extract_deal_damage_target`).
  6. return the conjunction.
- `damage_reflection_to_controller_trigger(trigger) -> bool`: same gates 1–3,
  then the effect must match **exactly**
  `Effect::DealDamage { amount: QuantityExpr::Ref { qty:
  QuantityRef::EventContextAmount }, target: TargetFilter::Controller, .. }`.
- `is_event_context_damage_to_player(effect)`: matches `Effect::DealDamage {
  amount: QuantityExpr::Ref { qty: QuantityRef::EventContextAmount }, target,
  .. }` AND `deal_damage_can_target_opponent_player(target)`.
- `extract_deal_damage_target(effect) -> Option<&TargetFilter>`:
  `Effect::DealDamage { target, .. } => Some(target)`, else `None`.
- `deal_damage_can_target_opponent_player(filter) -> bool`:
  - `TargetFilter::Player | TargetFilter::Any` → `true`
  - `TargetFilter::Typed(tf)` → `true` if any `tf.type_filters` is
    `TypeFilter::Planeswalker`, OR (`tf.type_filters.is_empty()` AND
    `tf.controller == Some(ControllerRef::Opponent)`)
  - `TargetFilter::Or { filters }` → recurse; `true` if any matches
  - else → `false`

**Penalty (carry over VERBATIM):**
```rust
pub fn opponent_creature_reflection_penalty(
    state: &GameState,
    object_id: ObjectId,
    ai_player: PlayerId,
    damage: i32,
) -> f64 {
    let object = match state.objects.get(&object_id) { Some(o) => o, None => return 0.0 };
    if object.controller == ai_player { return 0.0; }                       // must be opponent's
    if !object.card_types.core_types.contains(&CoreType::Creature) { return 0.0; }
    if !has_damage_reflection_to_player(object) { return 0.0; }
    let remaining = object.toughness.map(|t| t - object.damage_marked as i32).unwrap_or(0);
    if damage >= remaining.max(0) { return 0.0; }                           // lethal => no reflection penalty
    -12.0                                                                    // PENALTY CONSTANT
}
```
Exact magic numbers: penalty **`-12.0`**; remaining toughness
`toughness - damage_marked`, clamped `remaining.max(0)`; lethal test
`damage >= remaining.max(0)` → `0.0`.

### (2) Phase types read → manabrew equivalent
| Phase | Use | manabrew equivalent | Cite |
|---|---|---|---|
| `engine::game::game_object::GameObject` | a permanent | `Card` | `card/mod.rs:197` (api-state.md) |
| `object.trigger_definitions` (`.iter_unchecked()`) | its triggers | `Card.triggers: Vec<Trigger>` | `card/mod.rs:389` |
| `engine::types::ability::TriggerDefinition` | one trigger | `Trigger` | `trigger/trigger.rs:23` |
| `trigger.mode: TriggerMode::DamageReceived` | "this creature was dealt damage" | `Trigger.kind: TriggerType::DamageDone` (`trigger/trigger_type.rs:21`) + the trigger's `valid_target` resolving to **Self** (the damaged object is this card). The behavior impl is `TriggerDamageDone { valid_source, valid_target, combat_damage_only }` | `trigger/trigger_damage_done.rs:11-15`; `Trigger.kind` `trigger/trigger.rs:29`; `Trigger.mode: Box<dyn TriggerBehavior>` `trigger/trigger.rs:30` |
| `trigger.valid_card: Option<TargetFilter>` (None or `SelfRef`) | trigger scoped to self | In manabrew, "dealt damage *to this creature*" is encoded as `TriggerDamageDone.valid_target` matching Self (selector text `Card.Self`), **not** a `valid_card` field. Read via the `CompiledSelector` `valid_target` on the downcast `TriggerDamageDone` | `trigger/trigger_damage_done.rs:13` |
| `trigger.execute: Option<...>` (the effect ability) | the reflection effect | `Trigger.execute: String` (an SVar/ability *name*, NOT a typed effect) → resolve to a `SpellAbility` via `Trigger::get_overriding_ability() -> Option<&SpellAbility>` (`trigger/trigger.rs:154`) or `Trigger.spawning_ability: Option<SpellAbility>` (`trigger/trigger.rs:40`) | `trigger/trigger.rs:33,40,154` |
| `Effect::DealDamage { amount, target, .. }` | typed effect node | `SpellAbility` with `api == Some(ApiType::DealDamage)` (api-ir.md §1); walk `sub_ability` chain (`spellability/mod.rs:138`) / `find_sub_ability_by_type(ApiType::DealDamage)` (`spellability/mod.rs:676`) | `ability/api_type.rs:11` |
| `QuantityExpr::Ref { qty: QuantityRef::EventContextAmount }` | amount == the damage just received | **NO typed equivalent.** In manabrew the amount is `sa.ir.num_dmg_text` / `damage_amount_text` (`ability/ability_ir.rs:436,245`) or `EffectIr::DealDamage(DealDamageIr{ amount: Option<AmountExpr> })` (`ability/ability_ir.rs:1227`). "Event-context damage" appears as an `AmountExpr::SVar("X")` whose X SVar counts the triggered damage (Forge `X$ Count$...`/`TriggerCount$DamageAmount`). Detect heuristically: amount references the triggered-damage value | `ability/ability_ir.rs:1227,1244`; `AmountExpr` `parsing/amount.rs:2` |
| `TargetFilter::Controller` | reflect to own controller (You) | `sa.ir.defined: Option<DefinedExpr>` containing `DefinedRef::You` (`ability/ability_ir.rs:125,1117`) — "You" = the trigger's controller | `ability/ability_ir.rs:125` |
| `TargetFilter::Player / Any` | can hit a player | `sa.ir.valid_tgts_text/_selector` == `Player`/`Any` (`ability/ability_ir.rs:103-104`) or `defined` = `Opponent`/`Targeted` | `ability/ability_ir.rs:103-104,125` |
| `TargetFilter::Typed(tf)` with `TypeFilter::Planeswalker` / `controller == Opponent` | hits PW or opponent perm | `sa.ir.valid_tgts_selector` (`CompiledSelector`) matching `Planeswalker` / controller=opponent; raw text in `valid_tgts_text` | `ability/ability_ir.rs:103-104` |
| `TargetFilter::Or { filters }` | union of filters | encoded inside the single `valid_tgts` selector string (comma/`,`-OR in Forge DSL), not a Rust `Or` node — inspect the `CompiledSelector`/text | `ability/ability_ir.rs:104` |
| `ControllerRef::Opponent` | opponent ownership | selector controller predicate (`Valid$ ...YouDontCtrl`/`Opponent`) | docs/forge-dsl-semantics.md |
| `TypeFilter::Planeswalker` / `CoreType` | type test | `CoreType` in `forge-foundation/src/card_type.rs`; `Card.is_planeswalker`/`is_creature` (`card/mod.rs:1022`); core types via `Card.type_line.core_types: BTreeSet<CoreType>` (`forge-foundation/src/card_type.rs:153`) | api-state.md |
| `state.objects.get(&object_id) -> Option<&GameObject>` | fetch card | `GameState::card(CardId) -> &Card` (`game.rs:263`); existence guard via index validity | api-state.md |
| `object.controller` | controller | `Card.controller: PlayerId` | `card/mod.rs:209` |
| `object.card_types.core_types.contains(&CoreType::Creature)` | is creature | `Card::is_creature()` (`card/mod.rs:1022`) — preferred, accounts for bestow | api-state.md |
| `object.toughness: Option<i32>` | toughness | `Card::toughness() -> i32` (layered) (`card/mod.rs:1000`); raw `Card.base_toughness: Option<i32>` (`card/mod.rs:232`) | api-state.md |
| `object.damage_marked: u32` | damage already on it | `Card.damage: i32` (`card/mod.rs:292`) | api-state.md |
| `engine::types::player::PlayerId`, `identifiers::ObjectId` | ids | `PlayerId` (`ids.rs:9`), `CardId` (`ids.rs:5`) | api-state.md |

### (3) Faithful-port plan
The penalty function is fully engine-agnostic and ports **verbatim** (constants
intact). The trigger-pattern predicates must be rewritten from Phase's typed
`Effect`/`TargetFilter` AST onto manabrew's `Trigger` + resolved `SpellAbility`
+ `SpellAbilityIr`. Skeleton:
```rust
use forge_engine::game::GameState;
use forge_engine::ids::{CardId, PlayerId};
use forge_engine::card::Card;
use forge_engine::trigger::{Trigger, TriggerType};
use forge_engine::ability::api_type::ApiType;
use forge_engine::spellability::SpellAbility;

pub fn has_damage_reflection_to_player(card: &Card) -> bool {
    card.triggers.iter().any(damage_reflection_to_player_trigger)
}
pub fn has_damage_reflection_to_controller(card: &Card) -> bool {
    card.triggers.iter().any(damage_reflection_to_controller_trigger)
}

fn damage_reflection_to_player_trigger(trigger: &Trigger) -> bool {
    if trigger.kind != TriggerType::DamageDone { return false; }
    if !trigger_target_is_self(trigger) { return false; }            // valid_target ~ Card.Self
    let sa = match trigger.get_overriding_ability() { Some(s) => s, None => return false };
    let dmg = match find_deal_damage(sa) { Some(d) => d, None => return false };
    amount_is_event_damage(dmg) && deal_damage_can_target_opponent_player(dmg) && !deal_damage_targets_controller(dmg)
}

fn damage_reflection_to_controller_trigger(trigger: &Trigger) -> bool {
    if trigger.kind != TriggerType::DamageDone { return false; }
    if !trigger_target_is_self(trigger) { return false; }
    let sa = match trigger.get_overriding_ability() { Some(s) => s, None => return false };
    let dmg = match find_deal_damage(sa) { Some(d) => d, None => return false };
    amount_is_event_damage(dmg) && deal_damage_targets_controller(dmg)
}

fn find_deal_damage(sa: &SpellAbility) -> Option<&SpellAbility> {
    if sa.api == Some(ApiType::DealDamage) { return Some(sa); }
    sa.find_sub_ability_by_type(ApiType::DealDamage)              // spellability/mod.rs:676
}

// amount references the triggered/event damage amount (Forge: NumDmg$ X with X = TriggerCount$DamageAmount,
// or EffectIr::DealDamage amount = AmountExpr::SVar referencing the triggered damage). Inspect:
//   sa.ir.num_dmg_text / sa.ir.damage_amount_text, or sa.ir.effect == Some(EffectIr::DealDamage(..)).
fn amount_is_event_damage(dmg: &SpellAbility) -> bool { /* match SVar/Count referencing trigger damage */ }

// target is the trigger's controller (DefinedRef::You) — Boros Reckoner / Jackal Pup
fn deal_damage_targets_controller(dmg: &SpellAbility) -> bool { /* dmg.ir.defined == You */ }

// target can hit a player / opponent / planeswalker — Spiteful Sliver / Spitemare
fn deal_damage_can_target_opponent_player(dmg: &SpellAbility) -> bool { /* dmg.ir.valid_tgts / defined */ }

// penalty — VERBATIM constants
pub fn opponent_creature_reflection_penalty(game: &GameState, card_id: CardId, ai_player: PlayerId, damage: i32) -> f64 {
    let c: &Card = game.card(card_id);                 // game.rs:263 (guard validity upstream)
    if c.controller == ai_player { return 0.0; }
    if !c.is_creature() { return 0.0; }                // card/mod.rs:1022
    if !has_damage_reflection_to_player(c) { return 0.0; }
    let remaining = c.toughness() - c.damage;          // toughness() card/mod.rs:1000 ; damage card/mod.rs:292
    if damage >= remaining.max(0) { return 0.0; }
    -12.0
}
```
Notes for the implementer:
- `trigger_target_is_self`: downcast `trigger.mode` (`Box<dyn
  TriggerBehavior>`) to `TriggerDamageDone` and test its `valid_target`
  `CompiledSelector` resolves to Self (`Card.Self`), OR is `None`
  (`trigger_damage_done.rs:13`). Phase's `valid_card == None | SelfRef` maps
  here.
- `toughness()` returns `i32` (not `Option`), so the Phase
  `.map(..).unwrap_or(0)` collapses to `c.toughness() - c.damage`. `c.damage`
  is already `i32` (`card/mod.rs:292`), so no `as i32` cast.

### (4) Dependencies on other phase-ai modules
None at runtime. Conceptually adjacent to `ability_chain` (both walk effect
chains) but `damage_reflection` walks the `SpellAbility.sub_ability` chain
directly / uses `find_sub_ability_by_type`, so it can stand alone. Consumed by
the board-evaluation / attack policies (they call
`opponent_creature_reflection_penalty`).

### (5) Risks
- **Hardest of the four.** Phase reads a strongly-typed `Effect`/`TargetFilter`
  AST that manabrew does not have; the reflection effect lives behind
  `Trigger.execute: String` → must be resolved to a `SpellAbility` and
  classified via `ApiType::DealDamage` + `SpellAbilityIr` operand text/selectors.
  Adaptation, not transcription.
- **`QuantityRef::EventContextAmount` has no typed analogue** — "amount equals
  the damage just received" must be inferred from the Forge SVar/Count
  expression (e.g. `NumDmg$ X`, `X$ TriggerCount$DamageAmount`). Risk of false
  negatives/positives; needs a small, well-tested heuristic against the four
  named cards' actual card scripts.
- **`TargetFilter::Or` / `Typed{Planeswalker, controller==Opponent}`** collapse
  into a single Forge `Valid$` selector string rather than a Rust enum tree —
  the `can_target_opponent_player` predicate must inspect the
  `CompiledSelector`/raw `valid_tgts_text`, which is fuzzier than matching enum
  arms.
- **`trigger.mode == DamageReceived` vs `TriggerType::DamageDone` + self-target**
  is a semantic remap (Phase models "damage received by me"; manabrew models
  "damage done" + valid_target=Self). Must verify the self-scoping is read
  correctly off `TriggerDamageDone.valid_target`.
- **Verbatim, low-risk:** the penalty math — `-12.0`, `remaining.max(0)`, lethal
  short-circuit, and all four `0.0` early-returns — port exactly. Confirm
  `toughness()`/`damage` are the layered accessor + raw field (api-state.md), not
  `base_toughness`.
- Feasibility verdict: **feasible** on the Forge-DSL engine, but only via
  resolve-the-ability + selector inspection; budget test coverage for the four
  reference cards.

---

## Cross-module summary
- **Verbatim-portable:** `ability_chain` (loop), `damage_reflection` penalty
  math + the detector control flow (constant `-12.0` and all thresholds), the
  `decision_kind` priority-action routing table and `DecisionKind` enum, the
  `auto_play` `MAX_AI_ACTIONS_PER_SEQUENCE = 200` cap + log strings.
- **Adaptation-bound (engine architecture):** `auto_play` (no `apply`/
  `WaitingFor` → becomes a `PlayerAgent`), `decision_kind` (no `WaitingFor` →
  per-callback kinds + priority dispatch; `PlayLand` reconstructed as a land
  `CastSpell`), `damage_reflection` typed-`Effect` reads (→ resolve
  `Trigger.execute` to a `SpellAbility` + `ApiType`/`SpellAbilityIr`).
- **No engine equivalent (flagged):** `WaitingFor` enum, `apply()` reducer +
  `GameEvent`, `Effect`/`TargetFilter`/`QuantityExpr` typed AST,
  `QuantityRef::EventContextAmount`, `GameAction::PlayLand`, `CombatTaxContext`.
- **External phase-ai deps to define:** `config::AiConfig`,
  `search::choose_action`, `policies::registry::DecisionKind` (+ the
  `policies::*` / `features::*` consumers).
