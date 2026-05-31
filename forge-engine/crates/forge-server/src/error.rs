use std::fmt;

#[derive(Debug)]
pub enum ServerError {
    AuthFailed(String),
    AuthTimeout,
    RoomNotFound(String),
    RoomFull(String),
    NotInRoom,
    NotHost,
    PlayersNotReady,
    DeckNotSelected,
    AlreadyInRoom(String),
    GameAlreadyStarted,
    GameNotInProgress,
    FormatNotChosen,
    InvalidDraftConfig(String),
    DuplicateUsername(String),
    WebSocket(Box<tokio_tungstenite::tungstenite::Error>),
    Serde(serde_json::Error),
}

impl fmt::Display for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AuthFailed(msg) => write!(f, "Authentication failed: {}", msg),
            Self::AuthTimeout => write!(f, "Authentication timed out"),
            Self::RoomNotFound(id) => write!(f, "Room not found: {}", id),
            Self::RoomFull(id) => write!(f, "Room is full: {}", id),
            Self::NotInRoom => write!(f, "You are not in a room"),
            Self::NotHost => write!(f, "Only the host can do that"),
            Self::PlayersNotReady => write!(f, "Not all players are ready"),
            Self::DeckNotSelected => write!(f, "You must select a deck before getting ready"),
            Self::GameAlreadyStarted => write!(f, "Game has already started"),
            Self::GameNotInProgress => write!(f, "No game is in progress"),
            Self::FormatNotChosen => write!(f, "A format must be chosen before starting"),
            Self::InvalidDraftConfig(msg) => write!(f, "Invalid draft config: {}", msg),
            Self::AlreadyInRoom(id) => write!(f, "Already in room: {}", id),
            Self::DuplicateUsername(name) => write!(f, "Username already taken: {}", name),
            Self::WebSocket(e) => write!(f, "WebSocket error: {}", e),
            Self::Serde(e) => write!(f, "Serialization error: {}", e),
        }
    }
}

impl std::error::Error for ServerError {}

impl ServerError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::AuthFailed(_) => "auth_failed",
            Self::AuthTimeout => "auth_timeout",
            Self::RoomNotFound(_) => "room_not_found",
            Self::RoomFull(_) => "room_full",
            Self::NotInRoom => "not_in_room",
            Self::NotHost => "not_host",
            Self::PlayersNotReady => "players_not_ready",
            Self::DeckNotSelected => "deck_not_selected",
            Self::GameAlreadyStarted => "game_already_started",
            Self::GameNotInProgress => "game_not_in_progress",
            Self::FormatNotChosen => "format_not_chosen",
            Self::InvalidDraftConfig(_) => "invalid_draft_config",
            Self::AlreadyInRoom(_) => "already_in_room",
            Self::DuplicateUsername(_) => "duplicate_username",
            Self::WebSocket(_) => "websocket_error",
            Self::Serde(_) => "parse_error",
        }
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for ServerError {
    fn from(e: tokio_tungstenite::tungstenite::Error) -> Self {
        Self::WebSocket(Box::new(e))
    }
}

impl From<serde_json::Error> for ServerError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serde(e)
    }
}
