use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerConjureAll {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerConjureAll {
    pub fn parse(
        valid_player: Option<crate::parsing::CompiledSelector>,
        valid_card: Option<crate::parsing::CompiledSelector>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player,
            valid_card,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerConjureAll {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::ConjureAll
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        if !trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game) {
            return false;
        }
        let Some(cards) = params.cards.as_ref() else {
            return self.valid_card.is_none();
        };
        cards.iter().any(|&cid| {
            trigger.matches_optional_valid_card_filter(&self.valid_card, Some(cid), game)
        })
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // TODO: Java filters cards by ValidCard param before setting.
        // We don't have access to trigger params here, passing through all cards.
        if let Some(cards) = params.cards.as_ref() {
            let csv = cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Cards, &csv);
        }
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
        }
        // TODO: Java also sets Cause from runParams via
        // sa.setTriggeringObjectsFrom(runParams, AbilityKey.Cause)
        // Skipping Cause for now since SpellAbility is complex and stored as object in Java
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Player: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Player)
                .cloned()
                .unwrap_or_default()
        )
    }
}
