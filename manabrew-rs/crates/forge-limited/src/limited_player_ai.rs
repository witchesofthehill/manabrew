use std::any::Any;
use std::sync::Arc;

use forge_foundation::sealed_product::PaperCard;
use forge_foundation::ColorSet;

use crate::card_ranker::CardRanker;
use crate::deck_colors::DeckColors;
use crate::draft_pack::DraftPack;
use crate::limited_agent::LimitedAgent;

pub struct LimitedPlayerAI {
    ranker: Arc<CardRanker>,
    colors: DeckColors,
    color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync>,
    pile: Vec<PaperCard>,
}

impl LimitedPlayerAI {
    pub fn new(
        ranker: Arc<CardRanker>,
        color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync>,
    ) -> Self {
        Self {
            ranker,
            colors: DeckColors::new(),
            color_of,
            pile: Vec::new(),
        }
    }

    pub fn observed_pile(&self) -> &[PaperCard] {
        &self.pile
    }
}

impl LimitedAgent for LimitedPlayerAI {
    fn choose_card(&mut self, pack: &DraftPack) -> Option<PaperCard> {
        if pack.is_empty() {
            return None;
        }
        let ranked = self.ranker.rank_cards_in_pack(
            pack.cards(),
            &self.pile,
            self.colors.chosen(),
            self.colors.can_choose_more_colors(),
            |c| (self.color_of)(c),
        );
        let pick = ranked.into_iter().next()?;
        let pick_colors = (self.color_of)(&pick);
        self.colors.observe(&pick, pick_colors);
        self.pile.push(pick.clone());
        Some(pick)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
