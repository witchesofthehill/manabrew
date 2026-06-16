use std::sync::Arc;

use forge_foundation::sealed_product::PaperCard;
use forge_foundation::ColorSet;

use crate::card_ranker::CardRanker;
use crate::limited_agent::LimitedAgent;
use crate::limited_player::LimitedPlayer;
use crate::limited_player_ai::LimitedPlayerAI;

pub struct BoosterDraftAI;

impl BoosterDraftAI {
    pub fn build_ai_seats(
        count: usize,
        start_seat: usize,
        ranker: Arc<CardRanker>,
        color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync>,
    ) -> Vec<LimitedPlayer> {
        (0..count)
            .map(|i| {
                let agent: Box<dyn LimitedAgent> =
                    Box::new(LimitedPlayerAI::new(ranker.clone(), color_of.clone()));
                LimitedPlayer::new(start_seat + i, format!("AI {}", i + 1), false, agent)
            })
            .collect()
    }
}
