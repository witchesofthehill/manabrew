use manabot::{BotConfig, BotState};
use manabrew_agent_interface::protocol::ServerMessage;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmBot {
    state: BotState,
}

#[wasm_bindgen]
impl WasmBot {
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<WasmBot, JsValue> {
        let config: BotConfig = serde_json::from_str(config_json)
            .map_err(|e| JsValue::from_str(&format!("invalid bot config: {}", e)))?;
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
        let Ok(message) = serde_json::from_str::<ServerMessage>(text) else {
            return Vec::new();
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
