use std::sync::Arc;

use forge_foundation::sealed_product::{
    IUnOpenedProduct, PaperCard, SealedTemplate, UnOpenedProduct,
};
use forge_foundation::ColorSet;
use rand::SeedableRng;
use rand_chacha::ChaCha12Rng;
use serde::ser::SerializeSeq;
use serde::{Deserialize, Serialize};

use crate::booster_draft_ai::BoosterDraftAI;
use crate::card_ranker::CardRanker;
use crate::draft_pack::DraftPack;
use crate::i_booster_draft::IBoosterDraft;
use crate::i_draft_log::{IDraftLog, VecDraftLog};
use crate::limited_agent::{HumanLimitedAgent, LimitedAgent};
use crate::limited_player::LimitedPlayer;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DraftDecisionAction {
    Pick,
    Take,
    Pass,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftDecision {
    pub revision: u64,
    pub seat: usize,
    pub round: u32,
    pub pick_number: u32,
    pub action: DraftDecisionAction,
    pub pack_id: String,
    pub visible_cards: Vec<(PaperCard, u32)>,
    pub selected_ids: Vec<u32>,
    pub automatic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoosterDraftCheckpoint {
    pod_size: usize,
    rounds: u32,
    template: SealedTemplate,
    picks_per_pass: u32,
    pool_limited: bool,
    ranker: crate::card_ranker::CardRankerState,
    current: DraftSnapshot,
    pick_history: Vec<DraftSnapshot>,
    decisions: Vec<DraftDecision>,
}

pub struct BoosterDraft {
    pod_size: usize,
    rounds: u32,
    current_round: u32,
    seats: Vec<LimitedPlayer>,
    template: SealedTemplate,
    pool: Vec<PaperCard>,
    rng: ChaCha12Rng,
    next_pack_id: u32,
    log: Box<dyn IDraftLog>,
    direction: PassDirection,
    pick_history: Vec<DraftSnapshot>,
    picks_per_pass: u32,
    pool_limited: bool,
    picked_ids: Vec<Vec<(u32, u32)>>,
    pending_pick_ids: Vec<Option<u32>>,
    pending_automatic: Vec<bool>,
    decisions: Vec<DraftDecision>,
    revision: u64,
    ranker: Arc<CardRanker>,
    color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DraftSnapshot {
    current_round: u32,
    direction: PassDirection,
    next_pack_id: u32,
    pool: Vec<PaperCard>,
    rng: ChaCha12Rng,
    seats: Vec<SeatSnapshot>,
    picked_ids: Vec<Vec<(u32, u32)>>,
    pending_pick_ids: Vec<Option<u32>>,
    pending_automatic: Vec<bool>,
    decision_count: usize,
    revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SeatSnapshot {
    seat: usize,
    name: String,
    is_human: bool,
    unopened_packs: std::collections::VecDeque<DraftPack>,
    agent: AgentSnapshot,
    picked: Vec<PaperCard>,
    last_pick: Option<PaperCard>,
    pack_queue: std::collections::VecDeque<crate::draft_pack::DraftPack>,
    flags: crate::limited_player::PlayerFlags,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum AgentSnapshot {
    Human(HumanLimitedAgent),
    Ai(crate::limited_player_ai::LimitedPlayerAIState),
}

#[derive(Serialize)]
struct BoosterDraftCheckpointRef<'a> {
    pod_size: usize,
    rounds: u32,
    template: &'a SealedTemplate,
    picks_per_pass: u32,
    pool_limited: bool,
    ranker: &'a CardRanker,
    current: DraftSnapshotRef<'a>,
    pick_history: &'a [DraftSnapshot],
    decisions: &'a [DraftDecision],
}

#[derive(Serialize)]
struct DraftSnapshotRef<'a> {
    current_round: u32,
    direction: PassDirection,
    next_pack_id: u32,
    pool: &'a [PaperCard],
    rng: &'a ChaCha12Rng,
    #[serde(serialize_with = "serialize_draft_seats")]
    seats: &'a [LimitedPlayer],
    picked_ids: &'a [Vec<(u32, u32)>],
    pending_pick_ids: &'a [Option<u32>],
    pending_automatic: &'a [bool],
    decision_count: usize,
    revision: u64,
}

#[derive(Serialize)]
struct SeatSnapshotRef<'a> {
    seat: usize,
    name: &'a str,
    is_human: bool,
    unopened_packs: &'a std::collections::VecDeque<DraftPack>,
    agent: AgentSnapshotRef<'a>,
    picked: &'a [PaperCard],
    last_pick: &'a Option<PaperCard>,
    pack_queue: &'a std::collections::VecDeque<DraftPack>,
    flags: crate::limited_player::PlayerFlags,
}

#[derive(Serialize)]
enum AgentSnapshotRef<'a> {
    Human(&'a HumanLimitedAgent),
    Ai(&'a crate::limited_player_ai::LimitedPlayerAI),
}

fn serialize_draft_seats<S>(seats: &[LimitedPlayer], serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let mut sequence = serializer.serialize_seq(Some(seats.len()))?;
    for seat in seats {
        let agent = if let Some(human) = downcast_human_ref(seat.agent.as_ref()) {
            AgentSnapshotRef::Human(human)
        } else {
            AgentSnapshotRef::Ai(
                seat.agent
                    .as_any()
                    .downcast_ref::<crate::limited_player_ai::LimitedPlayerAI>()
                    .expect("supported draft agent"),
            )
        };
        sequence.serialize_element(&SeatSnapshotRef {
            seat: seat.seat,
            name: &seat.name,
            is_human: seat.is_human,
            unopened_packs: &seat.unopened_packs,
            agent,
            picked: &seat.picked,
            last_pick: &seat.last_pick,
            pack_queue: &seat.pack_queue,
            flags: seat.flags,
        })?;
    }
    sequence.end()
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
        let mut ai_iter = BoosterDraftAI::build_ai_seats(
            pod_size - humans.len(),
            0,
            ranker.clone(),
            color_of.clone(),
        )
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
            rng: ChaCha12Rng::from_entropy(),
            next_pack_id: 0,
            log: Box::new(VecDraftLog::default()),
            direction: PassDirection::Left,
            pick_history: Vec::new(),
            picks_per_pass: PICKS_PER_PASS_DEFAULT,
            pool_limited: false,
            picked_ids: vec![Vec::new(); pod_size],
            pending_pick_ids: vec![None; pod_size],
            pending_automatic: vec![false; pod_size],
            decisions: Vec::new(),
            revision: 0,
            ranker,
            color_of,
        }
    }

    pub fn set_seed(&mut self, seed: u64) {
        self.rng = ChaCha12Rng::seed_from_u64(seed);
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn decisions_for_seat(&self, seat: usize) -> Result<Vec<DraftDecision>, String> {
        if seat >= self.pod_size {
            return Err(format!("no seat at index {seat}"));
        }
        Ok(self
            .decisions
            .iter()
            .filter(|decision| decision.seat == seat)
            .cloned()
            .collect())
    }

    pub fn awaiting_pick_for_seat(&self, seat: usize) -> bool {
        self.seats.get(seat).is_some_and(|player| {
            player.is_human
                && player.current_pack().is_some_and(|pack| !pack.is_empty())
                && !is_human_ready(player)
        })
    }

    pub fn export_checkpoint(&self) -> impl Serialize + '_ {
        BoosterDraftCheckpointRef {
            pod_size: self.pod_size,
            rounds: self.rounds,
            template: &self.template,
            picks_per_pass: self.picks_per_pass,
            pool_limited: self.pool_limited,
            ranker: self.ranker.as_ref(),
            current: DraftSnapshotRef {
                current_round: self.current_round,
                direction: self.direction,
                next_pack_id: self.next_pack_id,
                pool: &self.pool,
                rng: &self.rng,
                seats: &self.seats,
                picked_ids: &self.picked_ids,
                pending_pick_ids: &self.pending_pick_ids,
                pending_automatic: &self.pending_automatic,
                decision_count: self.decisions.len(),
                revision: self.revision,
            },
            pick_history: &self.pick_history,
            decisions: &self.decisions,
        }
    }

    pub fn import_checkpoint(checkpoint: BoosterDraftCheckpoint) -> Result<Self, String> {
        if !(2..=8).contains(&checkpoint.pod_size)
            || checkpoint.rounds == 0
            || !(1..=8).contains(&checkpoint.picks_per_pass)
        {
            return Err("incompatible draft checkpoint settings".into());
        }
        for snapshot in std::iter::once(&checkpoint.current).chain(&checkpoint.pick_history) {
            if snapshot.seats.len() != checkpoint.pod_size
                || snapshot.picked_ids.len() != checkpoint.pod_size
                || snapshot.pending_pick_ids.len() != checkpoint.pod_size
                || snapshot.pending_automatic.len() != checkpoint.pod_size
                || snapshot.current_round > checkpoint.rounds
                || snapshot.decision_count > checkpoint.decisions.len()
                || snapshot.seats.iter().enumerate().any(|(index, seat)| {
                    seat.seat != index
                        || seat.picked.len() != snapshot.picked_ids[index].len()
                        || seat
                            .pack_queue
                            .iter()
                            .chain(&seat.unopened_packs)
                            .any(|pack| pack.cards().len() != pack.card_ids().len())
                        || seat.is_human != matches!(&seat.agent, AgentSnapshot::Human(_))
                        || match &seat.agent {
                            AgentSnapshot::Human(human) => match human.pending_pick() {
                                Some(card) => seat.pack_queue.front().is_none_or(|pack| {
                                    match snapshot.pending_pick_ids[index] {
                                        Some(id) => pack
                                            .card_ids()
                                            .iter()
                                            .position(|candidate| *candidate == id)
                                            .is_none_or(|position| &pack.cards()[position] != card),
                                        None => !pack.cards().contains(card),
                                    }
                                }),
                                None => snapshot.pending_pick_ids[index].is_some(),
                            },
                            AgentSnapshot::Ai(_) => snapshot.pending_pick_ids[index].is_some(),
                        }
                })
            {
                return Err("incompatible draft checkpoint state".into());
            }
            let mut occurrences = std::collections::HashSet::new();
            for (seat, picked_ids) in snapshot.seats.iter().zip(&snapshot.picked_ids) {
                for occurrence in picked_ids {
                    if occurrence.0 >= snapshot.next_pack_id || !occurrences.insert(*occurrence) {
                        return Err("duplicate or invalid draft occurrence".into());
                    }
                }
                for pack in seat.pack_queue.iter().chain(&seat.unopened_packs) {
                    if pack.id() >= snapshot.next_pack_id || pack.picks_remaining() > 8 {
                        return Err("incompatible draft pack state".into());
                    }
                    for id in pack.card_ids() {
                        if !occurrences.insert((pack.id(), *id)) {
                            return Err("duplicate draft occurrence".into());
                        }
                    }
                }
            }
        }
        let ranker = Arc::new(CardRanker::from_state(checkpoint.ranker));
        let color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync> =
            Arc::new(|card| card.colors);
        let mut draft = Self {
            pod_size: checkpoint.pod_size,
            rounds: checkpoint.rounds,
            current_round: 0,
            seats: Vec::new(),
            template: checkpoint.template,
            pool: Vec::new(),
            rng: ChaCha12Rng::seed_from_u64(0),
            next_pack_id: 0,
            log: Box::new(VecDraftLog::default()),
            direction: PassDirection::Left,
            pick_history: checkpoint.pick_history,
            picks_per_pass: checkpoint.picks_per_pass,
            pool_limited: checkpoint.pool_limited,
            picked_ids: Vec::new(),
            pending_pick_ids: Vec::new(),
            pending_automatic: Vec::new(),
            decisions: checkpoint.decisions,
            revision: 0,
            ranker,
            color_of,
        };
        draft.restore_snapshot(checkpoint.current);
        Ok(draft)
    }

    fn restore_snapshot(&mut self, snapshot: DraftSnapshot) {
        self.current_round = snapshot.current_round;
        self.direction = snapshot.direction;
        self.next_pack_id = snapshot.next_pack_id;
        self.pool = snapshot.pool;
        self.rng = snapshot.rng;
        self.picked_ids = snapshot.picked_ids;
        self.pending_pick_ids = snapshot.pending_pick_ids;
        self.pending_automatic = snapshot.pending_automatic;
        self.decisions.truncate(snapshot.decision_count);
        self.revision = snapshot.revision;
        self.seats = snapshot
            .seats
            .into_iter()
            .map(|seat| {
                let agent: Box<dyn LimitedAgent> = match seat.agent {
                    AgentSnapshot::Human(human) => Box::new(human),
                    AgentSnapshot::Ai(state) => {
                        let mut ai = crate::limited_player_ai::LimitedPlayerAI::new(
                            self.ranker.clone(),
                            self.color_of.clone(),
                        );
                        ai.restore_state(state);
                        Box::new(ai)
                    }
                };
                LimitedPlayer {
                    seat: seat.seat,
                    name: seat.name,
                    is_human: seat.is_human,
                    picked: seat.picked,
                    unopened_packs: seat.unopened_packs,
                    pack_queue: seat.pack_queue,
                    last_pick: seat.last_pick,
                    flags: seat.flags,
                    agent,
                }
            })
            .collect();
    }

    pub fn submit_auto_pick_for(
        &mut self,
        seat: usize,
        nominated: Option<(u32, u32)>,
    ) -> Result<(), String> {
        if !self.awaiting_pick_for_seat(seat) {
            return Err("seat has no actionable pack".into());
        }
        let pack = self.current_pack_for_seat(seat).expect("actionable pack");
        let nominated_id = nominated
            .filter(|(pack_id, card_id)| *pack_id == pack.id() && pack.card_ids().contains(card_id))
            .map(|(_, id)| id);
        let card_id = if let Some(id) = nominated_id {
            id
        } else {
            let player = &self.seats[seat];
            let mut colors = crate::deck_colors::DeckColors::new();
            for card in &player.picked {
                colors.observe(card, (self.color_of)(card));
            }
            let ranked = self.ranker.rank_cards_in_pack(
                pack.cards(),
                &player.picked,
                colors.chosen(),
                colors.can_choose_more_colors(),
                |card| (self.color_of)(card),
            );
            let card = ranked.first().ok_or_else(|| "pack is empty".to_string())?;
            let index = pack
                .cards()
                .iter()
                .position(|candidate| candidate == card)
                .ok_or_else(|| "ranked card is not in pack".to_string())?;
            pack.card_ids()[index]
        };
        let pack_id = pack.id();
        self.submit_human_pick_id_for(seat, pack_id, card_id)?;
        self.pending_automatic[seat] = true;
        Ok(())
    }

    pub fn set_picks_per_pass(&mut self, n: u32) {
        self.picks_per_pass = n.clamp(1, 8);
    }

    pub fn picks_per_pass(&self) -> u32 {
        self.picks_per_pass
    }

    pub fn set_limited_pool(&mut self, limited: bool) {
        self.pool_limited = limited;
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
        let revision = self.revision + 1;
        self.restore_snapshot(snap);
        self.revision = revision;
        Ok(())
    }

    fn snapshot(&self) -> DraftSnapshot {
        DraftSnapshot {
            current_round: self.current_round,
            direction: self.direction,
            next_pack_id: self.next_pack_id,
            pool: self.pool.clone(),
            rng: self.rng.clone(),
            picked_ids: self.picked_ids.clone(),
            pending_pick_ids: self.pending_pick_ids.clone(),
            pending_automatic: self.pending_automatic.clone(),
            decision_count: self.decisions.len(),
            revision: self.revision,
            seats: self
                .seats
                .iter()
                .map(|s| SeatSnapshot {
                    seat: s.seat,
                    name: s.name.clone(),
                    is_human: s.is_human,
                    unopened_packs: s.unopened_packs.clone(),
                    agent: if let Some(human) = downcast_human_ref(s.agent.as_ref()) {
                        AgentSnapshot::Human(human.clone())
                    } else {
                        AgentSnapshot::Ai(
                            s.agent
                                .as_any()
                                .downcast_ref::<crate::limited_player_ai::LimitedPlayerAI>()
                                .expect("supported draft agent")
                                .export_state(),
                        )
                    },
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
            if !self.awaiting_pick_for_seat(seat_idx) {
                return Err("seat has no actionable pack".into());
            }
            if !seat
                .current_pack()
                .is_some_and(|pack| pack.cards().contains(&card))
            {
                return Err("card is not in the current pack".into());
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
            self.revision += 1;
            Ok(())
        } else {
            Err(format!("seat {seat_idx} agent isn't a HumanLimitedAgent"))
        }
    }

    pub fn submit_human_pick(&mut self, card: PaperCard) -> Result<(), String> {
        self.submit_human_pick_for(0, card)
    }
    pub fn submit_human_pick_id_for(
        &mut self,
        seat_idx: usize,
        pack_id: u32,
        card_id: u32,
    ) -> Result<(), String> {
        let pack = self
            .current_pack_for_seat(seat_idx)
            .filter(|pack| pack.id() == pack_id)
            .ok_or_else(|| "pack is no longer current".to_string())?;
        let index = pack
            .card_ids()
            .iter()
            .position(|id| *id == card_id)
            .ok_or_else(|| "card occurrence is not in the current pack".to_string())?;
        let card = pack.cards()[index].clone();
        self.submit_human_pick_for(seat_idx, card)?;
        self.pending_pick_ids[seat_idx] = Some(card_id);
        Ok(())
    }

    pub fn picked_ids_for_seat(&self, seat_idx: usize) -> &[(u32, u32)] {
        &self.picked_ids[seat_idx]
    }
    pub fn build_ai_decks(&self) -> Result<Vec<crate::limited_deck_builder::LimitedDeck>, String> {
        if self.has_next_choice() || self.current_round < self.rounds {
            return Err("draft is not complete".to_string());
        }
        self.seats
            .iter()
            .filter(|seat| !seat.is_human)
            .map(|seat| {
                let ai = seat
                    .agent
                    .as_any()
                    .downcast_ref::<crate::limited_player_ai::LimitedPlayerAI>()
                    .ok_or_else(|| "draft seat is not an AI player".to_string())?;
                Ok(ai.build_deck(&seat.name, &seat.picked))
            })
            .collect()
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
        product.set_limited_pool(self.pool_limited);
        for seat in &mut self.seats {
            let cards = product.open(&mut self.rng);
            let mut pack = DraftPack::new(cards, self.next_pack_id);
            pack.set_picks_remaining(self.picks_per_pass);
            self.next_pack_id += 1;
            seat.receive_pack(pack);
        }
        if self.pool_limited {
            self.pool = product.pool().to_vec();
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
                    let visible_cards = pack
                        .cards()
                        .iter()
                        .cloned()
                        .zip(pack.card_ids().iter().copied())
                        .collect();
                    let index = self.pending_pick_ids[seat_idx]
                        .take()
                        .and_then(|id| {
                            pack.card_ids()
                                .iter()
                                .position(|candidate| *candidate == id)
                        })
                        .or_else(|| pack.cards().iter().position(|card| *card == pick))
                        .expect("chosen card remains in the current pack");
                    let (card, card_id) = pack.remove_at(index);
                    self.revision += 1;
                    self.decisions.push(DraftDecision {
                        revision: self.revision,
                        seat: seat_idx,
                        round: self.current_round,
                        pick_number: self.seats[seat_idx].picked.len() as u32 + 1,
                        action: DraftDecisionAction::Pick,
                        pack_id: pack.id().to_string(),
                        visible_cards,
                        selected_ids: vec![card_id],
                        automatic: !self.seats[seat_idx].is_human
                            || std::mem::take(&mut self.pending_automatic[seat_idx]),
                    });
                    self.picked_ids[seat_idx].push((pack.id(), card_id));
                    self.seats[seat_idx].picked.push(card.clone());
                    self.seats[seat_idx].last_pick = Some(card.clone());
                    crate::conspiracy_hooks::apply_pick_trigger(
                        &card.name,
                        &mut self.seats[seat_idx].flags,
                    );
                    anyone_picked = true;
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
