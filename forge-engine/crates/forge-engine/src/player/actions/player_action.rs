use serde::{Deserialize, Serialize};

use crate::agent::types::{MainPhaseAction, PlayOption, TargetChoice};
use crate::agent::PlayerAgent;
use crate::ids::{CardId, PlayerId};
use crate::player::PlayerController;

pub const STATIC_ALTERNATIVE_ABILITY_INDEX: usize = usize::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayerAction {
    PassPriority,
    Concede,
    FinishTargeting,
    CastSpell(PlayOption),
    ActivateMana(CardId, Option<usize>, Option<u16>),
    UndoMana(CardId),
    ActivateAbility(AbilityRef),
    PayCost(CardId),
    PayManaFromPool(ManaChoice),
    SelectCard(CardId),
    SelectPlayer(PlayerId),
    TargetEntity(TargetEntity),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AbilityRef {
    pub card_id: CardId,
    pub ability_index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManaChoice {
    pub color_code: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetEntity {
    Card(CardId),
    Player(PlayerId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerActionOutcome {
    Priority(MainPhaseAction),
    Target(TargetChoice),
    Pending,
}

impl PlayerAction {
    pub fn to_priority_action(
        self,
        playable: &[PlayOption],
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        activatable: &[(CardId, usize)],
    ) -> Option<MainPhaseAction> {
        match self {
            PlayerAction::PassPriority => Some(MainPhaseAction::Pass),
            PlayerAction::CastSpell(play) => playable
                .contains(&play)
                .then_some(MainPhaseAction::Play(play)),
            PlayerAction::ActivateMana(card_id, ability_index, express_choice) => tappable_lands
                .contains(&card_id)
                .then_some(MainPhaseAction::ActivateMana(
                    card_id,
                    ability_index,
                    express_choice,
                )),
            PlayerAction::UndoMana(card_id) => untappable_lands
                .contains(&card_id)
                .then_some(MainPhaseAction::UntapMana(card_id)),
            PlayerAction::ActivateAbility(ability) => activatable
                .iter()
                .copied()
                .find(|(card_id, index)| {
                    *card_id == ability.card_id && *index == ability.ability_index
                })
                .map(|(card_id, index)| MainPhaseAction::ActivateAbility(card_id, index)),
            _ => None,
        }
    }

    pub fn to_target_choice(self) -> Option<TargetChoice> {
        match self {
            PlayerAction::SelectCard(card_id) => Some(TargetChoice::Card(card_id)),
            PlayerAction::SelectPlayer(player_id) => Some(TargetChoice::Player(player_id)),
            PlayerAction::TargetEntity(TargetEntity::Card(card_id)) => {
                Some(TargetChoice::Card(card_id))
            }
            PlayerAction::TargetEntity(TargetEntity::Player(player_id)) => {
                Some(TargetChoice::Player(player_id))
            }
            PlayerAction::FinishTargeting => Some(TargetChoice::None),
            _ => None,
        }
    }

    pub fn run<A: PlayerAgent + ?Sized>(
        self,
        _controller: &mut PlayerController<'_, A>,
        playable: &[PlayOption],
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        activatable: &[(CardId, usize)],
    ) -> PlayerActionOutcome {
        if let Some(priority) =
            self.to_priority_action(playable, tappable_lands, untappable_lands, activatable)
        {
            return PlayerActionOutcome::Priority(priority);
        }
        if let Some(target) = self.to_target_choice() {
            return PlayerActionOutcome::Target(target);
        }
        PlayerActionOutcome::Pending
    }
}
