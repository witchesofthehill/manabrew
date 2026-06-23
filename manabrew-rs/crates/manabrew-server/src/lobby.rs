use std::sync::Arc;

use crate::error::ServerError;
use crate::protocol::{
    DraftConfig, EngineKind, GameFormat, PlayerDeckInfo, RoomInfo, RoomStatus, SealedConfig,
};
use crate::replay::GameReplayCache;
use crate::room::Room;
use crate::state::ServerState;
use manabrew_protocol::deck_dto::{Deck, PlaymatSettings};
use manabrew_protocol::protocol::DEFAULT_RECONNECT_TIMEOUT_S;

const MIN_RECONNECT_TIMEOUT_S: u32 = 10;
// Must stay below manabrew_game_runtime 's 120s relay response_timeout
const MAX_RECONNECT_TIMEOUT_S: u32 = 90;

pub fn create_room_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    room_name: String,
    max_players: u8,
    format: GameFormat,
    hosted: bool,
    engine: EngineKind,
    draft_config: Option<DraftConfig>,
    sealed_config: Option<SealedConfig>,
    official_key: Option<String>,
    password: Option<String>,
    reconnect_timeout_s: Option<u32>,
) -> Result<RoomInfo, ServerError> {
    if let Some(cfg) = &draft_config {
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
    );
    let info = room.to_room_info();

    state.rooms.insert(room_id.clone(), room);

    if let Some(mut player) = state.players.get_mut(player_id) {
        player.room_id = Some(room_id);
    }

    Ok(info)
}

pub fn join_room_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    room_id: &str,
    observe: bool,
    as_bot: bool,
    password: Option<String>,
) -> Result<RoomInfo, ServerError> {
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

    let info = {
        let mut room = state
            .rooms
            .get_mut(room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.to_string()))?;

        if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        }

        if let Some(required) = &room.password {
            if password.as_deref() != Some(required.as_str()) {
                return Err(ServerError::IncorrectPassword);
            }
        }

        if observe {
            room.add_observer(player_id.to_string(), username)
                .map_err(|_| ServerError::AlreadyInRoom(room_id.to_string()))?;
        } else {
            room.add_player(player_id.to_string(), username, as_bot)
                .map_err(|msg| {
                    if msg.contains("full") {
                        ServerError::RoomFull(room_id.to_string())
                    } else {
                        ServerError::AlreadyInRoom(room_id.to_string())
                    }
                })?;
        }

        room.to_room_info()
    };

    if let Some(mut player) = state.players.get_mut(player_id) {
        player.room_id = Some(room_id.to_string());
    }

    Ok(info)
}

pub fn leave_room_sync(state: &Arc<ServerState>, player_id: &str) -> Result<(), ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };

    let (room_empty, no_connected_players) = {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        room.remove_participant(player_id);
        let empty = room.is_empty();
        let no_connected = room.connected_player_ids().is_empty();
        if !empty && !no_connected && room.players.is_empty() {
            room.reset_lobby_settings();
        }
        (empty, no_connected)
    };

    if room_empty || no_connected_players {
        state.rooms.remove(&room_id);
        let player_ids = state
            .players
            .iter()
            .filter_map(|entry| {
                entry
                    .value()
                    .room_id
                    .as_deref()
                    .is_some_and(|rid| rid == room_id)
                    .then(|| entry.key().clone())
            })
            .collect::<Vec<_>>();
        for player_id in player_ids {
            if let Some(mut player) = state.players.get_mut(&player_id) {
                player.room_id = None;
            }
        }
    }

    if let Some(mut player) = state.players.get_mut(player_id) {
        player.room_id = None;
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

const MAX_COSMETIC_LEN: usize = 1_500_000;
const COSMETIC_PREFIX: &str = "data:image/webp;base64,";
const MAX_COLOR_LEN: usize = 32;

fn sanitize_cosmetic(value: Option<String>) -> Option<String> {
    value.filter(|s| s.len() <= MAX_COSMETIC_LEN && s.starts_with(COSMETIC_PREFIX))
}

fn sanitize_playmat_settings(settings: &mut PlaymatSettings) {
    settings.color = settings.color.take().filter(|s| s.len() <= MAX_COLOR_LEN);
    settings.border_color = settings
        .border_color
        .take()
        .filter(|s| s.len() <= MAX_COLOR_LEN);
}

pub fn set_deck_selection_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    deck_name: String,
    mut deck: Deck,
    commander_name: Option<String>,
    avatar: Option<String>,
) -> Result<String, ServerError> {
    let room_id = {
        state
            .players
            .get(player_id)
            .and_then(|p| p.room_id.clone())
            .ok_or(ServerError::NotInRoom)?
    };

    deck.playmat = sanitize_cosmetic(deck.playmat.take());
    if let Some(settings) = deck.playmat_settings.as_mut() {
        sanitize_playmat_settings(settings);
    }
    let avatar = sanitize_cosmetic(avatar);

    {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;

        if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        }

        room.set_deck_selection(player_id, deck_name, deck, commander_name, avatar)
            .map_err(|_| ServerError::NotInRoom)?;
    }

    Ok(room_id)
}

pub struct StartedGame {
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
        room.max_players = max_players.clamp(floor, 4);
    }

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

    let (player_order, player_decks, starting_life, room_info) = {
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

        room.status = RoomStatus::InGame;
        let starting_life = match room.format {
            GameFormat::Commander => 40,
            GameFormat::Brawl => 25,
            GameFormat::Standard
            | GameFormat::Pioneer
            | GameFormat::Modern
            | GameFormat::Legacy
            | GameFormat::Vintage
            | GameFormat::Pauper
            | GameFormat::Oathbreaker
            | GameFormat::Draft
            | GameFormat::Sealed => 20,
            GameFormat::Any => unreachable!("Any resolved to concrete format above"),
        };
        let player_order = room.player_usernames();
        let player_decks = room.player_decks();
        room.replay = Some(GameReplayCache::new(
            player_order.clone(),
            player_decks.clone(),
            starting_life,
        ));
        (
            player_order,
            player_decks,
            starting_life,
            room.to_room_info(),
        )
    };

    Ok(StartedGame {
        room_id,
        player_order,
        player_decks,
        starting_life,
        room_info,
    })
}

pub fn end_game_sync(
    state: &Arc<ServerState>,
    player_id: &str,
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
    }

    let (info, notify) =
        reset_room_to_lobby(state, &room_id).ok_or(ServerError::RoomNotFound(room_id.clone()))?;

    Ok((room_id, info, notify))
}

pub fn reset_room_to_lobby(
    state: &Arc<ServerState>,
    room_id: &str,
) -> Option<(RoomInfo, Vec<String>)> {
    let (info, cleared) = {
        let mut room = state.rooms.get_mut(room_id)?;
        let cleared: Vec<String> = room.players.iter().map(|p| p.player_id.clone()).collect();
        room.status = RoomStatus::Lobby;
        room.replay = None;
        room.players.clear();
        room.reset_lobby_settings();
        (room.to_room_info(), cleared)
    };

    let mut notify = Vec::new();
    for pid in cleared {
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
