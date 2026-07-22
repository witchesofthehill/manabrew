use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::display::DisplayEvent;
use crate::game::GameViewDto;
use crate::prompts::{PromptInput, PromptOutput};

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum AgentMessage {
    State(StateUpdate),
    Display(DisplayEvent),
    Prompt(AgentPrompt),
    Error(ProtocolError),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "transport/messages.ts")]
pub struct StateUpdate {
    pub game_view: GameViewDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "transport/messages.ts")]
pub enum DirectiveInput {
    Concede,
    Maintenance { edit: MaintenanceEdit },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "transport/messages.ts")]
pub enum MaintenanceEdit {
    SetLife {
        player_id: String,
        life: i32,
    },
    SetPoison {
        player_id: String,
        poison: i32,
    },
    AddCounter {
        card_id: String,
        counter: String,
        amount: i32,
    },
    SetTapped {
        card_id: String,
        tapped: bool,
    },
    MoveCard {
        card_id: String,
        zone: String,
        owner_id: String,
    },
    SetZone {
        player_id: String,
        zone: String,
        card_names: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "transport/messages.ts")]
pub enum ClientToServerMessage {
    Response {
        prompt_id: u32,
        action: PromptOutput,
    },
    Directive {
        directive: DirectiveInput,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "transport/messages.ts")]
pub enum ProtocolErrorCode {
    StalePrompt,
    WrongPlayer,
    WrongPromptType,
    UnknownActionId,
    InvalidShape,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "transport/messages.ts")]
pub struct ProtocolError {
    pub code: ProtocolErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prompt_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "transport/messages.ts")]
pub struct AgentPrompt {
    pub prompt_id: u32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub deciding_player_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_card_id: Option<String>,
    pub input: PromptInput,
}
