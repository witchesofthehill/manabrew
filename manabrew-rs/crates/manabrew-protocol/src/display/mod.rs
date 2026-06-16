use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "display/index.ts")]
pub enum DisplayEvent {
    CardPlayed {
        card_id: String,
        card_name: String,
        set_code: String,
        player_id: String,
    },
    TurnChanged {
        active_player_id: String,
        active_player_name: String,
        turn_number: u32,
    },
}
