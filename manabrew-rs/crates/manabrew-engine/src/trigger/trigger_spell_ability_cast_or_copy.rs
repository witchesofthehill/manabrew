use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerSpellAbilityCastOrCopy {
    pub trigger_type: TriggerType,
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_activating_player: Option<crate::parsing::CompiledSelector>,
}

impl TriggerSpellAbilityCastOrCopy {
    pub fn parse(mode_str: &str, params: &Params) -> Box<dyn TriggerBehavior> {
        let valid_card = params.selector_cloned(keys::VALID_CARD);
        let valid_activating_player = params.selector_cloned(keys::VALID_ACTIVATING_PLAYER);
        let trigger_type = match mode_str {
            "SpellCast" => TriggerType::SpellCast,
            "AbilityCast" => TriggerType::AbilityCast,
            "SpellAbilityCast" => TriggerType::SpellAbilityCast,
            "SpellCastOrCopy" => TriggerType::SpellCastOrCopy,
            "SpellCopied" => TriggerType::SpellCopied,
            "SpellAbilityCopy" => TriggerType::SpellAbilityCopy,
            "SpellCopy" => TriggerType::SpellCopy,
            "SpellCastAll" => TriggerType::SpellCastAll,
            "SpellCastOnce" => TriggerType::SpellCastOnce,
            "SpellCastOfType" => TriggerType::SpellCastOfType,
            _ => panic!("Unsupported spell/ability cast-or-copy mode: {mode_str}"),
        };
        Box::new(Self {
            trigger_type,
            valid_card,
            valid_activating_player,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerSpellAbilityCastOrCopy {
    fn trigger_type(&self) -> TriggerType {
        self.trigger_type
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let valid_card_matches = match (&self.valid_card, params.spell_card) {
            (None, _) => true,
            (Some(_), None) => false,
            (Some(selector), Some(card_id)) => {
                let source = trigger.base.card_trait_base.host_card(game);
                let mut context =
                    crate::card::valid_filter::MatchContext::from_source(source).with_game(game);
                if let Some(sa) = params.source_sa.as_ref() {
                    context = context.with_spell_ability(sa);
                }
                crate::card::valid_filter::matches_valid_card_selector_with_context(
                    selector,
                    game.card(card_id),
                    context,
                )
            }
        };
        valid_card_matches
            && trigger.matches_optional_valid_player_filter(
                &self.valid_activating_player,
                params.spell_controller,
                game,
            )
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObject(AbilityKey.Card, cause.getHostCard())
        if let Some(card) = params.spell_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card.0.to_string());
        }
        // TODO: port SpellAbility triggering object (AbilityKey.SpellAbility = cause)
        // TODO: port SpellAbilityTargets triggering object (from cause.getAllTargetChoices)
        if let Some(amount) = params.life_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::LifeAmount, amount.to_string());
        }
        if let Some(lki) = params.card_lki {
            sa.set_triggering_object(crate::ability::AbilityKey::CardLKI, lki.0.to_string());
        }
        if let Some(p) = params.activator {
            sa.set_triggering_object(crate::ability::AbilityKey::Activator, p.0.to_string());
        }
        // TODO: port CurrentStormCount triggering object - not yet in RunParams
        // TODO: port CurrentCastSpells triggering object - not yet in RunParams
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        // Java: "Card: {card}, Activator: {activator}, SpellAbility: {sa}"
        // TODO: include SpellAbility in output once SpellAbility triggering object is ported
        format!(
            "Card: {}, Activator: {}, SpellAbility: ",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Card)
                .map(|s| s.as_str())
                .unwrap_or(""),
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Activator)
                .map(|s| s.as_str())
                .unwrap_or("")
        )
    }
}
