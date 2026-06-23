use manabrew_agent_interface::deck_dto::Deck;
use manabrew_agent_interface::ids_codec::player_slot;
use manabrew_agent_interface::prompt::AgentPrompt;
use manabrew_agent_interface::protocol::{ClientMessage, ServerMessage, StateEnvelope};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{debug, warn};

use crate::agent::{AgentKind, BotAgent};

#[cfg(target_arch = "wasm32")]
fn bot_logging_enabled() -> bool {
    web_sys::window()
        .and_then(|window| window.local_storage().ok().flatten())
        .and_then(|storage| storage.get_item("manabrew.debugPrompts").ok().flatten())
        .as_deref()
        == Some("1")
}

fn bot_log(msg: &str) {
    #[cfg(target_arch = "wasm32")]
    if bot_logging_enabled() {
        web_sys::console::log_1(&format!("[wasm-bot] {msg}").into());
    }
    #[cfg(not(target_arch = "wasm32"))]
    tracing::debug!(target: "wasm-bot", "{msg}");
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotConfig {
    pub username: String,
    pub password: String,
    pub room_id: String,
    #[serde(default)]
    pub room_password: Option<String>,
    pub deck_name: String,
    pub deck: Deck,
    #[serde(default)]
    pub commander_name: Option<String>,
    /// Which built-in AI to plug into the bot. Defaults to `Simple`.
    #[serde(default)]
    pub agent: AgentKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Phase {
    PendingOpen,
    AwaitingAuthResult,
    AwaitingRoomJoin,
    AwaitingGameStart,
    Playing { player_slot: String },
    Failed,
}

pub struct BotState {
    config: BotConfig,
    agent: Box<dyn BotAgent + Send>,
    phase: Phase,
    failure: Option<String>,
}

impl BotState {
    pub fn new(config: BotConfig) -> Self {
        let agent = config.agent.build();
        Self {
            config,
            agent,
            phase: Phase::PendingOpen,
            failure: None,
        }
    }

    pub fn on_open(&mut self) -> Vec<ClientMessage> {
        if self.phase != Phase::PendingOpen {
            return Vec::new();
        }
        self.phase = Phase::AwaitingAuthResult;
        vec![ClientMessage::Authenticate {
            username: self.config.username.clone(),
            password: self.config.password.clone(),
            service: true,
        }]
    }

    pub fn on_server_message(&mut self, message: &ServerMessage) -> Vec<ClientMessage> {
        match (&self.phase, message) {
            (Phase::AwaitingAuthResult, ServerMessage::AuthResult { success, error, .. }) => {
                if *success {
                    self.phase = Phase::AwaitingRoomJoin;
                    vec![ClientMessage::JoinRoom {
                        room_id: self.config.room_id.clone(),
                        observe: false,
                        as_bot: true,
                        password: self.config.room_password.clone(),
                    }]
                } else {
                    self.fail(format!("authentication failed: {:?}", error))
                }
            }
            (Phase::AwaitingRoomJoin, ServerMessage::RoomUpdate { room })
                if room.room_id == self.config.room_id
                    && room
                        .players
                        .iter()
                        .any(|player| player.username == self.config.username) =>
            {
                self.phase = Phase::AwaitingGameStart;
                vec![
                    ClientMessage::SetDeckSelection {
                        deck_name: self.config.deck_name.clone(),
                        deck: self.config.deck.clone(),
                        commander_name: self.config.commander_name.clone(),
                        avatar: None,
                    },
                    ClientMessage::SetReady { ready: true },
                ]
            }
            (Phase::AwaitingRoomJoin, ServerMessage::Error { message, .. }) => {
                self.fail(format!("room join failed: {}", message))
            }
            (Phase::AwaitingGameStart, ServerMessage::GameStarted { player_order, .. }) => {
                match player_order
                    .iter()
                    .position(|player| player == &self.config.username)
                    .map(player_slot)
                {
                    Some(slot) => {
                        debug!(player_slot = %slot, "bot entering Playing phase");
                        self.phase = Phase::Playing { player_slot: slot };
                        Vec::new()
                    }
                    None => self.fail(format!(
                        "bot {} not present in player order {:?}",
                        self.config.username, player_order
                    )),
                }
            }
            (Phase::Playing { player_slot }, ServerMessage::StateUpdate { state, .. }) => {
                let slot = player_slot.clone();
                self.handle_envelope(&slot, state)
            }
            _ => Vec::new(),
        }
    }

    pub fn failure(&self) -> Option<&str> {
        self.failure.as_deref()
    }

    fn fail(&mut self, reason: String) -> Vec<ClientMessage> {
        warn!(reason = %reason, "bot lifecycle failed");
        self.failure = Some(reason);
        self.phase = Phase::Failed;
        Vec::new()
    }

    fn handle_envelope(
        &mut self,
        player_slot: &str,
        state: &serde_json::Value,
    ) -> Vec<ClientMessage> {
        let envelope: StateEnvelope = match serde_json::from_value(state.clone()) {
            Ok(envelope) => envelope,
            Err(error) => {
                bot_log(&format!(
                    "DROP: state envelope did not parse: {error}; raw={state}"
                ));
                return Vec::new();
            }
        };
        let StateEnvelope::Prompt { for_player, prompt } = envelope else {
            return Vec::new();
        };
        let prompt_type = prompt
            .get("type")
            .and_then(serde_json::Value::as_str)
            .or_else(|| prompt.get("kind").and_then(serde_json::Value::as_str))
            .unwrap_or("?")
            .to_string();
        bot_log(&format!(
            "recv prompt for={for_player} (self={player_slot}) type={prompt_type} payload={prompt}"
        ));
        if for_player != player_slot {
            bot_log(&format!("ignore: prompt for other slot ({for_player})"));
            return Vec::new();
        }

        // Java-side prompts can arrive in shapes that don't deserialize as
        // `AgentPrompt`; passing priority is always a safe default in that case.
        let action_value =
            if prompt.get("kind").and_then(serde_json::Value::as_str) == Some("priority") {
                bot_log("decide: raw priority -> pass");
                json!({ "kind": "pass" })
            } else {
                let parsed: AgentPrompt = match serde_json::from_value(prompt) {
                    Ok(p) => p,
                    Err(error) => {
                        bot_log(&format!(
                            "DROP: prompt did not parse as AgentPrompt: {error}"
                        ));
                        return Vec::new();
                    }
                };
                let Some(action) = self.agent.decide(parsed) else {
                    bot_log(&format!("DROP: agent returned no action for {prompt_type}"));
                    return Vec::new();
                };
                match serde_json::to_value(action) {
                    Ok(v) => {
                        bot_log(&format!("decide: {prompt_type} -> {v}"));
                        v
                    }
                    Err(error) => {
                        bot_log(&format!("DROP: action did not serialize: {error}"));
                        return Vec::new();
                    }
                }
            };

        let response = StateEnvelope::Response {
            from_player: for_player,
            action: action_value,
        };
        match serde_json::to_value(response) {
            Ok(state) => {
                bot_log("send: broadcasting response");
                vec![ClientMessage::BroadcastState { state }]
            }
            Err(error) => {
                bot_log(&format!(
                    "DROP: response envelope did not serialize: {error}"
                ));
                Vec::new()
            }
        }
    }
}
