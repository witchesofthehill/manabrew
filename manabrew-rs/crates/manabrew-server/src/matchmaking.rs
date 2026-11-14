use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tracing::info;

use crate::analytics::{now_ts, AnalyticsEvent, MatchmakingEvent};
use crate::connection::{broadcast_to_room, emit_to};
use crate::error::ServerError;
use crate::protocol::{
    EngineKind, GameFormat, QueueBracketCount, QueuedDeck, RoomInfo, RoomStatus, ServerMessage,
};
use crate::room::Room;
use crate::state::ServerState;
use manabrew_relay_protocol::{DEFAULT_RECONNECT_TIMEOUT_S, PROTOCOL_VERSION};

const QUEUE_TICK: Duration = Duration::from_secs(1);
const STATUS_EVERY_TICKS: u64 = 5;
const STEP_OFFER_AFTER: Duration = Duration::from_secs(30);
const BOT_FILL_OFFER_AFTER: Duration = Duration::from_secs(30);
const PROPOSAL_TIMEOUT: Duration = Duration::from_secs(30);
const TABLE_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const MIN_BRACKET: u8 = 1;
const MAX_BRACKET: u8 = 5;
const MAX_QUEUED_DECKS: usize = 32;
const MIN_POD: u8 = 2;
const MAX_POD: u8 = 4;

#[derive(Debug, Clone)]
pub struct QueueEntry {
    pub player_id: String,
    pub username: String,
    pub format: GameFormat,
    pub pod_sizes: Vec<u8>,
    pub decks: Vec<QueuedDeck>,
    pub steps: Vec<u8>,
    pub can_host: bool,
    pub queued_at: Instant,
    pub offered: bool,
    pub bot_fill: bool,
    pub bot_fill_offered: bool,
}

impl QueueEntry {
    fn deck_brackets(&self) -> Vec<u8> {
        let mut seen = HashSet::new();
        self.decks
            .iter()
            .map(|deck| deck.bracket)
            .filter(|bracket| seen.insert(*bracket))
            .collect()
    }

    fn brackets(&self) -> Vec<u8> {
        let mut brackets = self.deck_brackets();
        for step in &self.steps {
            if !brackets.contains(step) {
                brackets.push(*step);
            }
        }
        brackets
    }

    fn accepts(&self, bracket: u8) -> bool {
        self.decks.iter().any(|deck| deck.bracket == bracket) || self.steps.contains(&bracket)
    }

    fn deck_for(&self, bracket: u8) -> &QueuedDeck {
        self.decks
            .iter()
            .min_by_key(|deck| deck.bracket.abs_diff(bracket))
            .expect("queue entries hold at least one deck")
    }

    fn accepts_size(&self, pod_size: u8) -> bool {
        self.pod_sizes.contains(&pod_size)
    }

    fn same_table(&self, other: &QueueEntry) -> bool {
        self.format == other.format && self.pod_sizes.iter().any(|size| other.accepts_size(*size))
    }

    fn step_options(&self) -> (Option<u8>, Option<u8>) {
        let brackets = self.brackets();
        let low = brackets.iter().copied().min().unwrap_or(MIN_BRACKET);
        let high = brackets.iter().copied().max().unwrap_or(MAX_BRACKET);
        let down = (low > MIN_BRACKET).then(|| low - 1);
        let up = (high < MAX_BRACKET).then(|| high + 1);
        (down, up)
    }
}

#[derive(Debug, Default)]
pub struct MatchQueue {
    entries: Vec<QueueEntry>,
    proposals: Vec<Proposal>,
    calls: Vec<TableCall>,
    asked: HashMap<String, HashSet<String>>,
}

#[derive(Debug)]
pub struct TableCall {
    pub room_id: String,
    pub bracket: u8,
    pub pod_size: u8,
    pub created: Instant,
    pub joiners: Vec<QueueEntry>,
}

#[derive(Debug, Clone)]
pub struct OpenTable {
    pub room_id: String,
    pub host: String,
    pub bracket: u8,
    pub pod_size: u8,
    pub seats: u8,
}

#[derive(Debug, Default)]
struct CallWork {
    calls: Vec<(Vec<String>, ServerMessage)>,
    seat: Vec<(String, u8, Vec<QueueEntry>)>,
    overflow: Vec<Pod>,
}

#[derive(Debug)]
pub struct Proposal {
    pub pod: Pod,
    pub created: Instant,
    pub accepted: HashSet<String>,
}

#[derive(Debug)]
pub struct Pod {
    pub bracket: u8,
    pub pod_size: u8,
    pub members: Vec<QueueEntry>,
    pub bot_fill: bool,
}

impl MatchQueue {
    pub fn enter(&mut self, entry: QueueEntry) {
        self.leave(&entry.player_id);
        self.entries.push(entry);
        self.entries.sort_by_key(|entry| entry.queued_at);
    }

    pub fn leave(&mut self, player_id: &str) -> Vec<String> {
        self.entries.retain(|entry| entry.player_id != player_id);
        for call in &mut self.calls {
            call.joiners.retain(|entry| entry.player_id != player_id);
        }
        self.decline_match(player_id)
    }

    pub fn answer_call(&mut self, player_id: &str, room_id: &str, join: bool) -> bool {
        let Some(call) = self.calls.iter().position(|call| call.room_id == room_id) else {
            return false;
        };
        if !join {
            return true;
        }
        let Some(i) = self
            .entries
            .iter()
            .position(|entry| entry.player_id == player_id)
        else {
            return false;
        };
        let entry = self.entries.remove(i);
        self.calls[call].joiners.push(entry);
        true
    }

    pub fn reset_table(&mut self, room_id: &str) -> Vec<String> {
        self.asked.remove(room_id);
        let joiners: Vec<QueueEntry> = self
            .calls
            .iter_mut()
            .filter(|call| call.room_id == room_id)
            .flat_map(|call| std::mem::take(&mut call.joiners))
            .collect();
        self.calls.retain(|call| call.room_id != room_id);
        self.requeue(joiners)
    }

    fn run_calls(&mut self, now: Instant, tables: &[OpenTable]) -> CallWork {
        let mut work = CallWork::default();
        let open: HashMap<&str, &OpenTable> = tables
            .iter()
            .map(|table| (table.room_id.as_str(), table))
            .collect();
        self.asked
            .retain(|room_id, _| open.contains_key(room_id.as_str()));
        for mut call in std::mem::take(&mut self.calls) {
            let table = open
                .get(call.room_id.as_str())
                .filter(|table| table.bracket == call.bracket);
            if let Some(table) = table {
                let take = (table.seats as usize).min(call.joiners.len());
                if take > 0 {
                    let seated: Vec<QueueEntry> = call.joiners.drain(..take).collect();
                    work.seat.push((call.room_id.clone(), call.bracket, seated));
                }
            }
            if !call.joiners.is_empty() {
                work.overflow.push(Pod {
                    bracket: call.bracket,
                    pod_size: call.pod_size,
                    members: std::mem::take(&mut call.joiners),
                    bot_fill: false,
                });
            }
            if now.duration_since(call.created) < TABLE_CALL_TIMEOUT {
                self.calls.push(call);
            }
        }
        for table in tables {
            if self.calls.iter().any(|call| call.room_id == table.room_id) {
                continue;
            }
            let asked = self.asked.entry(table.room_id.clone()).or_default();
            let invited: Vec<String> = self
                .entries
                .iter()
                .filter(|entry| {
                    entry.username != table.host
                        && entry.accepts(table.bracket)
                        && entry.accepts_size(table.pod_size)
                        && !asked.contains(&entry.player_id)
                })
                .map(|entry| entry.player_id.clone())
                .collect();
            if invited.is_empty() {
                continue;
            }
            asked.extend(invited.iter().cloned());
            self.calls.push(TableCall {
                room_id: table.room_id.clone(),
                bracket: table.bracket,
                pod_size: table.pod_size,
                created: now,
                joiners: Vec::new(),
            });
            work.calls.push((
                invited,
                ServerMessage::TableCall {
                    room_id: table.room_id.clone(),
                    host: table.host.clone(),
                    bracket: table.bracket,
                    seats: table.seats,
                    pod_size: table.pod_size,
                    expires_s: TABLE_CALL_TIMEOUT.as_secs() as u32,
                },
            ));
        }
        work
    }

    fn requeue(&mut self, entries: Vec<QueueEntry>) -> Vec<String> {
        let ids = entries
            .iter()
            .map(|entry| entry.player_id.clone())
            .collect();
        for entry in entries {
            self.enter(entry);
        }
        ids
    }

    fn propose(&mut self, pod: Pod, now: Instant, busy: &HashSet<String>) -> u32 {
        let count = pod
            .members
            .iter()
            .filter(|entry| busy.contains(&entry.player_id))
            .count() as u32;
        self.proposals.push(Proposal {
            pod,
            created: now,
            accepted: HashSet::new(),
        });
        count
    }

    fn proposal_of(&self, player_id: &str) -> Option<usize> {
        self.proposals.iter().position(|proposal| {
            proposal
                .pod
                .members
                .iter()
                .any(|entry| entry.player_id == player_id)
        })
    }

    pub fn accept_match(&mut self, player_id: &str) {
        if let Some(i) = self.proposal_of(player_id) {
            self.proposals[i].accepted.insert(player_id.to_string());
        }
    }

    pub fn decline_match(&mut self, player_id: &str) -> Vec<String> {
        let Some(i) = self.proposal_of(player_id) else {
            return Vec::new();
        };
        let proposal = self.proposals.remove(i);
        self.requeue(
            proposal
                .pod
                .members
                .into_iter()
                .filter(|entry| entry.player_id != player_id)
                .collect(),
        )
    }

    fn resolve_proposals(
        &mut self,
        now: Instant,
        live: &HashSet<String>,
        busy: &HashSet<String>,
    ) -> (Vec<Pod>, Vec<QueueEntry>, Vec<String>) {
        let mut ready = Vec::new();
        let mut dropped = Vec::new();
        let mut requeued = Vec::new();
        for proposal in std::mem::take(&mut self.proposals) {
            let all_live = proposal
                .pod
                .members
                .iter()
                .all(|entry| live.contains(&entry.player_id));
            let all_ready = proposal.pod.members.iter().all(|entry| {
                proposal.accepted.contains(&entry.player_id) && !busy.contains(&entry.player_id)
            });
            if all_live && all_ready {
                ready.push(proposal.pod);
            } else if all_live && now.duration_since(proposal.created) < PROPOSAL_TIMEOUT {
                self.proposals.push(proposal);
            } else {
                let (keep, lose): (Vec<_>, Vec<_>) =
                    proposal.pod.members.into_iter().partition(|entry| {
                        live.contains(&entry.player_id)
                            && (!all_live || proposal.accepted.contains(&entry.player_id))
                    });
                dropped.extend(lose);
                requeued.extend(self.requeue(keep));
            }
        }
        (ready, dropped, requeued)
    }

    pub fn accept_step(&mut self, player_id: &str, bracket: u8) -> Result<(), String> {
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.player_id == player_id)
            .ok_or("not queued")?;
        let (down, up) = entry.step_options();
        if Some(bracket) != down && Some(bracket) != up {
            return Err(format!("bracket {bracket} is not one step from your decks"));
        }
        entry.steps.push(bracket);
        Ok(())
    }

    pub fn accept_bot_fill(&mut self, player_id: &str) -> Result<(), String> {
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.player_id == player_id)
            .ok_or("not queued")?;
        entry.bot_fill = true;
        Ok(())
    }

    fn compatible_players(&self, entry: &QueueEntry) -> u32 {
        self.entries
            .iter()
            .filter(|other| {
                other.player_id != entry.player_id
                    && other.same_table(entry)
                    && entry.brackets().iter().any(|b| other.accepts(*b))
            })
            .count() as u32
    }

    pub fn get(&self, player_id: &str) -> Option<&QueueEntry> {
        self.entries
            .iter()
            .chain(self.proposals.iter().flat_map(|p| p.pod.members.iter()))
            .chain(self.calls.iter().flat_map(|call| call.joiners.iter()))
            .find(|entry| entry.player_id == player_id)
    }

    fn retain_live(&mut self, live: &HashSet<String>) -> Vec<QueueEntry> {
        let (keep, gone) = std::mem::take(&mut self.entries)
            .into_iter()
            .partition(|entry| live.contains(&entry.player_id));
        self.entries = keep;
        gone
    }

    pub fn waiting_for(&self, entry: &QueueEntry) -> Vec<QueueBracketCount> {
        let mut counts = BTreeMap::new();
        for other in &self.entries {
            if other.player_id == entry.player_id || !other.same_table(entry) {
                continue;
            }
            for bracket in other.brackets() {
                *counts.entry(bracket).or_insert(0u32) += 1;
            }
        }
        counts
            .into_iter()
            .map(|(bracket, players)| QueueBracketCount { bracket, players })
            .collect()
    }

    pub fn take_pods(&mut self, hosted: &mut Vec<u8>) -> Vec<Pod> {
        let mut pods = Vec::new();
        while let Some(pod) = self.take_one(hosted) {
            pods.push(pod);
        }
        pods
    }

    fn take_one(&mut self, hosted: &mut Vec<u8>) -> Option<Pod> {
        for anchor in 0..self.entries.len() {
            for pod_size in self.entries[anchor].pod_sizes.clone() {
                for bracket in self.entries[anchor].brackets() {
                    if let Some(pod) = self.take_at(anchor, pod_size, bracket, hosted) {
                        return Some(pod);
                    }
                }
            }
        }
        None
    }

    fn take_at(
        &mut self,
        anchor: usize,
        pod_size: u8,
        bracket: u8,
        hosted: &mut Vec<u8>,
    ) -> Option<Pod> {
        let accepting: Vec<usize> = (0..self.entries.len())
            .filter(|&i| {
                i == anchor
                    || (self.entries[i].format == self.entries[anchor].format
                        && self.entries[i].accepts_size(pod_size)
                        && self.entries[i].accepts(bracket))
            })
            .collect();
        let hosted_slot = hosted.iter().position(|&seats| seats >= pod_size);
        let mut chosen = vec![anchor];
        if hosted_slot.is_none() {
            let &host = accepting.iter().find(|&&i| self.entries[i].can_host)?;
            if host != anchor {
                chosen.push(host);
            }
        }
        chosen.extend(
            accepting
                .iter()
                .copied()
                .filter(|i| !chosen.contains(i))
                .take((pod_size as usize).saturating_sub(chosen.len()))
                .collect::<Vec<_>>(),
        );
        let full = chosen.len() == pod_size as usize;
        let bot_fill =
            !full && chosen.len() >= 2 && chosen.iter().all(|&i| self.entries[i].bot_fill);
        if !full && !bot_fill {
            return None;
        }
        if let Some(slot) = hosted_slot {
            hosted.remove(slot);
        }
        let mut members = Vec::with_capacity(chosen.len());
        chosen.sort_unstable_by(|a, b| b.cmp(a));
        for i in chosen {
            members.push(self.entries.remove(i));
        }
        members.sort_by_key(|entry| entry.queued_at);
        Some(Pod {
            bracket,
            pod_size,
            members,
            bot_fill,
        })
    }

    fn due_offers(&mut self, now: Instant) -> Vec<(String, Option<u8>, Option<u8>)> {
        let mut offers = Vec::new();
        for entry in &mut self.entries {
            if entry.offered || now.duration_since(entry.queued_at) < STEP_OFFER_AFTER {
                continue;
            }
            entry.offered = true;
            let (down, up) = entry.step_options();
            if down.is_some() || up.is_some() {
                offers.push((entry.player_id.clone(), down, up));
            }
        }
        offers
    }

    fn due_bot_fill_offers(&mut self, now: Instant) -> Vec<(String, u32)> {
        let due: Vec<(usize, u32)> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| {
                !entry.bot_fill
                    && !entry.bot_fill_offered
                    && now.duration_since(entry.queued_at) >= BOT_FILL_OFFER_AFTER
            })
            .map(|(i, entry)| (i, self.compatible_players(entry)))
            .filter(|(_, players)| *players > 0)
            .collect();
        due.into_iter()
            .map(|(i, players)| {
                self.entries[i].bot_fill_offered = true;
                (self.entries[i].player_id.clone(), players)
            })
            .collect()
    }
}

pub fn validate_entry(
    format: &GameFormat,
    pod_sizes: &[u8],
    decks: &[QueuedDeck],
) -> Result<(), ServerError> {
    if *format == GameFormat::Any {
        return Err(ServerError::InvalidQueue("choose a format".into()));
    }
    if pod_sizes.is_empty()
        || pod_sizes
            .iter()
            .any(|size| !(MIN_POD..=MAX_POD).contains(size))
    {
        return Err(ServerError::InvalidQueue(format!(
            "pod sizes must be between {MIN_POD} and {MAX_POD}"
        )));
    }
    if decks.is_empty() || decks.len() > MAX_QUEUED_DECKS {
        return Err(ServerError::InvalidQueue(format!(
            "queue between 1 and {MAX_QUEUED_DECKS} decks"
        )));
    }
    if decks
        .iter()
        .any(|deck| !(MIN_BRACKET..=MAX_BRACKET).contains(&deck.bracket))
    {
        return Err(ServerError::InvalidQueue(format!(
            "brackets run from {MIN_BRACKET} to {MAX_BRACKET}"
        )));
    }
    Ok(())
}

pub fn queue_status(queue: &MatchQueue, player_id: &str) -> ServerMessage {
    match queue.get(player_id) {
        Some(entry) => ServerMessage::QueueStatus {
            queued: true,
            brackets: entry.brackets(),
            waiting: queue.waiting_for(entry),
        },
        None => ServerMessage::QueueStatus {
            queued: false,
            brackets: Vec::new(),
            waiting: Vec::new(),
        },
    }
}

fn event(action: &'static str, entries: &[&QueueEntry], now: Instant) -> MatchmakingEvent {
    MatchmakingEvent {
        ts: now_ts(),
        action,
        usernames: entries.iter().map(|entry| entry.username.clone()).collect(),
        waited_s: entries
            .iter()
            .map(|entry| (now.duration_since(entry.queued_at).as_secs_f64() * 10.0).round() / 10.0)
            .collect(),
        ..Default::default()
    }
}

fn record(state: &Arc<ServerState>, event: MatchmakingEvent) {
    state.analytics.emit(AnalyticsEvent::Matchmaking(event));
}

pub fn record_player(
    state: &Arc<ServerState>,
    player_id: &str,
    action: &'static str,
    extra: impl FnOnce(&QueueEntry, &mut MatchmakingEvent),
) {
    let event = {
        let queue = state.queue.lock().expect("queue lock");
        queue.get(player_id).map(|entry| {
            let mut event = event(action, &[entry], Instant::now());
            extra(entry, &mut event);
            event
        })
    };
    if let Some(event) = event {
        record(state, event);
    }
}

fn send(state: &Arc<ServerState>, player_id: &str, msg: &ServerMessage) {
    if let Ok(json) = serde_json::to_string(msg) {
        emit_to(state, player_id, msg, &json);
    }
}

pub fn send_statuses<'a>(state: &Arc<ServerState>, player_ids: impl Iterator<Item = &'a String>) {
    let statuses: Vec<_> = {
        let queue = state.queue.lock().expect("queue lock");
        player_ids
            .map(|id| (id.clone(), queue_status(&queue, id)))
            .collect()
    };
    for (player_id, msg) in statuses {
        send(state, &player_id, &msg);
    }
}

pub async fn matchmaking_loop(state: Arc<ServerState>) {
    let mut ticker = tokio::time::interval(QUEUE_TICK);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut tick: u64 = 0;
    loop {
        ticker.tick().await;
        tick += 1;
        run_tick(
            &state,
            Instant::now(),
            tick.is_multiple_of(STATUS_EVERY_TICKS),
        );
    }
}

fn run_tick(state: &Arc<ServerState>, now: Instant, send_status: bool) {
    let live: HashSet<String> = state
        .players
        .iter()
        .filter(|player| player.connected && player.room_id.is_none())
        .map(|player| player.key().clone())
        .collect();
    let mut hosted: Vec<u8> = state
        .rooms
        .iter()
        .filter(|room| pool_room_is_free(room))
        .map(|room| room.max_players)
        .collect();
    let tables: Vec<OpenTable> = state
        .rooms
        .iter()
        .filter_map(|room| open_table(&room))
        .collect();
    let busy: HashSet<String> = state
        .players
        .iter()
        .filter(|player| player.local_game.is_some())
        .map(|player| player.key().clone())
        .collect();
    let mut events = Vec::new();
    let (ready, dropped, requeued, proposals, offers, bot_offers, statuses, call_work) = {
        let mut queue = state.queue.lock().expect("queue lock");
        for entry in queue.retain_live(&live) {
            events.push(event("dropped", &[&entry], now));
        }
        let (ready, dropped, requeued) = queue.resolve_proposals(now, &live, &busy);
        for entry in &dropped {
            events.push(event("proposal_dropped", &[entry], now));
        }
        let dropped: Vec<String> = dropped.into_iter().map(|entry| entry.player_id).collect();
        let call_work = queue.run_calls(now, &tables);
        for (invited, msg) in &call_work.calls {
            if let ServerMessage::TableCall {
                room_id,
                bracket,
                pod_size,
                ..
            } = msg
            {
                let entries: Vec<&QueueEntry> =
                    invited.iter().filter_map(|id| queue.get(id)).collect();
                let mut called = event("table_call", &entries, now);
                called.room_id = Some(room_id.clone());
                called.bracket = Some(*bracket);
                called.pod_size = Some(*pod_size);
                events.push(called);
            }
        }
        let proposals: Vec<_> = queue
            .take_pods(&mut hosted)
            .into_iter()
            .map(|pod| {
                let ids: Vec<String> = pod.members.iter().map(|e| e.player_id.clone()).collect();
                let members: Vec<&QueueEntry> = pod.members.iter().collect();
                let mut proposed = event("proposed", &members, now);
                proposed.bracket = Some(pod.bracket);
                proposed.pod_size = Some(pod.pod_size);
                proposed.bot_fill = Some(pod.bot_fill);
                events.push(proposed);
                let (bracket, pod_size, players) =
                    (pod.bracket, pod.pod_size, pod.members.len() as u32);
                let busy = queue.propose(pod, now, &busy);
                let msg = ServerMessage::MatchProposal {
                    bracket,
                    pod_size,
                    players,
                    expires_s: PROPOSAL_TIMEOUT.as_secs() as u32,
                    busy,
                };
                (ids, msg)
            })
            .collect();
        let offers: Vec<_> = queue
            .due_offers(now)
            .into_iter()
            .map(|(player_id, down, up)| {
                let entry = queue.get(&player_id).expect("offer target is queued");
                events.push(event("step_offer", &[entry], now));
                (player_id, down, up, queue.waiting_for(entry))
            })
            .collect();
        let bot_offers = queue.due_bot_fill_offers(now);
        for (player_id, _) in &bot_offers {
            let entry = queue.get(player_id).expect("offer target is queued");
            events.push(event("bot_fill_offer", &[entry], now));
        }
        let statuses: Vec<_> = if send_status {
            queue
                .entries
                .iter()
                .map(|entry| {
                    (
                        entry.player_id.clone(),
                        queue_status(&queue, &entry.player_id),
                    )
                })
                .collect()
        } else {
            Vec::new()
        };
        (
            ready, dropped, requeued, proposals, offers, bot_offers, statuses, call_work,
        )
    };
    for event in events {
        record(state, event);
    }

    send_statuses(state, dropped.iter().chain(requeued.iter()));
    for (ids, msg) in proposals {
        for player_id in ids {
            send(state, &player_id, &msg);
        }
    }
    for (player_id, msg) in statuses {
        send(state, &player_id, &msg);
    }
    for (player_id, down, up, waiting) in offers {
        send(
            state,
            &player_id,
            &ServerMessage::QueueStepOffer { down, up, waiting },
        );
    }
    for (player_id, players) in bot_offers {
        send(
            state,
            &player_id,
            &ServerMessage::QueueBotFillOffer { players },
        );
    }
    for (invited, msg) in call_work.calls {
        for player_id in invited {
            send(state, &player_id, &msg);
        }
    }
    for (room_id, bracket, joiners) in call_work.seat {
        seat_at_table(state, &room_id, bracket, joiners);
    }
    for pod in ready.into_iter().chain(call_work.overflow) {
        seat_pod(state, pod);
    }
}

fn open_table(room: &Room) -> Option<OpenTable> {
    let bracket = room.table_bracket?;
    let open = room.status == RoomStatus::Lobby
        && room.players.len() < room.max_players as usize
        && matches!(room.format, GameFormat::Any | GameFormat::Commander)
        && room.password.is_none()
        && room.draft_config.is_none()
        && room.sealed_config.is_none()
        && room.limited_session_id.is_none();
    open.then(|| OpenTable {
        room_id: room.room_id.clone(),
        host: room.host_username.clone(),
        bracket,
        pod_size: room.max_players,
        seats: room.max_players - room.players.len() as u8,
    })
}

fn release_sessions(state: &Arc<ServerState>, members: &[QueueEntry]) {
    for entry in members {
        if let Some(mut player) = state.players.get_mut(&entry.player_id) {
            player.room_id = None;
        }
    }
}

fn seat_at_table(state: &Arc<ServerState>, room_id: &str, bracket: u8, joiners: Vec<QueueEntry>) {
    let free = state
        .rooms
        .get(room_id)
        .filter(|room| room.status == RoomStatus::Lobby)
        .map(|room| (room.max_players as usize).saturating_sub(room.players.len()))
        .unwrap_or(0);
    let mut seated = joiners;
    let rest = seated.split_off(free.min(seated.len()));
    requeue(state, rest);
    if seated.is_empty() {
        return;
    }
    let lost = claim_sessions(state, room_id, &seated);
    if !lost.is_empty() {
        requeue(
            state,
            seated
                .into_iter()
                .filter(|entry| !lost.contains(&entry.player_id))
                .collect(),
        );
        return;
    }
    let fits = state.rooms.get_mut(room_id).is_some_and(|mut room| {
        let fits = room.status == RoomStatus::Lobby
            && room.players.len() + seated.len() <= room.max_players as usize;
        if fits {
            seat_members(&mut room, &seated, bracket);
        }
        fits
    });
    if !fits {
        release_sessions(state, &seated);
        requeue(state, seated);
        return;
    }
    let Some((info, host)) = state
        .rooms
        .get(room_id)
        .map(|room| (room.to_room_info(), room.host_username.clone()))
    else {
        return;
    };
    let members: Vec<&QueueEntry> = seated.iter().collect();
    let mut joined = event("table_seated", &members, Instant::now());
    joined.room_id = Some(room_id.to_string());
    joined.bracket = Some(bracket);
    record(state, joined);
    info!(
        "[queue] {} player(s) joined open table {} at bracket {}",
        seated.len(),
        &room_id[..8],
        bracket
    );
    broadcast_to_room(
        state,
        room_id,
        &ServerMessage::RoomUpdate { room: info.clone() },
    );
    for entry in &seated {
        send(
            state,
            &entry.player_id,
            &ServerMessage::MatchFound {
                room: info.clone(),
                host: host.clone(),
                bracket,
                deck_name: entry.deck_for(bracket).deck_name.clone(),
                resume_token: None,
            },
        );
    }
}

fn record_seated(
    state: &Arc<ServerState>,
    room_id: &str,
    hosted: bool,
    bracket: u8,
    pod_size: u8,
    bot_fill: bool,
    members: &[QueueEntry],
) {
    let members: Vec<&QueueEntry> = members.iter().collect();
    let mut seated = event("seated", &members, Instant::now());
    seated.room_id = Some(room_id.to_string());
    seated.hosted = Some(hosted);
    seated.bracket = Some(bracket);
    seated.pod_size = Some(pod_size);
    seated.bot_fill = Some(bot_fill);
    record(state, seated);
}

fn requeue(state: &Arc<ServerState>, members: Vec<QueueEntry>) {
    let mut queue = state.queue.lock().expect("queue lock");
    for entry in members {
        queue.enter(entry);
    }
}

fn pool_room_is_free(room: &Room) -> bool {
    room.hosted
        && room.status == RoomStatus::Lobby
        && room.players.is_empty()
        && room.engine == EngineKind::Forge
        && matches!(room.format, GameFormat::Any | GameFormat::Commander)
        && room.password.is_none()
        && room.draft_config.is_none()
        && room.sealed_config.is_none()
        && room.limited_session_id.is_none()
}

fn free_pool_room(state: &Arc<ServerState>, pod_size: u8) -> Option<String> {
    state
        .rooms
        .iter()
        .filter(|room| pool_room_is_free(room) && room.max_players >= pod_size)
        .map(|room| room.room_id.clone())
        .next()
}

fn seat_members(room: &mut Room, members: &[QueueEntry], bracket: u8) {
    for entry in members {
        if !room.players.iter().any(|p| p.player_id == entry.player_id) {
            room.add_player(entry.player_id.clone(), entry.username.clone(), false)
                .expect("a matchmade room has a seat for every pod member");
        }
        let deck = entry.deck_for(bracket);
        room.set_deck_selection(
            &entry.player_id,
            deck.deck_name.clone(),
            deck.deck.clone(),
            deck.published_deck_id.clone(),
            deck.commander_name.clone(),
            None,
        )
        .expect("pod member is seated");
        room.set_ready(&entry.player_id, true)
            .expect("pod member is seated");
    }
}

fn claim_sessions(state: &Arc<ServerState>, room_id: &str, members: &[QueueEntry]) -> Vec<String> {
    let mut seated = Vec::new();
    let mut lost = Vec::new();
    for entry in members {
        let claimed = state
            .players
            .get_mut(&entry.player_id)
            .is_some_and(|mut player| {
                if player.connected && player.room_id.is_none() {
                    player.room_id = Some(room_id.to_string());
                    true
                } else {
                    false
                }
            });
        if claimed {
            seated.push(entry.player_id.clone());
        } else {
            lost.push(entry.player_id.clone());
        }
    }
    if !lost.is_empty() {
        for player_id in &seated {
            if let Some(mut player) = state.players.get_mut(player_id) {
                player.room_id = None;
            }
        }
    }
    lost
}

fn seat_pod(state: &Arc<ServerState>, pod: Pod) {
    if let Some(room_id) = free_pool_room(state, pod.pod_size) {
        seat_in_pool_room(state, room_id, pod);
    } else if pod.members.iter().any(|entry| entry.can_host) {
        seat_in_browser_room(state, pod);
    } else {
        requeue(state, pod.members);
    }
}

fn seat_in_pool_room(state: &Arc<ServerState>, room_id: String, pod: Pod) {
    let Pod {
        bracket,
        pod_size,
        members,
        bot_fill,
    } = pod;
    let (info, host) = {
        let Some(mut room) = state.rooms.get_mut(&room_id) else {
            requeue(state, members);
            return;
        };
        if !pool_room_is_free(&room) || room.max_players < pod_size {
            drop(room);
            requeue(state, members);
            return;
        }
        room.pool_max_players = Some(room.max_players);
        room.max_players = pod_size;
        room.matchmade_bot_fill = bot_fill;
        room.matchmade_bracket = Some(bracket);
        room.table_bracket = (members.len() < pod_size as usize && !bot_fill).then_some(bracket);
        seat_members(&mut room, &members, bracket);
        (room.to_room_info(), room.host_username.clone())
    };

    let lost = claim_sessions(state, &room_id, &members);
    if !lost.is_empty() {
        info!(
            "[queue] pod for hosted room {} lost {} member(s), returning the rest to the queue",
            &room_id[..8],
            lost.len()
        );
        if let Some(mut room) = state.rooms.get_mut(&room_id) {
            for entry in &members {
                room.remove_player(&entry.player_id);
            }
        }
        requeue(
            state,
            members
                .into_iter()
                .filter(|entry| !lost.contains(&entry.player_id))
                .collect(),
        );
        return;
    }

    record_seated(state, &room_id, true, bracket, pod_size, bot_fill, &members);
    info!(
        "[queue] matched {} player(s) at bracket {} into hosted room {} on '{}'",
        members.len(),
        bracket,
        &room_id[..8],
        host
    );
    broadcast_to_room(
        state,
        &room_id,
        &ServerMessage::RoomUpdate { room: info.clone() },
    );
    for entry in &members {
        send(
            state,
            &entry.player_id,
            &ServerMessage::MatchFound {
                room: info.clone(),
                host: host.clone(),
                bracket,
                deck_name: entry.deck_for(bracket).deck_name.clone(),
                resume_token: None,
            },
        );
    }
}

fn seat_in_browser_room(state: &Arc<ServerState>, pod: Pod) {
    let Pod {
        bracket,
        pod_size,
        members,
        bot_fill,
    } = pod;
    let host_entry = members
        .iter()
        .find(|entry| entry.can_host)
        .expect("caller checked for a host")
        .clone();
    if state.rooms.len() >= state.max_rooms {
        requeue(state, members);
        return;
    }

    let room_id = uuid::Uuid::new_v4().to_string();
    let mut room = Room::new(
        room_id.clone(),
        format!("Matchmade bracket {bracket} pod"),
        PROTOCOL_VERSION,
        host_entry.player_id.clone(),
        host_entry.username.clone(),
        pod_size,
        host_entry.format.clone(),
        EngineKind::Forge,
        true,
        None,
        None,
        false,
        None,
        DEFAULT_RECONNECT_TIMEOUT_S,
        None,
    );
    room.matchmade_bot_fill = bot_fill;
    room.matchmade_bracket = Some(bracket);
    room.table_bracket = (members.len() < pod_size as usize && !bot_fill).then_some(bracket);
    seat_members(&mut room, &members, bracket);
    let info: RoomInfo = room.to_room_info();
    let resume_token = room.resume_token.clone();
    state.rooms.insert(room_id.clone(), room);

    let lost = claim_sessions(state, &room_id, &members);
    if !lost.is_empty() {
        info!(
            "[queue] pod {} lost {} member(s) before seating, returning the rest to the queue",
            &room_id[..8],
            lost.len()
        );
        state.rooms.remove(&room_id);
        requeue(
            state,
            members
                .into_iter()
                .filter(|entry| !lost.contains(&entry.player_id))
                .collect(),
        );
        return;
    }

    record_seated(
        state, &room_id, false, bracket, pod_size, bot_fill, &members,
    );
    info!(
        "[queue] matched {} player(s) at bracket {} into room {} hosted by '{}'",
        members.len(),
        bracket,
        &room_id[..8],
        host_entry.username
    );
    for entry in &members {
        let is_host = entry.player_id == host_entry.player_id;
        send(
            state,
            &entry.player_id,
            &ServerMessage::MatchFound {
                room: info.clone(),
                host: host_entry.username.clone(),
                bracket,
                deck_name: entry.deck_for(bracket).deck_name.clone(),
                resume_token: is_host.then(|| resume_token.clone()),
            },
        );
    }
}
