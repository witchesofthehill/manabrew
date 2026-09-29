use std::collections::{HashMap, HashSet};
use std::io::BufRead;

use manabrew_protocol::transport::{AgentPrompt, ClientToServerMessage, StateUpdate};
use serde_json::Value;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("expected capture path")?;
    let reader: Box<dyn BufRead> = if path == "-" {
        Box::new(std::io::stdin().lock())
    } else {
        Box::new(std::io::BufReader::new(std::fs::File::open(path)?))
    };
    let mut prompts = HashMap::<(u64, u32), AgentPrompt>::new();
    let mut requests = HashMap::<(u64, u64), Value>::new();
    let mut accepted = 0;
    let mut rejected = 0;
    let mut accepted_ids = HashSet::new();
    let mut views = Vec::new();
    let mut states = 0;
    let mut ended = 0;
    for line in reader.lines() {
        let row: Value = serde_json::from_str(&line?)?;
        let seat = row["seat"].as_u64().ok_or("missing seat")?;
        let message = &row["message"];
        if row["direction"] == "request" && message["method"] == "respond" {
            requests.insert(
                (seat, message["id"].as_u64().ok_or("missing request id")?),
                message["params"].clone(),
            );
        } else if row["direction"] == "event" && message["method"] == "state" {
            let update: StateUpdate = serde_json::from_value(message["params"].clone())?;
            for zone in &update.game_view.zones {
                if zone.cards.len() > zone.count {
                    return Err("visible cards exceed zone count".into());
                }
                if zone.zone == manabrew_protocol::game::ZoneKind::Library && !zone.cards.is_empty()
                {
                    return Err("unexpected library disclosure in audit scenario".into());
                }
            }
            views.push((seat, update.game_view));
            states += 1;
        } else if row["direction"] == "event" && message["method"] == "gameEnded" {
            ended += 1;
        } else if row["direction"] == "event" && message["method"] == "prompt" {
            let prompt: AgentPrompt = serde_json::from_value(message["params"].clone())?;
            if prompts.insert((seat, prompt.prompt_id), prompt).is_some() {
                return Err("reused prompt id".into());
            }
        } else if row["direction"] == "event" && message.get("error").is_some() {
            let id = message["id"].as_u64().ok_or("missing error id")?;
            if let Some(params) = requests.remove(&(seat, id)) {
                if message["error"]["message"] == "StalePrompt" {
                    continue;
                }
                let decoded = serde_json::from_value::<ClientToServerMessage>(params);
                if let Ok(ClientToServerMessage::Response { prompt_id, action }) = decoded {
                    let prompt = prompts
                        .get(&(seat, prompt_id))
                        .ok_or("unknown rejected prompt")?;
                    if prompt.input.validate_response(&action).is_ok() {
                        return Err(format!(
                            "engine rejected a response accepted by the shared contract: {}",
                            message["error"]
                        )
                        .into());
                    }
                }
                rejected += 1;
            }
        } else if row["direction"] == "event" && message.get("result").is_some() {
            let id = message["id"].as_u64().ok_or("missing result id")?;
            if let Some(params) = requests.remove(&(seat, id)) {
                let response: ClientToServerMessage = serde_json::from_value(params)?;
                let ClientToServerMessage::Response { prompt_id, action } = response else {
                    return Err("expected response".into());
                };
                let prompt = prompts.get(&(seat, prompt_id)).ok_or("unknown prompt")?;
                prompt
                    .input
                    .validate_response(&action)
                    .map_err(|error| format!("invalid response: {error:?}"))?;
                if !accepted_ids.insert((seat, prompt_id)) {
                    return Err("duplicate accepted response".into());
                }
                accepted += 1;
            }
        }
    }
    for (seat, view) in views {
        let own_id = &prompts
            .iter()
            .find(|((owner, _), _)| *owner == seat)
            .ok_or("seat has states but no prompt")?
            .1
            .deciding_player_id;
        for zone in view.zones {
            if zone.zone == manabrew_protocol::game::ZoneKind::Hand
                && zone.owner_id != *own_id
                && !zone.cards.is_empty()
            {
                return Err("opponent hand disclosed in audit scenario".into());
            }
        }
    }
    if prompts.is_empty() || accepted == 0 {
        return Err("capture contains no completed prompt roundtrip".into());
    }
    println!(
        "Validated {} prompts, {accepted} accepted responses, {rejected} contract rejections, {states} states and {ended} game results",
        prompts.len()
    );
    Ok(())
}
