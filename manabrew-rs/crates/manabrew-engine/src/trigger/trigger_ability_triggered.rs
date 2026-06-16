use serde::{Deserialize, Serialize};

use super::trigger::TriggerBehavior;
use crate::ability::AbilityKey;
use crate::{
    event::{AbilityValue, RunParams},
    game::GameState,
    ids::CardId,
    parsing::Params,
    spellability::SpellAbility,
    trigger::TriggerType,
};

fn split_csv(s: &str) -> impl Iterator<Item = &str> {
    s.split(',').map(str::trim).filter(|p| !p.is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAbilityTriggered {
    pub valid_mode: Option<String>,
    pub valid_destination: Option<String>,
    pub valid_spell_ability: Option<String>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub valid_cause: Option<crate::parsing::CompiledSelector>,
    pub triggered_own_ability: bool,
}

impl TriggerAbilityTriggered {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_mode: params.get_cloned("ValidMode"),
            valid_destination: params.get_cloned("ValidDestination"),
            valid_spell_ability: params.get_cloned("ValidSpellAbility"),
            valid_source: params.selector_cloned("ValidSource"),
            valid_cause: params.selector_cloned("ValidCause"),
            triggered_own_ability: params.has("TriggeredOwnAbility"),
        })
    }
}

fn destination_names(params: &RunParams) -> Option<String> {
    if let Some(destinations) = params.destinations.as_ref() {
        return Some(destinations.clone());
    }
    if let Some(zone_changes) = params.zone_changes.as_ref() {
        let mut ordered = Vec::new();
        for change in zone_changes {
            let name = format!("{:?}", change.destination);
            if !ordered.contains(&name) {
                ordered.push(name);
            }
        }
        if !ordered.is_empty() {
            return Some(ordered.join(","));
        }
    }
    params
        .destination
        .map(|destination| format!("{destination:?}"))
}

fn cause_cards_for_trigger(
    trigger: &super::trigger::Trigger,
    params: &RunParams,
    game: &GameState,
) -> Vec<CardId> {
    match trigger.kind {
        TriggerType::ChangesZone => params.card.into_iter().collect(),
        TriggerType::ChangesZoneAll => params
            .change_zone_table
            .as_ref()
            .map(|table| table.all_cards())
            .or_else(|| params.cards.clone())
            .unwrap_or_default(),
        TriggerType::Attacks => params.attacker.into_iter().collect(),
        TriggerType::AttackersDeclared | TriggerType::AttackersDeclaredOneTarget => {
            let attackers = params.attacker_ids.clone().unwrap_or_default();
            if let Some(valid_attackers) = trigger.ir.valid_attackers_selector.as_ref() {
                attackers
                    .into_iter()
                    .filter(|&card_id| {
                        trigger.matches_valid_card_filter(valid_attackers, card_id, game)
                    })
                    .collect()
            } else {
                attackers
            }
        }
        _ => params
            .cards
            .clone()
            .or_else(|| params.card.map(|card| vec![card]))
            .unwrap_or_default(),
    }
}

pub(crate) fn build_run_params(
    trigger: &super::trigger::Trigger,
    spell_ability: &SpellAbility,
    params: &RunParams,
    game: &GameState,
) -> RunParams {
    let destinations = destination_names(params);
    let cause_cards = cause_cards_for_trigger(trigger, params, game);

    RunParams {
        spell_ability: Some(spell_ability.clone()),
        source_sa: Some(spell_ability.clone()),
        cause_card: spell_ability.source,
        cards: if cause_cards.is_empty() {
            None
        } else {
            Some(cause_cards)
        },
        mode: Some(trigger.kind.name().to_string()),
        destination: destinations
            .as_deref()
            .and_then(|csv| csv.split(',').next())
            .and_then(forge_foundation::ZoneType::from_str_compat),
        destinations,
        ..Default::default()
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAbilityTriggered {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::AbilityTriggered
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let Some(AbilityValue::SpellAbility(sa)) = params.get_value(AbilityKey::SpellAbility)
        else {
            return false;
        };
        let Some(source) = sa.source else {
            return false;
        };

        if let Some(valid_modes) = &self.valid_mode {
            let Some(AbilityValue::String(mode_name)) = params.get_value(AbilityKey::Mode) else {
                return false;
            };
            if !split_csv(valid_modes).any(|m| m.eq_ignore_ascii_case(&mode_name)) {
                return false;
            }
        }

        if let Some(valid_destinations) = &self.valid_destination {
            let destinations = if let Some(AbilityValue::String(destinations)) =
                params.get_value(AbilityKey::Destination)
            {
                destinations
            } else if let Some(AbilityValue::Zone(dest)) = params.get_value(AbilityKey::Destination)
            {
                format!("{dest:?}")
            } else {
                return false;
            };
            if split_csv(&destinations).all(|destination_name| {
                !split_csv(valid_destinations).any(|d| d.eq_ignore_ascii_case(destination_name))
            }) {
                return false;
            }
        }

        if let Some(filter) = &self.valid_spell_ability {
            if !trigger.matches_valid_sa_filter(filter, &sa) {
                return false;
            }
        }

        if !trigger.matches_optional_valid_card_filter(&self.valid_source, Some(source), game) {
            return false;
        }

        let causes = match params.get_value(AbilityKey::Cause) {
            Some(AbilityValue::Cards(cards)) => cards,
            Some(AbilityValue::Card(card)) => vec![card],
            _ => params.cards.clone().unwrap_or_default(),
        };

        if let Some(filter) = &self.valid_cause {
            if causes.is_empty() {
                return false;
            }
            if !causes.iter().any(|&c| {
                trigger.matches_optional_valid_card_filter(&Some(filter.clone()), Some(c), game)
            }) {
                return false;
            }
        }

        if self.triggered_own_ability && !causes.contains(&source) {
            return false;
        }

        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObject(AbilityKey.Source, triggeredSA.getHostCard());
        // The source is the host card of the triggered SpellAbility
        if let Some(ref triggered_sa) = params.spell_ability {
            if let Some(source) = triggered_sa.source {
                sa.set_triggering_object(crate::ability::AbilityKey::Source, source.0.to_string());
            }
        } else if let Some(card) = params.source_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, card.0.to_string());
        }
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.SpellAbility, AbilityKey.Cause);
        // SpellAbility and Cause are complex objects; store what we can
        if let Some(ref cause_cards) = params.cards {
            let csv = cause_cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Cause, &csv);
        } else if let Some(cause_card) = params.cause_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Cause, cause_card.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "SpellAbility: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::SpellAbility)
                .unwrap_or("")
        )
    }
}
