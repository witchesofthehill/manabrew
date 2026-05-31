use std::sync::Arc;

use crate::error::ServerError;
use crate::protocol::{
    DraftConfig, EngineKind, GameFormat, PlayerDeckInfo, RoomInfo, RoomStatus, SealedConfig,
};
use crate::room::Room;
use crate::state::ServerState;
use forge_agent_interface::deck_dto::Deck;

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

        if observe {
            room.add_observer(player_id.to_string(), username)
                .map_err(|_| ServerError::AlreadyInRoom(room_id.to_string()))?;
        } else {
            room.add_player(player_id.to_string(), username)
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
        (room.is_empty(), room.connected_player_ids().is_empty())
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

        let format_requires_deck = !matches!(
            room.format,
            GameFormat::Any | GameFormat::Draft | GameFormat::Sealed
        );
        if ready && format_requires_deck && !room.has_selected_deck(player_id) {
            return Err(ServerError::DeckNotSelected);
        }

        room.set_ready(player_id, ready)
            .map_err(|_| ServerError::NotInRoom)?;
    }

    Ok(room_id)
}

pub fn set_deck_selection_sync(
    state: &Arc<ServerState>,
    player_id: &str,
    deck_name: String,
    deck: Deck,
    commander_name: Option<String>,
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

        room.set_deck_selection(player_id, deck_name, deck, commander_name)
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

        if !room.is_host(player_id) {
            return Err(ServerError::NotHost);
        }

        if room.status != RoomStatus::Lobby {
            return Err(ServerError::GameAlreadyStarted);
        }

        room.format = format;
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

        if matches!(room.format, GameFormat::Draft) && room.draft_config.is_none() {
            return Err(ServerError::FormatNotChosen);
        }
        if matches!(room.format, GameFormat::Sealed) && room.sealed_config.is_none() {
            return Err(ServerError::FormatNotChosen);
        }

        if !room.all_ready() {
            return Err(ServerError::PlayersNotReady);
        }

        if !matches!(room.format, GameFormat::Draft | GameFormat::Sealed)
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
        (
            room.player_usernames(),
            room.player_decks(),
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
) -> Result<(String, RoomInfo), ServerError> {
    let room_id = state
        .players
        .get(player_id)
        .and_then(|p| p.room_id.clone())
        .ok_or(ServerError::NotInRoom)?;

    let (info, cleared) = {
        let mut room = state
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| ServerError::RoomNotFound(room_id.clone()))?;
        if !room.is_host(player_id) {
            return Err(ServerError::NotHost);
        }
        if room.status != RoomStatus::InGame {
            return Err(ServerError::GameNotInProgress);
        }
        let cleared: Vec<String> = room.players.iter().map(|p| p.player_id.clone()).collect();
        room.status = RoomStatus::Lobby;
        room.players.clear();
        (room.to_room_info(), cleared)
    };

    for pid in cleared {
        match state.players.get(&pid).map(|p| p.disconnected_at.is_some()) {
            Some(true) => {
                state.players.remove(&pid);
            }
            Some(false) => {
                if let Some(mut p) = state.players.get_mut(&pid) {
                    p.room_id = None;
                }
            }
            None => {}
        }
    }

    Ok((room_id, info))
}
