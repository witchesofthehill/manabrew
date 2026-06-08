# Faithful-port spec — phase-ai `synergy.rs` + `combo/registry.rs` → manabrew `forge-ai`

Port target crate: `forge-engine/crates/forge-ai` (already exists; `lib.rs` re-exports
`eval` + `stats`, both already adapted from phase-ai). New modules:
`forge-ai/src/synergy.rs` and `forge-ai/src/combo/registry.rs` (+ the combo deps, see §D).

Source fetched verbatim from
`https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/{synergy.rs,combo/registry.rs}`.

Conventions to mirror from the existing `forge-ai/eval.rs`:
- `use forge_engine_core::game::GameState;` `use forge_engine_core::ids::PlayerId;`
  `use forge_foundation::ZoneType;`
- Board scans iterate `for card in &game.cards { if card.zone != ZoneType::Battlefield || card.controller != pid { continue } }` (eval.rs:85-96), **not** a global `state.battlefield`.
- Top-of-file provenance comment: `// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.` (eval.rs:1).
- No doc-noise; match repo comment discipline (root AGENTS.md).

---

## PART 1 — `synergy.rs`

### 1.1 What it does (AI logic)

`SynergyGraph` is a **pre-computed, per-card deck-synergy score table**, built once per game
from the decklist and then queried during play. Two phases:

**Build (static, from decklist):** `SynergyGraph::build(deck: &[DeckEntry])` runs four
independent "axis detectors", each accumulating additive bonuses into a
`HashMap<String /*card name*/, f64>`:

| Detector | Trigger condition | Bonus added (verbatim) | Recipients |
|---|---|---|---|
| `detect_tribal` | any creature subtype with **count ≥ 3** across the deck (Changeling counts as every type) | **+0.3** | every creature sharing a tribal subtype (or Changeling) |
| `detect_sacrifice` | deck has ≥1 sac-outlet **and** ≥1 token-producer | **+0.25** | each sac outlet **and** each token producer |
| `detect_graveyard` | deck has ≥1 graveyard-filler **and** ≥1 recursion card | **+0.3** | each filler **and** each recursion card |
| `detect_spellcast` | instant/sorcery count **≥ 8** **and** ≥1 spellcast-trigger card | `density = min(spell_count/20, 1.0) * 0.4` | each spellcast-trigger card |

`card_score(name) -> f64` returns the stored score or `0.0`.

**Query (dynamic, from board):** `board_synergy_bonus(state, player) -> f64` sums the
synergy scores of the player's battlefield cards with a **sqrt diminishing-returns**
weighting:
```
let names = controller==player && zone==Battlefield card names;
if names.is_empty() { return 0.0 }
let partner_factor = (names.len() as f64).sqrt();
names.map(card_score).sum::<f64>() * partner_factor / names.len() as f64
```
(So a single card scores `score*1/1 = score`; N copies of the same scored card score
`N*score*sqrt(N)/N = score*sqrt(N)` — partner count amplifies, sub-linearly.)

`empty()` / `Default` → all-zero graph.

### 1.2 Phase types/APIs read → manabrew equivalents

`DeckEntry`/`CardFace` in phase are **strongly-typed** card definitions
(`ability.cost: Option<AbilityCost>`, `*ability.effect: Effect`, `keywords: Vec<Keyword>`,
`trigger.mode: TriggerMode`). manabrew's static card model
(`forge-carddb::CardFace`, card_face.rs:11) stores **raw unparsed card-script strings**
(`abilities: Vec<String>`, `keywords: Vec<String>`, `triggers: Vec<String>`,
`static_abilities: Vec<String>` — card_face.rs:30-34). This is the dominant adaptation:
every typed-`match` detector becomes a **raw-string / param classifier**.

| phase symbol | role | manabrew equivalent | cite |
|---|---|---|---|
| `engine::game::DeckEntry { card: CardFace, count: u32 }` | quantity-aggregated decklist entry | **NO direct equivalent.** Build it: aggregate `forge_agent_interface::deck_dto::Deck.cards: Vec<DeckCard>` (a *flat* per-copy list) by `identity.name`, resolve each name via `CardDatabase::get_by_card_name` → `&CardRules`, take `.main_part` as the `CardFace`; `count` = #copies | deck_dto.rs:83/`DeckCard` identity.name (deck_dto.rs:11-19); database.rs:96; card_rules.rs:12 |
| `engine::types::card::CardFace` | static card face | `forge_carddb::CardFace` | card_face.rs:11 |
| `CardFace.name` | `String` | `CardFace.name` | card_face.rs:12 |
| `card.card_type.core_types: Vec<CoreType>` + `.contains(&CoreType::Creature)` | type test | `CardFace.type_line.core_types: BTreeSet<CoreType>`; use `type_line.is_creature()` / `.contains(&CoreType::Creature)` | card_type.rs:153, CoreType card_type.rs:6 (`Creature`=11, `Instant`=14, `Sorcery`=20) |
| `card.card_type.subtypes: Vec<String>` | tribal subtypes | `CardFace.type_line.subtypes: Vec<String>` | card_type.rs:154 |
| `CoreType::Instant`/`Sorcery` | spell density | same enum variants | card_type.rs:14,20 |
| `card.keywords: Vec<Keyword>` + `Keyword::Changeling` | changeling test | `CardFace.keywords: Vec<String>`; test `keywords.iter().any(|k| k=="Changeling")` (engine uses `has_keyword("Changeling")` mod.rs:3227, valid_filter.rs:618) | card_face.rs:30 |
| `Keyword::Flashback(..)` / `Escape{..}` / `Unearth(..)` | recursion | raw keyword strings carrying costs: `"Flashback:2 R"`, `"Escape:1 B B:4"`, `"Unearth:..."` — test `k.starts_with("Flashback")\|\|k.starts_with("Escape")\|\|k.starts_with("Unearth")` | card_util.rs:29/49, alt_costs.rs:86/152, card_factory_util.rs:261 |
| `ability.cost == AbilityCost::Sacrifice{..}` | sac outlet | **NO typed cost at deck-build.** Scan each raw ability string's `Cost$` param for a `Sac` clause: `ParsedParams::parse(ab).get("Cost").is_some_and(\|c\| c.contains("Sac"))`. (Runtime typed form is `CostPart::Sacrifice` cost/mod.rs:234, but it is not built until the card enters play.) | ParsedParams::parse/`get` lib.rs:485/575; cost/mod.rs:234 |
| `*ability.effect == Effect::Token{..}` | token producer | **NO typed effect at deck-build.** The verb is the first token of an `SP$/AB$/DB$` line; resolve via `ApiType::smart_value_of(verb) == Some(ApiType::Token)`. Scan all `abilities` (and triggers' `Execute`/inline verbs) | ApiType::Token api_type.rs:200, smart_value_of api_type.rs:225 |
| `Effect::Mill\|DiscardCard\|Surveil` | graveyard filler | ApiType `Mill` (api_type.rs:130), `Discard` (api_type.rs:82 — phase `DiscardCard`→manabrew `Discard`), `Surveil` (api_type.rs:192); scan abilities+triggers | api_type.rs:82/130/192 |
| `trigger.mode == TriggerMode::SpellCast\|SpellCastOrCopy` | spellcast trigger | raw trigger string param `Mode$ SpellCast`; test `triggers.iter().any(\|t\| t.contains("Mode$ SpellCast"))` (engine `TriggerType::SpellCast`/`SpellCastOrCopy` trigger_handler.rs:885-887) | card_face.rs:33; trigger_type.rs:15 |
| `engine::types::game_state::GameState` | board read | `forge_engine_core::game::GameState` | game.rs:92 |
| `engine::types::player::PlayerId` | player id | `forge_engine_core::ids::PlayerId` | ids.rs:9 |
| `state.battlefield` + `state.objects.get(id)` + `obj.controller`/`obj.zone`/`obj.name` | battlefield name scan | iterate `game.cards`, filter `card.zone==ZoneType::Battlefield && card.controller==player`, read `card.card_name` (mirror eval.rs:85-96). `Zone::Battlefield`→`ZoneType::Battlefield` | game.rs:94, card mod.rs:201/209/212; zone.rs ZoneType |
| `engine::types::zones::Zone::Battlefield` | zone enum | `forge_foundation::ZoneType::Battlefield` | zone.rs:5 |

No symbol is **infeasible** — but the four card-property predicates have **no faithful
1-to-1 API** and must be re-expressed as raw-script classifiers (adaptation, not blocker).

### 1.3 Faithful-port plan — skeleton (weights/thresholds verbatim)

```rust
// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use std::collections::HashMap;

use forge_carddb::CardFace;
use forge_engine_core::game::GameState;
use forge_engine_core::ids::PlayerId;
use forge_foundation::{CoreType, ZoneType};

// manabrew DeckEntry analogue (phase has it in `engine`; we build it from the deck DTO).
pub struct DeckEntry {
    pub card: CardFace,
    pub count: u32,
}

#[derive(Debug, Clone)]
pub struct SynergyGraph {
    scores: HashMap<String, f64>,
}

impl SynergyGraph {
    pub fn build(deck: &[DeckEntry]) -> Self {
        if deck.is_empty() {
            return Self::empty();
        }
        let mut scores: HashMap<String, f64> = HashMap::new();
        detect_tribal(deck, &mut scores);
        detect_sacrifice(deck, &mut scores);
        detect_graveyard(deck, &mut scores);
        detect_spellcast(deck, &mut scores);
        Self { scores }
    }

    pub fn empty() -> Self { Self { scores: HashMap::new() } }

    pub fn card_score(&self, name: &str) -> f64 {
        self.scores.get(name).copied().unwrap_or(0.0)
    }

    // Board query: iterate game.cards (mirror eval.rs board scan), not a global battlefield.
    pub fn board_synergy_bonus(&self, game: &GameState, player: PlayerId) -> f64 {
        let battlefield_names: Vec<&str> = game
            .cards
            .iter()
            .filter(|c| c.zone == ZoneType::Battlefield && c.controller == player)
            .map(|c| c.card_name.as_str())
            .collect();
        if battlefield_names.is_empty() {
            return 0.0;
        }
        let partner_factor = (battlefield_names.len() as f64).sqrt();   // VERBATIM
        battlefield_names
            .iter()
            .map(|&name| self.scores.get(name).copied().unwrap_or(0.0))
            .sum::<f64>()
            * partner_factor
            / battlefield_names.len() as f64                            // VERBATIM
    }
}

impl Default for SynergyGraph {
    fn default() -> Self { Self::empty() }
}

// ─── Axis detection (numeric logic VERBATIM; predicates adapted) ───────────────

fn detect_tribal(deck: &[DeckEntry], scores: &mut HashMap<String, f64>) {
    let mut type_counts: HashMap<&str, u32> = HashMap::new();
    let mut card_types: HashMap<&str, Vec<&str>> = HashMap::new();
    for entry in deck {
        if !entry.card.type_line.core_types.contains(&CoreType::Creature) {
            continue;
        }
        let is_changeling = entry.card.keywords.iter().any(|k| k == "Changeling");
        for subtype in &entry.card.type_line.subtypes {
            *type_counts.entry(subtype.as_str()).or_insert(0) += entry.count;
            card_types.entry(entry.card.name.as_str()).or_default().push(subtype.as_str());
        }
        if is_changeling {
            card_types.entry(entry.card.name.as_str()).or_default().push("__changeling__");
        }
    }
    let tribal_types: Vec<&str> = type_counts
        .iter()
        .filter(|(_, &count)| count >= 3)            // VERBATIM threshold
        .map(|(&t, _)| t)
        .collect();
    if tribal_types.is_empty() { return; }
    for entry in deck {
        let name = entry.card.name.as_str();
        let card_subtypes = card_types.get(name);
        let has_tribal = card_subtypes.is_some_and(|types| {
            types.contains(&"__changeling__") || types.iter().any(|t| tribal_types.contains(t))
        });
        if has_tribal {
            *scores.entry(name.to_string()).or_insert(0.0) += 0.3;     // VERBATIM
        }
    }
}

fn detect_sacrifice(deck: &[DeckEntry], scores: &mut HashMap<String, f64>) {
    let mut sac_outlets = Vec::new();
    let mut token_producers = Vec::new();
    for entry in deck {
        if has_sacrifice_cost(&entry.card) { sac_outlets.push(entry.card.name.as_str()); }
        if produces_tokens(&entry.card)    { token_producers.push(entry.card.name.as_str()); }
    }
    if sac_outlets.is_empty() || token_producers.is_empty() { return; }
    let bonus = 0.25;                                                  // VERBATIM
    for name in sac_outlets    { *scores.entry(name.to_string()).or_insert(0.0) += bonus; }
    for name in token_producers { *scores.entry(name.to_string()).or_insert(0.0) += bonus; }
}

fn detect_graveyard(deck: &[DeckEntry], scores: &mut HashMap<String, f64>) {
    let mut fillers = Vec::new();
    let mut recursion = Vec::new();
    for entry in deck {
        if fills_graveyard(&entry.card) { fillers.push(entry.card.name.as_str()); }
        if has_recursion(&entry.card)   { recursion.push(entry.card.name.as_str()); }
    }
    if fillers.is_empty() || recursion.is_empty() { return; }
    let bonus = 0.3;                                                   // VERBATIM
    for name in fillers   { *scores.entry(name.to_string()).or_insert(0.0) += bonus; }
    for name in recursion { *scores.entry(name.to_string()).or_insert(0.0) += bonus; }
}

fn detect_spellcast(deck: &[DeckEntry], scores: &mut HashMap<String, f64>) {
    let mut spell_count = 0u32;
    let mut trigger_cards = Vec::new();
    for entry in deck {
        if entry.card.type_line.core_types.contains(&CoreType::Instant)
            || entry.card.type_line.core_types.contains(&CoreType::Sorcery)
        {
            spell_count += entry.count;
        }
        if has_spellcast_trigger(&entry.card) { trigger_cards.push(entry.card.name.as_str()); }
    }
    if spell_count < 8 || trigger_cards.is_empty() { return; }         // VERBATIM threshold 8
    let density_bonus = (spell_count as f64 / 20.0).min(1.0) * 0.4;    // VERBATIM formula
    for name in trigger_cards { *scores.entry(name.to_string()).or_insert(0.0) += density_bonus; }
}

// ─── Card property detectors (ADAPTED: raw-script scanning) ────────────────────
use forge_card_script::ParsedParams;
use forge_engine_core::ability::api_type::ApiType;   // confirm exact path at impl time

fn ability_verb(line: &str) -> Option<ApiType> {
    // `SP$ DealDamage | ...` / `AB$ Mill | ...` / `DB$ Token | ...`
    let verb = line.split('|').next()?.trim()
        .rsplit('$').next()?.trim();
    ApiType::smart_value_of(verb)
}

fn has_sacrifice_cost(card: &CardFace) -> bool {
    card.abilities.iter().any(|ab| {
        ParsedParams::parse(ab).get("Cost").is_some_and(|c| c.contains("Sac"))
    })
}

fn produces_tokens(card: &CardFace) -> bool {
    card.abilities.iter().chain(card.triggers.iter())
        .any(|line| ability_verb(line) == Some(ApiType::Token))
}

fn fills_graveyard(card: &CardFace) -> bool {
    card.abilities.iter().chain(card.triggers.iter()).any(|line| {
        matches!(ability_verb(line), Some(ApiType::Mill | ApiType::Discard | ApiType::Surveil))
    })
}

fn has_recursion(card: &CardFace) -> bool {
    card.keywords.iter().any(|k| {
        k.starts_with("Flashback") || k.starts_with("Escape") || k.starts_with("Unearth")
    })
}

fn has_spellcast_trigger(card: &CardFace) -> bool {
    card.triggers.iter().any(|t| t.contains("Mode$ SpellCast"))
}
```

Notes for the implementer:
- `ability_verb` must also walk trigger `Execute$ <SVar>` indirection if you want token/mill
  triggers reached through SVars; the minimal version above only catches inline verbs. For
  parity-faithfulness the *thresholds/weights matter*, the predicate recall is a tuning knob —
  start inline-only, widen if undercounting. Confirm `ApiType` re-export path
  (`forge_engine_core::ability::api_type` per api maps; the crate is `forge-engine` aliased
  `forge_engine_core` in `forge-ai/Cargo.toml`).
- Phase's `state.objects` global battlefield does not exist; the `game.cards` scan is the
  established manabrew idiom (eval.rs:85). `obj.name` → `card.card_name` (card mod.rs:201).

### 1.4 Dependencies on other phase-ai modules
**None.** `synergy.rs` is self-contained (only `engine::*` types + std). It is itself a
dependency of phase-ai's higher policy layers (board/tutor scorers) — not in scope here.

### 1.5 Risks
- **Decklist→`DeckEntry` bridge (medium):** phase gets typed `DeckEntry` for free; manabrew
  must aggregate the flat `Deck.cards` DTO by name and resolve via `CardDatabase`. Unresolved
  names (DFC `//`, tokens, parse failures) must be skipped, not panicked. The `SynergyGraph`
  needs a `&CardDatabase` at build time — thread it from the agent factory / game setup.
- **Raw-script predicate fidelity (medium):** the four detectors lose phase's exact typed
  matching. `Cost$ ... Sac` substring is a slight over-match (catches "Sacrifice" in any cost
  position — acceptable, that *is* a sac cost); token/mill/surveil via first-verb misses
  SVar-indirected sub-abilities (under-match). Neither changes the weights, only recall.
- **Changeling via string compare** is exact (engine uses the same `"Changeling"` keyword
  string, mod.rs:3227) — low risk.
- **Not infeasible anywhere.** All four axes port cleanly; only predicate plumbing adapts.

---

## PART 2 — `combo/registry.rs`

### 2.1 What it does
A **hand-authored registry of named win-combo "lines"** plus four query methods used by the
AI's combo/tutor/mulligan layers. It owns `lines: Vec<ComboLine>` (3 lines: Heliod+Ballista,
Thassa's Oracle+Demonic Consultation, Kiki-Jiki+Felidar Guardian) and a
`detector: Box<dyn ComboDetector>` (`StructuralComboDetector`). Queries:
- `reachable_lines(state, ai)` → `Vec<(ComboLineId, ComboReachability)>`: ask the detector to
  `assess` each line; drop `NotReachable`.
- `lines()` → `&[ComboLine]`.
- `missing_pieces_for_near_reachable_lines(state, ai)` → `Vec<&'static str>`: card names that,
  if fetched, complete a line with **exactly one** missing piece (tutor-target booster).
- `lines_with_pieces_in_hand(hand, state)` → `Vec<ComboLineId>`: lines whose **all** `InHand`
  pieces are present in `hand` (mulligan "do I have a combo in opener?" primitive).

Each `ComboLine` is pure data: `id`, `name`, `pieces: Vec<ComboPiece>`,
`mana_cost: ManaCost`, `action_sequence: Vec<ComboStep>`, `win_kind: WinKind`.

### 2.2 Phase types/APIs read → manabrew equivalents

| phase symbol | role | manabrew equivalent | cite |
|---|---|---|---|
| `engine::types::game_state::GameState` | board read | `forge_engine_core::game::GameState` | game.rs:92 |
| `engine::types::player::PlayerId` | player | `forge_engine_core::ids::PlayerId` | ids.rs:9 |
| `engine::types::identifiers::ObjectId` (hand ids) | card handle | `forge_engine_core::ids::CardId` | ids.rs:5 |
| `state.objects.get(&id).obj.name` (in `lines_with_pieces_in_hand`) | name lookup | `game.card(id).card_name` | game.rs:263; card mod.rs:201 |
| `engine::types::mana::ManaCost` (`ManaCost::Cost{shards, generic}`, `ManaCost::NoCost`) | line cost | `forge_foundation::ManaCost` — a struct, **not** an enum; build via `ManaCost::parse("1 W")`, `ManaCost::parse("1 U U B")`, `ManaCost::zero()` for NoCost | mana.rs:386/403/425 |
| `engine::types::mana::ManaCostShard::{White,Blue,Black}` | pip enum | **NO enum equivalent** — manabrew `ManaCost` is parsed from strings; encode pips inside the `parse(...)` argument | mana.rs:386 |
| `crate::combo::line::{ComboLine, ComboLineId, ComboPiece, ComboStep, WinKind, ComboReachability, CardPredicate}` | data model | **phase-ai-internal; must be ported (sibling module `combo/line.rs`)** — see §D | — (out of fetched scope) |
| `crate::combo::detection::{ComboDetector, StructuralComboDetector, piece_present}` | reachability engine | **phase-ai-internal; must be ported (sibling module `combo/detection.rs`)** — see §D | — (out of fetched scope) |

### 2.3 Faithful-port plan — skeleton

`registry.rs` is overwhelmingly **data + glue**; its logic is engine-agnostic *given* the
`combo::line` / `combo::detection` modules. The three query methods port verbatim except for
the `ObjectId`/`name` access in `lines_with_pieces_in_hand`.

```rust
// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use forge_engine_core::game::GameState;
use forge_engine_core::ids::{CardId, PlayerId};
use forge_foundation::ManaCost;

use crate::combo::detection::{piece_present, ComboDetector, StructuralComboDetector};
use crate::combo::line::{
    CardPredicate, ComboLine, ComboLineId, ComboPiece, ComboReachability, ComboStep, WinKind,
};

pub struct ComboRegistry {
    lines: Vec<ComboLine>,
    detector: Box<dyn ComboDetector>,
}

impl Default for ComboRegistry {
    fn default() -> Self {
        Self {
            lines: vec![
                heliod_ballista_line(),
                thoracle_consultation_line(),
                kiki_felidar_line(),
            ],
            detector: Box::new(StructuralComboDetector),
        }
    }
}

impl ComboRegistry {
    pub fn reachable_lines(&self, game: &GameState, ai: PlayerId)
        -> Vec<(ComboLineId, ComboReachability)>
    {
        self.lines.iter()
            .map(|line| (line.id, self.detector.assess(game, line, ai)))
            .filter(|(_, r)| !matches!(r, ComboReachability::NotReachable))
            .collect()
    }

    pub fn lines(&self) -> &[ComboLine] { &self.lines }

    pub fn missing_pieces_for_near_reachable_lines(&self, game: &GameState, ai: PlayerId)
        -> Vec<&'static str>
    {
        let mut out: Vec<&'static str> = Vec::new();
        for line in &self.lines {
            let (_present, missing): (Vec<_>, Vec<_>) = line.pieces.iter()
                .partition(|piece| piece_present(piece, game, ai));
            if missing.len() != 1 { continue; }                       // VERBATIM near-reachable rule
            if let Some(name) = match &missing[0] {
                ComboPiece::InHand(CardPredicate::NameEquals(n))
                | ComboPiece::OnBattlefield(CardPredicate::NameEquals(n))
                | ComboPiece::InGraveyard(CardPredicate::NameEquals(n))
                | ComboPiece::InLibrary(CardPredicate::NameEquals(n)) => Some(*n),
            } {
                if !out.contains(&name) { out.push(name); }
            }
        }
        out
    }

    pub fn lines_with_pieces_in_hand(&self, hand: &[CardId], game: &GameState)
        -> Vec<ComboLineId>
    {
        self.lines.iter()
            .filter(|line| {
                let in_hand_predicates: Vec<&CardPredicate> = line.pieces.iter()
                    .filter_map(|p| match p { ComboPiece::InHand(pred) => Some(pred), _ => None })
                    .collect();
                !in_hand_predicates.is_empty()
                    && in_hand_predicates.iter().all(|pred| {
                        hand.iter().any(|&id| match pred {
                            // manabrew: game.card(id) is infallible (arena), so no Option dance.
                            CardPredicate::NameEquals(name) => game.card(id).card_name == *name,
                        })
                    })
            })
            .map(|line| line.id)
            .collect()
    }
}

// ── Line data (VERBATIM card names + ids + win_kind; ManaCost via parse) ──────
fn heliod_ballista_line() -> ComboLine {
    ComboLine {
        id: ComboLineId(0),
        name: "Heliod, Sun-Crowned + Walking Ballista",
        pieces: vec![
            ComboPiece::OnBattlefield(CardPredicate::NameEquals("Heliod, Sun-Crowned")),
            ComboPiece::OnBattlefield(CardPredicate::NameEquals("Walking Ballista")),
        ],
        mana_cost: ManaCost::parse("1 W"),                            // phase: {shards:[White], generic:1}
        action_sequence: vec![
            ComboStep::Activate { predicate: CardPredicate::NameEquals("Heliod, Sun-Crowned"), ability_index: 0 },
            ComboStep::Activate { predicate: CardPredicate::NameEquals("Walking Ballista"),    ability_index: 1 },
        ],
        win_kind: WinKind::InfiniteLoop,
    }
}

fn thoracle_consultation_line() -> ComboLine {
    ComboLine {
        id: ComboLineId(1),
        name: "Thassa's Oracle + Demonic Consultation",
        pieces: vec![
            ComboPiece::InHand(CardPredicate::NameEquals("Thassa's Oracle")),
            ComboPiece::InHand(CardPredicate::NameEquals("Demonic Consultation")),
        ],
        mana_cost: ManaCost::parse("1 U U B"),                        // phase: {shards:[Blue,Blue,Black], generic:1}
        action_sequence: vec![
            ComboStep::Cast { predicate: CardPredicate::NameEquals("Thassa's Oracle") },
            ComboStep::Cast { predicate: CardPredicate::NameEquals("Demonic Consultation") },
        ],
        win_kind: WinKind::ImmediateLoss,
    }
}

fn kiki_felidar_line() -> ComboLine {
    ComboLine {
        id: ComboLineId(2),
        name: "Kiki-Jiki, Mirror Breaker + Felidar Guardian",
        pieces: vec![
            ComboPiece::OnBattlefield(CardPredicate::NameEquals("Kiki-Jiki, Mirror Breaker")),
            ComboPiece::OnBattlefield(CardPredicate::NameEquals("Felidar Guardian")),
        ],
        mana_cost: ManaCost::zero(),                                  // phase: ManaCost::NoCost
        action_sequence: vec![ComboStep::Activate {
            predicate: CardPredicate::NameEquals("Kiki-Jiki, Mirror Breaker"),
            ability_index: 0,
        }],
        win_kind: WinKind::InfiniteLoop,
    }
}
```

**Ability-index caveat (parity-load-bearing):** the line data hard-codes
`ability_index` (Heliod=0, Ballista damage=1, Kiki copy=0). Those indices are phase's parsed
ability ordering. manabrew must verify the **same index** lands on the same ability after its
own parse (`CardState::get_intrinsic_spell_abilities`, card_state.rs:357) — engines may order
keyword-granted vs printed abilities differently. Validate against the actual parsed cards
before trusting the indices (phase's own module-doc notes the indices were hand-verified).

### 2.4 Dependencies on other phase-ai modules (HARD — must port first)
`combo/registry.rs` does **not compile** without two sibling modules that were **not** in the
fetch scope and have **no manabrew equivalent yet**:
- **`crate::combo::line`** — `ComboLine`, `ComboLineId(u32)`, `ComboPiece`
  (`InHand`/`OnBattlefield`/`InGraveyard`/`InLibrary`, each wrapping `CardPredicate`),
  `CardPredicate::NameEquals(&'static str)`, `ComboStep` (`Activate{predicate, ability_index}`
  / `Cast{predicate}`), `WinKind` (`InfiniteLoop`/`ImmediateLoss`), `ComboReachability`
  (`NotReachable` / `ReachableThisTurn{missing_mana, required_actions}` / …).
- **`crate::combo::detection`** — `trait ComboDetector { fn assess(&self, &GameState,
  &ComboLine, PlayerId) -> ComboReachability }`, `struct StructuralComboDetector`,
  `fn piece_present(&ComboPiece, &GameState, PlayerId) -> bool`.

These must be fetched + ported (`combo/line.rs`, `combo/detection.rs`) before registry.rs.
`detection.rs` is the only behaviorally rich one — it reads zones and computes affordability
(the test references `can_pay_cost_after_auto_tap` / color-accurate mana). Its manabrew
mapping: zone membership via `game.cards_in_zone(ZoneType::{Hand,Battlefield,Graveyard,Library},
ai)` (game.rs:520); mana affordability via `mana::calculate_available_mana_for_casting`
(mana/mod.rs:883) + `ManaPool::can_pay(&ManaCost)` (mana_pool.rs:313) instead of phase's
`can_pay_cost_after_auto_tap`. **Flag:** registry.rs is a thin shell; ~80% of the real combo
work lives in the unfetched `detection.rs`.

### 2.5 Risks
- **Two missing sibling modules (high / blocking):** registry.rs is uncompilable until
  `combo::line` + `combo::detection` are ported. Spec the registry now, but it cannot land
  alone.
- **`ManaCost` shape mismatch (low):** phase's `ManaCost::Cost{shards,generic}` enum →
  manabrew's parsed-struct `ManaCost::parse("…")`. Encode pips in the string; verify
  `ManaCost::parse("1 U U B").cmc()==4` and color pips resolve (mana.rs:425/505).
- **Hard-coded `ability_index` (medium):** see caveat above — must re-verify per card under
  manabrew's parser or the combo steps target the wrong ability.
- **`state.objects` global vs arena (low):** manabrew `game.card(id)` is infallible; phase's
  `state.objects.get(&id).is_some_and(...)` Option-guard collapses cleanly.
- **Not infeasible:** the structural model (zones + name predicates + reachability) maps onto
  manabrew's zone accessors and mana engine; nothing here needs Forge-DSL features manabrew
  lacks. The combo *execution* (actually walking the line) is out of registry.rs scope.

---

## PART 3 — Shared dependency note for whoever wires this in
Add to `forge-ai/Cargo.toml`: `forge-carddb` (for `CardFace`/`CardDatabase`) and
`forge-card-script` (for `ParsedParams`) and `forge-agent-interface` (for the `Deck` DTO,
only if the DeckEntry bridge lives in this crate). `forge-engine-core` + `forge-foundation`
are already deps. Register both modules in `lib.rs` (`pub mod synergy; pub mod combo;` with
`combo/mod.rs` → `pub mod registry;` and eventually `line`/`detection`).
