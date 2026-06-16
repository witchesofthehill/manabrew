use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerManifestDread {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
}

impl TriggerManifestDread {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerManifestDread {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::ManifestDread
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(cards) = params.cards.as_ref() {
            let csv = cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Cards, &csv);
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, _sa: &SpellAbility) -> String {
        String::new()
    }
}
