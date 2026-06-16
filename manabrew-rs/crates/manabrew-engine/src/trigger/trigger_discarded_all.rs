use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDiscardedAll {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_player: Option<crate::parsing::CompiledSelector>,
}

impl TriggerDiscardedAll {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerDiscardedAll {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::DiscardedAll
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
            && trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: filters cards with ValidCard via CardLists.getValidCards, then sets Cards, Amount, Player, Cause
        // TODO: ValidCard filtering skipped — free function has no access to trigger params (hasParam/getParam)
        if let Some(cards) = params.cards.as_ref() {
            let csv = cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Cards, &csv);
            sa.set_triggering_object(crate::ability::AbilityKey::Amount, cards.len().to_string());
        }
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
        }
        // TODO: AbilityKey.Cause is a SpellAbility in Java, cannot be stored as String easily
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Player: {}, Amount: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Player)
                .unwrap_or_default(),
            sa.get_triggering_object(crate::ability::AbilityKey::Amount)
                .unwrap_or_default()
        )
    }
}
