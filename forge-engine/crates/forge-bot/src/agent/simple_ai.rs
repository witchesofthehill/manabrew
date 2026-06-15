use forge_agent_interface::prompt::{
    AgentPrompt, AttackAssignment, AvailableAction, AvailableActionKind, BlockAssignment,
    CombatDamageAssignmentEntry, PlayerAction, PromptInput, TargetAnyChoice,
};
use forge_protocol::prompts::choose_roll_swap_value::RollSwapValue;

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
            PromptInput::Mulligan(forge_protocol::prompts::mulligan::MulliganInput { .. }) => {
                Some(PlayerAction::MulliganDecision { keep: true })
            }
            PromptInput::MulliganPutBack(forge_protocol::prompts::mulligan_put_back::MulliganPutBackInput {
                hand_card_ids,
                count,
                ..
            }) => Some(PlayerAction::MulliganPutBackDecision {
                card_ids: hand_card_ids.into_iter().take(count).collect(),
            }),
            PromptInput::ChooseAction(forge_protocol::prompts::choose_action::ChooseActionInput { actions }) => {
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
            PromptInput::ChooseAttackers(forge_protocol::prompts::choose_attackers::ChooseAttackersInput {
                available_attacker_ids,
                possible_defender_ids,
                ..
            }) => {
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
            PromptInput::ChooseBlockers(forge_protocol::prompts::choose_blockers::ChooseBlockersInput {
                attacker_ids,
                available_blocker_ids,
                ..
            }) => {
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
            PromptInput::ChooseTargetPlayer(forge_protocol::prompts::choose_target_player::ChooseTargetPlayerInput {
                valid_player_ids, ..
            }) => Some(PlayerAction::TargetPlayer {
                player_id: valid_player_ids.first().cloned(),
            }),
            PromptInput::ChooseTargetCard(forge_protocol::prompts::choose_target_card::ChooseTargetCardInput { valid_card_ids, .. })
            | PromptInput::ChooseTargetCardFromZone(forge_protocol::prompts::choose_target_card_from_zone::ChooseTargetCardFromZoneInput { valid_card_ids, .. }) => {
                Some(PlayerAction::TargetCard {
                    card_id: valid_card_ids.first().cloned(),
                })
            }
            PromptInput::ChooseTargetAny(forge_protocol::prompts::choose_target_any::ChooseTargetAnyInput {
                valid_player_ids,
                valid_card_ids,
                ..
            }) => {
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
            PromptInput::Scry(forge_protocol::prompts::scry::ScryInput { .. }) => Some(PlayerAction::ScryDecision {
                bottom_card_ids: Vec::new(),
            }),
            PromptInput::Surveil(forge_protocol::prompts::surveil::SurveilInput { .. }) => Some(PlayerAction::SurveilDecision {
                graveyard_card_ids: Vec::new(),
            }),
            PromptInput::Dig(forge_protocol::prompts::dig::DigInput {
                card_ids,
                num_to_take,
                ..
            }) => Some(PlayerAction::DigDecision {
                chosen_card_ids: card_ids.into_iter().take(num_to_take).collect(),
            }),
            PromptInput::ChooseDiscard(forge_protocol::prompts::choose_discard::ChooseDiscardInput {
                hand_card_ids,
                num_to_discard,
                ..
            }) => Some(PlayerAction::DiscardDecision {
                discarded_card_ids: hand_card_ids.into_iter().take(num_to_discard).collect(),
            }),
            PromptInput::ChooseTargetSpell(forge_protocol::prompts::choose_target_spell::ChooseTargetSpellInput {
                valid_spell_ids, ..
            }) => Some(PlayerAction::TargetSpell {
                spell_id: valid_spell_ids.first().cloned(),
            }),
            PromptInput::ChooseMode(forge_protocol::prompts::choose_mode::ChooseModeInput {
                options,
                min_choices,
                ..
            }) => Some(PlayerAction::ModeDecision {
                chosen_indices: (0..min_choices.min(options.len())).collect(),
            }),
            PromptInput::RevealCards(forge_protocol::prompts::reveal_cards::RevealCardsInput { .. }) => Some(PlayerAction::RevealCardsAcknowledged),
            PromptInput::ChooseOptionalTrigger(forge_protocol::prompts::choose_optional_trigger::ChooseOptionalTriggerInput { .. }) => {
                Some(PlayerAction::OptionalTriggerDecision { accept: true })
            }
            PromptInput::PayCostToPreventEffect(forge_protocol::prompts::pay_cost_to_prevent_effect::PayCostToPreventEffectInput { .. }) => {
                Some(PlayerAction::PayCostToPreventEffectDecision { accept: true })
            }
            PromptInput::ChoosePhyrexian(forge_protocol::prompts::choose_phyrexian::ChoosePhyrexianInput { .. }) => {
                Some(PlayerAction::PhyrexianDecision { pay_life: false })
            }
            PromptInput::ChooseKicker(forge_protocol::prompts::choose_kicker::ChooseKickerInput { .. }) => {
                Some(PlayerAction::KickerDecision { kicked: false })
            }
            PromptInput::ChooseBuyback(forge_protocol::prompts::choose_buyback::ChooseBuybackInput { .. }) => Some(PlayerAction::BuybackDecision {
                buyback_paid: false,
            }),
            PromptInput::ChooseMultikicker(forge_protocol::prompts::choose_multikicker::ChooseMultikickerInput { .. }) => {
                Some(PlayerAction::MultikickerDecision { kick_count: 0 })
            }
            PromptInput::ChooseReplicate(forge_protocol::prompts::choose_replicate::ChooseReplicateInput { .. }) => {
                Some(PlayerAction::ReplicateDecision { replicate_count: 0 })
            }
            PromptInput::ChooseAlternativeCost(forge_protocol::prompts::choose_alternative_cost::ChooseAlternativeCostInput { .. }) => {
                Some(PlayerAction::AlternativeCostDecision { chosen_index: 0 })
            }
            PromptInput::ChooseColor(forge_protocol::prompts::choose_color::ChooseColorInput { valid_colors, .. }) => {
                Some(PlayerAction::ColorDecision {
                    color: valid_colors.first().cloned(),
                })
            }
            PromptInput::ChooseType(forge_protocol::prompts::choose_type::ChooseTypeInput { valid_types, .. }) => Some(PlayerAction::TypeDecision {
                chosen_type: valid_types.first().cloned(),
            }),
            PromptInput::ChooseNumber(forge_protocol::prompts::choose_number::ChooseNumberInput { min, .. }) => Some(PlayerAction::NumberDecision {
                chosen_number: Some(min),
            }),
            PromptInput::ChooseCardName(forge_protocol::prompts::choose_card_name::ChooseCardNameInput { valid_names, .. }) => {
                Some(PlayerAction::CardNameDecision {
                    chosen_name: valid_names.first().cloned(),
                })
            }
            PromptInput::ChooseCardsForEffect(forge_protocol::prompts::choose_cards_for_effect::ChooseCardsForEffectInput {
                valid_card_ids,
                max_choices,
                ..
            }) => Some(PlayerAction::ChooseCardsDecision {
                chosen_card_ids: valid_card_ids.into_iter().take(max_choices).collect(),
            }),
            PromptInput::ChooseDamageAssignmentOrder(forge_protocol::prompts::choose_damage_assignment_order::ChooseDamageAssignmentOrderInput { blocker_ids, .. }) => {
                Some(PlayerAction::DamageAssignmentOrderDecision {
                    ordered_blocker_ids: blocker_ids,
                })
            }
            PromptInput::ChooseCombatDamageAssignment(forge_protocol::prompts::choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput {
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
            PromptInput::PayCombatCost(forge_protocol::prompts::pay_combat_cost::PayCombatCostInput {
                tappable_land_ids,
                mana_pool_total,
                cost,
                ..
            }) => {
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
            PromptInput::PayManaCost(forge_protocol::prompts::pay_mana_cost::PayManaCostInput { .. }) => Some(PlayerAction::PayManaCost { auto: true }),
            PromptInput::ChooseDelve(forge_protocol::prompts::choose_delve::ChooseDelveInput {
                valid_card_ids,
                max_cards,
                ..
            }) => Some(PlayerAction::DelveDecision {
                chosen_card_ids: valid_card_ids.into_iter().take(max_cards).collect(),
            }),
            PromptInput::ChooseConvoke(forge_protocol::prompts::choose_convoke::ChooseConvokeInput { .. }) => Some(PlayerAction::ConvokeDecision {
                chosen_card_ids: vec![],
            }),
            PromptInput::ChooseImprovise(forge_protocol::prompts::choose_improvise::ChooseImproviseInput { .. }) => Some(PlayerAction::ImproviseDecision {
                chosen_card_ids: vec![],
            }),
            PromptInput::SpecifyManaCombo(forge_protocol::prompts::specify_mana_combo::SpecifyManaComboInput {
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
            PromptInput::ChooseExertAttackers(forge_protocol::prompts::choose_exert_attackers::ChooseExertAttackersInput { .. }) => Some(PlayerAction::ExertDecision {
                chosen_attacker_ids: vec![],
            }),
            PromptInput::ChooseEnlistAttackers(forge_protocol::prompts::choose_enlist_attackers::ChooseEnlistAttackersInput { .. }) => Some(PlayerAction::EnlistDecision {
                chosen_attacker_ids: vec![],
            }),
            PromptInput::ReorderLibrary(forge_protocol::prompts::reorder_library::ReorderLibraryInput { card_ids, .. }) => {
                Some(PlayerAction::ReorderLibraryDecision {
                    ordered_card_ids: card_ids,
                })
            }
            PromptInput::ExploreDecision(forge_protocol::prompts::explore_decision::ExploreDecisionInput { .. }) => Some(PlayerAction::ExploreResponse {
                put_in_graveyard: false,
            }),
            PromptInput::HelpPayAssist(forge_protocol::prompts::help_pay_assist::HelpPayAssistInput { .. }) => {
                Some(PlayerAction::AssistDecision { amount_to_pay: 0 })
            }
            PromptInput::GameOver(forge_protocol::prompts::game_over::GameOverInput { .. }) => None,
            // Display-only acknowledgements: the engine `await`s these so
            // every transport must produce an ack — keeps the engine's
            // broadcast loop polymorphic (no `if is_human` branching).
            PromptInput::DiceRolled(forge_protocol::prompts::dice_rolled::DiceRolledInput { .. }) => Some(PlayerAction::DiceRolledAcknowledged),
            PromptInput::FirstPlayerRoll(forge_protocol::prompts::first_player_roll::FirstPlayerRollInput { .. }) => {
                Some(PlayerAction::FirstPlayerRollAcknowledged)
            }
            PromptInput::ChooseRollToIgnore(forge_protocol::prompts::choose_roll_to_ignore::ChooseRollToIgnoreInput { rolls, .. }) => {
                Some(PlayerAction::RollToIgnoreDecision {
                    roll: rolls.first().copied(),
                })
            }
            PromptInput::ChooseRollToSwap(forge_protocol::prompts::choose_roll_to_swap::ChooseRollToSwapInput { rolls, .. }) => {
                Some(PlayerAction::RollToSwapDecision {
                    roll: rolls.first().copied(),
                })
            }
            PromptInput::ChooseRollToModify(forge_protocol::prompts::choose_roll_to_modify::ChooseRollToModifyInput { rolls, .. }) => {
                Some(PlayerAction::RollToModifyDecision {
                    roll: rolls.first().copied(),
                })
            }
            PromptInput::ChooseDiceToReroll(forge_protocol::prompts::choose_dice_to_reroll::ChooseDiceToRerollInput { .. }) => {
                Some(PlayerAction::DiceToRerollDecision { rolls: Vec::new() })
            }
            PromptInput::ChooseRollSwapValue(forge_protocol::prompts::choose_roll_swap_value::ChooseRollSwapValueInput { .. }) => {
                Some(PlayerAction::RollSwapValueDecision {
                    choice: Some(RollSwapValue::Power),
                })
            }
        }
    }
}
