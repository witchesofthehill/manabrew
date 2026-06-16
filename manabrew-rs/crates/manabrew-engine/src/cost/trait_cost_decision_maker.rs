//! Cost decision maker parity wrapper for Java `CostDecisionMakerBase`.

use crate::agent::PlayerAgent;
use crate::cost::payment_decision::PaymentDecision;
use crate::cost::trait_cost_visitor::CostVisitor;
use crate::cost::CostPart;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

pub trait CostDecisionMakerBase: CostVisitor<PaymentDecision> {
    fn get_player(&self) -> PlayerId;
    fn is_effect(&self) -> bool;
    fn pays_right_after_decision(&self) -> bool;
}

pub struct DefaultCostDecisionMaker<'a> {
    pub player: PlayerId,
    pub ability: Option<&'a SpellAbility>,
    pub source: CardId,
    pub effect: bool,
    pub agent: &'a mut dyn PlayerAgent,
}

impl<'a> DefaultCostDecisionMaker<'a> {
    pub fn get_player(&self) -> PlayerId {
        self.player
    }

    pub fn is_effect(&self) -> bool {
        self.effect
    }

    pub fn pays_right_after_decision(&self) -> bool {
        self.agent.pays_right_after_decision()
    }
}

impl<'a> CostVisitor<PaymentDecision> for DefaultCostDecisionMaker<'a> {
    fn visit(
        &mut self,
        player: PlayerId,
        source: CardId,
        cost_part: &CostPart,
        game: &GameState,
    ) -> Option<PaymentDecision> {
        self.agent.visit(player, source, cost_part, game)
    }
}

impl<'a> CostDecisionMakerBase for DefaultCostDecisionMaker<'a> {
    fn get_player(&self) -> PlayerId {
        self.player
    }
    fn is_effect(&self) -> bool {
        self.effect
    }
    fn pays_right_after_decision(&self) -> bool {
        self.agent.pays_right_after_decision()
    }
}
