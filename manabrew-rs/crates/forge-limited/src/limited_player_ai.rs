use std::any::Any;
use std::sync::Arc;

use forge_foundation::sealed_product::PaperCard;
use forge_foundation::ColorSet;
use serde::{Deserialize, Serialize};

use crate::card_ranker::CardRanker;
use crate::deck_colors::DeckColors;
use crate::draft_pack::DraftPack;
use crate::limited_agent::LimitedAgent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitedPlayerAIState {
    colors: DeckColors,
    pile: Vec<PaperCard>,
}

#[derive(Serialize)]
pub struct LimitedPlayerAI {
    #[serde(skip_serializing)]
    ranker: Arc<CardRanker>,
    colors: DeckColors,
    #[serde(skip_serializing)]
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

    pub fn export_state(&self) -> LimitedPlayerAIState {
        LimitedPlayerAIState {
            colors: self.colors.clone(),
            pile: self.pile.clone(),
        }
    }

    pub fn restore_state(&mut self, state: LimitedPlayerAIState) {
        self.colors = state.colors;
        self.pile = state.pile;
    }

    pub fn observed_pile(&self) -> &[PaperCard] {
        &self.pile
    }
    pub fn build_deck(
        &self,
        name: &str,
        pool: &[PaperCard],
    ) -> crate::limited_deck_builder::LimitedDeck {
        let color_of = self.color_of.clone();
        crate::limited_deck_builder::LimitedDeckBuilder::new(
            pool.to_vec(),
            self.colors.clone(),
            self.ranker.clone(),
            move |card| color_of(card),
            |card| card.rarity == forge_foundation::sealed_product::Rarity::BasicLand,
        )
        .build_deck(name, None)
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
