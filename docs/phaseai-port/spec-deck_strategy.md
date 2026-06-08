# Faithful-port spec — phase-ai deck/strategy modules → forge-ai

Covers three phase-ai source files fetched from
`github.com/phase-rs/phase/main/crates/phase-ai/src/`:

- `deck_profile.rs` — deck composition analysis + archetype classifier + eval-weight multipliers.
- `strategy_profile.rs` — per-archetype behavioral modifiers (risk/patience/stabilize/turn-phase).
- `deck_knowledge.rs` — "what's left in my library" tracker from public-zone subtraction.

Target: a new `forge-ai` crate (or module). All three are **engine-adjacent pure logic** — the only
engine coupling is the read API. Weights/formulas/thresholds below are carried over **verbatim**.

Engine paths cited relative to `forge-engine/crates/`. Phase reads a typed `engine::*` API that differs
structurally from manabrew's; the equivalence tables flag every mapping.

---

## A. `deck_profile.rs`

### A.1 What it does
Classifies a deck list into one of five `DeckArchetype` (Aggro / Midrange / Control / Combo / Ramp) and
exposes composition ratios. Pipeline:
1. `DeckProfile::analyze(deck)` walks deck entries, skips lands, accumulates count-weighted totals:
   non-land count, total mana value, creatures, removal, draw, ramp.
2. Divides by non-land count → `avg_mana_value`, `creature_ratio`, `removal_ratio`, `draw_ratio`,
   `ramp_ratio`.
3. `classify(...)` scores each archetype from those five ratios and returns `Pure` or `Hybrid`
   (hybrid when top-two scores are within 20%).
4. `adjust_weights*` scales a base `EvalWeights` by a per-archetype 9-element multiplier array.

Card-effect detection is **typed, not string-matched**: phase matches on a parsed `Effect` enum carried by
each `AbilityDefinition` on the `CardFace`. (This is the part that needs the most adaptation — see Risks.)

### A.2 Phase types/APIs read → manabrew equivalent

| Phase symbol | Role | manabrew equivalent | Cite | Status |
|---|---|---|---|---|
| `engine::game::DeckEntry { card: CardFace, count: u32 }` | deck list element | **No structural match.** Wire deck is `Deck { cards: Vec<DeckCard>, … }`; `DeckCard` has no count field (one entry per copy). Card definitions come from `CardRules` via the DB. | `forge-agent-interface/src/deck_dto.rs:60,83`; `forge-carddb/src/card_rules.rs:10` | ADAPT |
| `CardFace.card_type.core_types: contains(CoreType::Land/Creature)` | type test | `CardTypeLine.core_types: BTreeSet<CoreType>`; helpers `is_land()`, `is_creature()` | `forge-foundation/src/card_type.rs:153,214,218`; `CoreType` enum `:6` (has `Land`, `Creature`) | OK |
| `CardFace.mana_cost.mana_value() -> u32` | mana value | `ManaCost::cmc(&self) -> i32` (also `CardRules::cmc()`) | `forge-foundation/src/mana.rs:505`; `forge-carddb/src/card_rules.rs:62` | OK (cast i32→u32, clamp <0 to 0) |
| `CardFace.abilities: Vec<AbilityDefinition>` each w/ `.effect: Effect` | typed effect list | **No typed effect on the static card.** `CardFace.abilities: Vec<String>` are **raw unparsed** script lines; the verb is the first token (`SP$/AB$/DB$ <Verb>`). Parse to `ApiType`. | `forge-carddb/src/card_face.rs:31`; verb→ApiType `forge-engine/src/ability/api_type.rs:225` (`smart_value_of`); script parse `forge-card-script/src/lib.rs:381` (`abilities()`), `ScriptAbility.api_raw` `:218` | ADAPT |
| `Effect::Destroy / DealDamage / DestroyAll` (removal) | classifier | `ApiType::Destroy`, `ApiType::DealDamage`, `ApiType::DestroyAll` | api-ir.md §1; `ability/api_type.rs:11` | OK (1:1 verb names) |
| `Effect::Draw / Scry / Surveil` (draw) | classifier | `ApiType::Draw`, `ApiType::Scry`, `ApiType::Surveil` | same | OK |
| `Effect::Mana` (ramp) | classifier | `ApiType::Mana` (optionally also treat `is_mana_ability`) | same; mana detection api-ir.md §5 | OK |
| `crate::eval::EvalWeights { life, aggression, board_presence, board_power, board_toughness, hand_size, zone_quality, card_advantage, synergy }` | weight bag | **phase-ai sibling, not engine** — must be ported first (see Deps). | phase-ai `eval.rs` | DEP |

### A.3 Faithful-port skeleton (verbatim weights/formulas)

```rust
use serde::{Deserialize, Serialize};
use forge_foundation::CoreType;                      // forge-foundation/src/card_type.rs:6
use forge_carddb::{CardDatabase, CardRules, CardFace};
use crate::eval::EvalWeights;                        // ported sibling

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DeckArchetype {
    Aggro,
    #[default]
    Midrange,
    Control,
    Combo,
    Ramp,
}

#[derive(Debug, Clone)]
pub enum ArchetypeClassification {
    Pure(DeckArchetype),
    Hybrid { primary: DeckArchetype, primary_weight: f64, secondary: DeckArchetype },
}

#[derive(Debug, Clone)]
pub struct DeckProfile {
    pub classification: ArchetypeClassification,
    pub archetype: DeckArchetype,
    pub avg_mana_value: f64,
    pub creature_ratio: f64,
    pub removal_ratio: f64,
    pub draw_ratio: f64,
    pub ramp_ratio: f64,
}

impl DeckProfile {
    // ADAPTED SIGNATURE: phase took &[DeckEntry]; manabrew resolves names through the DB.
    // `entries` = (card name, count) pairs from the registered/imported deck.
    pub fn analyze(entries: &[(String, u32)], db: &CardDatabase) -> Self {
        if entries.is_empty() {
            return Self::default();
        }

        let mut nonland_cards = 0u32;
        let mut total_mv = 0u32;
        let mut creatures = 0u32;
        let mut removal = 0u32;
        let mut draw = 0u32;
        let mut ramp = 0u32;

        for (name, count) in entries {
            let count = *count;
            let Some(rules) = db.get_by_card_name(name) else { continue }; // database.rs:96
            let face = &rules.main_part;                                    // card_rules.rs:12

            if face.type_line.is_land() {                                   // card_type.rs:218
                continue;
            }

            nonland_cards += count;
            total_mv += (rules.cmc().max(0) as u32) * count;                // card_rules.rs:62

            if face.type_line.is_creature() {                              // card_type.rs:214
                creatures += count;
            }

            // VERBATIM control flow: one `break` per category — a card counts once per category.
            if face_has_effect(face, is_removal_verb) { removal += count; }
            if face_has_effect(face, is_draw_verb)    { draw += count; }
            if face_has_effect(face, is_ramp_verb)    { ramp += count; }
        }

        let nonland = nonland_cards.max(1) as f64;
        let avg_mana_value = total_mv as f64 / nonland;
        let creature_ratio = creatures as f64 / nonland;
        let removal_ratio  = removal as f64 / nonland;
        let draw_ratio     = draw as f64 / nonland;
        let ramp_ratio     = ramp as f64 / nonland;

        let classification = classify(avg_mana_value, creature_ratio, removal_ratio, draw_ratio, ramp_ratio);
        let archetype = match &classification {
            ArchetypeClassification::Pure(a) => *a,
            ArchetypeClassification::Hybrid { primary, .. } => *primary,
        };
        Self { classification, archetype, avg_mana_value, creature_ratio, removal_ratio, draw_ratio, ramp_ratio }
    }

    pub fn adjust_weights(&self, base: &EvalWeights) -> EvalWeights {
        self.adjust_weights_with(&ArchetypeMultipliers::default(), base)
    }

    pub fn adjust_weights_with(&self, multipliers: &ArchetypeMultipliers, base: &EvalWeights) -> EvalWeights {
        let m = multipliers.for_archetype(self.archetype);
        EvalWeights {
            life:            base.life * m[0],
            aggression:      base.aggression * m[1],
            board_presence:  base.board_presence * m[2],
            board_power:     base.board_power * m[3],
            board_toughness: base.board_toughness * m[4],
            hand_size:       base.hand_size * m[5],
            zone_quality:    base.zone_quality * m[6],
            card_advantage:  base.card_advantage * m[7],
            synergy:         base.synergy * m[8],
        }
    }
}

impl Default for DeckProfile {
    fn default() -> Self {
        Self {
            classification: ArchetypeClassification::Pure(DeckArchetype::Midrange),
            archetype: DeckArchetype::Midrange,
            avg_mana_value: 0.0, creature_ratio: 0.0, removal_ratio: 0.0,
            draw_ratio: 0.0, ramp_ratio: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchetypeMultipliers {
    pub aggro:    [f64; 9],
    pub midrange: [f64; 9],
    pub control:  [f64; 9],
    pub combo:    [f64; 9],
    pub ramp:     [f64; 9],
}

impl Default for ArchetypeMultipliers {
    fn default() -> Self {
        // VERBATIM: order = [life, aggression, presence, power, toughness, hand, zone_quality, card_adv, synergy]
        Self {
            aggro:    [0.6, 2.0, 1.5, 2.0, 0.5, 0.3, 0.15, 0.1, 0.3],
            midrange: [1.0, 1.0, 1.5, 1.2, 1.2, 0.8, 0.3,  0.4, 0.5],
            control:  [1.5, 0.3, 0.8, 0.5, 0.8, 2.0, 0.6,  0.8, 0.4],
            combo:    [0.8, 0.5, 0.5, 0.5, 0.5, 2.5, 0.5,  0.6, 0.7],
            ramp:     [1.0, 0.7, 1.0, 1.0, 1.0, 1.0, 0.4,  0.3, 0.4],
        }
    }
}

impl ArchetypeMultipliers {
    pub fn for_archetype(&self, archetype: DeckArchetype) -> &[f64; 9] {
        match archetype {
            DeckArchetype::Aggro    => &self.aggro,
            DeckArchetype::Midrange => &self.midrange,
            DeckArchetype::Control  => &self.control,
            DeckArchetype::Combo    => &self.combo,
            DeckArchetype::Ramp     => &self.ramp,
        }
    }
}

// VERBATIM scoring formulas + 20% hybrid threshold.
fn classify(avg_mv: f64, creature_ratio: f64, removal_ratio: f64, draw_ratio: f64, ramp_ratio: f64)
    -> ArchetypeClassification
{
    let aggro_score   = (3.5 - avg_mv).max(0.0) + creature_ratio * 2.0 - removal_ratio;
    let control_score = (avg_mv - 2.5).max(0.0) + removal_ratio * 2.0 + draw_ratio * 1.5 - creature_ratio;
    let ramp_score    = ramp_ratio * 3.0 + (avg_mv - 3.0).max(0.0) * 0.5;
    let combo_score   = (1.0 - creature_ratio) * 1.5 + draw_ratio * 1.0 - removal_ratio * 0.5;
    let midrange_score = 1.0;

    let mut scores = [
        (aggro_score, DeckArchetype::Aggro),
        (control_score, DeckArchetype::Control),
        (ramp_score, DeckArchetype::Ramp),
        (combo_score, DeckArchetype::Combo),
        (midrange_score, DeckArchetype::Midrange),
    ];
    scores.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let (best_score, best_arch) = scores[0];
    let (second_score, second_arch) = scores[1];

    if best_score > 0.0 && (best_score - second_score) / best_score < 0.2 {
        let total = best_score + second_score;
        ArchetypeClassification::Hybrid {
            primary: best_arch,
            primary_weight: best_score / total,
            secondary: second_arch,
        }
    } else {
        ArchetypeClassification::Pure(best_arch)
    }
}

// ADAPTED: phase matched a typed Effect enum; here we read the raw ability verb → ApiType.
fn face_has_effect(face: &CardFace, pred: impl Fn(ApiType) -> bool) -> bool {
    use forge_card_script::ParsedCardScript;
    // Scan the printed spell/activated ability lines. (Optionally also `face.triggers`
    // for ETB-draw/ETB-ramp parity — see Risks A.5.)
    face.abilities.iter().any(|line| {
        ParsedCardScript::ability_verb(line)                 // first SP$/AB$/DB$ token
            .and_then(ApiType::smart_value_of)               // api_type.rs:225
            .is_some_and(&pred)
    })
}

// VERBATIM category membership (verb-name 1:1 with phase Effect variants).
fn is_removal_verb(api: ApiType) -> bool {
    matches!(api, ApiType::Destroy | ApiType::DealDamage | ApiType::DestroyAll)
}
fn is_draw_verb(api: ApiType) -> bool {
    matches!(api, ApiType::Draw | ApiType::Scry | ApiType::Surveil)
}
fn is_ramp_verb(api: ApiType) -> bool {
    matches!(api, ApiType::Mana)
}
```

`ParsedCardScript::ability_verb` is a tiny helper the implementer adds: take the line, split on `$`/
whitespace, return the verb token after `SP$`/`AB$`/`DB$`. `forge-card-script` already exposes
`ParsedCardScript::parse(raw).abilities()` returning `ScriptAbility { api_raw: Option<&str>, … }`
(`lib.rs:350,381,218`) — prefer `api_raw` over hand-splitting.

### A.4 Dependencies on other phase-ai modules
- `crate::eval::EvalWeights` (9 named f64 fields used in `adjust_weights_with`). **Must be ported before
  this module compiles.** Field names/order are load-bearing (multiplier index 0..8 maps to them in order).
- Consumed-by (downstream): `strategy_profile.rs` (`for_profile` reads `DeckProfile.classification`).

### A.5 Risks
- **Typed-effect → verb-string (main adaptation, feasible).** Phase keys on a fully-typed `Effect` enum
  attached at card-load. manabrew keeps abilities as **raw strings** on the static `CardFace`
  (`card_face.rs:31`) and only lowers them to IR/`ApiType` when a card enters a game. The faithful move is
  to parse the verb token via `forge-card-script` (no engine/game needed). Verb names line up 1:1, so the
  category sets stay verbatim.
- **Trigger/static coverage divergence.** Phase's per-ability `Effect` list likely folds triggered/ETB
  effects into `card.abilities`. manabrew splits them: `abilities` (spell/activated), `triggers`,
  `static_abilities` (`card_face.rs:31-34`). For parity on cards whose draw/ramp/removal is a trigger
  (e.g. ETB "draw a card"), also scan `face.triggers` lines. Decide once and document; default to scanning
  `abilities` + `triggers` for removal/draw/ramp.
- **`DeckEntry` shape.** No engine count-bearing deck element. Either pre-aggregate the imported `Deck`
  (`deck_dto.rs:83`) into `(name, count)` pairs, or pass `RegisteredPlayer.original_deck: Vec<String>`
  (`player/registered_player.rs:23`) and count duplicates. Signature adapted accordingly; logic unchanged.
- **Split/DFC cards.** Scan `rules.main_part`; for `other_part`/combine layouts (`card_rules.rs:13`) decide
  whether to union both faces' verbs. Phase has a single `CardFace` per entry, so unioning both faces is the
  closest parity. Low impact on ratios.
- Not infeasible anywhere — fully portable.

---

## B. `strategy_profile.rs`

### B.1 What it does
Pure value object. Maps a `DeckArchetype` (or a classified `DeckProfile`, blending hybrids) to five behavioral
multipliers, plus a turn-phase scalar. **Zero engine coupling** — depends only on `DeckArchetype`,
`DeckProfile`/`ArchetypeClassification` (module A), and (tests only) `AiProfile`. Ports verbatim.

### B.2 Phase types/APIs read → manabrew equivalent
| Phase symbol | manabrew equivalent | Status |
|---|---|---|
| `crate::deck_profile::DeckArchetype` | module A above | OK (sibling) |
| `crate::deck_profile::DeckProfile` / `ArchetypeClassification::{Pure,Hybrid}` | module A | OK (sibling) |
| `crate::config::AiProfile` + `AiProfile::with_strategy` (tests) | phase-ai `config.rs` | DEP (sibling, port later; only tests reference it) |
| **(no engine types at all)** | — | — |

### B.3 Faithful-port skeleton (verbatim)
```rust
use crate::deck_profile::{ArchetypeClassification, DeckArchetype, DeckProfile};

#[derive(Debug, Clone)]
pub struct StrategyProfile {
    pub risk_tolerance_mult: f64,
    pub interaction_patience_mult: f64,
    pub stabilize_bias_mult: f64,
    pub early_game_mult: f64,
    pub late_game_mult: f64,
}

impl StrategyProfile {
    pub fn for_archetype(archetype: DeckArchetype) -> Self {
        match archetype {
            DeckArchetype::Aggro => Self {
                risk_tolerance_mult: 1.3, interaction_patience_mult: 0.5,
                stabilize_bias_mult: 0.7, early_game_mult: 1.3, late_game_mult: 0.7,
            },
            DeckArchetype::Control => Self {
                risk_tolerance_mult: 0.7, interaction_patience_mult: 1.5,
                stabilize_bias_mult: 1.3, early_game_mult: 0.8, late_game_mult: 1.3,
            },
            DeckArchetype::Midrange => Self {
                risk_tolerance_mult: 1.0, interaction_patience_mult: 1.0,
                stabilize_bias_mult: 1.0, early_game_mult: 1.0, late_game_mult: 1.0,
            },
            DeckArchetype::Ramp => Self {
                risk_tolerance_mult: 0.8, interaction_patience_mult: 1.2,
                stabilize_bias_mult: 1.1, early_game_mult: 1.2, late_game_mult: 0.9,
            },
            DeckArchetype::Combo => Self {
                risk_tolerance_mult: 0.9, interaction_patience_mult: 1.3,
                stabilize_bias_mult: 1.0, early_game_mult: 1.0, late_game_mult: 1.0,
            },
        }
    }

    pub fn for_profile(profile: &DeckProfile) -> Self {
        match &profile.classification {
            ArchetypeClassification::Pure(arch) => Self::for_archetype(*arch),
            ArchetypeClassification::Hybrid { primary, primary_weight, secondary } => {
                let p = Self::for_archetype(*primary);
                let s = Self::for_archetype(*secondary);
                p.blend(&s, *primary_weight)
            }
        }
    }

    // VERBATIM breakpoints: 0..=3 early, 4..=7 neutral 1.0, 8+ late.
    pub fn turn_phase_mult(&self, turn: u32) -> f64 {
        match turn {
            0..=3 => self.early_game_mult,
            4..=7 => 1.0,
            _ => self.late_game_mult,
        }
    }

    pub fn blend(&self, other: &Self, self_weight: f64) -> Self {
        let w = self_weight;
        let o = 1.0 - w;
        Self {
            risk_tolerance_mult:       self.risk_tolerance_mult * w + other.risk_tolerance_mult * o,
            interaction_patience_mult: self.interaction_patience_mult * w + other.interaction_patience_mult * o,
            stabilize_bias_mult:       self.stabilize_bias_mult * w + other.stabilize_bias_mult * o,
            early_game_mult:           self.early_game_mult * w + other.early_game_mult * o,
            late_game_mult:            self.late_game_mult * w + other.late_game_mult * o,
        }
    }
}

impl Default for StrategyProfile {
    fn default() -> Self {
        Self {
            risk_tolerance_mult: 1.0, interaction_patience_mult: 1.0,
            stabilize_bias_mult: 1.0, early_game_mult: 1.0, late_game_mult: 1.0,
        }
    }
}
```

### B.4 Dependencies
- Module A (`DeckArchetype`, `DeckProfile`, `ArchetypeClassification`).
- `AiProfile` (phase-ai `config.rs`) — **only referenced by tests** (`with_strategy`, field clamping ranges
  risk 0.2..=1.0, patience 0.1..=1.0, stabilize 0.5..=2.0). Port tests after `config.rs` lands; production
  code is independent.

### B.5 Risks
None engine-side. Trivial, deterministic, fully portable. Only sequencing risk: needs module A's enums.

---

## C. `deck_knowledge.rs`

### C.1 What it does
Computes the AI's **honest** knowledge of cards still in its library — without peeking the hidden library
zone. Method = (original main-deck counts) minus (every accounted-for, non-token object the player owns that
has left the library: hand, graveyard, owned battlefield, owned exile, and **spell** stack entries). Returns
surviving counts (>0) keyed by `DeckCardKey` (printed oracle_id+face_name, else bare face name), and a
`RemainingDeckView` echoing the still-present deck entries. Used for draw-probability / topdeck reasoning.

Note: this is deliberately *not* `cards_in_zone(Library)` — that would be cheating. It reconstructs the
library contents from public information + the bot's own decklist.

### C.2 Phase types/APIs read → manabrew equivalent
| Phase symbol | Role | manabrew equivalent | Cite | Status |
|---|---|---|---|---|
| `state.deck_pools: Vec<PlayerDeckPool>`, `pool.current_main: Arc<Vec<DeckEntry>>` | original decklist retained in game state | **No GameState field.** Decklist lives only in setup `RegisteredPlayer.original_deck: Vec<String>` (names) — not stored on `GameState`. AI must carry it. | `forge-engine/src/player/registered_player.rs:23`; GameState has no equivalent (`game.rs:92`) | ADAPT / NO ENGINE EQUIV |
| `state.objects: HashMap<ObjectId, Object>` | object arena | `GameState.cards: Vec<Card>` indexed by `CardId.index()`; `game.card(id)` | `game.rs:94,263`; ids.rs:5 | OK (Vec vs map) |
| `object.is_token: bool` | skip tokens | `Card.is_token: bool` | `card/mod.rs:405` | OK |
| `object.owner: PlayerId` | ownership filter | `Card.owner: PlayerId` | `card/mod.rs:208` | OK |
| `object.printed_ref: Option<PrintedCardRef{oracle_id,face_name}>` | dedup key | **No oracle_id on Card.** Closest: `Card.card_name`/`full_name` (+ optional `set_code`). Key degrades to `FaceName`. | `card/mod.rs:201,205,505` | ADAPT (lossy key) |
| `player_state.hand` / `.graveyard` (`Vec<ObjectId>`) | accounted zones | `game.cards_in_zone(ZoneType::Hand/Graveyard, pid) -> &[CardId]` | api-state.md; `game.rs:520` | OK |
| `state.battlefield` filtered by owner | accounted zone | `game.cards_in_zone(ZoneType::Battlefield, pid)` (already per-controller; re-check `owner`) | `game.rs:520` | OK |
| `state.exile` filtered by owner | accounted zone | `game.cards_in_zone(ZoneType::Exile, pid)` | `game.rs:520` | OK |
| `state.stack` → only `StackEntryKind::Spell` contributes `source_id` | count spells in flight | `game.cards_in_zone(ZoneType::Stack, pid)` — spell cards are real `Card`s in the Stack zone; abilities are not cards, so they're naturally excluded | `game.rs:520`; `ZoneType::Stack` `forge-foundation/src/zone.rs:5` | OK (cleaner than phase) |
| `engine::game::printed_ref_from_face` | deck-entry key builder | none; build key from `CardRules.main_part.name` (+ `set_code` if used) | — | ADAPT |
| `DeckEntry.card.name`, `.count` | deck entry fields | `(name, count)` pairs (see A.5) | — | ADAPT |

### C.3 Faithful-port skeleton
```rust
use std::collections::HashMap;
use forge_engine::game::GameState;          // game.rs:92 (aka Game)
use forge_engine::ids::{CardId, PlayerId};
use forge_foundation::ZoneType;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DeckCardKey {
    // oracle_id absent on manabrew Card → in practice Named is the active variant.
    Named { name: String },
}

#[derive(Debug, Clone, Default)]
pub struct RemainingDeckView {
    pub counts: HashMap<DeckCardKey, u32>,
    pub entries: Vec<(String, u32)>,
}

// ADAPTED: decklist supplied by the caller (the bot owns it); phase read it from state.deck_pools.
pub fn known_remaining_deck_counts(
    game: &GameState,
    player: PlayerId,
    original_main: &[(String, u32)],
) -> HashMap<DeckCardKey, u32> {
    let mut counts: HashMap<DeckCardKey, u32> = HashMap::new();
    for (name, count) in original_main {
        if *count == 0 { continue; }
        *counts.entry(DeckCardKey::Named { name: name.clone() }).or_insert(0) += *count;
    }

    for cid in accounted_card_ids(game, player) {
        let card = game.card(cid);                       // game.rs:263
        if card.is_token || card.owner != player {       // mod.rs:405,208
            continue;
        }
        let key = DeckCardKey::Named { name: card.card_name.clone() }; // mod.rs:201
        if let Some(c) = counts.get_mut(&key) {
            *c = c.saturating_sub(1);
        }
    }

    counts.retain(|_, c| *c > 0);
    counts
}

pub fn remaining_deck_view(
    game: &GameState,
    player: PlayerId,
    original_main: &[(String, u32)],
) -> RemainingDeckView {
    let counts = known_remaining_deck_counts(game, player, original_main);
    let entries = original_main.iter()
        .filter_map(|(name, _)| {
            let key = DeckCardKey::Named { name: name.clone() };
            let c = counts.get(&key).copied().unwrap_or(0);
            (c > 0).then(|| (name.clone(), c))
        })
        .collect();
    RemainingDeckView { counts, entries }
}

// VERBATIM zone set: hand + graveyard + owned battlefield + owned exile + spell stack entries.
fn accounted_card_ids(game: &GameState, player: PlayerId) -> Vec<CardId> {
    let mut ids = Vec::new();
    ids.extend(game.cards_in_zone(ZoneType::Hand, player).iter().copied());      // game.rs:520
    ids.extend(game.cards_in_zone(ZoneType::Graveyard, player).iter().copied());
    ids.extend(game.cards_in_zone(ZoneType::Battlefield, player).iter().copied());
    ids.extend(game.cards_in_zone(ZoneType::Exile, player).iter().copied());
    // Spells on the stack are Card objects in the Stack zone; abilities are not Cards,
    // so iterating the zone reproduces phase's `StackEntryKind::Spell`-only filter.
    ids.extend(game.cards_in_zone(ZoneType::Stack, player).iter().copied());
    ids
}
```

### C.4 Dependencies on other phase-ai modules
None. Self-contained. (Phase's version also imported only `engine::*`.)

### C.5 Risks
- **Original decklist not in GameState (main adaptation).** Phase stored `deck_pools` on the state; manabrew
  does not. The bot must thread its own decklist in (it legitimately knows its 60). Source it from
  `RegisteredPlayer.original_deck` (`registered_player.rs:23`) at agent construction. Feasible, just a
  signature change — folded into the skeleton above.
- **Key fidelity (lossy but acceptable).** Phase distinguishes copies by Scryfall `oracle_id`+`face_name`;
  manabrew `Card` has no oracle id (`card/mod.rs` exposes `card_name`/`full_name`/`set_code`). Keying by
  `card_name` collapses reprints/alt-arts of the same card — which is exactly what we want for "how many of
  this card remain", so the simplification is harmless. Drop the `Printed { oracle_id, .. }` variant; keep
  only `Named`. If exact-printing tracking is ever needed, add `set_code` to the key.
- **Owned-battlefield / owned-exile filter.** `cards_in_zone(Battlefield, player)` keys on the zone's owner
  list; the explicit `card.owner != player` guard is retained verbatim to mirror phase (covers stolen
  permanents whose controller≠owner). No behavioral gap.
- **Stack-spell filter is actually cleaner on manabrew** — no need to inspect `StackEntryKind`; the Stack
  zone holds only spell cards. Confirm during impl that copied/token spells on the stack carry `is_token`
  (they do via `set_is_token`, `mod.rs:1910`) so they're skipped like phase's token guard.
- Not infeasible anywhere — fully portable; only the decklist-source plumbing is new.

---

## D. Cross-cutting port order
1. Port phase-ai `eval.rs` (`EvalWeights`) and `config.rs` (`AiProfile`) first — A and B's tests/prod
   reference them. (Out of scope here but blocking.)
2. `deck_profile.rs` (module A) — needs `EvalWeights` + the `forge-card-script` verb helper.
3. `strategy_profile.rs` (module B) — needs A's enums only.
4. `deck_knowledge.rs` (module C) — independent; needs decklist plumbing from `RegisteredPlayer`.

## E. Forge-DSL feasibility verdict
All three modules are portable on manabrew's Forge-DSL engine. There is **no infeasible logic**. The only
real engine-shaped adaptation is module A's effect classification: phase's pre-typed `Effect` enum becomes a
parse of the raw card-script verb (`SP$/AB$/DB$ <Verb>` → `ApiType`) — a clean, well-supported path via
`forge-card-script` + `ApiType::smart_value_of`, with verb names matching phase's variants 1:1. Modules B and
C carry over essentially verbatim, modulo the decklist-source signature change in C.
