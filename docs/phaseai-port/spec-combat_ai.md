# Faithful Port Spec — `phase-ai/src/combat_ai.rs` → `forge-ai/src/combat_ai.rs`

Source: `https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/combat_ai.rs`
(3323 lines; **lines 1–1665 are production code, 1667–3323 are `#[cfg(test)]`**). All
behavior below is from the production portion. Manabrew engine paths are relative to
`forge-engine/crates/forge-engine/src/` unless noted (`forge-foundation/...` called out).

---

## 1. What this module does (the AI logic)

Combat decision-maker. Two public entry points the agent layer calls:

- **Attack declaration** — `choose_attackers_with_targets[_with_profile]`: picks which
  creatures attack and assigns each a target (player or planeswalker).
- **Block declaration** — `choose_blockers[_with_profile]`: assigns blockers to incoming
  attackers (blocker → attacker pairs).
- Helpers: `choose_attackers` (id-only wrapper), `is_lethal_attack_available` (main-phase
  "don't burn resources, just swing for lethal" check).

Everything is driven by a single 4-state `enum CombatObjective { PushLethal, Stabilize,
PreserveAdvantage, Race }` computed from life totals, board power, a per-difficulty
`AiProfile`, and (for blocking) commander-damage thresholds.

### 1a. Attack pipeline (`choose_attackers_with_targets_with_profile`, lines 45–311)
1. Bail if no opponents.
2. Build `candidates` = engine-supplied legal attacker ids, else local `can_attack` filter.
3. Partition `mandatory` = candidates with a live must-attack requirement (goad / "attacks
   each combat if able" / lure). These are force-declared regardless of value.
4. Pick `preferred_opponent` (the likely defender) and gather its untapped creatures as
   `opponent_blockers`.
5. Compute `objective` via `determine_attack_objective`.
6. **Per-creature gate**: a creature attacks if unblockable, or no blockers exist, or its
   attack passes `should_attack_given_objective` against the defender's *best* block
   (`defender_best_block`). Commanders are not traded away (only swing if they survive or
   under PushLethal). Lifelink relaxes the gate only when the swing is non-losing.
7. **Alpha-strike fallback** (lines 166–213): if the gate rejected everyone but we
   out-body the blockers, swing the whole team (excess gets through) — but only under
   `PreserveAdvantage|Race`, excluding the commander, and only if
   `unblocked_power as f64 > worst_loss_value`.
8. Union the `mandatory` set back in.
9. **Crackback prune** (lines 225–292): unless PushLethal, if tapping our attackers lets the
   opponent kill us next turn (`crackback_damage >= my_life`), hold back the highest-value
   non-vigilance, non-mandatory attackers one at a time until survivable. Optional
   `combat_lookahead` projects the opponent's upcoming attack step first.
10. **Target assignment**: single opponent → all at player, except a "kill it or ignore it"
    planeswalker redirect (`redirect_attackers_to_planeswalker`). Multi-opponent →
    `assign_attack_targets` (alpha-strike the weakest if reachable, else pressure one seat).

### 1b. Block pipeline (`choose_blockers_with_profile`, lines 555–984)
1. Compute block `objective` (`determine_block_objective`).
2. Collect untapped own creatures as `available_blockers`.
3. **Futility fast-path** (Stabilize only): if `block_is_futile` proves no assignment can
   prevent lethal, return no blocks (CPU guard against pathological boards).
4. Sort attackers by `evaluate_creature` value descending.
5. **Pass 1** — assign each deathtouch blocker to the highest-value (non-menace) attacker.
6. **Pass 2** — for each unblocked non-menace attacker, pick the best surviving/killing
   blocker by priority `survives*2 + kills`; apply damage-reflection skip, commander-headroom
   tightened life, and chump-stabilize / chump-race gates.
7. **Gang-block pass** (CR 509.1a) — multiple blockers on one attacker when combined power
   kills it and combined value ≤ attacker value; menace requires ≥2 blockers; first-strike
   and deathtouch filters applied.
8. **Pass 3** (Stabilize only) — if unblocked damage is still lethal, greedily chump highest
   damage-prevented attackers; then a per-commander chump pass (independent lethality).

---

## 2. Phase engine API used → manabrew equivalent

Phase uses a **global object model**: `GameState.battlefield: Vec<ObjectId>` +
`GameState.objects: HashMap<ObjectId, GameObject>`, `GameObject.power: Option<i32>`.
Manabrew uses an **index-arena, per-zone model**: no global battlefield; `game.card(CardId)
-> &Card`; `Card::power() -> i32` (layered, non-Option). This is the single biggest
structural adaptation and touches nearly every line.

| Phase symbol | Manabrew equivalent | Cite | Notes |
|---|---|---|---|
| `engine::types::identifiers::ObjectId` | `CardId(pub u32)` | `ids.rs:5` | `.index()` ids.rs:12 |
| `engine::types::player::PlayerId` | `PlayerId(pub u32)` | `ids.rs:9` | same shape |
| `GameState` / `state.objects.get(&id)` | `GameState` / `game.card(CardId) -> &Card` | `game.rs:92,263` | manabrew accessor panics on bad id; ids from zone scans are valid |
| `state.battlefield: Vec<ObjectId>` (global) | **NO global list** — `game.cards_in_zone(ZoneType::Battlefield, pid)` per player; iterate `game.player_order` | `game.rs:520`, `:117` | also `creatures_on_battlefield(pid)` game.rs:525 |
| `state.players[pid.0 as usize]` | `game.player(pid) -> &PlayerState` | `game.rs:271` | `.life` state.rs:16 |
| `state.players[..].life` | `PlayerState.life: i32` | `player/state.rs:16` | |
| `state.turn_number` | `game.turn.turn_number: u32` | `phase/mod.rs:146` | |
| `GameObject.controller` | `Card.controller: PlayerId` | `card/mod.rs:209` | |
| `obj.card_types.core_types.contains(&CoreType::Creature)` | `Card::is_creature() -> bool` | `card/mod.rs:1022` | prefer accessor; CoreType at `forge-foundation/src/card_type.rs` |
| `GameObject.tapped` | `Card.tapped: bool` | `card/mod.rs:257` | |
| `obj.power: Option<i32>` (`.unwrap_or(0)`) | `Card::power() -> i32` | `card/mod.rs:988` | **non-Option**; guard with `is_creature()` then call `power()` directly |
| `obj.toughness: Option<i32>` | `Card::toughness() -> i32` | `card/mod.rs:1000` | non-Option |
| `obj.loyalty: Option<u32>` | `Card.counter_count(&CounterType::Loyalty) -> i32` | `card/mod.rs:1505`; `card/counter_type.rs:14` | PW loyalty lives in counters |
| `obj.is_commander` | `Card.is_commander: bool` | `card/mod.rs:397` | |
| `obj.zone == Zone::Battlefield` | `Card.zone == ZoneType::Battlefield` | `card/mod.rs:212`; `forge-foundation/src/zone.rs:5` | |
| `obj.entered_battlefield_turn` + summoning-sick math | `Card.summoning_sick: bool` | `card/mod.rs:288` | **simpler**: replace `etb < turn_number` with `!card.summoning_sick` |
| `obj.has_keyword(&Keyword::X)` | `Card::has_keyword_enum(Kw) -> bool` + convenience bools | `card/mod.rs:1269,1281–1317` | see keyword table below |
| `engine::game::combat::can_block_pair(s, b, a) -> bool` | `combat::can_creature_block(game, blocker_id, attacker_id) -> bool` | `combat/mod.rs:1524` (impl `combat_util.rs:113`) | direct |
| `engine::game::combat::AttackTarget { Player(PlayerId), Planeswalker(ObjectId) }` | `combat::DefenderId { Player(PlayerId), Permanent(CardId) }` | `combat/mod.rs:24` | **no `Planeswalker` variant** — map PW → `Permanent(CardId)`; `.as_player()` mod.rs:40 |
| `engine::game::combat::creature_must_attack(s, id) -> bool` | **No single-creature bool.** Build `AttackConstraints`/requirements: `attack_requirement::compute_attack_requirements_with_defenders(...)` + `AttackRequirement::has_requirement()`; or `must_attack_ids(&reqs)` | `combat/attack_requirement.rs:28,73,138`; `combat/attack_constraints.rs:21` | covers goad + static must-attack; see Risk R3 |
| `engine::game::commander::commander_lethal_headroom(s, def, atk) -> Option<u32>` | **No equivalent — must implement.** | — | compute from fields below; see §3 helper & Risk R2 |
| `engine::game::players::opponents(s, p)` | `PlayerCollection::opponents_of(game, p)` | `player/player_collection.rs:36` | returns collection; `.iter()`/collect to `Vec<PlayerId>` |
| `engine::game::players::next_player(s, p)` | `GameState::next_player(&self, p) -> PlayerId` | `game.rs:470` | |
| `StaticMode::CantBeBlocked` + `functioning_abilities::active_static_definitions(s, obj)` | **No context-free "absolutely unblockable" predicate.** Substitute `combat_util::can_be_blocked(game, atk, &blocker_set) == false` | `combat/combat_util.rs:470` | context-dependent; Risk R1 |
| `crate::config::AiProfile` (`stabilize_bias`, `risk_tolerance`) | phase-ai sibling — port `config.rs` | — | dep, §4 |
| `crate::eval::{evaluate_creature, threat_level}` | phase-ai sibling — port `eval.rs` | — | dep, §4 |
| `crate::projection::{project_to, Projection, ProjectionHorizon}` | phase-ai sibling — port `projection.rs` | — | dep, §4 / Risk R4 |
| `crate::damage_reflection::has_damage_reflection_to_controller` | phase-ai sibling — port `damage_reflection.rs` | — | dep, §4 |

### Keyword mapping (`engine::types::keywords::Keyword` → manabrew)
All via `Card::has_keyword_enum(Kw)` (card/mod.rs:1269) or the convenience bools
(card/mod.rs:1281–1317). Confirm each variant name exists in manabrew's `Kw` enum:
`Lifelink`→`has_lifelink`(:1309), `Deathtouch`→`has_deathtouch`(:1305),
`FirstStrike`→`has_first_strike`(:1293), `DoubleStrike`→`has_double_strike`(:1297),
`Trample`→`has_trample`(:1301), `Vigilance`→`has_vigilance`(:1313),
`Defender`→`has_defender`(:1317), `Haste`→`has_haste`(:1281),
`Menace`→ **no convenience bool**, use `has_keyword_enum(Kw::Menace)` (verify `Kw::Menace`
exists; otherwise `has_keyword("Menace")` mod.rs:1261).

### NO-equivalent flags (summary)
- **`commander_lethal_headroom`** — does not exist; implement from `PlayerState`
  (`commander_damage_received` state.rs:50, `commander_damage_enabled` state.rs:53),
  `Card.is_commander` (mod.rs:397), and the **21** threshold (confirmed `action.rs:975`,
  `player/service.rs:933`). **R2.**
- **`StaticMode::CantBeBlocked` static query** — no context-free predicate. **R1.**
- **`creature_must_attack` single-card bool** — only the requirement-set API exists. **R3.**
- **`AttackTarget::Planeswalker`** — manabrew folds PW into `DefenderId::Permanent`. The
  redirect logic must filter `DefenderId::Permanent(cid)` where
  `game.card(cid).type_line.is_planeswalker()` (card_type.rs:238) and read loyalty from
  counters. **R5.**

---

## 3. Faithful-port plan — Rust skeleton

Module layout: one file `forge-ai/src/combat_ai.rs` mirroring the source. Engine-agnostic
control flow and **all weights/formulas are carried verbatim**; only the object-access layer
changes (Option-power → `is_creature()`+`power()`, global battlefield → per-player zone scan,
`state.objects.get` → `game.card`).

```rust
use std::collections::HashMap;

use forge_engine::combat::{can_creature_block, DefenderId};
use forge_engine::ids::{CardId, PlayerId};
use forge_engine::game::GameState;
use forge_engine::card::CounterType;
use forge_foundation::{CoreType, ZoneType};
use forge_engine::card::Card;

use crate::config::AiProfile;
use crate::damage_reflection::has_damage_reflection_to_controller;
use crate::eval::{evaluate_creature, threat_level};
use crate::projection::{project_to, Projection, ProjectionHorizon};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CombatObjective { PushLethal, Stabilize, PreserveAdvantage, Race }

const MULTIPLAYER_FOCUS_THREAT_MARGIN: f64 = 0.18;   // verbatim (src:497)
const COMMANDER_DAMAGE_THRESHOLD: i32 = 21;          // action.rs:975 / service.rs:933

// ---- helper substitutes for manabrew (replace phase free fns) -------------

/// Iterate every battlefield card across all seats (replaces global state.battlefield).
fn battlefield_ids(game: &GameState) -> Vec<CardId> {
    game.player_order.iter()
        .flat_map(|&pid| game.cards_in_zone(ZoneType::Battlefield, pid).iter().copied())
        .collect()
}

fn opponents(game: &GameState, player: PlayerId) -> Vec<PlayerId> {
    forge_engine::player::PlayerCollection::opponents_of(game, player).iter().collect()
}

/// Substitute for engine::game::commander::commander_lethal_headroom. R2.
/// Returns remaining commander-damage from THIS attacker before the 21 threshold,
/// or None when the attacker is not a damage-relevant commander.
fn commander_lethal_headroom(game: &GameState, defender: PlayerId, attacker_id: CardId)
    -> Option<u32>
{
    let atk = game.card(attacker_id);
    if !atk.is_commander { return None; }
    let p = game.player(defender);
    if !p.commander_damage_enabled { return None; }
    let dealt = p.commander_damage_received.get(&attacker_id.0).copied().unwrap_or(0);
    Some((COMMANDER_DAMAGE_THRESHOLD - dealt).max(0) as u32)
}

/// Substitute for has_cant_be_blocked. R1: context-dependent unblockable.
/// `against` is the relevant candidate-blocker set for the call site.
fn is_unblockable_against(game: &GameState, attacker: CardId, against: &[CardId]) -> bool {
    !forge_engine::combat::combat_util::can_be_blocked(game, attacker, against)
}

/// Substitute for engine::game::combat::can_block_pair (direct rename). R-none.
#[inline]
fn can_block_pair(game: &GameState, blocker: CardId, attacker: CardId) -> bool {
    can_creature_block(game, blocker, attacker)
}

// ---- public surface -------------------------------------------------------

pub fn choose_attackers_with_targets(state: &GameState, player: PlayerId)
    -> Vec<(CardId, DefenderId)>
{
    choose_attackers_with_targets_with_profile(state, player, &AiProfile::default(), false, None, None)
}

pub fn choose_attackers_with_targets_with_profile(
    state: &GameState,
    player: PlayerId,
    profile: &AiProfile,
    combat_lookahead: bool,
    valid_attacker_ids: Option<&[CardId]>,
    valid_attack_targets: Option<&[DefenderId]>,
) -> Vec<(CardId, DefenderId)> { /* port lines 45–311 verbatim w/ access-layer swaps */ }

pub fn choose_attackers(state: &GameState, player: PlayerId) -> Vec<CardId> { /* 537–542 */ }

pub fn choose_blockers(state: &GameState, player: PlayerId, attacker_ids: &[CardId])
    -> Vec<(CardId, CardId)>
{ choose_blockers_with_profile(state, player, attacker_ids, &AiProfile::default(), None) }

pub fn choose_blockers_with_profile(
    state: &GameState,
    player: PlayerId,
    attacker_ids: &[CardId],
    profile: &AiProfile,
    valid_block_targets: Option<&HashMap<CardId, Vec<CardId>>>,
) -> Vec<(CardId, CardId)> { /* port lines 555–984 verbatim w/ access-layer swaps */ }

pub fn is_lethal_attack_available(state: &GameState, ai_player: PlayerId) -> bool { /* 1464–1505 */ }

// ---- private helpers (signatures preserved 1:1) ---------------------------

fn redirect_attackers_to_planeswalker(state, attacking_ids, valid_attack_targets, objective,
    opponent, opponent_life) -> Vec<(CardId, DefenderId)>;          // 324–403, R5
fn preferred_attack_opponent(state, player, opponents, candidate_attackers) -> Option<PlayerId>; // 405
fn assign_attack_targets(state, player, opponents, attacking_ids) -> Vec<(CardId, DefenderId)>;   // 434
fn threat_ranked_opponents(state, player, opponents) -> Vec<(PlayerId, f64)>;                     // 499
fn multiplayer_pressure_target(state, player, opponents) -> Option<PlayerId>;                     // 512
fn commander_chump_unsafe(state, defender, attacker_id, chump_toughness: i32) -> bool;            // 998
fn determine_attack_objective(state, player, opponents, candidate_attackers, opponent_blockers, profile) -> CombatObjective; // 1026
fn determine_block_objective(state, player, attacker_ids, profile) -> CombatObjective;            // 1081
fn should_attack_given_objective(objective, free_damage, favorable_trade, has_lifelink,
    attacker_power: i32, attacker_survives, is_commander) -> bool;                                // 1141
fn race_clock(state, attacker: PlayerId, defender: PlayerId) -> u32;                              // 1178
fn crackback_damage(state, player, opponents, tapped_attackers, projection: Option<&Projection>) -> i32; // 1202
fn battlefield_power(state, player) -> i32;                                                       // 1308
fn sum_power(state, ids: &[CardId]) -> i32;                                                       // 1325
fn block_is_futile(state, player, attacker_ids, available_blockers) -> bool;                      // 1354
fn can_attack(state, obj_id: CardId) -> bool;                                                     // 1431
struct DefenderBlock { blocker_value: f64, kills_blocker: bool, attacker_survives: bool }         // 1538
fn defender_best_block(state, attacker_id, attacker_value: f64, blockers) -> Option<DefenderBlock>; // 1559
fn evaluate_block_outcome(blocker: &Card, attacker: &Card) -> (bool, bool);                       // 1601
```

### Engine-agnostic bodies to carry over VERBATIM (only access layer changes)

These functions are pure arithmetic on values already extracted; port the formulas exactly.

**`determine_attack_objective` (1026–1079)** — verbatim thresholds:
```rust
let my_life = game.player(player).life;
let min_opp_life = opponents.iter().map(|&o| game.player(o).life).min().unwrap_or(20);
let total_attack_power = sum_power(state, candidate_attackers);
if min_opp_life > 0 && total_attack_power >= min_opp_life && opponent_blockers.is_empty() {
    return CombatObjective::PushLethal;
}
let my_board_power = battlefield_power(state, player);
let opp_board_power: i32 = opponents.iter().map(|&o| battlefield_power(state, o)).sum();
if my_life as f64 <= opp_board_power.max(0) as f64 * profile.stabilize_bias {
    CombatObjective::Stabilize
} else if my_board_power as f64 >= opp_board_power as f64 * (1.0 - (profile.risk_tolerance * 0.2))
    && my_life >= min_opp_life {
    CombatObjective::PreserveAdvantage
} else {
    let our_clock  = opponents.iter().map(|&o| race_clock(state, o, player)).min().unwrap_or(u32::MAX);
    let their_clock = opponents.iter().map(|&o| race_clock(state, player, o)).min().unwrap_or(u32::MAX);
    if our_clock <= 2 && our_clock < their_clock { CombatObjective::Stabilize }
    else { CombatObjective::Race }
}
```

**`determine_block_objective` (1081–1139)** — verbatim:
```rust
let life = game.player(player).life;
let incoming_power = sum_power(state, attacker_ids);
if incoming_power >= life { return CombatObjective::Stabilize; }            // Path A: exact lethal
let cmd_path_lethal = attacker_ids.iter().any(|&aid| {                       // Path B: per-commander
    let Some(headroom) = commander_lethal_headroom(state, player, aid) else { return false; };
    let ap = game.card(aid).power().max(0) as u32;   // was o.power.unwrap_or(0)
    ap >= headroom
});
if cmd_path_lethal { return CombatObjective::Stabilize; }
let threshold = incoming_power as f64 * profile.stabilize_bias;
if life as f64 <= threshold * 2.5 { return CombatObjective::Stabilize; }
let my_board_power = battlefield_power(state, player);
if life as f64 <= threshold * 3.0 && incoming_power > my_board_power { return CombatObjective::Race; }
CombatObjective::PreserveAdvantage
```

**`should_attack_given_objective` (1141–1174)** — fully engine-agnostic, copy as-is:
```rust
if is_commander && !free_damage && objective != CombatObjective::PushLethal { return false; }
let lifelink_bonus = has_lifelink && attacker_power > 0
    && (free_damage || favorable_trade || attacker_survives);
match objective {
    CombatObjective::PushLethal => true,
    CombatObjective::Stabilize => free_damage || lifelink_bonus,
    CombatObjective::PreserveAdvantage => free_damage || favorable_trade || lifelink_bonus,
    CombatObjective::Race => free_damage || favorable_trade || lifelink_bonus,
}
```

**`race_clock` (1178–1189)** — verbatim ceiling division:
```rust
let defender_life = game.player(defender).life;
if defender_life <= 0 { return 0; }
let attack_power = battlefield_power(state, attacker);
if attack_power <= 0 { return u32::MAX; }
((defender_life + attack_power - 1) / attack_power) as u32
```

**`commander_chump_unsafe` (998–1024)** — verbatim, swap `power.unwrap_or(0)`→`power()`:
```rust
let headroom = commander_lethal_headroom(state, defender, attacker_id)?;  // None ⇒ return false
let atk = game.card(attacker_id);
let power = atk.power().max(0);
let trample_through = if atk.has_trample() {
    let lethal_to_blocker = if atk.has_deathtouch() { 1 } else { chump_toughness };
    (power - lethal_to_blocker).max(0)
} else { 0 };
trample_through as u32 >= headroom
```

**`evaluate_block_outcome` (1601–1665)** — fully engine-agnostic (operates on two `&Card`);
copy the first-strike/double-strike/deathtouch logic verbatim, with field reads swapped:
`blocker.power.unwrap_or(0)` → `blocker.power()`, `…toughness…` → `blocker.toughness()`,
`has_keyword(&Keyword::FirstStrike)` → `has_first_strike()`, etc. Lethal-damage rule
(`deathtouch ⇒ 1 else toughness`), `blocker_dies_before_dealing`,
`attacker_dies_before_dealing`, doubled-damage, and the final `(kills, survives)` tuple are
unchanged.

**`block_is_futile` (1354–1428)** — carry the k-chump maximization **verbatim** (the trample
estimate `1`, `chumpable_powers.sort desc`, `blocker_toughnesses.sort desc`, the
`toughness_prefix`, the `for k in 0..=max_chump` loop, `min_residual > life`). Only swap the
attacker/blocker power/toughness reads and the unblockable test (`has_cant_be_blocked` →
`is_unblockable_against(state, aid, available_blockers)`). The two `debug_assert!`s stay.

**`crackback_damage` (1202–1306)** — port the greedy 1:1 blocker-assignment loop verbatim
(`used = vec![false; ...]`, trample excess `(opp_power - blocker_toughness).max(0)`). Swaps:
global battlefield scan → `battlefield_ids`; `can_block_pair`; projection state access
(`projection.map(|p| &p.state)`) preserved once `projection.rs` is ported (R4).

**`redirect_attackers_to_planeswalker` (324–403)** — port verbatim **except** target typing
(R5): replace `AttackTarget::Planeswalker(id)` matching with
`DefenderId::Permanent(cid)` filtered by `game.card(cid).type_line.is_planeswalker()`, and
read loyalty via `game.card(cid).counter_count(&CounterType::Loyalty)` instead of
`obj.loyalty.unwrap_or(0)`. The "fewest-large-first sum ≥ loyalty, else all-at-player"
policy, the `total_power >= opponent_life` early-out, and the `redirected.len() ==
attacking_ids.len()` empty-face guard are unchanged.

**Multiplayer targeting (`preferred_attack_opponent` 405, `assign_attack_targets` 434,
`threat_ranked_opponents` 499, `multiplayer_pressure_target` 512)** — verbatim, including the
`MULTIPLAYER_FOCUS_THREAT_MARGIN = 0.18` gate and the alpha-strike "sort ascending, send
smallest first to just-kill threshold" allocation. Uses `next_player` (game.rs:470).

**`can_attack` (1431–1456)** — simplify the summoning-sickness tail:
```rust
let obj = game.card(obj_id); // ids from scan are valid; if Option needed, guard caller-side
if obj.zone != ZoneType::Battlefield { return false; }
if !obj.is_creature() { return false; }
if obj.tapped { return false; }
if obj.has_defender() { return false; }
if obj.has_haste() { return true; }
!obj.summoning_sick                 // replaces entered_battlefield_turn < turn_number
```

**Block-pass chump gates (within `choose_blockers_with_profile`)** — carry verbatim:
- `should_chump_stabilize = priority == 0 && damage_prevented >= 2 &&
  matches!(objective, Stabilize) && effective_life <= attacker_power * 3`
- `should_chump_race = priority == 0 && attacker_power >= 2 && matches!(objective, Race)`
- `effective_life = commander_lethal_headroom(...).map(|h| p_life.min(h as i32)).unwrap_or(p_life)`
- damage-reflection skip (`reflected >= p_life` ⇒ skip; `net = damage_prevented - reflected
  <= 0 && priority < 2` ⇒ skip)
- gang-block: `combined_power >= attacker_toughness && gang_set.len() >= min_blockers &&
  gang_value <= attacker_value`, `min_blockers = if has_menace { 2 } else { 1 }`
- priority formula `(survives as u8) * 2 + (kills as u8)`

---

## 4. Dependencies on other phase-ai modules

These must be ported (or stubbed) before `combat_ai.rs` compiles. They are sibling modules,
not engine code:

1. **`config::AiProfile`** — needs at least `stabilize_bias: f64` and `risk_tolerance: f64`
   (the only fields read here, lines 1051,1054,1124) plus `Default`. Difficulty presets
   referenced in tests: VeryEasy/Easy use 0.9/0.8 `stabilize_bias`.
2. **`eval::evaluate_creature(state, id) -> f64`** and **`eval::threat_level(state, player,
   opp) -> f64`** — used pervasively for value ranking and multiplayer threat. Combat AI is
   meaningless without these; port `eval.rs` first.
3. **`damage_reflection::has_damage_reflection_to_controller(card) -> bool`** — Jackal-Pup
   pattern detector (used at 683,914). Can be stubbed to `false` initially (degrades
   gracefully — just disables the reflection skip).
4. **`projection::{project_to, Projection{ state: GameState }, ProjectionHorizon::
   OpponentAttackersDeclared}`** — only used when `combat_lookahead == true` (231–241,
   crackback). Can be stubbed: pass `None` and gate `combat_lookahead=false` until ported.
   `Projection.state` must expose a `GameState` field for `crackback_damage`.

Engine-side helper this module also leans on (already in manabrew): `can_creature_block`,
`PlayerCollection::opponents_of`, `GameState::next_player`, `combat_util::can_be_blocked`,
the requirement API for must-attack.

---

## 5. Risks — adaptation vs infeasible

**R1 — `has_cant_be_blocked` (adaptation, medium).** Phase reads a context-free
`StaticMode::CantBeBlocked` static. Manabrew has no such single predicate; the faithful
substitute `!can_be_blocked(game, atk, &blocker_set)` is **context-dependent** (true if *that
particular* blocker set can't block it). At the two call sites the relevant set is available
(`opponent_blockers` for attack eval; `available_blockers` for `block_is_futile`), so behavior
matches in practice, but a creature with a true "can't be blocked" static vs an *empty* blocker
set is reported unblockable either way (fine). Edge difference: "can't be blocked except by X"
creatures are correctly NOT treated as unblockable by both (phase excludes them explicitly;
manabrew's `can_block_pair`/`can_be_blocked` already accounts for the exception). Low semantic
risk; flag for review.

**R2 — `commander_lethal_headroom` (must-implement, low).** No engine fn, but all inputs
exist: `Card.is_commander` (mod.rs:397), `PlayerState.commander_damage_received` (state.rs:50,
keyed by source `CardId.0`), `commander_damage_enabled` (state.rs:53), threshold **21**
(action.rs:975, service.rs:933). The §3 helper is a faithful reconstruction. Verify the
HashMap key convention (source commander id as `u32`) matches how damage is recorded in
`player/service.rs:638`.

**R3 — `creature_must_attack` (adaptation, medium).** Phase exposes a per-creature bool;
manabrew exposes it only through the requirement aggregate
(`attack_requirement::compute_attack_requirements_with_defenders` →
`AttackRequirement::has_requirement()` / `must_attack_ids`). Port: build the requirement set
once for the candidate list + defenders, collect `must_attack_ids` into a `HashSet`, and test
membership where phase calls `creature_must_attack(state, id)`. Covers static must-attack
(staticability/static_ability_must_attack.rs:7) and goad (attack_requirement.rs:73). Confirm
the requirement builder is callable with just `&[Card]`/candidate ids without a full
`WaitingFor`/combat context.

**R4 — `projection` lookahead (deferrable, low).** Only reached under `combat_lookahead`.
Stub `projection.rs` and always pass `None` initially; crackback then reads current state
(matches phase's documented fallback behavior). No correctness loss, only weaker Ouroboroid /
Battle-Cry foresight until ported.

**R5 — `AttackTarget::Planeswalker` (adaptation, low-medium).** Manabrew's `DefenderId` has
no `Planeswalker` variant — planeswalkers are `Permanent(CardId)`. The redirect path must (a)
filter `DefenderId::Permanent(cid)` whose `game.card(cid).type_line.is_planeswalker()`
(card_type.rs:238), and (b) read loyalty from `counter_count(&CounterType::Loyalty)`
(mod.rs:1505) rather than an `obj.loyalty` field. Note manabrew `Permanent` also covers
*battles*; exclude non-planeswalkers in the filter. Return `DefenderId::Permanent(cid)` for
redirected attackers.

**R6 — `power`/`toughness` Option→i32 (mechanical, pervasive but low).** Every
`obj.power.unwrap_or(0)` becomes `card.power()` after an `is_creature()` guard. Phase used
`Option` partly to skip non-creatures in global scans; manabrew filters by `is_creature()` in
the zone scan, so the guard is already present. Watch the few spots that read power off an
arbitrary id without a creature check (e.g. `redirect`'s `by_power` — but those ids are
attackers, already creatures).

**No infeasible parts.** The whole module is portable; it reads only board state + value
heuristics and emits declarations through manabrew's existing combat enums. The 4 phase-ai
sibling deps (§4) are the real prerequisite, and `eval` is the critical-path one.
