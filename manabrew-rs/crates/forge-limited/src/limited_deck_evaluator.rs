use std::sync::Arc;

use forge_foundation::sealed_product::PaperCard;

use crate::card_ranker::CardRanker;
use crate::draft_rank_cache::DraftRankCache;

pub struct LimitedDeckEvaluator;

impl LimitedDeckEvaluator {
    pub fn score_deck(deck: &[PaperCard], rank_cache: Arc<DraftRankCache>) -> f64 {
        if deck.is_empty() {
            return 0.0;
        }
        let ranker = CardRanker::new(rank_cache);
        let total: f64 = deck.iter().map(|c| ranker.get_raw_score(c)).sum();
        total / deck.len() as f64
    }
}
