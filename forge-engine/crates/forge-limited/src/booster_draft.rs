use std::sync::Arc;

use forge_foundation::sealed_product::{
    IUnOpenedProduct, PaperCard, SealedTemplate, UnOpenedProduct,
};
use forge_foundation::ColorSet;
use rand::rngs::StdRng;
use rand::SeedableRng;

use crate::booster_draft_ai::BoosterDraftAI;
use crate::card_ranker::CardRanker;
use crate::draft_pack::DraftPack;
use crate::i_booster_draft::IBoosterDraft;
use crate::i_draft_log::{IDraftLog, VecDraftLog};
use crate::limited_agent::{HumanLimitedAgent, LimitedAgent};
use crate::limited_player::LimitedPlayer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassDirection {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TickOutcome {
    Progress,
    AwaitingHuman,
    RoundOver,
    Complete,
}

pub const POD_SIZE_DEFAULT: usize = 8;
pub const ROUNDS_DEFAULT: u32 = 3;
pub const PICKS_PER_PASS_DEFAULT: u32 = 1;

pub struct BoosterDraft {
    pod_size: usize,
    rounds: u32,
    current_round: u32,
    seats: Vec<LimitedPlayer>,
    template: SealedTemplate,
    pool: Vec<PaperCard>,
    rng: StdRng,
    next_pack_id: u32,
    log: Box<dyn IDraftLog>,
    direction: PassDirection,
    pick_history: Vec<DraftSnapshot>,
    picks_per_pass: u32,
}

#[derive(Debug, Clone)]
struct DraftSnapshot {
    current_round: u32,
    direction: PassDirection,
    next_pack_id: u32,
    seats: Vec<SeatSnapshot>,
}

#[derive(Debug, Clone)]
struct SeatSnapshot {
    picked: Vec<PaperCard>,
    last_pick: Option<PaperCard>,
    pack_queue: std::collections::VecDeque<crate::draft_pack::DraftPack>,
    flags: crate::limited_player::PlayerFlags,
}

impl BoosterDraft {
    pub fn new(
        pod_size: usize,
        rounds: u32,
        template: SealedTemplate,
        pool: Vec<PaperCard>,
        ranker: Arc<CardRanker>,
        color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync>,
    ) -> Self {
        Self::with_human_seats(
            pod_size,
            rounds,
            template,
            pool,
            ranker,
            color_of,
            &[(0, "You".to_string())],
        )
    }

    pub fn with_human_seats(
        pod_size: usize,
        rounds: u32,
        template: SealedTemplate,
        pool: Vec<PaperCard>,
        ranker: Arc<CardRanker>,
        color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync>,
        humans: &[(usize, String)],
    ) -> Self {
        assert!(pod_size >= 2, "draft needs at least 2 seats");
        for (idx, _) in humans {
            assert!(
                *idx < pod_size,
                "human seat {idx} outside pod of {pod_size}"
            );
        }
        let human_lookup: std::collections::HashMap<usize, &str> = humans
            .iter()
            .map(|(idx, name)| (*idx, name.as_str()))
            .collect();
        let mut seats = Vec::with_capacity(pod_size);
        let mut ai_iter =
            BoosterDraftAI::build_ai_seats(pod_size - humans.len(), 0, ranker, color_of)
                .into_iter();
        for seat_idx in 0..pod_size {
            if let Some(name) = human_lookup.get(&seat_idx) {
                let agent: Box<dyn LimitedAgent> = Box::new(HumanLimitedAgent::new());
                seats.push(LimitedPlayer::new(seat_idx, *name, true, agent));
            } else {
                let mut ai = ai_iter.next().expect("AI seat for non-human slot");
                ai.seat = seat_idx;
                ai.name = format!("AI {seat_idx}");
                seats.push(ai);
            }
        }
        Self {
            pod_size,
            rounds,
            current_round: 0,
            seats,
            template,
            pool,
            rng: StdRng::from_entropy(),
            next_pack_id: 0,
            log: Box::new(VecDraftLog::default()),
            direction: PassDirection::Left,
            pick_history: Vec::new(),
            picks_per_pass: PICKS_PER_PASS_DEFAULT,
        }
    }

    pub fn set_picks_per_pass(&mut self, n: u32) {
        self.picks_per_pass = n.clamp(1, 8);
    }

    pub fn picks_per_pass(&self) -> u32 {
        self.picks_per_pass
    }

    pub fn can_undo(&self) -> bool {
        !self.pick_history.is_empty()
    }

    pub fn undo_last_human_pick(&mut self) -> Result<(), String> {
        if self.seats.iter().filter(|s| s.is_human).count() > 1 {
            return Err("undo not supported in multi-human drafts".to_string());
        }
        let snap = self
            .pick_history
            .pop()
            .ok_or_else(|| "nothing to undo".to_string())?;
        self.current_round = snap.current_round;
        self.direction = snap.direction;
        self.next_pack_id = snap.next_pack_id;
        for (seat, snap) in self.seats.iter_mut().zip(snap.seats.into_iter()) {
            seat.picked = snap.picked;
            seat.last_pick = snap.last_pick;
            seat.pack_queue = snap.pack_queue;
            seat.flags = snap.flags;
        }
        for seat in &mut self.seats {
            if !seat.is_human {
                continue;
            }
            if let Some(human) = downcast_human(seat.agent.as_mut()) {
                human.clear_pending();
            }
        }
        Ok(())
    }

    fn snapshot(&self) -> DraftSnapshot {
        DraftSnapshot {
            current_round: self.current_round,
            direction: self.direction,
            next_pack_id: self.next_pack_id,
            seats: self
                .seats
                .iter()
                .map(|s| SeatSnapshot {
                    picked: s.picked.clone(),
                    last_pick: s.last_pick.clone(),
                    pack_queue: s.pack_queue.clone(),
                    flags: s.flags,
                })
                .collect(),
        }
    }

    pub fn pod_size(&self) -> usize {
        self.pod_size
    }

    pub fn current_direction(&self) -> PassDirection {
        self.direction
    }

    pub fn submit_human_pick_for(
        &mut self,
        seat_idx: usize,
        card: PaperCard,
    ) -> Result<(), String> {
        {
            let seat = self
                .seats
                .get(seat_idx)
                .ok_or_else(|| format!("no seat at index {seat_idx}"))?;
            if !seat.is_human {
                return Err(format!("seat {seat_idx} is not human"));
            }
        }
        let snap = self.snapshot();
        if self.pick_history.len() >= 20 {
            self.pick_history.remove(0);
        }
        self.pick_history.push(snap);

        let seat = self.seats.get_mut(seat_idx).expect("validated above");
        let agent = seat.agent.as_mut();
        if let Some(human) = downcast_human(agent) {
            human.submit_pick(card);
            Ok(())
        } else {
            Err(format!("seat {seat_idx} agent isn't a HumanLimitedAgent"))
        }
    }

    pub fn submit_human_pick(&mut self, card: PaperCard) -> Result<(), String> {
        self.submit_human_pick_for(0, card)
    }

    pub fn current_pack_for_seat(&self, seat_idx: usize) -> Option<&DraftPack> {
        self.seats.get(seat_idx).and_then(|s| s.current_pack())
    }

    pub fn seat(&self, seat_idx: usize) -> Option<&LimitedPlayer> {
        self.seats.get(seat_idx)
    }

    pub fn human_seat_indices(&self) -> Vec<usize> {
        self.seats
            .iter()
            .enumerate()
            .filter(|(_, s)| s.is_human)
            .map(|(i, _)| i)
            .collect()
    }

    pub fn start_round(&mut self) -> bool {
        if self.current_round >= self.rounds {
            return false;
        }
        self.current_round += 1;
        self.direction = if self.current_round % 2 == 1 {
            PassDirection::Left
        } else {
            PassDirection::Right
        };

        let mut product = UnOpenedProduct::new(self.template.clone(), self.pool.clone());
        for seat in &mut self.seats {
            let cards = product.open(&mut self.rng);
            let mut pack = DraftPack::new(cards, self.next_pack_id);
            pack.set_picks_remaining(self.picks_per_pass);
            self.next_pack_id += 1;
            seat.receive_pack(pack);
        }
        self.log.add_log_entry(format!(
            "--- Round {} opened ({} packs) ---",
            self.current_round,
            self.seats.len()
        ));
        true
    }

    pub fn tick(&mut self) -> TickOutcome {
        if self.current_round == 0 || self.current_round > self.rounds {
            if self.current_round > self.rounds {
                return TickOutcome::Complete;
            }
            return TickOutcome::RoundOver;
        }

        loop {
            for seat in &self.seats {
                if !seat.is_human {
                    continue;
                }
                if seat.current_pack().is_some() && !is_human_ready(seat) {
                    return TickOutcome::AwaitingHuman;
                }
            }

            let mut anyone_picked = false;
            let pod = self.seats.len();
            for seat_idx in 0..pod {
                if self.seats[seat_idx].current_pack().is_none() {
                    continue;
                }
                let mut pack = self.seats[seat_idx].pack_queue.pop_front().unwrap();

                loop {
                    if pack.is_empty() || pack.picks_remaining() == 0 {
                        break;
                    }
                    let pick_opt = self.seats[seat_idx].agent.choose_card(&pack);
                    let Some(pick) = pick_opt else {
                        self.seats[seat_idx].pack_queue.push_front(pack);
                        return TickOutcome::AwaitingHuman;
                    };
                    let actual_pick = if !pack.remove_card(&pick) {
                        if let Some(first) = pack.cards().first().cloned() {
                            pack.cards_mut().remove(0);
                            Some(first)
                        } else {
                            None
                        }
                    } else {
                        Some(pick)
                    };
                    if let Some(card) = actual_pick {
                        self.seats[seat_idx].picked.push(card.clone());
                        self.seats[seat_idx].last_pick = Some(card.clone());
                        crate::conspiracy_hooks::apply_pick_trigger(
                            &card.name,
                            &mut self.seats[seat_idx].flags,
                        );
                        anyone_picked = true;
                    }
                    pack.decrement_picks_remaining();
                }

                if !pack.is_empty() {
                    let next_seat = neighbor_seat(seat_idx, pod, self.direction);
                    pack.set_passed_from(seat_idx);
                    pack.set_picks_remaining(self.picks_per_pass);
                    self.seats[next_seat].pack_queue.push_back(pack);
                }
            }

            if !anyone_picked {
                break;
            }

            if self.seats.iter().all(|s| s.current_pack().is_none()) {
                self.log
                    .add_log_entry(format!("--- Round {} complete ---", self.current_round));
                if self.current_round >= self.rounds {
                    return TickOutcome::Complete;
                } else {
                    return TickOutcome::RoundOver;
                }
            }
        }

        TickOutcome::Progress
    }

    pub fn set_log(&mut self, log: Box<dyn IDraftLog>) {
        self.log = log;
    }
}

fn neighbor_seat(seat: usize, pod: usize, dir: PassDirection) -> usize {
    match dir {
        PassDirection::Left => (seat + 1) % pod,
        PassDirection::Right => (seat + pod - 1) % pod,
    }
}

fn is_human_ready(player: &LimitedPlayer) -> bool {
    let agent: &dyn LimitedAgent = player.agent.as_ref();
    if let Some(human) = downcast_human_ref(agent) {
        human.has_pending()
    } else {
        true
    }
}

fn downcast_human(agent: &mut dyn LimitedAgent) -> Option<&mut HumanLimitedAgent> {
    agent.as_any_mut().downcast_mut::<HumanLimitedAgent>()
}

fn downcast_human_ref(agent: &dyn LimitedAgent) -> Option<&HumanLimitedAgent> {
    agent.as_any().downcast_ref::<HumanLimitedAgent>()
}

impl IBoosterDraft for BoosterDraft {
    fn round(&self) -> u32 {
        self.current_round
    }
    fn total_rounds(&self) -> u32 {
        self.rounds
    }
    fn current_pack_for_human(&self) -> Option<&DraftPack> {
        self.seats.first().and_then(|s| s.current_pack())
    }
    fn has_next_choice(&self) -> bool {
        self.current_round <= self.rounds
            && self
                .seats
                .iter()
                .any(|s| s.current_pack().is_some() || !s.unopened_packs.is_empty())
    }
    fn is_round_over(&self) -> bool {
        self.seats.iter().all(|s| s.current_pack().is_none())
    }
    fn human_player(&self) -> &LimitedPlayer {
        &self.seats[0]
    }
    fn opposing_players(&self) -> &[LimitedPlayer] {
        &self.seats[1..]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card_ranker::CardRanker;
    use crate::draft_rank_cache::DraftRankCache;
    use forge_foundation::sealed_product::Rarity;

    fn pool() -> Vec<PaperCard> {
        let mut v = Vec::new();
        for i in 0..200 {
            v.push(PaperCard::new(
                format!("Common {i}"),
                "TST",
                format!("c{i}"),
                Rarity::Common,
            ));
        }
        for i in 0..40 {
            v.push(PaperCard::new(
                format!("Uncommon {i}"),
                "TST",
                format!("u{i}"),
                Rarity::Uncommon,
            ));
        }
        for i in 0..15 {
            v.push(PaperCard::new(
                format!("Rare {i}"),
                "TST",
                format!("r{i}"),
                Rarity::Rare,
            ));
        }
        for i in 0..5 {
            v.push(PaperCard::new(
                format!("Forest {i}"),
                "TST",
                format!("l{i}"),
                Rarity::BasicLand,
            ));
        }
        v
    }

    #[test]
    fn ai_only_pod_drafts_all_packs() {
        let cache = Arc::new(DraftRankCache::new());
        let ranker = Arc::new(CardRanker::new(cache));
        let color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync> =
            Arc::new(|_| ColorSet::COLORLESS);

        let mut draft = BoosterDraft::new(
            2,
            3,
            SealedTemplate::generic_draft_booster(),
            pool(),
            ranker.clone(),
            color_of.clone(),
        );
        draft.seats[0].agent = Box::new(crate::limited_player_ai::LimitedPlayerAI::new(
            ranker, color_of,
        ));
        draft.seats[0].is_human = false;

        for _ in 0..3 {
            assert!(draft.start_round());
            loop {
                match draft.tick() {
                    TickOutcome::Progress => continue,
                    TickOutcome::AwaitingHuman => panic!("no human in pod"),
                    TickOutcome::RoundOver => break,
                    TickOutcome::Complete => break,
                }
            }
        }
        for seat in &draft.seats {
            assert_eq!(seat.picked.len(), 45, "seat {} picked count", seat.seat);
        }
    }
}
