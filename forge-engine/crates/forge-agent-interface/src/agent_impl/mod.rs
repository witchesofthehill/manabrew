use forge_engine_core::agent::notification::GameNotification;
use forge_engine_core::agent::{
    BinaryChoiceKind, CombatCostAction, GameEntity, ManaCostAction, PlayOption, PlayerAgent,
    PriorityActionSpace, RollSwapChoice, TargetChoice,
};
use forge_engine_core::card::CounterType;
use forge_engine_core::combat::DefenderId;
use forge_engine_core::game::GameState;
use forge_engine_core::ids::{CardId, PlayerId};
use forge_engine_core::mana::ManaPool;
use forge_engine_core::player::actions::player_action::AbilityRef;
use forge_engine_core::player::actions::PlayerAction as EnginePlayerAction;
use forge_foundation::ZoneType;

use crate::game_log_event::GameLogEntryDto;
use crate::game_snapshot_event::GameSnapshotEventDto;
use crate::game_view_dto::{CardDto, GameViewDto};
use crate::ids_codec::{card_id_str, parse_card_id, parse_player_id, player_id_str};
use crate::prompt::{
    ActivatableAbilityInfo, AgentPrompt, AgentPromptInner, DisplayEvent, PlayOptionDto,
    PlayerAction,
};

mod choices;
mod combat;
mod costs;
mod library;
mod targeting;

/// Match a mana symbol letter (e.g. "U") or a full color name (e.g. "Blue")
/// against a list of color strings.  Handles the Blue/U mismatch where the
/// mana symbol "U" doesn't match the first character of "Blue".
pub(crate) fn find_matching_color<'a>(
    pending: &str,
    colors: impl Iterator<Item = &'a String>,
) -> Option<String> {
    let mana_to_name: &[(&str, &str)] = &[
        ("W", "White"),
        ("U", "Blue"),
        ("B", "Black"),
        ("R", "Red"),
        ("G", "Green"),
        ("C", "Colorless"),
    ];
    colors
        .into_iter()
        .find(|c| {
            // Direct case-insensitive match (covers both "U"=="U" and "Blue"=="Blue")
            c.eq_ignore_ascii_case(pending)
            // Mana symbol → full name lookup (covers "U" matching "Blue")
            || mana_to_name.iter().any(|(sym, name)| {
                pending.eq_ignore_ascii_case(sym) && c.eq_ignore_ascii_case(name)
            })
            // Full name → mana symbol lookup (covers "Blue" matching "U")
            || mana_to_name.iter().any(|(sym, name)| {
                pending.eq_ignore_ascii_case(name) && c.eq_ignore_ascii_case(sym)
            })
        })
        .cloned()
}

/// Answers the prompts a `PromptAgent` builds.
///
/// `present` ships a prompt one-way to the client; an interactive transport
/// writes it to its channel now (so a broadcast reaches every client in
/// parallel), a bot has nothing to show and leaves the default no-op.
/// `respond` returns the action for the prompt just presented: a transport
/// blocks on its channel (ignoring `prompt`, already on the wire), a bot
/// computes its answer from `prompt` — so neither side has to buffer it.
/// `await_ack`/`send_log`/`send_snapshot` are one-way and default to dropping.
pub trait Responder {
    fn respond(&mut self, prompt: AgentPrompt) -> PlayerAction;
    fn present(&mut self, _prompt: &AgentPrompt) {}
    fn await_ack(&mut self) {}
    fn send_log(&mut self, _entry: GameLogEntryDto) {}
    fn send_snapshot(&mut self, _snapshot: GameSnapshotEventDto) {}
}

pub struct PromptAgent<R: Responder> {
    pub player_id: PlayerId,
    pub game_id: String,
    pub responder: R,
    pending_prompt: Option<AgentPrompt>,
    pub(crate) latest_view: Option<GameViewDto>,
    /// Display events accumulated between prompts — drained and attached to each outgoing prompt.
    pub(crate) pending_display_events: Vec<DisplayEvent>,
    /// Card DTOs pre-built by on_library_peek() for Scry/Surveil/Dig prompts.
    pub(crate) peeked_library_cards: Vec<CardDto>,
    /// Cached per-ability descriptions, is_mana_ability flags, and cost strings, populated in snapshot_state.
    /// Key: (card_id.0, ability_index) → (description, is_mana_ability, cost_string)
    ability_descriptions: std::collections::HashMap<(u32, usize), (String, bool, Option<String>)>,
    pub(crate) pending_restore_checkpoint: Option<u64>,
    pub(crate) pending_mana_color: Option<String>,
    pub pass_until_phase: Option<Option<String>>,
}

impl<R: Responder> PromptAgent<R> {
    pub fn new(player_id: PlayerId, game_id: String, responder: R) -> Self {
        Self {
            player_id,
            game_id,
            responder,
            pending_prompt: None,
            latest_view: None,
            pending_display_events: Vec::new(),
            peeked_library_cards: Vec::new(),
            ability_descriptions: std::collections::HashMap::new(),
            pending_restore_checkpoint: None,
            pending_mana_color: None,
            pass_until_phase: None,
        }
    }

    /// Send a prompt to the frontend. `source` is the engine card id of the
    /// prompt's source — the spell being cast, the ability whose trigger
    /// fired, the cost being paid. `None` only for genuinely sourceless
    /// prompts (mulligan, game-over, generic state updates). Required at
    /// every call site so the compiler can't let one slip through.
    fn build_prompt(&mut self, inner: AgentPromptInner, source: Option<CardId>) -> AgentPrompt {
        let display_events = std::mem::take(&mut self.pending_display_events);
        AgentPrompt {
            deciding_player_id: player_id_str(self.player_id),
            display_events,
            source_card_id: source.map(card_id_str),
            inner,
        }
    }

    pub(crate) fn send_prompt(&mut self, inner: AgentPromptInner, source: Option<CardId>) {
        let prompt = self.build_prompt(inner, source);
        self.responder.present(&prompt);
        self.pending_prompt = Some(prompt);
    }

    pub(crate) fn recv_action(&mut self) -> PlayerAction {
        let prompt = self
            .pending_prompt
            .take()
            .expect("recv_action called without a pending prompt");
        self.responder.respond(prompt)
    }

    pub(crate) fn notify_view(&mut self, inner: AgentPromptInner, source: Option<CardId>) {
        let prompt = self.build_prompt(inner, source);
        self.responder.present(&prompt);
    }

    pub(crate) fn view(&self) -> GameViewDto {
        self.latest_view.clone().unwrap_or_else(|| {
            // Fallback: empty view
            GameViewDto::empty(self.game_id.clone())
        })
    }

    pub(crate) fn card_ids(cards: &[CardId]) -> Vec<String> {
        cards.iter().map(|&c| card_id_str(c)).collect()
    }

    pub(crate) fn player_ids(players: &[PlayerId]) -> Vec<String> {
        players.iter().map(|&p| player_id_str(p)).collect()
    }

    pub(crate) fn defender_ids_to_dtos(
        defenders: &[DefenderId],
    ) -> Vec<crate::prompt::DefenderIdDto> {
        defenders
            .iter()
            .map(|d| match d {
                DefenderId::Player(pid) => crate::prompt::DefenderIdDto {
                    id: format!("player-{}", pid.0),
                    label: format!("Player {}", pid.0),
                },
                DefenderId::Permanent(cid) => crate::prompt::DefenderIdDto {
                    id: format!("card-{}", cid.0),
                    label: format!("Permanent {}", cid.0),
                },
            })
            .collect()
    }

    fn play_option_to_dto(play: &PlayOption) -> PlayOptionDto {
        use forge_engine_core::agent::PlayCardMode;
        let card_id = card_id_str(play.card_id);
        let (mode, mode_label) = match &play.mode {
            PlayCardMode::Normal => ("normal".to_string(), "Cast normally".to_string()),
            PlayCardMode::BackFaceLand => (
                "backFaceLand".to_string(),
                "Play back face as land".to_string(),
            ),
            PlayCardMode::Alternative(alt) => {
                let name = format!("{:?}", alt);
                (
                    format!("alternative:{}", name.to_lowercase()),
                    format!("Cast with {}", name),
                )
            }
            PlayCardMode::StaticAlternative => (
                "staticAlternative".to_string(),
                "Cast with alternative cost".to_string(),
            ),
            PlayCardMode::ForetellExile => (
                "foretellExile".to_string(),
                "Foretell (exile face-down)".to_string(),
            ),
            PlayCardMode::UnlockDoor => ("unlockDoor".to_string(), "Unlock door".to_string()),
            PlayCardMode::RoomRightSplit => {
                ("roomRightSplit".to_string(), "Cast right room".to_string())
            }
        };
        PlayOptionDto {
            card_id,
            mode,
            mode_label,
        }
    }

    fn parse_play_mode(mode_str: &str) -> Option<forge_engine_core::agent::PlayCardMode> {
        use forge_engine_core::agent::PlayCardMode;
        use forge_engine_core::spellability::AlternativeCost;
        match mode_str {
            "normal" => Some(PlayCardMode::Normal),
            "backFaceLand" => Some(PlayCardMode::BackFaceLand),
            "staticAlternative" => Some(PlayCardMode::StaticAlternative),
            "foretellExile" => Some(PlayCardMode::ForetellExile),
            "unlockDoor" => Some(PlayCardMode::UnlockDoor),
            "roomRightSplit" => Some(PlayCardMode::RoomRightSplit),
            s if s.starts_with("alternative:") => {
                let alt_name = &s["alternative:".len()..];
                let alt = match alt_name {
                    "flashback" => AlternativeCost::Flashback,
                    "evoke" => AlternativeCost::Evoke,
                    "dash" => AlternativeCost::Dash,
                    "escape" => AlternativeCost::Escape,
                    "bestow" => AlternativeCost::Bestow,
                    "madness" => AlternativeCost::Madness,
                    "overload" => AlternativeCost::Overload,
                    "spectacle" => AlternativeCost::Spectacle,
                    "emerge" => AlternativeCost::Emerge,
                    "blitz" => AlternativeCost::Blitz,
                    "foretell" => AlternativeCost::Foretell,
                    "suspend" => AlternativeCost::Suspend,
                    _ => return None,
                };
                Some(PlayCardMode::Alternative(alt))
            }
            _ => None,
        }
    }

    pub(crate) fn parse_defender_id(id: &str, possible: &[DefenderId]) -> Option<DefenderId> {
        if let Some(rest) = id.strip_prefix("player-") {
            let idx: u32 = rest.parse().ok()?;
            possible
                .iter()
                .find(|d| matches!(d, DefenderId::Player(p) if p.0 == idx))
                .copied()
        } else if let Some(rest) = id.strip_prefix("card-") {
            let idx: u32 = rest.parse().ok()?;
            possible
                .iter()
                .find(|d| matches!(d, DefenderId::Permanent(c) if c.0 == idx))
                .copied()
        } else {
            None
        }
    }

    pub(crate) fn mark_battlefield_choosable(view: &mut GameViewDto, valid_card_ids: &[String]) {
        for card in &mut view.battlefield {
            card.is_choosable = valid_card_ids.contains(&card.id);
        }
    }

    pub(crate) fn recv_card_choice_or_first(&mut self, valid: &[CardId]) -> Option<CardId> {
        match self.recv_action() {
            PlayerAction::TargetCard { card_id } => card_id.and_then(|id| parse_card_id(&id)),
            _ => valid.first().copied(),
        }
    }

    pub(crate) fn recv_player_choice_or_first(&mut self, valid: &[PlayerId]) -> Option<PlayerId> {
        match self.recv_action() {
            PlayerAction::TargetPlayer { player_id } => {
                player_id.and_then(|id| parse_player_id(&id))
            }
            _ => valid.first().copied(),
        }
    }

    pub(crate) fn recv_spell_choice_or_first(&mut self, valid: &[u32]) -> Option<u32> {
        match self.recv_action() {
            PlayerAction::TargetSpell { spell_id } => {
                spell_id.and_then(|id| crate::ids_codec::parse_stack_id(&id))
            }
            _ => valid.first().copied(),
        }
    }
}

impl<R: Responder> PlayerAgent for PromptAgent<R> {
    fn choose_targets_for(
        &mut self,
        sa: &mut forge_engine_core::spellability::SpellAbility,
        game: &GameState,
        mana_pools: &[ManaPool],
    ) -> bool {
        forge_engine_core::spellability::choose_targets_by_kind(self, sa, game, mana_pools)
    }

    fn get_pass_until_phase(&self) -> Option<Option<&str>> {
        self.pass_until_phase.as_ref().map(|inner| inner.as_deref())
    }

    fn clear_pass_until(&mut self) {
        self.pass_until_phase = None;
    }

    fn snapshot_state(&mut self, game: &GameState, mana_pools: &[ManaPool]) {
        self.latest_view = Some(GameViewDto::from_engine(
            game,
            mana_pools,
            self.player_id,
            &self.game_id,
            &[], // playable/choosable filled at prompt time
            &[],
        ));

        // Cache per-ability descriptions from battlefield cards
        self.ability_descriptions.clear();
        for zone in [
            forge_foundation::ZoneType::Battlefield,
            forge_foundation::ZoneType::Hand,
            forge_foundation::ZoneType::Graveyard,
            forge_foundation::ZoneType::Exile,
        ] {
            for &card_id in game.cards_in_zone(zone, self.player_id) {
                let card = game.card(card_id);
                for ab in &card.activated_abilities {
                    let desc = ab
                        .spell_description
                        .as_deref()
                        .or(ab.precost_desc.as_deref())
                        .or(ab.description.as_deref())
                        .map(str::to_string)
                        .unwrap_or_else(|| ab.ability_text.clone())
                        .replace("CARDNAME", &card.card_name);
                    let cost_str = ab.cost.to_simple_string();
                    let cost = if cost_str.is_empty() {
                        None
                    } else {
                        Some(cost_str)
                    };
                    self.ability_descriptions.insert(
                        (card_id.0, ab.ability_index),
                        (desc, ab.is_mana_ability, cost),
                    );
                }
            }
        }
    }

    fn mulligan_decision(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        mulligan_count: u32,
    ) -> bool {
        choices::mulligan_decision(self, player, hand, mulligan_count)
    }

    fn mulligan_decision_send(&mut self, player: PlayerId, hand: &[CardId], mulligan_count: u32) {
        choices::mulligan_decision_send(self, player, hand, mulligan_count);
    }

    fn mulligan_decision_recv(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        mulligan_count: u32,
    ) -> bool {
        choices::mulligan_decision_recv(self, player, hand, mulligan_count)
    }

    fn choose_cards_to_bottom(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        count: usize,
    ) -> Vec<CardId> {
        choices::choose_cards_to_bottom(self, player, hand, count)
    }

    fn choose_cards_to_bottom_send(&mut self, player: PlayerId, hand: &[CardId], count: usize) {
        choices::choose_cards_to_bottom_send(self, player, hand, count);
    }

    fn choose_cards_to_bottom_recv(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        count: usize,
    ) -> Vec<CardId> {
        choices::choose_cards_to_bottom_recv(self, player, hand, count)
    }

    fn choose_action(
        &mut self,
        _player: PlayerId,
        action_space: Option<&PriorityActionSpace>,
        request_action_space: &mut dyn FnMut() -> PriorityActionSpace,
    ) -> EnginePlayerAction {
        let requested_action_space;
        let action_space = match action_space {
            Some(action_space) => action_space,
            None => {
                requested_action_space = request_action_space();
                &requested_action_space
            }
        };
        let playable = &action_space.playable;
        let tappable_lands = &action_space.tappable_lands;
        let untappable_lands = &action_space.untappable_lands;
        let activatable = &action_space.activatable;
        let playable_card_ids: Vec<String> = playable
            .iter()
            .map(|play| card_id_str(play.card_id))
            .collect();
        let playable_options: Vec<PlayOptionDto> = playable
            .iter()
            .map(|play| Self::play_option_to_dto(play))
            .collect();
        let mut tappable_land_ids: Vec<String> =
            tappable_lands.iter().map(|&c| card_id_str(c)).collect();
        let untappable_land_ids: Vec<String> =
            untappable_lands.iter().map(|&c| card_id_str(c)).collect();

        // Build activatable ability info and merge mana-ability cards into tappable list
        let view_ref = self.view();
        let mut activatable_ability_ids = Vec::new();
        for &(card_id, ability_idx) in activatable {
            let id_str = card_id_str(card_id);
            let (description, is_mana, cost) = self
                .ability_descriptions
                .get(&(card_id.0, ability_idx))
                .cloned()
                .unwrap_or_else(|| {
                    // Fallback: use card text from view
                    let text = view_ref
                        .battlefield
                        .iter()
                        .find(|c| c.id == id_str)
                        .map(|c| c.text.clone())
                        .unwrap_or_default();
                    (text, false, None)
                });
            activatable_ability_ids.push(ActivatableAbilityInfo {
                card_id: id_str.clone(),
                ability_index: ability_idx,
                description,
                is_mana_ability: is_mana,
                cost,
            });
            // Only mana abilities should reuse the TAP affordance. Non-mana land
            // abilities like Evolving Wilds must stay as explicit activations.
            if is_mana && !tappable_land_ids.contains(&id_str) {
                tappable_land_ids.push(id_str);
            }
        }

        // Build mana ability options for tappable lands (dual land per-color buttons)
        let mana_ability_options: Vec<ActivatableAbilityInfo> = tappable_land_ids
            .iter()
            .flat_map(|id_str| {
                self.ability_descriptions
                    .iter()
                    .filter(move |(&(raw_id, _), &(_, is_mana, _))| {
                        is_mana && card_id_str(CardId(raw_id)) == *id_str
                    })
                    .map(|(&(raw_id, idx), (desc, _, cost))| ActivatableAbilityInfo {
                        card_id: card_id_str(CardId(raw_id)),
                        ability_index: idx,
                        description: desc.clone(),
                        is_mana_ability: true,
                        cost: cost.clone(),
                    })
            })
            .collect();

        let hand_activatable_ids: Vec<String> = activatable
            .iter()
            .map(|&(card_id, _)| card_id_str(card_id))
            .filter(|card_id| view_ref.my_hand.iter().any(|card| card.id == *card_id))
            .collect();

        // Update the view with playable info (hand, graveyard, command zone)
        let mut view = view_ref;
        for card in &mut view.my_hand {
            card.is_playable =
                playable_card_ids.contains(&card.id) || hand_activatable_ids.contains(&card.id);
        }
        for card in &mut view.graveyard {
            card.is_playable = playable_card_ids.contains(&card.id);
        }
        for card in &mut view.my_command_zone {
            card.is_playable = playable_card_ids.contains(&card.id);
        }

        let available_player_actions = playable
            .iter()
            .copied()
            .map(EnginePlayerAction::CastSpell)
            .chain(
                tappable_lands
                    .iter()
                    .copied()
                    .map(|cid| EnginePlayerAction::ActivateMana(cid, None)),
            )
            .chain(
                untappable_lands
                    .iter()
                    .copied()
                    .map(EnginePlayerAction::UndoMana),
            )
            .chain(activatable.iter().map(|&(card_id, ability_index)| {
                EnginePlayerAction::ActivateAbility(AbilityRef {
                    card_id,
                    ability_index,
                })
            }))
            .chain(std::iter::once(EnginePlayerAction::PassPriority))
            .collect();

        self.send_prompt(
            AgentPromptInner::ChooseAction {
                game_view: view,
                playable_card_ids,
                playable_options,
                tappable_land_ids,
                untappable_land_ids,
                activatable_ability_ids,
                mana_ability_options,
                available_player_actions,
            },
            None,
        );
        match self.recv_action() {
            PlayerAction::EngineAction { action } => action,
            PlayerAction::Pass { until_phase } => {
                // Only store a fast-forward declaration when there's a target phase.
                // None = atomic single pass, no fast-forward.
                if until_phase.is_some() {
                    self.pass_until_phase = Some(until_phase);
                }
                EnginePlayerAction::PassPriority
            }
            PlayerAction::RestoreSnapshot { checkpoint_id } => {
                self.pending_restore_checkpoint = Some(checkpoint_id);
                EnginePlayerAction::PassPriority
            }
            PlayerAction::PlayCard { card_id, mode } => {
                let resolved = parse_card_id(&card_id).and_then(|cid| {
                    if let Some(mode_str) = &mode {
                        if let Some(parsed_mode) = Self::parse_play_mode(mode_str) {
                            return playable
                                .iter()
                                .copied()
                                .find(|play| play.card_id == cid && play.mode == parsed_mode);
                        }
                    }
                    playable.iter().copied().find(|play| play.card_id == cid)
                });
                resolved
                    .map(EnginePlayerAction::CastSpell)
                    .unwrap_or(EnginePlayerAction::PassPriority)
            }
            PlayerAction::TapLand {
                card_id,
                ability_index,
                color,
            } => {
                self.pending_mana_color = color;
                let parsed = parse_card_id(&card_id);
                match parsed {
                    Some(cid) => {
                        // Check if the specified ability is a non-mana activated ability
                        // (e.g. Evolving Wilds sacrifice). Mana abilities route through
                        // ActivateMana which handles the ability index directly.
                        let is_non_mana_activatable = ability_index
                            .map(|idx| {
                                activatable
                                    .iter()
                                    .any(|&(id, ab_idx)| id == cid && ab_idx == idx)
                            })
                            .unwrap_or(false);
                        if is_non_mana_activatable {
                            EnginePlayerAction::ActivateAbility(AbilityRef {
                                card_id: cid,
                                ability_index: ability_index.unwrap(),
                            })
                        } else if ability_index.is_none() {
                            // No ability index — check if there's a single non-mana
                            // activatable ability on this card (legacy fallback).
                            if let Some(&(id, idx)) = activatable.iter().find(|(id, _)| *id == cid)
                            {
                                EnginePlayerAction::ActivateAbility(AbilityRef {
                                    card_id: id,
                                    ability_index: idx,
                                })
                            } else {
                                EnginePlayerAction::ActivateMana(cid, None)
                            }
                        } else {
                            // Mana ability with specific index
                            EnginePlayerAction::ActivateMana(cid, ability_index)
                        }
                    }
                    None => EnginePlayerAction::PassPriority,
                }
            }
            PlayerAction::ActivateAbility {
                card_id,
                ability_index,
            } => parse_card_id(&card_id)
                .map(|cid| {
                    EnginePlayerAction::ActivateAbility(AbilityRef {
                        card_id: cid,
                        ability_index,
                    })
                })
                .unwrap_or(EnginePlayerAction::PassPriority),
            PlayerAction::UntapLand { card_id } => parse_card_id(&card_id)
                .map(EnginePlayerAction::UndoMana)
                .unwrap_or(EnginePlayerAction::PassPriority),
            _ => EnginePlayerAction::PassPriority,
        }
    }

    fn choose_attackers(
        &mut self,
        player: PlayerId,
        available: &[CardId],
        possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        combat::choose_attackers(self, player, available, possible_defenders)
    }

    fn choose_blockers(
        &mut self,
        player: PlayerId,
        attackers: &[CardId],
        available_blockers: &[CardId],
        max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        combat::choose_blockers(self, player, attackers, available_blockers, max_blockers)
    }

    fn choose_damage_assignment_order(
        &mut self,
        player: PlayerId,
        attacker: CardId,
        blockers: &[CardId],
    ) -> Vec<CardId> {
        combat::choose_damage_assignment_order(self, player, attacker, blockers)
    }

    fn assign_combat_damage(
        &mut self,
        game: &GameState,
        player: PlayerId,
        attacker: CardId,
        blockers_in_order: &[CardId],
        defender_id: Option<DefenderId>,
        damage_to_assign: i32,
    ) -> Vec<(Option<CardId>, i32)> {
        let attacker_has_deathtouch = game.card(attacker).has_deathtouch();
        combat::choose_combat_damage_assignment(
            self,
            player,
            attacker,
            blockers_in_order,
            defender_id,
            damage_to_assign,
            attacker_has_deathtouch,
        )
    }

    fn choose_target_player(
        &mut self,
        player: PlayerId,
        valid: &[PlayerId],
        sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> Option<PlayerId> {
        let source = sa.and_then(|s| s.source);
        let intent = sa
            .map(crate::game_view_dto::targeting_intent_of)
            .unwrap_or(crate::game_view_dto::TargetingIntent::Hostile);
        let hostile = intent.is_hostile();
        targeting::choose_target_player(self, player, valid, source, hostile, intent)
    }

    fn choose_target_card(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> Option<CardId> {
        let source = sa.and_then(|s| s.source);
        let intent = sa
            .map(crate::game_view_dto::targeting_intent_of)
            .unwrap_or(crate::game_view_dto::TargetingIntent::Hostile);
        let hostile = intent.is_hostile();
        targeting::choose_target_card(self, player, valid, source, hostile, intent)
    }

    fn choose_target_card_from_zone(
        &mut self,
        player: PlayerId,
        zone: ZoneType,
        valid: &[CardId],
        sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> Option<CardId> {
        let source = sa.and_then(|s| s.source);
        let intent = sa
            .map(crate::game_view_dto::targeting_intent_of)
            .unwrap_or(crate::game_view_dto::TargetingIntent::Hostile);
        let hostile = intent.is_hostile();
        targeting::choose_target_card_from_zone(self, player, zone, valid, source, hostile, intent)
    }

    fn choose_target_any(
        &mut self,
        player: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> TargetChoice {
        let source = sa.and_then(|s| s.source);
        let intent = sa
            .map(crate::game_view_dto::targeting_intent_of)
            .unwrap_or(crate::game_view_dto::TargetingIntent::Hostile);
        let hostile = intent.is_hostile();
        targeting::choose_target_any(
            self,
            player,
            valid_players,
            valid_cards,
            source,
            hostile,
            intent,
        )
    }

    fn choose_sacrifice(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        source: Option<CardId>,
    ) -> Option<CardId> {
        targeting::choose_sacrifice(self, player, valid, source)
    }

    fn on_library_peek(&mut self, game: &forge_engine_core::game::GameState, cards: &[CardId]) {
        library::on_library_peek(self, game, cards)
    }

    fn reveal_cards(
        &mut self,
        game: &GameState,
        _player: PlayerId,
        cards: &[CardId],
        zone: ZoneType,
        owner: PlayerId,
        message_prefix: Option<&str>,
    ) {
        choices::reveal_cards(self, game, cards, zone, owner, message_prefix)
    }

    fn choose_scry(&mut self, player: PlayerId, cards: &[CardId]) -> Vec<CardId> {
        library::choose_scry(self, player, cards)
    }

    fn choose_surveil(&mut self, player: PlayerId, cards: &[CardId]) -> Vec<CardId> {
        library::choose_surveil(self, player, cards)
    }

    fn choose_dig(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        max: usize,
        optional: bool,
    ) -> Vec<CardId> {
        library::choose_dig(self, player, valid, max, optional)
    }

    fn choose_discard(&mut self, player: PlayerId, hand: &[CardId], num: usize) -> Vec<CardId> {
        choices::choose_discard(self, player, hand, num)
    }

    fn choose_discard_any_number(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        min: usize,
        max: usize,
    ) -> Vec<CardId> {
        choices::choose_discard_any_number(self, player, hand, min, max)
    }

    fn choose_legend_keep(&mut self, player: PlayerId, duplicates: &[CardId]) -> CardId {
        choices::choose_legend_keep(self, player, duplicates)
    }

    fn choose_target_spell(
        &mut self,
        player: PlayerId,
        valid: &[u32],
        source: Option<CardId>,
    ) -> Option<u32> {
        targeting::choose_target_spell(self, player, valid, source)
    }

    fn choose_mode(
        &mut self,
        player: PlayerId,
        descriptions: &[String],
        min: usize,
        max: usize,
        source_card_id: Option<CardId>,
    ) -> Vec<usize> {
        choices::choose_mode(self, player, descriptions, min, max, source_card_id)
    }

    fn choose_spell_abilities_for_effect(
        &mut self,
        player: PlayerId,
        abilities: &[forge_engine_core::spellability::SpellAbility],
        num: usize,
    ) -> Vec<usize> {
        choices::choose_spell_abilities_for_effect(self, player, abilities, num)
    }

    fn get_ability_to_play(
        &mut self,
        player: PlayerId,
        abilities: &[forge_engine_core::spellability::SpellAbility],
    ) -> Option<usize> {
        choices::get_ability_to_play(self, player, abilities)
    }

    fn choose_single_entity_for_effect(
        &mut self,
        player: PlayerId,
        valid: &[GameEntity],
        is_optional: bool,
    ) -> Option<GameEntity> {
        choices::choose_single_entity_for_effect(self, player, valid, is_optional)
    }

    fn choose_entities_for_effect(
        &mut self,
        player: PlayerId,
        candidates: &[GameEntity],
        min: usize,
        max: usize,
    ) -> Vec<GameEntity> {
        choices::choose_entities_for_effect(self, player, candidates, min, max)
    }

    fn choose_single_replacement_effect(
        &mut self,
        player: PlayerId,
        descriptions: &[String],
    ) -> usize {
        choices::choose_single_replacement_effect(self, player, descriptions)
    }

    fn confirm_replacement_effect(
        &mut self,
        player: PlayerId,
        question: &str,
        effect_description: &str,
        source: Option<CardId>,
    ) -> bool {
        choices::confirm_replacement_effect(self, player, question, effect_description, source)
    }

    fn choose_optional_trigger(
        &mut self,
        player: PlayerId,
        description: &str,
        source: Option<CardId>,
        api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        choices::choose_optional_trigger(self, player, description, source, api)
    }

    fn confirm_action(
        &mut self,
        player: PlayerId,
        mode: Option<&str>,
        message: &str,
        options: &[String],
        source: Option<CardId>,
        api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        choices::confirm_action(self, player, mode, message, options, source, api)
    }

    fn confirm_payment(
        &mut self,
        player: PlayerId,
        cost_kind: &str,
        message: &str,
        source: Option<CardId>,
        api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        choices::confirm_payment(self, player, cost_kind, message, source, api)
    }

    fn pay_cost_to_prevent_effect(
        &mut self,
        player: PlayerId,
        cost_kind: &str,
        message: &str,
        source: Option<CardId>,
        api: Option<forge_engine_core::ability::api_type::ApiType>,
        can_pay: bool,
    ) -> bool {
        choices::pay_cost_to_prevent_effect(self, player, cost_kind, message, source, api, can_pay)
    }

    fn choose_binary(
        &mut self,
        player: PlayerId,
        question: &str,
        kind: BinaryChoiceKind,
        default_choice: Option<bool>,
        source: Option<CardId>,
        api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        choices::choose_binary(self, player, question, kind, default_choice, source, api)
    }

    fn choose_phyrexian_pay_life(
        &mut self,
        player: PlayerId,
        color: &str,
        source: Option<CardId>,
    ) -> bool {
        costs::choose_phyrexian_pay_life(self, player, color, source)
    }

    fn choose_kicker(
        &mut self,
        player: PlayerId,
        kicker_cost: &str,
        source: Option<CardId>,
    ) -> bool {
        costs::choose_kicker(self, player, kicker_cost, source)
    }

    fn choose_buyback(
        &mut self,
        player: PlayerId,
        buyback_cost: &str,
        source: Option<CardId>,
    ) -> bool {
        costs::choose_buyback(self, player, buyback_cost, source)
    }

    fn choose_multikicker(
        &mut self,
        player: PlayerId,
        cost: &str,
        max_kicks: u32,
        source: Option<CardId>,
    ) -> u32 {
        costs::choose_multikicker(self, player, cost, max_kicks, source)
    }

    fn choose_replicate(
        &mut self,
        player: PlayerId,
        cost: &str,
        max_replicates: u32,
        source: Option<CardId>,
    ) -> u32 {
        costs::choose_replicate(self, player, cost, max_replicates, source)
    }

    fn choose_alternative_cost(
        &mut self,
        player: PlayerId,
        options: &[String],
        source: Option<CardId>,
    ) -> usize {
        costs::choose_alternative_cost(self, player, options, source)
    }

    fn choose_color(&mut self, player: PlayerId, valid_colors: &[String]) -> Option<String> {
        choices::choose_color(self, player, valid_colors)
    }

    fn choose_colors(
        &mut self,
        player: PlayerId,
        valid_colors: &[String],
        min: usize,
        max: usize,
    ) -> Vec<String> {
        choices::choose_colors(self, player, valid_colors, min, max)
    }

    fn choose_cards_for_effect(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        min: usize,
        max: usize,
    ) -> Vec<CardId> {
        choices::choose_cards_for_effect(self, player, valid, min, max)
    }

    fn choose_single_card_for_zone_change(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        select_prompt: &str,
        is_optional: bool,
    ) -> Option<CardId> {
        choices::choose_single_card_for_zone_change(self, player, valid, select_prompt, is_optional)
    }

    fn choose_cards_for_zone_change(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        min: usize,
        max: usize,
        select_prompt: &str,
    ) -> Vec<CardId> {
        choices::choose_cards_for_zone_change(self, player, valid, min, max, select_prompt)
    }

    fn choose_type(
        &mut self,
        player: PlayerId,
        type_category: &str,
        valid_types: &[String],
    ) -> Option<String> {
        choices::choose_type(self, player, type_category, valid_types)
    }

    fn choose_counter_type(
        &mut self,
        player: PlayerId,
        options: &[CounterType],
        prompt: &str,
    ) -> Option<CounterType> {
        choices::choose_counter_type(self, player, options, prompt)
    }

    fn choose_card_name(&mut self, player: PlayerId, valid_names: &[String]) -> Option<String> {
        choices::choose_card_name(self, player, valid_names)
    }

    fn choose_x_value(&mut self, player: PlayerId, max_x: u32, source: Option<CardId>) -> u32 {
        choices::choose_x_value(self, player, max_x, source)
    }

    fn choose_number(&mut self, player: PlayerId, min: i32, max: i32) -> Option<i32> {
        choices::choose_number(self, player, min, max)
    }

    fn choose_number_from_list(
        &mut self,
        player: PlayerId,
        choices: &[i32],
        message: &str,
        source_card_id: Option<CardId>,
    ) -> Option<i32> {
        choices::choose_number_from_list(self, player, choices, message, source_card_id)
    }

    fn choose_roll_to_ignore(
        &mut self,
        player: PlayerId,
        rolls: &[i32],
        source: Option<CardId>,
    ) -> Option<i32> {
        choices::choose_roll_to_ignore(self, player, rolls, source)
    }

    fn choose_roll_to_swap(
        &mut self,
        player: PlayerId,
        rolls: &[i32],
        source: Option<CardId>,
    ) -> Option<i32> {
        choices::choose_roll_to_swap(self, player, rolls, source)
    }

    fn choose_dice_to_reroll(
        &mut self,
        player: PlayerId,
        rolls: &[i32],
        source: Option<CardId>,
    ) -> Vec<i32> {
        choices::choose_dice_to_reroll(self, player, rolls, source)
    }

    fn choose_roll_to_modify(
        &mut self,
        player: PlayerId,
        rolls: &[i32],
        source: Option<CardId>,
    ) -> Option<i32> {
        choices::choose_roll_to_modify(self, player, rolls, source)
    }

    fn choose_roll_swap_value(
        &mut self,
        player: PlayerId,
        current_result: i32,
        power: i32,
        toughness: i32,
        source: Option<CardId>,
    ) -> Option<RollSwapChoice> {
        choices::choose_roll_swap_value(self, player, current_result, power, toughness, source)
    }

    fn flip_coin_call(&mut self, player: PlayerId) -> bool {
        choices::flip_coin_call(self, player)
    }

    fn pay_combat_cost(
        &mut self,
        player: PlayerId,
        attacker: CardId,
        cost: i32,
        description: &str,
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        mana_pool_total: i32,
    ) -> CombatCostAction {
        combat::pay_combat_cost(
            self,
            player,
            attacker,
            cost,
            description,
            tappable_lands,
            untappable_lands,
            mana_pool_total,
        )
    }

    fn choose_delve(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        max: usize,
        source: Option<CardId>,
    ) -> Vec<CardId> {
        costs::choose_delve(self, player, valid, max, source)
    }

    fn choose_improvise(
        &mut self,
        player: PlayerId,
        untapped_artifacts: &[CardId],
        remaining_cost: &forge_foundation::ManaCost,
        source: Option<CardId>,
    ) -> Vec<CardId> {
        costs::choose_improvise(self, player, untapped_artifacts, remaining_cost, source)
    }

    fn choose_convoke(
        &mut self,
        player: PlayerId,
        untapped_creatures: &[CardId],
        remaining_cost: &forge_foundation::ManaCost,
        source: Option<CardId>,
    ) -> Vec<CardId> {
        costs::choose_convoke(self, player, untapped_creatures, remaining_cost, source)
    }

    fn pay_mana_cost(
        &mut self,
        player: PlayerId,
        card_id: CardId,
        card_name: &str,
        mana_cost: &str,
        mana_cost_display: &str,
        _mana_cost_checkpoint: &str,
        can_confirm_from_pool: bool,
        _allow_reserved_source_reuse: bool,
        _reserved_sacrifices: &[CardId],
        mana_ability_options: &[forge_engine_core::agent::ManaAbilityOption],
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        mana_pool: &ManaPool,
    ) -> ManaCostAction {
        costs::pay_mana_cost(
            self,
            player,
            card_id,
            card_name,
            mana_cost,
            mana_cost_display,
            can_confirm_from_pool,
            mana_ability_options,
            tappable_lands,
            untappable_lands,
            mana_pool,
        )
    }

    fn await_display_ack(&mut self) {
        self.responder.await_ack();
    }

    fn specify_mana_combo(
        &mut self,
        player: PlayerId,
        available_colors: &[String],
        amount: usize,
        source: Option<CardId>,
    ) -> Vec<String> {
        costs::specify_mana_combo(self, player, available_colors, amount, source)
    }

    fn exert_attackers(&mut self, player: PlayerId, attackers: &[CardId]) -> Vec<CardId> {
        combat::exert_attackers(self, player, attackers)
    }

    fn enlist_attackers(&mut self, player: PlayerId, attackers: &[CardId]) -> Vec<CardId> {
        combat::enlist_attackers(self, player, attackers)
    }

    fn choose_reorder_library(&mut self, player: PlayerId, cards: &[CardId]) -> Vec<CardId> {
        library::choose_reorder_library(self, player, cards)
    }

    fn choose_explore_put_in_graveyard(
        &mut self,
        player: PlayerId,
        revealed_card_name: &str,
        revealed_cmc: i32,
        mana_producing_lands: usize,
        predicted_mana: usize,
        lands_in_hand: usize,
    ) -> bool {
        choices::choose_explore_put_in_graveyard(
            self,
            player,
            revealed_card_name,
            revealed_cmc,
            mana_producing_lands,
            predicted_mana,
            lands_in_hand,
        )
    }

    fn help_pay_assist(&mut self, player: PlayerId, card_name: &str, max_generic: u32) -> u32 {
        choices::help_pay_assist(self, player, card_name, max_generic)
    }

    fn choose_random_discard(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        num: usize,
    ) -> Vec<CardId> {
        choices::choose_random_discard(self, player, hand, num)
    }

    fn choose_land_or_spell(&mut self, player: PlayerId) -> Option<bool> {
        choices::choose_land_or_spell(self, player)
    }

    fn notify(&mut self, event: GameNotification) {
        match event {
            GameNotification::Event(log_event) => {
                self.responder
                    .send_log(GameLogEntryDto::from_event(log_event));
            }
            GameNotification::CardPlayed {
                player,
                card_id,
                card_name,
                set_code,
            } => {
                self.pending_display_events.push(DisplayEvent::CardPlayed {
                    card_id: card_id_str(card_id),
                    card_name,
                    set_code,
                    player_id: player_id_str(player),
                });
                self.notify_view(
                    AgentPromptInner::StateUpdate {
                        game_view: self.view(),
                    },
                    None,
                );
            }
            GameNotification::TurnChanged {
                active_player,
                turn_number,
            } => {
                let player_id = player_id_str(active_player);
                let active_player_name = self
                    .latest_view
                    .as_ref()
                    .and_then(|v| v.players.iter().find(|p| p.id == player_id))
                    .map(|p| p.name.clone())
                    .unwrap_or_else(|| format!("Player {}", active_player.0));
                self.responder.send_log(GameLogEntryDto::from_event(
                    forge_engine_core::agent::GameLogEvent::rule(format!(
                        "TURN {} — {}",
                        turn_number, active_player_name
                    ))
                    .with_player(active_player),
                ));
                self.pending_display_events.push(DisplayEvent::TurnChanged {
                    active_player_id: player_id,
                    active_player_name,
                    turn_number,
                });
                self.notify_view(
                    AgentPromptInner::StateUpdate {
                        game_view: self.view(),
                    },
                    None,
                );
            }
            GameNotification::PhaseChanged { .. } | GameNotification::StateChanged => {
                self.notify_view(
                    AgentPromptInner::StateUpdate {
                        game_view: self.view(),
                    },
                    None,
                );
            }
            GameNotification::PriorityChanged { .. } => {}
            GameNotification::FirstPlayerRoll {
                sides,
                rolls,
                winner,
            } => {
                let view = self.view();
                let entries = rolls
                    .into_iter()
                    .map(|(pid, value)| {
                        let id = player_id_str(pid);
                        let name = view
                            .players
                            .iter()
                            .find(|p| p.id == id)
                            .map(|p| p.name.clone())
                            .unwrap_or_else(|| id.clone());
                        crate::prompt::FirstPlayerRollEntry {
                            player_id: id,
                            player_name: name,
                            value,
                        }
                    })
                    .collect();
                self.notify_view(
                    AgentPromptInner::FirstPlayerRoll {
                        game_view: view,
                        sides,
                        rolls: entries,
                        winner_player_id: player_id_str(winner),
                    },
                    None,
                );
                // Caller is responsible for `await_display_ack` after the
                // full broadcast — see `roll_for_first_player`.
            }
            GameNotification::DiceRolled {
                player,
                sides,
                natural_results,
                final_results,
                ignored_rolls,
                source_card_name,
            } => {
                // Send the prompt to every agent's transport. The caller
                // is responsible for issuing a parallel `await_display_ack`
                // pass after broadcasting — that way all clients see the
                // animation start at the same time and we wait once for
                // the slowest player rather than serially per-agent.
                self.notify_view(
                    AgentPromptInner::DiceRolled {
                        game_view: self.view(),
                        player_id: player_id_str(player),
                        sides,
                        natural_results,
                        final_results,
                        ignored_rolls,
                        source_card_name,
                    },
                    None,
                );
            }
            GameNotification::SnapshotCreated {
                checkpoint_id,
                label,
            } => {
                if let Some(view) = self.latest_view.clone() {
                    self.responder.send_snapshot(GameSnapshotEventDto::new(
                        checkpoint_id,
                        label,
                        view,
                    ));
                }
            }
            GameNotification::GameOver => {
                self.notify_view(
                    AgentPromptInner::GameOver {
                        game_view: self.view(),
                    },
                    None,
                );
            }
            GameNotification::ManaPaymentResolved { .. } => {}
            GameNotification::ActivatedAbilityPaymentFailed { .. } => {
                self.notify_view(
                    AgentPromptInner::StateUpdate {
                        game_view: self.view(),
                    },
                    None,
                );
            }
        }
    }

    fn take_restore_request(&mut self) -> Option<u64> {
        self.pending_restore_checkpoint.take()
    }
}
