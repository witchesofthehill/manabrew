# Faithful-port spec — `phase-ai/cast_facts.rs` (+ its primary consumer `card_hints.rs`)

Target: a `forge-ai` crate (or module) over the manabrew Forge-DSL engine. The
named output is `cast_facts.rs`; `card_hints.rs` is included because it is the
direct, named consumer of `CastFacts`/`EffectProfile` and is the only place the
numeric weights live — porting `cast_facts` without it leaves the spec untestable.

Source pulled verbatim from
`https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/cast_facts.rs`
(full body obtained) and `.../card_hints.rs` (structure + every numeric constant
obtained; the host refused a full verbatim dump, so function bodies are
reconstructed from the extracted control flow — flagged where reconstructed).

---

## 1. What these modules do (the AI logic)

### `cast_facts.rs` — *effect classification, no scoring*
It turns a card / ability / game-action into a small bag of boolean "what does
this DO" flags plus some structural facts, so the policy layer can score it.

- **`EffectProfile`** — 7 booleans summarising an effect list:
  `has_search_library, has_reveal_hand_or_discard, has_draw, has_token_creation,
  has_counter_spell, has_direct_removal_text, has_mass_damage_or_mass_shrink_text`.
  Built by `from_effects(&[&Effect])` (pure pattern-match over Phase's typed
  `Effect` enum), `from_face(&CardFace)` (whole-card surface: every ability +
  every trigger's `execute` chain), or `effect_profile_for_action`.
- **`CastFacts<'a>`** — card-level facts for a *spell being cast*: the casting
  `GameObject`, its spell abilities (`primary_effects`), its **immediate-ETB
  triggers** (only `ChangesZone`/Self/→Battlefield triggers — i.e. effects that
  happen the moment it resolves), its **immediate replacements** (same gate on
  the replacement side), `mana_value`, the derived `EffectProfile`, and two
  "does the spell text require a target" predicates. It exposes `is_creature /
  is_planeswalker / is_enchantment` and `immediate_effects()`.
- **Effect collection** walks an ability tree: `effect` + `sub_ability` +
  `else_ability` + `mode_abilities` (recursive), and de-dups structurally-equal
  immediate abilities across spell/trigger/replacement sources.
- **`effect_requires_targets`** — per-effect predicate; notable carve-out: a
  non-targeted `Bounce` (`BounceSelection != Targeted`, or `TargetFilter::None`)
  does **not** require a target slot (CR 115.1 / Whitemane Lion ruling).
- **`is_direct_removal`** / **`is_mass_damage_or_shrink`** — the two classifier
  predicates that feed the removal flags (verbatim variant lists in §3).

It assigns **no scores and reads no board state** beyond the object's own
type-line and ability text. It is pure classification.

### `card_hints.rs` — *priority scoring* (`should_play_now`)
Returns `f64 ∈ [0.0, 1.0]`: "how much do I want to take this action right now".
Branches on `GameAction`, then for spells on the `EffectProfile` category and the
current `Phase`. Lands are always `1.0`. All weights are carried verbatim in §3.

---

## 2. Every Phase type/API read → manabrew equivalent

Citations are `forge-engine/crates/forge-engine/src/<file>:<line>` unless a crate
prefix (`forge-foundation`) is given. **⚠ = no clean equivalent / adaptation
required**; **✗ = no equivalent at all (infeasible-as-written)**.

### 2a. Core engine objects

| Phase (`engine::…`) | manabrew equivalent | cite | note |
|---|---|---|---|
| `game::game_object::GameObject` | `card::Card` (the arena card) | card/mod.rs:197 | Phase separates `ObjectId` from `CardId`; manabrew `CardId` **is** the arena index — there is no second id. |
| `GameObject.card_id` | `Card.id: CardId` | card/mod.rs:198 | |
| `GameObject.card_types.core_types: Vec<CoreType>` | `Card.type_line: CardTypeLine` → `.core_types: BTreeSet<CoreType>` | card/mod.rs:215; forge-foundation card_type.rs:153 | `contains(&CoreType::X)` works on the BTreeSet too. |
| `GameObject.mana_cost.mana_value() -> u32` | `Card.mana_cost: ManaCost` → `ManaCost::cmc() -> i32` | card/mod.rs:218; forge-foundation mana.rs:505 | i32 not u32 — cast. |
| `GameObject.abilities: Arc<Vec<AbilityDefinition>>` | **split**: spell/printed abilities via `CardState::get_intrinsic_spell_abilities() -> Vec<SpellAbility>` (filters `is_activated‖is_trigger‖is_spell`); `get_spell_abilities()` for all | card/card_state.rs:357 / :333 | ⚠ Phase has one flat `.abilities` list with a `.kind` tag; manabrew has no single list — spell abilities come off `CardState`, activated off `card.activated_abilities` (mod.rs:350). |
| `AbilityDefinition` | `spellability::SpellAbility` | spellability/mod.rs:99 | |
| `AbilityDefinition.kind: AbilityKind {Spell, Activated}` | `SpellAbility.is_spell / is_activated / is_trigger: bool` | mod.rs:143-147 | ⚠ no `AbilityKind` enum; use the bools. `kind == Spell` → `sa.is_spell`. |
| `AbilityDefinition.effect: Effect` | `SpellAbility.api: Option<ApiType>` + `SpellAbility.ir: SpellAbilityIr` | mod.rs:104 / :125; ability/api_type.rs:11; ability/ability_ir.rs:78 | ✗→⚠ **Central adaptation.** There is **no typed `Effect` enum**. The verb is `ApiType` and the operands are the loosely-typed `ir.*` bag. Every `matches!(e, Effect::X)` becomes `sa.api == Some(ApiType::X)` refined by `ir` fields. |
| `AbilityDefinition.sub_ability: Option<Box<AbilityDefinition>>` | `SpellAbility.sub_ability: Option<Box<SpellAbility>>` | mod.rs:138 | ✓ direct. |
| `AbilityDefinition.else_ability` | `ir.false_sub_ability` (+ `true_sub_ability`) branch glue | ability_ir.rs:503,116 | ⚠ partial: manabrew models if/else via `ir.mode`/`branch_condition_svar` + true/false sub-abilities, not a single `else_ability` field. |
| `AbilityDefinition.mode_abilities: Vec<…>` | charm/modal glue: `ir.mode` + sub-ability chain | ability_ir.rs:115 | ⚠ no structured `mode_abilities` vec; modal options are represented as the SVar-named alternatives the charm walks. See §5 risk. |
| `card::CardFace` (`from_face`) | `carddb::CardRules` face / `Card` printed state | forge-carddb (`CardRules`) | ⚠ `from_face` is a *pre-game / draft-pick* surface. manabrew's static card data is `CardRules`; the in-game equivalent is a `Card` built from it. For the in-game `CastFacts` path (the one `card_hints` uses) this is not needed. |

### 2b. Triggers / replacements (immediate-ETB gating)

| Phase | manabrew | cite | note |
|---|---|---|---|
| `types::triggers::TriggerDefinition` | `trigger::Trigger` | trigger/trigger.rs:23 | |
| `trigger.mode: TriggerMode` (`== ChangesZone`) | `Trigger.kind: TriggerType` (`== TriggerType::ChangesZone`) | trigger/trigger.rs:29; trigger/trigger_changes_zone.rs:25 | ✓ cheap discriminant. |
| `trigger.destination == Some(Zone::Battlefield)` | `Trigger.mode.destination_zone() -> Option<ZoneType>` `== Some(ZoneType::Battlefield)` | trigger/trigger.rs:82 | ✓ behaviour method. |
| `trigger.valid_card == Some(TargetFilter::SelfRef)` | `Trigger.ir` / params `ValidCard$ Card.Self` (read via `keys::VALID_CARD`, compiled `CompiledSelector`) | trigger/trigger.rs:32; parsing keys | ⚠ no `TargetFilter::SelfRef` enum; it is a selector string/`CompiledSelector`. Test = selector resolves to "this card". A pragmatic port checks the raw `ValidCard` text `== "Card.Self"`. |
| `trigger.execute: Option<Box<AbilityDefinition>>` | `Trigger.execute: String` (SVar name) + `Trigger.spawning_ability: Option<SpellAbility>` | trigger/trigger.rs:33,40 | ⚠ **not a stored ability tree.** To get the trigger's effects you must build the overriding `SpellAbility` from the `execute` SVar via `ability_factory::build_spell_ability_from_host_card` (ability_factory.rs:237). `is_some()` → `!Trigger.execute.is_empty()`. |
| `types::triggers::TriggerMode` | `trigger::TriggerType` enum | trigger/trigger_handler.rs (TriggerType) | ✓ |
| `types::replacements::ReplacementEvent {ChangeZone, Moved}` | `replacement::ReplacementType` (`event` field) | replacement/replacement_effect.rs:59; replacement/replacement_type.rs | ⚠ manabrew has `ReplacementType::Moved`; verify a `ChangeZone` variant exists — if not, both Phase arms collapse to `Moved`. |
| `ReplacementDefinition` fields `valid_card / destination_zone / execute` | `ReplacementEffect.ir: ReplacementEffectIr` + params (`ValidCard$`, `Destination$`) | replacement/replacement_effect.rs:63,67 | ⚠ same as triggers: `execute` is built from params, not stored as an ability. |
| `types::zones::Zone` (`Battlefield/Hand/Exile/Graveyard/Library`) | `forge_foundation::ZoneType` | forge-foundation zone.rs:5 | ✓ |
| `types::card_type::CoreType` (`Creature/Planeswalker/Enchantment/Artifact/Battle/Land`) | `forge_foundation::CoreType` | forge-foundation card_type.rs | ✓ same names. |

### 2c. Game state & actions

| Phase | manabrew | cite | note |
|---|---|---|---|
| `types::game_state::GameState` | `game::GameState` (`Game`) | game.rs:92 | ✓ |
| `state.objects.get(object_id) -> Option<&GameObject>` | `game.card(CardId) -> &Card` (or `game.cards.get(id.index())`) | game.rs:263 | ⚠ infallible accessor; for `Option` use `cards.get(idx)`. |
| `state.players[player.0].hand: Vec<ObjectId>` | `game.cards_in_zone(ZoneType::Hand, player) -> &[CardId]` | game.rs:520 | ⚠ no `.hand` field; use the zone accessor. |
| `types::player::PlayerId` ; `player.0 as usize` | `ids::PlayerId`; `player.index()` | ids.rs:9,18 | ✓ |
| `types::actions::GameAction::CastSpell { object_id, card_id, .. }` | `player::actions::PlayerAction::CastSpell(PlayOption)`; `PlayOption.card_id` | player/actions/player_action.rs:11; agent/types.rs:16 | ⚠ no `object_id`/`card_id` split → the `cast_object_for_action` "object_id filtered by card_id, else search hand" dance collapses to "look up `PlayOption.card_id`". |
| `GameAction::ActivateAbility { source_id, ability_index }` | `PlayerAction::ActivateAbility(AbilityRef{card_id, ability_index})` | player_action.rs:27 | ✓ but ability lookup is `card.activated_abilities[ability_index]` (mod.rs:350), not `object.abilities[idx]`. |
| `GameAction::PlayLand` | `PlayerAction::CastSpell(PlayOption)` where the card `is_land()` (no distinct PlayLand action) | card/mod.rs:1026 | ⚠ manabrew has **no `PlayLand` variant**; a land play is a `CastSpell`/`Play` of a land card. The `card_hints` `PlayLand → 1.0` arm becomes "card is a land → 1.0". |

### 2d. Phase enum (used only by `card_hints`)

| Phase `types::phase::Phase` | manabrew `forge_foundation::PhaseType` | cite |
|---|---|---|
| `PreCombatMain` | `Main1` | forge-foundation phase.rs:5 |
| `PostCombatMain` | `Main2` | phase.rs:5 |
| `BeginCombat` | `CombatBegin` | phase.rs:5 |
| `DeclareAttackers` | `CombatDeclareAttackers` | phase.rs:5 |
| `DeclareBlockers` | `CombatDeclareBlockers` | phase.rs:5 |
| `CombatDamage` | `CombatDamage` (+ `CombatFirstStrikeDamage`) | phase.rs:5 |
| `End` | `EndOfTurn` | phase.rs:5 |
| `Cleanup` | `Cleanup` | phase.rs:5 |
| current phase | `game.turn.phase: PhaseType` | phase/mod.rs:148 |
| own turn? | `game.active_player() == player` | game.rs:458 |
| stack non-empty? | `!game.stack.is_empty()` (MagicStack) | game.rs:102 |

### 2e. Keywords (used only by `card_hints::creature_keyword_bonus`)

Phase `types::keywords::Keyword` → manabrew `Card` convenience bools (mod.rs):
`Flying`→`has_flying`:1285, `Trample`→`has_trample`:1301, `Vigilance`→`has_vigilance`:1313,
`Lifelink`→`has_lifelink`:1309, `Deathtouch`→`has_deathtouch`:1305,
`FirstStrike`→`has_first_strike`:1293, `DoubleStrike`→`has_double_strike`:1297,
`Haste`→`has_haste`:1281. **`Menace`** has no convenience bool → `card.has_keyword("Menace")` (mod.rs:1261). ✓
Power/toughness: `Card::power()`:988 / `Card::toughness()`:1000.

### 2f. Effect-variant → ApiType map (the heart of the port)

Phase `Effect::X` patterns used in `cast_facts.rs`, mapped to manabrew
`api: ApiType` (api_type.rs) refined by `ir` (ability_ir.rs):

| Phase `Effect` | manabrew classification | flag |
|---|---|---|
| `SearchLibrary{..}` | **✗ no `SearchLibrary` verb.** `ApiType::ChangeZone` with `ir.origin_zone == Library` + hidden, OR `ApiType::{Dig, DigUntil, DigMultiple, Seek, Learn}` | ⚠ adapt |
| `RevealHand{..}` | `ApiType::RevealHand` (api_type.rs:174) | ✓ |
| `DiscardCard{..}` | `ApiType::Discard` (api_type.rs:82) | ✓ |
| `Draw{..}` | `ApiType::Draw` (api_type.rs:86) | ✓ |
| `Token{..}` | `ApiType::Token` (api_type.rs:200) | ✓ |
| `Counter{..}` | `ApiType::Counter` (api_type.rs:67) | ✓ |
| `Destroy{..}` | `ApiType::Destroy` (api_type.rs:77) | ✓ |
| `DealDamage{..}` | `ApiType::DealDamage` (api_type.rs:72) | ✓ |
| `Bounce{..}` | **✗ no `Bounce` verb.** `ApiType::ChangeZone` with `ir.origin_zone == Battlefield && ir.destination_zone == Hand` | ⚠ adapt |
| `DestroyAll{..}` | `ApiType::DestroyAll` (api_type.rs:78) | ✓ |
| `DamageAll{..}` | `ApiType::DamageAll` (api_type.rs:70) | ✓ |
| `ChangeZone{destination: Exile\|Graveyard}` | `ApiType::ChangeZone` + `ir.destination_zone ∈ {Exile, Graveyard}` (ability_ir.rs:133) | ✓ |
| `Pump{power,toughness,target}` (Fixed, <0 ⇒ shrink) | `ApiType::Pump` (api_type.rs:150); P/T from `ir` amount text (`NumAtt`/`NumDef`, parse `AmountExpr::Literal`, negative ⇒ shrink) | ⚠ adapt (no `PtValue`) |
| `effect_requires_targets` per-variant (`Tap,Untap,GainControl,Fight,Goad,Connive,Suspect,ForceBlock,Exploit,Attach,GivePlayerCounter,BecomeCopy,ExtraTurn,SkipNextStep,Regenerate,DoublePT,PreventDamage,Animate,AddCounter,…`) | **replace whole function** with `sa.target_restrictions.is_some()` | mod.rs:129 | ✓ simpler |

> Tap`→`ApiType::Tap`:195, `Untap`→`Untap`:204, `GainControl`→`GainControl`:106,
> `Fight`→`Fight`:102, `Regenerate`→`Regenerate`:156, `Animate`→`Animate`:21,
> `AddCounter`→`PutCounter`:152 exist if you ever need the literal mapping, but
> see the simplification note below.

---

## 3. Faithful-port plan + Rust skeleton

`cast_facts.rs` carries **no numbers** — its fidelity is structural (which
effects map to which flags, the ETB/replacement gating, the dedup, the
target-required carve-out). `card_hints.rs` carries the weights, which are
reproduced **verbatim** below.

### 3a. `forge-ai/src/cast_facts.rs` skeleton

```rust
use forge_engine::ability::api_type::ApiType;
use forge_engine::ability::ability_ir::SpellAbilityIr;
use forge_engine::card::Card;
use forge_engine::game::GameState;
use forge_engine::ids::{CardId, PlayerId};
use forge_engine::player::actions::player_action::PlayerAction;
use forge_engine::spellability::SpellAbility;
use forge_engine::trigger::{Trigger, TriggerType};
use forge_foundation::{CoreType, ZoneType};

#[derive(Debug, Clone, Default)]
pub struct EffectProfile {
    pub has_search_library: bool,
    pub has_reveal_hand_or_discard: bool,
    pub has_draw: bool,
    pub has_token_creation: bool,
    pub has_counter_spell: bool,
    pub has_direct_removal_text: bool,
    pub has_mass_damage_or_mass_shrink_text: bool,
}

impl EffectProfile {
    /// Phase's `from_effects(&[&Effect])`. manabrew unit is a lowered
    /// `SpellAbility` (api + ir), so we classify a slice of `&SpellAbility`.
    pub fn from_abilities(sas: &[&SpellAbility]) -> Self {
        Self {
            has_search_library: sas.iter().any(|s| is_search_library(s)),
            has_reveal_hand_or_discard: sas.iter().any(|s| {
                s.api == Some(ApiType::RevealHand) || s.api == Some(ApiType::Discard)
            }),
            has_draw: sas.iter().any(|s| s.api == Some(ApiType::Draw)),
            has_token_creation: sas.iter().any(|s| s.api == Some(ApiType::Token)),
            has_counter_spell: sas.iter().any(|s| s.api == Some(ApiType::Counter)),
            has_direct_removal_text: sas.iter().any(|s| is_direct_removal(s)),
            has_mass_damage_or_mass_shrink_text: sas.iter().any(|s| is_mass_damage_or_shrink(s)),
        }
    }
}

/// Phase's `is_direct_removal` — verbatim variant set, re-expressed over ApiType+ir.
pub(crate) fn is_direct_removal(s: &SpellAbility) -> bool {
    matches!(
        s.api,
        Some(ApiType::Destroy)
            | Some(ApiType::DealDamage)
            | Some(ApiType::Counter)
            | Some(ApiType::Fight)
            | Some(ApiType::DestroyAll)
            | Some(ApiType::DamageAll)
            | Some(ApiType::Discard)            // Phase: Effect::DiscardCard
    )
    || is_bounce(s)                              // Phase: Effect::Bounce
    || matches!(s.api, Some(ApiType::ChangeZone))
        && matches!(
            s.ir.destination_zone,               // Phase: ChangeZone{Exile|Graveyard}
            Some(ZoneType::Exile) | Some(ZoneType::Graveyard)
        )
}

/// Phase's `is_mass_damage_or_shrink`.
pub(crate) fn is_mass_damage_or_shrink(s: &SpellAbility) -> bool {
    matches!(s.api, Some(ApiType::DestroyAll) | Some(ApiType::DamageAll))
        || (s.api == Some(ApiType::Pump)
            && pump_target_is_any(s)
            && pump_pt_negative(s))   // power<0 || toughness<0, Fixed only
}

fn is_bounce(s: &SpellAbility) -> bool {
    s.api == Some(ApiType::ChangeZone)
        && s.ir.origin_zone == Some(ZoneType::Battlefield)
        && s.ir.destination_zone == Some(ZoneType::Hand)
}

fn is_search_library(s: &SpellAbility) -> bool {
    matches!(s.api, Some(ApiType::Dig) | Some(ApiType::DigUntil)
                  | Some(ApiType::DigMultiple) | Some(ApiType::Seek) | Some(ApiType::Learn))
        || (s.api == Some(ApiType::ChangeZone) && s.ir.origin_zone == Some(ZoneType::Library))
}

/// Walk Phase's effect tree: effect + sub + else + modes. manabrew analogue:
/// sub_ability chain + ir.false/true_sub_ability. Returns the SA nodes whose
/// `api` carries the verb.
pub(crate) fn collect_definition_effects(sa: &SpellAbility) -> Vec<&SpellAbility> {
    let mut out = Vec::new();
    push_sa(&mut out, sa);
    out
}
fn push_sa<'a>(out: &mut Vec<&'a SpellAbility>, sa: &'a SpellAbility) {
    out.push(sa);
    if let Some(sub) = sa.sub_ability.as_deref() { push_sa(out, sub); }
    if let Some(fa) = sa.ir.false_sub_ability.as_deref() { push_sa(out, fa); } // else_ability
    if let Some(ta) = sa.ir.true_sub_ability.as_deref()  { push_sa(out, ta); } // mode/branch
}
```

```rust
pub struct CastFacts<'a> {
    pub card: &'a Card,
    pub primary_effects: Vec<&'a SpellAbility>,        // Phase: kind==Spell
    pub immediate_etb_triggers: Vec<&'a Trigger>,
    // replacements: see risk — manabrew replacements don't carry a ready SA tree
    pub mana_value: i32,                                // Phase u32 → i32 (cmc)
    pub profile: EffectProfile,
    pub requires_targets_in_spell_text: bool,
    pub requires_targets_in_immediate_etb: bool,
}

impl<'a> CastFacts<'a> {
    pub fn has_search_library(&self) -> bool { self.profile.has_search_library }
    pub fn has_reveal_hand_or_discard(&self) -> bool { self.profile.has_reveal_hand_or_discard }
    pub fn has_draw(&self) -> bool { self.profile.has_draw }
    pub fn has_token_creation(&self) -> bool { self.profile.has_token_creation }
    pub fn has_counter_spell(&self) -> bool { self.profile.has_counter_spell }
    pub fn has_direct_removal_text(&self) -> bool { self.profile.has_direct_removal_text }
    pub fn has_mass_damage_or_mass_shrink_text(&self) -> bool {
        self.profile.has_mass_damage_or_mass_shrink_text
    }
    pub fn is_creature(&self) -> bool {
        self.card.type_line.core_types.contains(&CoreType::Creature)
    }
    pub fn is_planeswalker(&self) -> bool {
        self.card.type_line.core_types.contains(&CoreType::Planeswalker)
    }
    pub fn is_enchantment(&self) -> bool {
        self.card.type_line.core_types.contains(&CoreType::Enchantment)
    }
}

/// Phase `qualifies_immediate_etb`: permanent spell + ChangesZone/Self/→Battlefield + has execute.
fn qualifies_immediate_etb(card: &Card, t: &Trigger) -> bool {
    is_permanent_spell(card)
        && t.kind == TriggerType::ChangesZone
        && trigger_valid_card_is_self(t)                       // ValidCard$ Card.Self
        && t.mode.destination_zone() == Some(ZoneType::Battlefield)
        && !t.execute.is_empty()
}

fn is_permanent_spell(card: &Card) -> bool {
    card.type_line.core_types.iter().any(|c| {
        matches!(c, CoreType::Artifact | CoreType::Battle | CoreType::Creature
                  | CoreType::Enchantment | CoreType::Land | CoreType::Planeswalker)
    })
}

pub fn cast_facts_for_object(game: &GameState, card: &Card) -> CastFacts<'_> {
    // primary_effects: the card's spell abilities (is_spell == true)
    // immediate_etb_triggers: card.triggers filtered by qualifies_immediate_etb
    // profile: EffectProfile::from_abilities over collect_definition_effects of all immediate SAs
    //          (spell SAs + each trigger's overriding SA built from its `execute` SVar) — DEDUPED
    // requires_targets_*: ANY immediate SA has sa.target_restrictions.is_some()  (replaces
    //          Phase effect_requires_targets, incl. the non-targeted-Bounce carve-out — a
    //          non-targeting Bounce simply has target_restrictions == None)
    unimplemented!("wire per §3a + §5 risks")
}
```

**Verbatim-fidelity checklist for `cast_facts`:**
- `is_direct_removal` variant set: Destroy, DealDamage, Bounce, Counter, Fight,
  DestroyAll, DamageAll, DiscardCard, **and** ChangeZone→{Exile,Graveyard}. (exact)
- `is_mass_damage_or_shrink`: DestroyAll, DamageAll, **or** Pump with
  `target == Any` and `power<0 || toughness<0` (Fixed only). (exact)
- ETB gate: `is_permanent_spell && ChangesZone && ValidCard==Self &&
  destination==Battlefield && execute present`. (exact)
- Replacement gate: `event ∈ {ChangeZone, Moved} && ValidCard==Self &&
  destination==Battlefield`. (exact)
- Dedup: structurally-equal immediate abilities collapsed across
  spell/trigger/replacement sources (Phase uses `**existing == *ability`).
- Targets: an SA "requires a target" iff `target_restrictions.is_some()`.

### 3b. `forge-ai/src/card_hints.rs` skeleton — **weights verbatim**

```rust
pub fn should_play_now(state: &GameState, action: &PlayerAction, player: PlayerId) -> f64 {
    let facts = cast_facts_for_action(state, action, player);
    should_play_now_with_facts(state, action, player, facts.as_ref())
}

pub fn should_play_now_with_facts(
    state: &GameState,
    action: &PlayerAction,
    player: PlayerId,
    cast_facts: Option<&CastFacts>,
) -> f64 {
    // Land play (Phase GameAction::PlayLand) → manabrew: CastSpell of a land card.
    if is_land_play(state, action) {
        return 1.0;
    }
    let facts = match (action, cast_facts) {
        (PlayerAction::CastSpell(_), Some(f)) => f,
        (PlayerAction::CastSpell(_), None)   => return 0.5,   // spell, no facts
        _ => return 0.5,                                       // any other action
    };

    let phase     = state.turn.phase;
    let own_turn  = state.active_player() == player;
    let is_pre    = phase == PhaseType::Main1;          // PreCombatMain
    let is_combat = matches!(phase,
        PhaseType::CombatBegin | PhaseType::CombatDeclareAttackers
        | PhaseType::CombatDeclareBlockers
        | PhaseType::CombatDamage | PhaseType::CombatFirstStrikeDamage);
    let is_end    = matches!(phase, PhaseType::EndOfTurn | PhaseType::Cleanup);
    let stack_busy = !state.stack.is_empty();
    let p = &facts.profile;

    // ----- effect-category branches, in Phase's order -----
    if p.has_direct_removal_text {
        // scan opponents' battlefield creatures; max_threat via eval crate
        let max_threat = max_opponent_creature_threat(state, player); // f64, 0 if none
        return (0.5 + (max_threat / 30.0).min(0.4)).min(0.9);          // 0.5..=0.9
    }
    if facts_has_pump(facts) {                       // Effect::Pump present
        return if is_combat { 0.9 } else if is_end { 0.05 } else { 0.3 };
    }
    if p.has_counter_spell {
        return if !own_turn && stack_busy { 0.8 } else { 0.1 };
    }
    if p.has_search_library {
        return if own_turn { if is_pre { 0.72 } else { 0.58 } } else { 0.45 };
    }
    if p.has_reveal_hand_or_discard {
        return disruption_window_score(state, action, player).unwrap_or(0.18);
    }
    if p.has_draw && facts.mana_value >= 3 {
        return if is_pre { 0.68 } else { 0.56 };
    }

    // ----- card-type branches -----
    if facts.is_creature() {
        let kw  = creature_keyword_bonus(facts.card);
        let st  = creature_stat_bonus(facts.card);
        let etb = if has_etb_value(facts) { 0.08 } else { 0.0 };
        return if is_pre {
            (0.62 + kw + st + etb).min(0.85)
        } else {
            (0.48 + kw * 0.5 + st * 0.5 + etb * 0.5).min(0.7)
        };
    }
    if facts.is_planeswalker() || facts.is_enchantment() || p.has_token_creation {
        return if is_pre { 0.66 } else { 0.54 };
    }
    0.5   // default spell
}

fn creature_keyword_bonus(card: &Card) -> f64 {
    let mut b = 0.0;
    if card.has_flying()        { b += 0.03; }
    if card.has_trample()       { b += 0.03; }
    if card.has_vigilance()     { b += 0.03; }
    if card.has_keyword("Menace") { b += 0.03; }
    if card.has_lifelink()      { b += 0.03; }
    if card.has_deathtouch()    { b += 0.03; }
    if card.has_first_strike()  { b += 0.03; }
    if card.has_double_strike() { b += 0.03; }
    if card.has_haste()         { b += 0.03; }
    b.min(0.12)
}

fn creature_stat_bonus(card: &Card) -> f64 {
    ((card.power() + card.toughness()) as f64 / 20.0).min(0.1)
}
```

> **Verbatim constants** (do not retune): land `1.0`; no-facts/other `0.5`;
> removal `(0.5 + (max_threat/30.0).min(0.4)).min(0.9)`; pump `0.9 / 0.05 / 0.3`;
> counter `0.8 / 0.1`; search `0.72 / 0.58 / 0.45`; reveal-discard default `0.18`;
> draw (mv≥3) `0.68 / 0.56`; creature pre `(0.62+kw+st+etb).min(0.85)`, else
> `(0.48 + 0.5·kw + 0.5·st + 0.5·etb).min(0.7)`, `etb=0.08`; pw/ench/token
> `0.66 / 0.54`; keyword `+0.03` each, cap `0.12`; stat `((p+t)/20).min(0.1)`.
> The `should_play_now_with_facts` body above is **reconstructed** from the
> extracted control flow + constants (the source host refused a verbatim dump);
> the *numbers* are confirmed exact, the branch *ordering* (removal→pump→counter
> →search→reveal→draw→creature→pw/ench/token→default) is confirmed, but an
> implementer should diff against the upstream file once available.

---

## 4. Dependencies on other phase-ai modules

`cast_facts.rs`: **none** (only `engine::*`). It is a leaf and should be ported first.

`card_hints.rs` imports three sibling modules — these are *prerequisites* for a
compiling, behaviour-faithful `card_hints`:
- `crate::cast_facts::{cast_facts_for_action, CastFacts}` — **this spec.**
- `crate::eval::{evaluate_creature, threat_level}` — creature valuation + threat
  scalar; feed the removal branch's `max_threat`. **Not yet ported** — needs its
  own spec. The removal formula is faithfully portable only once `threat_level`
  exists; until then stub `max_opponent_creature_threat` returning `0.0` (which
  yields the floor `0.5` for removal — safe but flat).
- `crate::policies::hand_disruption::disruption_window_score` — returns
  `Option<f64>` for the reveal/discard branch (`unwrap_or(0.18)`). **Not yet
  ported.** Stub to `None` → constant `0.18` until ported.
- `engine::game::players` helper (opponent enumeration) → manabrew
  `game.player_order` (game.rs:117) filtered by `team_number`/`!= player`.

Port order: `cast_facts` → `eval` → `policies::hand_disruption` → `card_hints`.

---

## 5. Risks — adaptation vs infeasible

**Adaptation required (mechanical, low risk):**
1. **Typed `Effect` → `ApiType` + `ir`.** The single biggest delta. Every flag is
   re-expressed as an `api`/`ir` match (§2f). Risk is *coverage*: Phase's
   `SearchLibrary` and `Bounce` are not single verbs — they are `ChangeZone`
   with origin/destination discriminators (+ `Dig`/`Seek` family for search).
   Mis-mapping silently mis-classifies. Mitigate by unit-testing each predicate
   against representative card scripts.
2. **`AbilityKind` → bools.** `kind == Spell` → `sa.is_spell`. Trivial.
3. **`else_ability`/`mode_abilities` tree walk.** manabrew encodes else/modal via
   `ir.false_sub_ability`/`true_sub_ability`/`ir.mode` rather than dedicated
   fields. The recursive `collect_definition_effects` must walk these instead.
   For pure modal (charm) cards the alternatives may live behind SVar names not
   yet expanded (lazy-IR invariant, see forge-engine AGENTS §SVar) — a draft-time
   `from_face`-style full walk could under-count modal effects. In-game
   `CastFacts` is unaffected (the chosen mode's SA is present).
4. **`PlayLand` has no manabrew variant.** Land play is `CastSpell` of a land →
   replace the action match with `card.is_land()`.
5. **`ObjectId`/`card_id` split collapses.** `cast_object_for_action`'s
   filter+hand-fallback reduces to one `card()` lookup; faithful behaviour
   preserved, code simplifies.
6. **`effect_requires_targets`** (a 25-arm per-effect match incl. the
   non-targeted-Bounce CR-115.1 carve-out) collapses to
   `sa.target_restrictions.is_some()` — manabrew already resolves targeting at
   parse time, so the carve-out is automatic (a non-targeting bounce simply has
   no `target_restrictions`). This is *more* faithful, not less.

**Higher-risk / partially infeasible-as-written:**
7. **Trigger/replacement `execute` is a SVar name, not an ability tree**
   (trigger.rs:33, replacement params). Phase reads `trigger.execute` as an
   owned `Option<Box<AbilityDefinition>>` and walks it directly. manabrew must
   **build** the overriding `SpellAbility` from the SVar via
   `ability_factory::build_spell_ability_from_host_card` (ability_factory.rs:237)
   to inspect its `api`. This (a) needs `&GameState`/host card in scope
   (`cast_facts_for_object` must take `&GameState`, unlike Phase's free
   function), and (b) collides with the engine's *lazy SVar* discipline
   (forge-engine AGENTS: do not eagerly expand sub-ability chains). Mitigation:
   build the override SA only for the ≤handful of immediate-ETB triggers, on
   demand, cache nothing — acceptable for an AI read path but must be reviewed
   against the lazy-IR invariant.
8. **`ReplacementDefinition.execute` likewise** has no ready ability tree, and
   manabrew may lack a `ReplacementType::ChangeZone` distinct from `Moved`
   (verify replacement_type.rs). The `immediate_replacements` contribution to the
   profile is the weakest-grounded part; if the override-SA build is not wired,
   drop replacements from the profile (Phase's own doc-comment notes most
   face-level replacements wouldn't classify anyway).
9. **`Pump` P/T sign test.** Phase matches `PtValue::Fixed(power/toughness)`
   directly. manabrew stores pump amounts as `ir` text (`NumAtt`/`NumDef`,
   `AmountExpr`); non-literal (SVar/`Count$`) pumps can't be sign-tested at
   classify time → treat non-`Literal` as "not mass-shrink" (matches Phase, which
   only fires on `Fixed`).
10. **`eval`/`policies` deps absent.** `card_hints` cannot be behaviour-complete
    until `threat_level`/`evaluate_creature` and `disruption_window_score` are
    ported; the safe stubs above keep it compiling and conservative.

Nothing here is *fundamentally* infeasible on the Forge-DSL engine — the engine
exposes a richer classification surface (`ApiType` + `ir`) than Phase's flat
`Effect` enum. The cost is breadth (mapping each verb) and the
trigger/replacement `execute`-build wrinkle (#7/#8).
