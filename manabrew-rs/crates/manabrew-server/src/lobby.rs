use std::sync::Arc;

use crate::analytics::{self, GameEndReason};
use crate::error::ServerError;
use crate::protocol::{
    DraftConfig, EngineKind, GameFormat, PlayerDeckInfo, RematchInfo, RematchIntent,
    RematchPlayerInfo, ResumeRoomRequest, RoomInfo, RoomStatus, SealedConfig,
};
use crate::replay::GameReplayCache;
use crate::room::{Room, RoomSlot};
use crate::state::ServerState;
use manabrew_protocol::deck_dto::Deck;
use manabrew_protocol::game::PlaymatSettings;
use manabrew_relay_protocol::{DEFAULT_RECONNECT_TIMEOUT_S, PROTOCOL_VERSION};

const MIN_RECONNECT_TIMEOUT_S: u32 = 10;
// Must stay below manabrew_game_runtime 's 120s relay response_timeout
const MAX_RECONNECT_TIMEOUT_S: u32 = 90;

#[allow(clippy::too_many_arguments)]
pub fn create_room_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    room_name: String,
    max_players: u8,
    format: GameFormat,
    protocol_version: u32,
    hosted: bool,
    engine: EngineKind,
    draft_config: Option<DraftConfig>,
    sealed_config: Option<SealedConfig>,
    official_key: Option<String>,
    password: Option<String>,
    reconnect_timeout_s: Option<u32>,
    table_style: Option<String>,
) -> Result<(RoomInfo, String), ServerError> {
    if let Some(cfg) = &draft_config {
        if cfg
            .pick_seconds
            .is_some_and(|seconds| !(5..=600).contains(&seconds))
        {
            return Err(ServerError::InvalidDraftConfig(
                "pick_seconds must be between 5 and 600".into(),
            ));
        }
        match (cfg.set_code.as_ref(), cfg.cube_id.as_ref()) {
            (Some(_), Some(_)) => {
                return Err(ServerError::InvalidDraftConfig(
                    "set_code and cube_id are mutually exclusive".into(),
                ));
            }
            (None, None) => {
                return Err(ServerError::InvalidDraftConfig(
                    "set_code or cube_id required".into(),
                ));
            }
            _ => {}
        }
    }
    if let Some(cfg) = &sealed_config {
        match (cfg.set_code.as_ref(), cfg.cube_id.as_ref()) {
            (Some(_), Some(_)) => {
                return Err(ServerError::InvalidDraftConfig(
                    "sealed set_code and cube_id are mutually exclusive".into(),
                ));
            }
            (None, None) => {
                return Err(ServerError::InvalidDraftConfig(
                    "sealed set_code or cube_id required".into(),
                ));
            }
            _ => {}
        }
    }

    {
        if let Some(player) = state.players.get(player_id) {
            if let Some(rid) = &player.room_id {
                return Err(ServerError::AlreadyInRoom(rid.clone()));
            }
        } else {
            return Err(ServerError::AuthFailed("Player not found".into()));
        }
    }

    if state.rooms.len() >= state.max_rooms {
        return Err(ServerError::RoomFull("Server room limit reached".into()));
    }

    let username = state
        .players
        .get(player_id)
        .map(|p| p.username.clone())
        .unwrap_or_default();

    let official = match &state.official_key {
        Some(key) => official_key.as_deref() == Some(key.as_str()),
        None => false,
    };

    let room_id = uuid::Uuid::new_v4().to_string();
    let room = Room::new(
        room_id.clone(),
        room_name,
        protocol_version,
        player_id.to_string(),
        username,
        max_players,
        format,
        engine,
        !hosted,
        draft_config,
        sealed_config,
        official,
        password.filter(|value| !value.is_empty()),
        reconnect_timeout_s
            .unwrap_or(DEFAULT_RECONNECT_TIMEOUT_S)
            .clamp(MIN_RECONNECT_TIMEOUT_S, MAX_RECONNECT_TIMEOUT_S),
        table_style,
    );
    let info = room.to_room_info();
    let resume_token = room.resume_token.clone();

    state.rooms.insert(room_id.clone(), room);

    if let Some(mut player) = state.players.get_mut(player_id) {
        player.room_id = Some(room_id);
    }

    Ok((info, resume_token))
}

pub struct ResumedRoom {
    pub room_info: RoomInfo,
    pub awaiting_rejoin: Vec<String>,
}

pub fn resume_room_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    spec: ResumeRoomRequest,
) -> Result<ResumedRoom, ServerError> {
    if !(2..=8).contains(&spec.max_players) {
        return Err(ServerError::InvalidSeatAssignment(
            "Room capacity must be between 2 and 8".into(),
        ));
    }
    if spec.player_order.len() > usize::from(spec.max_players) {
        return Err(ServerError::InvalidSeatAssignment(
            "Player roster exceeds room capacity".into(),
        ));
    }
    if spec
        .player_order
        .iter()
        .enumerate()
        .any(|(index, username)| spec.player_order[..index].contains(username))
    {
        return Err(ServerError::InvalidSeatAssignment(
            "Player roster contains duplicate usernames".into(),
        ));
    }
    if let Some(indices) = &spec.seat_indices {
        if indices.len() != spec.player_order.len() {
            return Err(ServerError::InvalidSeatAssignment(
                "Seat indices must align with player_order".into(),
            ));
        }
        if indices
            .iter()
            .enumerate()
            .any(|(index, seat)| *seat >= spec.max_players || indices[..index].contains(seat))
        {
            return Err(ServerError::InvalidSeatAssignment(
                "Seat indices must be unique and within room capacity".into(),
            ));
        }
    }
    let (username, current_room_id) = {
        let player = state
            .players
            .get(player_id)
            .ok_or_else(|| ServerError::AuthFailed("Player not found".into()))?;
        (player.username.clone(), player.room_id.clone())
    };
    if let Some(rid) = &current_room_id {
        if rid != &spec.room_id
            && !state.rooms.get(rid).is_some_and(|room| {
                room.parent_limited_room.as_deref() == Some(spec.room_id.as_str())
            })
        {
            return Err(ServerError::AlreadyInRoom(rid.clone()));
        }
    }

    if let Some(mut room) = state.rooms.get_mut(&spec.room_id) {
        if room.parent_limited_room.is_some() || room.resume_token != spec.resume_token {
            return Err(ServerError::InvalidResumeToken);
        }
        if room.is_limited_session() && room.host_username != username {
            return Err(ServerError::InvalidResumeToken);
        }
        if room.status == RoomStatus::Finished && room.host_username != username {
            return Err(ServerError::InvalidResumeToken);
        }
        if spec
            .seat_indices
            .as_ref()
            .is_some_and(|indices| indices.iter().any(|seat| *seat >= room.max_players))
        {
            return Err(ServerError::InvalidSeatAssignment(
                "Seat index exceeds the retained room's capacity".into(),
            ));
        }
        if room.is_limited_session() && room.status == RoomStatus::Lobby {
            let restored_players = resumed_slots(&spec, player_id, &username, Some(&room))?;
            room.players = restored_players;
            room.status = RoomStatus::InGame;
            room.replay = Some(GameReplayCache::new(
                spec.game_id.clone(),
                spec.player_order.clone(),
                spec.player_decks.clone(),
                room.human_player_usernames(),
                spec.starting_life,
            ));
        }

        let old_host_pid = room.host_player_id.clone();
        room.host_player_id = player_id.to_string();
        room.host_username = username.clone();
        if room.hosted {
            room.remove_observer(&old_host_pid);
            let _ = room.add_observer(player_id.to_string(), username.clone());
            room.set_connected(player_id, true);
        } else if let Some(slot) = room
            .players
            .iter_mut()
            .find(|slot| slot.username == username)
        {
            slot.player_id = player_id.to_string();
            slot.connected = true;
        }
        let resumed = ResumedRoom {
            room_info: room.to_room_info(),
            awaiting_rejoin: awaiting_rejoin(&room),
        };
        drop(room);

        if old_host_pid != player_id {
            state.players.remove(&old_host_pid);
        }
        let current_room_id = state
            .players
            .get(player_id)
            .and_then(|player| player.room_id.clone());
        let attached_child = current_room_id.as_ref().is_some_and(|id| {
            state.rooms.get(id).is_some_and(|room| {
                room.parent_limited_room.as_deref() == Some(spec.room_id.as_str())
            })
        });
        if let Some(mut player) = state.players.get_mut(player_id) {
            if !attached_child && player.room_id == current_room_id {
                player.room_id = Some(spec.room_id);
            }
        }
        return Ok(resumed);
    }

    // Unknown room: the relay restarted and forgot it. The claim is taken on
    // trust — the presented token is stored so later duplicate claims must
    // match, but there is nothing left server-side to verify the first one
    // against, and squatting a UUID room id inside the reconnect window is
    // not a realistic threat.
    if state.rooms.len() >= state.max_rooms {
        return Err(ServerError::RoomFull("Server room limit reached".into()));
    }

    let official = match &state.official_key {
        Some(key) => spec.official_key.as_deref() == Some(key.as_str()),
        None => false,
    };

    let restored_players = resumed_slots(&spec, player_id, &username, None)?;
    let mut room = Room::new(
        spec.room_id.clone(),
        spec.room_name,
        PROTOCOL_VERSION,
        player_id.to_string(),
        username.clone(),
        spec.max_players,
        spec.format,
        spec.engine,
        !spec.hosted,
        spec.draft_config,
        spec.sealed_config,
        official,
        spec.password.filter(|value| !value.is_empty()),
        spec.reconnect_timeout_s
            .unwrap_or(DEFAULT_RECONNECT_TIMEOUT_S)
            .clamp(MIN_RECONNECT_TIMEOUT_S, MAX_RECONNECT_TIMEOUT_S),
        spec.table_style,
    );
    room.allow_spectators = spec.allow_spectators.unwrap_or(false);
    room.resume_token = spec.resume_token;
    room.status = RoomStatus::InGame;
    room.players = restored_players;
    room.replay = Some(GameReplayCache::new(
        spec.game_id,
        spec.player_order,
        spec.player_decks,
        room.human_player_usernames(),
        spec.starting_life,
    ));

    let resumed = ResumedRoom {
        room_info: room.to_room_info(),
        awaiting_rejoin: awaiting_rejoin(&room),
    };
    let pending_seats: Vec<String> = room
        .players
        .iter()
        .filter(|slot| !slot.connected)
        .map(|slot| slot.player_id.clone())
        .collect();

    state.rooms.insert(spec.room_id.clone(), room);
    for seat_player_id in pending_seats {
        crate::cleanup::schedule_seat_forfeit(state.clone(), spec.room_id.clone(), seat_player_id);
    }
    if let Some(mut player) = state.players.get_mut(player_id) {
        player.room_id = Some(spec.room_id);
    }

    Ok(resumed)
}

fn resumed_slots(
    spec: &ResumeRoomRequest,
    player_id: &str,
    username: &str,
    retained: Option<&Room>,
) -> Result<Vec<RoomSlot>, ServerError> {
    let max_players = retained.map_or(spec.max_players, |room| room.max_players);
    let retained_index = |username: &str| {
        retained.and_then(|room| {
            room.players
                .iter()
                .find(|seat| seat.username == username)
                .map(|seat| seat.seat_index)
        })
    };
    let mut occupied = 0u8;
    for (index, username) in spec.player_order.iter().enumerate() {
        if let Some(seat) = retained_index(username)
            .or_else(|| spec.seat_indices.as_ref().map(|indices| indices[index]))
        {
            if seat >= max_players || occupied & (1 << seat) != 0 {
                return Err(ServerError::InvalidSeatAssignment(
                    "Resumed seats conflict with the retained room's positions".into(),
                ));
            }
            occupied |= 1 << seat;
        }
    }
    spec.player_order
        .iter()
        .enumerate()
        .map(|(index, seat_username)| {
            let seat_index = match retained_index(seat_username)
                .or_else(|| spec.seat_indices.as_ref().map(|indices| indices[index]))
            {
                Some(seat) => seat,
                None => {
                    let seat = (0..max_players)
                        .find(|seat| occupied & (1 << *seat) == 0)
                        .ok_or_else(|| {
                            ServerError::InvalidSeatAssignment(
                                "Player roster exceeds the retained room's capacity".into(),
                            )
                        })?;
                    occupied |= 1 << seat;
                    seat
                }
            };
            let deck = spec
                .player_decks
                .iter()
                .find(|deck| &deck.username == seat_username);
            let is_bot = spec.bot_players.contains(seat_username);
            let is_requester = !spec.hosted && seat_username == username;
            Ok(RoomSlot {
                seat_index,
                player_id: if is_requester {
                    player_id.to_string()
                } else {
                    format!("pending-rejoin-{}", uuid::Uuid::new_v4())
                },
                username: seat_username.clone(),
                ready: true,
                connected: is_requester,
                is_bot,
                selected_deck_name: deck.map(|d| d.deck_name.clone()),
                selected_deck: deck.map(|d| d.deck.clone()),
                published_deck_id: deck.and_then(|d| d.published_deck_id.clone()),
                selected_commander_name: deck.and_then(|d| d.commander_name.clone()),
                avatar_url: deck.and_then(|d| d.avatar_url.clone()),
            })
        })
        .collect()
}

fn awaiting_rejoin(room: &Room) -> Vec<String> {
    room.players
        .iter()
        .filter(|slot| !slot.connected && !slot.is_bot)
        .map(|slot| slot.username.clone())
        .collect()
}

pub fn join_room_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    room_id: &str,
    observe: bool,
    as_bot: bool,
    password: Option<String>,
    seat_index: Option<u8>,
) -> Result<(RoomInfo, bool), ServerError> {
    {
        if let Some(player) = state.players.get(player_id) {
            if let Some(rid) = &player.room_id {
                return Err(ServerError::AlreadyInRoom(rid.clone()));
            }
        } else {
            return Err(ServerError::AuthFailed("Player not found".into()));
        }
    }

    let username = state
        .players
        .get(player_id)
        .map(|p| p.username.clone())
        .unwrap_or_default();

    let (info, rejoined) = {
        let mut room = state
            .rooms
            .get_mut(room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.to_string()))?;

        if let Some(required) = &room.password {
            if password.as_deref() != Some(required.as_str()) {
                return Err(ServerError::IncorrectPassword);
            }
        }

        if observe && room.status != RoomStatus::Lobby {
            if !room.can_spectate() {
                return Err(ServerError::GameNotInProgress);
            }
            room.add_observer(player_id.to_string(), username)
                .map_err(|_| ServerError::AlreadyInRoom(room_id.to_string()))?;
            (room.to_room_info(), false)
        } else if let Some(slot) = room.players.iter_mut().find(|slot| {
            !observe && slot.username == username && slot.is_bot == as_bot && !slot.connected
        }) {
            slot.player_id = player_id.to_string();
            slot.connected = true;
            (room.to_room_info(), true)
        } else if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        } else {
            if observe {
                room.add_observer(player_id.to_string(), username)
                    .map_err(|_| ServerError::AlreadyInRoom(room_id.to_string()))?;
            } else {
                room.add_player(player_id.to_string(), username, as_bot, seat_index)?;
            }
            (room.to_room_info(), false)
        }
    };

    if let Some(mut player) = state.players.get_mut(player_id) {
        player.room_id = Some(room_id.to_string());
    }

    Ok((info, rejoined))
}

pub fn leave_room_sync(state: &Arc<ServerState>, player_id: &str) -> Result<(), ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };
    let parent_id = state
        .rooms
        .get(&room_id)
        .and_then(|room| room.parent_limited_room.clone());
    let mut parent_empty = false;
    if let Some(parent_id) = &parent_id {
        let info = state.rooms.get_mut(parent_id).map(|mut parent| {
            parent.remove_participant(player_id);
            parent_empty = parent.is_empty();
            parent.to_room_info()
        });
        if let Some(info) = info {
            crate::connection::broadcast_to_room(
                state,
                parent_id,
                &crate::protocol::ServerMessage::RoomUpdate { room: info },
            );
        }
    }

    let (room_empty, no_connected_players) = {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        if room.status == RoomStatus::Finished && room.is_host(player_id) {
            room.cancel_rematch();
            let room_info = room.to_room_info();
            drop(room);
            crate::connection::broadcast_to_room(
                state,
                &room_id,
                &crate::protocol::ServerMessage::RoomUpdate { room: room_info },
            );
            crate::connection::broadcast_to_room(
                state,
                &room_id,
                &crate::protocol::ServerMessage::GameAborted {
                    room_id: room_id.clone(),
                },
            );
            crate::cleanup::remove_room_and_clear_sessions(
                state,
                &room_id,
                GameEndReason::HostLost,
            );
            return Ok(());
        }
        room.remove_participant(player_id);
        let empty = room.is_empty();
        let no_connected = if room.parent_limited_room.is_some() {
            !crate::cleanup::paired_room_has_participants(state, &room, std::time::Instant::now())
        } else {
            room.all_disconnected()
        };
        if !empty && !no_connected && room.players.is_empty() {
            room.reset_lobby_settings();
        }
        (empty, no_connected)
    };

    if room_empty || no_connected_players {
        crate::cleanup::remove_room_and_clear_sessions(state, &room_id, GameEndReason::Abandoned);
    }

    if let Some(mut player) = state.players.get_mut(player_id) {
        player.room_id = None;
    }
    if parent_empty {
        if let Some(parent_id) = parent_id {
            crate::cleanup::remove_room_and_clear_sessions(
                state,
                &parent_id,
                GameEndReason::Abandoned,
            );
        }
    }

    Ok(())
}

pub fn set_ready_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    ready: bool,
) -> Result<String, ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };

    {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        }

        let format_requires_deck = room.format != GameFormat::Any && !room.is_limited_session();
        if ready && format_requires_deck && !room.has_selected_deck(player_id) {
            return Err(ServerError::DeckNotSelected);
        }

        room.set_ready(player_id, ready)
            .map_err(|_| ServerError::NotInRoom)?;
    }

    Ok(room_id)
}

const MAX_COLOR_LEN: usize = 32;
const MAX_PUBLISHED_DECK_ID_LEN: usize = 160;

fn sanitize_playmat_settings(settings: &mut PlaymatSettings) {
    settings.color = settings.color.take().filter(|s| s.len() <= MAX_COLOR_LEN);
    settings.border_color = settings
        .border_color
        .take()
        .filter(|s| s.len() <= MAX_COLOR_LEN);
}

fn sanitize_published_deck_id(value: Option<String>) -> Option<String> {
    value.filter(|id| {
        !id.is_empty()
            && id.len() <= MAX_PUBLISHED_DECK_ID_LEN
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
    })
}

pub fn set_deck_selection_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    deck_name: String,
    mut deck: Deck,
    published_deck_id: Option<String>,
    commander_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<String, ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };

    if let Some(settings) = deck.playmat_settings.as_mut() {
        sanitize_playmat_settings(settings);
    }
    let published_deck_id = sanitize_published_deck_id(published_deck_id);

    {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        if !matches!(room.status, RoomStatus::Lobby | RoomStatus::Finished) {
            return Err(ServerError::GameAlreadyStarted);
        }
        if room.status == RoomStatus::Finished
            && !room
                .players
                .iter()
                .any(|p| p.player_id == player_id && !p.is_bot)
        {
            return Err(ServerError::NotInRoom);
        }

        room.set_deck_selection(
            player_id,
            deck_name,
            deck,
            published_deck_id,
            commander_name,
            avatar_url,
        )
        .map_err(|_| ServerError::NotInRoom)?;
    }

    Ok(room_id)
}

pub struct StartedGame {
    pub game_id: String,
    pub room_id: String,
    pub player_order: Vec<String>,
    pub player_decks: Vec<PlayerDeckInfo>,
    pub starting_life: i32,
    pub room_info: RoomInfo,
}

pub fn set_format_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    format: GameFormat,
) -> Result<String, ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };

    {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        if !room.is_controller(player_id) {
            return Err(ServerError::NotHost);
        }

        if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        }

        if room.format != format {
            room.format = format;
            for player in room.players.iter_mut().filter(|p| !p.is_bot) {
                player.ready = false;
            }
        }
    }

    Ok(room_id)
}

pub fn set_max_players_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    max_players: u8,
) -> Result<String, ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };

    {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        if !room.is_controller(player_id) {
            return Err(ServerError::NotHost);
        }

        if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        }

        let floor = (room.players.len() as u8).max(2);
        room.set_max_players(max_players.clamp(floor, floor.max(4)));
    }

    Ok(room_id)
}

pub fn set_auto_start_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    enabled: bool,
) -> Result<String, ServerError> {
    let room_id = state
        .players
        .get(player_id)
        .and_then(|p| p.room_id.clone())
        .ok_or(ServerError::NotInRoom)?;
    let mut room = state
        .rooms
        .get_mut(&room_id)
        .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;
    if !room.is_controller(player_id) {
        return Err(ServerError::NotHost);
    }
    if room.status != RoomStatus::Lobby {
        return Err(ServerError::GameAlreadyStarted);
    }
    room.auto_start = enabled;
    Ok(room_id)
}

pub fn start_game_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    format: Option<GameFormat>,
) -> Result<StartedGame, ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };

    let started = {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        let matchmade_host = room.matchmade_bracket.is_some() && room.is_host(player_id);
        if !room.is_controller(player_id) && !matchmade_host {
            return Err(ServerError::NotHost);
        }

        if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        }

        if !room.host_connected() {
            return Err(ServerError::AuthFailed(
                "The engine host is disconnected".into(),
            ));
        }

        if room.format == GameFormat::Any {
            match format {
                Some(chosen) if chosen != GameFormat::Any => room.format = chosen,
                _ => return Err(ServerError::FormatNotChosen),
            }
        }

        if !room.all_ready() {
            return Err(ServerError::PlayersNotReady);
        }

        if !room.is_limited_session()
            && room
                .players
                .iter()
                .any(|p| p.selected_deck_name.is_none() || p.selected_deck.is_none())
        {
            return Err(ServerError::DeckNotSelected);
        }

        launch_game(&mut room)
    };

    Ok(started)
}

fn launch_game(room: &mut Room) -> StartedGame {
    let starting_life = match room.format {
        GameFormat::Commander => 40,
        GameFormat::Brawl => 25,
        GameFormat::PauperCommander => 30,
        GameFormat::DuelCommander
        | GameFormat::Standard
        | GameFormat::Pioneer
        | GameFormat::Modern
        | GameFormat::Legacy
        | GameFormat::Vintage
        | GameFormat::Pauper
        | GameFormat::Premodern
        | GameFormat::Oathbreaker
        | GameFormat::Draft
        | GameFormat::Sealed => 20,
        GameFormat::Any => unreachable!("Any resolved to concrete format before launch"),
    };
    let player_order = room.player_usernames();
    let player_decks = room.player_decks();
    let game_id = uuid::Uuid::new_v4().to_string();
    room.status = RoomStatus::InGame;
    room.rematch = None;
    room.humanless_since = None;
    room.replay = Some(GameReplayCache::new(
        game_id.clone(),
        player_order.clone(),
        player_decks.clone(),
        room.human_player_usernames(),
        starting_life,
    ));
    StartedGame {
        game_id,
        room_id: room.room_id.clone(),
        player_order,
        player_decks,
        starting_life,
        room_info: room.to_room_info(),
    }
}

pub fn finish_game_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    game_id: &str,
) -> Result<(String, RoomInfo), ServerError> {
    let room_id = state
        .players
        .get(player_id)
        .and_then(|p| p.room_id.clone())
        .ok_or(ServerError::NotInRoom)?;
    let mut room = state
        .rooms
        .get_mut(&room_id)
        .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;
    if !room.is_host(player_id) {
        return Err(ServerError::NotHost);
    }
    let replay = room
        .replay
        .as_ref()
        .filter(|r| r.game_id == game_id)
        .ok_or(ServerError::GameNotInProgress)?;
    if room.status == RoomStatus::Finished {
        return Ok((room_id, room.to_room_info()));
    }
    if room.status != RoomStatus::InGame
        || room.is_limited_session()
        || room.parent_limited_room.is_some()
        || room.limited_session_id.is_some()
        || !replay.outcome.reported
        || !replay.outcome.game_over
        || replay.outcome.fatal_message.is_some()
    {
        return Err(ServerError::GameNotInProgress);
    }
    let players = replay
        .human_player_order
        .iter()
        .map(|username| RematchPlayerInfo {
            username: username.clone(),
            intent: RematchIntent::Deciding,
        })
        .collect::<Vec<_>>();
    let cancelled = replay
        .player_order
        .iter()
        .any(|username| !room.players.iter().any(|seat| seat.username == *username));
    analytics::emit_game_ended(&state.analytics, &room, replay, GameEndReason::GameOver);
    room.rematch = Some(RematchInfo {
        game_id: game_id.to_string(),
        players,
        cancelled,
    });
    room.status = RoomStatus::Finished;
    room.humanless_since = None;
    for seat in &mut room.players {
        seat.ready = false;
    }
    if let Some(replay) = &mut room.replay {
        replay.queued_inputs.clear();
    }
    Ok((room_id, room.to_room_info()))
}

pub fn set_rematch_intent_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    game_id: &str,
    intent: RematchIntent,
) -> Result<(String, RoomInfo, Option<StartedGame>), ServerError> {
    let room_id = state
        .players
        .get(player_id)
        .and_then(|p| p.room_id.clone())
        .ok_or(ServerError::NotInRoom)?;
    let mut room = state
        .rooms
        .get_mut(&room_id)
        .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;
    if room.status != RoomStatus::Finished {
        return Err(ServerError::GameNotInProgress);
    }
    let seat = room
        .players
        .iter()
        .find(|p| p.player_id == player_id && !p.is_bot && p.connected)
        .ok_or(ServerError::NotInRoom)?;
    if intent == RematchIntent::Ready && seat.selected_deck.is_none() {
        return Err(ServerError::DeckNotSelected);
    }
    let username = seat.username.clone();
    let rematch = room
        .rematch
        .as_mut()
        .filter(|r| r.game_id == game_id && !r.cancelled)
        .ok_or(ServerError::GameNotInProgress)?;
    let player = rematch
        .players
        .iter_mut()
        .find(|p| p.username == username)
        .ok_or(ServerError::NotInRoom)?;
    player.intent = intent;
    let started = start_ready_rematch(&mut room);
    Ok((room_id, room.to_room_info(), started))
}

fn start_ready_rematch(room: &mut Room) -> Option<StartedGame> {
    if room.status != RoomStatus::Finished || !room.host_connected() {
        return None;
    }
    let rematch = room.rematch.as_ref()?;
    if rematch.cancelled
        || rematch.players.is_empty()
        || !rematch.players.iter().all(|player| {
            player.intent == RematchIntent::Ready
                && room
                    .players
                    .iter()
                    .any(|seat| seat.username == player.username && !seat.is_bot && seat.connected)
        })
        || room.players.iter().any(|seat| {
            !seat.connected || seat.selected_deck.is_none() || seat.selected_deck_name.is_none()
        })
    {
        return None;
    }
    Some(launch_game(room))
}

pub fn resume_ready_rematch(state: &Arc<ServerState>, room_id: &str) -> Option<StartedGame> {
    let mut room = state.rooms.get_mut(room_id)?;
    start_ready_rematch(&mut room)
}

pub fn return_to_lobby_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    game_id: &str,
) -> Result<(String, RoomInfo), ServerError> {
    let room_id = state
        .players
        .get(player_id)
        .and_then(|p| p.room_id.clone())
        .ok_or(ServerError::NotInRoom)?;
    let mut room = state
        .rooms
        .get_mut(&room_id)
        .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;
    if room.status != RoomStatus::Finished
        || !room
            .rematch
            .as_ref()
            .is_some_and(|r| r.game_id == game_id && r.cancelled)
    {
        return Err(ServerError::GameNotInProgress);
    }
    if !room
        .players
        .iter()
        .any(|p| p.player_id == player_id && !p.is_bot && p.connected)
    {
        return Err(ServerError::NotInRoom);
    }
    room.status = RoomStatus::Lobby;
    room.rematch = None;
    room.replay = None;
    for seat in &mut room.players {
        seat.ready = false;
    }
    Ok((room_id, room.to_room_info()))
}

pub fn end_game_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    game_id: &str,
) -> Result<(String, RoomInfo, Vec<String>), ServerError> {
    let room_id = state
        .players
        .get(player_id)
        .and_then(|p| p.room_id.clone())
        .ok_or(ServerError::NotInRoom)?;

    {
        let room = state
            .rooms
            .get(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;
        if !room.is_host(player_id) {
            return Err(ServerError::NotHost);
        }
        if room.status != RoomStatus::InGame {
            return Err(ServerError::GameNotInProgress);
        }
        if room.replay.as_ref().is_some_and(|r| r.game_id != game_id) {
            return Err(ServerError::GameNotInProgress);
        }
    }

    let (info, notify) = reset_room_to_lobby(state, &room_id, GameEndReason::HostEnded)
        .ok_or(ServerError::RoomNotFound(room_id.clone()))?;

    Ok((room_id, info, notify))
}

pub fn reset_room_to_lobby(
    state: &Arc<ServerState>,
    room_id: &str,
    reason: GameEndReason,
) -> Option<(RoomInfo, Vec<String>)> {
    let (info, cleared, paired_limited, children) = {
        let mut room = state.rooms.get_mut(room_id)?;
        if let Some(replay) = room.replay.take() {
            if room.status != RoomStatus::Finished {
                analytics::emit_game_ended(&state.analytics, &room, &replay, reason);
            }
        }
        let mut cleared: Vec<String> = room.players.iter().map(|p| p.player_id.clone()).collect();
        let host_id = room.host_player_id.clone();
        room.observers.retain(|observer| {
            if observer.player_id == host_id {
                return true;
            }
            cleared.push(observer.player_id.clone());
            false
        });
        room.status = RoomStatus::Lobby;
        room.rematch = None;
        let paired_limited = room.parent_limited_room.is_some();
        let children = if paired_limited {
            for seat in &mut room.players {
                seat.ready = false;
            }
            Vec::new()
        } else {
            std::mem::take(&mut room.limited_matches)
        };
        if !paired_limited {
            room.players.clear();
            room.limited_session_id = None;
            room.draft_clock = None;
        }
        if !paired_limited {
            room.reset_lobby_settings();
        }
        (room.to_room_info(), cleared, paired_limited, children)
    };
    for child_id in children {
        let active = state
            .rooms
            .get(&child_id)
            .is_some_and(|child| child.status == RoomStatus::InGame);
        if active {
            crate::connection::broadcast_to_room(
                state,
                &child_id,
                &crate::protocol::ServerMessage::GameAborted {
                    room_id: child_id.clone(),
                },
            );
        }
        crate::cleanup::remove_room_and_clear_sessions(state, &child_id, reason);
    }

    let mut notify = Vec::new();
    for pid in cleared {
        if paired_limited {
            notify.push(pid);
            continue;
        }
        match state.players.get(&pid).map(|p| p.disconnected_at.is_some()) {
            Some(true) => {
                state.players.remove(&pid);
            }
            Some(false) => {
                if let Some(mut p) = state.players.get_mut(&pid) {
                    p.room_id = None;
                }
                notify.push(pid);
            }
            None => {}
        }
    }

    Some((info, notify))
}
