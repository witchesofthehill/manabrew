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
        self.recent_prompts.push_back(signature);
        while self.recent_prompts.len() > LOOP_WINDOW {
            self.recent_prompts.pop_front();
        }
        seen
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
                Some(PromptOutput::ChooseAction(
                    pick.map(|action_id| ChooseActionOutput::Act { action_id })
                        .unwrap_or(ChooseActionOutput::Pass { until_phase: None }),
                ))
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
                Some(PromptOutput::ChooseAttackers(ChooseAttackersOutput::DeclareAttackers {
                    assignments: attackers
                        .into_iter()
                        .map(|a| AttackAssignment {
                            attacker_id: a.attacker_id,
                            target_id: a
                                .valid_target_ids
                                .first()
                                .cloned()
                                .unwrap_or_else(|| default_target.clone()),
                        })
                        .collect(),
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
                min_choices,
                max_choices,
            }) => {
                let signature =
                    format!("select:{}|{min_choices}|{max_choices}|{}", presentation.title, options.len());
                let take = if self.looping_on(signature) { max_choices } else { min_choices };
                Some(PromptOutput::ChooseFromSelection(ChooseFromSelectionOutput::SelectionDecision {
                    chosen_indices: (0..take.min(options.len())).collect(),
                }))
            }
            PromptInput::ChooseColor(manabrew_protocol::prompts::choose_color::ChooseColorInput { valid_colors, amount, repeat_allowed }) => {
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
                let can_pay = input.can_confirm_from_pool || !input.actions.is_empty();
                // auto-pay is one-shot: a failed attempt bounces the identical
                // prompt back, so a repeat means auto-pay can't complete — bail.
                let signature = format!(
                    "pay:{}|{}|{}",
                    input.card_id,
                    input.mana_cost,
                    input.actions.len()
                );
                let payment = if !can_pay || self.looping_on(signature) {
                    PayManaCostOutput::Cancel
                } else {
                    PayManaCostOutput::Pay { auto: true }
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
            PromptInput::ReorderCards(manabrew_protocol::prompts::reorder_cards::ReorderCardsInput { cards, .. }) => {
                Some(PromptOutput::ReorderCards(ReorderCardsOutput::ReorderDecision {
                    ordered_card_ids: cards.iter().map(|c| c.id.clone()).collect(),
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
