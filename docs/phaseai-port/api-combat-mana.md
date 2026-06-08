# Engine API reference — combat / mana / action_space / PlayerAction

Workspace root: `/Users/emanueledivizio/dev/khaliostr/manabrew`
Engine src root (all paths below relative to it): `forge-engine/crates/forge-engine/src/`

The engine never decides; it asks a `PlayerAgent` (see `agent/mod.rs:23`). An AI module either (a) implements `PlayerAgent`, or (b) drives the priority loop by emitting `PlayerAction` values. Both surfaces are covered below.

## Core IDs

- `CardId(pub u32)` — `ids.rs:5`; `.index() -> usize` `ids.rs:12`.
- `PlayerId(pub u32)` — `ids.rs:9`; `.index() -> usize` `ids.rs:18`.
- `DefenderId` — `combat/mod.rs:24`. `enum { Player(PlayerId), Permanent(CardId) }` (Permanent = planeswalker/battle).
  - `.controlling_player(&GameState) -> PlayerId` `combat/mod.rs:32`
  - `.as_player() -> Option<PlayerId>` `combat/mod.rs:40`

## PlayerAction — typed player intents (`player/actions/player_action.rs`)

`enum PlayerAction` (Copy, Serde) — `player/actions/player_action.rs:11`:
- `PassPriority`, `Concede`, `FinishTargeting`
- `CastSpell(PlayOption)`
- `ActivateMana(CardId, Option<usize>)` — tap a land; opt ability index for dual lands
- `UndoMana(CardId)` — untap/undo a mana source
- `ActivateAbility(AbilityRef)`
- `PayCost(CardId)`, `PayManaFromPool(ManaChoice)`
- `SelectCard(CardId)`, `SelectPlayer(PlayerId)`, `TargetEntity(TargetEntity)`

Supporting types (same file):
- `struct AbilityRef { card_id: CardId, ability_index: usize }` `:27`
- `struct ManaChoice { color_code: u8 }` `:33`
- `enum TargetEntity { Card(CardId), Player(PlayerId) }` `:38`
- `const STATIC_ALTERNATIVE_ABILITY_INDEX: usize = usize::MAX` `:8`

Conversion helpers (validate against an action space, return `None` if illegal):
- `PlayerAction::to_priority_action(self, playable: &[PlayOption], tappable_lands: &[CardId], untappable_lands: &[CardId], activatable: &[(CardId, usize)]) -> Option<MainPhaseAction>` `:51`
- `PlayerAction::to_target_choice(self) -> Option<TargetChoice>` `:80`
- `PlayerAction::run(self, &mut PlayerController, …) -> PlayerActionOutcome` `:95`
- `enum PlayerActionOutcome { Priority(MainPhaseAction), Target(TargetChoice), Pending }` `:44`

## Legal-action enumeration — action_space (`game_loop/action_space.rs`)

`GameLoop::action_space(&self, game: &GameState, player: PlayerId, is_main_phase: bool) -> PriorityActionSpace` `game_loop/action_space.rs:125`
- Builds: `playable` (via `get_playable_cards`, sorcery-speed gated by active player + empty stack), `activatable` (`get_activatable_abilities`), `tappable_lands` (battlefield cards passing `mana_source_available_for_payment`), `untappable_lands` (`undoable_mana_sources`).

`struct PriorityActionSpace` — `agent/types.rs:86`:
```
pub playable: Vec<PlayOption>,
pub tappable_lands: Vec<CardId>,
pub untappable_lands: Vec<CardId>,
pub activatable: Vec<(CardId, usize)>,   // (source card, ability index)
```
- `.is_empty() -> bool` `agent/types.rs:94`

Mana-source legality helpers (assoc. fns on `GameLoop`, all in `action_space.rs`):
- `mana_source_available_for_payment(game, player, card_id) -> bool` `:5`
- `mana_source_available_for_payment_with_reserved(…, reserved_sacrifices: &[CardId]) -> bool` `:13`
- `..._with_reserved_and_reuse(…, allow_reserved_source_reuse: bool) -> bool` `:28`
- `mana_ability_available_for_payment_with_reserved(game, player, card_id, ab: &ActivatedAbility, reserved: &[CardId]) -> bool` `:60` (+ `_and_reuse` `:77`)

## Agent priority/action surface (`agent/types.rs`)

- `struct PlayOption { card_id: CardId, mode: PlayCardMode, alt_cost_index: u8 }` `:16`; ctors `PlayOption::normal(card_id)` `:28`, `with_mode(card_id, mode)` `:36`.
- `enum PlayCardMode { Normal, BackFaceLand, RoomRightSplit, Alternative(AlternativeCost), StaticAlternative, ForetellExile, UnlockDoor }` `:46`
- `enum TargetChoice { Player(PlayerId), Card(CardId), None }` `:63`
- `enum MainPhaseAction { Pass, Play(PlayOption), ActivateMana(CardId, Option<usize>), UntapMana(CardId), ActivateAbility(CardId, usize) }` `:71`
- `enum CombatCostAction { TapLand(CardId), UntapLand(CardId), Pay, Decline }` `:104` (Propaganda/Ghostly Prison attack taxes)
- `enum ManaCostAction { TapLand{card_id, mana_ability_index, express_choice}, UntapLand(CardId), Pay{auto: bool}, AttemptedAndFailed }` `:117` (interactive mana payment)
- `enum GameEntity { Player(PlayerId), Card(CardId) }` `:10`

## PlayerAgent trait — combat & priority callbacks (`agent/mod.rs:23`)

- `choose_action(&mut self, player, action_space: Option<&PriorityActionSpace>, request_action_space: &mut dyn FnMut() -> PriorityActionSpace) -> PlayerAction` `:121`
- `choose_attackers(&mut self, player, available: &[CardId], possible_defenders: &[DefenderId]) -> Vec<(CardId, DefenderId)>` `:131`
- `exert_attackers(player, attackers) -> Vec<CardId>` `:142`; `enlist_attackers(...)` `:150`
- `choose_blockers(&mut self, player, attackers: &[CardId], available_blockers: &[CardId], max_blockers: Option<usize>) -> Vec<(CardId, CardId)>` (returns (blocker, attacker) pairs) `:156`
- `choose_blocker_for(player, attackers, blocker: CardId) -> Option<CardId>` `:169`
- `choose_damage_assignment_order(player, attacker, blockers: &[CardId]) -> Vec<CardId>` `:186`
- `assign_combat_damage(&mut self, game, player, attacker: CardId, blockers_in_order: &[CardId], defender_id: Option<DefenderId>, damage_to_assign: i32) -> Vec<(Option<CardId>, i32)>` `:204` — `Some(blocker)` assigns to a blocker, `None` to the defender (trample). Default impl encodes lethal/deathtouch/indestructible/trample logic — read it as the reference heuristic.

## Combat (`combat/mod.rs`)

`struct CombatState` (Default, Serde) — `combat/mod.rs:65`. Key fields:
- `attacking_player: Option<PlayerId>` `:67`, `defending_player: Option<PlayerId>` `:69`
- `attackers: Vec<(CardId, DefenderId)>` `:71`
- `blockers: Vec<(CardId, CardId)>` (blocker, attacker) `:75`
- `blocked_attackers: HashSet<CardId>` `:80`, `damage_order: HashMap<CardId, Vec<CardId>>` `:88`, `lki_cache` `:92`

Declaration / mutation:
- `declare_attacker(&mut self, attacker: CardId, defending: DefenderId, zone_timestamp: u64)` `:123`
- `declare_blocker(&mut self, blocker: CardId, attacker: CardId, zone_timestamp: u64)` `:134`
- `add_attacker(&mut self, attacker, defender: DefenderId)` `:987`; `add_blocker(&mut self, attacker, blocker)` `:995`
- `remove_block_assignment(attacker, blocker)` `:1008`; `undo_blocking_assignment(blocker)` `:1018`
- `order_blockers_for_damage_assignment(&mut self, game, agents)` `:1029`; `add_blocker_to_damage_assignment_order(attacker, blocker)` `:1048`
- `clear_attackers(&mut self, game)` `:978`; `remove_from_combat(card, game)` `:1103`; `end_combat(&mut self, game)` `:960`

Queries:
- `is_attacking(card) -> bool` `:140`, `is_blocked(attacker) -> bool` `:144`, `was_blocked_this_combat(attacker) -> bool` `:149`
- `get_blockers_for(attacker) -> Vec<CardId>` `:153`, `get_attackers_for(blocker) -> Vec<CardId>` `:161`
- `get_attackers() -> Vec<CardId>` `:1158`, `get_all_blockers() -> Vec<CardId>` `:1163`
- `get_defender_by_attacker(attacker) -> Option<DefenderId>` `:1174`, `get_defender_player_by_attacker(attacker, game) -> Option<PlayerId>` `:1183`
- `is_blocking(blocker) -> bool` `:1193`, `is_blocking_attacker(blocker, attacker)` `:1198`, `is_unblocked(attacker)` `:1205`, `get_unblocked_attackers() -> Vec<CardId>` `:1210`
- `has_attackers() -> bool` `:169`, `has_first_strikers(game) -> bool` `:268`

Damage:
- `resolve_damage_step(&self, game: &mut GameState, agents: &mut [Box<dyn PlayerAgent>], first_strike_only: bool, as_unblocked_choices: &HashSet<CardId>) -> Vec<CombatDamageEvent>` `:294` — applies damage immediately, returns events for trigger firing.
- `assign_combat_damage(&self, game, agents, first_strike_damage: bool, as_unblocked_choices) -> Vec<CombatDamageEvent>` `:1137` (thin wrapper over resolve_damage_step).
- `deal_assigned_damage(&self, game)` `:1150` (no-op parity shim; damage already applied).
- `struct CombatDamageEvent { source: CardId, target_player: Option<PlayerId>, target_card: Option<CardId>, amount: i32, is_combat: bool, lifelink_player: Option<PlayerId>, lifelink_amount: i32 }` `:53`

Constraints / legality (module-level free fns, `combat/mod.rs`, delegate to `combat_util`):
- `get_available_attackers(game, player) -> Vec<CardId>` `:1509`
- `get_possible_defenders(game, attacking_player) -> Vec<DefenderId>` `:1514`
- `get_available_blockers(game, player) -> Vec<CardId>` `:1519`
- `can_creature_block(game, blocker_id, attacker_id) -> bool` `:1524`
- `filter_legal_blockers(game, attackers: &[CardId], blockers: &[CardId]) -> Vec<CardId>` `:1529`
- `validate_blocks(game, combat: &CombatState) -> Vec<(CardId, CardId)>` `:1732`
- `compute_must_block_targets(...)` `:1723`; `get_lure_type(card) -> LureType` `:1718` (`enum LureType` `:1708`)

`CombatState::init_constraints(&self, game) -> AttackConstraints` `:949`.
`struct AttackConstraints` — `combat/attack_constraints.rs:16`:
- `AttackConstraints::new(game, attacking_player, possible_defenders: &[DefenderId])` `:35`/`:151`
- `can_attack(defender: DefenderId) -> bool` `:70`; `can_attack_with(...)` `:76`
- `get_legal_attackers(&self, cards: &[Card]) -> (Vec<(CardId, DefenderId)>, i32)` `:214` (returns chosen attacker→defender set + violation count)
- `count_violations(attackers: &[(CardId, DefenderId)], cards) -> i32` `:342`
- `get_restrictions()/get_requirements()/get_global_restrictions()/get_types()` `:195`/`:203`/`:199`/`:135`

Driver: `GameLoop::step_combat(&mut self, game: &mut GameState, agents: &mut [Box<dyn PlayerAgent>])` — `game_loop/combat_phase.rs:5`. It calls `agent.choose_attackers` (`:79`) → `combat.declare_attacker` (`:510`) → `agent.choose_blockers` (`:697`) → `combat.declare_blocker` (`:725`,`:794`) → `resolve_damage_step` for first-strike (`:958`) then normal (`:1010`).

## Mana (`mana/`)

`struct Mana` — `mana/mod.rs:159`: `color: u16` (ManaAtom bitmask), `source_card: Option<CardId>`, `is_snow/is_persistent/is_combat_mana: bool`, `restriction: Option<String>`, `adds_no_counter: bool`, `adds_keywords/adds_keywords_valid/adds_counters/adds_counters_valid/triggers_when_spent: Option<String>`. Ctor `Mana::simple(color: u16)` `:187`.

`ManaAtom` color codes (bitmask u16) — `forge-foundation/src/mana.rs:9`: `WHITE=1, BLUE=2, BLACK=4, RED=8, GREEN=16, COLORLESS=32, GENERIC=64, IS_X=256`.

`struct ManaPool` (Default, Serde) — `mana/mana_pool.rs:48`. `color_matrix: ManaConversionMatrix` pub; internal `mana: Vec<Mana>` private. Key methods (`mana/mana_pool.rs`):
- Add: `add(atom: u16, amount: i32)` `:106`, `add_snow` `:113`, `add_restricted(atom, restriction)` `:122`, `add_mana(Mana)` `:194`, `pay_mana_from_ability(produced_color, amount)` `:992`
- Inspect: `total_mana() -> i32` `:200`, `count_color(atom) -> i32` `:204`, `white/blue/black/red/green/colorless()` `:208`–`:223`, `mana_colors() -> Vec<u16>` `:172`, `colors_present() -> u16` `:181`, `mana_entries() -> &[Mana]` `:176`, `has_atom(atom, amount) -> bool` `:245`, `iterator()` `:1243`
- Can-pay: `can_pay(&ManaCost) -> bool` `:313`, `can_pay_any_color(&ManaCost) -> bool` `:333`, `can_pay_for_spell(...)` `:351`, `can_pay_with_extra_generic(...)` `:529`, `can_pay_with_phyrexian_life(...)` `:634`
- Pay (mutating): `try_pay(&ManaCost) -> bool` `:751`, `try_pay_any_color(&ManaCost) -> bool` `:850`, `pay_color(atoms: u16) -> bool` `:925`, `pay_generic(amount: i32)` `:941`, `pay_mana_cost_from_pool(&ManaCost) -> bool` `:1040`, `try_pay_for_spell*` `:362`/`:385`/`:413`, `spend_generic(amount) -> i32` `:251`, `remove(atom, amount)` `:228`, `remove_mana(&Mana) -> bool` `:977`
- Refund/clear: `reset_pool()` `:279`, `clear_pool(phase: PhaseType) -> usize` `:285`, `clear_pool_with_keep(phase, keep_colors: u16)` `:292`, `refund_mana(&mut Vec<Mana>)` `:1023`, `restore_color_replacements()` `:96`
- Tracking: `begin_tap_tracking() -> Vec<u16>` `:1251`, `end_tap_tracking(pool_before) -> Vec<u16>` `:1257`, `rollback_tap(produced: &[u16])` `:1271`, `last_payment_atoms() -> &[u16]` `:88`, `take_last_payment_triggers_consumed() -> Vec<(String,CardId)>` `:1107`
- Misc: `has_burn() -> bool` `:971`, `will_mana_be_lost_at_end_of_phase() -> bool` `:965`, `atom_to_letter(atom) -> &str` `:1316`, `apply_card_matrix(&ManaConversionMatrix)` `:102`
- `struct ManaPaymentOutcome { life_paid: i32, colors_spent: u16, paying_mana: Vec<u16> }` `:17`

Cost/cmc types: `struct ManaCost` — `forge-foundation/src/mana.rs:386`; `ManaCost::zero()` `:403`, `generic(n)` `:412`, `parse(&str)` `:425`, `cmc() -> i32` `:505`, `generic_cost() -> i32` `:522`, `is_zero() -> bool` `:534`.

Available-mana computation (`mana/mod.rs`): `calculate_available_mana(pool, game, player) -> ManaPool` `:879`; `calculate_available_mana_for_casting(...)` `:883`; `..._excluding(...)` `:913`/`:891`; `..._with_context(...)` `:945`. Pool fields used by these: `total_sources: Option<i32>` `mana_pool.rs:66`, `source_colors: Option<Vec<u16>>` `:72`.

Mana production (`mana/mod.rs`): `struct ManaProductionParams` `:696`; `determine_mana_production_ir(...)` `:716`; `add_produced_mana_to_pool(...)` `:853`; helpers `mana_atom_from_produced(&str) -> Option<u16>` `:431`, `basic_land_mana_atom(card) -> Option<u16>` `:406`, `land_mana_atoms(card) -> Vec<u16>` `:634`, `color_name_to_mana_atom(name) -> Option<u16>` `:533`.

Payment context: `struct ManaPaymentContext` `mana/mod.rs:244`; `payment_context_for_sa(game, sa) -> ManaPaymentContext` `:273`; `mana_meets_restriction(restriction: &str, ctx) -> bool` `:305`.

Auto-pay (deterministic AI path, `mana/auto_pay.rs`):
- `pay_mana_cost_auto(game: &mut GameState, pool: &mut ManaPool, player, mana_cost: &ManaCost, current_spell: Option<CardId>, commander_tax: i32, payment_ctx: &ManaPaymentContext, any_color_conversion: bool) -> Option<AutoPayResult>` `:33`
- `..._with_chooser(…, sacrifice_chooser: Option<SacrificeChooser>)` `:58`; `..._with_callback(...)` `:130`; `..._with_callback_and_reserved_sacrifices(...)` `:165`
- `struct AutoPayResult { tapped: Vec<CardId>, choices: Vec<AutoTapChoice>, life_paid: i32, colors_spent: u16, paying_mana: Vec<u16>, cancelled: bool }` `:11`

## Cost framework (`cost/mod.rs`) — for activated abilities & non-mana costs

- `struct Cost { … parts: Vec<CostPart> }` `cost/mod.rs:498`
- `enum CostPart { Tap, Mana{cost: ManaCost, x_min, …}, PayLife(AmountSpec), Sacrifice{type_filter, amount}, … }` `:234`
- `can_pay(cost: &Cost, game: &GameState, available_mana: Option<&ManaPool>, source: CardId, player: PlayerId, ability: Option<&SpellAbility>) -> bool` `:1124`
- `can_pay_ignoring_mana(cost, game, source, player) -> bool` `:1209`; `..._with_ability` `:1226`; `..._for_spell` `:1239`

Note: `is_mana_ability` and `cost: Cost` live on `ActivatedAbility` (`ability/activated.rs`); `action_space` filters mana sources by inspecting `card.activated_abilities[].cost.parts` for `CostPart::Tap` and `is_mana_ability`.
