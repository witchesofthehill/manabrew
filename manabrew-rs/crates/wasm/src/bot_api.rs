use manabot::{BotAgent, BotConfig, BotState, SimpleAi};
use manabrew_agent_interface::game_view_dto::GameViewDto;
use manabrew_agent_interface::prompt::AgentPrompt;
use manabrew_agent_interface::protocol::ServerMessage;
use wasm_bindgen::prelude::*;

/// Same gate as the UI's `isPromptLoggingEnabled()` (`src/lib/debugPrompts.ts`).
fn bot_logging_enabled() -> bool {
    web_sys::window()
        .and_then(|window| window.local_storage().ok().flatten())
        .and_then(|storage| storage.get_item("manabrew.debugPrompts").ok().flatten())
        .as_deref()
        == Some("1")
}

#[wasm_bindgen]
pub struct WasmManabot {
    agent: SimpleAi,
}

#[wasm_bindgen]
impl WasmManabot {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmManabot {
        WasmManabot {
            agent: SimpleAi::new(),
        }
    }

    pub fn observe_state(&mut self, state_json: &str) -> Result<(), JsValue> {
        let state: serde_json::Value = serde_json::from_str(state_json)
            .map_err(|e| JsValue::from_str(&format!("invalid game state: {e}")))?;
        let view: GameViewDto = serde_json::from_value(
            state
                .get("gameView")
                .cloned()
                .ok_or_else(|| JsValue::from_str("game state has no gameView"))?,
        )
        .map_err(|e| JsValue::from_str(&format!("invalid game view: {e}")))?;
        self.agent.observe(view);
        Ok(())
    }

    pub fn decide(&mut self, prompt_json: &str) -> Result<Option<String>, JsValue> {
        let prompt: AgentPrompt = serde_json::from_str(prompt_json)
            .map_err(|e| JsValue::from_str(&format!("invalid agent prompt: {e}")))?;
        self.agent
            .decide(prompt)
            .map(|action| {
                serde_json::to_string(&action)
                    .map_err(|e| JsValue::from_str(&format!("failed to serialize bot action: {e}")))
            })
            .transpose()
    }
}

impl Default for WasmManabot {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
pub struct WasmBot {
    state: BotState,
}

#[wasm_bindgen]
impl WasmBot {
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<WasmBot, JsValue> {
        let config: BotConfig = serde_json::from_str(config_json)
            .map_err(|e| JsValue::from_str(&format!("invalid bot config: {e}")))?;
        Ok(WasmBot {
            state: BotState::new(config),
        })
    }

    pub fn on_open(&mut self) -> Vec<String> {
        self.state
            .on_open()
            .into_iter()
            .filter_map(|msg| serde_json::to_string(&msg).ok())
            .collect()
    }

    pub fn on_server_message(&mut self, text: &str) -> Vec<String> {
        let message = match serde_json::from_str::<ServerMessage>(text) {
            Ok(message) => message,
            Err(error) => {
                if bot_logging_enabled() {
                    let preview: String = text.chars().take(400).collect();
                    web_sys::console::warn_1(
                        &format!(
                            "[wasm-bot] DROP: server message did not parse: {error}; raw={preview}"
                        )
                        .into(),
                    );
                }
                return Vec::new();
            }
        };
        self.state
            .on_server_message(&message)
            .into_iter()
            .filter_map(|msg| serde_json::to_string(&msg).ok())
            .collect()
    }

    pub fn failure(&self) -> Option<String> {
        self.state.failure().map(str::to_string)
    }
}
