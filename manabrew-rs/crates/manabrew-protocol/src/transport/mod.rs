use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::{CardDto, GameViewDto};
use crate::prompts::{PromptInput, PromptOutput};

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum AgentMessage {
    State(StateUpdate),
    Prompt(AgentPrompt),
    Directive(EngineDirective),
    Error(ProtocolError),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "transport/messages.ts")]
pub struct StateUpdate {
    pub game_view: GameViewDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "transport/messages.ts")]
pub enum DirectiveInput {
    Concede,
    RequestRestore { checkpoint_id: u32 },
    RestoreVote { vote_id: u32, accept: bool },
    SetSnapshotRecording { enabled: bool },
    StartRecording,
    StopRecording,
    RequestRepeat { iterations: u32 },
    RepeatVote { vote_id: u32, accept: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "transport/messages.ts")]
pub enum EngineDirective {
    Recording { status: RecordingStatus },
    RepeatVote { vote: RepeatVoteDto },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "transport/messages.ts")]
pub enum RecordingStatus {
    Off,
    Recording,
    Ready { actions: Vec<String> },
    Failed { reason: RecordingFailure },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "transport/messages.ts")]
pub enum RecordingFailure {
    NotAtPriority,
    UnsupportedPrompt,
    OpponentActed,
    Empty,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "transport/messages.ts")]
pub struct RepeatVoteDto {
    pub vote_id: u32,
    pub requested_by_player_id: String,
    pub iterations: u32,
    pub actions: Vec<String>,
    pub awaiting_player_ids: Vec<String>,
    pub status: RepeatVoteStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "transport/messages.ts")]
pub enum RepeatVoteStatus {
    Pending,
    Running { completed: u32 },
    Declined { player_id: String },
    Cancelled,
    Applied,
    Failed { iteration: u32 },
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
    CancelNotAllowed,
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
    pub source_card: Option<CardDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_ability_text: Option<String>,
    pub input: PromptInput,
}
