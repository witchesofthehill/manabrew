use serde_json::Value;

use manabrew_agent_interface::ids_codec::parse_player_slot;
use manabrew_agent_interface::prompt::PromptOutput;
use manabrew_agent_interface::protocol::StateEnvelope;

pub fn wrap_broadcast_state(state: Value) -> String {
    serde_json::json!({
        "type": "BroadcastState",
        "state": state,
    })
    .to_string()
}

pub fn decode_relay_response(state: &Value) -> Result<(usize, PromptOutput), String> {
    let envelope: StateEnvelope = serde_json::from_value(state.clone())
        .map_err(|error| format!("Invalid state envelope: {}", error))?;
    let StateEnvelope::Response {
        from_player,
        action,
    } = envelope
    else {
        return Err(format!(
            "Unsupported relay kind: expected response, got {:?}",
            kind_label(state)
        ));
    };
    let player_index = parse_player_slot(&from_player)
        .ok_or_else(|| format!("Invalid fromPlayer: {}", from_player))?;
    let action: PromptOutput =
        serde_json::from_value(action).map_err(|e| format!("Invalid action: {}", e))?;
    Ok((player_index, action))
}

fn kind_label(state: &Value) -> &str {
    state
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("<missing>")
}
