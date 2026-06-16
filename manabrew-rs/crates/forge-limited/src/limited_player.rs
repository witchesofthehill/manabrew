use std::collections::VecDeque;

use forge_foundation::sealed_product::PaperCard;

use crate::draft_pack::DraftPack;
use crate::limited_agent::LimitedAgent;

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct PlayerFlags: u32 {
        const AGENT_ACQUISITIONS_CAN_DRAFT_ALL    = 1 << 0;
        const AGENT_ACQUISITIONS_IS_DRAFTING_ALL  = 1 << 1;
        const AGENT_ACQUISITIONS_SKIP_DRAFT_ROUND = 1 << 2;
        const COGWORK_LIBRARIAN_EXTRA_DRAFT       = 1 << 3;
        const COGWORK_LIBRARIAN_RETURN_LIBRARIAN  = 1 << 4;
        const ANIMUS_REMOVE_FROM_POOL             = 1 << 5;
        const NOBLE_BANNERET_ACTIVE               = 1 << 6;
        const PALIANO_VANGUARD_ACTIVE             = 1 << 7;
        const GRINDER_REMOVE_FROM_POOL            = 1 << 8;
        const SEARCHER_NOTE_NEXT                  = 1 << 9;
        const WHISPERGEAR_BOOSTER_PEEK            = 1 << 10;
        const ILLUSIONARY_INFORMANT_PEEK          = 1 << 11;
        const LEOVOLDS_OPERATIVE_CAN_EXTRA_DRAFT  = 1 << 12;
        const LEOVOLDS_OPERATIVE_EXTRA_DRAFT      = 1 << 13;
        const LEOVOLDS_OPERATIVE_SKIP_NEXT        = 1 << 14;
        const SPY_NEXT_CARD_DRAFTED               = 1 << 15;
        const CANAL_DREDGER_LAST_PICK             = 1 << 16;
        const ARCHDEMON_OF_PALIANO_CURSE          = 1 << 17;
        const SMUGGLER_CAPTAIN_ACTIVE             = 1 << 18;
    }
}

pub struct LimitedPlayer {
    pub seat: usize,
    pub name: String,
    pub is_human: bool,
    pub picked: Vec<PaperCard>,
    pub unopened_packs: VecDeque<DraftPack>,
    pub pack_queue: VecDeque<DraftPack>,
    pub last_pick: Option<PaperCard>,
    pub flags: PlayerFlags,
    pub agent: Box<dyn LimitedAgent>,
}

impl std::fmt::Debug for LimitedPlayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LimitedPlayer")
            .field("seat", &self.seat)
            .field("name", &self.name)
            .field("is_human", &self.is_human)
            .field("picked", &self.picked.len())
            .field("unopened_packs", &self.unopened_packs.len())
            .field("pack_queue", &self.pack_queue.len())
            .finish()
    }
}

impl LimitedPlayer {
    pub fn new(
        seat: usize,
        name: impl Into<String>,
        is_human: bool,
        agent: Box<dyn LimitedAgent>,
    ) -> Self {
        Self {
            seat,
            name: name.into(),
            is_human,
            picked: Vec::new(),
            unopened_packs: VecDeque::new(),
            pack_queue: VecDeque::new(),
            last_pick: None,
            flags: PlayerFlags::empty(),
            agent,
        }
    }

    pub fn current_pack(&self) -> Option<&DraftPack> {
        self.pack_queue.front()
    }

    pub fn current_pack_mut(&mut self) -> Option<&mut DraftPack> {
        self.pack_queue.front_mut()
    }

    pub fn open_next_pack(&mut self) -> Option<()> {
        let pack = self.unopened_packs.pop_front()?;
        self.pack_queue.push_back(pack);
        Some(())
    }

    pub fn pop_front_pack(&mut self) -> Option<DraftPack> {
        match self.pack_queue.front() {
            Some(p) if p.is_empty() => {
                self.pack_queue.pop_front();
                None
            }
            Some(_) => self.pack_queue.pop_front(),
            None => None,
        }
    }

    pub fn receive_pack(&mut self, pack: DraftPack) {
        self.pack_queue.push_back(pack);
    }

    pub fn drafted_count(&self) -> usize {
        self.picked.len()
    }
}
