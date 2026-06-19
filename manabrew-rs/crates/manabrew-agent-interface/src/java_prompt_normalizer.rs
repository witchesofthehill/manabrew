use std::collections::HashMap;

use crate::game_view_dto::{
    CardDto, CombatAssignmentDto, GameViewDto, PlayerDto, StackObjectDto, StackTargetDto,
    StackTargetKindDto, TargetingIntent,
};
use crate::java_raw::{
    JavaAction, JavaActionError, JavaAttackAssignment, JavaBlockAssignment, JavaCombatAssignment,
    JavaRawAction, JavaRawCard, JavaRawCardData, JavaRawCardOption, JavaRawManaOption,
    JavaRawPrompt, JavaRawPromptBody, JavaRawSnapshot, JavaRawSnapshotPlayer, JavaRawStackEntry,
    JavaRawStackTarget, JavaTarget, JavaTargetKind,
};
use crate::mana_action_id::{
    parse_tap_action_id, payment_mana_ability_options, priority_mana_actions,
};
use crate::prompt::{
    ActivatableAbilityInfo, AgentPrompt, AttackTargetDto, AttackTargetKind, AvailableAction,
    AvailableActionKind, PlayerAction, PromptInput, StateUpdate, TargetRef,
};

pub fn make_java_game_over_prompt() -> AgentPrompt {
    AgentPrompt {
        deciding_player_id: String::new(),
        source_card_id: None,
        input: PromptInput::GameOver(manabrew_protocol::prompts::game_over::GameOverInput {}),
    }
}

pub fn make_java_state_update(
    snapshot: &JavaRawSnapshot,
    session_id: Option<&str>,
    viewer: usize,
) -> StateUpdate {
    StateUpdate {
        game_view: build_game_view(snapshot, session_id, viewer),
    }
}

pub fn normalize_java_prompt(prompt: JavaRawPrompt) -> AgentPrompt {
    let JavaRawPrompt {
        session_id,
        player,
        snapshot,
        body,
    } = prompt;

    let game_view = build_game_view(&snapshot, session_id.as_deref(), player);
    let card_index = index_view_cards(&game_view);

    let mut source_card_id = None;
    let inner = match body {
        JavaRawPromptBody::Priority {
            actions,
            untappable_land_ids,
        } => build_choose_action(&actions, untappable_land_ids),
        JavaRawPromptBody::ChooseDiscard { cards, min, max } => PromptInput::ChooseDiscard(manabrew_protocol::prompts::choose_discard::ChooseDiscardInput {
            hand_card_ids: card_ids(&cards),
            num_to_discard: if max > 0 {
                max
            } else if min > 0 {
                min
            } else {
                1
            },
        }),
        JavaRawPromptBody::Mulligan { cards, count } => PromptInput::Mulligan(manabrew_protocol::prompts::mulligan::MulliganInput {
            hand_card_ids: card_ids(&cards),
            mulligan_count: count,
        }),
        JavaRawPromptBody::MulliganPutBack { cards, count, max } => {
            PromptInput::MulliganPutBack(manabrew_protocol::prompts::mulligan_put_back::MulliganPutBackInput {
                hand_card_ids: card_ids(&cards),
                cards: prompt_cards(&cards, &card_index),
                count: if count > 0 { count } else { max },
            })
        }
        JavaRawPromptBody::RevealCards {
            cards,
            zone,
            owner_player_id,
            message,
        } => PromptInput::RevealCards(manabrew_protocol::prompts::reveal_cards::RevealCardsInput {
            cards: prompt_cards(&cards, &card_index),
            zone: zone.unwrap_or_else(|| "unknown".to_string()),
            owner_player_id: owner_player_id.unwrap_or_else(|| format!("player-{player}")),
            message: message.unwrap_or_else(|| "Look at these cards".to_string()),
        }),
        JavaRawPromptBody::FirstPlayerRoll {
            sides,
            rolls,
            winner_player_id,
        } => PromptInput::FirstPlayerRoll(manabrew_protocol::prompts::first_player_roll::FirstPlayerRollInput {
            sides,
            rolls: rolls
                .iter()
                .map(|roll| crate::prompt::FirstPlayerRollEntry {
                    player_id: roll.player_id.clone(),
                    player_name: roll.player_name.clone(),
                    value: roll.value,
                })
                .collect(),
            winner_player_id: winner_player_id.unwrap_or_else(|| format!("player-{player}")),
        }),
        JavaRawPromptBody::ChooseAttackers {
            attackers,
            defenders,
        } => {
            use manabrew_protocol::prompts::choose_attackers::AttackerOptionDto;
            let attack_targets = attack_targets(&defenders);
            let all_target_ids: Vec<String> =
                attack_targets.iter().map(|t| t.id.clone()).collect();
            let attackers = attackers
                .iter()
                .filter_map(|a| {
                    let attacker_id = a.id.clone()?;
                    Some(AttackerOptionDto {
                        attacker_id,
                        // Forge sends per-attacker legal targets; fall back to
                        // every target when it doesn't restrict them.
                        valid_target_ids: a
                            .valid_target_ids
                            .clone()
                            .unwrap_or_else(|| all_target_ids.clone()),
                    })
                })
                .collect();
            PromptInput::ChooseAttackers(
                manabrew_protocol::prompts::choose_attackers::ChooseAttackersInput {
                    attackers,
                    attack_targets,
                },
            )
        }
        JavaRawPromptBody::ChooseBlockers {
            attackers,
            blockers,
        } => {
            use manabrew_protocol::prompts::choose_blockers::BlockableAttackerDto;
            let available_blocker_ids = card_ids(&blockers);
            let attackers = attackers
                .iter()
                .filter_map(|a| {
                    let attacker_id = a.id.clone()?;
                    Some(BlockableAttackerDto {
                        attacker_id,
                        // Forge sends per-attacker legal blockers / menace /
                        // lure; fall back to permissive defaults when absent.
                        valid_blocker_ids: a
                            .valid_blocker_ids
                            .clone()
                            .unwrap_or_else(|| available_blocker_ids.clone()),
                        min_blockers: a.min_blockers.unwrap_or(1),
                        max_blockers: a.max_blockers,
                        must_be_blocked: a.must_be_blocked.unwrap_or(false),
                    })
                })
                .collect();
            PromptInput::ChooseBlockers(
                manabrew_protocol::prompts::choose_blockers::ChooseBlockersInput {
                    attackers,
                    available_blocker_ids,
                    error: None,
                },
            )
        }
        JavaRawPromptBody::ChooseDamageAssignmentOrder {
            attacker_id,
            blockers,
        } => PromptInput::ChooseDamageAssignmentOrder(manabrew_protocol::prompts::choose_damage_assignment_order::ChooseDamageAssignmentOrderInput {
            attacker_id: attacker_id.unwrap_or_default(),
            blocker_ids: card_ids(&blockers),
            blocker_cards: prompt_cards(&blockers, &card_index),
        }),
        JavaRawPromptBody::ChooseCombatDamageAssignment {
            attacker_id,
            defender_id,
            total_damage,
            attacker_has_deathtouch,
            blockers,
        } => PromptInput::ChooseCombatDamageAssignment(manabrew_protocol::prompts::choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput {
            attacker_id: attacker_id.unwrap_or_default(),
            blocker_ids: card_ids(&blockers),
            defender_id,
            total_damage: total_damage as i32,
            attacker_has_deathtouch,
        }),
        JavaRawPromptBody::ChooseCardsForEffect {
            cards,
            min,
            max,
            optional,
            source_card_name,
            description: _,
        } => PromptInput::ChooseCardsForEffect(manabrew_protocol::prompts::choose_cards_for_effect::ChooseCardsForEffectInput {
            valid_card_ids: card_ids(&cards),
            zone_cards: prompt_cards(&cards, &card_index),
            min_choices: min,
            max_choices: max,
            source_card_name,
            optional,
        }),
        JavaRawPromptBody::ChooseMode {
            options,
            min,
            max,
            source_card_name,
        } => PromptInput::ChooseFromSelection(
            manabrew_protocol::prompts::choose_from_selection::ChooseFromSelectionInput {
                presentation: manabrew_protocol::prompts::common::PromptPresentation {
                    title: source_card_name.unwrap_or_else(|| "Choose".to_string()),
                    description: None,
                    text: None,
                    source_card_id: None,
                    targets: Vec::new(),
                },
                options,
                min_choices: min,
                max_choices: max,
            },
        ),
        JavaRawPromptBody::ConfirmOrTrigger {
            description,
            source_card_id,
            prompt_kind: _,
            option_labels,
            mode: _,
            api: _,
        } => {
            let (deny, confirm) = match option_labels.as_slice() {
                [deny, confirm, ..] => (deny.clone(), confirm.clone()),
                _ => ("Decline".to_string(), "Accept".to_string()),
            };
            PromptInput::ChooseBoolean(manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput {
                presentation: manabrew_protocol::prompts::common::PromptPresentation {
                    title: description.unwrap_or_else(|| "Confirm?".to_string()),
                    description: None,
                    text: None,
                    source_card_id,
                    targets: Vec::new(),
                },
                confirm_label: confirm,
                deny_label: deny,
            })
        }
        JavaRawPromptBody::PayCostToPreventEffect {
            description,
            mode: _,
            source_card_id,
            api: _,
            targets,
            effect_text,
        } => {
            let cost_q = description
                .unwrap_or_else(|| "Pay cost".to_string())
                .replace(" Life", " {LIFE}")
                .replace(" life", " {LIFE}");
            let title = if cost_q.ends_with('?') {
                cost_q
            } else {
                format!("{cost_q}?")
            };
            let effect = effect_text
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty());
            PromptInput::ChooseBoolean(manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput {
                presentation: manabrew_protocol::prompts::common::PromptPresentation {
                    title,
                    description: None,
                    text: effect.map(|t| format!("otherwise: \"{t}\"")),
                    source_card_id,
                    targets: targets.into_iter().map(java_target_to_ref).collect(),
                },
                confirm_label: "Pay".to_string(),
                deny_label: "Decline".to_string(),
            })
        }
        JavaRawPromptBody::ChooseNumber {
            min,
            max,
            source_card_name: _,
            description: _,
        } => PromptInput::ChooseNumber(manabrew_protocol::prompts::choose_number::ChooseNumberInput {
            min: min as i32,
            max: max as i32,
        }),
        JavaRawPromptBody::ChooseColor {
            options,
            source_card_name: _,
        } => PromptInput::ChooseColor(manabrew_protocol::prompts::choose_color::ChooseColorInput {
            valid_colors: options,
        }),
        JavaRawPromptBody::ChooseType {
            options,
            description,
            source_card_name: _,
        } => PromptInput::ChooseType(manabrew_protocol::prompts::choose_type::ChooseTypeInput {
            type_category: description.unwrap_or_else(|| "Card".to_string()),
            valid_types: options,
        }),
        JavaRawPromptBody::ChooseCardName {
            options,
            source_card_name: _,
        } => PromptInput::ChooseCardName(manabrew_protocol::prompts::choose_card_name::ChooseCardNameInput {
            valid_names: options,
        }),
        JavaRawPromptBody::ChooseScry { cards } => PromptInput::Scry(manabrew_protocol::prompts::scry::ScryInput {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
        }),
        JavaRawPromptBody::ChooseSurveil { cards } => PromptInput::Surveil(manabrew_protocol::prompts::surveil::SurveilInput {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
        }),
        JavaRawPromptBody::ChooseDig {
            cards,
            max,
            optional,
            source_card_name: _,
        } => PromptInput::Dig(manabrew_protocol::prompts::dig::DigInput {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
            num_to_take: max,
            optional,
        }),
        JavaRawPromptBody::ChooseDelve {
            cards,
            max,
            source_card_name: _,
        } => PromptInput::ChooseDelve(manabrew_protocol::prompts::choose_delve::ChooseDelveInput {
            valid_card_ids: card_ids(&cards),
            zone_cards: prompt_cards(&cards, &card_index),
            max_cards: max,
        }),
        JavaRawPromptBody::ChooseConvoke {
            cards,
            description: _,
            source_card_name: _,
        } => {
            let candidates: Vec<TargetRef> = card_ids(&cards)
                .into_iter()
                .map(|id| TargetRef::Card { id })
                .collect();
            let total = candidates.len() as i32;
            PromptInput::ChooseBoardTargets(board_targets_input(
                candidates,
                TargetingIntent::Tap,
                0,
                total,
                0,
                "Convoke".to_string(),
            ))
        }
        JavaRawPromptBody::ChooseImprovise {
            cards,
            description: _,
            source_card_name: _,
        } => {
            let candidates: Vec<TargetRef> = card_ids(&cards)
                .into_iter()
                .map(|id| TargetRef::Card { id })
                .collect();
            let total = candidates.len() as i32;
            PromptInput::ChooseBoardTargets(board_targets_input(
                candidates,
                TargetingIntent::Tap,
                0,
                total,
                0,
                "Improvise".to_string(),
            ))
        }
        JavaRawPromptBody::ReorderLibrary {
            cards,
            destination,
            top_of_deck,
            source_card_name: _,
        } => PromptInput::ReorderLibrary(manabrew_protocol::prompts::reorder_library::ReorderLibraryInput {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
            destination,
            top_of_deck,
        }),
        JavaRawPromptBody::ChooseTargetPlayer {
            players,
            source_card_id: source,
            api,
            destination,
            counter_type,
            min_targets,
            max_targets,
            chosen_targets,
        } => {
            source_card_id = source;
            let intent = intent_from_api(&api, &destination, &counter_type, None);
            PromptInput::ChooseBoardTargets(board_targets_input(
                target_ids(&players)
                    .into_iter()
                    .map(|id| TargetRef::Player { id })
                    .collect(),
                intent,
                min_targets,
                max_targets,
                chosen_targets,
                intent.to_string(),
            ))
        }
        JavaRawPromptBody::ChooseTargetCard {
            cards,
            source_card_id: source,
            api,
            destination,
            counter_type,
            zone,
            min_targets,
            max_targets,
            chosen_targets,
        } => {
            source_card_id = source;
            let intent = intent_from_api(&api, &destination, &counter_type, zone.as_deref());
            PromptInput::ChooseBoardTargets(board_targets_input(
                target_ids(&cards)
                    .into_iter()
                    .map(|id| TargetRef::Card { id })
                    .collect(),
                intent,
                min_targets,
                max_targets,
                chosen_targets,
                intent.to_string(),
            ))
        }
        JavaRawPromptBody::ChooseTargetAny {
            players,
            cards,
            source_card_id: source,
            api,
            destination,
            counter_type,
            min_targets,
            max_targets,
            chosen_targets,
        } => {
            source_card_id = source;
            let intent = intent_from_api(&api, &destination, &counter_type, None);
            let mut candidates: Vec<TargetRef> = target_ids(&players)
                .into_iter()
                .map(|id| TargetRef::Player { id })
                .collect();
            candidates.extend(target_ids(&cards).into_iter().map(|id| TargetRef::Card { id }));
            PromptInput::ChooseBoardTargets(board_targets_input(
                candidates,
                intent,
                min_targets,
                max_targets,
                chosen_targets,
                intent.to_string(),
            ))
        }
        JavaRawPromptBody::ChooseTargetSpell {
            spells,
            source_card_id: source,
            api,
            destination,
            counter_type,
            min_targets,
            max_targets,
            chosen_targets,
        } => {
            source_card_id = source;
            let intent = intent_from_api(&api, &destination, &counter_type, None);
            PromptInput::ChooseBoardTargets(board_targets_input(
                target_ids(&spells)
                    .into_iter()
                    .map(|id| TargetRef::Spell { id })
                    .collect(),
                intent,
                min_targets,
                max_targets,
                chosen_targets,
                intent.to_string(),
            ))
        }
        JavaRawPromptBody::PayManaCost {
            card_id,
            card_name,
            mana_cost,
            mana_ability_options,
            tappable_land_ids,
            untappable_land_ids,
            mana_pool_total,
            can_confirm_from_pool,
        } => PromptInput::PayManaCost(manabrew_protocol::prompts::pay_mana_cost::PayManaCostInput {
            card_id: card_id.unwrap_or_default(),
            card_name: card_name.unwrap_or_default(),
            mana_cost: mana_cost.unwrap_or_default(),
            mana_ability_options: mana_ability_options
                .iter()
                .flat_map(to_mana_ability_info)
                .collect(),
            tappable_source_ids: tappable_land_ids,
            untappable_source_ids: untappable_land_ids,
            mana_pool_total,
            can_confirm_from_pool,
        }),
        JavaRawPromptBody::SpecifyManaCombo {
            available_colors,
            amount,
        } => PromptInput::SpecifyManaCombo(
            manabrew_protocol::prompts::specify_mana_combo::SpecifyManaComboInput {
                available_colors,
                amount,
            },
        ),
    };
    let deciding_player_id = if matches!(
        inner,
        PromptInput::FirstPlayerRoll(
            manabrew_protocol::prompts::first_player_roll::FirstPlayerRollInput { .. }
        )
    ) {
        String::new()
    } else {
        format!("player-{player}")
    };
    AgentPrompt {
        deciding_player_id,
        source_card_id,
        input: inner,
    }
}

pub fn translate_java_player_action(action: &PlayerAction) -> Result<JavaAction, JavaActionError> {
    let java = match action {
        PlayerAction::Act { action_id } => {
            if let Some(index) = action_id
                .strip_prefix("prompt-action-")
                .and_then(|s| s.parse::<usize>().ok())
            {
                JavaAction::ChooseAction { index }
            } else if let Some(rest) = action_id.strip_prefix("tap:") {
                let tap = parse_tap_action_id(rest);
                JavaAction::TapLand {
                    card_id: tap.card_id.to_string(),
                    mana_ability_index: tap.ability_index,
                    color: tap.color.map(str::to_string),
                }
            } else if let Some(card_id) = action_id.strip_prefix("untap:") {
                JavaAction::UntapLand {
                    card_id: card_id.to_string(),
                }
            } else {
                return Err(JavaActionError { action_type: "act" });
            }
        }
        PlayerAction::PlayCard { card_id, mode } => {
            let index = mode
                .as_deref()
                .and_then(|mode| {
                    mode.strip_prefix("prompt-action-")
                        .or_else(|| mode.strip_prefix("java-forge-action:"))
                })
                .or_else(|| {
                    (mode.as_deref() == Some("java-forge-action"))
                        .then(|| card_id.strip_prefix("java-action-"))
                        .flatten()
                })
                .and_then(|index| index.parse::<usize>().ok())
                .ok_or(JavaActionError {
                    action_type: "playCard",
                })?;
            JavaAction::ChooseAction { index }
        }
        PlayerAction::DiscardDecision { discarded_card_ids } => JavaAction::ChooseCards {
            card_ids: discarded_card_ids.clone(),
        },
        PlayerAction::MulliganDecision { keep } => JavaAction::MulliganDecision { keep: *keep },
        PlayerAction::MulliganPutBackDecision { card_ids } => JavaAction::ChooseCards {
            card_ids: card_ids.clone(),
        },
        PlayerAction::RevealCardsAcknowledged => JavaAction::RevealCardsAcknowledged,
        PlayerAction::FirstPlayerRollAcknowledged => JavaAction::FirstPlayerRollAcknowledged,
        PlayerAction::ChooseCardsDecision { chosen_card_ids } => JavaAction::ChooseCards {
            card_ids: chosen_card_ids.clone(),
        },
        PlayerAction::SelectionDecision { chosen_indices } => JavaAction::ModeDecision {
            indices: chosen_indices.clone(),
        },
        PlayerAction::Decision { value } => JavaAction::BooleanDecision { accept: *value },
        PlayerAction::ColorDecision { color } => JavaAction::StringDecision {
            value: color.clone().unwrap_or_default(),
        },
        PlayerAction::TypeDecision { chosen_type } => JavaAction::StringDecision {
            value: chosen_type.clone().unwrap_or_default(),
        },
        PlayerAction::CardNameDecision { chosen_name } => JavaAction::StringDecision {
            value: chosen_name.clone().unwrap_or_default(),
        },
        PlayerAction::NumberDecision { chosen_number } => JavaAction::NumberDecision {
            number: chosen_number.unwrap_or_default(),
        },
        PlayerAction::ScryDecision { bottom_card_ids } => JavaAction::ScryDecision {
            bottom_card_ids: bottom_card_ids.clone(),
        },
        PlayerAction::SurveilDecision { graveyard_card_ids } => JavaAction::SurveilDecision {
            graveyard_card_ids: graveyard_card_ids.clone(),
        },
        PlayerAction::DigDecision { chosen_card_ids } => JavaAction::DigDecision {
            chosen_card_ids: chosen_card_ids.clone(),
        },
        PlayerAction::DelveDecision { chosen_card_ids } => JavaAction::ChooseCards {
            card_ids: chosen_card_ids.clone(),
        },
        PlayerAction::ReorderLibraryDecision { ordered_card_ids } => {
            JavaAction::ReorderLibraryDecision {
                ordered_card_ids: ordered_card_ids.clone(),
            }
        }
        PlayerAction::DamageAssignmentOrderDecision {
            ordered_blocker_ids,
        } => JavaAction::DamageAssignmentOrderDecision {
            ordered_card_ids: ordered_blocker_ids.clone(),
        },
        PlayerAction::CombatDamageAssignmentDecision { assignments } => {
            JavaAction::CombatDamageAssignmentDecision {
                assignments: assignments
                    .iter()
                    .map(|assignment| JavaCombatAssignment {
                        assignee_id: assignment.assignee_id.clone(),
                        damage: assignment.damage,
                    })
                    .collect(),
            }
        }
        PlayerAction::BoardTargets { chosen } => match chosen.first() {
            Some(TargetRef::Player { id }) => JavaAction::TargetChoice {
                target: JavaTarget {
                    kind: JavaTargetKind::Player,
                    id: id.clone(),
                },
            },
            Some(TargetRef::Card { id }) => JavaAction::TargetChoice {
                target: JavaTarget {
                    kind: JavaTargetKind::Card,
                    id: id.clone(),
                },
            },
            Some(TargetRef::Spell { id }) => JavaAction::TargetChoice {
                target: JavaTarget {
                    kind: JavaTargetKind::Spell,
                    id: id.clone(),
                },
            },
            None => JavaAction::TargetChoice {
                target: JavaTarget {
                    kind: JavaTargetKind::Card,
                    id: String::new(),
                },
            },
        },
        PlayerAction::DeclareAttackers { assignments } => JavaAction::DeclareAttackers {
            assignments: assignments
                .iter()
                .map(|assignment| JavaAttackAssignment {
                    attacker_id: assignment.attacker_id.clone(),
                    defender_id: assignment.target_id.clone(),
                })
                .collect(),
        },
        PlayerAction::DeclareBlockers { assignments } => JavaAction::DeclareBlockers {
            assignments: assignments
                .iter()
                .map(|assignment| JavaBlockAssignment {
                    blocker_id: assignment.blocker_id.clone(),
                    attacker_id: assignment.attacker_id.clone(),
                })
                .collect(),
        },
        PlayerAction::ActivateAbility {
            ability_index: index,
            ..
        } => JavaAction::ChooseAction { index: *index },
        PlayerAction::TapForMana {
            card_id,
            ability_index,
            color,
        } => JavaAction::TapLand {
            card_id: card_id.clone(),
            mana_ability_index: *ability_index,
            color: color.clone(),
        },
        PlayerAction::Untap { card_id } => JavaAction::UntapLand {
            card_id: card_id.clone(),
        },
        PlayerAction::PayManaCost { auto } => JavaAction::PayMana { auto: *auto },
        PlayerAction::ManaComboDecision { chosen_colors } => JavaAction::ManaComboDecision {
            chosen_colors: chosen_colors.clone(),
        },
        PlayerAction::PayLife => JavaAction::PayLife,
        PlayerAction::CancelManaCost => JavaAction::CancelMana,
        PlayerAction::Pass { until_phase } => JavaAction::Pass {
            until_phase: until_phase.clone(),
        },
        PlayerAction::Concede => JavaAction::Pass { until_phase: None },
        other => {
            return Err(JavaActionError {
                action_type: player_action_label(other),
            })
        }
    };
    Ok(java)
}

fn java_target_to_ref(target: crate::java_raw::JavaRawStackTarget) -> TargetRef {
    match target.kind.as_str() {
        "player" => TargetRef::Player { id: target.id },
        "spell" => TargetRef::Spell { id: target.id },
        _ => TargetRef::Card { id: target.id },
    }
}

fn player_action_label(action: &PlayerAction) -> &'static str {
    match action {
        PlayerAction::EngineAction { .. } => "engineAction",
        PlayerAction::TapForMana { .. } => "tapLand",
        PlayerAction::Untap { .. } => "untapLand",
        PlayerAction::BoardTargets { .. } => "boardTargets",
        PlayerAction::Decision { .. } => "decision",
        PlayerAction::MultikickerDecision { .. } => "multikickerDecision",
        PlayerAction::ReplicateDecision { .. } => "replicateDecision",
        PlayerAction::ExploreResponse { .. } => "exploreResponse",
        PlayerAction::AssistDecision { .. } => "assistDecision",
        PlayerAction::PayCombatCost => "payCombatCost",
        PlayerAction::DeclineCombatCost => "declineCombatCost",
        PlayerAction::RestoreSnapshot { .. } => "restoreSnapshot",
        PlayerAction::ManaComboDecision { .. } => "manaComboDecision",
        PlayerAction::PayManaCost { .. } => "payManaCost",
        PlayerAction::PayLife => "payLife",
        PlayerAction::CancelManaCost => "cancelManaCost",
        PlayerAction::DiceRolledAcknowledged => "diceRolledAcknowledged",
        PlayerAction::FirstPlayerRollAcknowledged => "firstPlayerRollAcknowledged",
        PlayerAction::SelectionDecision { .. } => "selectionDecision",
        _ => "unknown",
    }
}

struct NormalizedAction {
    index: usize,
    id: String,
    label: String,
    card_id: Option<String>,
    kind: Option<&'static str>,
    cost: Option<String>,
    produced_mana: Option<String>,
    produced_mana_amount: Option<i32>,
}

fn build_choose_action(
    raw_actions: &[JavaRawAction],
    untappable_land_ids: Vec<String>,
) -> PromptInput {
    let actions = to_actions(raw_actions);
    let mut out: Vec<AvailableAction> = Vec::new();

    // Each action carries the exact host card id and its kind from the Java
    // SpellAbility — so routing needs no label parsing and no zone-scoped name
    // lookup; a card id identifies the card in whatever zone it lives.
    for action in &actions {
        let Some(card_id) = action.card_id.clone() else {
            continue;
        };
        if action.kind == Some("mana") {
            out.extend(priority_mana_actions(
                &card_id,
                action.index,
                &action.label,
                action.cost.clone(),
                action.produced_mana.clone(),
                action.produced_mana_amount,
            ));
            continue;
        }
        let kind = match action.kind {
            Some("ability") => AvailableActionKind::ActivateAbility {
                card_id: card_id.clone(),
                ability_index: action.index,
                description: action.label.clone(),
                cost: None,
                is_mana_ability: false,
                produced_mana: None,
            },
            _ => AvailableActionKind::Cast {
                card_id: card_id.clone(),
                mode: action.id.clone(),
                mode_label: action.label.clone(),
            },
        };
        let id = format!("prompt-action-{}", action.index);
        out.push(AvailableAction { id, kind });
    }

    for card_id in untappable_land_ids {
        out.push(AvailableAction {
            id: format!("untap:{card_id}"),
            kind: AvailableActionKind::UndoMana { card_id },
        });
    }

    PromptInput::ChooseAction(
        manabrew_protocol::prompts::choose_action::ChooseActionInput { actions: out },
    )
}

fn build_game_view(
    snapshot: &JavaRawSnapshot,
    session_id: Option<&str>,
    viewer: usize,
) -> GameViewDto {
    let mut players: Vec<PlayerDto> = snapshot
        .players
        .iter()
        .enumerate()
        .map(|(index, player)| to_player(player, index, viewer))
        .collect();
    while players.len() < 2 {
        let index = players.len();
        players.push(to_player(&JavaRawSnapshotPlayer::default(), index, viewer));
    }

    let active_player_id = format!("player-{}", snapshot.active_player.unwrap_or(0));
    let priority_player_id = format!("player-{}", snapshot.priority_player.unwrap_or(0));

    let mut battlefield = Vec::new();
    for (player_index, player) in snapshot.players.iter().enumerate() {
        for (card_index, card) in player.battlefield().iter().enumerate() {
            battlefield.push(to_card(
                &card.data(),
                player_index,
                card_index,
                "battlefield",
            ));
        }
    }

    let stack: Vec<StackObjectDto> = snapshot
        .stack
        .iter()
        .enumerate()
        .map(|(index, entry)| to_stack_object(entry, index, &active_player_id))
        .collect();

    GameViewDto {
        game_id: session_id.unwrap_or("engine-game").to_string(),
        turn: snapshot.turn.unwrap_or(0),
        step: normalize_step(snapshot.phase.as_deref()).to_string(),
        combat_assignments: snapshot
            .combat
            .iter()
            .map(|block| CombatAssignmentDto {
                blocker_id: block.blocker_id.clone(),
                attacker_id: block.attacker_id.clone(),
            })
            .collect(),
        active_player_id,
        priority_player_id,
        players,
        battlefield,
        stack,
        game_over: snapshot.game_over,
        winner_id: snapshot.winner.map(|index| format!("player-{index}")),
        conceded_player_ids: snapshot
            .players
            .iter()
            .enumerate()
            .filter(|(_, player)| player.has_conceded.unwrap_or(false))
            .map(|(index, player)| format!("player-{}", player.index.unwrap_or(index)))
            .collect(),
        monarch_id: snapshot.monarch.map(|index| format!("player-{index}")),
        initiative_holder_id: snapshot.initiative.map(|index| format!("player-{index}")),
    }
}

fn build_cards(cards: &[JavaRawCard], player_index: usize, zone_id: &str) -> Vec<CardDto> {
    cards
        .iter()
        .enumerate()
        .map(|(card_index, card)| to_card(&card.data(), player_index, card_index, zone_id))
        .collect()
}

fn to_player(player: &JavaRawSnapshotPlayer, fallback_index: usize, viewer: usize) -> PlayerDto {
    let index = player.index.unwrap_or(fallback_index);
    PlayerDto {
        id: format!("player-{index}"),
        name: player.name.clone().unwrap_or_else(|| "Player".to_string()),
        is_human: index == viewer,
        life: player.life.unwrap_or(20),
        poison: player.poison.unwrap_or(0),
        hand: build_cards(player.hand_zone(), index, "hand"),
        graveyard: build_cards(player.graveyard_zone(), index, "graveyard"),
        exile: build_cards(player.exile_zone(), index, "exile"),
        command_zone: build_cards(&player.command_zone_cards, index, "command"),
        library_count: player.library_size.unwrap_or(0).max(0) as usize,
        mana_pool: player.mana_pool.clone().into_iter().collect(),
        commander_damage: player.commander_damage.clone().into_iter().collect(),
        energy_counters: player.energy.unwrap_or(0),
        radiation_counters: player.radiation.unwrap_or(0),
        has_city_blessing: player.city_blessing.unwrap_or(false),
        ring_level: player.ring_level.unwrap_or(0),
        speed: player.speed.unwrap_or(0),
    }
}

fn to_card(
    card: &JavaRawCardData,
    player_index: usize,
    card_index: usize,
    zone_id: &str,
) -> CardDto {
    let name = card
        .name
        .clone()
        .unwrap_or_else(|| "Unknown Card".to_string());
    let controller_index = card.controller.unwrap_or(player_index);
    let id = card
        .id
        .clone()
        .unwrap_or_else(|| format!("engine-card-{player_index}-{zone_id}-{card_index}"));
    CardDto {
        id,
        set_code: card.set_code.clone().unwrap_or_default(),
        card_number: card.card_number.clone().unwrap_or_default(),
        power: card.power.map(|value| value.to_string()),
        toughness: card.toughness.map(|value| value.to_string()),
        base_power: card.power.map(|value| value as i32),
        base_toughness: card.toughness.map(|value| value as i32),
        is_playable: false,
        controller_id: format!("player-{controller_index}"),
        owner_id: format!("player-{player_index}"),
        zone_id: zone_id.to_string(),
        tapped: card.tapped,
        counters: card.counters.clone().into_iter().collect(),
        damage: card.damage,
        summoning_sick: card.summoning_sick,
        color: card.color.clone().unwrap_or_default(),
        mana_cost: card.mana_cost.clone().unwrap_or_default(),
        cmc: card.cmc.unwrap_or(0),
        text: card.text.clone().unwrap_or_default(),
        types: card.types.clone(),
        subtypes: card.subtypes.clone(),
        supertypes: card.supertypes.clone(),
        keywords: card.keywords.clone(),
        is_token: card.is_token,
        is_copy: card.is_copy,
        is_double_faced: card.is_double_faced,
        is_transformed: card.is_transformed,
        is_face_down: card.is_face_down,
        is_bestowed: card.is_bestowed,
        is_attacking: card.is_attacking,
        attacking_player_id: card.attacking_player_id.clone(),
        attached_to: card.attached_to.clone(),
        attachment_ids: card.attachment_ids.clone(),
        phased_out: card.phased_out,
        exerted: card.exerted,
        is_ring_bearer: card.is_ring_bearer,
        is_crewed: card.is_crewed,
        is_madness_exiled: card.is_madness_exiled,
        is_plotted: card.is_plotted,
        is_warp_exiled: card.is_warp_exiled,
        foil: card.foil,
        flashback_cost: keyword_cost(&card.keywords, "Flashback"),
        kicker_cost: keyword_cost(&card.keywords, "Kicker"),
        madness_cost: keyword_cost(&card.keywords, "Madness"),
        effective_mana_cost: card.effective_mana_cost.clone(),
        would_die_in_combat: card.would_die_in_combat,
        name,
        ..CardDto::default()
    }
}

/// Extract the cost portion from a Forge keyword string (`"Flashback:2 R"` →
/// `"2 R"`), mirroring the engine's `alt_costs::get_keyword_cost`.
fn keyword_cost(keywords: &[String], name: &str) -> Option<String> {
    keywords.iter().find_map(|keyword| {
        let rest = keyword.strip_prefix(name)?.strip_prefix(':')?;
        let cost = rest.split(':').next().unwrap_or(rest).trim();
        (!cost.is_empty()).then(|| cost.to_string())
    })
}

/// Map a Forge `ApiType` name (plus the `ChangeZone`/`PutCounter` context the
/// harness sends) to a targeting intent. Mirrors
/// `game_view_dto::targeting_intent_of` so Java target prompts show the same
/// pointer/glow the Rust engine produces.
fn intent_from_api(
    api: &Option<String>,
    destination: &Option<String>,
    counter_type: &Option<String>,
    origin: Option<&str>,
) -> TargetingIntent {
    use TargetingIntent::*;
    let Some(api) = api.as_deref() else {
        return Hostile;
    };
    match api {
        "DealDamage" | "DamageAll" | "EachDamage" => Damage,
        "Destroy" | "DestroyAll" => Destroy,
        "Sacrifice" | "SacrificeAll" => Sacrifice,
        "ChangeZone" | "ChangeZoneAll" => {
            // Pulling a card out of the graveyard/exile is recursion of your own
            // cards (regrowth, reanimate), not a hostile bounce/blink.
            let from_dead = matches!(origin, Some("Graveyard") | Some("Exile"));
            match destination.as_deref() {
                Some("Hand") | Some("Library") | Some("Battlefield") if from_dead => Friendly,
                Some("Exile") => Exile,
                Some("Hand") | Some("Library") => Bounce,
                Some("Graveyard") => Destroy,
                Some("Battlefield") => Friendly,
                _ => Hostile,
            }
        }
        "Mill" => Mill,
        "Discard" => Discard,
        "Counter" => Counter,
        "ControlSpell" => GainControl,
        "Tap" | "TapAll" | "TapOrUntap" | "TapOrUntapAll" => Tap,
        "Untap" | "UntapAll" => Untap,
        "CopyPermanent" | "CopySpellAbility" | "Clone" => Copy,
        "Pump" | "PumpAll" | "Animate" | "AnimateAll" | "Protection" | "ProtectionAll" => Buff,
        "PutCounter" | "PutCounterAll" => match counter_type.as_deref() {
            Some(ct) if ct.starts_with("M1M1") || ct.contains("-1/-1") => Debuff,
            _ => Buff,
        },
        "RemoveCounter" | "RemoveCounterAll" | "Debuff" => Debuff,
        "GainLife" => Heal,
        "LoseLife" => LoseLife,
        "Draw" => Draw,
        "Reveal" | "RevealHand" | "LookAt" | "PeekAndReveal" => Reveal,
        "GainControl" | "GainControlVariant" | "ExchangeControl" | "ExchangeControlVariant" => {
            GainControl
        }
        "Fight" => Fight,
        "Attach" | "Unattach" => Attach,
        _ => Hostile,
    }
}

fn to_stack_object(entry: &JavaRawStackEntry, index: usize, controller_id: &str) -> StackObjectDto {
    match entry {
        JavaRawStackEntry::Name(name) => StackObjectDto {
            id: format!("engine-stack-{index}"),
            source_id: format!("engine-stack-source-{index}"),
            controller_id: controller_id.to_string(),
            name: name.clone(),
            ..StackObjectDto::default()
        },
        JavaRawStackEntry::Full {
            id,
            name,
            description,
            controller,
            source_id,
            set_code,
            card_number,
            is_permanent_spell,
            is_casting,
            targets,
        } => StackObjectDto {
            id: id
                .clone()
                .unwrap_or_else(|| format!("engine-stack-{index}")),
            source_id: source_id
                .clone()
                .unwrap_or_else(|| format!("engine-stack-source-{index}")),
            controller_id: controller
                .map(|index| format!("player-{index}"))
                .unwrap_or_else(|| controller_id.to_string()),
            name: name.clone().unwrap_or_else(|| "Stack object".to_string()),
            text: description.clone().unwrap_or_default(),
            set_code: set_code.clone().unwrap_or_default(),
            card_number: card_number.clone().unwrap_or_default(),
            is_permanent_spell: *is_permanent_spell,
            is_casting: *is_casting,
            targets: targets
                .iter()
                .enumerate()
                .map(|(target_index, target)| to_stack_target(target, target_index))
                .collect(),
        },
    }
}

fn to_mana_ability_info(option: &JavaRawManaOption) -> Vec<ActivatableAbilityInfo> {
    payment_mana_ability_options(
        option.card_id.as_deref().unwrap_or_default(),
        option.ability_index.unwrap_or(0),
        option.description.as_deref().unwrap_or_default(),
        option.cost.clone(),
        option.produced_mana.clone(),
        option.produced_mana_amount,
    )
}

fn to_stack_target(target: &JavaRawStackTarget, target_index: usize) -> StackTargetDto {
    let kind = match target.kind.as_str() {
        "player" => StackTargetKindDto::Player,
        "stack" => StackTargetKindDto::Stack,
        _ => StackTargetKindDto::Card,
    };
    StackTargetDto {
        kind,
        id: target.id.clone(),
        node_index: 0,
        target_index: target_index as u32,
        hostile: true,
        intent: TargetingIntent::Hostile,
    }
}

fn to_actions(actions: &[JavaRawAction]) -> Vec<NormalizedAction> {
    actions
        .iter()
        .enumerate()
        .filter_map(|(fallback_index, action)| {
            let index = action.index.unwrap_or(fallback_index);
            let raw_label = action.label.as_str();
            let label = format_action_label(raw_label);
            (!label.is_empty()).then(|| NormalizedAction {
                index,
                id: format!("prompt-action-{index}"),
                label,
                card_id: action.card_id.clone(),
                kind: java_action_kind(action.kind.as_deref()),
                cost: action.cost.clone(),
                produced_mana: action.produced_mana.clone(),
                produced_mana_amount: action.produced_mana_amount,
            })
        })
        .collect()
}

fn card_ids(cards: &[JavaRawCardOption]) -> Vec<String> {
    cards.iter().filter_map(|card| card.id.clone()).collect()
}

fn target_ids(targets: &[JavaRawCardOption]) -> Vec<String> {
    targets
        .iter()
        .filter_map(|target| target.id.clone())
        .collect()
}

fn board_targets_input(
    candidates: Vec<TargetRef>,
    intent: crate::game_view_dto::TargetingIntent,
    min_targets: i32,
    max_targets: i32,
    chosen_targets: i32,
    label: String,
) -> manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
    manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
        candidates,
        hostile: intent.is_hostile(),
        intent,
        min_targets,
        max_targets,
        chosen_targets,
        label,
    }
}

fn prompt_cards(cards: &[JavaRawCardOption], index: &HashMap<String, CardDto>) -> Vec<CardDto> {
    cards
        .iter()
        .filter_map(|card| {
            let id = card.id.clone()?;
            if let Some(rich) = index.get(&id) {
                return Some(rich.clone());
            }
            Some(CardDto {
                id,
                name: card
                    .label
                    .clone()
                    .unwrap_or_else(|| "Unknown Card".to_string()),
                set_code: card.set_code.clone().unwrap_or_default(),
                card_number: card.card_number.clone().unwrap_or_default(),
                owner_id: card
                    .owner
                    .map(|owner| format!("player-{owner}"))
                    .unwrap_or_default(),
                ..CardDto::default()
            })
        })
        .collect()
}

fn index_view_cards(view: &GameViewDto) -> HashMap<String, CardDto> {
    let mut index = HashMap::new();
    for card in view.all_zone_cards() {
        index.insert(card.id.clone(), card.clone());
    }
    index
}

fn attack_targets(defenders: &[JavaRawCardOption]) -> Vec<AttackTargetDto> {
    defenders
        .iter()
        .filter_map(|defender| {
            let id = defender.id.clone()?;
            let label = defender.label.clone().unwrap_or_else(|| id.clone());
            let kind = match defender.kind.as_deref() {
                Some("player") => AttackTargetKind::Player,
                Some("battle") => AttackTargetKind::Battle,
                Some("planeswalker") => AttackTargetKind::Planeswalker,
                // Fall back to the id prefix when the harness omits a kind.
                _ if id.starts_with("player-") => AttackTargetKind::Player,
                _ => AttackTargetKind::Planeswalker,
            };
            Some(AttackTargetDto { id, label, kind })
        })
        .collect()
}

fn java_action_kind(kind: Option<&str>) -> Option<&'static str> {
    match kind {
        Some("land") => Some("play"),
        Some("spell") => Some("cast"),
        Some("mana") => Some("mana"),
        Some("ability") => Some("ability"),
        _ => None,
    }
}

fn format_action_label(label: &str) -> String {
    let normalized = strip_action_suffix(label);
    let Some((kind, rest)) = normalized.split_once(':') else {
        return normalized;
    };
    let (card_name, alt_cost) = match rest.split_once('#') {
        Some((name, alt)) => (name, Some(alt)),
        None => (rest, None),
    };
    let display_name = action_display_name(card_name);
    let alt_suffix = alt_cost.map(|alt| format!(" ({alt})")).unwrap_or_default();
    match kind {
        "LAND" => format!("Play {display_name}{alt_suffix}"),
        "SPELL" => format!("Cast {display_name}{alt_suffix}"),
        "CYCLE" => format!("Cycle {display_name}{alt_suffix}"),
        "MANA" => format!("Activate mana: {display_name}{alt_suffix}"),
        "AB" => format!("Activate {display_name}{alt_suffix}"),
        _ => normalized,
    }
}

fn action_display_name(card_name: &str) -> &str {
    card_name
        .split_once('|')
        .map(|(_, face_name)| face_name)
        .unwrap_or(card_name)
}

fn strip_action_suffix(label: &str) -> String {
    label
        .split('@')
        .next()
        .unwrap_or(label)
        .split('$')
        .next()
        .unwrap_or(label)
        .to_string()
}

fn normalize_step(value: Option<&str>) -> &'static str {
    match value.unwrap_or_default() {
        "Untap" | "untap" => "untap",
        "Upkeep" | "upkeep" => "upkeep",
        "Draw" | "draw" => "draw",
        "Main1" | "main1" => "main1",
        "CombatBegin" | "begin_combat" => "begin_combat",
        "CombatDeclareAttackers" | "declare_attackers" => "declare_attackers",
        "CombatDeclareBlockers" | "declare_blockers" => "declare_blockers",
        "CombatFirstStrikeDamage" | "first_strike_damage" => "first_strike_damage",
        "CombatDamage" | "combat_damage" => "combat_damage",
        "CombatEnd" | "end_combat" => "end_combat",
        "Main2" | "main2" => "main2",
        "EndOfTurn" | "end" => "end",
        "Cleanup" | "cleanup" => "cleanup",
        _ => "untap",
    }
}
