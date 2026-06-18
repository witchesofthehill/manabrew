use manabrew_agent_interface::prompt::{
    AgentPrompt, AttackAssignment, AvailableAction, AvailableActionKind, BlockAssignment,
    CombatDamageAssignmentEntry, PlayerAction, PromptInput,
};

use super::BotAgent;

/// Baseline AI: casts spells when possible, otherwise passes priority, with a
/// memoized anti-loop heuristic so a stuck `ChooseAction` doesn't repeat the
/// same non-pass choice indefinitely.
#[derive(Default)]
pub struct SimpleAi {
    last_choose_action_signature: Option<String>,
    last_choose_action_choice: Option<String>,
}

impl SimpleAi {
    pub fn new() -> Self {
        Self::default()
    }
}

impl BotAgent for SimpleAi {
    fn decide(&mut self, prompt: AgentPrompt) -> Option<PlayerAction> {
        match prompt.input {
        PromptInput::Mulligan(manabrew_protocol::prompts::mulligan::MulliganInput { .. }) => {
                Some(PlayerAction::MulliganDecision { keep: true })
            }
            PromptInput::MulliganPutBack(manabrew_protocol::prompts::mulligan_put_back::MulliganPutBackInput {
                hand_card_ids,
                count,
                ..
            }) => Some(PlayerAction::MulliganPutBackDecision {
                card_ids: hand_card_ids.into_iter().take(count).collect(),
            }),
            PromptInput::ChooseAction(manabrew_protocol::prompts::choose_action::ChooseActionInput { actions }) => {
                let signature = format!("{actions:?}");
                let repeated =
                    self.last_choose_action_signature.as_deref() == Some(signature.as_str());
                let avoid = if repeated {
                    self.last_choose_action_choice.clone()
                } else {
                    None
                };

                // Important: skip mana actions
                let useful = |a: &&AvailableAction| {
                    !matches!(
                        a.kind,
                        AvailableActionKind::UndoMana { .. }
                            | AvailableActionKind::ActivateAbility {
                                is_mana_ability: true,
                                ..
                            }
                    )
                };
                let allowed = |a: &&AvailableAction| Some(&a.id) != avoid.as_ref() && useful(a);
                let pick = actions
                    .iter()
                    .filter(allowed)
                    .find(|a| matches!(a.kind, AvailableActionKind::Cast { .. }))
                    .or_else(|| actions.iter().find(allowed))
                    .map(|a| a.id.clone());
                self.last_choose_action_signature = Some(signature);
                self.last_choose_action_choice = pick.clone();
                Some(
                    pick.map(|action_id| PlayerAction::Act { action_id })
                        .unwrap_or(PlayerAction::Pass { until_phase: None }),
                )
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
                Some(PlayerAction::DeclareAttackers {
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
                })
            }
            PromptInput::ChooseBlockers(manabrew_protocol::prompts::choose_blockers::ChooseBlockersInput {
                attackers,
                available_blocker_ids,
                ..
            }) => {
                let assignments = if !attackers.is_empty() && !available_blocker_ids.is_empty() {
                    vec![BlockAssignment {
                        blocker_id: available_blocker_ids[0].clone(),
                        attacker_id: attackers[0].attacker_id.clone(),
                    }]
                } else {
                    Vec::new()
                };
                Some(PlayerAction::DeclareBlockers { assignments })
            }
            PromptInput::ChooseBoardTargets(manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
                candidates, min_targets, chosen_targets, ..
            }) => Some(PlayerAction::BoardTargets {
                chosen: if chosen_targets < min_targets {
                    candidates.into_iter().take(1).collect()
                } else {
                    Vec::new()
                },
            }),
            PromptInput::Scry(manabrew_protocol::prompts::scry::ScryInput { .. }) => Some(PlayerAction::ScryDecision {
                bottom_card_ids: Vec::new(),
            }),
            PromptInput::Surveil(manabrew_protocol::prompts::surveil::SurveilInput { .. }) => Some(PlayerAction::SurveilDecision {
                graveyard_card_ids: Vec::new(),
            }),
            PromptInput::Dig(manabrew_protocol::prompts::dig::DigInput {
                card_ids,
                num_to_take,
                ..
            }) => Some(PlayerAction::DigDecision {
                chosen_card_ids: card_ids.into_iter().take(num_to_take).collect(),
            }),
            PromptInput::ChooseDiscard(manabrew_protocol::prompts::choose_discard::ChooseDiscardInput {
                hand_card_ids,
                num_to_discard,
                ..
            }) => Some(PlayerAction::DiscardDecision {
                discarded_card_ids: hand_card_ids.into_iter().take(num_to_discard).collect(),
            }),
            PromptInput::RevealCards(manabrew_protocol::prompts::reveal_cards::RevealCardsInput { .. }) => Some(PlayerAction::RevealCardsAcknowledged),
            PromptInput::ChooseBoolean(manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput { .. }) => {
                Some(PlayerAction::Decision { value: false })
            }
            PromptInput::ChooseFromSelection(manabrew_protocol::prompts::choose_from_selection::ChooseFromSelectionInput { options, min_choices, .. }) => {
                Some(PlayerAction::SelectionDecision {
                    chosen_indices: (0..min_choices.min(options.len())).collect(),
                })
            }
            PromptInput::ChooseMultikicker(manabrew_protocol::prompts::choose_multikicker::ChooseMultikickerInput { .. }) => {
                Some(PlayerAction::MultikickerDecision { kick_count: 0 })
            }
            PromptInput::ChooseReplicate(manabrew_protocol::prompts::choose_replicate::ChooseReplicateInput { .. }) => {
                Some(PlayerAction::ReplicateDecision { replicate_count: 0 })
            }
            PromptInput::ChooseColor(manabrew_protocol::prompts::choose_color::ChooseColorInput { valid_colors, .. }) => {
                Some(PlayerAction::ColorDecision {
                    color: valid_colors.first().cloned(),
                })
            }
            PromptInput::ChooseType(manabrew_protocol::prompts::choose_type::ChooseTypeInput { valid_types, .. }) => Some(PlayerAction::TypeDecision {
                chosen_type: valid_types.first().cloned(),
            }),
            PromptInput::ChooseNumber(manabrew_protocol::prompts::choose_number::ChooseNumberInput { min, .. }) => Some(PlayerAction::NumberDecision {
                chosen_number: Some(min),
            }),
            PromptInput::ChooseCardName(manabrew_protocol::prompts::choose_card_name::ChooseCardNameInput { valid_names, .. }) => {
                Some(PlayerAction::CardNameDecision {
                    chosen_name: valid_names.first().cloned(),
                })
            }
            PromptInput::ChooseCardsForEffect(manabrew_protocol::prompts::choose_cards_for_effect::ChooseCardsForEffectInput {
                valid_card_ids,
                max_choices,
                ..
            }) => Some(PlayerAction::ChooseCardsDecision {
                chosen_card_ids: valid_card_ids.into_iter().take(max_choices).collect(),
            }),
            PromptInput::ChooseDamageAssignmentOrder(manabrew_protocol::prompts::choose_damage_assignment_order::ChooseDamageAssignmentOrderInput { blocker_ids, .. }) => {
                Some(PlayerAction::DamageAssignmentOrderDecision {
                    ordered_blocker_ids: blocker_ids,
                })
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
                Some(PlayerAction::CombatDamageAssignmentDecision { assignments })
            }
            PromptInput::PayCombatCost(manabrew_protocol::prompts::pay_combat_cost::PayCombatCostInput {
                tappable_source_ids,
                mana_pool_total,
                cost,
                ..
            }) => {
                if mana_pool_total >= cost {
                    Some(PlayerAction::PayCombatCost)
                } else if !tappable_source_ids.is_empty() {
                    Some(PlayerAction::TapForMana {
                        card_id: tappable_source_ids[0].clone(),
                        ability_index: None,
                        color: None,
                    })
                } else {
                    Some(PlayerAction::DeclineCombatCost)
                }
            }
            PromptInput::PayManaCost(manabrew_protocol::prompts::pay_mana_cost::PayManaCostInput { .. }) => Some(PlayerAction::PayManaCost { auto: true }),
            PromptInput::ChooseDelve(manabrew_protocol::prompts::choose_delve::ChooseDelveInput {
                valid_card_ids,
                max_cards,
                ..
            }) => Some(PlayerAction::DelveDecision {
                chosen_card_ids: valid_card_ids.into_iter().take(max_cards).collect(),
            }),
            PromptInput::SpecifyManaCombo(manabrew_protocol::prompts::specify_mana_combo::SpecifyManaComboInput {
                available_colors,
                amount,
                ..
            }) => {
                let color = available_colors
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "C".to_string());
                Some(PlayerAction::ManaComboDecision {
                    chosen_colors: vec![color; amount],
                })
            }
            PromptInput::ReorderLibrary(manabrew_protocol::prompts::reorder_library::ReorderLibraryInput { card_ids, .. }) => {
                Some(PlayerAction::ReorderLibraryDecision {
                    ordered_card_ids: card_ids,
                })
            }
            PromptInput::ExploreDecision(manabrew_protocol::prompts::explore_decision::ExploreDecisionInput { .. }) => Some(PlayerAction::ExploreResponse {
                put_in_graveyard: false,
            }),
            PromptInput::HelpPayAssist(manabrew_protocol::prompts::help_pay_assist::HelpPayAssistInput { .. }) => {
                Some(PlayerAction::AssistDecision { amount_to_pay: 0 })
            }
            PromptInput::GameOver(manabrew_protocol::prompts::game_over::GameOverInput { .. }) => None,
            // Display-only acknowledgements: the engine `await`s these so
            // every transport must produce an ack — keeps the engine's
            // broadcast loop polymorphic (no `if is_human` branching).
            PromptInput::DiceRolled(manabrew_protocol::prompts::dice_rolled::DiceRolledInput { .. }) => Some(PlayerAction::DiceRolledAcknowledged),
            PromptInput::FirstPlayerRoll(manabrew_protocol::prompts::first_player_roll::FirstPlayerRollInput { .. }) => {
                Some(PlayerAction::FirstPlayerRollAcknowledged)
            }
        }
    }
}
