use std::collections::VecDeque;

use manabrew_agent_interface::prompt::*;

use super::BotAgent;

/// How many recent prompts to remember when detecting a stuck loop.
const LOOP_WINDOW: usize = 6;

fn bot_warn(msg: &str) {
    #[cfg(target_arch = "wasm32")]
    web_sys::console::warn_1(&format!("[wasm-bot] {msg}").into());
    #[cfg(not(target_arch = "wasm32"))]
    tracing::warn!(target: "wasm-bot", "{msg}");
}

/// Baseline AI: casts spells when possible, otherwise passes priority, with a
/// memoized anti-loop heuristic so a stuck `ChooseAction` doesn't repeat the
/// same non-pass choice indefinitely.
#[derive(Default)]
pub struct SimpleAi {
    recent_prompts: VecDeque<String>,
    last_attack_declaration: Vec<(String, String)>,
    failed_attack_targets: std::collections::HashSet<String>,
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
}

impl BotAgent for SimpleAi {
    fn decide(&mut self, prompt: AgentPrompt) -> Option<PromptOutput> {
        match prompt.input {
        PromptInput::Mulligan(manabrew_protocol::prompts::mulligan::MulliganInput { .. }) => {
                Some(PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep: true }))
            }
            PromptInput::MulliganPutBack(manabrew_protocol::prompts::mulligan_put_back::MulliganPutBackInput {
                hand_card_ids,
                count,
                ..
            }) => Some(PromptOutput::MulliganPutBack(MulliganPutBackOutput::MulliganPutBackDecision {
                card_ids: hand_card_ids.into_iter().take(count).collect(),
            })),
            PromptInput::ChooseAction(manabrew_protocol::prompts::choose_action::ChooseActionInput { actions }) => {
                let useful = |a: &&AvailableAction| {
                    !matches!(&a.kind, AvailableActionKind::UndoMana { .. })
                        && !matches!(
                            &a.kind,
                            AvailableActionKind::ActivateAbility(info) if info.is_mana_ability
                        )
                };
                let pick = if self.looping_on(format!("{actions:?}")) {
                    None
                } else {
                    actions
                        .iter()
                        .filter(useful)
                        .find(|a| matches!(a.kind, AvailableActionKind::Cast { .. }))
                        .or_else(|| actions.iter().find(useful))
                        .map(|a| a.id.clone())
                };
                Some(PromptOutput::ChooseAction(match pick {
                    Some(action_id) => ChooseActionOutput::Act { action_id },
                    None => ChooseActionOutput::Pass {
                        until: Some(PassUntil {
                            player_id: prompt.deciding_player_id.clone(),
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
                    .first()
                    .map(|t| t.id.clone())
                    .unwrap_or_else(|| "player-1".to_string());
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
                            .find(|t| !self.failed_attack_targets.contains(*t))
                        {
                            Some(t) => t.clone(),
                            None if a.valid_target_ids.is_empty() => default_target.clone(),
                            None => continue,
                        };
                        assignments.push(AttackAssignment {
                            attacker_id: a.attacker_id.clone(),
                            target_id,
                        });
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
                for attacker in &attackers {
                    let need = attacker.min_blockers.max(1) as usize;
                    let usable: Vec<String> = remaining
                        .iter()
                        .filter(|b| attacker.valid_blocker_ids.contains(b))
                        .take(need)
                        .cloned()
                        .collect();
                    if usable.len() < need {
                        continue;
                    }
                    for blocker_id in usable {
                        remaining.retain(|b| b != &blocker_id);
                        assignments.push(BlockAssignment {
                            blocker_id,
                            attacker_id: attacker.attacker_id.clone(),
                        });
                    }
                    break;
                }
                Some(PromptOutput::ChooseBlockers(ChooseBlockersOutput::DeclareBlockers { assignments }))
            }
            PromptInput::ChooseBoardTargets(manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
                candidates, min_targets, max_targets, chosen_targets, ..
            }) => {
                let signature = format!("targets:{min_targets}|{max_targets}|{}", candidates.len());
                let take = if self.looping_on(signature) {
                    (max_targets - chosen_targets).max(0) as usize
                } else if chosen_targets < min_targets {
                    1
                } else {
                    0
                };
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
                let signature = format!("bool:{}|{confirm_label}|{deny_label}", presentation.title);
                let value = self.looping_on(signature);
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
                let target = if self.looping_on(signature) { max_total } else { min_total };
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
            PromptInput::ChooseNumber(manabrew_protocol::prompts::choose_number::ChooseNumberInput { min, .. }) => Some(PromptOutput::ChooseNumber(ChooseNumberOutput::NumberDecision {
                chosen_number: Some(min),
            })),
            PromptInput::ChooseDamageAssignmentOrder(manabrew_protocol::prompts::choose_damage_assignment_order::ChooseDamageAssignmentOrderInput { blocker_ids, .. }) => {
                Some(PromptOutput::ChooseDamageAssignmentOrder(ChooseDamageAssignmentOrderOutput::DamageAssignmentOrderDecision {
                    ordered_blocker_ids: blocker_ids,
                }))
            }
            PromptInput::ChooseCombatDamageAssignment(manabrew_protocol::prompts::choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput {
                blocker_ids,
                total_damage,
                ..
            }) => {
                let mut assignments = Vec::new();
                if let Some(first) = blocker_ids.first() {
                    assignments.push(CombatDamageAssignmentEntry {
                        assignee_id: first.clone(),
                        damage: total_damage.max(0),
                    });
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
                    let signature = format!(
                        "pay:{}|{}|{}",
                        input.card_id,
                        input.mana_cost,
                        input
                            .actions
                            .iter()
                            .map(|action| action.id.as_str())
                            .collect::<Vec<_>>()
                            .join(",")
                    );
                    if input.actions.is_empty() || self.looping_on(signature) {
                        self.fail_attack_target(&input.card_id);
                        PayManaCostOutput::Cancel
                    } else {
                        PayManaCostOutput::Pay { auto: true }
                    }
                };
                Some(PromptOutput::PayManaCost(payment))
            }
            PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
                presentation,
                cards,
                min,
                max,
            }) => {
                let signature = format!("cards:{}|{min}|{max}|{}", presentation.title, cards.len());
                let take = if self.looping_on(signature) { max } else { min };
                Some(PromptOutput::ChooseCards(ChooseCardsOutput::ChooseCardsDecision {
                    chosen_card_ids: cards.iter().take(take).map(|c| c.id.clone()).collect(),
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
            PromptInput::DiceRolled(manabrew_protocol::prompts::dice_rolled::DiceRolledInput { .. }) => Some(PromptOutput::DiceRolled(DiceRolledOutput::DiceRolledAcknowledged)),
        }
    }
}
