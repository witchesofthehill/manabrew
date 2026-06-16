use forge_foundation::{PhaseType, ZoneType};

use crate::card::valid_filter::CardTraitRequirementsIr;
use crate::parsing::{keys, CompiledSelector, Params};
use crate::spellability::TriggerCondition;

#[derive(Debug, Clone, Default)]
pub struct TriggerIr {
    pub card_trait_requirements: CardTraitRequirementsIr,
    pub trigger_description: Option<String>,
    pub phase_count: Option<i32>,
    pub player_turn: bool,
    pub not_player_turn: bool,
    pub opponent_turn: bool,
    pub first_upkeep: bool,
    pub first_upkeep_this_game: bool,
    pub first_combat: bool,
    pub turn_count: Option<u32>,
    pub a_player_has_more_life_than_each_other: bool,
    pub a_player_has_most_cards_in_hand: bool,
    pub condition: Option<TriggerCondition>,
    pub chapter: Option<i32>,
    pub origin_zone: Option<ZoneType>,
    pub destination_zone: Option<ZoneType>,
    pub origin_zones: Vec<ZoneType>,
    pub destination_zones: Vec<ZoneType>,
    pub excluded_origins: Vec<ZoneType>,
    pub excluded_destinations: Vec<ZoneType>,
    pub valid_attackers_selector: Option<CompiledSelector>,
    pub valid_card_selector: Option<CompiledSelector>,
    pub valid_cause_selector: Option<CompiledSelector>,
    pub not_this_ability: bool,
    pub fizzle: Option<bool>,
    pub condition_you_cast_this_turn: Option<String>,
    pub check_on_triggered_card: Option<String>,
    pub resolved_limit: Option<u32>,
    pub activation_limit: Option<u32>,
    pub game_activation_limit: Option<u32>,
    pub valid_phases: Option<Vec<PhaseType>>,
    pub activator_this_turn_cast: Option<String>,
}

impl TriggerIr {
    pub fn from_params(params: &Params) -> Self {
        Self {
            card_trait_requirements: CardTraitRequirementsIr::from_key_values(
                params.iter(),
                params.selector_untracked(keys::IS_PRESENT).cloned(),
                params.selector_untracked("IsPresent2").cloned(),
            ),
            trigger_description: params.get(keys::TRIGGER_DESCRIPTION).map(str::to_string),
            phase_count: params.get("PhaseCount").and_then(|v| v.parse().ok()),
            player_turn: params.has(keys::PLAYER_TURN),
            not_player_turn: params.has("NotPlayerTurn"),
            opponent_turn: params.has("OpponentTurn"),
            first_upkeep: params.has("FirstUpkeep"),
            first_upkeep_this_game: params.has("FirstUpkeepThisGame"),
            first_combat: params.has("FirstCombat"),
            turn_count: params.get("TurnCount").and_then(|v| v.parse().ok()),
            a_player_has_more_life_than_each_other: params.has("APlayerHasMoreLifeThanEachOther"),
            a_player_has_most_cards_in_hand: params.has("APlayerHasMostCardsInHand"),
            condition: params.get(keys::CONDITION).map(TriggerCondition::parse),
            chapter: params.get("Chapter").and_then(|v| v.parse().ok()),
            origin_zone: params
                .get(keys::ORIGIN)
                .and_then(|s| s.split(',').next())
                .and_then(|s| ZoneType::from_str_compat(s.trim())),
            destination_zone: params
                .get(keys::DESTINATION)
                .and_then(|s| s.split(',').next())
                .and_then(|s| ZoneType::from_str_compat(s.trim())),
            origin_zones: params
                .get(keys::ORIGIN)
                .map(|raw| {
                    raw.split(',')
                        .filter_map(|s| ZoneType::from_str_compat(s.trim()))
                        .collect()
                })
                .unwrap_or_default(),
            destination_zones: params
                .get(keys::DESTINATION)
                .map(|raw| {
                    raw.split(',')
                        .filter_map(|s| ZoneType::from_str_compat(s.trim()))
                        .collect()
                })
                .unwrap_or_default(),
            excluded_origins: params
                .get("ExcludedOrigins")
                .map(|raw| {
                    raw.split(',')
                        .filter_map(|s| ZoneType::from_str_compat(s.trim()))
                        .collect()
                })
                .unwrap_or_default(),
            excluded_destinations: params
                .get("ExcludedDestinations")
                .map(|raw| {
                    raw.split(',')
                        .filter_map(|s| ZoneType::from_str_compat(s.trim()))
                        .collect()
                })
                .unwrap_or_default(),
            valid_attackers_selector: params.selector_cloned("ValidAttackers"),
            valid_card_selector: params.selector_cloned(keys::VALID_CARD),
            valid_cause_selector: params.selector_cloned(keys::VALID_CAUSE),
            not_this_ability: params.has("NotThisAbility"),
            fizzle: params
                .get("Fizzle")
                .map(|value| value.eq_ignore_ascii_case("true")),
            condition_you_cast_this_turn: params
                .get("ConditionYouCastThisTurn")
                .map(str::to_string),
            check_on_triggered_card: params.get("CheckOnTriggeredCard").map(str::to_string),
            resolved_limit: params.get("ResolvedLimit").and_then(|v| v.parse().ok()),
            activation_limit: params.get("ActivationLimit").and_then(|v| v.parse().ok()),
            game_activation_limit: params
                .get(keys::GAME_ACTIVATION_LIMIT)
                .and_then(|v| v.parse().ok()),
            valid_phases: params.get(keys::PHASE).map(|phase_text| {
                phase_text
                    .split(',')
                    .filter_map(|token| PhaseType::from_script_name(token.trim()))
                    .collect::<Vec<_>>()
            }),
            activator_this_turn_cast: params
                .get(keys::ACTIVATOR_THIS_TURN_CAST)
                .map(str::to_string),
        }
    }
}
