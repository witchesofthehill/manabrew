use std::time::Duration;

use manabrew_agent_interface::agent_impl::Responder;
use manabrew_agent_interface::game_log_event::GameLogEntryDto;
use manabrew_agent_interface::game_snapshot_event::GameSnapshotEventDto;
use manabrew_agent_interface::prompt::{
    AgentMessage, AgentPrompt, ChooseActionDecision, ChooseActionOutput, PromptOutput,
};

use js_sys::{Int32Array, SharedArrayBuffer, Uint8Array};
use wasm_bindgen::prelude::*;
use web_sys::DedicatedWorkerGlobalScope;

const SIGNAL_IDLE: i32 = 0;
const SIGNAL_PROMPT_READY: i32 = 1;
const SIGNAL_RESPONSE_READY: i32 = 2;
const SIGNAL_PROMPT_ACKNOWLEDGED: i32 = 3;

/// Header size in bytes (2 x i32 = 8 bytes for signal + length).
const HEADER_BYTES: u32 = 8;
/// Default buffer size: 256KB should handle even complex game views.
pub const DEFAULT_BUFFER_SIZE: u32 = 256 * 1024;
/// Recv timeout for a relayed remote seat, matching `MpscTransport::new_relay`.
const RELAY_RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);

fn post_worker_event(event: &str, payload: &JsValue) {
    let Ok(global) = js_sys::global().dyn_into::<DedicatedWorkerGlobalScope>() else {
        return;
    };
    let msg = js_sys::Object::new();
    let _ = js_sys::Reflect::set(
        &msg,
        &JsValue::from_str("type"),
        &JsValue::from_str("event"),
    );
    let _ = js_sys::Reflect::set(&msg, &JsValue::from_str("event"), &JsValue::from_str(event));
    let _ = js_sys::Reflect::set(&msg, &JsValue::from_str("payload"), payload);
    let _ = global.post_message(&msg);
}

pub struct WasmTransport {
    signal: Int32Array,
    data: Uint8Array,
    response_timeout: Option<Duration>,
    emit_side_channels: bool,
}

impl WasmTransport {
    fn from_sab(
        sab: &SharedArrayBuffer,
        response_timeout: Option<Duration>,
        emit_side_channels: bool,
    ) -> Self {
        let signal = Int32Array::new_with_byte_offset_and_length(
            &JsValue::from(sab.clone()),
            0,
            2, // 2 i32 slots: signal + length
        );
        let data = Uint8Array::new_with_byte_offset_and_length(
            &JsValue::from(sab.clone()),
            HEADER_BYTES,
            sab.byte_length() - HEADER_BYTES,
        );
        Self {
            signal,
            data,
            response_timeout,
            emit_side_channels,
        }
    }

    pub fn new(sab: &SharedArrayBuffer) -> Self {
        Self::from_sab(sab, None, true)
    }

    pub fn new_relay(sab: &SharedArrayBuffer) -> Self {
        Self::from_sab(sab, Some(RELAY_RESPONSE_TIMEOUT), false)
    }

    #[must_use]
    fn write_data(&self, json_bytes: &[u8]) -> bool {
        if json_bytes.len() as u32 > self.data.length() {
            web_sys::console::error_1(
                &format!(
                    "[WasmTransport] payload of {} bytes exceeds SAB capacity {} — dropping",
                    json_bytes.len(),
                    self.data.length()
                )
                .into(),
            );
            return false;
        }
        let len = json_bytes.len() as i32;
        // Set length in slot 1
        js_sys::Atomics::store(&self.signal, 1, len).unwrap_or(0);
        // Copy JSON into data region
        let js_array = Uint8Array::new_with_length(json_bytes.len() as u32);
        js_array.copy_from(json_bytes);
        self.data.set(&js_array, 0);
        true
    }

    fn read_data(&self) -> Vec<u8> {
        let len = js_sys::Atomics::load(&self.signal, 1).unwrap_or(0) as usize;
        let mut buf = vec![0u8; len];
        self.data.slice(0, len as u32).copy_to(&mut buf);
        buf
    }

    fn wait_until_prompt_slot_available(&self) {
        loop {
            let current = js_sys::Atomics::load(&self.signal, 0).unwrap_or(0);
            if matches!(
                current,
                SIGNAL_IDLE | SIGNAL_PROMPT_ACKNOWLEDGED | SIGNAL_RESPONSE_READY
            ) {
                return;
            }
            let _ = js_sys::Atomics::wait(&self.signal, 0, current);
        }
    }
}

impl WasmTransport {
    fn send(&self, message: &AgentMessage) {
        self.wait_until_prompt_slot_available();
        let tagged = match message {
            AgentMessage::State(state) => serde_json::json!({ "kind": "state", "state": state }),
            AgentMessage::Display(event) => {
                serde_json::json!({ "kind": "display", "event": event })
            }
            AgentMessage::Prompt(prompt) => {
                serde_json::json!({ "kind": "prompt", "prompt": prompt })
            }
        };
        let json = serde_json::to_vec(&tagged).unwrap_or_default();
        if !self.write_data(&json) {
            // The prompt didn't fit the SAB.
            let payload = js_sys::Object::new();
            let _ = js_sys::Reflect::set(
                &payload,
                &JsValue::from_str("reason"),
                &JsValue::from_str("prompt_too_large"),
            );
            let _ = js_sys::Reflect::set(
                &payload,
                &JsValue::from_str("message"),
                &JsValue::from_str("engine prompt exceeded the shared buffer capacity"),
            );
            post_worker_event("game:forced_end", &payload);
            return;
        }
        js_sys::Atomics::store(&self.signal, 0, SIGNAL_PROMPT_READY).unwrap_or(0);
        js_sys::Atomics::notify(&self.signal, 0).unwrap_or(0);
    }

    fn recv(&self) -> PromptOutput {
        loop {
            let current = js_sys::Atomics::load(&self.signal, 0).unwrap_or(0);
            if current == SIGNAL_RESPONSE_READY {
                break;
            }
            match self.response_timeout {
                Some(timeout) => {
                    let timed_out = js_sys::Atomics::wait_with_timeout(
                        &self.signal,
                        0,
                        current,
                        timeout.as_millis() as f64,
                    )
                    .ok()
                    .and_then(|v| v.as_string())
                    .as_deref()
                        == Some("timed-out");
                    // Re-check before giving up — the response may have landed
                    // between the load above and the wait. A genuine timeout
                    // falls back to a pass, matching the relay/AI mpsc seats.
                    if timed_out
                        && js_sys::Atomics::load(&self.signal, 0).unwrap_or(0)
                            != SIGNAL_RESPONSE_READY
                    {
                        // Reset to idle so the next prompt starts from a clean
                        // slot. A late response (signal flipped to
                        // RESPONSE_READY after we give up) is tolerated by
                        // wait_until_prompt_slot_available, which overwrites it.
                        js_sys::Atomics::store(&self.signal, 0, SIGNAL_IDLE).unwrap_or(0);
                        js_sys::Atomics::notify(&self.signal, 0).unwrap_or(0);
                        return PromptOutput::ChooseAction(
                            ChooseActionOutput::ChooseActionDecision(ChooseActionDecision::Pass {
                                until_phase: None,
                            }),
                        );
                    }
                }
                None => {
                    let _ = js_sys::Atomics::wait(&self.signal, 0, current);
                }
            }
        }

        let json_bytes = self.read_data();

        js_sys::Atomics::store(&self.signal, 0, SIGNAL_IDLE).unwrap_or(0);
        js_sys::Atomics::notify(&self.signal, 0).unwrap_or(0);

        serde_json::from_slice(&json_bytes).unwrap_or(PromptOutput::ChooseAction(
            ChooseActionOutput::ChooseActionDecision(ChooseActionDecision::Pass {
                until_phase: None,
            }),
        ))
    }
}

impl Responder for WasmTransport {
    fn present(&mut self, message: &AgentMessage) {
        self.send(message);
    }

    fn respond(&mut self, _prompt: AgentPrompt) -> PromptOutput {
        self.recv()
    }

    fn await_ack(&mut self) {
        let _ = self.recv();
    }

    fn send_log(&mut self, entry: GameLogEntryDto) {
        if !self.emit_side_channels {
            return;
        }
        if let Ok(payload) = serde_wasm_bindgen::to_value(&entry) {
            post_worker_event("game:log", &payload);
        }
    }

    fn send_snapshot(&mut self, snapshot: GameSnapshotEventDto) {
        if !self.emit_side_channels {
            return;
        }
        if let Ok(payload) = serde_wasm_bindgen::to_value(&snapshot) {
            post_worker_event("game:snapshot", &payload);
        }
    }
}
