use std::collections::HashMap;
use std::path::Path;

use manabrew_protocol::game::GameViewDto;
use manabrew_protocol::prompts::{PromptInput, PromptOutput};
use manabrew_protocol::transport::AgentPrompt;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TracePlayer {
    pub username: String,
    #[serde(default)]
    pub deck_name: String,
    #[serde(default)]
    pub commander: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TraceHeader {
    pub game_id: String,
    #[serde(default)]
    pub format: String,
    #[serde(default = "default_starting_life")]
    pub starting_life: i32,
    pub players: Vec<TracePlayer>,
}

fn default_starting_life() -> i32 {
    20
}

pub struct Decision {
    pub state_before: Option<GameViewDto>,
    pub prompt: AgentPrompt,
    pub response: PromptOutput,
}

pub struct Trace {
    pub header: TraceHeader,
    pub decisions: Vec<Decision>,
    pub opening_hands: HashMap<usize, Vec<String>>,
    pub deck_cards: HashMap<usize, Vec<manabrew_game_runtime::deck::DeckCardIdentity>>,
}

pub fn load(path: &Path) -> Result<Trace, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read {path:?}: {e}"))?;
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());

    let header_line = lines.next().ok_or("empty trace")?;
    let header_value: Value =
        serde_json::from_str(header_line).map_err(|e| format!("parse header: {e}"))?;
    let header: TraceHeader =
        serde_json::from_value(header_value).map_err(|e| format!("decode header: {e}"))?;

    let mut last_state: Option<GameViewDto> = None;
    let mut pending_prompt: Option<(AgentPrompt, Option<GameViewDto>)> = None;
    let mut decisions: Vec<Decision> = Vec::new();
    let mut opening_hands: HashMap<usize, Vec<String>> = HashMap::new();
    let mut deck_cards: HashMap<usize, HashMap<String, manabrew_game_runtime::deck::DeckCardIdentity>> =
        HashMap::new();

    for line in lines {
        let frame: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let Some(envelope) = frame.get("envelope") else {
            continue;
        };
        let kind = envelope.get("kind").and_then(Value::as_str).unwrap_or("");
        match kind {
            "state" => {
                let Some(raw) = envelope.pointer("/state/gameView") else {
                    continue;
                };
                let mut view_value = raw.clone();
                normalize_game_view(&mut view_value);
                match serde_json::from_value::<GameViewDto>(view_value) {
                    Ok(view) => {
                        record_visible_cards(&view, &mut deck_cards);
                        last_state = Some(view);
                    }
                    Err(_) => {}
                }
            }
            "prompt" => {
                if let Some(prompt_value) = envelope.get("prompt") {
                    if let Ok(prompt) =
                        serde_json::from_value::<AgentPrompt>(prompt_value.clone())
                    {
                        capture_opening_hand(&prompt, last_state.as_ref(), &mut opening_hands);
                        pending_prompt = Some((prompt, last_state.clone()));
                    }
                }
            }
            "response" => {
                let Some(action_value) = envelope.get("action") else {
                    continue;
                };
                let Ok(response) = serde_json::from_value::<PromptOutput>(action_value.clone())
                else {
                    continue;
                };
                if let Some((prompt, state_before)) = pending_prompt.take() {
                    decisions.push(Decision {
                        state_before,
                        prompt,
                        response,
                    });
                }
            }
            _ => {}
        }
    }

    let deck_cards = deck_cards
        .into_iter()
        .map(|(pid, cards)| (pid, cards.into_values().collect()))
        .collect();

    Ok(Trace {
        header,
        decisions,
        opening_hands,
        deck_cards,
    })
}

fn normalize_game_view(value: &mut Value) {
    if let Some(players) = value.get_mut("players").and_then(Value::as_array_mut) {
        for player in players {
            if let Some(obj) = player.as_object_mut() {
                obj.entry("status").or_insert(Value::String("playing".into()));
            }
        }
    }
}

fn player_index(id: &str) -> Option<usize> {
    id.strip_prefix("player-").and_then(|n| n.parse().ok())
}

fn capture_opening_hand(
    prompt: &AgentPrompt,
    state_before: Option<&GameViewDto>,
    out: &mut HashMap<usize, Vec<String>>,
) {
    let PromptInput::Mulligan(mull) = &prompt.input else {
        return;
    };
    let Some(pid) = player_index(&prompt.deciding_player_id) else {
        return;
    };
    if out.contains_key(&pid) {
        return;
    }
    let Some(state) = state_before else {
        return;
    };
    let id_to_name: HashMap<&str, &str> = state
        .all_zone_cards()
        .map(|c| (c.id.as_str(), c.identity.name.as_str()))
        .collect();
    let names: Vec<String> = mull
        .hand_card_ids
        .iter()
        .filter_map(|id| id_to_name.get(id.as_str()).map(|n| n.to_string()))
        .collect();
    if !names.is_empty() {
        out.insert(pid, names);
    }
}

fn record_visible_cards(
    view: &GameViewDto,
    out: &mut HashMap<usize, HashMap<String, manabrew_game_runtime::deck::DeckCardIdentity>>,
) {
    let mut push = |owner: &str, c: &manabrew_protocol::game::CardDto| {
        let Some(pid) = player_index(owner) else {
            return;
        };
        if c.identity.is_token || c.identity.name.is_empty() {
            return;
        }
        out.entry(pid).or_default().insert(
            c.identity.name.clone(),
            manabrew_game_runtime::deck::DeckCardIdentity {
                name: c.identity.name.clone(),
                set_code: c.identity.set_code.clone(),
                card_number: c.identity.card_number.clone(),
                section: Some("main".to_string()),
            },
        );
    };
    for c in &view.battlefield {
        push(&c.owner_id, c);
    }
    for p in &view.players {
        for c in p.hand.iter().chain(&p.graveyard).chain(&p.exile).chain(&p.command_zone) {
            push(&p.id, c);
        }
    }
}
