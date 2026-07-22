use std::collections::HashMap;
use std::path::Path;

use manabrew_protocol::game::{GameViewDto, ZoneKind};
use manabrew_protocol::prompts::PromptOutput;
use manabrew_protocol::transport::AgentPrompt;
use serde::Deserialize;
use serde_json::Value;

use crate::view;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TracePlayer {
    pub username: String,
    #[serde(default)]
    pub deck_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TraceHeader {
    pub game_id: String,
    #[serde(default)]
    pub room_id: Option<String>,
    #[serde(default)]
    pub ts: Option<String>,
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
    pub starting_player: Option<usize>,
    pub draw_order: HashMap<usize, Vec<String>>,
    pub command_zone: HashMap<usize, Vec<String>>,
}

struct DrawTrack {
    prev_hand: HashMap<String, i32>,
    prev_library: usize,
    done: bool,
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
    let mut starting_player: Option<usize> = None;
    let mut opening_hands: HashMap<usize, Vec<String>> = HashMap::new();
    let mut draw_order: HashMap<usize, Vec<String>> = HashMap::new();
    let mut draw_track: HashMap<usize, DrawTrack> = HashMap::new();
    let mut command_zone: HashMap<usize, Vec<String>> = HashMap::new();
    let mut deck_cards: HashMap<
        usize,
        HashMap<String, manabrew_game_runtime::deck::DeckCardIdentity>,
    > = HashMap::new();

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
                        if view.turn >= 1 {
                            if starting_player.is_none() {
                                starting_player = player_index(&view.active_player_id);
                            }
                            for player in &view.players {
                                if let Some(idx) = player_index(&player.id) {
                                    opening_hands.entry(idx).or_insert_with(|| {
                                        view::zone_cards(&view, &player.id, ZoneKind::Hand)
                                            .map(|c| c.identity.name.clone())
                                            .collect()
                                    });
                                    command_zone.entry(idx).or_insert_with(|| {
                                        view::zone_cards(&view, &player.id, ZoneKind::Command)
                                            .map(|c| c.identity.name.clone())
                                            .collect()
                                    });
                                }
                            }
                        }
                        record_visible_cards(&view, &mut deck_cards);
                        reconstruct_draws(&view, &mut draw_track, &mut draw_order);
                        last_state = Some(view);
                    }
                    Err(_) => {}
                }
            }
            "prompt" => {
                if let Some(prompt_value) = envelope.get("prompt") {
                    if let Ok(prompt) = serde_json::from_value::<AgentPrompt>(prompt_value.clone())
                    {
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
        starting_player,
        draw_order,
        command_zone,
    })
}

fn hand_multiset(view: &GameViewDto, player_id: &str) -> HashMap<String, i32> {
    let mut out: HashMap<String, i32> = HashMap::new();
    for card in view::zone_cards(view, player_id, ZoneKind::Hand) {
        *out.entry(card.identity.name.clone()).or_default() += 1;
    }
    out
}

fn reconstruct_draws(
    view: &GameViewDto,
    track: &mut HashMap<usize, DrawTrack>,
    order: &mut HashMap<usize, Vec<String>>,
) {
    for player in &view.players {
        let Some(idx) = player_index(&player.id) else {
            continue;
        };
        let current_hand = hand_multiset(view, &player.id);
        let current_library = view::library_count(view, &player.id);
        let Some(prev) = track.get_mut(&idx) else {
            track.insert(
                idx,
                DrawTrack {
                    prev_hand: current_hand,
                    prev_library: current_library,
                    done: false,
                },
            );
            continue;
        };
        if !prev.done && view.turn >= 1 {
            if current_library > prev.prev_library {
                prev.done = true;
            } else {
                let removed = prev.prev_library - current_library;
                if removed >= 1 {
                    let added: Vec<String> = current_hand
                        .iter()
                        .filter_map(|(name, count)| {
                            let delta = count - prev.prev_hand.get(name).copied().unwrap_or(0);
                            (delta > 0)
                                .then(|| std::iter::repeat(name.clone()).take(delta as usize))
                        })
                        .flatten()
                        .collect();
                    if removed == 1 && added.len() == 1 {
                        order
                            .entry(idx)
                            .or_default()
                            .push(added.into_iter().next().unwrap());
                    } else {
                        prev.done = true;
                    }
                }
            }
        }
        prev.prev_hand = current_hand;
        prev.prev_library = current_library;
    }
}

fn normalize_game_view(value: &mut Value) {
    if let Some(players) = value.get_mut("players").and_then(Value::as_array_mut) {
        for player in players {
            if let Some(obj) = player.as_object_mut() {
                obj.entry("status")
                    .or_insert(Value::String("playing".into()));
            }
        }
    }
}

fn player_index(id: &str) -> Option<usize> {
    id.strip_prefix("player-").and_then(|n| n.parse().ok())
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
    for zone in &view.zones {
        if !matches!(
            zone.zone,
            ZoneKind::Battlefield
                | ZoneKind::Hand
                | ZoneKind::Graveyard
                | ZoneKind::Exile
                | ZoneKind::Command
        ) {
            continue;
        }
        for c in zone.cards.iter().filter_map(view::visible) {
            if zone.zone == ZoneKind::Battlefield {
                push(&c.owner_id, c);
            } else {
                push(&zone.owner_id, c);
            }
        }
    }
}
