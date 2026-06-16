use serde::{Deserialize, Serialize};

use crate::card::valid_filter;
use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerBecomesTarget {
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub valid_target: Option<crate::parsing::CompiledSelector>,
    pub require_first_time: bool,
    pub require_valiant: bool,
}

impl TriggerBecomesTarget {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        // Java parity: BecomesTarget triggers can use either `ValidTarget$` or
        // `ValidCard$` to filter which card-becoming-target counts. Keyword-generated
        // Ward uses `ValidCard$ Card.Self` (see keyword_gen.rs); other scripts use
        // `ValidTarget$`. Without the `ValidCard` fallback Ward fires on *every*
        // BecomesTarget event in the game, since both filters end up None.
        let valid_target = params
            .selector_cloned(keys::VALID_TARGET)
            .or_else(|| params.selector_cloned(keys::VALID_CARD));
        Box::new(Self {
            valid_source: params.selector_cloned(keys::VALID_SOURCE),
            valid_target,
            require_first_time: params.has("FirstTime"),
            require_valiant: params.has("Valiant"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerBecomesTarget {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::BecomesTarget
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let host_controller = trigger.base.card_trait_base.host_controller(game);
        if let Some(filter) = self.valid_source.as_ref() {
            let source_matches = if let Some(source_sa) = params.source_sa.as_ref() {
                let raw_filter = filter.as_raw();
                if raw_filter.starts_with("SpellAbility") {
                    let parts: Vec<&str> = raw_filter.split('.').collect();
                    let kind_matches = parts
                        .first()
                        .is_none_or(|part| part.eq_ignore_ascii_case("SpellAbility"));
                    if !kind_matches {
                        false
                    } else {
                        parts.iter().skip(1).all(|part| match *part {
                            "OppCtrl" => source_sa.activating_player != host_controller,
                            "YouCtrl" => source_sa.activating_player == host_controller,
                            _ => true,
                        })
                    }
                } else {
                    source_sa.source.is_some_and(|source_card| {
                        trigger.matches_valid_card_filter(filter, source_card, game)
                    })
                }
            } else if let Some(source_card) = params.cause_card {
                trigger.matches_valid_card_filter(filter, source_card, game)
            } else {
                false
            };
            if !source_matches {
                return false;
            }
        }

        if let Some(filter) = self.valid_target.as_ref() {
            let target_card = params.target_card.or(params.card);
            let target_player = params.target_player.or(params.player);
            let host = game.card(trigger.host_card_id());
            if !valid_filter::matches_valid(
                &filter.as_raw(),
                target_card.map(|id| game.card(id)),
                target_player,
                host,
                host_controller,
            ) {
                return false;
            }
        }

        if self.require_first_time && params.first_time != Some(true) {
            return false;
        }
        if self.require_valiant && params.valiant != Some(true) {
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
        if let Some(ref source_sa) = params.source_sa {
            if let Some(source_card) = source_sa.source {
                sa.set_triggering_object(
                    crate::ability::AbilityKey::Source,
                    source_card.0.to_string(),
                );
            }
            sa.set_triggering_spell_ability("SourceSA", source_sa.clone());
        }
        if let Some(card) = params.target_card.or(params.card) {
            sa.set_triggering_object(crate::ability::AbilityKey::Target, card.0.to_string());
        } else if let Some(p) = params.target_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Target, p.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Source: {}, Target: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Source)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Target)
                .unwrap_or("")
        )
    }
}
