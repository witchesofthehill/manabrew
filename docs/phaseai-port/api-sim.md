# manabrew Rust engine — simulation/agent API reference

All paths relative to `forge-engine/crates/`. Crate `forge-engine` unless noted.

## 1. GameState — clone cost & shape

`pub struct GameState` — `forge-engine/src/game.rs:92`. Derives `#[derive(Debug, Clone, Serialize, Deserialize)]` (game.rs:91). This is the single owner of all game entities; nothing holds references, everything is keyed by `CardId`/`PlayerId`.

Key fields (game.rs:92-195):
- `pub cards: Vec<Card>` (game.rs:94) — the card arena. **Dominant clone cost.**
- `pub players: Vec<PlayerState>` (game.rs:95)
- `zones: ZoneStore` (private, game.rs:99) — `#[serde(skip)]`; cloned by `.clone()` but skipped by serde. Snapshot/restore via `zone_store_snapshot()` (game.rs:289) / `replace_zone_store()` (game.rs:293).
- `pub stack: MagicStack` (game.rs:102)
- `pub turn: TurnState` (game.rs:114)
- `pub player_order: Vec<PlayerId>` (game.rs:117)
- `pub game_over: bool` (game.rs:120), `pub winner: Option<PlayerId>` (game.rs:121)
- Many `#[serde(skip)]` runtime-only fields: `cost_payment_stack`, `pending_damage_map`, `pending_prevent_map`, `pending_change_zone_table`, `last_state_battlefield`, `pre_sba_battlefield`, etc. (game.rs:106-194). These are deep-cloned by `Clone` but excluded from serialization.

**Clone cost:** `GameState::clone()` is a full deep copy. The bulk is `cards: Vec<Card>`. `pub struct Card` — `forge-engine/src/card/mod.rs:197`, `#[derive(Debug, Clone, Serialize, Deserialize)]` (mod.rs:196), **~116 fields**, including heavy owned `Vec`/`BTreeMap` members each holding parsed IR: `keywords: KeywordCollection` (mod.rs:305), `abilities: Vec<String>` (mod.rs:335), `activated_abilities: Vec<ActivatedAbility>` (mod.rs:350), `static_abilities: Vec<StaticAbility>` (mod.rs:368), `triggers: Vec<Trigger>` (mod.rs:389), `replacement_effects: Vec<ReplacementEffect>` (mod.rs:416), `counters: BTreeMap<CounterType,i32>` (mod.rs:301), `perpetual: Vec<PerpetualRecord>`, `melded_with: Vec<CardId>`. So per-card clone allocates many sub-vectors; a 60-card×N-player game clone is O(total cards × per-card IR). `CardInstance` is a type alias for `Card` (mod.rs:697).

`PlayerState` — `forge-engine/src/player/state.rs:12`, `#[derive(Debug, Clone, Serialize, Deserialize)]` (state.rs:11), ~111 `pub` fields. `TurnState` — `forge-engine/src/phase/mod.rs:145` (fields: `turn_number: u32`, `active_player`, `phase: PhaseType`, `priority_player`, `num_players`, combat flags, `combat_block_assignments: Vec<(CardId,CardId)>`, `drawn_for_turn`).

Accessors: `card(id)->&Card` / `card_mut` (game.rs:263/267), `player`/`player_mut` (game.rs:271/275), `zone(zt,owner)->&Zone` / `zone_mut` (game.rs:279/283), `cards_in_zone`, `cards_in_all_zones` (game.rs:301), `active_player()`, `next_player()`. Constructor `GameState::new(player_names: &[&str], starting_life: i32)` (game.rs:198); for full setup use `GameState::new_from_registered_players(&[RegisteredPlayer])` (game.rs).

IDs: `pub struct CardId(pub u32)` (ids.rs:5), `pub struct PlayerId(pub u32)` (ids.rs:9); both have `.index()`.

### Snapshot / rollback (cheap-ish copy unit)
`pub struct GameSnapshot { game: GameState, mana_pools: Vec<ManaPool>, combat: CombatState, trigger_handler: TriggerHandler }` — `forge-engine/src/game_snapshot.rs:8`, `#[derive(Debug, Clone)]`.
- `GameSnapshot::capture(game, mana_pools, combat, trigger_handler, include_stack: bool) -> Self` (game_snapshot.rs:16) — does `game.clone()` then optionally resets `stack` to empty (game_snapshot.rs:23-25).
- `restore_game_state(&self, &mut GameState, &mut Vec<ManaPool>, &mut CombatState, &mut TriggerHandler)` (game_snapshot.rs:36) — full `*x = self.x.clone()`.
- `restore_game_state_with_mana_slice(...)` (game_snapshot.rs:53) variant preserving caller-owned mana Vec allocation.

To clone the entire simulation unit you must clone GameState **plus** the GameLoop-side `mana_pools`, `combat`, `trigger_handler` (GameSnapshot bundles exactly these four).

## 2. GameLoop — driver

`pub struct GameLoop` — `forge-engine/src/game_loop.rs:38`. Holds the per-game runtime state that lives *outside* GameState:
- `pub mana_pools: Vec<ManaPool>` (game_loop.rs:39)
- `pub combat: CombatState` (game_loop.rs:40)
- `pub trigger_handler: TriggerHandler` (game_loop.rs:41)
- `pub game_log: GameLog` (game_loop.rs:42)
- `pub token_templates: HashMap<String, Card>` (game_loop.rs:45), `token_art_variants`, `token_fallback`, `edition_dates`
- `pub game_rng: Box<dyn GameRng>` (game_loop.rs:59) — default `ThreadRngAdapter`; swap for deterministic parity RNG
- `pub experimental_restore_snapshot: bool` (game_loop.rs:61)
- `pub abort_signal: Option<Arc<AtomicBool>>` (game_loop.rs:79) — cooperative shutdown
- `pub provide_priority_action_space: bool` (game_loop.rs:83) — if true, engine precomputes `PriorityActionSpace` before each `choose_action`; parity/AI may set false.

Constructor & config:
- `GameLoop::new(num_players: usize) -> Self` (game_loop.rs:157)
- `set_provide_priority_action_space(&mut self, bool)` (game_loop.rs:181)
- `set_abort_signal(&mut self, Arc<AtomicBool>)` (game_loop.rs:189)
- `register_token_template(...)` (game_loop.rs:200 area)

Run API (all take `agents: &mut [Box<dyn PlayerAgent>]` and `rng: &mut impl rand::Rng`):
- `setup(&mut self, game: &mut GameState, agents, rng)` (game_loop.rs:374) — first-player roll, shuffle, draw 7, London mulligans.
- `run_opening_hand_actions(&mut self, game, agents)` (game_loop.rs:486) — `MayEffectFromOpeningHand` pass.
- `run(&mut self, game: &mut GameState, agents, rng, max_turns: u32) -> Option<PlayerId>` (game_loop.rs:595) — full game: calls `setup`, `run_opening_hand_actions`, resets triggers, fires `NewGame`, then loops `run_turn` while `!game.game_over && turn_number <= max_turns`; honors `abort_signal`. Returns `game.winner`.
- `run_turn(&mut self, game, agents, rng)` (game_loop.rs:624) — one turn: handles SkipTurn, `new_turn_for_player`, snapshots/notifies agents, `apply_continuous_effects`, `reset_active_triggers`, then `run_turn_state_machine`.

### Internal turn state machine
`run_turn_state_machine(&mut self, game: &mut GameState, agents: &mut [Box<dyn PlayerAgent>])` — `forge-engine/src/game_loop/phase_handler.rs:4` (`pub(crate)`). Flow:
1. `BeginTurn` replacement effect; early-return if Skipped/Replaced (phase_handler.rs:14-21).
2. `TurnBegin` trigger (phase_handler.rs:25-34).
3. Drives `enum TurnMachineState { Untap, Upkeep, Draw, Main1, Combat, Main2, EndOfTurn, Cleanup, Done }` (game_loop.rs:127) via `while !game.game_over && state != Done` (phase_handler.rs:37). Honors `is_aborted()` and `game.end_turn_requested` (jump to Cleanup). Each arm dispatches `apply_turn_event(game, agents, TurnEvent)` where `enum TurnEvent { EnterPhase{phase,emit_phase_trigger}, PriorityWindow{is_main_phase}, UntapStep, DrawStep, CombatStep, CleanupStep, AdvanceTurn }` (game_loop.rs:140). Per-phase skip flags checked (`skip_next_untap`, `skip_next_draw`, turn-1 2-player draw skip).

Priority windows ultimately call `PlayerAgent::choose_action`; the action-space enumerator lives in `game_loop/action_space.rs` and `game_loop/playability.rs`.

## 3. PlayerAgent trait

`pub trait PlayerAgent` — `forge-engine/src/agent/mod.rs:23`. The engine never decides; it calls back into the agent. Reference impls: `PassAgent` (agent/mod.rs:1035) — minimal; `PromptAgent` (self-hosted-node) — network/AI transport.

### Required methods (no default — must implement)
- `mulligan_decision(&mut self, player: PlayerId, hand: &[CardId], mulligan_count: u32) -> bool` (mod.rs:64)
- `choose_action(&mut self, player: PlayerId, action_space: Option<&PriorityActionSpace>, request_action_space: &mut dyn FnMut() -> PriorityActionSpace) -> PlayerAction` (mod.rs:121) — **the priority decision**.
- `choose_attackers(&mut self, player, available: &[CardId], possible_defenders: &[DefenderId]) -> Vec<(CardId, DefenderId)>` (mod.rs:131)
- `choose_blockers(&mut self, player, attackers: &[CardId], available_blockers: &[CardId], max_blockers: Option<usize>) -> Vec<(CardId, CardId)>` (mod.rs:156) — returns (blocker, attacker) pairs.
- `choose_targets_for(&mut self, sa: &mut SpellAbility, game: &GameState, mana_pools: &[ManaPool]) -> bool` (mod.rs:279)
- `choose_target_player(&mut self, player, valid: &[PlayerId], sa: Option<&SpellAbility>) -> Option<PlayerId>` (mod.rs:288)
- `choose_target_card(&mut self, player, valid: &[CardId], sa: Option<&SpellAbility>) -> Option<CardId>` (mod.rs:296)
- `choose_target_any(&mut self, player, valid_players: &[PlayerId], valid_cards: &[CardId], sa: Option<&SpellAbility>) -> TargetChoice` (mod.rs:315)
- `choose_land_or_spell(&mut self, player: PlayerId) -> Option<bool>` (mod.rs:1017) — true=land, false=spell, None=pass.

### Default methods (override only as needed) — by area
- **Observation/UI:** `snapshot_state(&mut self, &GameState, &[ManaPool])` (mod.rs:26, no-op), `take_restore_request(&mut self)->Option<u64>` (mod.rs:29), `on_library_peek` (mod.rs:37), `reveal_cards` (mod.rs:39), `notify(&mut self, GameNotification)` (mod.rs:1021), `await_display_ack(&mut self)` (mod.rs:970).
- **Pass-until / flow:** `get_pass_until_phase(&self)->Option<Option<&str>>` (mod.rs:54), `clear_pass_until` (mod.rs:59).
- **Mulligan async + London:** `mulligan_decision_send/recv` (mod.rs:70/81), `choose_cards_to_bottom` (mod.rs:93) + `_send/_recv` (mod.rs:103/107).
- **Combat detail:** `exert_attackers` (mod.rs:142), `enlist_attackers` (mod.rs:150), `choose_blocker_for` (mod.rs:169), `choose_damage_assignment_order` (mod.rs:186), `assign_combat_damage(&mut self, game: &GameState, player, attacker, blockers_in_order, defender_id, damage_to_assign) -> Vec<(Option<CardId>, i32)>` (mod.rs:204, has full default deathtouch/trample logic), `pay_combat_cost(...) -> CombatCostAction` (mod.rs:883).
- **Targeting/zone extras:** `choose_target_card_from_zone` (mod.rs:304), `choose_sacrifice` (mod.rs:326), `choose_target_spell` (mod.rs:404), `choose_single_entity_for_effect` (mod.rs:442), `choose_entities_for_effect` (mod.rs:708), `choose_single_card_for_zone_change` (mod.rs:719), `choose_cards_for_zone_change` (mod.rs:732), `choose_cards_for_effect` (mod.rs:680).
- **Library manipulation:** `choose_scry` (mod.rs:337), `choose_surveil` (mod.rs:343), `choose_dig` (mod.rs:350), `choose_reorder_library` (mod.rs:363), `choose_explore_put_in_graveyard` (mod.rs:465).
- **Discard:** `choose_discard` (mod.rs:370), `choose_discard_any_number` (mod.rs:377), `choose_random_discard` (mod.rs:392).
- **Modes/abilities:** `choose_mode` (mod.rs:421), `choose_spell_abilities_for_effect` (mod.rs:432), `get_ability_to_play` (mod.rs:451), `choose_single_replacement_effect` (mod.rs:1024), `choose_legend_keep` (mod.rs:491).
- **Optional triggers / confirmations:** `choose_optional_trigger` (mod.rs:501), `confirm_replacement_effect` (mod.rs:511), `confirm_action(player, mode, message, options, source, api) -> bool` (mod.rs:525), `confirm_payment` (mod.rs:537), `pay_cost_to_prevent_effect` (mod.rs:549), `choose_binary(...)->bool` (mod.rs:564).
- **Cost options:** `choose_kicker` (mod.rs:589), `help_pay_assist` (mod.rs:600), `choose_buyback` (mod.rs:607), `choose_multikicker` (mod.rs:620), `choose_replicate` (mod.rs:634), `choose_alternative_cost` (mod.rs:648), `choose_x_value(player, max_x, source)->u32` (mod.rs:865, default max_x), `choose_phyrexian_pay_life` (mod.rs:872), `choose_delve` (mod.rs:899), `choose_improvise` (mod.rs:912), `choose_convoke` (mod.rs:925), `choose_tap_type_for_cost` (mod.rs:695), `choose_number_for_keyword_cost` (mod.rs:781).
- **Choices (color/type/name/number/counter):** `choose_color` (mod.rs:660), `choose_colors` (mod.rs:665), `choose_type` (mod.rs:747), `choose_counter_type` (mod.rs:757), `choose_card_name` (mod.rs:769), `choose_number(min,max)->Option<i32>` (mod.rs:775), `choose_number_from_list` (mod.rs:792).
- **Dice/coin:** `flip_coin_call` (mod.rs:857), `choose_roll_to_ignore` (mod.rs:803), `choose_roll_to_swap` (mod.rs:813), `choose_dice_to_reroll` (mod.rs:823), `choose_roll_to_modify` (mod.rs:833), `choose_roll_swap_value(...)->Option<RollSwapChoice>` (mod.rs:843).
- **Mana payment loop:** `pay_mana_cost(...) -> ManaCostAction` (mod.rs:941, default `AttemptedAndFailed`), `specify_mana_combo(...) -> Vec<String>` (mod.rs:1000), `decide_cost_part(player, source, &CostPart, &GameState) -> Option<PaymentDecision>` (mod.rs:973), `pays_right_after_decision(&self)->bool` (mod.rs:986), `order_cost_parts(Vec<CostPart>)->Vec<CostPart>` (mod.rs:991).

## 4. Agent-facing data types

In `forge-engine/src/agent/types.rs`:
- `pub enum GameEntity { Player(PlayerId), Card(CardId) }` (types.rs:10)
- `pub struct PlayOption { card_id: CardId, mode: PlayCardMode, alt_cost_index: u8 }` (types.rs:16); `PlayOption::normal(card_id)` (types.rs:28). `pub enum PlayCardMode { Normal, BackFaceLand, RoomRightSplit, Alternative(AlternativeCost), StaticAlternative, ForetellExile, UnlockDoor }` (types.rs:46).
- `pub enum TargetChoice { Player(PlayerId), Card(CardId), None }` (types.rs:63)
- `pub enum MainPhaseAction { Pass, Play(PlayOption), ActivateMana(CardId, Option<usize>), UntapMana(CardId), ActivateAbility(CardId, usize) }` (types.rs:71)
- `pub struct PriorityActionSpace { playable: Vec<PlayOption>, tappable_lands: Vec<CardId>, untappable_lands: Vec<CardId>, activatable: Vec<(CardId, usize)> }` (types.rs:86); `.is_empty()` (types.rs:94).
- `pub enum CombatCostAction { TapLand(CardId), UntapLand(CardId), Pay, Decline }` (types.rs:104)
- `pub enum ManaCostAction { TapLand{card_id, mana_ability_index, express_choice}, UntapLand(CardId), Pay{auto: bool}, AttemptedAndFailed }` (types.rs:117)
- `pub struct ManaAbilityOption { card_id: CardId, ... }` (types.rs:134)
- `pub enum BinaryChoiceKind` (types.rs:142) with `.labels()` (types.rs:155) / `.as_str()` (types.rs:168); `pub enum RollSwapChoice { Power, ... }` (types.rs:183).

`PlayerAction` (the return of `choose_action`) — `forge-engine/src/player/actions/player_action.rs:11`: `enum PlayerAction { PassPriority, Concede, FinishTargeting, CastSpell(PlayOption), ActivateMana(CardId, Option<usize>), UndoMana(CardId), ActivateAbility(AbilityRef), PayCost(CardId), PayManaFromPool(ManaChoice), SelectCard(CardId), SelectPlayer(PlayerId), TargetEntity(TargetEntity) }`. Helpers: `AbilityRef{card_id, ability_index}` (player_action.rs:27), `ManaChoice{color_code: u8}` (player_action.rs:33), `TargetEntity{Card|Player}` (player_action.rs:38), `to_priority_action(...)->Option<MainPhaseAction>` (player_action.rs:51).

## 5. Constructing & running a game (host runtime)

`forge-engine/crates/forge-game-runtime/src/host_runtime.rs`:
- `pub const DEFAULT_MAX_TURNS: u32 = 5000` (host_runtime.rs:17)
- `pub struct HostedGameOutcome { winner: Option<PlayerId>, aborted: bool }` (host_runtime.rs:26)
- `pub fn run_hosted_multiplayer_game<F, G>(prepared_players: Vec<PreparedRegisteredPlayer>, abort_signal: Arc<AtomicBool>, max_turns: u32, rng: &mut StdRng, register_tokens: F, agent_factory: G) -> HostedGameOutcome where F: FnOnce(&mut GameLoop), G: FnMut(PlayerId) -> Box<dyn PlayerAgent>` (host_runtime.rs:30). Body (host_runtime.rs:42-86): builds `GameState::new_from_registered_players(&registered)`, `instantiate_registered_players(&mut game, prepared_players)`, `GameLoop::new(num_players)`, `set_abort_signal`, enables log, `experimental_restore_snapshot` from env, `register_tokens(&mut game_loop)`, builds `agents: Vec<Box<dyn PlayerAgent>>` one per seat via `agent_factory(PlayerId(i))`, then `game_loop.run(&mut game, &mut agents, rng, max_turns)`. On finish, snapshots agents + `GameNotification::GameOver`.
- `register_tokens_from_db(game_loop: &mut GameLoop, token_db: &CardDatabase)` (host_runtime.rs:19).

Player setup (`forge-game-runtime/src/deck.rs`): `pub struct PreparedRegisteredPlayer { registered: RegisteredPlayer, cards: Vec<(CardInstance, ZoneType)> }` (deck.rs:51); `prepare_players(names: &[String], decks: &[Deck], commander_names: &[Option<String>], db: &CardDatabase, starting_life: i32) -> Vec<PreparedRegisteredPlayer>` (deck.rs:66); `prepare_registered_player` (deck.rs:56); `instantiate_registered_players(game: &mut GameState, prepared_players: Vec<PreparedRegisteredPlayer>)` (deck.rs:152); `force_commander_by_name` (deck.rs:114).

## 6. self-hosted-node backend (concrete caller example)

`forge-engine/crates/self-hosted-node/src/engine_backend/rust_backend.rs`:
- `run_hosted_engine_game(game_id, player_names: Vec<String>, decks: Vec<Deck>, commander_names: Vec<Option<String>>, local_player_index: Option<usize>, starting_life: i32, remote_prompt_tx, remote_response_rxs, game_over_tx)` (rust_backend.rs:27). Calls `prepare_players(...)` then `run_hosted_multiplayer_game(...)` (rust_backend.rs:63). The `agent_factory` closure (rust_backend.rs:69-85) returns `PromptAgent::new(pid, game_id, transport)` — local seat gets `BotResponder::default()`, remote seats get `NodeTransport::new_relay(i, prompt_tx, response_rx)`. `PromptAgent` is the `impl PlayerAgent` used for both AI and networked play.
- `run_self_play(seats: &[DeckSelection], starting_life: i32, seed: u64, max_turns: u32) -> Result<(), String>` (rust_backend.rs:90) — deterministic `StdRng::seed_from_u64(seed)`, all seats `PromptAgent` + `BotResponder`. **This is the cleanest template for an AI/sim driver**: seed RNG, build prepared players, supply a custom `Box<dyn PlayerAgent>` per seat.

### Driving simulation from an AI module
To run/clone-and-simulate: implement `PlayerAgent` (override at minimum the 9 required methods; for a fast rollout bot, `choose_action` reads `action_space: Option<&PriorityActionSpace>` or calls `request_action_space()`), then either (a) call `run_hosted_multiplayer_game` for a full game, or (b) hold your own `GameLoop` + `GameState` and call `setup` then `run_turn` in a loop for step-level control. For lookahead/MCTS, deep-copy the whole unit with `GameState::clone()` + clone of `GameLoop.mana_pools/combat/trigger_handler` (mirror `GameSnapshot::capture`, game_snapshot.rs:16) — note this is an expensive full deep clone (Vec<Card> with per-card IR vectors); set a deterministic `game_rng` and seeded `rng` for reproducibility, and `set_provide_priority_action_space(false)` to skip eager action-space computation when your agent requests it lazily.
