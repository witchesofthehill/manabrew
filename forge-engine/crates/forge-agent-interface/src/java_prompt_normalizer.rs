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
use crate::prompt::{
    ActivatableAbilityInfo, AgentPrompt, AgentPromptInner, DefenderIdDto, PlayOptionDto,
    PlayerAction, StateUpdate, TargetAnyChoice,
};

pub fn make_java_game_over_prompt() -> AgentPrompt {
    AgentPrompt {
        deciding_player_id: String::new(),
        source_card_id: None,
        input: AgentPromptInner::GameOver {},
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
        JavaRawPromptBody::ChooseDiscard { cards, min, max } => AgentPromptInner::ChooseDiscard {
            hand_card_ids: card_ids(&cards),
            num_to_discard: if max > 0 {
                max
            } else if min > 0 {
                min
            } else {
                1
            },
        },
        JavaRawPromptBody::Mulligan { cards, count } => AgentPromptInner::Mulligan {
            hand_card_ids: card_ids(&cards),
            mulligan_count: count,
        },
        JavaRawPromptBody::MulliganPutBack { cards, count, max } => {
            AgentPromptInner::MulliganPutBack {
                hand_card_ids: card_ids(&cards),
                cards: prompt_cards(&cards, &card_index),
                count: if count > 0 { count } else { max },
            }
        }
        JavaRawPromptBody::RevealCards {
            cards,
            zone,
            owner_player_id,
            message,
        } => AgentPromptInner::RevealCards {
            cards: prompt_cards(&cards, &card_index),
            zone: zone.unwrap_or_else(|| "unknown".to_string()),
            owner_player_id: owner_player_id.unwrap_or_else(|| format!("player-{player}")),
            message: message.unwrap_or_else(|| "Look at these cards".to_string()),
        },
        JavaRawPromptBody::FirstPlayerRoll {
            sides,
            rolls,
            winner_player_id,
        } => AgentPromptInner::FirstPlayerRoll {
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
        },
        JavaRawPromptBody::ChooseAttackers {
            attackers,
            defenders,
        } => AgentPromptInner::ChooseAttackers {
            available_attacker_ids: card_ids(&attackers),
            possible_defender_ids: defender_ids(&defenders),
        },
        JavaRawPromptBody::ChooseBlockers {
            attackers,
            blockers,
        } => AgentPromptInner::ChooseBlockers {
            attacker_ids: card_ids(&attackers),
            available_blocker_ids: card_ids(&blockers),
        },
        JavaRawPromptBody::ChooseDamageAssignmentOrder {
            attacker_id,
            blockers,
        } => AgentPromptInner::ChooseDamageAssignmentOrder {
            attacker_id: attacker_id.unwrap_or_default(),
            blocker_ids: card_ids(&blockers),
            blocker_cards: prompt_cards(&blockers, &card_index),
        },
        JavaRawPromptBody::ChooseCombatDamageAssignment {
            attacker_id,
            defender_id,
            total_damage,
            attacker_has_deathtouch,
            blockers,
        } => AgentPromptInner::ChooseCombatDamageAssignment {
            attacker_id: attacker_id.unwrap_or_default(),
            blocker_ids: card_ids(&blockers),
            defender_id,
            total_damage: total_damage as i32,
            attacker_has_deathtouch,
        },
        JavaRawPromptBody::ChooseCardsForEffect {
            cards,
            min,
            max,
            optional,
            source_card_name,
            description: _,
        } => AgentPromptInner::ChooseCardsForEffect {
            valid_card_ids: card_ids(&cards),
            zone_cards: prompt_cards(&cards, &card_index),
            min_choices: min,
            max_choices: max,
            source_card_name,
            optional,
        },
        JavaRawPromptBody::ChooseMode {
            options,
            min,
            max,
            source_card_name,
        } => AgentPromptInner::ChooseMode {
            options,
            min_choices: min,
            max_choices: max,
            source_card_name,
        },
        JavaRawPromptBody::ConfirmOrTrigger {
            description,
            source_card_name: _,
            prompt_kind,
            option_labels,
            mode,
            api,
        } => AgentPromptInner::ChooseOptionalTrigger {
            description: description.unwrap_or_else(|| "Confirm?".to_string()),
            cards: Vec::new(),
            prompt_kind,
            option_labels: Some(option_labels),
            mode,
            api,
        },
        JavaRawPromptBody::PayCostToPreventEffect {
            description,
            mode,
            source_card_name: _,
            api,
        } => AgentPromptInner::PayCostToPreventEffect {
            description: description.unwrap_or_else(|| "Pay cost?".to_string()),
            cost_kind: mode.unwrap_or_else(|| "Cost".to_string()),
            api,
        },
        JavaRawPromptBody::ChooseNumber {
            min,
            max,
            source_card_name: _,
            description: _,
        } => AgentPromptInner::ChooseNumber {
            min: min as i32,
            max: max as i32,
        },
        JavaRawPromptBody::ChooseColor {
            options,
            source_card_name: _,
        } => AgentPromptInner::ChooseColor {
            valid_colors: options,
        },
        JavaRawPromptBody::ChooseType {
            options,
            description,
            source_card_name: _,
        } => AgentPromptInner::ChooseType {
            type_category: description.unwrap_or_else(|| "Card".to_string()),
            valid_types: options,
        },
        JavaRawPromptBody::ChooseCardName {
            options,
            source_card_name: _,
        } => AgentPromptInner::ChooseCardName {
            valid_names: options,
        },
        JavaRawPromptBody::ChooseScry { cards } => AgentPromptInner::Scry {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
        },
        JavaRawPromptBody::ChooseSurveil { cards } => AgentPromptInner::Surveil {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
        },
        JavaRawPromptBody::ChooseDig {
            cards,
            max,
            optional,
            source_card_name: _,
        } => AgentPromptInner::Dig {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
            num_to_take: max,
            optional,
        },
        JavaRawPromptBody::ChooseDelve {
            cards,
            max,
            source_card_name: _,
        } => AgentPromptInner::ChooseDelve {
            valid_card_ids: card_ids(&cards),
            zone_cards: prompt_cards(&cards, &card_index),
            max_cards: max,
        },
        JavaRawPromptBody::ChooseConvoke {
            cards,
            description,
            source_card_name: _,
        } => AgentPromptInner::ChooseConvoke {
            valid_card_ids: card_ids(&cards),
            remaining_cost: description.unwrap_or_default(),
        },
        JavaRawPromptBody::ChooseImprovise {
            cards,
            description,
            source_card_name: _,
        } => AgentPromptInner::ChooseImprovise {
            valid_card_ids: card_ids(&cards),
            remaining_cost: description.unwrap_or_default(),
        },
        JavaRawPromptBody::ReorderLibrary {
            cards,
            destination,
            top_of_deck,
            source_card_name: _,
        } => AgentPromptInner::ReorderLibrary {
            card_ids: card_ids(&cards),
            cards: prompt_cards(&cards, &card_index),
            destination,
            top_of_deck,
        },
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
            let intent = intent_from_api(&api, &destination, &counter_type);
            AgentPromptInner::ChooseTargetPlayer {
                valid_player_ids: target_ids(&players),
                hostile: intent.is_hostile(),
                intent,
                min_targets,
                max_targets,
                chosen_targets,
            }
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
            let intent = intent_from_api(&api, &destination, &counter_type);
            match zone {
                Some(zone) if zone != "Battlefield" => AgentPromptInner::ChooseTargetCardFromZone {
                    valid_card_ids: target_ids(&cards),
                    zone,
                    zone_cards: prompt_cards(&cards, &card_index),
                    intent,
                    min_targets,
                    max_targets,
                    chosen_targets,
                },
                _ => AgentPromptInner::ChooseTargetCard {
                    valid_card_ids: target_ids(&cards),
                    hostile: intent.is_hostile(),
                    intent,
                    min_targets,
                    max_targets,
                    chosen_targets,
                },
            }
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
            let intent = intent_from_api(&api, &destination, &counter_type);
            AgentPromptInner::ChooseTargetAny {
                valid_player_ids: target_ids(&players),
                valid_card_ids: target_ids(&cards),
                hostile: intent.is_hostile(),
                intent,
                min_targets,
                max_targets,
                chosen_targets,
            }
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
            AgentPromptInner::ChooseTargetSpell {
                valid_spell_ids: target_ids(&spells),
                intent: intent_from_api(&api, &destination, &counter_type),
                min_targets,
                max_targets,
                chosen_targets,
            }
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
        } => AgentPromptInner::PayManaCost {
            card_id: card_id.unwrap_or_default(),
            card_name: card_name.unwrap_or_default(),
            mana_cost: mana_cost.unwrap_or_default(),
            mana_ability_options: mana_ability_options
                .iter()
                .map(to_mana_ability_info)
                .collect(),
            tappable_land_ids,
            untappable_land_ids,
            mana_pool_total,
            can_confirm_from_pool,
        },
    };
    let deciding_player_id = if matches!(inner, AgentPromptInner::FirstPlayerRoll { .. }) {
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
        PlayerAction::ModeDecision { chosen_indices } => JavaAction::ModeDecision {
            indices: chosen_indices.clone(),
        },
        PlayerAction::OptionalTriggerDecision { accept }
        | PlayerAction::PayCostToPreventEffectDecision { accept } => {
            JavaAction::BooleanDecision { accept: *accept }
        }
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
        PlayerAction::DelveDecision { chosen_card_ids }
        | PlayerAction::ConvokeDecision { chosen_card_ids }
        | PlayerAction::ImproviseDecision { chosen_card_ids } => JavaAction::ChooseCards {
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
        PlayerAction::TargetPlayer { player_id } => JavaAction::TargetChoice {
            target: JavaTarget {
                kind: JavaTargetKind::Player,
                id: player_id.clone().unwrap_or_default(),
            },
        },
        PlayerAction::TargetCard { card_id } => JavaAction::TargetChoice {
            target: JavaTarget {
                kind: JavaTargetKind::Card,
                id: card_id.clone().unwrap_or_default(),
            },
        },
        PlayerAction::TargetAny { target } => match target {
            TargetAnyChoice::Player { player_id } => JavaAction::TargetChoice {
                target: JavaTarget {
                    kind: JavaTargetKind::Player,
                    id: player_id.clone(),
                },
            },
            TargetAnyChoice::Card { card_id } => JavaAction::TargetChoice {
                target: JavaTarget {
                    kind: JavaTargetKind::Card,
                    id: card_id.clone(),
                },
            },
            TargetAnyChoice::None => JavaAction::Pass { until_phase: None },
        },
        PlayerAction::TargetSpell { spell_id } => JavaAction::TargetChoice {
            target: JavaTarget {
                kind: JavaTargetKind::Spell,
                id: spell_id.clone().unwrap_or_default(),
            },
        },
        PlayerAction::DeclareAttackers { assignments } => JavaAction::DeclareAttackers {
            assignments: assignments
                .iter()
                .map(|assignment| JavaAttackAssignment {
                    attacker_id: assignment.attacker_id.clone(),
                    defender_id: assignment.defender_id.clone(),
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
        PlayerAction::TapLand {
            card_id,
            ability_index,
            color,
        } => JavaAction::TapLand {
            card_id: card_id.clone(),
            mana_ability_index: *ability_index,
            color: color.clone(),
        },
        PlayerAction::UntapLand { card_id } => JavaAction::UntapLand {
            card_id: card_id.clone(),
        },
        PlayerAction::PayManaCost { auto } => JavaAction::PayMana { auto: *auto },
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

fn player_action_label(action: &PlayerAction) -> &'static str {
    match action {
        PlayerAction::EngineAction { .. } => "engineAction",
        PlayerAction::TapLand { .. } => "tapLand",
        PlayerAction::UntapLand { .. } => "untapLand",
        PlayerAction::TargetSpell { .. } => "targetSpell",
        PlayerAction::PhyrexianDecision { .. } => "phyrexianDecision",
        PlayerAction::KickerDecision { .. } => "kickerDecision",
        PlayerAction::BuybackDecision { .. } => "buybackDecision",
        PlayerAction::MultikickerDecision { .. } => "multikickerDecision",
        PlayerAction::ReplicateDecision { .. } => "replicateDecision",
        PlayerAction::AlternativeCostDecision { .. } => "alternativeCostDecision",
        PlayerAction::ExertDecision { .. } => "exertDecision",
        PlayerAction::EnlistDecision { .. } => "enlistDecision",
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
        PlayerAction::RollToIgnoreDecision { .. } => "rollToIgnoreDecision",
        PlayerAction::RollToSwapDecision { .. } => "rollToSwapDecision",
        PlayerAction::RollToModifyDecision { .. } => "rollToModifyDecision",
        PlayerAction::DiceToRerollDecision { .. } => "diceToRerollDecision",
        PlayerAction::RollSwapValueDecision { .. } => "rollSwapValueDecision",
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
}

fn build_choose_action(
    raw_actions: &[JavaRawAction],
    untappable_land_ids: Vec<String>,
) -> AgentPromptInner {
    let actions = to_actions(raw_actions);

    let mut playable_options = Vec::new();
    let mut activatable_ability_ids = Vec::new();
    let mut mana_ability_options = Vec::new();
    let mut tappable_land_ids: Vec<String> = Vec::new();

    // Each action carries the exact host card id and its kind from the Java
    // SpellAbility — so routing needs no label parsing and no zone-scoped name
    // lookup; a card id identifies the card in whatever zone it lives.
    for action in &actions {
        let Some(card_id) = action.card_id.clone() else {
            continue;
        };
        match action.kind {
            Some("mana") => {
                if !tappable_land_ids.contains(&card_id) {
                    tappable_land_ids.push(card_id.clone());
                }
                mana_ability_options.push(ActivatableAbilityInfo {
                    card_id,
                    ability_index: action.index,
                    description: action.label.clone(),
                    is_mana_ability: true,
                    cost: action.cost.clone(),
                });
            }
            Some("ability") => {
                activatable_ability_ids.push(ActivatableAbilityInfo {
                    card_id,
                    ability_index: action.index,
                    description: action.label.clone(),
                    is_mana_ability: false,
                    cost: None,
                });
            }
            _ => {
                playable_options.push(PlayOptionDto {
                    card_id,
                    mode: action.id.clone(),
                    mode_label: action.label.clone(),
                });
            }
        }
    }

    AgentPromptInner::ChooseAction {
        playable_card_ids: playable_options
            .iter()
            .map(|option| option.card_id.clone())
            .collect(),
        playable_options,
        tappable_land_ids,
        untappable_land_ids,
        activatable_ability_ids,
        mana_ability_options,
        available_player_actions: Vec::new(),
    }
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
) -> TargetingIntent {
    use TargetingIntent::*;
    let Some(api) = api.as_deref() else {
        return Hostile;
    };
    match api {
        "DealDamage" | "DamageAll" | "EachDamage" => Damage,
        "Destroy" | "DestroyAll" => Destroy,
        "Sacrifice" | "SacrificeAll" => Sacrifice,
        "ChangeZone" | "ChangeZoneAll" => match destination.as_deref() {
            Some("Exile") => Exile,
            Some("Hand") | Some("Library") => Bounce,
            Some("Graveyard") => Destroy,
            Some("Battlefield") => Friendly,
            _ => Hostile,
        },
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

fn to_mana_ability_info(option: &JavaRawManaOption) -> ActivatableAbilityInfo {
    ActivatableAbilityInfo {
        card_id: option.card_id.clone().unwrap_or_default(),
        ability_index: option.ability_index.unwrap_or(0),
        description: option.description.clone().unwrap_or_default(),
        is_mana_ability: true,
        cost: option.cost.clone(),
    }
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

fn defender_ids(defenders: &[JavaRawCardOption]) -> Vec<DefenderIdDto> {
    defenders
        .iter()
        .filter_map(|defender| {
            let id = defender.id.clone()?;
            let label = defender.label.clone().unwrap_or_else(|| id.clone());
            Some(DefenderIdDto { id, label })
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
