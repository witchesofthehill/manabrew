use manabrew_agent_interface::game_view_dto::GameViewDto;
use manabrew_agent_interface::ids_codec::player_slot;
use manabrew_agent_interface::prompt::AgentPrompt;
use manabrew_agent_interface::protocol::{
    identity_token, ClientMessage, ClientPlatform, IdentityProof, RoomStatus, ServerMessage,
    StateEnvelope,
};
use manabrew_protocol::deck_dto::Deck;
use manabrew_relay_protocol::state_delta;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
    #[serde(default)]
    pub answer_delay_ms: Option<u64>,
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

/// Last full state, the base for the next `stateDelta`.
struct Board {
    state: Value,
    fingerprint: Option<String>,
    /// `forPlayer` was our slot, not the observer broadcast.
    addressed: bool,
}

pub struct BotState {
    config: BotConfig,
    agent: Box<dyn BotAgent + Send>,
    phase: Phase,
    failure: Option<String>,
    board: Option<Board>,
    resync_pending: bool,
}

fn unix_now() -> i64 {
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() / 1000.0) as i64
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs() as i64)
            .unwrap_or_default()
    }
}

fn self_minted_identity_token(kind: &str, handle: &str) -> String {
    identity_token::mint_unsigned(
        &format!("{kind}:{handle}"),
        handle,
        unix_now(),
        24 * 60 * 60,
    )
}

impl BotState {
    pub fn answer_delay(&self) -> Option<std::time::Duration> {
        self.config
            .answer_delay_ms
            .map(std::time::Duration::from_millis)
    }

    pub fn new(config: BotConfig) -> Self {
        let agent = config.agent.build();
        Self::with_agent(config, agent)
    }

    /// Custom agent; `config.agent` is ignored.
    pub fn with_agent(config: BotConfig, agent: Box<dyn BotAgent + Send>) -> Self {
        Self {
            config,
            agent,
            phase: Phase::PendingOpen,
            failure: None,
            board: None,
            resync_pending: false,
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
            identity: Some(IdentityProof {
                token: Some(self_minted_identity_token("bot", &self.config.username)),
                device: None,
            }),
            client_platform: ClientPlatform::Unknown,
            client_version: None,
        }]
    }

    pub fn on_server_message(&mut self, message: &ServerMessage) -> Vec<ClientMessage> {
        match (&self.phase, message) {
            (
                Phase::AwaitingAuthResult,
                ServerMessage::AuthResult {
                    success,
                    reconnected,
                    error,
                    ..
                },
            ) => {
                if *success {
                    if *reconnected == Some(true) {
                        self.phase = Phase::AwaitingGameStart;
                        vec![ClientMessage::RequestResync]
                    } else {
                        self.phase = Phase::AwaitingRoomJoin;
                        vec![ClientMessage::JoinRoom {
                            room_id: self.config.room_id.clone(),
                            observe: false,
                            as_bot: true,
                            password: self.config.room_password.clone(),
                        }]
                    }
                } else {
                    self.fail(format!("authentication failed: {error:?}"))
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
                if room.status == RoomStatus::InGame {
                    vec![ClientMessage::RequestResync]
                } else {
                    vec![
                        ClientMessage::SetDeckSelection {
                            deck_name: self.config.deck_name.clone(),
                            deck: self.config.deck.clone(),
                            published_deck_id: None,
                            commander_name: self.config.commander_name.clone(),
                            avatar_url: None,
                        },
                        ClientMessage::SetReady { ready: true },
                    ]
                }
            }
            (Phase::AwaitingRoomJoin, ServerMessage::Error { message, .. }) => {
                self.fail(format!("room join failed: {message}"))
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

    /// `Some(addressed)` if this state is ours to keep. The observer broadcast
    /// (no `forPlayer`, all hands hidden) only counts until an addressed state
    /// arrives (#959).
    fn accepts_board(&self, player_slot: &str, for_player: Option<&str>) -> Option<bool> {
        match for_player {
            Some(slot) if slot == player_slot => Some(true),
            Some(other) => {
                bot_log(&format!("ignore: state for other slot ({other})"));
                None
            }
            None if self.board.as_ref().is_some_and(|board| board.addressed) => {
                bot_log("ignore: observer state, seat already has its own view");
                None
            }
            None => Some(false),
        }
    }

    fn observe_board(&mut self, state: Value, fingerprint: Option<String>, addressed: bool) {
        if let Some(view) = state
            .get("gameView")
            .cloned()
            .and_then(|view| serde_json::from_value::<GameViewDto>(view).ok())
        {
            self.agent.observe(view);
        }
        self.board = Some(Board {
            state,
            fingerprint,
            addressed,
        });
    }

    /// Patch base does not match what we hold: ask for a full state, once.
    fn request_resync(&mut self, base: &str) -> Vec<ClientMessage> {
        let held = self
            .board
            .as_ref()
            .and_then(|board| board.fingerprint.as_deref())
            .unwrap_or("none");
        if self.resync_pending {
            bot_log(&format!(
                "DROP: patch base {base} != held {held}; resync pending"
            ));
            return Vec::new();
        }
        warn!(
            base,
            held, "state patch does not apply to the board held; requesting resync"
        );
        self.resync_pending = true;
        vec![ClientMessage::RequestResync]
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
        let envelope = match envelope {
            StateEnvelope::State {
                for_player,
                state,
                fingerprint,
                ..
            } => {
                let Some(addressed) = self.accepts_board(player_slot, for_player.as_deref()) else {
                    return Vec::new();
                };
                self.resync_pending = false;
                self.observe_board(state, fingerprint, addressed);
                return Vec::new();
            }
            StateEnvelope::StateDelta {
                for_player,
                base,
                fingerprint,
                patch,
                ..
            } => {
                let Some(addressed) = self.accepts_board(player_slot, for_player.as_deref()) else {
                    return Vec::new();
                };
                let next = match &self.board {
                    Some(board) if board.fingerprint.as_deref() == Some(base.as_str()) => {
                        state_delta::apply(&board.state, &patch)
                    }
                    _ => return self.request_resync(&base),
                };
                self.observe_board(next, Some(fingerprint), addressed);
                return Vec::new();
            }
            envelope => envelope,
        };
        let StateEnvelope::Prompt {
            for_player, prompt, ..
        } = envelope
        else {
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
        let (prompt_id, action_value) =
            if prompt.get("kind").and_then(serde_json::Value::as_str) == Some("priority") {
                bot_log("decide: raw priority -> pass");
                (0, json!({ "kind": "pass" }))
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
                let prompt_id = parsed.prompt_id;
                let Some(action) = self.agent.decide(parsed) else {
                    bot_log(&format!("DROP: agent returned no action for {prompt_type}"));
                    return Vec::new();
                };
                match serde_json::to_value(action) {
                    Ok(v) => {
                        bot_log(&format!("decide: {prompt_type} -> {v}"));
                        (prompt_id, v)
                    }
                    Err(error) => {
                        bot_log(&format!("DROP: action did not serialize: {error}"));
                        return Vec::new();
                    }
                }
            };

        let response = StateEnvelope::Response {
            from_player: for_player,
            prompt_id,
            action: action_value,
        };
        match serde_json::to_value(response) {
            Ok(state) => {
                bot_log("send: broadcasting response");
                vec![ClientMessage::BroadcastState {
                    state,
                    target_player: None,
                }]
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

#[cfg(test)]
mod tests {
    use super::*;
    use manabrew_agent_interface::prompt::PromptOutput;
    use manabrew_protocol::game::{CardDto, CardView, ZoneDto, ZoneKind};
    use std::sync::{Arc, Mutex};

    /// (turn, cards in our hand) per observed board.
    type Seen = Arc<Mutex<Vec<(u32, usize)>>>;

    #[derive(Default)]
    struct Recorder(Seen);

    impl BotAgent for Recorder {
        fn observe(&mut self, view: GameViewDto) {
            let hand = view
                .zones
                .iter()
                .find(|zone| zone.zone == ZoneKind::Hand && zone.owner_id == "player-0")
                .map_or(0, |zone| zone.cards.len());
            self.0.lock().unwrap().push((view.turn, hand));
        }
        fn decide(&mut self, _prompt: AgentPrompt) -> Option<PromptOutput> {
            None
        }
    }

    fn bot() -> (BotState, Seen) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let config: BotConfig = serde_json::from_value(json!({
            "username": "bot", "password": "", "roomId": "room",
            "deckName": "deck", "deck": { "name": "deck", "cards": [] },
        }))
        .expect("a bot config");
        let mut state = BotState::with_agent(config, Box::new(Recorder(seen.clone())));
        state.phase = Phase::Playing {
            player_slot: "player-0".into(),
        };
        (state, seen)
    }

    /// Seven cards in hand, listed or hidden.
    fn board(turn: u32, hand_visible: bool) -> Value {
        let cards = if hand_visible {
            (0..7)
                .map(|i| {
                    CardView::Visible(CardDto {
                        id: format!("card-{i}"),
                        ..CardDto::default()
                    })
                })
                .collect()
        } else {
            Vec::new()
        };
        let view = GameViewDto {
            turn,
            zones: vec![ZoneDto {
                zone: ZoneKind::Hand,
                owner_id: "player-0".into(),
                cards,
                count: 7,
            }],
            ..GameViewDto::default()
        };
        json!({ "gameView": view })
    }

    fn full(for_player: Option<&str>, state: Value) -> Value {
        json!({
            "kind": "state",
            "forPlayer": for_player,
            "fingerprint": state_delta::fingerprint(&state),
            "state": state,
        })
    }

    fn patch(for_player: Option<&str>, previous: &Value, next: &Value) -> Value {
        json!({
            "kind": "stateDelta",
            "forPlayer": for_player,
            "base": state_delta::fingerprint(previous),
            "fingerprint": state_delta::fingerprint(next),
            "patch": state_delta::diff(previous, next).expect("the boards differ"),
        })
    }

    fn recv(state: &mut BotState, envelope: Value) -> Vec<ClientMessage> {
        state.on_server_message(&ServerMessage::StateUpdate {
            from_player: "host".into(),
            state: envelope,
        })
    }

    #[test]
    fn keeps_its_own_view_over_the_observer_broadcast() {
        let (mut bot, seen) = bot();
        recv(&mut bot, full(Some("player-0"), board(1, true)));
        recv(&mut bot, full(None, board(1, false)));
        assert_eq!(*seen.lock().unwrap(), vec![(1, 7)]);
    }

    #[test]
    fn takes_the_observer_broadcast_until_addressed() {
        let (mut bot, seen) = bot();
        recv(&mut bot, full(None, board(1, false)));
        recv(&mut bot, full(Some("player-0"), board(1, true)));
        recv(&mut bot, full(None, board(2, false)));
        assert_eq!(*seen.lock().unwrap(), vec![(1, 0), (1, 7)]);
    }

    #[test]
    fn applies_a_patch_to_the_board_it_holds() {
        let (mut bot, seen) = bot();
        let (turn1, turn2) = (board(1, true), board(2, true));
        recv(&mut bot, full(Some("player-0"), turn1.clone()));
        let out = recv(&mut bot, patch(Some("player-0"), &turn1, &turn2));
        assert!(out.is_empty());
        assert_eq!(*seen.lock().unwrap(), vec![(1, 7), (2, 7)]);
        assert_eq!(bot.board.as_ref().unwrap().state, turn2);
    }

    #[test]
    fn asks_for_a_resync_once_when_a_patch_does_not_apply() {
        let (mut bot, seen) = bot();
        let (turn1, turn2, turn3) = (board(1, true), board(2, true), board(3, true));
        recv(&mut bot, full(Some("player-0"), turn1.clone()));
        let out = recv(&mut bot, patch(Some("player-0"), &turn2, &turn3));
        assert!(matches!(out.as_slice(), [ClientMessage::RequestResync]));
        let out = recv(&mut bot, patch(Some("player-0"), &turn2, &turn3));
        assert!(out.is_empty());
        assert_eq!(*seen.lock().unwrap(), vec![(1, 7)]);
        recv(&mut bot, full(Some("player-0"), turn3.clone()));
        let turn4 = board(4, true);
        let out = recv(&mut bot, patch(Some("player-0"), &turn3, &turn4));
        assert!(out.is_empty());
        assert_eq!(*seen.lock().unwrap(), vec![(1, 7), (3, 7), (4, 7)]);
    }

    #[test]
    fn ignores_observer_patches_once_addressed() {
        let (mut bot, seen) = bot();
        let (obs1, obs2) = (board(1, false), board(2, false));
        recv(&mut bot, full(Some("player-0"), board(1, true)));
        let out = recv(&mut bot, patch(None, &obs1, &obs2));
        assert!(out.is_empty());
        assert_eq!(*seen.lock().unwrap(), vec![(1, 7)]);
    }
}
