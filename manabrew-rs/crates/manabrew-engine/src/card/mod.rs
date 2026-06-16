pub mod activation_table;
mod alt_costs;
mod card_assembly;
pub mod card_changed_words;
pub mod card_clone_states;
pub mod card_collection;
pub mod card_collection_view;
pub mod card_copy_service;
pub mod card_damage_history;
pub mod card_damage_map;
pub mod card_factory;
pub mod card_factory_util;
pub mod card_lists;
pub mod card_play_option;
pub mod card_predicates;
pub mod card_property;
pub mod card_state;
pub mod card_trait_changes;
pub mod card_util;
pub mod card_zone_table;
pub mod counter_enum_type;
pub mod counter_keyword_type;
pub mod counter_type;
pub mod damage_history;
pub mod filter_constants;
mod keyword_gen;
pub mod perpetual;
pub mod svar_cache;
pub mod token;
pub mod token_create_table;
pub mod trait_card_trait_changes;
pub mod valid_filter;
use crate::card::activation_table::ActivationTable;
use crate::core::HasSVars;
pub use counter_type::CounterType;

/// Type alias for the Keyword enum, used by keyword helper methods.
use crate::keyword::keyword_instance::Keyword as Kw;

// ── Keyword marker constants ──────────────────────────────────────────
// These are synthetic keywords injected at runtime to track card state.
// Using constants avoids magic strings scattered across the codebase.

/// Prefix for the Plotted marker. Full keyword is `"Plotted:{turn}"`.
/// The turn number prevents casting on the same turn the card was plotted.
pub const KEYWORD_PLOTTED_PREFIX: &str = "Plotted:";

/// Marker for cards exiled via Warp's end-of-turn trigger.
/// These cards can be cast from exile on a later turn for their normal mana cost.
pub const KEYWORD_WARP_EXILED: &str = "WarpExiled";

use std::collections::{BTreeMap, HashMap, HashSet};

use forge_carddb::CardRules;
use forge_foundation::{CardTypeLine, ColorSet, CoreType, ManaCost, ZoneType};
use serde::{Deserialize, Serialize};

use crate::ability::activated::{parse_activated_ability, ActivatedAbility};
use crate::card::perpetual::perpetual_record::PerpetualRecord;
use crate::card::svar_cache::{ParsedSVar, ParsedSVarCache};
use crate::cost::{parse_cost, Cost};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::{keys, parse_or_warn, Params, ParsedParams};
use crate::replacement::{parse_replacement_effect, ReplacementEffect};
use crate::spellability::{SpellAbility, TargetRestrictions};
use crate::staticability::{parse_static_ability, StaticAbility};
use crate::trigger::Trigger;

/// Build the full `"Plotted:{turn}"` keyword string.
fn colorless_color_set() -> ColorSet {
    ColorSet::COLORLESS
}

fn parse_literal_target_count(expr: &str) -> Option<i32> {
    if let Ok(n) = expr.trim().parse::<i32>() {
        return Some(n);
    }
    expr.trim().strip_prefix('+')?.parse::<i32>().ok()
}

pub fn make_plotted_keyword(turn: u32) -> String {
    format!("{}{}", KEYWORD_PLOTTED_PREFIX, turn)
}

/// Extract the turn number from a `"Plotted:{turn}"` keyword, if present.
pub fn parse_plotted_turn(kw: &str) -> Option<u32> {
    kw.strip_prefix(KEYWORD_PLOTTED_PREFIX)
        .and_then(|s| s.parse().ok())
}

/// Stores alternate-face characteristics for double-faced cards (DFCs).
/// The `transform()` method swaps `Card` fields with these values.
/// Mirrors Java's `CardState` stored as the "backside" state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardOtherPart {
    pub name: String,
    pub type_line: CardTypeLine,
    pub mana_cost: ManaCost,
    pub color: ColorSet,
    pub base_power: Option<i32>,
    pub base_toughness: Option<i32>,
    pub keywords: crate::keyword::keyword_collection::KeywordCollection,
    pub abilities: Vec<String>,
    pub triggers: Vec<Trigger>,
    pub static_abilities: Vec<crate::staticability::StaticAbility>,
    pub replacement_effects: Vec<crate::replacement::ReplacementEffect>,
    pub svars: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CardActionSpellSpec {
    pub ability_index: usize,
    pub has_valid_tgts: bool,
    pub cost_contains_x: bool,
    #[serde(default)]
    pub target_chain: Vec<CardActionTargetSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardActionTargetSpec {
    pub target_restrictions: TargetRestrictions,
    pub min_targets: Option<i32>,
}

/// When a `SP$ GainControl` steals a permanent, the revert trigger is stored
/// here. Fires during the appropriate phase or event handler, at which point
/// the card's `original_controller_eot` is restored.
///
/// Mirrors the subset of Java `ControlGainEffect.LoseControl$` variants that
/// schedule a `GameCommand`. Java also has variants we intentionally skip
/// here (`StaticCommandCheck` driven by an SVar comparator, `UntilSourceUnattached`,
/// `UntilTheEndOfYourNextTurn`) — they require either a scheduler that scans
/// every tick or a turn-owner counter that the engine doesn't maintain yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum_macros::EnumString)]
#[strum(ascii_case_insensitive)]
pub enum LoseControlCondition {
    /// Revert at the end of the current turn (default EOT branch).
    #[strum(serialize = "EOT", serialize = "UntilEOT", serialize = "EndOfTurn")]
    EndOfTurn,
    /// Revert the next time this card untaps.
    #[strum(serialize = "Untap", serialize = "UntilUntap", serialize = "NextUntap")]
    NextUntap,
    /// Revert at end of combat (Threaten-style steal-and-swing).
    EndOfCombat,
    /// Revert when the card leaves the battlefield.
    LeavesPlay,
}

/// Saved pre-animate state for AnimateEffect, restored at cleanup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimateState {
    pub original_type_line: CardTypeLine,
    pub original_base_power: Option<i32>,
    pub original_base_toughness: Option<i32>,
    pub original_color: ColorSet,
    /// Snapshot of intrinsic keywords before animate added any. Restored
    /// when the card leaves the battlefield (CR 400.7) so granted keywords
    /// (e.g. Animate `Keywords$ Haste`) do not persist into the new object.
    #[serde(default)]
    pub original_keywords: Option<crate::keyword::keyword_collection::KeywordCollection>,
}

/// Saved pre-clone copiable characteristics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloneState {
    #[serde(default)]
    pub expires_at_cleanup: bool,
    pub original_card_name: String,
    pub original_type_line: CardTypeLine,
    pub original_mana_cost: ManaCost,
    pub original_color: ColorSet,
    pub original_base_power: Option<i32>,
    pub original_base_toughness: Option<i32>,
    pub original_keywords: crate::keyword::keyword_collection::KeywordCollection,
    pub original_abilities: Vec<String>,
    pub original_activated_abilities: Vec<ActivatedAbility>,
    pub original_triggers: Vec<Trigger>,
    pub original_svars: BTreeMap<String, String>,
    pub original_static_abilities: Vec<StaticAbility>,
    pub original_replacement_effects: Vec<ReplacementEffect>,
    /// Intrinsic ability count *before* the clone overwrote it. The static
    /// layer truncates `activated_abilities` to `base_ability_count` each
    /// pass, so reverting `activated_abilities` without also restoring this
    /// would let the layer trim the recovered abilities right back to the
    /// clone's count.
    #[serde(default)]
    pub original_base_ability_count: usize,
    /// Intrinsic trigger count *before* the clone, for the same reason.
    #[serde(default)]
    pub original_base_trigger_count: usize,
}

/// A card instance in a game. This is the mutable game-state representation,
/// as opposed to CardRules which is the immutable definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: CardId,
    /// The card's active face name (front face for single/split cards, active face for DFC).
    /// On the battlefield, this is the name that's displayed.
    pub card_name: String,
    /// The full combined name for split/room cards (e.g. "Walk-In Closet // Forgotten Cellar").
    /// For non-split cards, this equals `card_name`. Used for hand/graveyard display and
    /// database lookups.
    pub full_name: String,

    // Ownership and control
    pub owner: PlayerId,
    pub controller: PlayerId,

    // Current zone
    pub zone: ZoneType,

    // Type line (can be modified by effects)
    pub type_line: CardTypeLine,

    // Mana cost (can be modified)
    pub mana_cost: ManaCost,

    // Color (can be modified)
    pub color: ColorSet,

    /// Immutable color identity from the card's rules (CR 903.4): mana cost
    /// colors plus any mana symbols found in the oracle text (outside reminder
    /// text). Used for commander color-identity checks and Combo ColorIdentity
    /// mana productions. Mirrors Java `CardRules.getColorIdentity()`.
    #[serde(default = "colorless_color_set")]
    pub color_identity: ColorSet,

    // Power/Toughness (base values, can be modified)
    pub base_power: Option<i32>,
    pub base_toughness: Option<i32>,
    /// Printed starting loyalty for planeswalkers.
    pub initial_loyalty: Option<String>,
    /// Temporary P/T modifications from spells/abilities resolving this turn
    /// (e.g. Giant Growth).  Reset when leaving the battlefield.
    pub power_modifier: i32,
    pub toughness_modifier: i32,
    /// Perpetual P/T modifications — persist across zone changes (never reset).
    /// Applied by `PumpAll` / `Pump` effects with `Duration$ Perpetual`.
    pub perpetual_power_modifier: i32,
    pub perpetual_toughness_modifier: i32,
    /// Java-parity storage of all perpetual effect records applied to this card.
    #[serde(default)]
    pub perpetual: Vec<PerpetualRecord>,
    /// Layer 7b override: set by `SetPower$` / `SetToughness$` continuous effects.
    /// `None` means use `base_power` / `base_toughness` as normal.
    /// Reset to `None` each time [`layer::apply_continuous_effects`] runs.
    pub static_set_power: Option<i32>,
    pub static_set_toughness: Option<i32>,
    /// Layer 7c bonus: accumulated from `AddPower$` / `AddToughness$` anthems.
    /// Reset to 0 each time [`layer::apply_continuous_effects`] runs.
    pub static_power_modifier: i32,
    pub static_toughness_modifier: i32,

    // Combat/state
    pub tapped: bool,
    /// Mana atoms produced the last time this land was tapped for mana.
    /// Used for mana rollback — when untapping, remove exactly this mana from pool.
    /// Covers base production + aura triggers + static doublers + any other source.
    #[serde(skip)]
    pub last_mana_produced: Option<Vec<u16>>,
    pub flipped: bool,
    pub face_down: bool,
    /// True if this card has Morph or Megamorph and can be cast face-down for {3}.
    pub has_morph: bool,
    /// True if this card was discarded (CR 400.7k, for TrackDiscarded$ effects).
    pub discarded: bool,
    /// True if this card was unearthed (should be exiled at EOT or if leaving battlefield).
    pub unearthed: bool,
    /// Class enchantment level (1 = base, 2+ = leveled up).
    pub class_level: i32,
    /// Soulbond: paired creature (if any).
    pub paired_with: Option<CardId>,
    /// True if this card was manifested (face-down as 2/2 creature).
    pub manifested: bool,
    /// True if this card was cloaked (face-down with ward {2}).
    pub cloaked: bool,
    /// True if this card was foretold (exiled face-down via Foretell).
    pub foretold: bool,
    /// Other card(s) melded/merged with this one. When this card changes zones,
    /// all melded parts move together (CR 712.4).
    pub melded_with: Vec<CardId>,
    /// True if foretold cost was set by an effect (not the card's own Foretell ability).
    pub foretold_cost_by_effect: bool,
    /// True if this card is currently bestowed (attached as an Aura via Bestow).
    pub is_bestowed: bool,
    pub summoning_sick: bool,
    #[serde(default)]
    pub came_under_control_since_last_upkeep: bool,
    pub exerted: bool,
    pub damage: i32,
    /// Zone the card was cast from (mirrors Java `Card.castFrom`). `Some` only
    /// while the card represents a spell that was actually cast — set during
    /// cast resolution, cleared on every zone change so the next "object" the
    /// card becomes (CR 400.7) starts with no cast history. Used by
    /// `wasCast`/`wasCastByYou` valid filters (e.g. Sunderflock's ETB).
    pub cast_from: Option<ZoneType>,

    // Counters
    pub counters: BTreeMap<CounterType, i32>,

    // Keywords intrinsic to this card (from its card definition).
    // Now stored as a `KeywordCollection` for structured typed lookups.
    pub keywords: crate::keyword::keyword_collection::KeywordCollection,
    /// Keywords granted by continuous static effects (Layer 6).
    /// Reset and recomputed each time [`layer::apply_continuous_effects`] runs.
    pub granted_keywords: crate::keyword::keyword_collection::KeywordCollection,
    /// SVars supplied by granted text (e.g. AddTrigger$/AddAbility$).
    /// Reset and recomputed each time [`layer::apply_continuous_effects`] runs.
    #[serde(default)]
    pub granted_svars: BTreeMap<String, String>,
    /// Type tokens added by continuous static effects (Layer 4, `AddType$`).
    /// Reset and recomputed each time [`layer::apply_continuous_effects`] runs.
    /// The listed strings may be supertypes, core card types, or subtypes;
    /// keeping a separate list lets us revert on reset without losing the
    /// card's intrinsic type line.
    pub static_added_subtypes: Vec<String>,
    #[serde(skip)]
    pub static_type_line_base: Option<CardTypeLine>,
    #[serde(skip)]
    pub changed_type_line_base: Option<CardTypeLine>,
    #[serde(skip)]
    pub changed_base_power: Option<Option<i32>>,
    #[serde(skip)]
    pub changed_base_toughness: Option<Option<i32>>,
    /// Keywords granted temporarily by pump effects (`KW$` parameter) until end of turn.
    /// Cleared during step_cleanup alongside power_modifier / toughness_modifier.
    pub pump_keywords: crate::keyword::keyword_collection::KeywordCollection,
    /// Number of triggers added temporarily by `DB$ Animate | Triggers$` effects.
    /// At cleanup, this many triggers are popped from the end of the `triggers` vec.
    pub pump_trigger_count: usize,

    // Abilities (raw strings from card definition)
    pub abilities: Vec<String>,
    /// Prebound SP$ ability metadata used by action-space filters.
    #[serde(default)]
    pub action_spell_specs: Vec<CardActionSpellSpec>,
    /// Prebound first SP$ Cost used by action-space non-mana cost checks.
    #[serde(default)]
    pub action_spell_cost: Option<Cost>,
    /// Prebound AIPhyrexianPayment$ policy from printed ability text.
    #[serde(default)]
    pub ai_phyrexian_payment: Option<String>,
    /// Prebound minimum Spree mode cost from Choices$ -> SVar ModeCost$.
    #[serde(default)]
    pub spree_min_mode_cost: Option<i32>,

    // Parsed activated abilities (from AB$ lines in abilities)
    pub activated_abilities: Vec<ActivatedAbility>,
    /// Number of base activated abilities (before continuous effects add more via AddAbility$).
    /// Used by `apply_continuous_effects` to truncate granted abilities on reset.
    pub base_ability_count: usize,
    /// Number of base triggers (before continuous effects add more via AddTrigger$).
    /// Used by `apply_continuous_effects` to truncate granted triggers on reset.
    pub base_trigger_count: usize,
    /// Applied card-trait mutation layers keyed by (timestamp, static_id).
    /// Mirrors Java `changedCardTraits` table.
    pub changed_card_traits:
        std::collections::BTreeMap<(i64, i64), card_trait_changes::CardTraitChanges>,
    /// Text-layer trait changes keyed by (timestamp, static_id).
    /// Mirrors Java `changedCardTraitsByText` table.
    pub changed_card_traits_by_text:
        std::collections::BTreeMap<(i64, i64), card_trait_changes::CardTraitChanges>,

    /// Parsed static abilities (from S$ lines in abilities).
    /// Mirrors Java Forge `Card.getStaticAbilities()`.
    pub static_abilities: Vec<StaticAbility>,

    // Combat tracking
    pub has_deathtouch_damage: bool,
    /// Set by `Mode$ CantAttack` static effects. Reset each time
    /// [`layer::apply_continuous_effects`] runs.
    pub cant_attack_static: bool,
    /// Set by `Mode$ CantBlock` static effects. Reset each time
    /// [`layer::apply_continuous_effects`] runs.
    pub cant_block_static: bool,

    // Turn tracking
    #[serde(default)]
    pub turn_in_zone: u32,
    pub entered_battlefield_this_turn: bool,
    pub attacked_this_turn: bool,
    /// Snapshot of whether this permanent was tapped at the start of its
    /// controller's current turn (before untap step).
    pub started_turn_tapped: bool,

    // Triggers — mirrors Java Card.getTriggers()
    pub triggers: Vec<Trigger>,
    // SVars — mirrors Java Card.getSVars()
    pub svars: BTreeMap<String, String>,
    #[serde(skip, default)]
    pub parsed_svar_cache: ParsedSVarCache,

    // Commander tracking
    /// True if this card is designated as a commander.
    pub is_commander: bool,
    /// True if this commander entered graveyard or exile since the last SBA check
    /// and may still be moved to the command zone.
    pub move_to_command_zone: bool,
    /// How many times this commander has been cast from the command zone (for tax).
    pub commander_cast_count: u32,

    /// True if this permanent is a token or a copy-token (ceases to exist on zone change).
    pub is_token: bool,

    /// Set when the card is cast from graveyard via Flashback. Used by the
    /// flashback replacement effect to exile the card when it leaves the stack.
    pub cast_with_flashback: bool,
    /// Set when the card is cast from graveyard via Harmonize. Used by the
    /// Harmonize replacement effect to exile the card when it leaves the stack.
    pub cast_with_harmonize: bool,

    // Replacement effects — parsed from R$ lines in card abilities.
    // Mirrors Java `Card.getReplacementEffects()`.
    pub replacement_effects: Vec<ReplacementEffect>,

    // Attachment tracking (Auras / Equipment).
    // Mirrors Java `Card.getAttachedTo()` / `Card.getAttachedCards()`.
    /// The permanent this card is currently attached to (for Auras/Equipment).
    pub attached_to: Option<CardId>,
    pub attached_to_player: Option<PlayerId>,
    /// Whether this equipment was attached/moved this turn (AI memory to prevent ping-ponging).
    /// Cleared at start of each turn. Mirrors Java `AiCardMemory.MemorySet.ATTACHED_THIS_TURN`.
    pub attached_this_turn: bool,
    /// Cards currently attached to this permanent (inverse of `attached_to`).
    pub attachments: Vec<CardId>,

    // Memory for "Remember" and "Imprint" parameters
    /// Cards remembered by this card (for RememberCountered, etc.)
    pub remembered_cards: Vec<CardId>,
    /// Players remembered by this card (for Player.IsRemembered checks).
    pub remembered_players: Vec<PlayerId>,
    /// Cards imprinted on this card (for Imprint mechanic, e.g. Chrome Mox).
    pub imprinted_cards: Vec<CardId>,
    /// Cards associated via gain-control effects.
    pub gain_control_targets: Vec<CardId>,
    /// Cards linked by "until leaves battlefield" tracking.
    pub until_leaves_battlefield: Vec<CardId>,
    /// Cards exiled by this card/effect.
    pub exiled_cards: Vec<CardId>,
    /// Cards exiled specifically to pay this card's current activation/cast cost.
    /// This is reset at the start of each cost payment attempt.
    pub paid_cost_exiled_cards: Vec<CardId>,
    /// Cards haunting this card.
    pub haunted_by: Vec<CardId>,
    /// Card currently haunted by this card.
    pub haunting: Option<CardId>,
    /// Per-player chosen card map.
    pub chosen_map: HashMap<PlayerId, Vec<CardId>>,
    /// CMC values remembered by this card
    pub remembered_cmc: Vec<i32>,
    /// Source card that created this effect card (for Card.EffectSource checks).
    pub effect_source: Option<CardId>,
    #[serde(default)]
    pub clone_origin: Option<CardId>,
    #[serde(default)]
    pub copied_permanent: Option<CardId>,
    /// The spell ability used to cast this card instance onto the stack.
    /// Mirrors Java `Card.getCastSA()`. Populated when the card hits the stack,
    /// cleared when it leaves the battlefield.
    #[serde(skip, default)]
    pub cast_sa: Option<Box<SpellAbility>>,
    /// For `SP$ Charm`: last turn each mode (keyed by its SVar name) was chosen
    /// on this card instance. Feeds `ChoiceRestriction$` filtering.
    /// Mirrors the per-card mode history Java keeps on `Card`.
    #[serde(default)]
    pub chosen_charm_modes: HashMap<String, i32>,
    /// LKI (last-known-information) snapshots of cards remembered by this
    /// card via `RememberLKI$`. Each entry is a frozen copy taken at remember
    /// time via `CardCopyService::get_lki_copy`. Callers that care about
    /// "what was this creature when it died" query this list instead of
    /// `remembered_cards` (which stores live IDs and drifts).
    #[serde(skip, default)]
    pub remembered_lki_cards: Vec<Card>,
    /// When set, the card's `original_controller_eot` must be restored on the
    /// trigger described here. Mirrors the Java `ControlGainEffect` set of
    /// `LoseControl$` variants that register distinct GameCommands.
    #[serde(default)]
    pub lose_control_condition: Option<LoseControlCondition>,
    /// True if this temporary effect expires at end of turn cleanup.
    pub temp_effect_until_eot: bool,
    /// Host card this temporary effect is linked to; when host leaves the
    /// battlefield, this effect expires.
    pub temp_effect_host: Option<CardId>,
    /// Forget remembered cards when they move from this origin zone.
    pub forget_on_moved_origin: Option<ZoneType>,
    /// Exile this effect when remembered cards become empty after forget logic.
    pub exile_when_no_remembered: bool,
    /// When this card is in exile, the card that caused it to be exiled here.
    /// Used for `Duration$ UntilHostLeavesPlay` effects (e.g. Deputy of Detention):
    /// when `exiled_by` leaves the battlefield, this card returns to its owner's battlefield.
    pub exiled_by: Option<CardId>,

    /// Original controller to restore at end of turn (for `LoseControl$ EOT`).
    pub original_controller_eot: Option<PlayerId>,

    // Double-faced card (DFC) state
    /// True if this card is currently showing its back face.
    pub is_transformed: bool,
    /// Back-face characteristics for DFC cards. `None` for single-faced cards.
    pub other_part: Option<CardOtherPart>,

    /// Optional set code (e.g., "M21") for specific printings.
    pub set_code: Option<String>,

    /// Optional collector number within a set (e.g., "1", "42").
    /// For tokens, this is the token's collector number in the token set
    /// (e.g., collector "1" in set "THOU" for Adorned Pouncer token).
    pub card_number: Option<String>,

    #[serde(default)]
    pub paper_foil: bool,

    // Phase-out state (issue #22, Phases effect).
    pub phased_out: bool,

    // Regeneration shields (issue #22, Regenerate effect).
    // Decremented instead of destroying; resets at end of turn.
    pub regeneration_shields: i32,

    /// Whether this permanent was kicked when cast.
    /// Mirrors Java `Card.isKicked()`. Stored on the card so triggers
    /// with `ValidCard$ Card.Self+kicked` can check it after resolution.
    pub kicked: bool,
    /// Whether this permanent has become monstrous.
    /// Mirrors Java `Card.isMonstrous()`. Resets when the permanent changes zones.
    pub monstrous: bool,

    /// Colors chosen by ChooseColorEffect (stored for later reference by other effects).
    pub chosen_colors: Vec<String>,
    /// Cards chosen by ChooseCardEffect (stored for later reference by other effects).
    pub chosen_cards: Vec<CardId>,

    /// Saved state for AnimateEffect — restored during step_cleanup.
    pub animate_state: Option<AnimateState>,
    /// Saved state for temporary Clone effects — restored during step_cleanup.
    pub clone_state: Option<CloneState>,

    // ── Issue #53: High-priority effect fields ──────────────────────────
    /// Type chosen by ChooseType effect (e.g. "Goblin", "Artifact").
    pub chosen_type: Option<String>,
    /// Secondary chosen type used by a subset of cards (e.g. Illusionary Terrain).
    pub chosen_type2: Option<String>,
    /// Noted types tracked by effects that accumulate type names.
    pub noted_types: Vec<String>,
    /// Card names chosen by NameCard effect.
    pub named_cards: Vec<String>,
    /// Number chosen by ChooseNumber effect.
    pub chosen_number: Option<i32>,
    /// Player chosen by ChoosePlayer effect.
    pub chosen_player: Option<PlayerId>,
    /// Controller who made the chosen-player choice.
    pub chosen_player_controller: Option<PlayerId>,
    /// Controller who made the chosen-type choice.
    pub chosen_type_controller: Option<PlayerId>,
    /// Whether the chosen player has been revealed.
    pub chosen_player_revealed: bool,
    /// Whether the chosen type has been revealed.
    pub chosen_type_revealed: bool,
    /// Opponent chosen for PromiseGift cost.
    pub promised_gift: Option<PlayerId>,
    /// Attraction lights printed on the card face.
    pub attraction_lights: Vec<u32>,
    /// Attraction sector assignment.
    pub sector: Option<String>,
    /// Chosen sector before assignment effects resolve.
    pub chosen_sector: Option<String>,
    /// Contraption sprocket assignment.
    pub sprocket: i32,
    /// Chosen even/odd marker.
    pub chosen_even_odd: Option<String>,
    /// True if detained — can't attack, block, or activate abilities. Clears at controller's next turn.
    pub detained: bool,
    /// Set during combat to the player this creature is attacking; None if not attacking.
    pub attacking_player: Option<PlayerId>,
    /// Player who goaded this creature. Goaded creature must attack but can't attack goader.
    pub goaded_by: Option<PlayerId>,
    /// Damage prevention shields (decremented when damage would be dealt). Resets at EOT.
    pub damage_prevention: i32,
    /// Damage assigned in current combat assignment step.
    pub assigned_damage: i32,
    /// True if this creature must block if able.
    pub must_block: bool,
    /// Spell cards encoded/ciphered onto this creature.
    pub encoded_cards: Vec<CardId>,
    /// Cards that dealt damage to this creature this turn (for DamagedBy trigger filters).
    /// Mirrors Java `CardDamageHistory.getDamageReceivedThisTurn()`.
    pub damage_sources_this_turn: Vec<CardId>,
    /// Total damage dealt by this card this turn (for Count$TotalDamageDoneByThisTurn).
    /// Mirrors Java `Card.getTotalDamageDoneBy()` via `DamageHistory.getDamageDoneThisTurn()`.
    /// Reset each turn in `new_turn()`.
    pub total_damage_done_this_turn: i32,
    /// Last-known information: power when this card last left the battlefield.
    /// Mirrors Java's LKI system for `TriggeredCard$CardPower`.
    /// `None` means LKI was never captured; `Some(0)` means power was 0.
    pub lki_power: Option<i32>,
    /// Last-known information: toughness when this card last left the battlefield.
    /// `None` means LKI was never captured; `Some(0)` means toughness was 0.
    pub lki_toughness: Option<i32>,
    /// Last-known information: counters when this card last left the battlefield.
    /// Used by `TriggeredCard$CardCounters.TYPE` (e.g. Servant of the Scale death trigger).
    pub lki_counters: Option<std::collections::BTreeMap<CounterType, i32>>,
    /// Damage history tracking (attacks, blocks, damage dealt).
    /// Mirrors Java `CardDamageHistory`.
    #[serde(skip)]
    pub damage_history: damage_history::DamageHistory,
    /// Specific cards this creature must block (set by effects like Lure variants).
    pub must_block_cards: Vec<CardId>,
    /// +1/+1 counters to add on ETB (from mana that adds counters, e.g. Guildmages' Forum).
    pub etb_counters_p1p1: i32,
    /// Bitmask of colors of mana spent to cast this spell (for Sunburst/Converge).
    /// Uses ManaAtom bit flags (W=1, U=2, B=4, R=8, G=16).
    pub colors_spent_to_cast: u16,
    /// Exact mana atoms spent to cast this spell, in payment order.
    /// Mirrors Java's castSA.getPayingMana() use sites such as Adamant.
    pub paying_mana_to_cast: Vec<u16>,
    /// Pre-selected charm/mode indices (for Spree — modes chosen before payment).
    /// If `Some`, charm_effect should use these instead of asking the player again.
    pub chosen_modes: Option<Vec<usize>>,
    /// Number of extra targets paid for via Strive (0 = no extra targets).
    pub strive_extra_targets: u32,
    /// Tracks if this card became a target this turn.
    pub became_target_this_turn: bool,
    /// Temporary controllers layered on this card.
    pub temp_controllers: Vec<PlayerId>,
    /// Players that may look at this card.
    pub may_look_at: Vec<PlayerId>,
    /// Players that may play this card.
    pub may_play: Vec<PlayerId>,
    /// Additional blockers this creature can declare.
    pub can_block_additional: i32,
    /// Whether this creature can block any number of creatures.
    pub can_block_any: bool,
    /// Keywords this card is prevented from having.
    pub cant_have_keywords: HashSet<String>,
    /// Intensity marker value.
    pub intensity: i32,
    /// Card was surveilled this turn.
    pub surveilled: bool,
    /// Card was milled this turn.
    pub milled: bool,
    /// Attraction visited this turn.
    pub visited_this_turn: bool,
    /// Number of times this permanent has crewed this turn.
    pub times_crewed_this_turn: u32,
    /// Whether this permanent is currently crewed.
    pub is_crewed: bool,
    /// Whether this card should ignore legend rule checks.
    pub ignore_legend_rule_flag: bool,
    /// Ability activation counts this turn.
    pub ability_activated_this_turn: u32,
    /// Ability resolution counts this turn.
    pub ability_resolved_this_turn: u32,
    /// Java parity: per-ability activation tracking this turn.
    #[serde(skip)]
    pub number_turn_activations: ActivationTable,
    /// Java parity: per-ability activation tracking this game.
    #[serde(skip)]
    pub number_game_activations: ActivationTable,
    /// Java parity: per-ability resolution tracking this turn.
    #[serde(skip)]
    pub number_ability_resolved: ActivationTable,
    /// Planeswalker activation count this turn.
    pub planeswalker_abilities_activated: u32,
    /// Whether a static effect's increased planeswalker activation limit was used this turn.
    pub planeswalker_activation_limit_used: bool,
    /// Chosen mode count tracking turn marker.
    pub chosen_modes_turn: Option<u32>,
    /// Set when this creature enlisted another creature in the current combat.
    pub enlisted_this_combat: bool,
    /// Per-ability activation count this game (for PowerUp once-per-game restriction).
    pub activations_this_game: std::collections::BTreeMap<usize, u32>,
    /// True once Renown has triggered (creature dealt combat damage to a player).
    /// Mirrors Java `Card.isRenowned()`.
    pub is_renowned: bool,
    /// Monotonically increasing timestamp set each time the card enters a zone.
    /// Used to order same-player triggers by zone entry order, matching
    /// Java's `Zone.cardList` insertion order used by `forEachCardInGame`.
    pub zone_timestamp: u64,

    /// Baseline snapshots used to recompute live lists when trait-change layers
    /// are removed/cleared.
    #[serde(skip)]
    trait_base_activated_abilities: Option<Vec<ActivatedAbility>>,
    #[serde(skip)]
    trait_base_triggers: Option<Vec<Trigger>>,
    #[serde(skip)]
    trait_base_replacement_effects: Option<Vec<ReplacementEffect>>,
    #[serde(skip)]
    trait_base_static_abilities: Option<Vec<StaticAbility>>,
    #[serde(skip)]
    trait_base_keywords: Option<crate::keyword::keyword_collection::KeywordCollection>,
}

/// Transitional alias for downstream code still importing `CardInstance`.
pub type CardInstance = Card;

impl Card {
    pub fn new(
        id: CardId,
        card_name: String,
        owner: PlayerId,
        type_line: CardTypeLine,
        mana_cost: ManaCost,
        color: ColorSet,
        base_power: Option<i32>,
        base_toughness: Option<i32>,
        keywords: Vec<String>,
        abilities: Vec<String>,
    ) -> Self {
        // Parse activated abilities from raw ability strings.
        let activated_abilities: Vec<ActivatedAbility> = abilities
            .iter()
            .enumerate()
            .filter_map(|(i, raw)| {
                parse_or_warn(parse_activated_ability(raw, i), "ActivatedAbility", raw)
            })
            .collect();

        // Parse replacement effects from R$ lines in card abilities.
        // Mirrors Java Card constructor calling ReplacementHandler registration.
        let replacement_effects: Vec<ReplacementEffect> = abilities
            .iter()
            .filter_map(|raw| {
                parse_or_warn(parse_replacement_effect(raw), "ReplacementEffect", raw)
            })
            .collect();

        // Parse static abilities from S$ lines.
        // Mirrors Java Forge Card constructor calling StaticAbility.create().
        let static_abilities: Vec<StaticAbility> = abilities
            .iter()
            .filter_map(|raw| parse_or_warn(parse_static_ability(raw), "StaticAbility", raw))
            .collect();

        let full_name = card_name.clone();
        let color_identity = color;
        let mut card = Card {
            id,
            card_name,
            full_name,
            owner,
            controller: owner,
            zone: ZoneType::None,
            type_line,
            mana_cost,
            color,
            color_identity,
            base_power,
            base_toughness,
            initial_loyalty: None,
            power_modifier: 0,
            toughness_modifier: 0,
            perpetual_power_modifier: 0,
            perpetual_toughness_modifier: 0,
            perpetual: Vec::new(),
            static_set_power: None,
            static_set_toughness: None,
            static_power_modifier: 0,
            static_toughness_modifier: 0,
            tapped: false,
            last_mana_produced: None,
            flipped: false,
            face_down: false,
            has_morph: false,
            discarded: false,
            unearthed: false,
            class_level: 1,
            paired_with: None,
            manifested: false,
            cloaked: false,
            foretold: false,
            foretold_cost_by_effect: false,
            melded_with: Vec::new(),
            is_bestowed: false,
            summoning_sick: true,
            came_under_control_since_last_upkeep: false,
            exerted: false,
            damage: 0,
            cast_from: None,
            counters: BTreeMap::new(),
            keywords: crate::keyword::keyword_collection::KeywordCollection::from_strings(
                &keywords,
            ),
            granted_keywords: crate::keyword::keyword_collection::KeywordCollection::new(),
            granted_svars: BTreeMap::new(),
            static_added_subtypes: Vec::new(),
            static_type_line_base: None,
            changed_type_line_base: None,
            changed_base_power: None,
            changed_base_toughness: None,
            pump_keywords: crate::keyword::keyword_collection::KeywordCollection::new(),
            pump_trigger_count: 0,
            abilities,
            action_spell_specs: Vec::new(),
            action_spell_cost: None,
            ai_phyrexian_payment: None,
            spree_min_mode_cost: None,
            activated_abilities,
            base_ability_count: 0,
            base_trigger_count: 0,
            changed_card_traits: std::collections::BTreeMap::new(),
            changed_card_traits_by_text: std::collections::BTreeMap::new(),
            static_abilities,
            has_deathtouch_damage: false,
            cant_attack_static: false,
            cant_block_static: false,
            turn_in_zone: 0,
            entered_battlefield_this_turn: false,
            attacked_this_turn: false,
            started_turn_tapped: false,
            triggers: Vec::new(),
            svars: BTreeMap::new(),
            parsed_svar_cache: ParsedSVarCache::default(),
            is_commander: false,
            move_to_command_zone: false,
            commander_cast_count: 0,
            is_token: false,
            cast_with_flashback: false,
            cast_with_harmonize: false,
            replacement_effects,
            attached_to: None,
            attached_to_player: None,
            attached_this_turn: false,
            attachments: Vec::new(),
            remembered_cards: Vec::new(),
            remembered_players: Vec::new(),
            imprinted_cards: Vec::new(),
            gain_control_targets: Vec::new(),
            until_leaves_battlefield: Vec::new(),
            exiled_cards: Vec::new(),
            paid_cost_exiled_cards: Vec::new(),
            haunted_by: Vec::new(),
            haunting: None,
            chosen_map: HashMap::new(),
            remembered_cmc: Vec::new(),
            effect_source: None,
            clone_origin: None,
            copied_permanent: None,
            cast_sa: None,
            chosen_charm_modes: HashMap::new(),
            remembered_lki_cards: Vec::new(),
            lose_control_condition: None,
            temp_effect_until_eot: false,
            temp_effect_host: None,
            forget_on_moved_origin: None,
            exile_when_no_remembered: false,
            exiled_by: None,
            original_controller_eot: None,
            is_transformed: false,
            other_part: None,
            set_code: None,
            card_number: None,
            paper_foil: false,
            phased_out: false,
            regeneration_shields: 0,
            kicked: false,
            monstrous: false,
            chosen_colors: Vec::new(),
            chosen_cards: Vec::new(),
            animate_state: None,
            clone_state: None,
            chosen_type: None,
            chosen_type2: None,
            noted_types: Vec::new(),
            named_cards: Vec::new(),
            chosen_number: None,
            chosen_player: None,
            chosen_player_controller: None,
            chosen_type_controller: None,
            chosen_player_revealed: false,
            chosen_type_revealed: false,
            promised_gift: None,
            attraction_lights: Vec::new(),
            sector: None,
            chosen_sector: None,
            sprocket: 0,
            chosen_even_odd: None,
            detained: false,
            attacking_player: None,
            goaded_by: None,
            damage_prevention: 0,
            assigned_damage: 0,
            must_block: false,
            encoded_cards: Vec::new(),
            damage_sources_this_turn: Vec::new(),
            total_damage_done_this_turn: 0,
            lki_power: None,
            lki_toughness: None,
            lki_counters: None,
            damage_history: damage_history::DamageHistory::default(),
            must_block_cards: Vec::new(),
            etb_counters_p1p1: 0,
            colors_spent_to_cast: 0,
            paying_mana_to_cast: Vec::new(),
            chosen_modes: None,
            strive_extra_targets: 0,
            became_target_this_turn: false,
            temp_controllers: Vec::new(),
            may_look_at: Vec::new(),
            may_play: Vec::new(),
            can_block_additional: 0,
            can_block_any: false,
            cant_have_keywords: HashSet::new(),
            intensity: 0,
            surveilled: false,
            milled: false,
            visited_this_turn: false,
            times_crewed_this_turn: 0,
            is_crewed: false,
            ignore_legend_rule_flag: false,
            ability_activated_this_turn: 0,
            ability_resolved_this_turn: 0,
            number_turn_activations: ActivationTable::default(),
            number_game_activations: ActivationTable::default(),
            number_ability_resolved: ActivationTable::default(),
            planeswalker_abilities_activated: 0,
            planeswalker_activation_limit_used: false,
            chosen_modes_turn: None,
            enlisted_this_combat: false,
            activations_this_game: std::collections::BTreeMap::new(),
            is_renowned: false,
            zone_timestamp: 0,
            trait_base_activated_abilities: None,
            trait_base_triggers: None,
            trait_base_replacement_effects: None,
            trait_base_static_abilities: None,
            trait_base_keywords: None,
        };

        // Generate intrinsic abilities from card properties (mirrors Java CardFactoryUtil)
        card.generate_basic_land_mana_abilities();
        card.generate_keyword_abilities();
        card.generate_keyword_triggers();
        crate::card::card_state::update_types(&mut card);
        crate::card::card_state::update_keywords_cache(&mut card);
        crate::card::card_state::calculate_perpetual_adjusted_mana_cost(&mut card);
        card.refresh_action_specs();
        // Record base ability count so continuous effects can truncate granted abilities.
        card.base_ability_count = card.activated_abilities.len();
        card.base_trigger_count = card.triggers.len();
        card
    }

    pub fn clone_for_parity_snapshot(&self) -> Self {
        let mut out = self.clone();
        out.abilities.clear();
        out.activated_abilities.clear();
        out.triggers.clear();
        for static_ability in &mut out.static_abilities {
            static_ability.base = Box::new(crate::card_trait_base::CardTraitBase::default());
        }
        out.replacement_effects.clear();
        out.cast_sa = None;
        out.trait_base_activated_abilities = None;
        out.trait_base_triggers = None;
        out.trait_base_replacement_effects = None;
        out.trait_base_static_abilities = None;
        out.trait_base_keywords = None;
        out
    }

    /// Construct a `Card` from a `CardRules` definition.
    /// This is the single entry point for creating game-ready cards from the
    /// card database. Mirrors Java's `CardFactory.readCard()` + `CardFactoryUtil`.
    ///
    /// Handles:
    /// - Base stats (name, mana cost, type line, color, P/T, keywords, abilities)
    /// - Trigger parsing (T: lines) including SpellCastOrCopy → SpellCopied duplication
    /// - Static ability parsing (S: lines) with alternative cost keyword conversion
    /// - Replacement effect parsing (R: lines)
    /// - SVars
    /// - Double-faced card back face setup
    /// - Intrinsic mana abilities (basic land subtypes)
    /// - Keyword-generated abilities and triggers (Cycling, Prowess, Bushido)
    pub fn from_rules(rules: &CardRules, owner: PlayerId) -> Self {
        card_factory::build_from_rules(rules, owner)
    }

    /// Effective power, accounting for all layer effects and counters.
    ///
    /// Calculation order (CR 613):
    /// - Layer 7b: `static_set_power` overrides `base_power` if set.
    /// - Layer 7c: `static_power_modifier` (anthem bonuses) is added.
    /// - Temporary: `power_modifier` (from spells like Giant Growth) is added.
    /// - Layer 7d: +1/+1 and -1/-1 counters are factored in.
    pub fn power(&self) -> i32 {
        let base = self
            .static_set_power
            .unwrap_or(self.base_power.unwrap_or(0));
        base + self.static_power_modifier
            + self.power_modifier
            + self.perpetual_power_modifier
            + self.counter_count(&CounterType::P1P1)
            - self.counter_count(&CounterType::M1M1)
    }

    /// Effective toughness, accounting for all layer effects and counters.
    pub fn toughness(&self) -> i32 {
        let base = self
            .static_set_toughness
            .unwrap_or(self.base_toughness.unwrap_or(0));
        base + self.static_toughness_modifier
            + self.toughness_modifier
            + self.perpetual_toughness_modifier
            + self.counter_count(&CounterType::P1P1)
            - self.counter_count(&CounterType::M1M1)
    }

    pub fn lethal_damage(&self) -> bool {
        self.damage >= self.toughness()
    }

    pub fn can_be_dealt_damage(&self) -> bool {
        self.zone == ZoneType::Battlefield
            && (self.is_creature()
                || self.type_line.is_planeswalker()
                || self.type_line.core_types.contains(&CoreType::Battle))
    }

    pub fn is_creature(&self) -> bool {
        !self.is_bestowed && self.type_line.is_creature()
    }

    pub fn is_land(&self) -> bool {
        self.type_line.is_land()
    }

    pub fn is_permanent(&self) -> bool {
        self.type_line.is_permanent()
    }

    // CardState-style adapters wired on Card for Java-parity call sites.
    pub fn update_types(&mut self) {
        crate::card::card_state::update_types(self);
    }

    pub fn update_types_for_view(&mut self) {
        crate::card::card_state::update_types_for_view(self);
    }

    pub fn add_type(&mut self, ty: &str) {
        crate::card::card_state::add_type(self, ty);
        self.update_types();
        self.update_types_for_view();
    }

    pub fn remove_type(&mut self, ty: &str) {
        crate::card::card_state::remove_type(self, ty);
        self.update_types();
        self.update_types_for_view();
    }

    pub fn remove_card_types(&mut self) {
        crate::card::card_state::remove_card_types(self);
        self.update_types();
        self.update_types_for_view();
    }

    pub fn set_type(&mut self, type_line: &str) {
        crate::card::card_state::set_type(self, type_line);
        self.update_types();
        self.update_types_for_view();
    }

    pub fn set_type_line(&mut self, type_line: CardTypeLine) {
        self.type_line = type_line;
        self.update_types();
        self.update_types_for_view();
    }

    pub fn add_color(&mut self, color: ColorSet) {
        crate::card::card_state::add_color(self, color);
    }

    pub fn has_intrinsic_keyword(&self, keyword: &str) -> bool {
        crate::card::card_state::has_intrinsic_keyword(self, keyword)
    }

    pub fn add_intrinsic_keyword(&mut self, keyword: &str) -> bool {
        let changed = crate::card::card_state::add_intrinsic_keyword(self, keyword);
        if changed {
            crate::card::card_state::update_keywords_cache(self);
        }
        changed
    }

    pub fn add_intrinsic_keywords<'a>(
        &mut self,
        keywords: impl IntoIterator<Item = &'a str>,
    ) -> bool {
        let changed = crate::card::card_state::add_intrinsic_keywords(self, keywords);
        if changed {
            crate::card::card_state::update_keywords_cache(self);
        }
        changed
    }

    pub fn remove_intrinsic_keyword(&mut self, keyword: &str) -> bool {
        let changed = crate::card::card_state::remove_intrinsic_keyword(self, keyword);
        if changed {
            crate::card::card_state::update_keywords_cache(self);
        }
        changed
    }

    pub fn has_spell_ability(&self, sa: &SpellAbility) -> bool {
        crate::card::card_state::has_spell_ability(self, sa)
    }

    pub fn add_spell_ability(&mut self, sa: &SpellAbility) -> bool {
        let added = crate::card::card_state::add_spell_ability(self, sa);
        self.refresh_action_specs();
        added
    }

    pub fn has_trigger(&self, trigger_id: u32) -> bool {
        crate::card::card_state::has_trigger(self, trigger_id)
    }

    pub fn add_trigger(&mut self, trig: Trigger) -> bool {
        crate::card::card_state::add_trigger(self, trig)
    }

    pub fn clear_pump_triggers(&mut self) {
        let count = self.pump_trigger_count;
        if count == 0 {
            return;
        }
        let new_len = self
            .triggers
            .len()
            .saturating_sub(count)
            .max(self.base_trigger_count);
        self.triggers.truncate(new_len);
        self.pump_trigger_count = 0;
    }

    pub fn copiable_triggers(&self) -> Vec<Trigger> {
        self.trait_base_triggers
            .clone()
            .unwrap_or_else(|| self.triggers.clone())
    }

    pub fn copiable_replacement_effects(&self) -> Vec<ReplacementEffect> {
        self.trait_base_replacement_effects
            .clone()
            .unwrap_or_else(|| self.replacement_effects.clone())
    }

    pub fn add_static_ability(&mut self, st_ab: StaticAbility) -> bool {
        crate::card::card_state::add_static_ability(self, st_ab)
    }

    pub fn remove_static_ability(&mut self, mode: crate::staticability::StaticMode) -> bool {
        crate::card::card_state::remove_static_ability(self, mode)
    }

    pub fn add_replacement_effect(&mut self, re: ReplacementEffect) -> bool {
        crate::card::card_state::add_replacement_effect(self, re)
    }

    pub fn has_replacement_effect(&self) -> bool {
        crate::card::card_state::has_replacement_effect(self)
    }

    pub fn has_s_var(&self, key: &str) -> bool {
        crate::card::card_state::has_s_var(self, key)
    }

    pub fn get_s_var(&self, key: &str) -> Option<&str> {
        self.svars
            .get(key)
            .or_else(|| self.granted_svars.get(key))
            .map(String::as_str)
    }

    pub fn parsed_s_var(&mut self, key: &str) -> Option<ParsedSVar> {
        let raw = self.get_s_var(key)?.to_string();
        Some(self.parsed_svar_cache.get_or_parse(key, &raw).clone())
    }

    pub fn remove_s_var(&mut self, key: &str) {
        crate::card::card_state::remove_s_var(self, key);
        self.parsed_svar_cache.remove(key);
        self.refresh_action_specs_after_svar_change();
    }

    pub fn set_s_var(&mut self, key: impl Into<String>, value: impl Into<String>) {
        let key = key.into();
        self.parsed_svar_cache.remove(&key);
        self.svars.insert(key, value.into());
        self.refresh_action_specs_after_svar_change();
    }

    pub fn set_s_var_if_absent(&mut self, key: impl Into<String>, value: impl Into<String>) {
        let key = key.into();
        if self.svars.contains_key(&key) {
            return;
        }
        self.svars.insert(key, value.into());
        self.refresh_action_specs_after_svar_change();
    }

    pub fn set_svars_map(&mut self, svars: BTreeMap<String, String>) {
        self.svars = svars;
        self.parsed_svar_cache.clear();
        self.refresh_action_specs();
    }

    pub fn copy_from_card_state(&mut self, source: &Card) {
        crate::card::card_state::copy_from(source, self);
    }

    pub fn copy_from(&mut self, source: &Card) {
        self.copy_from_card_state(source);
    }

    pub fn add_abilities_from(&mut self, source: &Card) {
        crate::card::card_state::add_abilities_from(source, self);
    }

    pub fn has_property(&self, property: &str) -> bool {
        crate::card::card_state::has_property(self, property)
    }

    pub fn reset_original_host(&mut self) {
        crate::card::card_state::reset_original_host(self);
    }

    pub fn update_changed_text(&mut self) {
        crate::card::card_state::update_changed_text(self);
    }

    pub fn update_keywords_cache(&mut self) {
        crate::card::card_state::update_keywords_cache(self);
    }

    pub fn change_text_intrinsic(&mut self) {
        crate::card::card_state::change_text_intrinsic(self);
    }

    pub fn has_chapter(&self) -> bool {
        crate::card::card_state::has_chapter(self)
    }

    /// Check whether this card has a keyword — intrinsically, granted by a
    /// continuous static effect (Layer 6), or temporarily from a pump effect.
    /// Count distinct colors of mana spent to cast this spell (for Sunburst/Converge).
    pub fn sunburst_count(&self) -> i32 {
        use forge_foundation::mana::ManaAtom;
        let mut count = 0;
        for &bit in &[
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
        ] {
            if (self.colors_spent_to_cast & bit) != 0 {
                count += 1;
            }
        }
        count
    }

    pub fn has_keyword(&self, kw: &str) -> bool {
        crate::card::card_state::has_keyword(self, kw)
    }

    /// Check for a keyword using the typed Keyword enum.
    /// Checks the structured `keyword_collection` first (O(1) HashMap lookup),
    /// then falls back to string matching on granted/pump keywords.
    /// Mirrors Java's `Card.hasKeyword(Keyword)`.
    pub fn has_keyword_enum(&self, kw: Kw) -> bool {
        if self
            .cant_have_keywords
            .contains(&kw.display_name().to_ascii_lowercase())
        {
            return false;
        }
        self.keywords.contains_keyword(kw)
            || self.granted_keywords.contains_keyword(kw)
            || self.pump_keywords.contains_keyword(kw)
    }

    pub fn has_haste(&self) -> bool {
        self.has_keyword_enum(crate::keyword::keyword_instance::Keyword::Haste)
    }

    pub fn has_flying(&self) -> bool {
        self.has_keyword_enum(crate::keyword::keyword_instance::Keyword::Flying)
    }

    pub fn has_reach(&self) -> bool {
        self.has_keyword_enum(Kw::Reach)
    }

    pub fn has_first_strike(&self) -> bool {
        self.has_keyword_enum(Kw::FirstStrike)
    }

    pub fn has_double_strike(&self) -> bool {
        self.has_keyword_enum(Kw::DoubleStrike)
    }

    pub fn has_trample(&self) -> bool {
        self.has_keyword_enum(Kw::Trample)
    }

    pub fn has_deathtouch(&self) -> bool {
        self.has_keyword_enum(Kw::Deathtouch)
    }

    pub fn has_lifelink(&self) -> bool {
        self.has_keyword_enum(Kw::Lifelink)
    }

    pub fn has_vigilance(&self) -> bool {
        self.has_keyword_enum(Kw::Vigilance)
    }

    pub fn has_defender(&self) -> bool {
        self.has_keyword_enum(Kw::Defender)
    }

    pub fn has_hexproof(&self) -> bool {
        self.has_keyword_enum(Kw::Hexproof)
    }

    pub fn has_shroud(&self) -> bool {
        self.has_keyword_enum(Kw::Shroud)
    }

    pub fn has_menace(&self) -> bool {
        self.has_keyword_enum(Kw::Menace)
    }

    pub fn has_fear(&self) -> bool {
        self.has_keyword_enum(Kw::Fear)
    }

    pub fn has_intimidate(&self) -> bool {
        self.has_keyword_enum(Kw::Intimidate)
    }

    pub fn has_shadow(&self) -> bool {
        self.has_keyword_enum(Kw::Shadow)
    }

    pub fn has_skulk(&self) -> bool {
        self.has_keyword_enum(Kw::Skulk)
    }

    pub fn has_horsemanship(&self) -> bool {
        self.has_keyword_enum(Kw::Horsemanship)
    }

    pub fn has_indestructible(&self) -> bool {
        self.has_keyword_enum(Kw::Indestructible)
    }

    pub fn has_infect(&self) -> bool {
        self.has_keyword_enum(Kw::Infect)
    }

    pub fn has_wither(&self) -> bool {
        self.has_keyword_enum(Kw::Wither)
    }

    pub fn has_prowess(&self) -> bool {
        self.has_keyword_enum(Kw::Prowess)
    }

    pub fn has_rebound(&self) -> bool {
        self.has_keyword_enum(Kw::Rebound)
    }

    /// Check "Hexproof from <color>" variants (e.g. "Hexproof from blue").
    pub fn has_hexproof_from(&self, color: &str) -> bool {
        let target = format!("Hexproof from {}", color);
        self.keywords.contains_string_ignore_case(&target)
            || self.granted_keywords.contains_string_ignore_case(&target)
    }

    /// Get Toxic count (e.g. "Toxic:1" → Some(1)).
    pub fn get_toxic_count(&self) -> Option<i32> {
        self.get_keyword_cost("Toxic").and_then(|s| s.parse().ok())
    }

    /// Whether this card has the Storm keyword.
    pub fn has_storm(&self) -> bool {
        self.has_keyword_enum(Kw::Storm)
    }

    pub fn has_cascade(&self) -> bool {
        self.has_keyword_enum(Kw::Cascade)
    }

    /// Converted mana cost (mana value).
    pub fn mana_value(&self) -> i32 {
        self.mana_cost.cmc()
    }

    /// Check "Protection from <quality>" (e.g. "Protection from red").
    pub fn has_protection_from(&self, quality: &str) -> bool {
        let target = format!("Protection from {}", quality);
        self.keywords.contains_string_ignore_case(&target)
            || self.granted_keywords.contains_string_ignore_case(&target)
    }

    /// Get all "Protection from X" values this card has.
    pub fn get_protections(&self) -> Vec<String> {
        let mut prots = Vec::new();
        for kw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
        {
            if let Some(from) = kw.strip_prefix("Protection from ") {
                prots.push(from.to_lowercase());
            }
        }
        prots
    }

    /// Check if this card is protected from a source card.
    /// Protection from <color> checks source's color.
    /// Protection from <type> checks source's type (e.g. "artifacts", "creatures").
    pub fn is_protected_from(&self, source: &Card) -> bool {
        for prot in self.get_protections() {
            match prot.as_str() {
                "white" => {
                    if source.color.has_white() {
                        return true;
                    }
                }
                "blue" => {
                    if source.color.has_blue() {
                        return true;
                    }
                }
                "black" => {
                    if source.color.has_black() {
                        return true;
                    }
                }
                "red" => {
                    if source.color.has_red() {
                        return true;
                    }
                }
                "green" => {
                    if source.color.has_green() {
                        return true;
                    }
                }
                "colorless" => {
                    if source.color.is_colorless() {
                        return true;
                    }
                }
                "artifacts" => {
                    if source.type_line.is_artifact() {
                        return true;
                    }
                }
                "creatures" => {
                    if source.type_line.is_creature() {
                        return true;
                    }
                }
                "enchantments" => {
                    if source.type_line.is_enchantment() {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }

    pub fn can_attack(&self) -> bool {
        self.is_creature()
            && !self.tapped
            && !self.has_defender()
            && !self.cant_attack_static
            && !self.detained
            && (self.has_haste() || !self.summoning_sick)
            && self.zone == ZoneType::Battlefield
    }

    pub fn can_block(&self) -> bool {
        self.is_creature()
            && !self.tapped
            && !self.cant_block_static
            && !self.detained
            && self.zone == ZoneType::Battlefield
    }

    /// Check if this card can be controlled by the given player
    /// (e.g., checks for "Other players can't gain control of CARDNAME.")
    pub fn can_be_controlled_by(&self, player: PlayerId) -> bool {
        if player == self.controller {
            return true;
        }
        !self.has_keyword("Other players can't gain control of CARDNAME.")
    }

    pub fn counter_count(&self, ct: &CounterType) -> i32 {
        *self.counters.get(ct).unwrap_or(&0)
    }

    pub fn add_counter(&mut self, ct: &CounterType, count: i32) {
        let entry = self.counters.entry(ct.clone()).or_insert(0);
        *entry += count;
    }

    pub fn remove_counter(&mut self, ct: &CounterType, count: i32) {
        let entry = self.counters.entry(ct.clone()).or_insert(0);
        *entry = (*entry - count).max(0);
    }

    /// Reset state when entering the battlefield.
    pub fn enter_battlefield(&mut self) {
        self.tapped = false;
        self.damage = 0;
        self.summoning_sick = true;
        self.came_under_control_since_last_upkeep = true;
        self.has_deathtouch_damage = false;
        self.entered_battlefield_this_turn = true;
        self.attacked_this_turn = false;
        self.damage_sources_this_turn.clear();
    }

    /// Reset per-turn state at start of turn.
    pub fn clear_global_turn_state(&mut self) {
        self.entered_battlefield_this_turn = false;
        self.attacked_this_turn = false;
        self.attached_this_turn = false;
        self.has_deathtouch_damage = false;
        self.damage_sources_this_turn.clear();
        self.total_damage_done_this_turn = 0;
    }

    /// Reset controller-specific state at the start of that player's turn.
    pub fn new_turn(&mut self) {
        self.clear_global_turn_state();
        if self.zone == ZoneType::Battlefield {
            if let Ok(filter) = std::env::var("FORGE_CARD_TRACE") {
                if !filter.is_empty()
                    && self.card_name.eq_ignore_ascii_case(&filter)
                    && self.summoning_sick
                {
                    eprintln!(
                        "[card-trace] new_turn clears sickness on {}#{:?} (controller={:?})",
                        self.card_name, self.id, self.controller,
                    );
                }
            }
            self.summoning_sick = false;
        }
    }

    /// Add a remembered card (for RememberCountered, etc.)
    pub fn add_remembered_card(&mut self, card_id: CardId) {
        if !self.remembered_cards.contains(&card_id) {
            self.remembered_cards.push(card_id);
        }
    }

    /// Add a remembered CMC value
    pub fn add_remembered_cmc(&mut self, cmc: i32) {
        self.remembered_cmc.push(cmc);
    }

    pub fn add_remembered_player(&mut self, player: PlayerId) {
        if !self.remembered_players.contains(&player) {
            self.remembered_players.push(player);
        }
    }

    pub fn add_remembered_players<I>(&mut self, players: I)
    where
        I: IntoIterator<Item = PlayerId>,
    {
        for p in players {
            self.add_remembered_player(p);
        }
    }

    pub fn has_remembered(&self) -> bool {
        !self.remembered_cards.is_empty()
            || !self.remembered_players.is_empty()
            || !self.remembered_cmc.is_empty()
    }

    pub fn add_remembered(&mut self, card_id: CardId) {
        self.add_remembered_card(card_id);
    }

    pub fn remove_remembered(&mut self, card_id: CardId) {
        self.remembered_cards.retain(|&c| c != card_id);
    }

    pub fn clear_remembered(&mut self) {
        self.remembered_cards.clear();
        self.remembered_players.clear();
        self.remembered_cmc.clear();
    }

    pub fn update_remembered(&mut self) {
        let mut seen = HashSet::new();
        self.remembered_cards.retain(|c| seen.insert(*c));
    }

    pub fn has_imprinted_card(&self) -> bool {
        !self.imprinted_cards.is_empty()
    }

    pub fn add_imprinted_card(&mut self, card_id: CardId) {
        if !self.imprinted_cards.contains(&card_id) {
            self.imprinted_cards.push(card_id);
        }
    }

    pub fn add_imprinted_cards(&mut self, cards: impl IntoIterator<Item = CardId>) {
        for c in cards {
            self.add_imprinted_card(c);
        }
    }

    pub fn remove_imprinted_card(&mut self, card_id: CardId) {
        self.imprinted_cards.retain(|&c| c != card_id);
    }

    pub fn remove_imprinted_cards(&mut self, cards: impl IntoIterator<Item = CardId>) {
        for c in cards {
            self.remove_imprinted_card(c);
        }
    }

    pub fn clear_imprinted_cards(&mut self) {
        self.imprinted_cards.clear();
    }

    pub fn add_to_chosen_map(&mut self, player: PlayerId, chosen: Vec<CardId>) {
        self.chosen_map.insert(player, chosen);
    }

    pub fn add_gain_control_target(&mut self, card_id: CardId) {
        if !self.gain_control_targets.contains(&card_id) {
            self.gain_control_targets.push(card_id);
        }
    }

    pub fn remove_gain_control_targets(&mut self, card_id: CardId) {
        self.gain_control_targets.retain(|&c| c != card_id);
    }

    pub fn has_gain_control_target(&self) -> bool {
        !self.gain_control_targets.is_empty()
    }

    pub fn add_until_leaves_battlefield(&mut self, card_id: CardId) {
        if !self.until_leaves_battlefield.contains(&card_id) {
            self.until_leaves_battlefield.push(card_id);
        }
    }

    pub fn remove_until_leaves_battlefield(&mut self, card_id: CardId) {
        self.until_leaves_battlefield.retain(|&c| c != card_id);
    }

    pub fn clear_until_leaves_battlefield(&mut self) {
        self.until_leaves_battlefield.clear();
    }

    pub fn has_exiled_card(&self) -> bool {
        !self.exiled_cards.is_empty()
    }

    pub fn add_exiled_card(&mut self, card_id: CardId) {
        if !self.exiled_cards.contains(&card_id) {
            self.exiled_cards.push(card_id);
        }
    }

    pub fn add_exiled_cards(&mut self, cards: impl IntoIterator<Item = CardId>) {
        for c in cards {
            self.add_exiled_card(c);
        }
    }

    pub fn remove_exiled_card(&mut self, card_id: CardId) {
        self.exiled_cards.retain(|&c| c != card_id);
    }

    pub fn remove_exiled_cards(&mut self, cards: impl IntoIterator<Item = CardId>) {
        for c in cards {
            self.remove_exiled_card(c);
        }
    }

    pub fn clear_exiled_cards(&mut self) {
        self.exiled_cards.clear();
    }

    pub fn add_haunted_by(&mut self, card_id: CardId) {
        if !self.haunted_by.contains(&card_id) {
            self.haunted_by.push(card_id);
        }
    }

    pub fn remove_haunted_by(&mut self, card_id: CardId) {
        self.haunted_by.retain(|&c| c != card_id);
    }

    pub fn has_encoded_card(&self) -> bool {
        !self.encoded_cards.is_empty()
    }

    pub fn add_encoded_card(&mut self, card_id: CardId) {
        if !self.encoded_cards.contains(&card_id) {
            self.encoded_cards.push(card_id);
        }
    }

    pub fn add_encoded_cards(&mut self, cards: impl IntoIterator<Item = CardId>) {
        for c in cards {
            self.add_encoded_card(c);
        }
    }

    pub fn remove_encoded_card(&mut self, card_id: CardId) {
        self.encoded_cards.retain(|&c| c != card_id);
    }

    pub fn clear_encoded_cards(&mut self) {
        self.encoded_cards.clear();
    }

    pub fn has_merged_card(&self) -> bool {
        !self.melded_with.is_empty()
    }

    pub fn add_merged_card(&mut self, card_id: CardId) {
        if !self.melded_with.contains(&card_id) {
            self.melded_with.push(card_id);
        }
    }

    pub fn add_merged_card_to_top(&mut self, card_id: CardId) {
        if !self.melded_with.contains(&card_id) {
            self.melded_with.insert(0, card_id);
        }
    }

    pub fn remove_merged_card(&mut self, card_id: CardId) {
        self.melded_with.retain(|&c| c != card_id);
    }

    pub fn clear_merged_cards(&mut self) {
        self.melded_with.clear();
    }

    pub fn remove_mutated_states(&mut self) {
        self.clear_merged_cards();
    }

    pub fn rebuild_mutated_states(&mut self) {
        let mut seen = HashSet::new();
        self.melded_with.retain(|c| seen.insert(*c));
    }

    pub fn move_merged_to_subgame(&mut self) {
        self.clear_merged_cards();
    }

    pub fn entered_this_turn(&self) -> bool {
        self.entered_battlefield_this_turn
    }

    pub fn entered_current_zone_this_turn(&self, turn_number: u32) -> bool {
        self.turn_in_zone == turn_number
    }

    pub fn calculate_perpetual_adjusted_mana_cost(&mut self) {
        crate::card::card_state::calculate_perpetual_adjusted_mana_cost(self);
    }

    pub fn has_chosen_player(&self) -> bool {
        self.chosen_player.is_some()
    }

    pub fn reveal_chosen_player(&mut self) {
        self.chosen_player_revealed = true;
    }

    pub fn has_promised_gift(&self) -> bool {
        self.promised_gift.is_some()
    }

    pub fn has_chosen_number(&self) -> bool {
        self.chosen_number.is_some()
    }

    pub fn clear_chosen_number(&mut self) {
        self.chosen_number = None;
    }

    pub fn has_chosen_type(&self) -> bool {
        self.chosen_type
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }

    pub fn reveal_chosen_type(&mut self) {
        self.chosen_type_revealed = true;
    }

    pub fn has_chosen_type2(&self) -> bool {
        self.chosen_type2
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }

    pub fn has_any_noted_type(&self) -> bool {
        !self.noted_types.is_empty()
    }

    pub fn add_noted_type(&mut self, ty: &str) {
        self.noted_types.push(ty.to_string());
    }

    pub fn has_chosen_color(&self) -> bool {
        !self.chosen_colors.is_empty()
    }

    pub fn has_chosen_card(&self) -> bool {
        !self.chosen_cards.is_empty()
    }

    pub fn assign_sector(&mut self, sector: &str) {
        self.sector = Some(sector.to_string());
    }

    pub fn has_attraction_light(&self, light: i32) -> bool {
        light > 0 && self.attraction_lights.contains(&(light as u32))
    }

    pub fn has_sector(&self) -> bool {
        self.sector.is_some()
    }

    pub fn handle_changed_controller_sprocket_reset(&mut self) {
        if self.sprocket != 0 {
            self.sprocket = -1;
        }
    }

    pub fn add_named_card(&mut self, name: &str) {
        self.named_cards.push(name.to_string());
    }

    pub fn has_named_card(&self) -> bool {
        !self.named_cards.is_empty()
    }

    pub fn has_chosen_even_odd(&self) -> bool {
        self.chosen_even_odd.is_some()
    }

    pub fn has_no_abilities(&self) -> bool {
        self.abilities.is_empty()
            && self.activated_abilities.is_empty()
            && self.triggers.is_empty()
            && self.static_abilities.is_empty()
            && self.replacement_effects.is_empty()
    }

    pub fn can_tap(&self) -> bool {
        !self.tapped
    }

    pub fn tap(&mut self) -> bool {
        if !self.can_tap() {
            return false;
        }
        self.tapped = true;
        true
    }

    pub fn set_tapped(&mut self, tapped: bool) {
        if tapped {
            self.tap();
        } else {
            self.untap();
        }
    }

    pub fn set_owner(&mut self, owner: PlayerId) {
        self.owner = owner;
    }

    pub fn set_controller(&mut self, controller: PlayerId) {
        if self.controller != controller {
            self.came_under_control_since_last_upkeep = true;
        }
        self.controller = controller;
    }

    pub fn set_is_token(&mut self, is_token: bool) {
        self.is_token = is_token;
    }

    pub fn set_effect_source(&mut self, source: Option<CardId>) {
        self.effect_source = source;
    }

    pub fn set_temp_effect_host(&mut self, host: Option<CardId>) {
        self.temp_effect_host = host;
    }

    pub fn set_temp_effect_until_eot(&mut self, until_eot: bool) {
        self.temp_effect_until_eot = until_eot;
    }

    pub fn set_forget_on_moved_origin(&mut self, zone: Option<ZoneType>) {
        self.forget_on_moved_origin = zone;
    }

    pub fn set_exile_when_no_remembered(&mut self, exile: bool) {
        self.exile_when_no_remembered = exile;
    }

    pub fn set_flipped(&mut self, flipped: bool) {
        self.flipped = flipped;
    }

    pub fn can_untap(&self) -> bool {
        self.tapped
    }

    pub fn untap(&mut self) -> bool {
        if !self.can_untap() {
            return false;
        }
        self.tapped = false;
        true
    }

    pub fn exert(&mut self) {
        self.exerted = true;
    }

    pub fn clear_exerted(&mut self) {
        self.exerted = false;
    }

    pub fn remove_exerted_by(&mut self, _player: PlayerId) {
        self.exerted = false;
    }

    pub fn detain(&mut self) {
        self.detained = true;
    }

    pub fn add_goad(&mut self, player: PlayerId) {
        self.goaded_by = Some(player);
    }

    pub fn remove_goad(&mut self, player: PlayerId) {
        if self.goaded_by == Some(player) {
            self.goaded_by = None;
        }
    }

    pub fn un_goad(&mut self) {
        self.goaded_by = None;
    }

    pub fn remove_detained_by(&mut self, _player: PlayerId) {
        self.detained = false;
    }

    pub fn update_ability_text_for_view(&mut self) {
        self.update_spell_abilities();
    }
    pub fn update_non_ability_text_for_view(&mut self) {
        self.update_changed_text();
    }
    pub fn update_mana_cost_for_view(&mut self) {
        let _ = self.mana_value();
    }
    pub fn update_p_tfor_view(&mut self) {
        let _ = (self.power(), self.toughness());
    }
    pub fn update_color_for_view(&mut self) {
        let _ = self.color;
    }
    pub fn update_attacking_for_view(&mut self) {
        let _ = self.attacking_player;
    }
    pub fn update_blocking_for_view(&mut self) {
        let _ = self.must_block;
    }
    pub fn update_state_for_view(&mut self) {
        let _ = (self.zone, self.tapped, self.face_down);
    }
    pub fn update_namefor_view(&mut self) {
        self.card_name = self.card_name.trim().to_string();
    }
    pub fn update_token_view(&mut self) {
        let _ = self.is_token;
    }
    pub fn update_was_destroyed(&mut self) {
        let _ = self.damage >= self.toughness();
    }
    pub fn update_rules_view(&mut self) {
        let _ = (&self.abilities, &self.keywords);
    }
    pub fn update_commander_view(&mut self) {
        let _ = self.is_commander;
    }
    pub fn update_card(&mut self) {
        self.update_namefor_view();
        self.update_types_for_view();
        self.update_color_for_view();
        self.update_mana_cost_for_view();
        self.update_p_tfor_view();
        self.update_rules_view();
        self.update_state_for_view();
    }
    pub fn dangerously_set_game(&mut self) {
        self.update_card();
    }
    pub fn visit(&mut self) {
        self.update_card();
    }

    pub fn has_state(&self) -> bool {
        self.is_transformed || self.other_part.is_some()
    }

    /// Whether this card is double-faced (has a back side).
    /// Mirrors Java `Card.isDoubleFaced()`.
    pub fn is_double_faced(&self) -> bool {
        self.other_part.is_some()
    }

    pub fn change_to_state(&mut self) {
        self.transform();
    }

    pub fn add_alternate_state(&mut self, other: CardOtherPart) {
        self.other_part = Some(other);
    }

    pub fn clear_states(&mut self) {
        self.other_part = None;
        self.is_transformed = false;
    }

    pub fn change_card_state(&mut self) {
        self.transform();
    }

    pub fn has_alternate_state(&self) -> bool {
        self.other_part.is_some()
    }

    pub fn manifest(&mut self) {
        self.manifested = true;
        self.turn_face_down();
    }

    pub fn cloak(&mut self) {
        self.cloaked = true;
        self.turn_face_down();
    }

    pub fn turn_face_down(&mut self) {
        self.face_down = true;
    }

    pub fn turn_face_down_no_update(&mut self) {
        self.face_down = true;
    }

    pub fn can_be_turned_face_up(&self) -> bool {
        self.face_down
    }

    pub fn force_turn_face_up(&mut self) {
        self.face_down = false;
    }

    pub fn turn_face_up(&mut self) {
        self.face_down = false;
    }

    pub fn set_face_down(&mut self, face_down: bool) {
        if face_down {
            self.turn_face_down();
        } else {
            self.turn_face_up();
        }
    }

    pub fn set_manifested(&mut self, manifested: bool) {
        self.manifested = manifested;
    }

    pub fn set_cloaked(&mut self, cloaked: bool) {
        self.cloaked = cloaked;
    }

    pub fn set_discarded(&mut self, discarded: bool) {
        self.discarded = discarded;
    }

    pub fn set_unearthed(&mut self, unearthed: bool) {
        self.unearthed = unearthed;
    }

    pub fn set_summoning_sick(&mut self, summoning_sick: bool) {
        self.summoning_sick = summoning_sick;
    }

    pub fn set_foretold(&mut self, foretold: bool) {
        self.foretold = foretold;
    }

    pub fn set_foretold_cost_by_effect(&mut self, by_effect: bool) {
        self.foretold_cost_by_effect = by_effect;
    }

    pub fn set_transformed(&mut self, transformed: bool) {
        self.is_transformed = transformed;
    }

    pub fn set_attacking_player(&mut self, player: PlayerId) {
        self.attacking_player = Some(player);
    }

    pub fn clear_attacking_player(&mut self) {
        self.attacking_player = None;
    }

    pub fn mark_attacked_this_turn(&mut self) {
        self.attacked_this_turn = true;
    }

    pub fn add_etb_counters_p1p1(&mut self, amount: i32) {
        self.etb_counters_p1p1 += amount;
    }

    pub fn increment_commander_cast_count(&mut self) {
        self.commander_cast_count += 1;
    }

    pub fn set_kicked(&mut self, kicked: bool) {
        self.kicked = kicked;
    }

    pub fn mark_enlisted_this_combat(&mut self) {
        self.enlisted_this_combat = true;
    }

    pub fn add_enlisted_power(&mut self, amount: i32) {
        self.power_modifier += amount;
    }

    pub fn add_damage_source_this_turn(&mut self, source: CardId) {
        self.damage_sources_this_turn.push(source);
    }

    pub fn mark_deathtouch_damage(&mut self) {
        self.has_deathtouch_damage = true;
    }

    pub fn clear_deathtouch_damage(&mut self) {
        self.has_deathtouch_damage = false;
    }

    pub fn clear_damage(&mut self) {
        self.damage = 0;
    }

    pub fn reset_turn_modifiers(&mut self) {
        self.power_modifier = 0;
        self.toughness_modifier = 0;
    }

    pub fn reset_regeneration_shields(&mut self) {
        self.regeneration_shields = 0;
    }

    pub fn clear_original_controller_eot(&mut self) {
        self.original_controller_eot = None;
    }

    pub fn set_chosen_modes(&mut self, modes: Vec<usize>) {
        self.chosen_modes = Some(modes);
    }

    pub fn set_chosen_cards(&mut self, cards: Vec<CardId>) {
        self.chosen_cards = cards;
    }

    pub fn set_chosen_number(&mut self, number: Option<i32>) {
        self.chosen_number = number;
    }

    pub fn set_chosen_player(
        &mut self,
        player: Option<PlayerId>,
        chooser: Option<PlayerId>,
        revealed: bool,
    ) {
        self.chosen_player = player;
        self.chosen_player_controller = chooser;
        self.chosen_player_revealed = revealed;
    }

    pub fn set_chosen_type(
        &mut self,
        chosen_type: Option<String>,
        chooser: Option<PlayerId>,
        revealed: bool,
    ) {
        self.chosen_type = chosen_type;
        self.chosen_type_controller = chooser;
        self.chosen_type_revealed = revealed;
    }

    pub fn set_strive_extra_targets(&mut self, value: u32) {
        self.strive_extra_targets = value;
    }

    pub fn set_colors_spent_to_cast(&mut self, colors: u16) {
        self.colors_spent_to_cast = colors;
    }

    pub fn set_paying_mana_to_cast(&mut self, paying_mana: Vec<u16>) {
        self.paying_mana_to_cast = paying_mana;
    }

    pub fn set_promised_gift(&mut self, player: Option<PlayerId>) {
        self.promised_gift = player;
    }

    pub fn set_lki_power_toughness(&mut self, power: Option<i32>, toughness: Option<i32>) {
        self.lki_power = power;
        self.lki_toughness = toughness;
    }

    pub fn restore_animate_snapshot(
        &mut self,
        type_line: CardTypeLine,
        base_power: Option<i32>,
        base_toughness: Option<i32>,
        color: ColorSet,
    ) {
        self.set_type_line(type_line);
        self.base_power = base_power;
        self.base_toughness = base_toughness;
        self.color = color;
    }

    pub fn capture_clone_state(&self) -> CloneState {
        CloneState {
            expires_at_cleanup: false,
            original_card_name: self.card_name.clone(),
            original_type_line: self.type_line.clone(),
            original_mana_cost: self.mana_cost.clone(),
            original_color: self.color,
            original_base_power: self.base_power,
            original_base_toughness: self.base_toughness,
            original_keywords: self.keywords.clone(),
            original_abilities: self.abilities.clone(),
            original_activated_abilities: self.activated_abilities.clone(),
            original_triggers: self.triggers.clone(),
            original_svars: self.svars.clone(),
            original_static_abilities: self.static_abilities.clone(),
            original_replacement_effects: self.replacement_effects.clone(),
            original_base_ability_count: self.base_ability_count,
            original_base_trigger_count: self.base_trigger_count,
        }
    }

    pub fn restore_clone_snapshot(&mut self, state: CloneState) {
        self.card_name = state.original_card_name;
        self.type_line = state.original_type_line;
        self.mana_cost = state.original_mana_cost;
        self.color = state.original_color;
        self.base_power = state.original_base_power;
        self.base_toughness = state.original_base_toughness;
        self.keywords = state.original_keywords;
        self.abilities = state.original_abilities;
        self.activated_abilities = state.original_activated_abilities;
        self.triggers = state.original_triggers;
        self.svars = state.original_svars;
        self.static_abilities = state.original_static_abilities;
        self.replacement_effects = state.original_replacement_effects;
        self.base_ability_count = state.original_base_ability_count;
        self.base_trigger_count = state.original_base_trigger_count;
        self.parsed_svar_cache.clear();
        self.refresh_action_specs();
        self.ensure_crew_activated_ability();
        self.remove_clone_state();
    }

    pub fn set_counters_map(&mut self, counters: BTreeMap<CounterType, i32>) {
        self.counters = counters;
    }

    pub fn set_zone(&mut self, zone: ZoneType) {
        self.zone = zone;
    }

    pub fn set_color(&mut self, color: ColorSet) {
        self.color = color;
    }

    pub fn set_animate_state(&mut self, state: Option<AnimateState>) {
        self.animate_state = state;
    }

    pub fn set_clone_state(&mut self, state: Option<CloneState>) {
        self.clone_state = state;
    }

    pub fn set_exiled_by(&mut self, source: Option<CardId>) {
        self.exiled_by = source;
    }

    pub fn set_attached_to(&mut self, target: Option<CardId>) {
        self.attached_to = target;
    }

    pub fn set_original_controller_eot(&mut self, controller: Option<PlayerId>) {
        self.original_controller_eot = controller;
    }

    pub fn set_class_level(&mut self, level: i32) {
        self.class_level = level;
    }

    pub fn set_paired_with(&mut self, pair: Option<CardId>) {
        self.paired_with = pair;
    }

    pub fn set_must_block(&mut self, must_block: bool) {
        self.must_block = must_block;
    }

    pub fn set_detained(&mut self, detained: bool) {
        self.detained = detained;
    }

    pub fn set_goaded_by(&mut self, player: Option<PlayerId>) {
        self.goaded_by = player;
    }

    pub fn set_phased_out(&mut self, phased_out: bool) {
        self.phased_out = phased_out;
    }

    pub fn set_base_power(&mut self, power: Option<i32>) {
        self.base_power = power;
    }

    pub fn set_base_toughness(&mut self, toughness: Option<i32>) {
        self.base_toughness = toughness;
    }

    pub fn set_base_pt(&mut self, power: Option<i32>, toughness: Option<i32>) {
        self.base_power = power;
        self.base_toughness = toughness;
    }

    pub fn capture_changed_characteristics_baseline_if_needed(&mut self) {
        if self.changed_type_line_base.is_none() {
            self.changed_type_line_base = Some(self.type_line.clone());
        }
        if self.changed_base_power.is_none() {
            self.changed_base_power = Some(self.base_power);
        }
        if self.changed_base_toughness.is_none() {
            self.changed_base_toughness = Some(self.base_toughness);
        }
    }

    pub fn restore_changed_characteristics_baseline(&mut self) {
        if let Some(type_line) = self.changed_type_line_base.take() {
            self.set_type_line(type_line);
        }
        if let Some(power) = self.changed_base_power.take() {
            self.base_power = power;
        }
        if let Some(toughness) = self.changed_base_toughness.take() {
            self.base_toughness = toughness;
        }
    }

    pub fn set_static_set_pt(&mut self, power: Option<i32>, toughness: Option<i32>) {
        self.static_set_power = power;
        self.static_set_toughness = toughness;
    }

    pub fn set_power_modifier(&mut self, amount: i32) {
        self.power_modifier = amount;
    }

    pub fn set_toughness_modifier(&mut self, amount: i32) {
        self.toughness_modifier = amount;
    }

    pub fn set_card_name(&mut self, name: impl Into<String>) {
        self.card_name = name.into();
    }

    pub fn set_mana_cost(&mut self, mana_cost: ManaCost) {
        self.mana_cost = mana_cost;
    }

    pub fn set_abilities(&mut self, abilities: Vec<String>) {
        self.abilities = abilities;
        self.update_spell_abilities();
        self.refresh_action_specs();
    }

    pub fn set_static_abilities(&mut self, abilities: Vec<StaticAbility>) {
        self.static_abilities = abilities;
    }

    pub fn set_triggers(&mut self, triggers: Vec<Trigger>) {
        self.triggers = triggers;
        self.base_trigger_count = self.triggers.len();
    }

    pub fn set_replacement_effects(&mut self, effects: Vec<ReplacementEffect>) {
        self.replacement_effects = effects;
    }

    pub fn set_renowned(&mut self, renowned: bool) {
        self.is_renowned = renowned;
    }

    pub fn set_monstrous(&mut self, monstrous: bool) {
        self.monstrous = monstrous;
    }

    pub fn clear_granted_keywords(&mut self) {
        self.granted_keywords.clear();
    }

    pub fn clear_pump_keywords(&mut self) {
        self.pump_keywords.clear();
    }

    pub fn increment_pump_trigger_count(&mut self) {
        self.pump_trigger_count += 1;
    }

    pub fn add_remembered_cards<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = CardId>,
    {
        for card in cards {
            self.add_remembered_card(card);
        }
    }

    pub fn clear_chosen_colors(&mut self) {
        self.chosen_colors.clear();
    }

    pub fn add_chosen_color(&mut self, color: impl Into<String>) {
        self.chosen_colors.push(color.into());
    }

    pub fn add_chosen_card(&mut self, card: CardId) {
        if !self.chosen_cards.contains(&card) {
            self.chosen_cards.push(card);
        }
    }

    pub fn add_pump_keyword(&mut self, keyword: &str) {
        self.pump_keywords.add(keyword);
    }

    pub fn add_granted_keyword(&mut self, keyword: &str) {
        self.granted_keywords.add(keyword);
    }

    pub fn was_turned_face_up_this_turn(&self) -> bool {
        !self.face_down && (self.manifested || self.cloaked)
    }

    pub fn can_transform(&self) -> bool {
        self.other_part.is_some()
    }

    pub fn has_name_overwrite(&self) -> bool {
        false
    }

    pub fn has_non_legendary_creature_names(&self) -> bool {
        false
    }

    pub fn add_changed_name(&mut self, name: &str) {
        if !self.has_s_var("OriginalName") {
            self.set_s_var("OriginalName", self.card_name.clone());
        }
        self.card_name = name.to_string();
    }

    pub fn remove_changed_name(&mut self) {
        if let Some(orig) = self.svars.get("OriginalName").cloned() {
            self.card_name = orig;
        }
    }

    pub fn clear_changed_name(&mut self) {
        self.remove_s_var("OriginalName");
    }

    pub fn add_devoured(&mut self, card_id: CardId) {
        self.add_remembered_card(card_id);
        self.set_s_var("Devoured", "True");
    }
    pub fn add_exploited(&mut self, card_id: CardId) {
        self.add_remembered_card(card_id);
        self.set_s_var("Exploited", "True");
    }
    pub fn add_delved(&mut self, card_id: CardId) {
        self.add_remembered_card(card_id);
        self.set_s_var("Delved", "True");
    }
    pub fn clear_delved(&mut self) {
        self.remove_s_var("Delved");
    }
    pub fn retain_paid_list(&mut self) {
        self.remembered_cards.retain(|_| true);
    }
    pub fn add_stored_rolls(&mut self, roll: i32) {
        self.add_remembered_cmc(roll);
    }
    pub fn replace_stored_roll(&mut self, from: i32, to: i32) {
        for roll in &mut self.remembered_cmc {
            if *roll == from {
                *roll = to;
            }
        }
    }
    pub fn add_flip_result(&mut self, heads: bool) {
        self.set_s_var("FlipResult", if heads { "Heads" } else { "Tails" });
    }
    pub fn clear_flip_result(&mut self) {
        self.remove_s_var("FlipResult");
    }
    pub fn add_blocked_this_turn(&mut self, card_id: CardId) {
        self.add_remembered_card(card_id);
        self.set_s_var("BlockedThisTurn", "True");
    }
    pub fn clear_blocked_this_turn(&mut self) {
        self.remove_s_var("BlockedThisTurn");
    }
    pub fn add_blocked_by_this_turn(&mut self, card_id: CardId) {
        self.add_remembered_card(card_id);
        self.set_s_var("BlockedByThisTurn", "True");
    }
    pub fn clear_blocked_by_this_turn(&mut self) {
        self.remove_s_var("BlockedByThisTurn");
    }

    pub fn add_must_block_card(&mut self, card_id: CardId) {
        if !self.must_block_cards.contains(&card_id) {
            self.must_block_cards.push(card_id);
        }
    }

    pub fn add_must_block_cards(&mut self, cards: impl IntoIterator<Item = CardId>) {
        for c in cards {
            self.add_must_block_card(c);
        }
    }

    pub fn remove_must_block_cards(&mut self, cards: impl IntoIterator<Item = CardId>) {
        let remove: HashSet<CardId> = cards.into_iter().collect();
        self.must_block_cards.retain(|c| !remove.contains(c));
    }

    pub fn clear_must_block_cards(&mut self) {
        self.must_block_cards.clear();
    }

    pub fn has_second_strike(&self) -> bool {
        self.has_double_strike()
    }

    pub fn has_suspend(&self) -> bool {
        self.has_keyword("Suspend")
    }

    pub fn has_converge(&self) -> bool {
        self.has_keyword("Converge")
    }

    pub fn can_receive_counters(&self, _counter: &CounterType) -> bool {
        true
    }

    pub fn can_remove_counters(&self, counter: &CounterType) -> bool {
        self.counter_count(counter) > 0
    }

    pub fn add_counter_internal(&mut self, counter: &CounterType, amount: i32) {
        self.add_counter(counter, amount);
    }

    pub fn create_counter_static(&mut self) {
        self.put_etb_counters();
    }

    pub fn subtract_counter(&mut self, counter: &CounterType, amount: i32) {
        self.remove_counter(counter, amount);
    }

    pub fn clear_counters(&mut self) {
        self.counters.clear();
    }

    pub fn sum_all_counters(&self) -> i32 {
        self.counters.values().sum()
    }

    pub fn put_etb_counters(&mut self) {
        if self.etb_counters_p1p1 > 0 {
            self.add_counter(&CounterType::P1P1, self.etb_counters_p1p1);
            self.etb_counters_p1p1 = 0;
        }
    }

    pub fn copy_changed_s_vars_from(&mut self, other: &Card) {
        self.set_svars_map(other.svars.clone());
    }

    pub fn add_changed_s_vars(&mut self, key: &str, value: &str) {
        self.set_s_var(key, value);
    }

    pub fn remove_changed_s_vars(&mut self, key: &str) {
        self.remove_s_var(key);
    }

    pub fn add_changed_mana_cost(&mut self, mana_cost: &str) {
        if !self.has_s_var("OriginalManaCost") {
            self.set_s_var("OriginalManaCost", self.mana_cost.to_string());
        }
        self.mana_cost = ManaCost::parse(mana_cost);
        self.calculate_perpetual_adjusted_mana_cost();
        self.update_mana_cost_for_view();
    }
    pub fn remove_changed_mana_cost(&mut self, _timestamp: i64, _static_id: i64) -> bool {
        let Some(original) = self.svars.get("OriginalManaCost").cloned() else {
            return false;
        };
        let before = self.mana_cost.clone();
        self.mana_cost = ManaCost::parse(&original);
        self.calculate_perpetual_adjusted_mana_cost();
        self.update_mana_cost_for_view();
        self.remove_s_var("OriginalManaCost");
        self.mana_cost != before
    }

    pub fn cleanup_exiled_with(&mut self) {
        self.exiled_by = None;
    }

    pub fn has_paper_foil(&self) -> bool {
        self.paper_foil
    }

    pub fn has_marked_color(&self) -> bool {
        !self.color.is_colorless()
    }

    pub fn can_produce_color_mana(
        &self,
        game: &GameState,
        colors: &std::collections::HashSet<String>,
    ) -> bool {
        crate::card::card_util::card_can_produce_color_mana(game, self.id, colors)
    }

    pub fn can_produce_same_mana_type_with(&self, game: &GameState, other: &Card) -> bool {
        crate::card::card_util::card_can_produce_same_mana_type_with(game, self.id, other.id)
    }

    pub fn has_remove_intrinsic(&self) -> bool {
        false
    }

    pub fn update_spell_abilities(&mut self) {
        self.activated_abilities.clear();
        for (i, raw) in self.abilities.iter().enumerate() {
            if let Some(parsed) = crate::ability::activated::parse_activated_ability(raw, i) {
                self.activated_abilities.push(parsed);
            }
        }
    }

    pub fn refresh_action_specs(&mut self) {
        let mut spell_specs = Vec::new();
        let mut spell_cost = None;
        let mut ai_phyrexian_payment = None;
        let mut spree_min_mode_cost = None;

        for (ability_index, raw) in self.abilities.iter().enumerate() {
            let parsed = ParsedParams::parse(raw);
            if ai_phyrexian_payment.is_none() {
                ai_phyrexian_payment = parsed.get(keys::AI_PHYREXIAN_PAYMENT).map(str::to_string);
            }
            let Some(sp_kind) = parsed.get(keys::SP) else {
                continue;
            };
            let cost_contains_x = parsed
                .get(keys::COST)
                .is_some_and(|cost| cost.contains('X'));
            if spell_cost.is_none() {
                spell_cost = parsed.get(keys::COST).map(parse_cost);
            }
            spell_specs.push(CardActionSpellSpec {
                ability_index,
                has_valid_tgts: parsed.has(keys::VALID_TGTS),
                cost_contains_x,
                target_chain: self.collect_action_target_chain(raw),
            });

            if sp_kind.eq_ignore_ascii_case("Charm") {
                if let Some(choices) = parsed.get(keys::CHOICES) {
                    let min_mode_cost = choices
                        .split(',')
                        .filter_map(|name| {
                            self.svars.get(name.trim()).and_then(|svar_val| {
                                ParsedParams::parse(svar_val)
                                    .get(keys::MODE_COST)
                                    .map(|cost| forge_foundation::ManaCost::parse(cost).cmc())
                            })
                        })
                        .min();
                    spree_min_mode_cost = spree_min_mode_cost.or(min_mode_cost);
                }
            }
        }

        self.action_spell_specs = spell_specs;
        self.action_spell_cost = spell_cost;
        self.ai_phyrexian_payment = ai_phyrexian_payment;
        self.spree_min_mode_cost = spree_min_mode_cost;
    }

    fn refresh_action_specs_after_svar_change(&mut self) {
        if self.action_spell_specs.is_empty() {
            return;
        }
        self.refresh_action_specs();
    }

    fn collect_action_target_chain(&self, ability_text: &str) -> Vec<CardActionTargetSpec> {
        let mut specs = Vec::new();
        let mut current = Some(ability_text.to_string());

        while let Some(text) = current {
            let parsed = ParsedParams::parse(&text);
            let params = Params::from_parsed(&parsed);
            if let Some(target_restrictions) = TargetRestrictions::new_from_parsed(&parsed, &params)
            {
                specs.push(CardActionTargetSpec {
                    min_targets: parse_literal_target_count(&target_restrictions.min_targets),
                    target_restrictions,
                });
            }

            current = parsed
                .get(keys::SUB_ABILITY)
                .and_then(|name| self.svars.get(name.trim()))
                .cloned();
        }

        specs
    }

    pub fn inc_shield_count(&mut self) {
        self.damage_prevention += 1;
    }

    pub fn dec_shield_count(&mut self) {
        self.damage_prevention = (self.damage_prevention - 1).max(0);
    }

    pub fn reset_shield_count(&mut self) {
        self.damage_prevention = 0;
    }

    pub fn add_regenerated_this_turn(&mut self) {
        self.regeneration_shields += 1;
    }

    pub fn can_be_shielded(&self) -> bool {
        self.is_permanent()
    }

    pub fn add_untap_command(&mut self) {
        self.set_s_var("_cmd_untap", "1");
    }
    pub fn add_unattach_command(&mut self) {
        self.set_s_var("_cmd_unattach", "1");
    }
    pub fn add_faceup_command(&mut self) {
        self.set_s_var("_cmd_faceup", "1");
    }
    pub fn add_facedown_command(&mut self) {
        self.set_s_var("_cmd_facedown", "1");
    }
    pub fn add_change_controller_command(&mut self) {
        self.set_s_var("_cmd_change_controller", "1");
    }
    pub fn add_phase_out_command(&mut self) {
        self.set_s_var("_cmd_phase_out", "1");
    }
    pub fn add_leaves_play_command(&mut self) {
        self.set_s_var("_cmd_leaves_play", "1");
    }
    pub fn add_static_command_list(&mut self) {
        self.set_s_var("_cmd_static", "1");
    }
    pub fn run_leaves_play_commands(&mut self) {
        if self.has_s_var("_cmd_leaves_play") {
            self.cleanup_exiled_with();
            self.remove_s_var("_cmd_leaves_play");
        }
    }
    pub fn run_untap_commands(&mut self) {
        if self.has_s_var("_cmd_untap") {
            self.untap();
            self.remove_s_var("_cmd_untap");
        }
    }
    pub fn run_unattach_commands(&mut self) {
        if self.has_s_var("_cmd_unattach") {
            self.unattach_from_entity();
            self.remove_s_var("_cmd_unattach");
        }
    }
    pub fn run_faceup_commands(&mut self) {
        if self.has_s_var("_cmd_faceup") {
            self.turn_face_up();
            self.remove_s_var("_cmd_faceup");
        }
    }
    pub fn run_facedown_commands(&mut self) {
        if self.has_s_var("_cmd_facedown") {
            self.turn_face_down();
            self.remove_s_var("_cmd_facedown");
        }
    }
    pub fn run_change_controller_commands(&mut self) {
        if self.has_s_var("_cmd_change_controller") {
            self.clear_temp_controllers();
            self.remove_s_var("_cmd_change_controller");
        }
    }
    pub fn run_phase_out_commands(&mut self) {
        if self.has_s_var("_cmd_phase_out") {
            self.phase();
            self.remove_s_var("_cmd_phase_out");
        }
    }

    pub fn has_sickness(&self) -> bool {
        self.summoning_sick
    }

    pub fn has_become_target_this_turn(&self) -> bool {
        self.became_target_this_turn
    }

    pub fn add_target_from_this_turn(&mut self) {
        self.became_target_this_turn = true;
    }

    pub fn has_started_the_turn_untapped(&self) -> bool {
        !self.started_turn_tapped
    }

    pub fn came_under_control_since_last_upkeep(&self) -> bool {
        self.came_under_control_since_last_upkeep
    }

    pub fn add_temp_controller(&mut self, player: PlayerId) {
        self.temp_controllers.push(player);
    }

    pub fn remove_temp_controller(&mut self, player: PlayerId) {
        self.temp_controllers.retain(|&p| p != player);
    }

    pub fn clear_temp_controllers(&mut self) {
        self.temp_controllers.clear();
    }

    pub fn clear_controllers(&mut self) {
        self.controller = self.owner;
        self.clear_temp_controllers();
    }

    pub fn may_player_look(&self, player: PlayerId) -> bool {
        self.may_look_at.contains(&player)
    }

    pub fn add_may_look_face_down_exile(&mut self, player: PlayerId) {
        if !self.may_look_at.contains(&player) {
            self.may_look_at.push(player);
        }
    }

    pub fn add_may_look_at(&mut self, player: PlayerId) {
        if !self.may_look_at.contains(&player) {
            self.may_look_at.push(player);
        }
    }

    pub fn remove_may_look_at(&mut self, player: PlayerId) {
        self.may_look_at.retain(|&p| p != player);
    }

    pub fn add_may_look_temp(&mut self, player: PlayerId) {
        self.add_may_look_at(player);
    }

    pub fn remove_may_look_temp(&mut self, player: PlayerId) {
        self.remove_may_look_at(player);
    }

    pub fn update_may_look(&mut self) {
        let mut seen = HashSet::new();
        self.may_look_at.retain(|p| seen.insert(*p));
    }
    pub fn update_may_play(&mut self) {
        let mut seen = HashSet::new();
        self.may_play.retain(|p| seen.insert(*p));
    }

    pub fn may_play(&self, player: PlayerId) -> bool {
        self.may_play.contains(&player)
    }

    pub fn remove_may_play(&mut self, player: PlayerId) {
        self.may_play.retain(|&p| p != player);
    }

    pub fn reset_may_play_turn(&mut self) {
        self.may_play.clear();
    }

    pub fn remove_attached_to(&mut self) {
        self.attached_to = None;
    }

    pub fn attach_to_entity(&mut self, host: CardId) {
        self.attached_to = Some(host);
    }

    pub fn add_attachment(&mut self, card_id: CardId) {
        if !self.attachments.contains(&card_id) {
            self.attachments.push(card_id);
        }
    }

    pub fn remove_attachment(&mut self, card_id: CardId) {
        self.attachments.retain(|&id| id != card_id);
    }

    pub fn unattach_from_entity(&mut self) {
        self.attached_to = None;
    }

    pub fn clear_intrinsic_keywords(&mut self) {
        self.keywords.clear();
    }

    pub fn clear_all_keyword_sets(&mut self) {
        self.keywords.clear();
        self.pump_keywords.clear();
        self.granted_keywords.clear();
    }

    pub fn clear_subtypes(&mut self) {
        self.type_line.subtypes.clear();
    }

    pub fn clear_changed_card_types(&mut self) {
        self.update_types();
    }
    pub fn clear_changed_card_colors(&mut self) {
        self.color = ColorSet::COLORLESS;
    }
    pub fn add_changed_card_types_by_text(&mut self) {
        self.update_types();
    }
    pub fn remove_changed_card_types_by_text(&mut self) {
        self.update_types();
    }
    pub fn add_changed_card_types(&mut self) {
        self.update_types();
    }
    pub fn remove_changed_card_types(&mut self) {
        self.update_types();
    }
    pub fn update_type_cache(&mut self) {
        self.type_line = CardTypeLine::parse(&self.type_line.to_string());
    }
    pub fn has_changed_card_colors(&self) -> bool {
        !self.color.is_colorless()
    }
    pub fn add_color_by_text(&mut self, color: ColorSet) {
        self.add_color(color);
    }
    pub fn remove_color_by_text(&mut self) {
        self.remove_color();
    }
    pub fn remove_color(&mut self) {
        self.color = ColorSet::COLORLESS;
    }
    pub fn add_clone_state(&mut self) {
        self.set_s_var("CloneState", "True");
    }
    pub fn remove_clone_state(&mut self) {
        self.remove_s_var("CloneState");
    }
    pub fn remove_clone_states(&mut self) {
        self.remove_s_var("CloneState");
    }
    pub fn add_new_pt_by_text(&mut self, p: i32, t: i32) {
        self.base_power = Some(p);
        self.base_toughness = Some(t);
    }
    pub fn remove_new_p_tby_text(&mut self) {
        self.clear_new_pt();
    }
    pub fn add_new_pt(&mut self, p: i32, t: i32) {
        self.base_power = Some(p);
        self.base_toughness = Some(t);
    }
    pub fn remove_new_pt(&mut self) {
        self.clear_new_pt();
    }
    pub fn clear_new_pt(&mut self) {
        self.base_power = None;
        self.base_toughness = None;
    }
    pub fn toughness_assigns_damage(&self) -> bool {
        self.has_keyword("CARDNAME assigns combat damage equal to its toughness")
    }
    pub fn assign_no_combat_damage(&self) -> bool {
        self.has_keyword("CARDNAME assigns no combat damage")
    }
    pub fn add_pt_boost(&mut self, p: i32, t: i32) {
        self.power_modifier += p;
        self.toughness_modifier += t;
    }
    pub fn remove_pt_boost(&mut self, p: i32, t: i32) {
        self.power_modifier -= p;
        self.toughness_modifier -= t;
    }
    pub fn add_draft_action(&mut self) {
        self.set_s_var("DraftAction", "True");
    }
    pub fn add_intensity(&mut self, v: i32) {
        self.intensity += v;
    }
    pub fn has_intensity(&self) -> bool {
        self.intensity > 0
    }
    pub fn has_perpetual(&self) -> bool {
        !self.perpetual.is_empty()
    }
    pub fn get_perpetual(&self) -> &[PerpetualRecord] {
        &self.perpetual
    }
    pub fn add_perpetual(&mut self, p: PerpetualRecord) {
        self.apply_perpetual_record(p, true);
    }
    pub fn remove_perpetual(&mut self, timestamp: i64) -> bool {
        if let Some(idx) = self
            .perpetual
            .iter()
            .position(|p| p.timestamp() == timestamp)
        {
            self.perpetual.remove(idx);
            true
        } else {
            false
        }
    }
    pub fn set_perpetual(&mut self, old_card: &Card, apply_effects: bool) {
        self.perpetual = old_card.perpetual.clone();
        if apply_effects {
            for p in self.perpetual.clone() {
                self.apply_perpetual_record(p, false);
            }
        }
    }
    pub fn set_perpetual_from(&mut self, old_card: &Card) {
        self.set_perpetual(old_card, true);
    }
    pub fn apply_perpetual_record(&mut self, p: PerpetualRecord, remember: bool) {
        if remember {
            self.perpetual.push(p.clone());
        }
        p.apply_effect(self);
    }
    pub fn add_trigger_for_static_ability(&mut self, trig: Trigger) {
        self.add_trigger(trig);
    }
    pub fn visit_keywords(&self) -> Vec<String> {
        self.keywords.as_string_list()
    }
    pub fn update_keywords(&mut self) {
        self.update_keywords_cache();
    }
    pub fn add_changed_card_keywords(&mut self, kw: &str) {
        self.add_intrinsic_keyword(kw);
    }
    pub fn add_keyword_for_static_ability(&mut self, kw: &str) {
        self.granted_keywords.add(kw);
    }
    pub fn add_changed_card_keywords_by_text(&mut self, kw: &str) {
        self.add_intrinsic_keyword(kw);
    }
    pub fn add_changed_card_keywords_internal(&mut self, kw: &str) {
        self.add_intrinsic_keyword(kw);
    }
    pub fn remove_changed_card_keywords(&mut self, kw: &str) {
        self.remove_intrinsic_keyword(kw);
    }
    pub fn remove_changed_card_keywords_by_text(&mut self, kw: &str) {
        self.remove_intrinsic_keyword(kw);
    }
    pub fn clear_changed_card_keywords(&mut self) {
        self.keywords.clear();
    }
    pub fn clear_static_changed_card_keywords(&mut self) {
        self.granted_keywords.clear();
    }
    pub fn add_hidden_extrinsic_keywords(&mut self, kw: &str) {
        self.granted_keywords.add(kw);
    }
    pub fn remove_hidden_extrinsic_keywords(&mut self, kw: &str) {
        self.granted_keywords.remove(kw);
    }
    pub fn remove_hidden_extrinsic_keyword(&mut self, kw: &str) {
        self.granted_keywords.remove(kw);
    }
    pub fn has_start_of_keyword(&self, prefix: &str) -> bool {
        self.keywords.iter_strings().any(|k| k.starts_with(prefix))
    }
    pub fn has_start_of_un_hidden_keyword(&self, prefix: &str) -> bool {
        self.has_start_of_keyword(prefix)
    }
    pub fn has_any_keyword(&self) -> bool {
        !self.keywords.as_string_list().is_empty()
            || !self.granted_keywords.as_string_list().is_empty()
            || !self.pump_keywords.as_string_list().is_empty()
    }
    pub fn add_cant_have_keyword(&mut self, kw: &str) {
        self.cant_have_keywords.insert(kw.to_ascii_lowercase());
    }
    pub fn remove_cant_have_keyword(&mut self, kw: &str) {
        self.cant_have_keywords.remove(&kw.to_ascii_lowercase());
    }
    pub fn add_changed_text_color_word(&mut self, from: &str, to: &str) {
        self.set_s_var(format!("TextColor:{from}"), to);
    }
    pub fn remove_changed_text_color_word(&mut self, from: &str) {
        self.remove_s_var(&format!("TextColor:{from}"));
    }
    pub fn add_changed_text_type_word(&mut self, from: &str, to: &str) {
        self.set_s_var(format!("TextType:{from}"), to);
    }
    pub fn remove_changed_text_type_word(&mut self, from: &str) {
        self.remove_s_var(&format!("TextType:{from}"));
    }
    pub fn copy_changed_text_from(&mut self, other: &Card) {
        for (k, v) in &other.svars {
            if k.starts_with("TextColor:") || k.starts_with("TextType:") {
                self.svars.insert(k.clone(), v.clone());
            }
        }
    }
    pub fn has_playable_land_face(&self) -> bool {
        self.is_land()
            || self
                .other_part
                .as_ref()
                .map(|p| p.type_line.is_land())
                .unwrap_or(false)
    }
    pub fn phase(&mut self) {
        self.phased_out = !self.phased_out;
    }
    pub fn associated_with_color(&self, game: &GameState, color: &str) -> bool {
        let mut colors = HashSet::new();
        colors.insert(color.to_string());
        forge_foundation::Color::from_name(&color.to_ascii_lowercase())
            .map(|parsed| self.color.has_any_color(parsed.mask()))
            .unwrap_or(false)
            || self.can_produce_color_mana(game, &colors)
    }
    pub fn has_no_name(&self) -> bool {
        self.card_name.trim().is_empty()
    }
    pub fn shares_name_with(&self, other: &Card) -> bool {
        self.card_name.eq_ignore_ascii_case(&other.card_name)
    }
    pub fn has_creature_type(&self, creature_type: &str) -> bool {
        if !self.is_creature() && !self.type_line.core_types.contains(&CoreType::Kindred) {
            return false;
        }
        if self.type_line.has_subtype(creature_type) {
            return true;
        }
        self.has_keyword("Changeling") && crate::game::TypeRegistry::is_creature_type(creature_type)
    }
    pub fn has_subtype(&self, subtype: &str) -> bool {
        self.type_line.has_subtype(subtype) || self.has_creature_type(subtype)
    }
    pub fn shares_color_with(&self, other: &Card) -> bool {
        (self.color.has_white() && other.color.has_white())
            || (self.color.has_blue() && other.color.has_blue())
            || (self.color.has_black() && other.color.has_black())
            || (self.color.has_red() && other.color.has_red())
            || (self.color.has_green() && other.color.has_green())
            || (self.color.is_colorless() && other.color.is_colorless())
    }
    pub fn shares_cmc_with(&self, other: &Card) -> bool {
        self.mana_value() == other.mana_value()
    }
    pub fn shares_creature_type_with(&self, other: &Card) -> bool {
        crate::game::TypeRegistry::creature_types()
            .iter()
            .any(|creature_type| {
                self.has_creature_type(creature_type) && other.has_creature_type(creature_type)
            })
    }
    pub fn shares_land_type_with(&self, other: &Card) -> bool {
        self.shares_creature_type_with(other) && self.is_land() && other.is_land()
    }
    pub fn shares_permanent_type_with(&self, other: &Card) -> bool {
        (self.is_creature() && other.is_creature())
            || (self.is_land() && other.is_land())
            || (self.type_line.is_artifact() && other.type_line.is_artifact())
            || (self.type_line.is_enchantment() && other.type_line.is_enchantment())
            || (self.type_line.is_planeswalker() && other.type_line.is_planeswalker())
    }
    pub fn shares_card_type_with(&self, other: &Card) -> bool {
        self.shares_permanent_type_with(other)
    }
    pub fn shares_all_card_types_with(&self, other: &Card) -> bool {
        self.type_line.core_types == other.type_line.core_types
    }
    pub fn shares_controller_with(&self, other: &Card) -> bool {
        self.controller == other.controller
    }
    pub fn has_a_basic_land_type(&self) -> bool {
        self.type_line.has_subtype("Plains")
            || self.type_line.has_subtype("Island")
            || self.type_line.has_subtype("Swamp")
            || self.type_line.has_subtype("Mountain")
            || self.type_line.has_subtype("Forest")
    }
    pub fn has_a_non_basic_land_type(&self) -> bool {
        self.is_land() && !self.has_a_basic_land_type()
    }
    pub fn has_dealt_damage_to_opponent_this_turn(&self) -> bool {
        self.total_damage_done_this_turn > 0
    }
    pub fn has_been_dealt_deathtouch_damage(&self) -> bool {
        self.has_deathtouch_damage
    }
    pub fn has_been_dealt_excess_damage_this_turn(&self) -> bool {
        self.damage > self.toughness()
    }
    pub fn log_excess_damage(&mut self) {
        self.set_s_var("ExcessDamageLogged", "True");
    }
    pub fn add_assigned_damage(&mut self, amount: i32) {
        self.assigned_damage += amount;
    }
    pub fn clear_assigned_damage(&mut self) {
        self.assigned_damage = 0;
    }
    pub fn can_damage_prevented(&self) -> bool {
        !self.has_keyword("Damage can't be prevented")
    }
    pub fn static_replace_damage(&self, amount: i32) -> i32 {
        amount
    }
    pub fn add_damage_after_prevention(&mut self, amount: i32) -> i32 {
        let dealt = if self.can_be_dealt_damage() {
            amount.max(0)
        } else {
            0
        };
        if dealt <= 0 {
            return 0;
        }
        if self.type_line.is_planeswalker() {
            self.remove_counter(&CounterType::Loyalty, dealt);
        }
        if self.type_line.core_types.contains(&CoreType::Battle) {
            self.remove_counter(&CounterType::Named("DEFENSE".to_string()), dealt);
        }
        if self.is_creature() {
            self.damage += dealt;
        }
        dealt
    }
    pub fn border_color(&self) -> &'static str {
        if self.color.is_colorless() {
            "Colorless"
        } else if self.color.has_white() {
            "White"
        } else if self.color.has_blue() {
            "Blue"
        } else if self.color.has_black() {
            "Black"
        } else if self.color.has_red() {
            "Red"
        } else {
            "Green"
        }
    }
    pub fn was_discarded(&self) -> bool {
        self.discarded
    }
    pub fn was_surveilled(&self) -> bool {
        self.surveilled
    }
    pub fn was_milled(&self) -> bool {
        self.milled
    }
    pub fn clear_ring_bearer(&mut self) {
        self.remove_s_var("RingBearer");
    }
    pub fn add_saddled_by_this_turn(&mut self, card: CardId) {
        self.set_s_var("SaddledBy", format!("{}", card.0));
    }
    pub fn reset_saddled(&mut self) {
        self.remove_s_var("SaddledBy");
    }
    pub fn can_specialize(&self) -> bool {
        self.has_keyword("Specialize")
    }
    pub fn can_crew(&self) -> bool {
        self.is_permanent()
    }
    pub fn reset_times_crewed_this_turn(&mut self) {
        self.times_crewed_this_turn = 0;
    }
    pub fn becomes_crewed(&mut self) {
        self.is_crewed = true;
        self.times_crewed_this_turn += 1;
    }
    pub fn reset_crewed(&mut self) {
        self.is_crewed = false;
    }
    pub fn add_crewed_by_this_turn(&mut self, _card: CardId) {
        self.times_crewed_this_turn += 1;
    }
    pub fn visit_attraction(&mut self) {
        self.visited_this_turn = true;
    }
    pub fn was_visited_this_turn(&self) -> bool {
        self.visited_this_turn
    }
    pub fn animate_bestow(&mut self) {
        self.is_bestowed = false;
    }
    pub fn unanimate_bestow(&mut self) {
        self.is_bestowed = true;
    }
    pub fn equals_with_game_timestamp(&self, other: &Card) -> bool {
        self.id == other.id && self.zone_timestamp == other.zone_timestamp
    }
    pub fn update_world_timestamp(&mut self) {
        self.zone_timestamp = self.zone_timestamp.saturating_add(1);
    }
    pub fn can_be_discarded_by(&self, _player: PlayerId) -> bool {
        true
    }
    pub fn can_be_destroyed(&self) -> bool {
        !self.has_indestructible()
    }
    pub fn can_be_targeted_by(&self, _player: PlayerId) -> bool {
        true
    }
    pub fn cant_be_attached_msg(&self) -> Option<String> {
        None
    }
    pub fn can_be_sacrificed_by(&self, _player: PlayerId) -> bool {
        true
    }
    pub fn can_exiled_by(&self, _player: PlayerId) -> bool {
        true
    }
    pub fn update_static_abilities(&mut self) {
        self.recompute_changed_card_traits();
    }
    pub fn update_triggers(&mut self) {
        self.recompute_changed_card_traits();
    }
    pub fn update_replacement_effects(&mut self) {
        self.recompute_changed_card_traits();
    }
    pub fn was_cast(&self) -> bool {
        // Mirrors Java `Card.wasCast()`: true iff `castFrom` was set during
        // cast resolution. Sneak Attack and other "put onto battlefield"
        // effects don't go through the cast pipeline and leave this `None`.
        self.cast_from.is_some()
    }
    pub fn on_end_of_combat(&mut self) {
        self.assigned_damage = 0;
    }
    pub fn on_cleanup_phase(&mut self) {
        self.became_target_this_turn = false;
        self.visited_this_turn = false;
        self.damage_prevention = 0;
    }
    pub fn has_etb_trigger(&self) -> bool {
        self.triggers.iter().any(|t| {
            t.kind == crate::trigger::TriggerType::ChangesZone
                && t.destination_zone() == Some(ZoneType::Battlefield)
        })
    }
    pub fn has_etb_replacement(&self) -> bool {
        self.has_replacement_effect()
    }
    pub fn can_move_to_command_zone(&self) -> bool {
        self.is_commander && self.move_to_command_zone
    }
    pub fn from_paper_card(&mut self) {
        self.is_token = false;
    }
    pub fn cleanup_copied_changes_from(&mut self) {
        self.clear_changed_card_traits();
    }
    pub fn activated_this_turn(&self) -> bool {
        self.ability_activated_this_turn > 0
    }
    pub fn add_ability_activated(&mut self) {
        self.ability_activated_this_turn += 1;
    }
    pub fn add_ability_activated_for(
        &mut self,
        ability: Option<&crate::spellability::SpellAbility>,
    ) {
        self.add_ability_activated_for_with_limit_increase(ability, false);
    }
    pub fn add_ability_activated_for_with_limit_increase(
        &mut self,
        ability: Option<&crate::spellability::SpellAbility>,
        loyalty_limit_increase: bool,
    ) {
        if let Some(ability) = ability {
            self.number_turn_activations.add(ability);
            self.number_game_activations.add(ability);
            if ability.ir.pw_ability {
                self.add_planeswalker_ability_activated(loyalty_limit_increase);
            }
        }
        self.add_ability_activated();
    }
    pub fn add_ability_resolved(&mut self) {
        self.ability_resolved_this_turn += 1;
    }
    pub fn add_ability_resolved_for(
        &mut self,
        ability: Option<&crate::spellability::SpellAbility>,
    ) {
        if let Some(ability) = ability {
            self.number_ability_resolved.add(ability);
        }
        self.add_ability_resolved();
    }
    pub fn get_ability_activated_this_turn(
        &self,
        ability: Option<&crate::spellability::SpellAbility>,
    ) -> u32 {
        ability
            .map(|ability| self.number_turn_activations.get(ability) as u32)
            .unwrap_or(0)
    }
    pub fn get_ability_activated_this_game(
        &self,
        ability: Option<&crate::spellability::SpellAbility>,
    ) -> u32 {
        ability
            .map(|ability| self.number_game_activations.get(ability) as u32)
            .unwrap_or(0)
    }
    pub fn get_ability_resolved_this_turn(
        &self,
        ability: Option<&crate::spellability::SpellAbility>,
    ) -> u32 {
        ability
            .map(|ability| self.number_ability_resolved.get(ability) as u32)
            .unwrap_or(0)
    }
    pub fn get_ability_resolved_this_turn_activators(
        &self,
        ability: Option<&crate::spellability::SpellAbility>,
    ) -> Vec<crate::ids::PlayerId> {
        ability
            .map(|ability| self.number_ability_resolved.get_activators(ability))
            .unwrap_or_default()
    }
    pub fn reset_ability_resolved_this_turn(&mut self) {
        self.ability_resolved_this_turn = 0;
        self.number_ability_resolved.clear();
    }
    pub fn add_chosen_modes(&mut self, modes: Vec<usize>, turn: u32) {
        self.chosen_modes = Some(modes);
        self.chosen_modes_turn = Some(turn);
    }
    pub fn reset_chosen_mode_turn(&mut self) {
        self.chosen_modes_turn = None;
        self.chosen_modes = None;
    }
    pub fn add_planeswalker_ability_activated(&mut self, loyalty_limit_increase: bool) {
        self.planeswalker_abilities_activated += 1;
        if self.planeswalker_abilities_activated == 2 && loyalty_limit_increase {
            self.planeswalker_activation_limit_used = true;
        }
    }
    pub fn planeswalker_activation_limit_used(&self) -> bool {
        self.planeswalker_activation_limit_used
    }
    pub fn reset_activations_per_turn(&mut self) {
        self.ability_activated_this_turn = 0;
        self.number_turn_activations.clear();
        self.planeswalker_abilities_activated = 0;
        self.planeswalker_activation_limit_used = false;
    }
    pub fn add_can_block_additional(&mut self, n: i32) {
        self.can_block_additional += n;
    }
    pub fn remove_can_block_additional(&mut self, n: i32) {
        self.can_block_additional = (self.can_block_additional - n).max(0);
    }
    pub fn can_block_additional(&self) -> i32 {
        self.can_block_additional
    }
    pub fn add_can_block_any(&mut self) {
        self.can_block_any = true;
    }
    pub fn remove_can_block_any(&mut self) {
        self.can_block_any = false;
    }
    pub fn can_block_any(&self) -> bool {
        self.can_block_any
    }
    pub fn ignore_legend_rule(&self) -> bool {
        self.ignore_legend_rule_flag
    }
    pub fn attack_vigilance(&self) -> bool {
        self.has_vigilance()
    }
    pub fn unlock_room(&mut self) {
        self.set_s_var("RoomLocked", "False");
    }
    pub fn lock_room(&mut self) {
        self.set_s_var("RoomLocked", "True");
    }
    pub fn update_rooms(&mut self) {
        if !self.has_s_var("RoomLocked") {
            self.set_s_var("RoomLocked", "False");
        }
    }

    /// Transform this double-faced card to its other face.
    /// Swaps all face-dependent characteristics with `other_part`.
    /// No-op if `other_part` is `None`.
    /// Mirrors Java's `CardUtil.applyState(card, CardStateName.Backside)`.
    pub fn transform(&mut self) {
        if let Some(other) = self.other_part.as_mut() {
            std::mem::swap(&mut self.card_name, &mut other.name);
            std::mem::swap(&mut self.type_line, &mut other.type_line);
            std::mem::swap(&mut self.mana_cost, &mut other.mana_cost);
            std::mem::swap(&mut self.color, &mut other.color);
            std::mem::swap(&mut self.base_power, &mut other.base_power);
            std::mem::swap(&mut self.base_toughness, &mut other.base_toughness);
            std::mem::swap(&mut self.keywords, &mut other.keywords);
            std::mem::swap(&mut self.abilities, &mut other.abilities);
            std::mem::swap(&mut self.triggers, &mut other.triggers);
            std::mem::swap(&mut self.static_abilities, &mut other.static_abilities);
            std::mem::swap(
                &mut self.replacement_effects,
                &mut other.replacement_effects,
            );
            std::mem::swap(&mut self.svars, &mut other.svars);

            // Reset per-face transient state
            self.power_modifier = 0;
            self.toughness_modifier = 0;
            self.damage = 0;
            self.granted_keywords.clear();

            // Re-parse activated abilities from new face's abilities
            self.activated_abilities = self
                .abilities
                .iter()
                .enumerate()
                .filter_map(|(i, raw)| {
                    parse_or_warn(parse_activated_ability(raw, i), "ActivatedAbility", raw)
                })
                .collect();
            self.base_ability_count = self.activated_abilities.len();
            self.base_trigger_count = self.triggers.len();
            self.parsed_svar_cache.clear();
            self.refresh_action_specs();

            // Re-bind replacement hosts so SVar lookups hit the active face.
            let mut res = std::mem::take(&mut self.replacement_effects);
            for re in &mut res {
                re.set_host_card(self);
            }
            self.replacement_effects = res;

            self.is_transformed = !self.is_transformed;

            // Face characteristics changed; reset trait-change baseline and
            // re-apply active trait-change layers against the new face.
            self.reset_changed_card_traits_baseline();
            self.recompute_changed_card_traits();
        }
    }

    fn activated_to_spell_abilities(&self, list: &[ActivatedAbility]) -> Vec<SpellAbility> {
        list.iter()
            .map(|ab| {
                let mut sa = crate::spellability::build_spell_ability_from_host_card(
                    self,
                    &ab.ability_text,
                    self.controller,
                );
                sa.is_activated = true;
                sa
            })
            .collect()
    }

    fn spell_to_activated_abilities(list: &[SpellAbility]) -> Vec<ActivatedAbility> {
        list.iter()
            .enumerate()
            .filter_map(|(i, sa)| parse_activated_ability(&sa.ability_text, i))
            .collect()
    }

    fn capture_changed_card_traits_baseline_if_needed(&mut self) {
        if self.trait_base_activated_abilities.is_none() {
            self.trait_base_activated_abilities = Some(self.activated_abilities.clone());
            self.trait_base_triggers = Some(self.triggers.clone());
            self.trait_base_replacement_effects = Some(self.replacement_effects.clone());
            self.trait_base_static_abilities = Some(self.static_abilities.clone());
            self.trait_base_keywords = Some(self.keywords.clone());
        }
    }

    fn reset_changed_card_traits_baseline(&mut self) {
        self.trait_base_activated_abilities = Some(self.activated_abilities.clone());
        self.trait_base_triggers = Some(self.triggers.clone());
        self.trait_base_replacement_effects = Some(self.replacement_effects.clone());
        self.trait_base_static_abilities = Some(self.static_abilities.clone());
        self.trait_base_keywords = Some(self.keywords.clone());
    }

    pub(crate) fn reset_changed_card_traits_baseline_to_current(&mut self) {
        self.reset_changed_card_traits_baseline();
        self.recompute_changed_card_traits();
    }

    fn recompute_changed_card_traits(&mut self) {
        let Some(base_activated) = self.trait_base_activated_abilities.clone() else {
            return;
        };
        let Some(base_triggers) = self.trait_base_triggers.clone() else {
            return;
        };
        let Some(base_replacements) = self.trait_base_replacement_effects.clone() else {
            return;
        };
        let Some(base_static) = self.trait_base_static_abilities.clone() else {
            return;
        };
        let Some(base_keywords) = self.trait_base_keywords.clone() else {
            return;
        };

        let mut spell_abilities = self.activated_to_spell_abilities(&base_activated);
        let mut triggers = base_triggers;
        let mut replacements = base_replacements;
        let mut static_abilities = base_static;
        let mut keywords = base_keywords;

        for layer in self.changed_card_traits_by_text.values() {
            spell_abilities = crate::card::card_state::apply_spell_ability(layer, spell_abilities);
            triggers = crate::card::card_state::apply_trigger(layer, triggers);
            replacements = crate::card::card_state::apply_replacement_effect(layer, replacements);
            static_abilities =
                crate::card::card_state::apply_static_ability(layer, static_abilities);
            keywords = crate::card::card_state::apply_keywords(layer, keywords);
        }
        for layer in self.changed_card_traits.values() {
            spell_abilities = crate::card::card_state::apply_spell_ability(layer, spell_abilities);
            triggers = crate::card::card_state::apply_trigger(layer, triggers);
            replacements = crate::card::card_state::apply_replacement_effect(layer, replacements);
            static_abilities =
                crate::card::card_state::apply_static_ability(layer, static_abilities);
            keywords = crate::card::card_state::apply_keywords(layer, keywords);
        }

        self.activated_abilities = Self::spell_to_activated_abilities(&spell_abilities);
        self.triggers = triggers;
        self.replacement_effects = replacements;
        self.static_abilities = static_abilities;
        self.keywords = keywords;
    }

    /// Java parity: `addChangedCardTraits`.
    pub fn add_changed_card_traits(
        &mut self,
        layer: card_trait_changes::CardTraitChanges,
        timestamp: i64,
        static_id: i64,
    ) {
        self.capture_changed_card_traits_baseline_if_needed();
        self.changed_card_traits
            .insert((timestamp, static_id), layer);
        self.recompute_changed_card_traits();
    }

    /// Java parity: `addChangedCardTraitsByText`.
    pub fn add_changed_card_traits_by_text(
        &mut self,
        layer: card_trait_changes::CardTraitChanges,
        timestamp: i64,
        static_id: i64,
    ) {
        self.capture_changed_card_traits_baseline_if_needed();
        self.changed_card_traits_by_text
            .insert((timestamp, static_id), layer);
        self.recompute_changed_card_traits();
    }

    /// Java parity: `removeChangedCardTraits`.
    pub fn remove_changed_card_traits(&mut self, timestamp: i64, static_id: i64) -> bool {
        if self
            .changed_card_traits
            .remove(&(timestamp, static_id))
            .is_none()
        {
            return false;
        }
        if self.changed_card_traits.is_empty() && self.changed_card_traits_by_text.is_empty() {
            if let Some(v) = self.trait_base_activated_abilities.take() {
                self.activated_abilities = v;
            }
            if let Some(v) = self.trait_base_triggers.take() {
                self.triggers = v;
            }
            if let Some(v) = self.trait_base_replacement_effects.take() {
                self.replacement_effects = v;
            }
            if let Some(v) = self.trait_base_static_abilities.take() {
                self.static_abilities = v;
            }
            if let Some(v) = self.trait_base_keywords.take() {
                self.keywords = v;
            }
            return true;
        }

        self.recompute_changed_card_traits();
        true
    }

    /// Java parity: `removeChangedCardTraitsByText`.
    pub fn remove_changed_card_traits_by_text(&mut self, timestamp: i64, static_id: i64) -> bool {
        if self
            .changed_card_traits_by_text
            .remove(&(timestamp, static_id))
            .is_none()
        {
            return false;
        }
        if self.changed_card_traits.is_empty() && self.changed_card_traits_by_text.is_empty() {
            if let Some(v) = self.trait_base_activated_abilities.take() {
                self.activated_abilities = v;
            }
            if let Some(v) = self.trait_base_triggers.take() {
                self.triggers = v;
            }
            if let Some(v) = self.trait_base_replacement_effects.take() {
                self.replacement_effects = v;
            }
            if let Some(v) = self.trait_base_static_abilities.take() {
                self.static_abilities = v;
            }
            if let Some(v) = self.trait_base_keywords.take() {
                self.keywords = v;
            }
            return true;
        }

        self.recompute_changed_card_traits();
        true
    }

    /// Java parity: `clearChangedCardTraits`.
    pub fn clear_changed_card_traits(&mut self) {
        self.changed_card_traits.clear();
        self.changed_card_traits_by_text.clear();
        if let Some(v) = self.trait_base_activated_abilities.take() {
            self.activated_abilities = v;
        }
        if let Some(v) = self.trait_base_triggers.take() {
            self.triggers = v;
        }
        if let Some(v) = self.trait_base_replacement_effects.take() {
            self.replacement_effects = v;
        }
        if let Some(v) = self.trait_base_static_abilities.take() {
            self.static_abilities = v;
        }
        if let Some(v) = self.trait_base_keywords.take() {
            self.keywords = v;
        }
    }

    /// Clear continuous static-ability trait changes from the previous layer pass.
    ///
    /// Static layer effects use negative static IDs so they can be recomputed
    /// each pass without disturbing perpetual/card-state trait changes.
    pub fn clear_static_layer_changed_card_traits(&mut self) {
        let before = self.changed_card_traits.len();
        self.changed_card_traits
            .retain(|(_, static_id), _| *static_id >= 0);
        if self.changed_card_traits.len() == before {
            return;
        }
        if self.changed_card_traits.is_empty() && self.changed_card_traits_by_text.is_empty() {
            if let Some(v) = self.trait_base_activated_abilities.take() {
                self.activated_abilities = v;
            }
            if let Some(v) = self.trait_base_triggers.take() {
                self.triggers = v;
            }
            if let Some(v) = self.trait_base_replacement_effects.take() {
                self.replacement_effects = v;
            }
            if let Some(v) = self.trait_base_static_abilities.take() {
                self.static_abilities = v;
            }
            if let Some(v) = self.trait_base_keywords.take() {
                self.keywords = v;
            }
            return;
        }

        self.recompute_changed_card_traits();
    }

    pub fn remove_changed_state(&mut self) {
        self.clear_changed_card_traits();
    }
}

impl HasSVars for Card {
    fn get_svar(&self, name: &str) -> Option<&str> {
        self.get_s_var(name)
    }

    fn set_svar(&mut self, name: String, value: String) {
        self.set_s_var(name, value);
    }

    fn set_svars(&mut self, new_svars: std::collections::HashMap<String, String>) {
        self.set_svars_map(new_svars.into_iter().collect());
    }

    fn get_svars(&self) -> &std::collections::HashMap<String, String> {
        panic!("Card::get_svars is not supported yet; use get_s_var/has_s_var parity accessors");
    }

    fn remove_svar(&mut self, var: &str) {
        self.remove_s_var(var);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    use forge_carddb::parse_card_script;
    use forge_foundation::ManaCost;

    #[test]
    fn card_power_toughness() {
        let mut card = Card::new(
            CardId(0),
            "Test".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        assert_eq!(card.power(), 2);
        assert_eq!(card.toughness(), 2);

        card.add_counter(&CounterType::P1P1, 1);
        assert_eq!(card.power(), 3);
        assert_eq!(card.toughness(), 3);
    }

    #[test]
    fn can_attack() {
        let mut card = Card::new(
            CardId(0),
            "Test".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        card.zone = ZoneType::Battlefield;
        assert!(!card.can_attack()); // summoning sick

        card.summoning_sick = false;
        assert!(card.can_attack());

        card.tapped = true;
        assert!(!card.can_attack()); // tapped
    }

    #[test]
    fn haste_bypasses_summoning_sickness() {
        let mut card = Card::new(
            CardId(0),
            "Test".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec!["Haste".to_string()],
            vec![],
        );
        card.zone = ZoneType::Battlefield;
        assert!(card.can_attack()); // haste means no summoning sickness check
    }

    #[test]
    fn keyword_helpers() {
        let card = Card::new(
            CardId(0),
            "Test".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![
                "Hexproof".to_string(),
                "Menace".to_string(),
                "Indestructible".to_string(),
            ],
            vec![],
        );
        assert!(card.has_hexproof());
        assert!(card.has_menace());
        assert!(card.has_indestructible());
        assert!(!card.has_shroud());
        assert!(!card.has_fear());
        assert!(!card.has_shadow());
    }

    #[test]
    fn protection_from_color() {
        let knight = Card::new(
            CardId(0),
            "White Knight".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Knight"),
            ManaCost::parse("W W"),
            ColorSet::WHITE,
            Some(2),
            Some(2),
            vec!["Protection from black".to_string()],
            vec![],
        );
        let black_source = Card::new(
            CardId(1),
            "Doom Blade".to_string(),
            PlayerId(1),
            CardTypeLine::parse("Instant"),
            ManaCost::parse("1 B"),
            ColorSet::BLACK,
            None,
            None,
            vec![],
            vec![],
        );
        let green_source = Card::new(
            CardId(2),
            "Giant Growth".to_string(),
            PlayerId(1),
            CardTypeLine::parse("Instant"),
            ManaCost::parse("G"),
            ColorSet::GREEN,
            None,
            None,
            vec![],
            vec![],
        );
        assert!(knight.is_protected_from(&black_source));
        assert!(!knight.is_protected_from(&green_source));
        assert!(knight.has_protection_from("black"));
        assert!(!knight.has_protection_from("red"));
    }

    #[test]
    fn ward_and_toxic_parsing() {
        let ward_card = Card::new(
            CardId(0),
            "Ward Bear".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 U"),
            ColorSet::BLUE,
            Some(2),
            Some(2),
            vec!["Ward:2".to_string()],
            vec![],
        );
        assert_eq!(ward_card.get_ward_cost(), Some("2".to_string()));

        let toxic_card = Card::new(
            CardId(1),
            "Toxic Elf".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Elf"),
            ManaCost::parse("G"),
            ColorSet::GREEN,
            Some(1),
            Some(1),
            vec!["Toxic:1".to_string()],
            vec![],
        );
        assert_eq!(toxic_card.get_toxic_count(), Some(1));

        // No ward/toxic
        let plain = Card::new(
            CardId(2),
            "Bear".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        assert_eq!(plain.get_ward_cost(), None);
        assert_eq!(plain.get_toxic_count(), None);
    }

    #[test]
    fn from_rules_copies_attraction_lights() {
        let rules = parse_card_script(
            "Name:Balloon Stand\nTypes:Artifact Attraction\nLights: 2 4 6\nOracle:Test.",
        )
        .expect("card script should parse");
        let card = Card::from_rules(&rules, PlayerId(0));
        assert_eq!(card.attraction_lights, vec![2, 4, 6]);
        assert!(card.has_attraction_light(4));
        assert!(!card.has_attraction_light(3));
    }

    #[test]
    fn can_produce_color_mana_uses_mana_abilities_and_reflection() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let white_land = Card::new(
            CardId(0),
            "White Source".to_string(),
            p0,
            CardTypeLine::parse("Land"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec!["AB$ Mana | Cost$ T | Produced$ W | SpellDescription$ Add {W}.".to_string()],
        );
        let reflecting_pool = Card::new(
            CardId(1),
            "Reflecting Pool".to_string(),
            p0,
            CardTypeLine::parse("Land"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec!["AB$ ManaReflected | Cost$ T | Valid$ Land.YouCtrl | ReflectProperty$ Produce | ColorOrType$ Type | Produced$ W | SpellDescription$ Add one mana of any type that a land you control could produce.".to_string()],
        );

        let white_id = game.create_card(white_land);
        let pool_id = game.create_card(reflecting_pool);
        game.move_card(white_id, ZoneType::Battlefield, p0);
        game.move_card(pool_id, ZoneType::Battlefield, p0);

        let mut white = HashSet::new();
        white.insert("white".to_string());
        assert!(game.card(white_id).can_produce_color_mana(&game, &white));
        assert!(game.card(pool_id).can_produce_color_mana(&game, &white));
    }

    #[test]
    fn can_produce_same_mana_type_with_uses_mana_ability_overlap() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let island = Card::new(
            CardId(0),
            "Island Source".to_string(),
            p0,
            CardTypeLine::parse("Land"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec!["AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add {U}.".to_string()],
        );
        let prism = Card::new(
            CardId(1),
            "Prism".to_string(),
            p0,
            CardTypeLine::parse("Artifact"),
            ManaCost::parse("2"),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec!["AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add {U}.".to_string()],
        );

        let island_id = game.create_card(island);
        let prism_id = game.create_card(prism);
        game.move_card(island_id, ZoneType::Battlefield, p0);
        game.move_card(prism_id, ZoneType::Battlefield, p0);

        assert!(game
            .card(prism_id)
            .can_produce_same_mana_type_with(&game, game.card(island_id)));
    }
}
