use forge_foundation::mana::ManaAtom;
use forge_foundation::ZoneType;

use crate::ability::{ProducedMana, ProducedManaCombo};
use crate::agent::PlayerAgent;
use crate::card::Card;
use crate::cost::CostPart;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

pub mod auto_pay;
pub mod computer_util_mana;
pub mod mana_conversion_matrix;
pub mod mana_cost_being_paid;
pub mod mana_pool;
pub mod mana_refund_service;
pub use auto_pay::{
    pay_mana_cost_auto, pay_mana_cost_auto_with_callback,
    pay_mana_cost_auto_with_callback_and_reserved_sacrifices, pay_mana_cost_auto_with_chooser,
    AutoPayResult,
};

pub fn apply_player_life_payment_keywords(
    game: &GameState,
    player: PlayerId,
    cost: &forge_foundation::ManaCost,
) -> forge_foundation::ManaCost {
    let mut result = cost.clone();
    if crate::player::has_keyword(game, player, "PayLifeInsteadOf:W") {
        result = result.colored_to_phyrexian(ManaAtom::WHITE as u8);
    }
    if crate::player::has_keyword(game, player, "PayLifeInsteadOf:U") {
        result = result.colored_to_phyrexian(ManaAtom::BLUE as u8);
    }
    if crate::player::has_keyword(game, player, "PayLifeInsteadOf:B") {
        result = result.colored_to_phyrexian(ManaAtom::BLACK as u8);
    }
    if crate::player::has_keyword(game, player, "PayLifeInsteadOf:R") {
        result = result.colored_to_phyrexian(ManaAtom::RED as u8);
    }
    if crate::player::has_keyword(game, player, "PayLifeInsteadOf:G") {
        result = result.colored_to_phyrexian(ManaAtom::GREEN as u8);
    }
    result
}

pub(crate) fn mana_ability_meets_script_requirements(
    game: &GameState,
    card_id: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
) -> bool {
    let card = game.card(card_id);
    let requirements = crate::card::valid_filter::CardTraitRequirementsIr::from_key_values(
        ab.params
            .inner()
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str())),
        None,
        None,
    );
    requirements.meets(game, card, card)
}

pub use computer_util_mana::{
    auto_tap_lands, auto_tap_lands_allow_reserved_source_reuse,
    auto_tap_lands_allow_reserved_source_reuse_trace,
    auto_tap_lands_allow_reserved_source_reuse_trace_with_callbacks_and_reserved_sacrifices,
    auto_tap_lands_allow_reserved_source_reuse_with_callbacks,
    auto_tap_lands_allow_reserved_source_reuse_with_callbacks_and_reserved_sacrifices,
    auto_tap_lands_allow_reserved_source_reuse_with_chooser, auto_tap_lands_generic,
    auto_tap_lands_trace, auto_tap_lands_trace_with_callbacks, auto_tap_lands_with_callbacks,
    auto_tap_lands_with_chooser, can_pay_mana_cost_with_reserved_sacrifices,
    can_pay_spell_mana_cost_for_action_space, collect_mana_payment_sources, next_auto_tap_choice,
    next_auto_tap_choice_with_reserved_sacrifices, AutoTapChoice, ManaPayCallback,
    ManaPayCallbackFn, ManaPaymentSources, SacrificeChooser,
};

impl ProducedMana {
    pub fn to_atoms(&self, chosen_colors: &[String]) -> Vec<u16> {
        let mut atoms = Vec::new();
        match self {
            Self::Any => add_any_colors(&mut atoms),
            Self::Chosen => return chosen_colors_to_atoms(chosen_colors),
            Self::Combo(combo) => match combo {
                ProducedManaCombo::Any => add_any_colors(&mut atoms),
                ProducedManaCombo::Chosen => {
                    for atom in chosen_colors_to_atoms(chosen_colors) {
                        unique_push(&mut atoms, atom);
                    }
                }
                ProducedManaCombo::ColorIdentity => {}
                ProducedManaCombo::Colors(colors) => {
                    for color in colors {
                        if let Some(atom) = mana_atom_from_produced(color) {
                            unique_push(&mut atoms, atom);
                        }
                    }
                }
                ProducedManaCombo::Raw(raw) => {
                    for part in raw.split_whitespace() {
                        if part.eq_ignore_ascii_case("Any") {
                            add_any_colors(&mut atoms);
                        } else if part.eq_ignore_ascii_case("Chosen") {
                            for atom in chosen_colors_to_atoms(chosen_colors) {
                                unique_push(&mut atoms, atom);
                            }
                        } else if let Some(atom) = mana_atom_from_produced(part) {
                            unique_push(&mut atoms, atom);
                        }
                    }
                }
            },
            Self::Special(_) => {}
            Self::Fixed(tokens) => {
                for part in tokens.iter().flat_map(|token| token.split_whitespace()) {
                    if let Some(atom) = mana_atom_from_produced(part) {
                        unique_push(&mut atoms, atom);
                    }
                }
            }
            Self::Raw(raw) => {
                for part in raw.split_whitespace() {
                    if let Some(atom) = mana_atom_from_produced(part) {
                        unique_push(&mut atoms, atom);
                    }
                }
            }
        }
        atoms
    }

    pub fn fixed_atoms(&self) -> Option<Vec<u16>> {
        let tokens = self.fixed_tokens()?;
        if tokens.len() <= 1 {
            return None;
        }

        let mut atoms = Vec::with_capacity(tokens.len());
        for part in tokens {
            atoms.push(mana_atom_from_produced(part)?);
        }
        Some(atoms)
    }

    pub fn to_color_names(&self, chosen_colors: &[String]) -> Vec<String> {
        let mut colors = Vec::new();
        for atom in self.to_atoms(chosen_colors) {
            if let Some(name) = mana_atom_to_color_name(atom) {
                colors.push(name.to_string());
            }
        }
        colors
    }
}

/// An individual mana object in the pool, tracking source and properties.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mana {
    pub color: u16,
    pub source_card: Option<CardId>,
    pub is_snow: bool,
    /// Mana that persists across all phase transitions (Omnath, Kruphix).
    pub is_persistent: bool,
    /// Mana that persists through combat phases but empties at end of combat.
    pub is_combat_mana: bool,
    /// Restriction on what this mana can be spent on (from RestrictValid$).
    /// e.g. "Spell.Creature", "Spell.Artifact", "Activated", "nonSpell".
    pub restriction: Option<String>,
    /// If true, spells paid with this mana can't be countered (Cavern of Souls).
    pub adds_no_counter: bool,
    /// Keywords to add to spells cast with this mana (e.g. "Haste" from Generator Servant).
    /// Format: "Keyword" with optional valid filter "Keyword|ValidFilter" (e.g. "Haste|Spell.Creature").
    pub adds_keywords: Option<String>,
    /// Valid filter for which spells get the keywords (e.g. "Spell.Creature").
    pub adds_keywords_valid: Option<String>,
    /// Counter spec to add to permanents cast with this mana (e.g. "P1P1" from Guildmages' Forum).
    pub adds_counters: Option<String>,
    /// Valid filter for which cards get the counters.
    pub adds_counters_valid: Option<String>,
    /// SVar name of a trigger to fire when this mana is spent to cast a spell.
    /// The SVar lives on the source card (identified by `source_card`).
    pub triggers_when_spent: Option<String>,
}

impl Mana {
    pub fn simple(color: u16) -> Self {
        Self {
            color,
            source_card: None,
            is_snow: false,
            is_persistent: false,
            is_combat_mana: false,
            restriction: None,
            adds_no_counter: false,
            adds_keywords: None,
            adds_keywords_valid: None,
            adds_counters: None,
            adds_counters_valid: None,
            triggers_when_spent: None,
        }
    }

    /// Whether spells paid with this mana can't be countered.
    /// Mirrors Java's `Mana.addsNoCounterMagic()`.
    pub fn adds_no_counter_magic(&self) -> bool {
        self.adds_no_counter
    }

    /// Whether this mana adds counters to permanents cast with it.
    /// Mirrors Java's `Mana.addsCounters()`.
    pub fn adds_counters(&self) -> bool {
        self.adds_counters.is_some()
    }

    /// Whether this mana adds keywords to spells cast with it.
    /// Mirrors Java's `Mana.addsKeywords()`.
    pub fn adds_keywords(&self) -> bool {
        self.adds_keywords.is_some()
    }

    /// Whether this mana adds keywords with a type restriction.
    /// Mirrors Java's `Mana.addsKeywordsType()`.
    pub fn adds_keywords_type(&self) -> bool {
        self.adds_keywords_valid.is_some()
    }

    /// Whether this mana adds keywords with a duration.
    /// Mirrors Java's `Mana.addsKeywordsUntil()`.
    pub fn adds_keywords_until(&self) -> bool {
        // Duration is implicit — keywords from mana last until end of turn
        self.adds_keywords.is_some()
    }

    /// Whether this mana has a trigger-when-spent effect.
    /// Mirrors Java's `Mana.triggersWhenSpent()`.
    pub fn triggers_when_spent(&self) -> bool {
        self.triggers_when_spent.is_some()
    }
}

/// Context about what a mana payment is for, used to check restrictions.
#[derive(Debug, Clone, Default)]
pub struct ManaPaymentContext {
    /// True if paying for a spell (not an ability).
    pub is_spell: bool,
    /// True if paying for an activated ability's cost. Distinct from
    /// `is_spell` so triggered abilities and effect-driven costs (UnlessCost,
    /// cumulative upkeep, …) are neither spell nor activated.
    pub is_activated_ability: bool,
    /// True when this is the *actual* payment phase for a spell already
    /// announced on the stack — i.e. cast_spell.rs has already moved the
    /// card to `Stack` and is now running auto-pay. Java parity: mirrors
    /// `AbilityManaPart.meetsManaRestrictions` line 438 — if the SA we're
    /// paying for is currently on the stack, restricted mana sources whose
    /// `RestrictValid$ Spell` (or similar) clause would otherwise apply are
    /// rejected. This matches Forge's behaviour where Leyline-Immersion-
    /// style grants are effectively unusable for the cast they were
    /// announced for, leaving only unrestricted producers in the pool.
    /// Default is `false` so playability prediction stays optimistic.
    pub sa_on_stack: bool,
    /// Card type line of the spell being cast OR the source of the activated
    /// ability being paid for (for type checks like `Activated.Elemental`).
    pub type_line: Option<forge_foundation::CardTypeLine>,
    /// Subtypes of the spell being cast.
    pub card_name: Option<String>,
    /// Color of the spell being cast (for `Spell.Colorless`-style qualifiers).
    pub card_color: Option<forge_foundation::ColorSet>,
    /// Chosen creature/card types keyed by mana source card ID (e.g. Cavern of Souls).
    pub chosen_types_by_source: std::collections::HashMap<CardId, String>,
}

pub fn payment_context_for_sa(game: &GameState, sa: &SpellAbility) -> ManaPaymentContext {
    let (type_line, card_name, card_color) = if let Some(source) = sa.source {
        let card = game.card(source);
        (
            Some(card.type_line.clone()),
            Some(card.card_name.clone()),
            Some(card.color),
        )
    } else {
        (None, None, None)
    };

    ManaPaymentContext {
        is_spell: sa.is_spell,
        is_activated_ability: sa.is_activated,
        // `payment_context_for_sa` is used for activated-ability cost
        // calculations and AI lookahead — neither is the real cast-time
        // payment of a spell on stack. Leave the SA-on-stack guard off so
        // restricted-spell statics are still considered for those callers.
        sa_on_stack: false,
        type_line,
        card_name,
        card_color,
        chosen_types_by_source: game
            .cards
            .iter()
            .filter_map(|c| c.chosen_type.clone().map(|chosen| (c.id, chosen)))
            .collect(),
    }
}

/// Check if a mana with the given restriction can be spent in the given context.
pub fn mana_meets_restriction(restriction: &str, ctx: &ManaPaymentContext) -> bool {
    // Multiple comma-separated restrictions: any match is OK (OR logic)
    for part in restriction.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if check_single_restriction(part, ctx) {
            return true;
        }
    }
    false
}

fn check_single_restriction(restriction: &str, ctx: &ManaPaymentContext) -> bool {
    match restriction {
        "nonSpell" => !ctx.is_spell,
        "Activated" => ctx.is_activated_ability,
        "Spell" => ctx.is_spell,
        _ if restriction.starts_with("Spell.") => {
            if !ctx.is_spell {
                return false;
            }
            let type_check = &restriction[6..]; // After "Spell."
            if let Some(ref tl) = ctx.type_line {
                match type_check {
                    "Creature" => tl.is_creature(),
                    "Artifact" => tl.is_artifact(),
                    "Enchantment" => tl.is_enchantment(),
                    "Instant" => tl.is_instant(),
                    "Sorcery" => tl.is_sorcery(),
                    "Planeswalker" => tl.is_planeswalker(),
                    "Land" => tl.is_land(),
                    other => {
                        // Check subtype (e.g. "Spell.Dragon", "Spell.Lesson")
                        // Handle compound checks with + (e.g. "Creature+Dragon")
                        if let Some((base, sub)) = other.split_once('+') {
                            let base_ok = match base {
                                "Creature" => tl.is_creature(),
                                "Artifact" => tl.is_artifact(),
                                _ => tl.has_subtype(base),
                            };
                            let sub_ok = match sub {
                                "Colorless" => ctx.card_color.is_some_and(|c| c.is_colorless()),
                                "Multicolor" => ctx.card_color.is_some_and(|c| c.is_multicolor()),
                                _ => tl.has_subtype(sub),
                            };
                            base_ok && sub_ok
                        } else {
                            tl.has_subtype(other)
                        }
                    }
                }
            } else {
                false
            }
        }
        _ if restriction.starts_with("Activated.") => {
            // `Activated.X` requires paying for an activated ability whose
            // SOURCE matches X (e.g. Flamebraider's mana is restricted to
            // "abilities of Elemental sources"). Triggered abilities and
            // effect-payment costs (UnlessCost) are neither.
            if !ctx.is_activated_ability {
                return false;
            }
            let type_check = &restriction[10..]; // After "Activated."
            let Some(tl) = ctx.type_line.as_ref() else {
                return false;
            };
            match type_check {
                "Creature" => tl.is_creature(),
                "Artifact" => tl.is_artifact(),
                "Enchantment" => tl.is_enchantment(),
                "Land" => tl.is_land(),
                "Planeswalker" => tl.is_planeswalker(),
                other => {
                    if let Some((base, sub)) = other.split_once('+') {
                        let base_ok = match base {
                            "Creature" => tl.is_creature(),
                            "Artifact" => tl.is_artifact(),
                            _ => tl.has_subtype(base),
                        };
                        base_ok && tl.has_subtype(sub)
                    } else {
                        tl.has_subtype(other)
                    }
                }
            }
        }
        _ if restriction.starts_with("CantPayGenericCosts") => true, // handled separately in payment
        _ if restriction.starts_with("CantCast") => true, // zone restrictions handled elsewhere
        _ => true,                                        // Unknown restriction — be permissive
    }
}

// ManaPool moved to mana_pool.rs — single source of truth.
pub use mana_pool::ManaPool;

// ── Mana helpers ────────────────────────────────────────────────────

/// Determine what mana atom a basic land produces based on its subtypes.
pub fn basic_land_mana_atom(card: &Card) -> Option<u16> {
    if card.type_line.has_subtype("Plains") {
        Some(ManaAtom::WHITE)
    } else if card.type_line.has_subtype("Island") {
        Some(ManaAtom::BLUE)
    } else if card.type_line.has_subtype("Swamp") {
        Some(ManaAtom::BLACK)
    } else if card.type_line.has_subtype("Mountain") {
        Some(ManaAtom::RED)
    } else if card.type_line.has_subtype("Forest") {
        Some(ManaAtom::GREEN)
    } else {
        // Check card name as fallback
        match card.card_name.as_str() {
            "Plains" => Some(ManaAtom::WHITE),
            "Island" => Some(ManaAtom::BLUE),
            "Swamp" => Some(ManaAtom::BLACK),
            "Mountain" => Some(ManaAtom::RED),
            "Forest" => Some(ManaAtom::GREEN),
            _ => None,
        }
    }
}

/// Convert a Produced$ value (e.g. "G", "R", "W") to a ManaAtom.
pub fn mana_atom_from_produced(produced: &str) -> Option<u16> {
    match produced.trim() {
        "W" => Some(ManaAtom::WHITE),
        "U" => Some(ManaAtom::BLUE),
        "B" => Some(ManaAtom::BLACK),
        "R" => Some(ManaAtom::RED),
        "G" => Some(ManaAtom::GREEN),
        "C" => Some(ManaAtom::COLORLESS),
        _ => None,
    }
}

pub(crate) fn mana_atom_to_color_name(atom: u16) -> Option<&'static str> {
    match atom {
        ManaAtom::WHITE => Some("White"),
        ManaAtom::BLUE => Some("Blue"),
        ManaAtom::BLACK => Some("Black"),
        ManaAtom::RED => Some("Red"),
        ManaAtom::GREEN => Some("Green"),
        ManaAtom::COLORLESS => Some("Colorless"),
        _ => None,
    }
}

fn unique_push(atoms: &mut Vec<u16>, atom: u16) {
    if !atoms.contains(&atom) {
        atoms.push(atom);
    }
}

fn add_any_colors(atoms: &mut Vec<u16>) {
    unique_push(atoms, ManaAtom::WHITE);
    unique_push(atoms, ManaAtom::BLUE);
    unique_push(atoms, ManaAtom::BLACK);
    unique_push(atoms, ManaAtom::RED);
    unique_push(atoms, ManaAtom::GREEN);
}

fn chosen_colors_to_atoms(chosen_colors: &[String]) -> Vec<u16> {
    let mut atoms = Vec::new();
    for chosen in chosen_colors {
        if let Some(atom) = color_name_to_mana_atom(chosen) {
            unique_push(&mut atoms, atom);
            continue;
        }
        if let Some(atom) = mana_atom_from_produced(chosen) {
            unique_push(&mut atoms, atom);
        }
    }
    atoms
}

/// Convert a single mana letter ("G", "U", etc.) to its color name ("Green", "Blue", etc.).
pub fn mana_letter_to_color_name(letter: &str) -> Option<String> {
    match letter.trim() {
        "W" => Some("White".to_string()),
        "U" => Some("Blue".to_string()),
        "B" => Some("Black".to_string()),
        "R" => Some("Red".to_string()),
        "G" => Some("Green".to_string()),
        "C" => Some("Colorless".to_string()),
        _ => None,
    }
}

/// Compute the atoms a ManaReflected ability can produce by inspecting other
/// permanents on the battlefield.  Used by both `calculate_available_mana` and
/// `group_sources_by_mana_color` (auto-pay).
pub(crate) fn compute_reflected_atoms(
    game: &GameState,
    player: PlayerId,
    card_id: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
) -> Vec<u16> {
    let sa = crate::ability::ability_factory::build_spell_ability(
        game,
        card_id,
        &ab.ability_text,
        player,
    );
    let colors = crate::card::card_util::get_reflectable_mana_colors(game, &sa);
    // Java parity: harness AutoPay sorts reflectable colours into canonical
    // WUBRG(C) order before deriving atoms (see AutoPay.producedAtoms). Mirror
    // that order here so generic-shard `produced.get(0)` matches on both sides.
    let mut reflected_atoms = Vec::new();
    for (name, atom) in [
        ("white", ManaAtom::WHITE),
        ("blue", ManaAtom::BLUE),
        ("black", ManaAtom::BLACK),
        ("red", ManaAtom::RED),
        ("green", ManaAtom::GREEN),
        ("colorless", ManaAtom::COLORLESS),
    ] {
        if colors.contains(name) || colors.contains(&capitalize_color(name)) {
            reflected_atoms.push(atom);
        }
    }
    reflected_atoms
}

/// Convert a color name ("Green", "Blue", etc.) to its ManaAtom constant.
/// Case-insensitive: accepts "white", "White", "WHITE", etc.
pub fn color_name_to_mana_atom(name: &str) -> Option<u16> {
    match name.to_ascii_lowercase().as_str() {
        "white" => Some(ManaAtom::WHITE),
        "blue" => Some(ManaAtom::BLUE),
        "black" => Some(ManaAtom::BLACK),
        "red" => Some(ManaAtom::RED),
        "green" => Some(ManaAtom::GREEN),
        "colorless" => Some(ManaAtom::COLORLESS),
        _ => None,
    }
}

/// Capitalize a lowercase color name: "white" → "White".
pub fn capitalize_color(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

/// Returns all ManaAtom values that correspond to the card's basic land subtypes.
/// Multi-subtype lands (e.g. Breeding Pool = Forest + Island) return all matching atoms.
/// Unlike `basic_land_mana_atom`, this returns ALL subtypes not just the first match.
pub(crate) fn all_basic_subtype_atoms(card: &Card) -> Vec<u16> {
    let mut atoms = Vec::new();
    let subtypes = [
        ("Plains", ManaAtom::WHITE),
        ("Island", ManaAtom::BLUE),
        ("Swamp", ManaAtom::BLACK),
        ("Mountain", ManaAtom::RED),
        ("Forest", ManaAtom::GREEN),
    ];
    for (subtype, atom) in &subtypes {
        if card.type_line.has_subtype(subtype) && !atoms.contains(atom) {
            atoms.push(*atom);
        }
    }
    atoms
}

pub(crate) fn tap_land_for_mana(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    land_id: CardId,
    atom: u16,
    should_tap: bool,
    tapped_lands: &mut Vec<CardId>,
    ability_index: Option<usize>,
) {
    let _ = player;
    let card = game.card(land_id);
    let is_snow = card.type_line.is_snow();
    // Pull `TriggersWhenSpent$` metadata from the specific mana ability
    // being activated (Path of Ancestry's `TrigScry`, etc.) so the produced
    // mana carries the trigger SVar through cost payment. Without this the
    // fast-path `auto_pay` flow strips the metadata that the SP$ Mana
    // resolution would normally set in `mana_effect`.
    let triggers_when_spent = ability_index
        .and_then(|idx| card.activated_abilities.get(idx))
        .and_then(|ab| ab.triggers_when_spent.clone());
    if should_tap && !card.tapped {
        game.tap(land_id);
    }
    let mut mana = if is_snow {
        let mut m = crate::mana::Mana::simple(atom);
        m.is_snow = true;
        m
    } else {
        crate::mana::Mana::simple(atom)
    };
    mana.source_card = Some(land_id);
    mana.triggers_when_spent = triggers_when_spent;
    if std::env::var("FORGE_PAYMENT_TRACE").is_ok() {
        let card_name = game.card(land_id).card_name.clone();
        let turn = game.turn.turn_number;
        let phase = format!("{:?}", game.turn.phase);
        eprintln!(
            "[pay-trace-rust] T{} {} P{:?} tap_land_for_mana card={}#{:?} atom={} pool_total={} ability_idx={:?}",
            turn,
            phase,
            player,
            card_name,
            land_id,
            ManaPool::atom_to_letter(atom),
            pool.total_mana(),
            ability_index,
        );
    }
    pool.add_mana(mana);
    tapped_lands.push(land_id);
}

/// Returns all ManaAtom values a land can produce from its activated mana abilities.
/// Handles:
/// - Single color (`Produced$ G`) → that atom
/// - Combo (`Produced$ Combo G U`) → all listed atoms
/// - Combo ColorIdentity → nothing (non-Commander game; no commander identity)
/// - Colorless (`Produced$ C`) → COLORLESS
/// - Implicit basic-land-subtype abilities (e.g. Breeding Pool = Forest + Island → G + U)
pub fn land_mana_atoms(card: &Card) -> Vec<u16> {
    let mut atoms = Vec::new();
    for ab in &card.activated_abilities {
        if !ab.is_mana_ability {
            continue;
        }
        // Java parity: don't treat mana abilities with mana activation costs as free
        // producers during static source detection.
        if ab
            .cost
            .parts
            .iter()
            .any(|p| matches!(p, CostPart::Mana { .. }))
        {
            continue;
        }
        if let Some(produced_ir) = ab.produced_ir.as_ref() {
            if produced_ir.is_combo_color_identity() {
                // In a non-Commander game there is no commander identity, so this land
                // produces no mana — matches Java Forge's ManaEffect which skips
                // the mana production entirely when the choice string is empty.
                // (Java: ManaEffect.java line 141-143: "No mana could be produced here")
            } else {
                for atom in produced_ir.to_atoms(&card.chosen_colors) {
                    if !atoms.contains(&atom) {
                        atoms.push(atom);
                    }
                }
            }
        }
    }
    // If no explicit activated mana abilities produced any atoms, fall back to basic land
    // subtype inference. This handles dual lands like Breeding Pool (Forest Island → G + U)
    // and Hallowed Fountain (Plains Island → W + U) which don't have explicit AB$ Mana
    // entries in their card scripts — the mana ability is implied by the basic land subtype.
    if atoms.is_empty() {
        atoms = all_basic_subtype_atoms(card);
        // Final fallback: basic_land_mana_atom for cards with a single subtype by name
        if atoms.is_empty() {
            if let Some(a) = basic_land_mana_atom(card) {
                atoms.push(a);
            }
        }
    }
    atoms
}

pub(crate) fn atom_short(atom: u16) -> &'static str {
    match atom {
        ManaAtom::WHITE => "W",
        ManaAtom::BLUE => "U",
        ManaAtom::BLACK => "B",
        ManaAtom::RED => "R",
        ManaAtom::GREEN => "G",
        ManaAtom::COLORLESS => "C",
        _ => "1",
    }
}

// ── Mana production (extracted from game_action.rs) ─────────────────

/// Parameters that describe metadata to attach to produced mana.
pub struct ManaProductionParams {
    pub source_card: CardId,
    pub is_snow: bool,
    pub restriction: Option<String>,
    pub adds_no_counter: bool,
    pub adds_keywords: Option<String>,
    pub adds_keywords_valid: Option<String>,
    pub adds_counters: Option<String>,
    pub adds_counters_valid: Option<String>,
    pub triggers_when_spent: Option<String>,
}

/// Determine what mana to produce from a `Produced$` string, handling
/// color choice, combo mana, `Amount$` multiplier, and replacement effects.
///
/// Returns the final mana string (e.g. `"W W"`, `"R G"`, `"C C C"`),
/// or `None` if no mana can be produced (e.g. Amount$ evaluates to 0).
///
/// The caller is responsible for cost payment, trigger firing, sub-ability
/// resolution, and the `Special` / `ManaReflected` branches.
pub fn determine_mana_production_ir(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    player: PlayerId,
    card_id: CardId,
    produced_ir: &ProducedMana,
    produced_text: &str,
    amount_param: Option<&str>,
    express_choice: Option<u16>,
) -> Option<String> {
    let mut mana_string: Option<String> = None;

    if produced_ir.is_combo_color_identity() {
        let colors = game.player_commander_color_identity(player);

        if !colors.is_empty() {
            if let Some(chosen) = agents[player.index()].choose_color(player, &colors) {
                if let Some(atom) = color_name_to_mana_atom(&chosen) {
                    mana_string = Some(ManaPool::atom_to_letter(atom).to_string());
                }
            }
        }
    } else if produced_ir.fixed_atoms().is_some() {
        mana_string = Some(produced_text.to_string());
    } else {
        let chosen_colors = game.card(card_id).chosen_colors.clone();
        let colors = produced_ir.to_color_names(&chosen_colors);
        if colors.len() > 1 {
            let chosen = if let Some(forced) = express_choice
                .and_then(mana_atom_to_color_name)
                .and_then(|forced_name| {
                    colors
                        .iter()
                        .find(|valid| valid.eq_ignore_ascii_case(forced_name))
                        .cloned()
                }) {
                // Java calls chooseColor even when expressChoice is set,
                // presenting the forced color as a single-option choice.
                // Consume the RNG pick for parity.
                let single = vec![forced.clone()];
                let _ = agents[player.index()].choose_color(player, &single);
                Some(forced)
            } else {
                agents[player.index()].choose_color(player, &colors)
            };
            if let Some(chosen) = chosen {
                if let Some(atom) = color_name_to_mana_atom(&chosen) {
                    mana_string = Some(ManaPool::atom_to_letter(atom).to_string());
                }
            }
        } else if let Some(single) = colors.first() {
            if let Some(atom) = color_name_to_mana_atom(single) {
                mana_string = Some(ManaPool::atom_to_letter(atom).to_string());
            }
        } else {
            // Raw produced string (single-token fixed output)
            mana_string = Some(produced_text.to_string());
        }
    }

    // Apply Amount$ multiplier (e.g. Rofellos produces mana equal to Forests)
    if let Some(ref mut ms) = mana_string {
        if let Some(amount_str) = amount_param {
            let amount = if let Ok(n) = amount_str.parse::<i32>() {
                n
            } else {
                // Try to resolve as SVar on the source card
                if let Some(svar_expr) = game.card(card_id).svars.get(amount_str).cloned() {
                    crate::ability::effects::resolve_count_svar(&svar_expr, game, card_id, player)
                } else {
                    1
                }
            };
            if amount > 1 {
                // Check if this is combo/any mana (multiple color choices)
                let is_combo = produced_ir.is_choice_like();
                if is_combo {
                    // Multi-amount combo: let agent choose color distribution
                    let available: Vec<String> = if produced_ir.is_any_like() {
                        vec!["W", "U", "B", "R", "G"]
                            .into_iter()
                            .map(String::from)
                            .collect()
                    } else {
                        let chosen_colors = game.card(card_id).chosen_colors.clone();
                        let names = produced_ir.to_color_names(&chosen_colors);
                        names
                            .iter()
                            .filter_map(|name| {
                                color_name_to_mana_atom(name)
                                    .map(|a| ManaPool::atom_to_letter(a).to_string())
                            })
                            .collect()
                    };
                    let card_name = game.card(card_id).card_name.clone();
                    let chosen = agents[player.index()].specify_mana_combo(
                        player,
                        &available,
                        amount as usize,
                        Some(card_id),
                        express_choice,
                    );
                    *ms = chosen.join(" ");
                } else {
                    let base = ms.clone();
                    for _ in 1..amount {
                        ms.push(' ');
                        ms.push_str(&base);
                    }
                }
            } else if amount <= 0 {
                mana_string = None;
            }
        }
    }

    // Apply ProduceMana replacement effects (mana doublers like Mirari's Wake)
    if let Some(ref mut ms) = mana_string {
        use crate::replacement::replacement_handler::{
            apply_replacements_with_agents, ReplacementEvent,
        };
        let mut event = ReplacementEvent::ProduceMana {
            source: card_id,
            activator: player,
            mana: ms.clone(),
        };
        let result = apply_replacements_with_agents(game, agents, &mut event);
        if result == crate::replacement::ReplacementResult::Updated {
            if let ReplacementEvent::ProduceMana { mana: new_mana, .. } = event {
                *ms = new_mana;
            }
        }
    }

    mana_string
}

/// Add produced mana to the pool with full metadata (snow, restriction, keywords, counters, triggers).
pub fn add_produced_mana_to_pool(
    pool: &mut ManaPool,
    mana_string: &str,
    params: &ManaProductionParams,
) {
    pool.produce_mana_from_string(
        mana_string,
        Some(params.source_card),
        params.is_snow,
        params.restriction.clone(),
        params.adds_no_counter,
        params.adds_keywords.clone(),
        params.adds_keywords_valid.clone(),
        params.adds_counters.clone(),
        params.adds_counters_valid.clone(),
        params.triggers_when_spent.clone(),
    );
}

/// Calculate available mana from the current pool plus untapped lands and non-land mana sources.
///
/// Colors are tracked OPTIMISTICALLY: each source adds 1 per color it could produce,
/// so that color-matching checks (`can_pay` for colored shards) work correctly.
/// However, `total_sources` is set to the actual number of mana sources, so the
/// total mana check in `can_pay` prevents dual/multi-color lands from being
/// double-counted (e.g. Breeding Pool counts as 1 mana, not 2).
pub fn calculate_available_mana(pool: &ManaPool, game: &GameState, player: PlayerId) -> ManaPool {
    calculate_available_mana_excluding_with_reserved(pool, game, player, None, &[])
}

pub fn calculate_available_mana_for_casting(
    pool: &ManaPool,
    game: &GameState,
    player: PlayerId,
) -> ManaPool {
    calculate_available_mana_for_casting_excluding(pool, game, player, None)
}

pub fn calculate_available_mana_for_casting_excluding(
    pool: &ManaPool,
    game: &GameState,
    player: PlayerId,
    excluded_source: Option<CardId>,
) -> ManaPool {
    calculate_available_mana_excluding_with_reserved_impl(
        pool,
        game,
        player,
        excluded_source,
        &[],
        true,
        None,
    )
}

/// Calculate available mana while excluding a specific battlefield source.
///
/// This is used by activated-ability legality checks to mirror Java's
/// `ComputerUtilMana` behavior: an ability cannot pay its own mana cost from
/// mana abilities on the same host permanent.
pub fn calculate_available_mana_excluding(
    pool: &ManaPool,
    game: &GameState,
    player: PlayerId,
    excluded_source: Option<CardId>,
) -> ManaPool {
    calculate_available_mana_excluding_with_reserved(pool, game, player, excluded_source, &[])
}

pub fn calculate_available_mana_excluding_with_reserved(
    pool: &ManaPool,
    game: &GameState,
    player: PlayerId,
    excluded_source: Option<CardId>,
    reserved_sacrifices: &[CardId],
) -> ManaPool {
    calculate_available_mana_excluding_with_reserved_impl(
        pool,
        game,
        player,
        excluded_source,
        reserved_sacrifices,
        false,
        None,
    )
}

/// Like `calculate_available_mana_excluding_with_reserved` but filters mana
/// abilities whose `RestrictValid$` cannot be satisfied by the given payment
/// context. Java's ActionSpace filters per-spell via
/// `manaPart.meetsManaRestrictions(saBeingPaid)`; this mirrors that for
/// Rust's playability checks.
pub fn calculate_available_mana_with_context(
    pool: &ManaPool,
    game: &GameState,
    player: PlayerId,
    excluded_source: Option<CardId>,
    reserved_sacrifices: &[CardId],
    payment_ctx: Option<&ManaPaymentContext>,
) -> ManaPool {
    // Include hand-based mana sources (e.g. Simian Spirit Guide's exile-
    // from-hand ability) so playability checks account for them. Mirrors
    // Java's ComputerUtilMana which iterates hand mana abilities.
    calculate_available_mana_excluding_with_reserved_impl(
        pool,
        game,
        player,
        excluded_source,
        reserved_sacrifices,
        true,
        payment_ctx,
    )
}

pub(crate) fn replacement_adjusted_atoms_for_availability(
    game: &GameState,
    player: PlayerId,
    source: CardId,
    atom: u16,
) -> Vec<u16> {
    use crate::replacement::replacement_handler::ReplacementEvent;

    let mut event = ReplacementEvent::ProduceMana {
        source,
        activator: player,
        mana: ManaPool::atom_to_letter(atom).to_string(),
    };
    if apply_produce_mana_replacements_for_availability(game, &mut event) {
        let ReplacementEvent::ProduceMana { mana, .. } = event else {
            return vec![atom];
        };
        let produced_ir = ProducedMana::from_raw_boundary(&mana);
        let adjusted = produced_ir
            .fixed_atoms()
            .unwrap_or_else(|| produced_ir.to_atoms(&[]));
        if !adjusted.is_empty() {
            return adjusted;
        }
    }

    vec![atom]
}

pub(crate) fn has_replacement_adjusted_available_mana(game: &GameState, player: PlayerId) -> bool {
    fn is_adjusted(game: &GameState, player: PlayerId, source: CardId, atom: u16) -> bool {
        let adjusted = replacement_adjusted_atoms_for_availability(game, player, source, atom);
        adjusted.len() != 1 || adjusted.first().copied() != Some(atom)
    }

    for &card_id in game.cards_in_zone(ZoneType::Battlefield, player) {
        let card = game.card(card_id);
        if card.phased_out {
            continue;
        }

        let mut has_explicit_mana = false;
        for ab in &card.activated_abilities {
            if !ab.is_mana_ability
                || ab
                    .cost
                    .parts
                    .iter()
                    .any(|part| matches!(part, CostPart::Mana { .. }))
                || (card.tapped
                    && ab
                        .cost
                        .parts
                        .iter()
                        .any(|part| matches!(part, CostPart::Tap)))
                || !crate::cost::can_pay_ignoring_mana(&ab.cost, game, card_id, player)
                || !mana_ability_meets_script_requirements(game, card_id, ab)
            {
                continue;
            }
            has_explicit_mana = true;

            let atoms = if ab.is_mana_reflected {
                compute_reflected_atoms(game, player, card_id, ab)
            } else if let Some(produced_ir) = ab.produced_ir.as_ref() {
                if produced_ir.is_combo_color_identity() {
                    chosen_colors_to_atoms(&game.player_commander_color_identity(player))
                } else if let Some(fixed_atoms) = produced_ir.fixed_atoms() {
                    fixed_atoms
                } else {
                    produced_ir.to_atoms(&card.chosen_colors)
                }
            } else {
                Vec::new()
            };

            if atoms
                .into_iter()
                .any(|atom| is_adjusted(game, player, card_id, atom))
            {
                return true;
            }
        }

        if !has_explicit_mana && card.is_land() && !card.tapped {
            let mut atoms = all_basic_subtype_atoms(card);
            if atoms.is_empty() {
                if let Some(atom) = basic_land_mana_atom(card) {
                    atoms.push(atom);
                }
            }
            if atoms
                .into_iter()
                .any(|atom| is_adjusted(game, player, card_id, atom))
            {
                return true;
            }
        }
    }

    false
}

pub(crate) fn java_replacement_filtered_atoms_for_availability(
    game: &GameState,
    player: PlayerId,
    source: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
    intrinsic_atoms: &[u16],
) -> Vec<u16> {
    if intrinsic_atoms.is_empty() {
        return Vec::new();
    }

    let orig_produced = ab
        .produced_ir
        .as_ref()
        .map(ProducedMana::as_script_text)
        .unwrap_or_else(|| {
            if ab.is_mana_reflected {
                "1".into()
            } else {
                "".into()
            }
        });
    if orig_produced.is_empty() {
        return intrinsic_atoms.to_vec();
    }

    let mut event = crate::replacement::replacement_handler::ReplacementEvent::ProduceMana {
        source,
        activator: player,
        mana: orig_produced.to_string(),
    };
    if !apply_produce_mana_replacements_for_availability(game, &mut event) {
        return intrinsic_atoms.to_vec();
    }

    let crate::replacement::replacement_handler::ReplacementEvent::ProduceMana { mana, .. } = event
    else {
        return intrinsic_atoms.to_vec();
    };
    // Java's `groupSourcesByManaColor` checks `"Any".equals(replaced)` against
    // the *unmodified* origin string — `ReplaceAmount` (Mana Reflection,
    // Nyxbloom Ancient) never touches `replaced` on the Java side, only the
    // mana-pool tally. Our `apply_produce_mana_replacements_for_availability`
    // already multiplies the string ("Any" → "Any Any Any"), so anchor the
    // comparison on the *original* produced text. Mirroring Java's exact
    // string equality keeps quirky cases (e.g. "Combo Any" — granted by
    // Leyline Immersion — still parses only the "C" letter from "Combo",
    // not as full any-color) in lockstep.
    if orig_produced.trim() == "Any" {
        return intrinsic_atoms.to_vec();
    }

    let pairs = [
        ("W", ManaAtom::WHITE),
        ("U", ManaAtom::BLUE),
        ("B", ManaAtom::BLACK),
        ("R", ManaAtom::RED),
        ("G", ManaAtom::GREEN),
        ("C", ManaAtom::COLORLESS),
    ];
    let mut filtered = Vec::new();
    for (letter, atom) in pairs {
        if mana.contains(letter) && intrinsic_atoms.contains(&atom) && !filtered.contains(&atom) {
            filtered.push(atom);
        }
    }
    filtered
}

pub(crate) fn reflected_atoms_for_availability(
    game: &GameState,
    player: PlayerId,
    source: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
) -> Vec<u16> {
    let reflected = compute_reflected_atoms(game, player, source, ab);
    java_replacement_filtered_atoms_for_availability(game, player, source, ab, &reflected)
}

fn apply_produce_mana_replacements_for_availability(
    game: &GameState,
    event: &mut crate::replacement::replacement_handler::ReplacementEvent,
) -> bool {
    use crate::replacement::{
        replace_produce_mana, ReplacementLayer, ReplacementResult, ReplacementType,
    };

    let mut has_run: std::collections::HashSet<(CardId, usize)> = std::collections::HashSet::new();
    let mut updated = false;

    loop {
        let mut changed_this_pass = false;
        for layer in [
            ReplacementLayer::CantHappen,
            ReplacementLayer::Control,
            ReplacementLayer::Copy,
            ReplacementLayer::Transform,
            ReplacementLayer::Other,
        ] {
            let mut chosen = None;
            'cards: for (i, card) in game.cards.iter().enumerate() {
                let card_id = CardId(i as u32);
                for (effect_idx, effect) in card.replacement_effects.iter().enumerate() {
                    if has_run.contains(&(card_id, effect_idx))
                        || effect.event != ReplacementType::ProduceMana
                        || effect.layer != layer
                        || !effect.active_in_zone(card.zone)
                        || !effect.requirements_check(game, card)
                        || !replace_produce_mana::can_replace(effect, event, game, card)
                    {
                        continue;
                    }
                    chosen = Some((card_id, effect_idx));
                    break 'cards;
                }
            }

            let Some((card_id, effect_idx)) = chosen else {
                continue;
            };
            has_run.insert((card_id, effect_idx));
            let effect = &game.card(card_id).replacement_effects[effect_idx];
            if replace_produce_mana::execute(effect, event, game, card_id)
                == ReplacementResult::Updated
            {
                updated = true;
                changed_this_pass = true;
                break;
            }
        }

        if !changed_this_pass {
            return updated;
        }
    }
}

fn atoms_mask_to_letters(mask: u16) -> String {
    let mut letters: Vec<&str> = Vec::new();
    for atom in [
        ManaAtom::WHITE,
        ManaAtom::BLUE,
        ManaAtom::BLACK,
        ManaAtom::RED,
        ManaAtom::GREEN,
        ManaAtom::COLORLESS,
    ] {
        if mask & atom != 0 {
            letters.push(ManaPool::atom_to_letter(atom));
        }
    }
    letters.join(" ")
}

fn add_taps_for_mana_trigger_mana_for_availability(
    available: &mut ManaPool,
    source_count: &mut i32,
    source_colors: &mut Vec<u16>,
    game: &GameState,
    player: PlayerId,
    tapped_card_id: CardId,
    produced_letters: &str,
) {
    let params = crate::event::RunParams {
        card: Some(tapped_card_id),
        player: Some(player),
        activator: Some(player),
        produced: Some(produced_letters.to_string()),
        ..Default::default()
    };

    for host in &game.cards {
        if host.zone != ZoneType::Battlefield || host.phased_out {
            continue;
        }
        for trigger in &host.triggers {
            if trigger.kind != crate::trigger::TriggerType::TapsForMana
                || !trigger.get_active_zone().contains(&host.zone)
                || !trigger.requirements_check(game, host.id)
                || !trigger.check_activation_limit(game, host.id)
                || !trigger.mode.perform_test(trigger, &params, game)
                || !trigger.meets_requirements_on_triggered_objects(game, &params, host.id)
            {
                continue;
            }
            let Some(svar_text) = host.svars.get(&trigger.execute) else {
                continue;
            };
            let trigger_params = crate::parsing::Params::from_raw(svar_text);
            if !trigger_params
                .get("DB")
                .is_some_and(|api| api.eq_ignore_ascii_case("Mana"))
            {
                continue;
            }
            let Some(produced) = trigger_params.get(crate::parsing::keys::PRODUCED) else {
                continue;
            };
            let amount = trigger_params
                .get(crate::parsing::keys::AMOUNT)
                .and_then(|raw| raw.parse::<i32>().ok())
                .unwrap_or(1)
                .max(1);
            let produced_ir = ProducedMana::from_raw_boundary(produced);
            if let Some(fixed_atoms) = produced_ir.fixed_atoms() {
                for atom in fixed_atoms {
                    available.add(atom, 1);
                    *source_count += 1;
                    source_colors.push(atom);
                }
                continue;
            }

            let atoms = produced_ir.to_atoms(&host.chosen_colors);
            if atoms.is_empty() {
                continue;
            }
            let src_mask = atoms.iter().fold(0, |mask, atom| mask | *atom);
            for atom in atoms {
                for _ in 0..amount {
                    available.add(atom, 1);
                }
            }
            for _ in 0..amount {
                *source_count += 1;
                source_colors.push(src_mask);
            }
        }
    }
}

fn calculate_available_mana_excluding_with_reserved_impl(
    pool: &ManaPool,
    game: &GameState,
    player: PlayerId,
    excluded_source: Option<CardId>,
    reserved_sacrifices: &[CardId],
    include_hand_sources: bool,
    payment_ctx: Option<&ManaPaymentContext>,
) -> ManaPool {
    let mut available = pool.clone();
    let battlefield = game.cards_in_zone(ZoneType::Battlefield, player);
    let hand_cards = if include_hand_sources {
        game.cards_in_zone(ZoneType::Hand, player).to_vec()
    } else {
        Vec::new()
    };

    // Track actual number of mana sources (each can produce exactly 1 mana)
    let mut source_count: i32 = 0;

    // Per-source color bitmasks for source-level matching in can_pay.
    // Start with floating mana from the existing pool.
    let mut source_colors: Vec<u16> = Vec::new();
    for _ in 0..pool.white() {
        source_colors.push(ManaAtom::WHITE);
    }
    for _ in 0..pool.blue() {
        source_colors.push(ManaAtom::BLUE);
    }
    for _ in 0..pool.black() {
        source_colors.push(ManaAtom::BLACK);
    }
    for _ in 0..pool.red() {
        source_colors.push(ManaAtom::RED);
    }
    for _ in 0..pool.green() {
        source_colors.push(ManaAtom::GREEN);
    }
    // colorless can only pay generic
    source_colors.extend(std::iter::repeat_n(0, pool.colorless() as usize));

    // Helper: add mana to availability pool, marking as snow if source is snow.
    macro_rules! avail_add {
        ($avail:expr, $is_snow:expr, $atom:expr) => {
            if $is_snow {
                $avail.add_snow($atom, 1);
            } else {
                $avail.add($atom, 1);
            }
        };
    }

    for card_id in battlefield.iter().copied().chain(hand_cards.into_iter()) {
        if excluded_source == Some(card_id) {
            continue;
        }
        let card = game.card(card_id);
        let is_tapped = card.tapped;
        let card_is_snow = card.type_line.is_snow();

        // Summoning-sick creatures cannot activate {T} abilities (including mana).
        // Must match Java's ComputerUtilMana.canPayManaCost() behavior so
        // castability probes agree with actual payment and neither engine wastes RNG
        // on uncastable spells.
        let summoning_sick = card.is_creature() && card.summoning_sick && !card.has_haste();
        if summoning_sick {
            let all_need_tap = card
                .activated_abilities
                .iter()
                .filter(|ab| ab.is_mana_ability)
                .all(|ab| ab.cost.parts.iter().any(|p| matches!(p, CostPart::Tap)));
            if all_need_tap {
                continue;
            }
        }

        // Check for mana abilities on this permanent.
        // If the card is tapped or summoning-sick, only include mana abilities that
        // don't require tapping (e.g. Rasputin Dreamweaver's "Remove a dream counter:
        // Add {C}"). This matches Java's ComputerUtilMana which checks individual
        // ability playability rather than skipping tapped cards entirely.
        let mana_abilities: Vec<_> = card
            .activated_abilities
            .iter()
            .filter(|ab| {
                ab.is_mana_ability
                    && match card.zone {
                        ZoneType::Battlefield => ab.activation_zone != Some(ZoneType::Hand),
                        ZoneType::Hand => ab.activation_zone == Some(ZoneType::Hand),
                        _ => false,
                    }
                    && !ab.cost.parts.iter().any(|p| matches!(p, CostPart::Mana { .. }))
                    && (!is_tapped || !ab.cost.parts.iter().any(|p| matches!(p, CostPart::Tap)))
                    && (!summoning_sick
                        || !ab.cost.parts.iter().any(|p| matches!(p, CostPart::Tap)))
                    // Mirror Java ComputerUtilMana playability checks:
                    // only count mana abilities whose non-mana costs are currently payable
                    // (e.g. Gilded Goose needs a Food to produce mana).
                    && crate::cost::can_pay_ignoring_mana(&ab.cost, game, card_id, player)
                    && crate::game_loop::GameLoop::mana_ability_available_for_payment_with_reserved(
                        game,
                        player,
                        card_id,
                        ab,
                        reserved_sacrifices,
                    )
                    // If a payment context is provided, filter out mana
                    // abilities whose RestrictValid$ cannot be satisfied.
                    // Substitute "ChosenType" with the source card's chosen
                    // type (e.g. Unclaimed Territory).
                    && {
                        if let Some(ctx) = payment_ctx {
                            match ab.restrict_valid.as_deref() {
                                Some(raw) => {
                                    let resolved = if raw.contains("ChosenType") {
                                        let chosen = card
                                            .chosen_type
                                            .clone()
                                            .unwrap_or_default();
                                        raw.replace("ChosenType", &chosen)
                                    } else {
                                        raw.to_string()
                                    };
                                    mana_meets_restriction(&resolved, ctx)
                                }
                                None => true,
                            }
                        } else {
                            true
                        }
                    }
            })
            .collect();

        if mana_abilities.is_empty() {
            // Fallback for lands without explicit parsed mana abilities.
            // This handles non-basic lands with basic land subtypes (e.g. Breeding Pool
            // typed "Land Forest Island" — produces G or U from subtype, not AB$ Mana).
            // Also handles basic lands from the Forge CLI or other sources.
            // Tapped lands can't produce mana (implicit {T} cost), so skip them.
            if card.zone == ZoneType::Battlefield && card.is_land() && !is_tapped {
                let subtype_atoms = all_basic_subtype_atoms(card);
                if !subtype_atoms.is_empty() {
                    let mut src_mask: u16 = 0;
                    let mut source_units = 0usize;
                    for atom in subtype_atoms {
                        let adjusted_atoms = replacement_adjusted_atoms_for_availability(
                            game, player, card_id, atom,
                        );
                        source_units = source_units.max(adjusted_atoms.len());
                        for adjusted_atom in adjusted_atoms {
                            avail_add!(available, card_is_snow, adjusted_atom);
                            src_mask |= adjusted_atom;
                        }
                    }
                    for _ in 0..source_units.max(1) {
                        source_count += 1;
                        source_colors.push(src_mask);
                    }
                    add_taps_for_mana_trigger_mana_for_availability(
                        &mut available,
                        &mut source_count,
                        &mut source_colors,
                        game,
                        player,
                        card_id,
                        &atoms_mask_to_letters(src_mask),
                    );
                } else if let Some(atom) = basic_land_mana_atom(card) {
                    let adjusted_atoms =
                        replacement_adjusted_atoms_for_availability(game, player, card_id, atom);
                    let mut src_mask: u16 = 0;
                    for adjusted_atom in &adjusted_atoms {
                        avail_add!(available, card_is_snow, *adjusted_atom);
                        src_mask |= *adjusted_atom;
                    }
                    for _ in 0..adjusted_atoms.len().max(1) {
                        source_count += 1;
                        source_colors.push(src_mask);
                    }
                    add_taps_for_mana_trigger_mana_for_availability(
                        &mut available,
                        &mut source_count,
                        &mut source_colors,
                        game,
                        player,
                        card_id,
                        &atoms_mask_to_letters(src_mask),
                    );
                }
            }
            continue;
        }

        // Add 1 mana for each distinct color this source can produce (optimistic for colors).
        // The total_sources cap ensures the total mana count stays correct.
        let mut added_any = false;
        let mut counted_fixed_output = false;
        let mut added_atoms: Vec<u16> = Vec::new();
        let mut src_mask: u16 = 0;
        for ab in &mana_abilities {
            // ManaReflected: check what colors other permanents can produce.
            // For playability purposes, optimistically add all colors that
            // matching permanents could produce.
            if ab.is_mana_reflected {
                let reflected_atoms = reflected_atoms_for_availability(game, player, card_id, ab);
                // Resolve Amount parameter (e.g. Incubation Druid produces 3 when adapted).
                let amount = resolve_mana_ability_amount(game, card_id, player, ab);
                for &atom in &reflected_atoms {
                    if !added_atoms.contains(&atom) {
                        for _ in 0..amount {
                            avail_add!(available, card_is_snow, atom);
                        }
                        added_atoms.push(atom);
                        src_mask |= atom;
                        added_any = true;
                    }
                }
                // ManaReflected with Amount > 1 produces multiple mana per activation.
                // Account for this in source_count so can_pay_source_matching knows
                // this source can satisfy multiple shard requirements.
                if amount > 1 && !reflected_atoms.is_empty() {
                    // We'll add (amount - 1) extra source entries later when we push.
                    // Store in a local variable to use below.
                    // (We add 1 normally, plus (amount-1) extras.)
                    for _ in 0..(amount - 1) {
                        source_count += 1;
                        source_colors.push(src_mask);
                    }
                }
            } else if let Some(produced_ir) = ab.produced_ir.as_ref() {
                if produced_ir.is_combo_color_identity() {
                    // Commander Color Identity support: in non-commander games this remains empty.
                    let colors = game.player_commander_color_identity(player);
                    if !colors.is_empty() {
                        for atom in chosen_colors_to_atoms(&colors) {
                            if !added_atoms.contains(&atom) {
                                avail_add!(available, card_is_snow, atom);
                                added_atoms.push(atom);
                                src_mask |= atom;
                            }
                        }
                        added_any = true;
                    }
                } else if let Some(special) =
                    ab.produced_ir.as_ref().and_then(ProducedMana::special_kind)
                {
                    // Special mana (e.g. Bloom Tender's "EachColorAmong_Valid Permanent.YouCtrl"):
                    // one mana per distinct color among matching permanents. Both colors and
                    // amount-per-activation come from the same atom set.
                    let special_atoms =
                        crate::ability::effects::mana_effect::available_special_mana_atoms(
                            game, card_id, player, special,
                        );
                    if !special_atoms.is_empty() {
                        for &atom in &special_atoms {
                            if !added_atoms.contains(&atom) {
                                let adjusted_atoms = replacement_adjusted_atoms_for_availability(
                                    game, player, card_id, atom,
                                );
                                for adjusted_atom in adjusted_atoms {
                                    avail_add!(available, card_is_snow, adjusted_atom);
                                    src_mask |= adjusted_atom;
                                    source_count += 1;
                                    source_colors.push(adjusted_atom);
                                }
                                added_atoms.push(atom);
                            }
                        }
                        added_any = true;
                        // Special branch already pushed one source entry per
                        // produced atom (Bloom Tender: G, U, R). Mark fixed
                        // output so the outer `if added_any` at the end of
                        // the loop doesn't push an additional combined-mask
                        // source (which would double-count the activation
                        // and let a single Bloom Tender pay multiple same-
                        // color requirements).
                        counted_fixed_output = true;
                    }
                } else {
                    let amount = resolve_mana_ability_amount(game, card_id, player, ab);
                    let mut counted_variable_source_units = false;
                    if let Some(fixed_atoms) = produced_ir.fixed_atoms() {
                        for atom in fixed_atoms {
                            for _ in 0..amount {
                                let adjusted_atoms = replacement_adjusted_atoms_for_availability(
                                    game, player, card_id, atom,
                                );
                                for adjusted_atom in adjusted_atoms {
                                    avail_add!(available, card_is_snow, adjusted_atom);
                                    src_mask |= adjusted_atom;
                                    source_count += 1;
                                    source_colors.push(adjusted_atom);
                                }
                            }
                            added_any = true;
                            counted_fixed_output = true;
                        }
                    } else {
                        let mut source_units = 0usize;
                        let intrinsic = produced_ir.to_atoms(&card.chosen_colors);
                        let allowed = java_replacement_filtered_atoms_for_availability(
                            game, player, card_id, ab, &intrinsic,
                        );
                        for atom in allowed {
                            if !added_atoms.contains(&atom) {
                                for _ in 0..amount {
                                    let adjusted_atoms =
                                        replacement_adjusted_atoms_for_availability(
                                            game, player, card_id, atom,
                                        );
                                    source_units =
                                        source_units.max(adjusted_atoms.len() * amount as usize);
                                    for adjusted_atom in adjusted_atoms {
                                        avail_add!(available, card_is_snow, adjusted_atom);
                                        src_mask |= adjusted_atom;
                                    }
                                }
                                added_atoms.push(atom);
                                added_any = true;
                            }
                        }
                        if source_units > 1 && added_any {
                            // Multi-mana ability slot pushing. There are two
                            // distinct cases for `source_units > 1`:
                            //
                            // (A) Replacement multiplier (Mana Reflection
                            //     tripling Rootbound Crag's `Combo R G | Amount$
                            //     1`). The original ability picks ONE color at
                            //     activation; the replacement multiplies *that*
                            //     color, so the 3 mana are all the same colour.
                            //     The extra slots must be COLORLESS to prevent
                            //     the matcher from satisfying multiple distinct
                            //     coloured shards from one activation.
                            //
                            // (B) Intrinsic `Amount$ N` (Leyline Immersion's
                            //     `Combo Any | Amount$ 5`). Each of the N mana
                            //     can be a different colour, so every slot
                            //     keeps the full `src_mask` and can satisfy
                            //     any single-colour shard.
                            let intrinsic_amount = amount > 1;
                            let colored_bits = (src_mask
                                & (ManaAtom::WHITE
                                    | ManaAtom::BLUE
                                    | ManaAtom::BLACK
                                    | ManaAtom::RED
                                    | ManaAtom::GREEN))
                                .count_ones();
                            let extra_mask = if intrinsic_amount {
                                src_mask
                            } else if colored_bits > 1 {
                                ManaAtom::COLORLESS
                            } else {
                                src_mask
                            };
                            for _ in 0..(source_units as i32 - 1) {
                                source_count += 1;
                                source_colors.push(extra_mask);
                            }
                            counted_variable_source_units = true;
                        }
                    }
                    // Amount > 1 (e.g. Sol Ring: Amount$ 2) — one activation produces
                    // multiple mana, so push extra source entries so
                    // can_pay_source_matching's source-count budget matches the real
                    // mana count and this source can satisfy multiple generic shards.
                    if amount > 1
                        && added_any
                        && !counted_fixed_output
                        && !counted_variable_source_units
                    {
                        for _ in 0..(amount - 1) {
                            source_count += 1;
                            source_colors.push(src_mask);
                        }
                    }
                }
            }
        }
        if !added_any && card.is_land() {
            // Safety net: land has mana abilities but none produced a recognized atom.
            // For multi-subtype lands (e.g. Breeding Pool = Forest + Island → G + U),
            // add ALL matching atoms optimistically. The total_sources cap prevents
            // double-counting (1 land activation = 1 mana, regardless of color options).
            let subtype_atoms = all_basic_subtype_atoms(card);
            if !subtype_atoms.is_empty() {
                for atom in subtype_atoms {
                    if !added_atoms.contains(&atom) {
                        avail_add!(available, card_is_snow, atom);
                        added_atoms.push(atom);
                        src_mask |= atom;
                        added_any = true;
                    }
                }
            } else if let Some(atom) = basic_land_mana_atom(card) {
                // Name-based fallback for basic lands named "Forest" etc.
                avail_add!(available, card_is_snow, atom);
                src_mask |= atom;
                added_any = true;
            }
        }
        if added_any && !counted_fixed_output {
            // Each productive source contributes exactly 1 activation (tap = 1 mana)
            source_count += 1;
            source_colors.push(src_mask);
        }
        if added_any {
            let combined_mask = added_atoms.iter().fold(src_mask, |mask, atom| mask | atom);
            add_taps_for_mana_trigger_mana_for_availability(
                &mut available,
                &mut source_count,
                &mut source_colors,
                game,
                player,
                card_id,
                &atoms_mask_to_letters(combined_mask),
            );
        }
    }

    // Count extra mana from aura enchantments with TapsForMana triggers
    // (e.g. Utopia Sprawl, Wild Growth). When an untapped land has an attached
    // aura that produces mana on tap, that extra mana should be counted in
    // the playability check.
    for &card_id in battlefield {
        let card = game.card(card_id);
        if card.tapped || card.attachments.is_empty() {
            continue;
        }
        for &aura_id in &card.attachments {
            if aura_id.index() >= game.cards.len() {
                continue;
            }
            let aura = game.card(aura_id);
            if aura.zone != ZoneType::Battlefield {
                continue;
            }
            for trigger in &aura.triggers {
                if trigger.kind == crate::trigger::TriggerType::TapsForMana {
                    // This aura produces extra mana when the host is tapped.
                    // Determine what color from the Execute$ SVar.
                    if let Some(svar_text) = aura.svars.get(&trigger.execute) {
                        let params = crate::parsing::Params::from_raw(svar_text);
                        if let Some(produced) = params.get(crate::parsing::keys::PRODUCED) {
                            let produced_ir = ProducedMana::from_raw_boundary(produced);
                            let atoms = if matches!(produced_ir, ProducedMana::Chosen) {
                                // Use aura's chosen color
                                aura.chosen_colors
                                    .first()
                                    .and_then(|c| color_name_to_mana_atom(c))
                                    .into_iter()
                                    .collect::<Vec<_>>()
                            } else {
                                produced_ir.to_atoms(&aura.chosen_colors)
                            };
                            for atom in atoms {
                                available.add(atom, 1);
                                source_count += 1;
                                source_colors.push(atom);
                            }
                        }
                    }
                }
            }
        }
    }

    // Set total_sources so can_pay enforces the real total mana cap
    available.total_sources = Some(pool.total_mana() + source_count);
    available.source_colors = Some(source_colors);

    available
}

/// Resolve the Amount parameter of a mana ability for availability checks.
/// Returns how many mana the ability produces per activation (default 1).
/// Handles SVar references like `Amount$ IncubationAmount` where the SVar
/// resolves to a Count$Compare expression.
pub(crate) fn resolve_mana_ability_amount(
    game: &GameState,
    card_id: CardId,
    player: PlayerId,
    ab: &crate::ability::activated::ActivatedAbility,
) -> i32 {
    let amount_str = match ab.amount.as_deref() {
        Some(v) if !v.is_empty() => v,
        _ => return 1,
    };
    // Direct number
    if let Ok(n) = amount_str.trim().parse::<i32>() {
        return n.max(1);
    }
    // SVar reference: look up in card's svars and resolve
    let card = game.card(card_id);
    if let Some(svar_expr) = card.svars.get(amount_str.trim()) {
        if svar_expr.starts_with("Count$") {
            return crate::ability::effects::resolve_count_svar(svar_expr, game, card_id, player)
                .max(1);
        }
        if let Ok(n) = svar_expr.trim().parse::<i32>() {
            return n.max(1);
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{PassAgent, PlayerAgent};
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use forge_foundation::ManaCost;
    use forge_foundation::{CardTypeLine, ColorSet, ZoneType};

    #[test]
    fn basic_land_detection() {
        use crate::card::Card;
        use crate::ids::{CardId, PlayerId};
        use forge_foundation::ColorSet;

        let card = Card::new(
            CardId(0),
            "Mountain".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Basic Land - Mountain"),
            ManaCost::no_cost(),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        assert_eq!(basic_land_mana_atom(&card), Some(ManaAtom::RED));
    }

    #[test]
    fn mana_atom_from_produced_test() {
        assert_eq!(mana_atom_from_produced("W"), Some(ManaAtom::WHITE));
        assert_eq!(mana_atom_from_produced("U"), Some(ManaAtom::BLUE));
        assert_eq!(mana_atom_from_produced("B"), Some(ManaAtom::BLACK));
        assert_eq!(mana_atom_from_produced("R"), Some(ManaAtom::RED));
        assert_eq!(mana_atom_from_produced("G"), Some(ManaAtom::GREEN));
        assert_eq!(mana_atom_from_produced("C"), Some(ManaAtom::COLORLESS));
        assert_eq!(mana_atom_from_produced("X"), None);
    }

    #[test]
    fn produced_to_atoms_any_and_combo_any() {
        let any = ProducedMana::Any.to_atoms(&[]);
        assert!(any.contains(&ManaAtom::WHITE));
        assert!(any.contains(&ManaAtom::BLUE));
        assert!(any.contains(&ManaAtom::BLACK));
        assert!(any.contains(&ManaAtom::RED));
        assert!(any.contains(&ManaAtom::GREEN));
        assert!(!any.contains(&ManaAtom::COLORLESS));

        let combo_any = ProducedMana::Combo(ProducedManaCombo::Any).to_atoms(&[]);
        assert_eq!(any.len(), combo_any.len());
        for a in any {
            assert!(combo_any.contains(&a));
        }
    }

    #[test]
    fn produced_to_atoms_chosen_and_combo_chosen() {
        let chosen = vec!["Red".to_string(), "Green".to_string()];
        let a = ProducedMana::Chosen.to_atoms(&chosen);
        assert!(a.contains(&ManaAtom::RED));
        assert!(a.contains(&ManaAtom::GREEN));
        assert_eq!(a.len(), 2);

        let b = ProducedMana::Combo(ProducedManaCombo::Chosen).to_atoms(&chosen);
        assert!(b.contains(&ManaAtom::RED));
        assert!(b.contains(&ManaAtom::GREEN));
        assert_eq!(b.len(), 2);
    }

    #[test]
    fn produced_to_atoms_multi_token_fixed_output() {
        let atoms = ProducedMana::Fixed(vec!["C".to_string(), "C".to_string()]).to_atoms(&[]);
        assert_eq!(atoms, vec![ManaAtom::COLORLESS]);
    }

    #[test]
    fn pay_simple_cost() {
        let mut pool = ManaPool::new();
        pool.add(ManaAtom::RED, 1);

        let cost = ManaCost::parse("R");
        assert!(pool.can_pay(&cost));
        assert!(pool.try_pay(&cost));
        assert_eq!(pool.red(), 0);
    }

    #[test]
    fn pay_generic_and_colored() {
        let mut pool = ManaPool::new();
        pool.add(ManaAtom::GREEN, 2);

        let cost = ManaCost::parse("1 G");
        assert!(pool.can_pay(&cost));
        assert!(pool.try_pay(&cost));
        assert_eq!(pool.green(), 0); // 1 for G, 1 for generic
    }

    #[test]
    fn insufficient_mana() {
        let mut pool = ManaPool::new();
        pool.add(ManaAtom::RED, 1);

        let cost = ManaCost::parse("1 R R");
        assert!(!pool.can_pay(&cost));
    }

    #[test]
    fn empty_pool() {
        let mut pool = ManaPool::new();
        pool.add(ManaAtom::WHITE, 3);
        pool.reset_pool();
        assert_eq!(pool.total_mana(), 0);
    }

    #[test]
    fn combo_color_identity_uses_registered_commander_outside_command_zone() {
        let mut game = GameState::new(&["P1", "P2"], 20);
        let p0 = PlayerId(0);

        let commander = Card::new(
            CardId(0),
            "Commander".to_string(),
            p0,
            CardTypeLine::parse("Legendary Creature Wizard"),
            ManaCost::parse("2 U"),
            ColorSet::BLUE,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        let commander_id = game.create_card(commander);
        game.player_register_commander(p0, commander_id);
        game.player_create_commander_effect(p0, None);
        game.move_card(commander_id, ZoneType::Battlefield, p0);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
        let produced = determine_mana_production_ir(
            &mut game,
            &mut agents,
            p0,
            commander_id,
            &ProducedMana::Combo(ProducedManaCombo::ColorIdentity),
            "Combo ColorIdentity",
            None,
            None,
        );

        assert_eq!(produced.as_deref(), Some("U"));
    }

    #[test]
    fn restricted_mana_can_use_source_chosen_type_for_creature_spells() {
        let mut pool = ManaPool::new();
        let source = CardId(7);
        let mut mana = Mana::simple(ManaAtom::BLACK);
        mana.source_card = Some(source);
        mana.restriction = Some("Spell.Creature+ChosenType".to_string());
        pool.add_mana(mana);

        let mut chosen_types_by_source = std::collections::HashMap::new();
        chosen_types_by_source.insert(source, "Assassin".to_string());

        let ctx = ManaPaymentContext {
            is_spell: true,
            is_activated_ability: false,
            sa_on_stack: false,
            type_line: Some(CardTypeLine::parse("Creature Zombie Assassin")),
            card_name: Some("Unstoppable Slasher".to_string()),
            card_color: None,
            chosen_types_by_source,
        };

        assert!(pool.can_pay_for_spell(&ManaCost::parse("B"), &ctx));
        assert!(pool.try_pay_for_spell(&ManaCost::parse("B"), &ctx));
        assert_eq!(pool.total_mana(), 0);
    }
}
