use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tracing::info;

use crate::connection::emit_to;
use crate::error::ServerError;
use crate::protocol::{
    EngineKind, GameFormat, QueueBracketCount, QueuedDeck, RoomInfo, ServerMessage,
};
use crate::room::Room;
use crate::state::ServerState;
use manabrew_relay_protocol::{DEFAULT_RECONNECT_TIMEOUT_S, PROTOCOL_VERSION};

const QUEUE_TICK: Duration = Duration::from_secs(1);
const STATUS_EVERY_TICKS: u64 = 5;
const STEP_OFFER_AFTER: Duration = Duration::from_secs(30);
const BOT_FILL_OFFER_AFTER: Duration = Duration::from_secs(30);
const PROPOSAL_TIMEOUT: Duration = Duration::from_secs(30);
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
}

#[derive(Debug)]
pub struct Proposal {
    pub pod: Pod,
    pub deadline: Instant,
    pub accepted: HashSet<String>,
}

#[derive(Debug)]
pub struct Pod {
    pub bracket: u8,
    pub pod_size: u8,
    pub host: usize,
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
        self.decline_match(player_id)
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

    fn propose(&mut self, pod: Pod, now: Instant) {
        self.proposals.push(Proposal {
            pod,
            deadline: now + PROPOSAL_TIMEOUT,
            accepted: HashSet::new(),
        });
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
    ) -> (Vec<Pod>, Vec<String>, Vec<String>) {
        let mut ready = Vec::new();
        let mut dropped = Vec::new();
        let mut requeued = Vec::new();
        for proposal in std::mem::take(&mut self.proposals) {
            let all_live = proposal
                .pod
                .members
                .iter()
                .all(|entry| live.contains(&entry.player_id));
            let all_accepted = proposal
                .pod
                .members
                .iter()
                .all(|entry| proposal.accepted.contains(&entry.player_id));
            if all_live && all_accepted {
                ready.push(proposal.pod);
            } else if all_live && now < proposal.deadline {
                self.proposals.push(proposal);
            } else {
                let (keep, lose): (Vec<_>, Vec<_>) =
                    proposal.pod.members.into_iter().partition(|entry| {
                        live.contains(&entry.player_id)
                            && (!all_live || proposal.accepted.contains(&entry.player_id))
                    });
                dropped.extend(lose.into_iter().map(|entry| entry.player_id));
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
            .find(|entry| entry.player_id == player_id)
    }

    fn retain_live(&mut self, live: &HashSet<String>) {
        self.entries.retain(|entry| live.contains(&entry.player_id));
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

    pub fn take_pods(&mut self) -> Vec<Pod> {
        let mut pods = Vec::new();
        while let Some(pod) = self.take_one() {
            pods.push(pod);
        }
        pods
    }

    fn take_one(&mut self) -> Option<Pod> {
        for anchor in 0..self.entries.len() {
            for pod_size in self.entries[anchor].pod_sizes.clone() {
                for bracket in self.entries[anchor].brackets() {
                    if let Some(pod) = self.take_at(anchor, pod_size, bracket) {
                        return Some(pod);
                    }
                }
            }
        }
        None
    }

    fn take_at(&mut self, anchor: usize, pod_size: u8, bracket: u8) -> Option<Pod> {
        let accepting: Vec<usize> = (0..self.entries.len())
            .filter(|&i| {
                i == anchor
                    || (self.entries[i].format == self.entries[anchor].format
                        && self.entries[i].accepts_size(pod_size)
                        && self.entries[i].accepts(bracket))
            })
            .collect();
        let &host = accepting.iter().find(|&&i| self.entries[i].can_host)?;
        let mut chosen = vec![host];
        if host != anchor {
            chosen.push(anchor);
        }
        chosen.extend(
            accepting
                .iter()
                .copied()
                .filter(|i| *i != host && *i != anchor)
                .take((pod_size as usize).saturating_sub(chosen.len())),
        );
        let full = chosen.len() == pod_size as usize;
        let bot_fill =
            !full && chosen.len() >= 2 && chosen.iter().all(|&i| self.entries[i].bot_fill);
        if !full && !bot_fill {
            return None;
        }
        let host_id = self.entries[host].player_id.clone();
        let mut members = Vec::with_capacity(chosen.len());
        chosen.sort_unstable_by(|a, b| b.cmp(a));
        for i in chosen {
            members.push(self.entries.remove(i));
        }
        members.sort_by_key(|entry| entry.queued_at);
        let host = members
            .iter()
            .position(|entry| entry.player_id == host_id)
            .expect("host is a member");
        Some(Pod {
            bracket,
            pod_size,
            host,
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
    let (ready, dropped, requeued, proposals, offers, bot_offers, statuses) = {
        let mut queue = state.queue.lock().expect("queue lock");
        queue.retain_live(&live);
        let (ready, dropped, requeued) = queue.resolve_proposals(now, &live);
        let proposals: Vec<_> = queue
            .take_pods()
            .into_iter()
            .map(|pod| {
                let ids: Vec<String> = pod.members.iter().map(|e| e.player_id.clone()).collect();
                let msg = ServerMessage::MatchProposal {
                    bracket: pod.bracket,
                    pod_size: pod.pod_size,
                    players: pod.members.len() as u32,
                    expires_s: PROPOSAL_TIMEOUT.as_secs() as u32,
                };
                queue.propose(pod, now);
                (ids, msg)
            })
            .collect();
        let offers: Vec<_> = queue
            .due_offers(now)
            .into_iter()
            .map(|(player_id, down, up)| {
                let waiting = queue
                    .get(&player_id)
                    .map(|entry| queue.waiting_for(entry))
                    .unwrap_or_default();
                (player_id, down, up, waiting)
            })
            .collect();
        let bot_offers = queue.due_bot_fill_offers(now);
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
            ready, dropped, requeued, proposals, offers, bot_offers, statuses,
        )
    };

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
    for pod in ready {
        seat_pod(state, pod);
    }
}

fn requeue(state: &Arc<ServerState>, members: Vec<QueueEntry>) {
    let mut queue = state.queue.lock().expect("queue lock");
    for entry in members {
        queue.enter(entry);
    }
}

fn seat_pod(state: &Arc<ServerState>, pod: Pod) {
    let Pod {
        bracket,
        pod_size,
        host,
        members,
        bot_fill,
    } = pod;
    let host_entry = members[host].clone();
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
    room.matchmade_bracket = Some(bracket);
    room.matchmade_bot_fill = bot_fill;
    for entry in &members {
        if entry.player_id != host_entry.player_id {
            room.add_player(entry.player_id.clone(), entry.username.clone(), false)
                .expect("a new room has a seat for every pod member");
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
    let info: RoomInfo = room.to_room_info();
    let resume_token = room.resume_token.clone();
    state.rooms.insert(room_id.clone(), room);

    let mut seated = Vec::new();
    let mut lost = Vec::new();
    for entry in &members {
        let claimed = state
            .players
            .get_mut(&entry.player_id)
            .is_some_and(|mut player| {
                if player.connected && player.room_id.is_none() {
                    player.room_id = Some(room_id.clone());
                    true
                } else {
                    false
                }
            });
        if claimed {
            seated.push(entry);
        } else {
            lost.push(entry.player_id.clone());
        }
    }
    if !lost.is_empty() {
        info!(
            "[queue] pod {} lost {} member(s) before seating, returning the rest to the queue",
            &room_id[..8],
            lost.len()
        );
        state.rooms.remove(&room_id);
        for entry in &seated {
            if let Some(mut player) = state.players.get_mut(&entry.player_id) {
                player.room_id = None;
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
