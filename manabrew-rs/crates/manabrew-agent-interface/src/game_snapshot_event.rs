use serde::{Deserialize, Serialize};

use crate::game_view_dto::GameViewDto;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSnapshotEventDto {
    pub checkpoint_id: u64,
    pub label: String,
    pub game_view: GameViewDto,
    pub timestamp_ms: u64,
}

impl GameSnapshotEventDto {
    pub fn new(checkpoint_id: u64, label: impl Into<String>, game_view: GameViewDto) -> Self {
        Self {
            checkpoint_id,
            label: label.into(),
            game_view,
            timestamp_ms: now_timestamp_ms(),
        }
    }
}

fn now_timestamp_ms() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
    #[cfg(target_arch = "wasm32")]
    {
        0
    }
}
