use std::collections::{HashMap, HashSet, VecDeque};

use manabrew_agent_interface::game_view_dto::{
    CardDto, CardView, GameViewDto, StepKind, TargetingIntent, ZoneKind,
};
use manabrew_agent_interface::prompt::*;

use super::BotAgent;

/// How many recent prompts to remember when detecting a stuck loop.
const LOOP_WINDOW: usize = 6;

fn bot_warn(msg: &str) {
    #[cfg(target_arch = "wasm32")]
    if web_sys::window()
        .and_then(|window| window.local_storage().ok().flatten())
        .and_then(|storage| storage.get_item("manabrew.debugPrompts").ok().flatten())
        .as_deref()
        == Some("1")
    {
        web_sys::console::warn_1(&format!("[wasm-bot] {msg}").into());
    }
    #[cfg(not(target_arch = "wasm32"))]
    tracing::debug!(target: "wasm-bot", "{msg}");
}

/// Baseline AI: casts spells when possible, otherwise passes priority, with a
/// memoized anti-loop heuristic so a stuck `ChooseAction` doesn't repeat the
/// same non-pass choice indefinitely.
#[derive(Default)]
pub struct SimpleAi {
    recent_prompts: VecDeque<String>,
    last_attack_declaration: Vec<(String, String)>,
    failed_attack_targets: HashSet<String>,
    view: Option<GameViewDto>,
    card_locations: HashMap<String, (usize, usize)>,
    turn: Option<u32>,
    attempted_actions: HashSet<String>,
    payment_attempt: Option<String>,
    has_command_cards: bool,
}

impl SimpleAi {
    pub fn new() -> Self {
        Self::default()
    }

    /// Detects infinite response loops from the bot
    /// to avoid getting it stuck
    fn looping_on(&mut self, signature: String) -> bool {
        let seen = self.recent_prompts.contains(&signature);
        if seen {
            bot_warn(&format!(
                "loop-breaker engaged on repeated prompt: {signature}"
            ));
        }
        self.remember(signature);
        seen
    }

    fn looping_on_consecutive(&mut self, signature: String) -> bool {
        let consecutive = self.recent_prompts.back() == Some(&signature);
        if consecutive {
            bot_warn(&format!(
                "loop-breaker engaged on consecutive prompt: {signature}"
            ));
        }
        self.remember(signature);
        consecutive
    }

    fn remember(&mut self, signature: String) {
        self.recent_prompts.push_back(signature);
        while self.recent_prompts.len() > LOOP_WINDOW {
            self.recent_prompts.pop_front();
        }
    }

    fn fail_attack_target(&mut self, card_id: &str) {
        if let Some((_, target_id)) = self
            .last_attack_declaration
            .iter()
            .find(|(a, _)| a == card_id)
        {
            self.failed_attack_targets.insert(target_id.clone());
        }
    }

    fn card_zone(&self, id: &str) -> Option<ZoneKind> {
        let (zone_index, _) = *self.card_locations.get(id)?;
        self.view
            .as_ref()?
            .zones
            .get(zone_index)
            .map(|zone| zone.zone)
    }

    fn card(&self, id: &str) -> Option<&CardDto> {
        let (zone_index, card_index) = *self.card_locations.get(id)?;
        match self
            .view
            .as_ref()?
            .zones
            .get(zone_index)?
            .cards
            .get(card_index)?
        {
            CardView::Visible(card) => Some(card),
            CardView::Hidden { .. } => None,
        }
    }

    fn card_value(card: &CardDto) -> i32 {
        let power = card
            .power
            .as_deref()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        let toughness = card
            .toughness
            .as_deref()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        let keyword_value = card
            .keywords
            .iter()
            .map(|keyword| match keyword.to_ascii_lowercase().as_str() {
                "flying" => power * 2,
                "double strike" => power * 3,
                "first strike" | "lifelink" | "trample" => power,
                "deathtouch" => 4,
                "hexproof" | "indestructible" => 3,
                "vigilance" | "menace" => 2,
                _ => 0,
            })
            .sum::<i32>();
        power * 3 + toughness * 2 + card.cmc + keyword_value
    }

    fn action_key(action: &AvailableAction) -> String {
        match &action.kind {
            AvailableActionKind::Cast { card_id, mode, .. } => format!("cast:{card_id}:{mode:?}"),
            AvailableActionKind::ActivateAbility(info) => {
                format!("ability:{}:{}", info.card_id, info.description)
            }
            AvailableActionKind::UndoMana { card_id } => format!("undo:{card_id}"),
        }
    }

    fn prefers_creatures(&self, player_id: &str) -> bool {
        self.view.as_ref().is_some_and(|view| {
            view.zones
                .iter()
                .filter(|zone| matches!(zone.zone, ZoneKind::Command | ZoneKind::Battlefield))
                .flat_map(|zone| &zone.cards)
                .any(|card| {
                    matches!(
                        card,
                        CardView::Visible(card)
                            if card.owner_id == player_id
                                && card.text.to_ascii_lowercase().contains("creature spells")
                    )
                })
        })
    }

    fn action_score(&self, action: &AvailableAction, player_id: &str) -> i32 {
        match &action.kind {
            AvailableActionKind::Cast { card_id, label, .. } => {
                let Some(card) = self.card(card_id) else {
                    return if label.starts_with("Play ") { 900 } else { 300 };
                };
                if card.types.iter().any(|card_type| card_type == "Land") {
                    return 1_000;
                }
                let own_turn = self
                    .view
                    .as_ref()
                    .is_some_and(|view| view.active_player_id == player_id);
                let main_phase = self
                    .view
                    .as_ref()
                    .is_some_and(|view| matches!(view.step, StepKind::Main1 | StepKind::Main2));
                let permanent = card.types.iter().any(|card_type| {
                    matches!(
                        card_type.as_str(),
                        "Creature" | "Artifact" | "Enchantment" | "Planeswalker" | "Battle"
                    )
                });
                let instant = card.types.iter().any(|card_type| card_type == "Instant");
                let mut score = if own_turn && main_phase {
                    if permanent {
                        500
                    } else {
                        420
                    }
                } else if instant {
                    430
                } else {
                    250
                };
                score += Self::card_value(card) - card.cmc * 8;
                if self.card_zone(card_id) == Some(ZoneKind::Command) {
                    score += 160;
                }
                if self.prefers_creatures(player_id)
                    && card.types.iter().any(|card_type| card_type == "Creature")
                {
                    score += (120 - card.cmc * 12).max(0);
                }
                let text = card.text.to_ascii_lowercase();
                if text.contains("draw a card") || text.contains("draw two") {
                    score += 35;
                }
                if text.contains("whenever you cast")
                    && text.contains("creature spell")
                    && text.contains("draw")
                {
                    score += 180;
                }
                if text.contains("destroy target") || text.contains("exile target") {
                    score += 30;
                }
                if text.contains("create a") || text.contains("search your library") {
                    score += 20;
                }
                score
            }
            AvailableActionKind::ActivateAbility(info) if !info.is_mana_ability => {
                let text = info.description.to_ascii_lowercase();
                if text.contains("search your library") {
                    240
                } else if text.contains("draw") || text.contains("create") {
                    210
                } else if text.contains("destroy") || text.contains("exile") {
                    200
                } else if text.contains("sacrifice") || text.contains("pay ") {
                    80
                } else {
                    120
                }
            }
            _ => 0,
        }
    }

    fn has_keyword(card: &CardDto, keyword: &str) -> bool {
        card.keywords
            .iter()
            .any(|value| value.eq_ignore_ascii_case(keyword))
    }

    fn is_constructed_duel(&self) -> bool {
        !self.has_command_cards
            && self
                .view
                .as_ref()
                .is_some_and(|view| view.players.len() == 2)
    }

    fn should_attack(&self, attacker_id: &str, target_id: &str) -> bool {
        let Some(attacker) = self.card(attacker_id) else {
            return true;
        };
        let power = attacker
            .power
            .as_deref()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        let attack_trigger = attacker.text.to_ascii_lowercase().contains("whenever")
            && attacker.text.to_ascii_lowercase().contains(" attacks");
        if attack_trigger {
            return true;
        }
        if power <= 0 {
            return false;
        }
        let Some(view) = &self.view else {
            return true;
        };
        let attacker_flying = Self::has_keyword(attacker, "Flying");
        let blockers = view
            .zones
            .iter()
            .filter(|zone| zone.zone == ZoneKind::Battlefield && zone.owner_id == target_id)
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card)
                    if card.types.iter().any(|card_type| card_type == "Creature")
                        && !card.tapped
                        && (!attacker_flying
                            || Self::has_keyword(card, "Flying")
                            || Self::has_keyword(card, "Reach")) =>
                {
                    Some(card)
                }
                _ => None,
            });
        if Self::has_keyword(attacker, "Indestructible")
            || Self::has_keyword(attacker, "Deathtouch")
            || Self::has_keyword(attacker, "Trample")
        {
            return true;
        }
        !blockers.into_iter().any(|blocker| {
            let blocker_power = blocker
                .power
                .as_deref()
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(0);
            let blocker_toughness = blocker
                .toughness
                .as_deref()
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(0);
            let attacker_toughness = attacker
                .toughness
                .as_deref()
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(0);
            let attacker_dies =
                blocker_power >= attacker_toughness || Self::has_keyword(blocker, "Deathtouch");
            let blocker_survives =
                power < blocker_toughness && !Self::has_keyword(attacker, "Double strike");
            attacker_dies && blocker_survives
        })
    }

    fn target_score(&self, target: &TargetRef, player_id: &str, prompt_hostile: bool) -> i32 {
        let hostile = prompt_hostile
            || matches!(
                target.intent,
                Some(
                    TargetingIntent::Damage
                        | TargetingIntent::Destroy
                        | TargetingIntent::Sacrifice
                        | TargetingIntent::Exile
                        | TargetingIntent::Bounce
                        | TargetingIntent::Mill
                        | TargetingIntent::Discard
                        | TargetingIntent::Counter
                        | TargetingIntent::Tap
                        | TargetingIntent::Debuff
                        | TargetingIntent::LoseLife
                        | TargetingIntent::GainControl
                        | TargetingIntent::Fight
                        | TargetingIntent::Hostile
                )
            );
        match target.kind {
            TargetKind::Player => {
                let value = self.attack_target_score(&target.id);
                let own = target.id == player_id;
                if hostile == own {
                    -value
                } else {
                    value + 1_000
                }
            }
            TargetKind::Card => {
                let Some(card) = self.card(&target.id) else {
                    return 0;
                };
                let value = Self::card_value(card);
                let own = card.controller_id == player_id;
                if hostile == own {
                    -value
                } else {
                    value + 1_000
                }
            }
            TargetKind::Spell => self
                .view
                .as_ref()
                .and_then(|view| view.stack.iter().find(|item| item.id == target.id))
                .map_or(0, |item| {
                    if item.controller_id == player_id {
                        -1_000
                    } else {
                        1_000
                    }
                }),
        }
    }

    fn attack_target_score(&self, id: &str) -> i32 {
        let Some(view) = &self.view else {
            return 0;
        };
        let life = view
            .players
            .iter()
            .find(|player| player.id == id)
            .map_or(0, |player| player.life.max(0));
        let board = view
            .zones
            .iter()
            .filter(|zone| zone.zone == ZoneKind::Battlefield && zone.owner_id == id)
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card) if card.types.iter().any(|ty| ty == "Creature") => {
                    Some(Self::card_value(card))
                }
                _ => None,
            })
            .sum::<i32>();
        let life_deficit = (20 - life).max(0);
        board * 2 + life_deficit * life_deficit
    }
}

impl BotAgent for SimpleAi {
    fn observe(&mut self, view: GameViewDto) {
        self.has_command_cards |= view
            .zones
            .iter()
            .any(|zone| zone.zone == ZoneKind::Command && zone.count > 0);
        if self.turn != Some(view.turn) {
            self.turn = Some(view.turn);
            self.attempted_actions.clear();
            self.payment_attempt = None;
            self.recent_prompts.clear();
            self.failed_attack_targets.clear();
        }
        self.card_locations.clear();
        for (zone_index, zone) in view.zones.iter().enumerate() {
            for (card_index, card) in zone.cards.iter().enumerate() {
                if let CardView::Visible(card) = card {
                    self.card_locations
                        .insert(card.id.clone(), (zone_index, card_index));
                }
            }
        }
        self.view = Some(view);
    }

    fn decide(&mut self, prompt: AgentPrompt) -> Option<PromptOutput> {
        let deciding_player_id = prompt.deciding_player_id.clone();
        let prompt_source_id = prompt
            .source_card
            .as_ref()
            .map_or_else(|| "none".to_string(), |card| card.id.clone());
        let prompt_source_text = prompt
            .source_ability_text
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        match prompt.input {
        PromptInput::Mulligan(manabrew_protocol::prompts::mulligan::MulliganInput {
                hand_card_ids,
                mulligan_count,
            }) => {
                let lands = hand_card_ids
                    .iter()
                    .filter_map(|card_id| self.card(card_id))
                    .filter(|card| card.types.iter().any(|card_type| card_type == "Land"))
                    .count();
                let keep = mulligan_count >= 2 || (2..=5).contains(&lands);
                Some(PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep }))
            }
            PromptInput::MulliganPutBack(manabrew_protocol::prompts::mulligan_put_back::MulliganPutBackInput {
                mut hand_card_ids,
                count,
                ..
            }) => {
                let lands = hand_card_ids
                    .iter()
                    .filter_map(|card_id| self.card(card_id))
                    .filter(|card| card.types.iter().any(|card_type| card_type == "Land"))
                    .count();
                hand_card_ids.sort_by_key(|card_id| {
                    let Some(card) = self.card(card_id) else {
                        return 0;
                    };
                    if lands > 3 && card.types.iter().any(|card_type| card_type == "Land") {
                        -1
                    } else {
                        Self::card_value(card)
                    }
                });
                Some(PromptOutput::MulliganPutBack(MulliganPutBackOutput::MulliganPutBackDecision {
                    card_ids: hand_card_ids.into_iter().take(count).collect(),
                }))
            }
            PromptInput::ChooseAction(manabrew_protocol::prompts::choose_action::ChooseActionInput { actions }) => {
                let pick = actions
                    .iter()
                    .filter(|action| {
                        !matches!(&action.kind, AvailableActionKind::UndoMana { .. })
                            && !matches!(
                                &action.kind,
                                AvailableActionKind::ActivateAbility(info) if info.is_mana_ability
                            )
                            && !self.attempted_actions.contains(&Self::action_key(action))
                    })
                    .max_by_key(|action| self.action_score(action, &deciding_player_id));
                let pick = pick.map(|action| {
                    (action.id.clone(), Self::action_key(action))
                });
                self.payment_attempt = None;
                if let Some((_, key)) = &pick {
                    self.attempted_actions.insert(key.clone());
                }
                Some(PromptOutput::ChooseAction(match pick {
                    Some((action_id, _)) => ChooseActionOutput::Act { action_id },
                    None => ChooseActionOutput::Pass {
                        until: Some(PassUntil {
                            player_id: deciding_player_id.clone(),
                            phase: manabrew_protocol::game::StepKind::Main1,
                            through_combat: false,
                        }),
                        exhaust_stack: true,
                    },
                }))
            }
            PromptInput::ChooseAttackers(manabrew_protocol::prompts::choose_attackers::ChooseAttackersInput {
                attackers,
                attack_targets,
                ..
            }) => {
                let default_target = attack_targets
                    .iter()
                    .max_by_key(|target| self.attack_target_score(&target.id))
                    .map(|target| target.id.clone())
                    .unwrap_or_else(|| "player-1".to_string());
                let attack_power = attackers
                    .iter()
                    .filter_map(|attacker| self.card(&attacker.attacker_id))
                    .filter_map(|card| card.power.as_deref())
                    .filter_map(|power| power.parse::<i32>().ok())
                    .sum::<i32>();
                let lethal_target = self.view.as_ref().is_some_and(|view| {
                    view.players
                        .iter()
                        .find(|player| player.id == default_target)
                        .is_some_and(|player| player.life > 0 && attack_power >= player.life)
                });
                let signature = format!(
                    "attack:{}|{}",
                    attackers
                        .iter()
                        .map(|a| format!("{}:{}", a.attacker_id, a.valid_target_ids.join("+")))
                        .collect::<Vec<_>>()
                        .join(","),
                    attack_targets
                        .iter()
                        .map(|t| t.id.as_str())
                        .collect::<Vec<_>>()
                        .join(",")
                );
                let reprompted = self.looping_on_consecutive(signature);
                let mut assignments = Vec::new();
                if !reprompted {
                    for a in &attackers {
                        let target_id = match a
                            .valid_target_ids
                            .iter()
                            .filter(|target| !self.failed_attack_targets.contains(*target))
                            .max_by_key(|target| self.attack_target_score(target))
                        {
                            Some(t) => t.clone(),
                            None if a.valid_target_ids.is_empty() => default_target.clone(),
                            None => continue,
                        };
                        if a.must_attack
                            || (lethal_target && target_id == default_target)
                            || self.should_attack(&a.attacker_id, &target_id)
                        {
                            assignments.push(AttackAssignment {
                                attacker_id: a.attacker_id.clone(),
                                target_id,
                            });
                        }
                    }
                }
                self.last_attack_declaration = assignments
                    .iter()
                    .map(|a| (a.attacker_id.clone(), a.target_id.clone()))
                    .collect();
                Some(PromptOutput::ChooseAttackers(ChooseAttackersOutput::DeclareAttackers {
                    assignments,
                }))
            }
            PromptInput::ChooseBlockers(manabrew_protocol::prompts::choose_blockers::ChooseBlockersInput {
                attackers,
                available_blocker_ids,
                ..
            }) => {
                let mut remaining = available_blocker_ids.clone();
                let mut assignments = Vec::new();
                let mut ordered_attackers = attackers.iter().collect::<Vec<_>>();
                ordered_attackers.sort_by_key(|attacker| {
                    std::cmp::Reverse(
                        self.card(&attacker.attacker_id)
                            .map_or(0, Self::card_value),
                    )
                });
                for attacker in ordered_attackers {
                    let need = attacker.min_blockers.max(1) as usize;
                    let attacker_card = self.card(&attacker.attacker_id);
                    let attacker_power = attacker_card
                        .and_then(|card| card.power.as_deref())
                        .and_then(|value| value.parse::<i32>().ok())
                        .unwrap_or(0);
                    let attacker_toughness = attacker_card
                        .and_then(|card| card.toughness.as_deref())
                        .and_then(|value| value.parse::<i32>().ok())
                        .unwrap_or(0);
                    let mut usable = remaining
                        .iter()
                        .filter(|blocker| attacker.valid_blocker_ids.contains(blocker))
                        .filter_map(|blocker| {
                            let card = self.card(blocker)?;
                            let power = card
                                .power
                                .as_deref()
                                .and_then(|value| value.parse::<i32>().ok())
                                .unwrap_or(0);
                            let toughness = card
                                .toughness
                                .as_deref()
                                .and_then(|value| value.parse::<i32>().ok())
                                .unwrap_or(0);
                            let profitable = toughness > attacker_power
                                || power >= attacker_toughness
                                || card
                                    .keywords
                                    .iter()
                                    .any(|keyword| keyword.eq_ignore_ascii_case("deathtouch"));
                            (profitable || attacker.must_be_blocked)
                                .then_some((blocker.clone(), Self::card_value(card)))
                        })
                        .collect::<Vec<_>>();
                    usable.sort_by_key(|(_, value)| *value);
                    if usable.len() < need {
                        continue;
                    }
                    for (blocker_id, _) in usable.into_iter().take(need) {
                        remaining.retain(|blocker| blocker != &blocker_id);
                        assignments.push(BlockAssignment {
                            blocker_id,
                            attacker_id: attacker.attacker_id.clone(),
                        });
                    }
                }
                Some(PromptOutput::ChooseBlockers(ChooseBlockersOutput::DeclareBlockers { assignments }))
            }
            PromptInput::ChooseBoardTargets(manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
                candidates, hostile, min_targets, max_targets, chosen_targets, ..
            }) => {
                let take = (max_targets - chosen_targets).max(min_targets - chosen_targets).max(0)
                    as usize;
                let mut candidates = candidates;
                candidates.sort_by_key(|target| {
                    std::cmp::Reverse(self.target_score(target, &deciding_player_id, hostile))
                });
                Some(PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::BoardTargets {
                    chosen: candidates.into_iter().take(take).collect(),
                }))
            }
            PromptInput::Scry(manabrew_protocol::prompts::scry::ScryInput { cards, zones, .. }) => {
                // Keep everything on top (zone 0), nothing elsewhere.
                let mut zone_card_ids = vec![Vec::new(); zones.len()];
                if let Some(first) = zone_card_ids.first_mut() {
                    *first = cards.iter().map(|c| c.id.clone()).collect();
                }
                Some(PromptOutput::Scry(ScryOutput::ScryDecision { zone_card_ids }))
            }
            PromptInput::RevealCards(manabrew_protocol::prompts::reveal::RevealCardsInput { .. }) => Some(PromptOutput::RevealCards(RevealCardsOutput::RevealCardsAcknowledged)),
            PromptInput::ChooseBoolean(manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput {
                presentation,
                confirm_label,
                deny_label,
            }) => {
                let signature = format!(
                    "bool:{prompt_source_id}|{}|{confirm_label}|{deny_label}",
                    presentation.title
                );
                let repeated = self.looping_on(signature);
                let title = presentation.title.to_ascii_lowercase();
                let always_accept = title.contains("cancel search")
                    || (title.contains("commander")
                        && title.contains("put it into the command zone"));
                let constructed_duel = self.is_constructed_duel();
                let duel_cost = title.starts_with("pay 1 life")
                    || title.starts_with("pay 2 life")
                    || title.starts_with("pay {e}")
                    || title.starts_with("pay return an artifact")
                    || title.starts_with("sacrifice ");
                let accept_once = title.contains("search your library?")
                    || (constructed_duel && duel_cost)
                    || title.contains("sacrifice evolving wilds")
                    || title.contains("sacrifice bountiful landscape")
                    || title.contains("sacrifice strip mine")
                    || title.contains("exile simian spirit guide")
                    || title.starts_with("use triggered ability");
                let value = always_accept || (accept_once && !repeated);
                Some(PromptOutput::ChooseBoolean(ChooseBooleanOutput::Decision { value }))
            }
            PromptInput::ChooseFromSelection(manabrew_protocol::prompts::choose_from_selection::ChooseFromSelectionInput {
                presentation,
                options,
                min_total,
                max_total,
            }) => {
                let signature =
                    format!("select:{}|{min_total}|{max_total}|{}", presentation.title, options.len());
                let search = presentation.title.to_ascii_lowercase().contains("search");
                let target = if search || self.looping_on(signature) {
                    max_total
                } else {
                    min_total
                };
                let mut chosen_indices = Vec::new();
                let mut total = 0;
                while total < target {
                    let before = total;
                    for (index, option) in options.iter().enumerate() {
                        if total + option.weight > target {
                            continue;
                        }
                        if !option.can_repeat && chosen_indices.contains(&index) {
                            continue;
                        }
                        chosen_indices.push(index);
                        total += option.weight;
                        if total == target {
                            break;
                        }
                    }
                    if total == before {
                        break;
                    }
                }
                Some(PromptOutput::ChooseFromSelection(ChooseFromSelectionOutput::SelectionDecision {
                    chosen_indices,
                }))
            }
            PromptInput::ChooseColor(manabrew_protocol::prompts::choose_color::ChooseColorInput { valid_colors, amount, repeat_allowed, .. }) => {
                let mut chosen: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();
                if repeat_allowed {
                    if let Some(c) = valid_colors.first() {
                        chosen.insert(c.clone(), amount);
                    }
                } else {
                    for c in valid_colors.iter().take(amount as usize) {
                        chosen.insert(c.clone(), 1);
                    }
                }
                Some(PromptOutput::ChooseColor(ChooseColorOutput::ColorDecision {
                    chosen_colors: chosen,
                }))
            }
            PromptInput::ChooseNumber(manabrew_protocol::prompts::choose_number::ChooseNumberInput { min, max, .. }) => Some(PromptOutput::ChooseNumber(ChooseNumberOutput::NumberDecision {
                chosen_number: Some(min.max(1).min(max)),
            })),
            PromptInput::ChooseDamageAssignmentOrder(manabrew_protocol::prompts::choose_damage_assignment_order::ChooseDamageAssignmentOrderInput { mut blocker_ids, .. }) => {
                blocker_ids.sort_by_key(|blocker_id| {
                    self.card(blocker_id)
                        .and_then(|card| card.toughness.as_deref())
                        .and_then(|value| value.parse::<i32>().ok())
                        .unwrap_or(i32::MAX)
                });
                Some(PromptOutput::ChooseDamageAssignmentOrder(ChooseDamageAssignmentOrderOutput::DamageAssignmentOrderDecision {
                    ordered_blocker_ids: blocker_ids,
                }))
            }
            PromptInput::ChooseCombatDamageAssignment(manabrew_protocol::prompts::choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput {
                blocker_ids,
                defender_id,
                total_damage,
                attacker_has_deathtouch,
                ..
            }) => {
                let mut remaining = total_damage.max(0);
                let mut assignments = Vec::new();
                for blocker_id in &blocker_ids {
                    if remaining == 0 {
                        break;
                    }
                    let lethal = if attacker_has_deathtouch {
                        1
                    } else {
                        self.card(blocker_id)
                            .and_then(|card| card.toughness.as_deref().map(|value| (value, card.damage)))
                            .and_then(|(value, damage)| value.parse::<i32>().ok().map(|toughness| toughness - damage))
                            .unwrap_or(remaining)
                            .max(1)
                    };
                    let damage = remaining.min(lethal);
                    remaining -= damage;
                    assignments.push(CombatDamageAssignmentEntry {
                        assignee_id: blocker_id.clone(),
                        damage,
                    });
                }
                if remaining > 0 {
                    if let Some(defender_id) = defender_id {
                        assignments.push(CombatDamageAssignmentEntry {
                            assignee_id: defender_id,
                            damage: remaining,
                        });
                    } else if let Some(last) = assignments.last_mut() {
                        last.damage += remaining;
                    }
                }
                Some(PromptOutput::ChooseCombatDamageAssignment(ChooseCombatDamageAssignmentOutput::CombatDamageAssignmentDecision { assignments }))
            }
            PromptInput::PayManaCost(input) => {
                let waterbend = input.actions.iter().find(|action| {
                    matches!(
                        &action.kind,
                        manabrew_protocol::prompts::common::PaymentActionKind::UseResource {
                            resource:
                                manabrew_protocol::prompts::common::PaymentResourceKind::Waterbend,
                            ..
                        }
                    )
                });
                let payment = if input.can_confirm_from_pool {
                    self.failed_attack_targets.clear();
                    PayManaCostOutput::Pay { auto: false }
                } else if let Some(action) = waterbend {
                    PayManaCostOutput::Act {
                        action_id: action.id.clone(),
                    }
                } else {
                    if input.actions.is_empty()
                        || self.payment_attempt.as_deref() == Some(input.card_id.as_str())
                    {
                        self.fail_attack_target(&input.card_id);
                        self.payment_attempt = None;
                        PayManaCostOutput::Cancel
                    } else {
                        self.payment_attempt = Some(input.card_id.clone());
                        PayManaCostOutput::Pay { auto: true }
                    }
                };
                Some(PromptOutput::PayManaCost(payment))
            }
            PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
                presentation,
                mut cards,
                min,
                max,
            }) => {
                let title = presentation.title.to_ascii_lowercase();
                let discard = title.contains("discard");
                let hand_reorder = prompt_source_text.contains("from your hand on top")
                    || prompt_source_text.contains("from your hand on the bottom");
                let prefer_low = title.contains("sacrifice")
                    || discard
                    || title.contains("graveyard")
                    || title.contains("bottom")
                    || title.contains("kor skyfisher")
                    || title.contains("glint hawk")
                    || hand_reorder;
                cards.sort_by_key(|card| {
                    let value = Self::card_value(card);
                    if prefer_low { value } else { -value }
                });
                let count = if (discard || hand_reorder) && min == 0 {
                    max
                } else if prefer_low {
                    min
                } else {
                    max
                };
                Some(PromptOutput::ChooseCards(ChooseCardsOutput::ChooseCardsDecision {
                    chosen_card_ids: cards.iter().take(count).map(|card| card.id.clone()).collect(),
                }))
            }
            PromptInput::Reorder(manabrew_protocol::prompts::reorder::ReorderInput { items, .. }) => {
                Some(PromptOutput::Reorder(ReorderOutput::ReorderDecision {
                    ordered_ids: items.iter().map(|item| item.id.clone()).collect(),
                }))
            }
            PromptInput::GameOver(manabrew_protocol::prompts::game_over::GameOverInput { .. }) => None,
            // Display-only acknowledgements: the engine `await`s these so
            // every transport must produce an ack — keeps the engine's
            // broadcast loop polymorphic (no `if is_human` branching).
            PromptInput::DiceRolled(_) => Some(PromptOutput::DiceRolled(
                DiceRolledOutput::DiceRolledAcknowledged,
            )),
        }
    }
}
