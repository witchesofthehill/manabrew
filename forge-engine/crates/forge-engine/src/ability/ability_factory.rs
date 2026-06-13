//! AbilityFactory — factory for creating spell abilities from card scripts.
//!
//! Mirrors Java's `AbilityFactory.java`.
//! Parses ability strings (AB$, SP$, DB$, ST$ prefixed) and constructs
//! the corresponding `SpellAbility` with all sub-abilities resolved.

use std::collections::HashMap;

use crate::ability::api_type::ApiType;
use crate::card::Card;
use crate::cost::parse_cost;
use crate::cost::{Cost, CostPart};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::keys::ST;
use crate::parsing::{keys, Params, ParsedParams};
use crate::spellability::target_restrictions::TargetRestrictions;
use crate::spellability::{AbilityManaPart, SpellAbility, TargetChoices};
use forge_foundation::ZoneType;
use serde::{Deserialize, Serialize};

/// The record type prefix for an ability definition.
/// Mirrors Java's `AbilityFactory.AbilityRecordType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AbilityRecordType {
    /// AB$ — activated ability
    Ability,
    /// SP$ — spell ability
    Spell,
    /// ST$ — static ability
    StaticAbility,
    /// DB$ — sub-ability
    SubAbility,
}

impl AbilityRecordType {
    /// The script prefix for this record type.
    pub fn prefix(&self) -> &'static str {
        match self {
            AbilityRecordType::Ability => "AB",
            AbilityRecordType::Spell => "SP",
            AbilityRecordType::StaticAbility => "ST",
            AbilityRecordType::SubAbility => "DB",
        }
    }

    /// Determine the record type from a parsed parameter map.
    pub fn from_params(params: &Params) -> Option<AbilityRecordType> {
        if params.has(keys::AB) {
            Some(AbilityRecordType::Ability)
        } else if params.has(keys::SP) {
            Some(AbilityRecordType::Spell)
        } else if params.has(ST) {
            Some(AbilityRecordType::StaticAbility)
        } else if params.has(keys::DB) {
            Some(AbilityRecordType::SubAbility)
        } else {
            None
        }
    }

    /// Determine the record type from raw ability text without building a
    /// temporary params map just for the AB/SP/ST/DB probe.
    pub fn from_raw(raw: &str) -> Option<AbilityRecordType> {
        if crate::parsing::raw_has_key(raw, keys::AB) {
            Some(AbilityRecordType::Ability)
        } else if crate::parsing::raw_has_key(raw, keys::SP) {
            Some(AbilityRecordType::Spell)
        } else if crate::parsing::raw_has_key(raw, ST) {
            Some(AbilityRecordType::StaticAbility)
        } else if crate::parsing::raw_has_key(raw, keys::DB) {
            Some(AbilityRecordType::SubAbility)
        } else {
            None
        }
    }

    pub fn from_parsed(params: &ParsedParams<'_>) -> Option<AbilityRecordType> {
        if params.has(keys::AB) {
            Some(AbilityRecordType::Ability)
        } else if params.has(keys::SP) {
            Some(AbilityRecordType::Spell)
        } else if params.has(ST) {
            Some(AbilityRecordType::StaticAbility)
        } else if params.has(keys::DB) {
            Some(AbilityRecordType::SubAbility)
        } else {
            None
        }
    }

    /// Java-name alias for `from_params`. Mirrors
    /// `AbilityFactory.AbilityRecordType.getRecordType(Map)`.
    pub fn get_record_type(params: &Params) -> Option<AbilityRecordType> {
        Self::from_params(params)
    }

    /// Get the API type string from parsed parameters for this record type.
    pub fn api_type_of<'a>(&self, params: &'a Params) -> Option<&'a str> {
        params.get(self.prefix())
    }

    /// Resolve the `ApiType` enum for a parsed parameter map, mirroring
    /// Java `AbilityFactory.AbilityRecordType.getApiTypeOf(Map)`.
    pub fn get_api_type_of(&self, params: &Params) -> Option<crate::ability::api_type::ApiType> {
        self.api_type_of(params)
            .and_then(crate::ability::api_type::ApiType::smart_value_of)
    }
}

impl Default for AbilityRecordType {
    fn default() -> Self {
        Self::Spell
    }
}

/// Java-name alias for `build_spell_ability_from_host_card`. Mirrors
/// `AbilityFactory.getAbility(String abString, Card card)`.
pub fn get_ability(
    host: &crate::card::Card,
    ability_text: &str,
    player: crate::ids::PlayerId,
) -> crate::spellability::SpellAbility {
    build_spell_ability_from_host_card(host, ability_text, player)
}

/// Keys used for additional sub-abilities in ability scripts.
/// Mirrors Java's `AbilityFactory.additionalAbilityKeys`.
pub const ADDITIONAL_ABILITY_KEYS: &[&str] = &[
    "WinSubAbility",
    "OtherwiseSubAbility",
    "BidSubAbility",
    "ChooseNumberSubAbility",
    "Lowest",
    "Highest",
    "NotLowest",
    "GuessCorrect",
    "GuessWrong",
    "MatchedAbility",
    "UnmatchedAbility",
    "HeadsSubAbility",
    "TailsSubAbility",
    "LoseSubAbility",
    "TrueSubAbility",
    "FalseSubAbility",
    "ChosenPile",
    "UnchosenPile",
    "RepeatSubAbility",
    "Execute",
    "FallbackAbility",
    "ChooseSubAbility",
    "CantChooseSubAbility",
    "RegenerationAbility",
    "ReturnAbility",
    "GiftAbility",
    "VoteSubAbility",
    "VoteTiedAbility",
];

const MAX_SUB_ABILITY_CHAIN_DEPTH: usize = 50;

thread_local! {
    static SUB_ABILITY_CHAIN_DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

const RESTRICTION_KEYS: &[&str] = &[
    "Activation",
    "ActivationZone",
    "ActivationPhases",
    "SorcerySpeed",
    "InstantSpeed",
    "Activator",
    "PlayerTurn",
    "OpponentTurn",
    "ActivationLimit",
    "GameActivationLimit",
    "Threshold",
    "Metalcraft",
    "Delirium",
    "Hellbent",
    "Revolt",
    "Desert",
    "Blessing",
    "Solved",
    "IsPresent",
    "PresentCompare",
    "PresentZone",
    "PresentDefined",
    "ClassLevel",
    "ActivateCardsInHand",
];

const CONDITION_KEYS: &[&str] = &[
    "ConditionPhases",
    "ConditionPlayerTurn",
    "ConditionOpponentTurn",
    "ConditionThreshold",
    "ConditionMetalcraft",
    "ConditionDelirium",
    "ConditionHellbent",
    "ConditionRevolt",
    "ConditionDesert",
    "ConditionBlessing",
    "ConditionSolved",
    "ConditionPresent",
    "ConditionCompare",
    "ConditionPresentZone",
    "ConditionDefined",
];

/// Parse a pipe-delimited ability string into a key-value map.
/// Mirrors Java's `AbilityFactory.getMapParams()`.
pub fn get_map_params(ab_string: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for segment in ab_string.split('|') {
        let segment = segment.trim();
        if let Some(idx) = segment.find('$') {
            let key = segment[..idx].trim().to_string();
            let value = segment[idx + 1..].trim().to_string();
            map.insert(key, value);
        }
    }
    map
}

/// Build a SpellAbility chain from a card's ability text, walking SubAbility$
/// SVars to construct the linked list.
/// Mirrors Java's `AbilityFactory.getAbility()` + sub-ability chain construction.
pub fn build_spell_ability(
    game: &GameState,
    card_id: CardId,
    ability_text: &str,
    player: PlayerId,
) -> SpellAbility {
    let host = game.card(card_id);
    build_spell_ability_from_host_card(host, ability_text, player)
}

/// Build a SpellAbility chain from script text using a concrete host card.
///
/// This is the closest Rust equivalent of Java `AbilityFactory.getAbility(...)`
/// for contexts that have a `Card` object but not full `GameState`.
pub fn build_spell_ability_from_host_card(
    host: &Card,
    ability_text: &str,
    player: PlayerId,
) -> SpellAbility {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::AbilityBuild);
    crate::perf::increment_params_parse();
    let parsed = ParsedParams::parse(ability_text);
    let record_type = AbilityRecordType::from_parsed(&parsed).unwrap_or_else(|| {
        panic!(
            "AbilityFactory::build_spell_ability requires AB$/SP$/ST$/DB$ ability text; got: {:?}",
            ability_text
        )
    });
    let params = Params::from_parsed(&parsed);
    build_spell_ability_of_type_with_params(
        host,
        ability_text,
        player,
        record_type,
        &parsed,
        params,
    )
}

/// Build a spell ability for card-casting contexts.
///
/// This mirrors Java's Spell object construction for vanilla cards:
/// if a card has no explicit SP$ line, create a spell-shaped ability probe
/// from the card's intrinsic mana cost and default hand-zone restriction.
pub fn build_spell_ability_for_card_cast(
    game: &GameState,
    card_id: CardId,
    player: PlayerId,
) -> SpellAbility {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::AbilityBuild);
    if let Some(spell_ability_text) = game
        .card(card_id)
        .abilities
        .iter()
        .find(|a| crate::parsing::raw_has_key(a, keys::SP))
        .cloned()
    {
        let host = game.card(card_id);
        let mut sa = build_spell_ability_of_type(
            host,
            &spell_ability_text,
            player,
            AbilityRecordType::Spell,
        );
        // Card-cast context: if SP$ omitted Cost$, default to card mana cost.
        if sa.pay_costs.is_none() {
            sa.pay_costs = Some(Cost {
                parts: vec![CostPart::Mana {
                    cost: host.mana_cost.clone(),
                    x_min: 0,
                    is_exiled_creature_cost: false,
                    is_enchanted_creature_cost: false,
                    is_cost_pay_any_number_of_times: false,
                    max_waterbend: None,
                }],
                has_tap: false,
                mandatory: false,
            });
        }
        // Aura enchantments with SP$ but no ValidTgts$: inject Enchant-derived targeting.
        // Some aura cards have SP$ lines for ETB effects but rely on the Enchant keyword
        // for targeting. Without this, the aura can target anything.
        if sa.target_restrictions.is_none() && host.type_line.has_subtype("Aura") {
            let enchant_type = host.get_keyword_cost("Enchant").unwrap_or_default();
            let params_str = crate::parsing::enchant_type_to_target_params(&enchant_type);
            sa.target_restrictions = TargetRestrictions::new(&Params::from_raw(&params_str));
        }
        return sa;
    }

    // Vanilla fallback: no SP$ ability text. Build a castable spell probe
    // with Java-like Spell defaults (hand zone + card mana cost).
    let mut restriction = crate::spellability::SpellAbilityRestriction::default();
    restriction.variables.set_zone(ZoneType::Hand);
    let condition = crate::spellability::SpellAbilityCondition::default();
    let card = game.card(card_id);

    // Aura enchantments: derive targeting from "Enchant <type>" keyword.
    // Mirrors Java's Spell constructor which reads the Enchant keyword to
    // set up ValidTgts$ automatically for aura spells.
    let target_restrictions = if card.type_line.has_subtype("Aura") {
        let enchant_type = card.get_keyword_cost("Enchant").unwrap_or_default();
        let params_str = crate::parsing::enchant_type_to_target_params(&enchant_type);
        TargetRestrictions::new(&Params::from_raw(&params_str))
    } else {
        None
    };

    SpellAbility {
        id: 0,
        api: None,
        source: Some(card_id),
        original_host: card.effect_source,
        activating_player: player,
        targeting_player: None,
        ability_text: String::new(),
        record_type: AbilityRecordType::Spell,
        ir: crate::ability::ability_ir::SpellAbilityIr::default(),
        target_restrictions,
        target_chosen: TargetChoices::default(),
        pay_costs: Some(Cost {
            parts: vec![CostPart::Mana {
                cost: card.mana_cost.clone(),
                x_min: 0,
                is_exiled_creature_cost: false,
                is_enchanted_creature_cost: false,
                is_cost_pay_any_number_of_times: false,
                max_waterbend: None,
            }],
            has_tap: false,
            mandatory: false,
        }),
        sub_ability: None,
        wrapped_ability: None,
        is_spell: true,
        is_trigger: false,
        is_activated: false,
        intrinsic: false,
        trigger_source: None,
        trigger_source_zone_timestamp: None,
        source_zone_timestamp: Some(card.zone_timestamp),
        source_trigger_id: None,
        trigger_index: None,
        alt_cost: None,
        alt_cost_index: 0,
        evoke_keyword_count: 0,
        kicked: false,
        buyback_paid: false,
        overloaded: false,
        is_copy: false,
        paid_life_amount: 0,
        kick_count: 0,
        replicate_count: 0,
        optional_generic_cost_paid: false,
        trigger_remembered_amount: 0,
        x_mana_cost_paid: 0,
        discarded_cost_cards: Vec::new(),
        optional_costs: Vec::new(),
        paid_hash: std::collections::HashMap::new(),
        paying_mana: Vec::new(),
        paid_abilities: Vec::new(),
        mana_part: None,
        express_mana_choice: None,
        convoke_tapped: Vec::new(),
        spliced_cards: Vec::new(),
        announce_vars: std::collections::HashMap::new(),
        sacrificed_as_emerge: None,
        sacrificed_as_offering: None,
        description: String::new(),
        stack_description: String::new(),
        is_mana_ability: false,
        is_land_ability: false,
        cast_face_down: false,
        trigger_objects: std::collections::HashMap::new(),
        trigger_spell_abilities: std::collections::HashMap::new(),
        additional_ability_lists: std::collections::HashMap::new(),
        replacing_objects: std::collections::HashMap::new(),
        trigger_remembered: Vec::new(),
        restriction,
        condition,
        rollback_effects: Vec::new(),
        optional_keyword_amounts: std::collections::HashMap::new(),
        pips_to_reduce: Vec::new(),
        may_choose_new_targets: false,
        last_state: std::collections::HashMap::new(),
        change_zone_table: None,
        damage_map: None,
        prevent_map: None,
    }
}

fn build_spell_ability_of_type(
    host: &Card,
    ability_text: &str,
    player: PlayerId,
    record_type: AbilityRecordType,
) -> SpellAbility {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::AbilityBuild);
    crate::perf::increment_params_parse();
    let parsed = ParsedParams::parse(ability_text);
    let params = Params::from_parsed(&parsed);
    build_spell_ability_of_type_with_params(
        host,
        ability_text,
        player,
        record_type,
        &parsed,
        params,
    )
}

fn build_spell_ability_of_type_with_params(
    host: &Card,
    ability_text: &str,
    player: PlayerId,
    record_type: AbilityRecordType,
    parsed: &ParsedParams<'_>,
    params: Params,
) -> SpellAbility {
    let api = parsed
        .get(record_type.prefix())
        .and_then(ApiType::smart_value_of);
    let mut ir = crate::ability::ability_ir::SpellAbilityIr::from_parsed(api, parsed);
    ir.compile_numeric_params_from_runtime(&params);
    let target_restrictions = if parsed.has(keys::VALID_TGTS) {
        TargetRestrictions::new_from_parsed(parsed, &params)
    } else {
        None
    };
    let cost = if record_type != AbilityRecordType::SubAbility {
        parsed.get(keys::COST).map(parse_cost)
    } else {
        None
    };
    let mut restriction = crate::spellability::SpellAbilityRestriction::default();
    let mut condition = crate::spellability::SpellAbilityCondition::default();

    match record_type {
        AbilityRecordType::Spell => restriction.variables.set_zone(ZoneType::Hand),
        AbilityRecordType::Ability
        | AbilityRecordType::StaticAbility
        | AbilityRecordType::SubAbility => restriction.variables.set_zone(ZoneType::Battlefield),
    }
    if parsed.has_any(RESTRICTION_KEYS) {
        restriction.set_restrictions_parsed(parsed);
    }
    if parsed.has_any(CONDITION_KEYS) {
        condition.set_conditions_parsed(parsed);
    }

    // Recursively build sub-ability chain from SVars
    let sub_ability = if let Some(sub_svar_name) = parsed.get(keys::SUB_ABILITY) {
        let depth = SUB_ABILITY_CHAIN_DEPTH.with(|d| d.get());
        if depth >= MAX_SUB_ABILITY_CHAIN_DEPTH {
            eprintln!(
                "SubAbility chain exceeded depth limit on {}, stopping at: {sub_svar_name}",
                host.card_name
            );
            None
        } else {
            host.get_s_var(sub_svar_name)
                .map(str::to_string)
                .map(|sub_text| {
                    SUB_ABILITY_CHAIN_DEPTH.with(|d| d.set(depth + 1));
                    let sub = Box::new(build_spell_ability_from_host_card(host, &sub_text, player));
                    SUB_ABILITY_CHAIN_DEPTH.with(|d| d.set(depth));
                    sub
                })
        }
    } else {
        None
    };

    let mana_part = if parsed.has(keys::PRODUCED) {
        build_mana_part_from_parsed(parsed)
    } else {
        None
    };
    let mut sa = SpellAbility {
        id: 0,
        api,
        source: Some(host.id),
        original_host: host.effect_source,
        activating_player: player,
        targeting_player: None,
        ability_text: ability_text.to_string(),
        record_type,
        ir,
        target_restrictions,
        target_chosen: TargetChoices::default(),
        pay_costs: cost,
        sub_ability,
        wrapped_ability: None,
        is_spell: record_type == AbilityRecordType::Spell,
        is_trigger: false,
        is_activated: record_type == AbilityRecordType::Ability,
        intrinsic: false,
        trigger_source: None,
        trigger_source_zone_timestamp: None,
        source_zone_timestamp: Some(host.zone_timestamp),
        source_trigger_id: None,
        trigger_index: None,
        alt_cost: None,
        alt_cost_index: 0,
        evoke_keyword_count: 0,
        kicked: false,
        buyback_paid: false,
        overloaded: false,
        is_copy: false,
        paid_life_amount: 0,
        kick_count: 0,
        replicate_count: 0,
        optional_generic_cost_paid: false,
        trigger_remembered_amount: 0,
        x_mana_cost_paid: 0,
        discarded_cost_cards: Vec::new(),
        optional_costs: Vec::new(),
        paid_hash: std::collections::HashMap::new(),
        paying_mana: Vec::new(),
        paid_abilities: Vec::new(),
        mana_part,
        express_mana_choice: None,
        convoke_tapped: Vec::new(),
        spliced_cards: Vec::new(),
        announce_vars: std::collections::HashMap::new(),
        sacrificed_as_emerge: None,
        sacrificed_as_offering: None,
        description: String::new(),
        stack_description: String::new(),
        is_mana_ability: false,
        is_land_ability: false,
        cast_face_down: false,
        trigger_objects: std::collections::HashMap::new(),
        trigger_spell_abilities: std::collections::HashMap::new(),
        additional_ability_lists: std::collections::HashMap::new(),
        replacing_objects: std::collections::HashMap::new(),
        trigger_remembered: Vec::new(),
        restriction,
        condition,
        rollback_effects: Vec::new(),
        optional_keyword_amounts: std::collections::HashMap::new(),
        pips_to_reduce: Vec::new(),
        may_choose_new_targets: false,
        last_state: std::collections::HashMap::new(),
        change_zone_table: None,
        damage_map: None,
        prevent_map: None,
    };
    if let Some(api) = api {
        crate::ability::effects::build_spell_ability_for_api(api, &mut sa);
    }
    sa
}

#[allow(dead_code)]
fn build_mana_part(params: &Params) -> Option<AbilityManaPart> {
    let produced = params.get(keys::PRODUCED)?;
    let mut mana_part = AbilityManaPart::new(produced, params.get(keys::RESTRICTION).unwrap_or(""));
    mana_part.set_adds_keywords(params.get(keys::ADDS_KEYWORDS).map(str::to_string));
    mana_part.set_triggers_when_spent(params.get(keys::TRIGGERS_WHEN_SPENT).map(str::to_string));
    mana_part.set_persistent_mana(params.has("PersistentMana"));
    mana_part.set_combat_mana(params.has("CombatMana"));
    Some(mana_part)
}

fn build_mana_part_from_parsed(params: &ParsedParams<'_>) -> Option<AbilityManaPart> {
    let produced = params.get(keys::PRODUCED)?;
    let mut mana_part = AbilityManaPart::new(produced, params.get(keys::RESTRICTION).unwrap_or(""));
    mana_part.set_adds_keywords(params.get(keys::ADDS_KEYWORDS).map(str::to_string));
    mana_part.set_triggers_when_spent(params.get(keys::TRIGGERS_WHEN_SPENT).map(str::to_string));
    mana_part.set_persistent_mana(params.has("PersistentMana"));
    mana_part.set_combat_mana(params.has("CombatMana"));
    Some(mana_part)
}

/// Parse the cost of an ability from its parameters.
/// Mirrors Java's `AbilityFactory.parseAbilityCost(Card, MapOfParams, RecordType)`.
///
/// For AB$ (activated) and SP$ (spell) abilities, reads the Cost$ parameter
/// and parses it into a Cost structure. Sub-abilities (DB$) have no cost.
pub fn parse_ability_cost(
    _host: &Card,
    params: &Params,
    record_type: AbilityRecordType,
) -> Option<Cost> {
    if record_type == AbilityRecordType::SubAbility {
        return None;
    }
    params.get(keys::COST).map(parse_cost)
}

/// Adjust the change-zone target for effects that move cards between zones.
/// Mirrors Java's `AbilityFactory.adjustChangeZoneTarget(MapOfParams, SpellAbility)`.
///
/// When a change-zone effect specifies `ChangeZoneTable$`, this function
/// adjusts the target resolution to use the table mapping instead of
/// the standard Defined$/Targeted resolution.
pub fn adjust_change_zone_target(sa: &mut SpellAbility, game: &GameState) {
    // If the SA has ChangeZoneTable, apply table-based targeting
    if sa.ir.change_zone_table {
        // The change_zone_table is populated during resolution by the effect.
        // This function sets up the SA to use table-based targeting by
        // ensuring the table exists.
        if sa.change_zone_table.is_none() {
            sa.change_zone_table = Some(crate::card::card_zone_table::CardZoneTable::default());
        }
    }

    // Handle "Hidden" origin — if the origin zone is hidden (Library, Hand),
    // adjust the target validation accordingly
    if let Some(origin) = sa.ir.origin_zone {
        let _ = game; // May need game state for validation in future
        if matches!(
            origin,
            forge_foundation::ZoneType::Library | forge_foundation::ZoneType::Hand
        ) {
            // Hidden zones use different targeting rules
            sa.ir.hidden = true;
        }
    }
}

/// Build a fused spell ability for split/fused cards.
/// Mirrors Java's `AbilityFactory.buildFusedAbility(Card)`.
///
/// Fuse cards (e.g. Fire // Ice with Fuse) allow casting both halves as a
/// single spell. This function creates a combined SpellAbility that chains
/// the left and right halves together.
pub fn build_fused_ability(
    game: &GameState,
    card_id: CardId,
    player: PlayerId,
) -> Option<SpellAbility> {
    let card = game.card(card_id);

    // Check if the card has the Fuse keyword
    let has_fuse = card.keywords.contains_string_ignore_case("Fuse")
        || card.granted_keywords.contains_string_ignore_case("Fuse");

    if !has_fuse {
        return None;
    }

    // A fused card needs at least 2 ability lines (one per half)
    if card.abilities.len() < 2 {
        return None;
    }

    // Build the first half
    let host = game.card(card_id);
    let mut left_sa = build_spell_ability_from_host_card(host, &card.abilities[0], player);
    left_sa.source = Some(card_id);

    // Build the second half and append as sub-ability
    let right_sa = build_spell_ability_from_host_card(host, &card.abilities[1], player);

    // Append right half to left half
    let mut slot = &mut left_sa.sub_ability;
    loop {
        match slot {
            Some(node) => slot = &mut node.sub_ability,
            None => {
                *slot = Some(Box::new(right_sa));
                break;
            }
        }
    }

    // Combine the costs
    if let (Some(left_cost), Some(right_cost)) = (
        &left_sa.pay_costs,
        &card.abilities.get(1).and_then(|text| {
            let params = Params::from_raw(text);
            params.get(keys::COST).map(parse_cost)
        }),
    ) {
        let mut combined_parts = left_cost.parts.clone();
        combined_parts.extend(right_cost.parts.clone());
        left_sa.pay_costs = Some(Cost {
            parts: combined_parts,
            has_tap: left_cost.has_tap || right_cost.has_tap,
            mandatory: false,
        });
    }

    left_sa.description = format!("Fuse (Cast both halves of {})", card.card_name);

    Some(left_sa)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_map_params() {
        let input = "AB$ DealDamage | Cost$ T | NumDmg$ 1";
        let map = get_map_params(input);
        assert_eq!(map.get("AB").unwrap(), "DealDamage");
        assert_eq!(map.get("Cost").unwrap(), "T");
        assert_eq!(map.get("NumDmg").unwrap(), "1");
    }

    #[test]
    fn test_record_type_from_params() {
        let params = Params::from_raw("DB$ Draw | NumCards$ 2");
        assert_eq!(
            AbilityRecordType::from_params(&params),
            Some(AbilityRecordType::SubAbility)
        );
    }

    #[test]
    fn test_record_type_from_params_static() {
        let params = Params::from_raw("ST$ Continuous");
        assert_eq!(
            AbilityRecordType::from_params(&params),
            Some(AbilityRecordType::StaticAbility)
        );
    }
}
