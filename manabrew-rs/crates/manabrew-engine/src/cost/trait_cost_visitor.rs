//! Cost visitor abstraction for parity with Java `ICostVisitor<T>`.

use crate::agent::PlayerAgent;
use crate::cost::payment_decision::PaymentDecision;
use crate::cost::CostPart;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

pub trait CostVisitor<T> {
    fn visit(
        &mut self,
        player: PlayerId,
        source: CardId,
        cost_part: &CostPart,
        game: &GameState,
    ) -> Option<T>;
}

impl<T> CostVisitor<PaymentDecision> for T
where
    T: PlayerAgent + ?Sized,
{
    fn visit(
        &mut self,
        player: PlayerId,
        source: CardId,
        cost_part: &CostPart,
        game: &GameState,
    ) -> Option<PaymentDecision> {
        self.decide_cost_part(player, source, cost_part, game)
    }
}
