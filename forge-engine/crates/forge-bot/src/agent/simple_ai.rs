use forge_agent_interface::prompt::{
    AgentPrompt, AgentPromptInner, AttackAssignment, BlockAssignment, CombatDamageAssignmentEntry,
    PlayerAction, TargetAnyChoice,
};
use forge_engine_core::player::actions::PlayerAction as EnginePlayerAction;

use super::BotAgent;

/// Baseline AI: casts spells when possible, otherwise passes priority, with a
/// memoized anti-loop heuristic so a stuck `ChooseAction` doesn't repeat the
/// same non-pass choice indefinitely.
#[derive(Default)]
pub struct SimpleAi {
    last_choose_action_signature: Option<String>,
    last_choose_action_choice: Option<EnginePlayerAction>,
}

impl SimpleAi {
    pub fn new() -> Self {
        Self::default()
    }
}

impl BotAgent for SimpleAi {
    fn decide(&mut self, prompt: AgentPrompt) -> Option<PlayerAction> {
        match prompt.input {
            AgentPromptInner::Mulligan { .. } => {
                Some(PlayerAction::MulliganDecision { keep: true })
            }
            AgentPromptInner::MulliganPutBack {
                hand_card_ids,
                count,
                ..
            } => Some(PlayerAction::MulliganPutBackDecision {
                card_ids: hand_card_ids.into_iter().take(count).collect(),
            }),
            AgentPromptInner::ChooseAction {
                available_player_actions,
                playable_options,
                ..
            } if available_player_actions.is_empty() => {
                let signature = format!("{playable_options:?}");
                let repeated =
                    self.last_choose_action_signature.as_deref() == Some(signature.as_str());
                self.last_choose_action_signature = Some(signature);
                match playable_options.first() {
                    Some(option) if !repeated => Some(PlayerAction::PlayCard {
                        card_id: option.card_id.clone(),
                        mode: Some(option.mode.clone()),
                    }),
                    _ => Some(PlayerAction::Pass { until_phase: None }),
                }
            }
            AgentPromptInner::ChooseAction {
                available_player_actions,
                ..
            } => {
                let signature = format!("{available_player_actions:?}");
                let repeated_same_prompt =
                    self.last_choose_action_signature.as_deref() == Some(signature.as_str());
                let avoid_last_choice = repeated_same_prompt
                    && !matches!(
                        self.last_choose_action_choice,
                        Some(EnginePlayerAction::PassPriority)
                    );
                let chosen = available_player_actions
                    .iter()
                    .copied()
                    .filter(|action| {
                        !avoid_last_choice || Some(*action) != self.last_choose_action_choice
                    })
                    .find(|action| matches!(action, EnginePlayerAction::CastSpell(_)))
                    .or_else(|| {
                        available_player_actions
                            .iter()
                            .copied()
                            .filter(|action| {
                                !avoid_last_choice
                                    || Some(*action) != self.last_choose_action_choice
                            })
                            .find(|action| matches!(action, EnginePlayerAction::PassPriority))
                    })
                    .or_else(|| {
                        available_player_actions.iter().copied().find(|action| {
                            !avoid_last_choice || Some(*action) != self.last_choose_action_choice
                        })
                    })
                    .or_else(|| available_player_actions.first().copied());
                self.last_choose_action_signature = Some(signature);
                self.last_choose_action_choice = chosen;
                Some(
                    chosen
                        .map(|action| PlayerAction::EngineAction { action })
                        .unwrap_or(PlayerAction::Pass { until_phase: None }),
                )
            }
            AgentPromptInner::ChooseAttackers {
                available_attacker_ids,
                possible_defender_ids,
                ..
            } => {
                let default_defender = possible_defender_ids
                    .first()
                    .map(|d| d.id.clone())
                    .unwrap_or_else(|| "player-1".to_string());
                Some(PlayerAction::DeclareAttackers {
                    assignments: available_attacker_ids
                        .into_iter()
                        .map(|attacker_id| AttackAssignment {
                            attacker_id,
                            defender_id: default_defender.clone(),
                        })
                        .collect(),
                })
            }
            AgentPromptInner::ChooseBlockers {
                attacker_ids,
                available_blocker_ids,
                ..
            } => {
                let assignments = if !attacker_ids.is_empty() && !available_blocker_ids.is_empty() {
                    vec![BlockAssignment {
                        blocker_id: available_blocker_ids[0].clone(),
                        attacker_id: attacker_ids[0].clone(),
                    }]
                } else {
                    Vec::new()
                };
                Some(PlayerAction::DeclareBlockers { assignments })
            }
            AgentPromptInner::ChooseTargetPlayer {
                valid_player_ids, ..
            } => Some(PlayerAction::TargetPlayer {
                player_id: valid_player_ids.first().cloned(),
            }),
            AgentPromptInner::ChooseTargetCard { valid_card_ids, .. }
            | AgentPromptInner::ChooseTargetCardFromZone { valid_card_ids, .. } => {
                Some(PlayerAction::TargetCard {
                    card_id: valid_card_ids.first().cloned(),
                })
            }
            AgentPromptInner::ChooseTargetAny {
                valid_player_ids,
                valid_card_ids,
                ..
            } => {
                let target = if let Some(card_id) = valid_card_ids.first() {
                    TargetAnyChoice::Card {
                        card_id: card_id.clone(),
                    }
                } else if let Some(player_id) = valid_player_ids.first() {
                    TargetAnyChoice::Player {
                        player_id: player_id.clone(),
                    }
                } else {
                    TargetAnyChoice::None
                };
                Some(PlayerAction::TargetAny { target })
            }
            AgentPromptInner::Scry { .. } => Some(PlayerAction::ScryDecision {
                bottom_card_ids: Vec::new(),
            }),
            AgentPromptInner::Surveil { .. } => Some(PlayerAction::SurveilDecision {
                graveyard_card_ids: Vec::new(),
            }),
            AgentPromptInner::Dig {
                card_ids,
                num_to_take,
                ..
            } => Some(PlayerAction::DigDecision {
                chosen_card_ids: card_ids.into_iter().take(num_to_take).collect(),
            }),
            AgentPromptInner::ChooseDiscard {
                hand_card_ids,
                num_to_discard,
                ..
            } => Some(PlayerAction::DiscardDecision {
                discarded_card_ids: hand_card_ids.into_iter().take(num_to_discard).collect(),
            }),
            AgentPromptInner::ChooseTargetSpell {
                valid_spell_ids, ..
            } => Some(PlayerAction::TargetSpell {
                spell_id: valid_spell_ids.first().cloned(),
            }),
            AgentPromptInner::ChooseMode {
                options,
                min_choices,
                ..
            } => Some(PlayerAction::ModeDecision {
                chosen_indices: (0..min_choices.min(options.len())).collect(),
            }),
            AgentPromptInner::RevealCards { .. } => Some(PlayerAction::RevealCardsAcknowledged),
            AgentPromptInner::ChooseOptionalTrigger { .. } => {
                Some(PlayerAction::OptionalTriggerDecision { accept: true })
            }
            AgentPromptInner::PayCostToPreventEffect { .. } => {
                Some(PlayerAction::PayCostToPreventEffectDecision { accept: true })
            }
            AgentPromptInner::ChoosePhyrexian { .. } => {
                Some(PlayerAction::PhyrexianDecision { pay_life: false })
            }
            AgentPromptInner::ChooseKicker { .. } => {
                Some(PlayerAction::KickerDecision { kicked: false })
            }
            AgentPromptInner::ChooseBuyback { .. } => Some(PlayerAction::BuybackDecision {
                buyback_paid: false,
            }),
            AgentPromptInner::ChooseMultikicker { .. } => {
                Some(PlayerAction::MultikickerDecision { kick_count: 0 })
            }
            AgentPromptInner::ChooseReplicate { .. } => {
                Some(PlayerAction::ReplicateDecision { replicate_count: 0 })
            }
            AgentPromptInner::ChooseAlternativeCost { .. } => {
                Some(PlayerAction::AlternativeCostDecision { chosen_index: 0 })
            }
            AgentPromptInner::ChooseColor { valid_colors, .. } => {
                Some(PlayerAction::ColorDecision {
                    color: valid_colors.first().cloned(),
                })
            }
            AgentPromptInner::ChooseType { valid_types, .. } => Some(PlayerAction::TypeDecision {
                chosen_type: valid_types.first().cloned(),
            }),
            AgentPromptInner::ChooseNumber { min, .. } => Some(PlayerAction::NumberDecision {
                chosen_number: Some(min),
            }),
            AgentPromptInner::ChooseCardName { valid_names, .. } => {
                Some(PlayerAction::CardNameDecision {
                    chosen_name: valid_names.first().cloned(),
                })
            }
            AgentPromptInner::ChooseCardsForEffect {
                valid_card_ids,
                max_choices,
                ..
            } => Some(PlayerAction::ChooseCardsDecision {
                chosen_card_ids: valid_card_ids.into_iter().take(max_choices).collect(),
            }),
            AgentPromptInner::ChooseDamageAssignmentOrder { blocker_ids, .. } => {
                Some(PlayerAction::DamageAssignmentOrderDecision {
                    ordered_blocker_ids: blocker_ids,
                })
            }
            AgentPromptInner::ChooseCombatDamageAssignment {
                blocker_ids,
                total_damage,
                ..
            } => {
                let mut assignments = Vec::new();
                if let Some(first) = blocker_ids.first() {
                    assignments.push(CombatDamageAssignmentEntry {
                        assignee_id: first.clone(),
                        damage: total_damage.max(0),
                    });
                }
                Some(PlayerAction::CombatDamageAssignmentDecision { assignments })
            }
            AgentPromptInner::PayCombatCost {
                tappable_land_ids,
                mana_pool_total,
                cost,
                ..
            } => {
                if mana_pool_total >= cost {
                    Some(PlayerAction::PayCombatCost)
                } else if !tappable_land_ids.is_empty() {
                    Some(PlayerAction::TapLand {
                        card_id: tappable_land_ids[0].clone(),
                        ability_index: None,
                        color: None,
                    })
                } else {
                    Some(PlayerAction::DeclineCombatCost)
                }
            }
            AgentPromptInner::PayManaCost { .. } => Some(PlayerAction::PayManaCost { auto: true }),
            AgentPromptInner::ChooseDelve {
                valid_card_ids,
                max_cards,
                ..
            } => Some(PlayerAction::DelveDecision {
                chosen_card_ids: valid_card_ids.into_iter().take(max_cards).collect(),
            }),
            AgentPromptInner::ChooseConvoke { .. } => Some(PlayerAction::ConvokeDecision {
                chosen_card_ids: vec![],
            }),
            AgentPromptInner::ChooseImprovise { .. } => Some(PlayerAction::ImproviseDecision {
                chosen_card_ids: vec![],
            }),
            AgentPromptInner::SpecifyManaCombo {
                available_colors,
                amount,
                ..
            } => {
                let color = available_colors
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "C".to_string());
                Some(PlayerAction::ManaComboDecision {
                    chosen_colors: vec![color; amount],
                })
            }
            AgentPromptInner::ChooseExertAttackers { .. } => Some(PlayerAction::ExertDecision {
                chosen_attacker_ids: vec![],
            }),
            AgentPromptInner::ChooseEnlistAttackers { .. } => Some(PlayerAction::EnlistDecision {
                chosen_attacker_ids: vec![],
            }),
            AgentPromptInner::ReorderLibrary { card_ids, .. } => {
                Some(PlayerAction::ReorderLibraryDecision {
                    ordered_card_ids: card_ids,
                })
            }
            AgentPromptInner::ExploreDecision { .. } => Some(PlayerAction::ExploreResponse {
                put_in_graveyard: false,
            }),
            AgentPromptInner::HelpPayAssist { .. } => {
                Some(PlayerAction::AssistDecision { amount_to_pay: 0 })
            }
            AgentPromptInner::GameOver { .. } => None,
            // Display-only acknowledgements: the engine `await`s these so
            // every transport must produce an ack — keeps the engine's
            // broadcast loop polymorphic (no `if is_human` branching).
            AgentPromptInner::DiceRolled { .. } => Some(PlayerAction::DiceRolledAcknowledged),
            AgentPromptInner::FirstPlayerRoll { .. } => {
                Some(PlayerAction::FirstPlayerRollAcknowledged)
            }
            AgentPromptInner::ChooseRollToIgnore { rolls, .. } => {
                Some(PlayerAction::RollToIgnoreDecision {
                    roll: rolls.first().copied(),
                })
            }
            AgentPromptInner::ChooseRollToSwap { rolls, .. } => {
                Some(PlayerAction::RollToSwapDecision {
                    roll: rolls.first().copied(),
                })
            }
            AgentPromptInner::ChooseRollToModify { rolls, .. } => {
                Some(PlayerAction::RollToModifyDecision {
                    roll: rolls.first().copied(),
                })
            }
            AgentPromptInner::ChooseDiceToReroll { .. } => {
                Some(PlayerAction::DiceToRerollDecision { rolls: Vec::new() })
            }
            AgentPromptInner::ChooseRollSwapValue { .. } => {
                Some(PlayerAction::RollSwapValueDecision {
                    choice: Some("power".to_string()),
                })
            }
        }
    }
}
