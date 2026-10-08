use std::any::Any;

use forge_foundation::sealed_product::PaperCard;
use serde::{Deserialize, Serialize};

use crate::draft_pack::DraftPack;

pub trait LimitedAgent: Send + Any {
    fn choose_card(&mut self, pack: &DraftPack) -> Option<PaperCard>;

    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HumanLimitedAgent {
    pending_pick: Option<PaperCard>,
}

impl HumanLimitedAgent {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn submit_pick(&mut self, card: PaperCard) {
        self.pending_pick = Some(card);
    }

    pub fn has_pending(&self) -> bool {
        self.pending_pick.is_some()
    }

    pub fn pending_pick(&self) -> Option<&PaperCard> {
        self.pending_pick.as_ref()
    }

    pub fn clear_pending(&mut self) {
        self.pending_pick = None;
    }
}

impl LimitedAgent for HumanLimitedAgent {
    fn choose_card(&mut self, _pack: &DraftPack) -> Option<PaperCard> {
        self.pending_pick.take()
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
