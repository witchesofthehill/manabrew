use std::collections::HashMap;

use serde_json::{json, Value};
use std::str::FromStr;
use strum_macros::{EnumString, IntoStaticStr};
use tracing::warn;

use crate::prompt::{PlayerAction, TargetAnyChoice};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumString, IntoStaticStr)]
enum JavaPromptKind {
    #[strum(to_string = "chooseDiscard", serialize = "choose_discard")]
    ChooseDiscard,
    #[strum(serialize = "mulligan")]
    Mulligan,
    #[strum(to_string = "mulliganPutBack", serialize = "mulligan_put_back")]
    MulliganPutBack,
    #[strum(to_string = "revealCards", serialize = "reveal_cards")]
    RevealCards,
    #[strum(to_string = "chooseAttackers", serialize = "choose_attackers")]
    ChooseAttackers,
    #[strum(to_string = "chooseBlockers", serialize = "choose_blockers")]
    ChooseBlockers,
    #[strum(
        to_string = "chooseDamageAssignmentOrder",
        serialize = "choose_damage_assignment_order"
    )]
    ChooseDamageAssignmentOrder,
    #[strum(
        to_string = "chooseCombatDamageAssignment",
        serialize = "choose_combat_damage_assignment"
    )]
    ChooseCombatDamageAssignment,
    #[strum(
        to_string = "chooseCardsForEffect",
        serialize = "choose_cards_for_effect"
    )]
    ChooseCardsForEffect,
    #[strum(to_string = "chooseMode", serialize = "choose_mode")]
    ChooseMode,
    #[strum(
        to_string = "chooseOptionalTrigger",
        serialize = "choose_optional_trigger",
        serialize = "confirm_action"
    )]
    ConfirmOrTrigger,
    #[strum(
        to_string = "payCostToPreventEffect",
        serialize = "pay_cost_to_prevent_effect"
    )]
    PayCostToPreventEffect,
    #[strum(to_string = "chooseNumber", serialize = "choose_number")]
    ChooseNumber,
    #[strum(to_string = "chooseColor", serialize = "choose_color")]
    ChooseColor,
    #[strum(to_string = "chooseType", serialize = "choose_type")]
    ChooseType,
    #[strum(to_string = "chooseCardName", serialize = "choose_card_name")]
    ChooseCardName,
    #[strum(to_string = "scry", serialize = "choose_scry")]
    Scry,
    #[strum(to_string = "surveil", serialize = "choose_surveil")]
    Surveil,
    #[strum(to_string = "dig", serialize = "choose_dig")]
    Dig,
    #[strum(to_string = "chooseDelve", serialize = "choose_delve")]
    ChooseDelve,
    #[strum(to_string = "chooseConvoke", serialize = "choose_convoke")]
    ChooseConvoke,
    #[strum(to_string = "chooseImprovise", serialize = "choose_improvise")]
    ChooseImprovise,
    #[strum(to_string = "reorderLibrary", serialize = "reorder_library")]
    ReorderLibrary,
    #[strum(to_string = "chooseTargetPlayer", serialize = "choose_target_player")]
    ChooseTargetPlayer,
    #[strum(to_string = "chooseTargetCard", serialize = "choose_target_card")]
    ChooseTargetCard,
    #[strum(to_string = "chooseTargetAny", serialize = "choose_target_any")]
    ChooseTargetAny,
    #[strum(to_string = "chooseTargetSpell", serialize = "choose_target_spell")]
    ChooseTargetSpell,
    #[strum(to_string = "chooseAction")]
    Other,
}

impl JavaPromptKind {
    fn parse(kind: Option<&str>) -> Self {
        kind.and_then(|k| Self::from_str(k).ok())
            .unwrap_or(Self::Other)
    }

    fn output_type(self) -> &'static str {
        self.into()
    }
}

pub fn normalize_java_prompt(prompt: Value) -> Value {
    if !is_java_prompt(&prompt) {
        return prompt;
    }

    let actions = to_actions(prompt.get("actions"));
    let player = as_usize(prompt.get("player"), 0);
    let prompt_kind = JavaPromptKind::parse(prompt.get("kind").and_then(Value::as_str));
    let game_view = snapshot_to_game_view(
        prompt.get("snapshot").unwrap_or(&Value::Null),
        prompt.get("sessionId"),
        &actions,
        player,
    );
    let prompt_type = prompt_kind.output_type();

    if prompt_kind == JavaPromptKind::ChooseDiscard {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "handCardIds": to_card_ids(prompt.get("cards")),
            "numToDiscard": as_usize(prompt.get("max"), as_usize(prompt.get("min"), 1)),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::Mulligan {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "handCardIds": to_card_ids(prompt.get("cards")),
            "mulliganCount": as_usize(prompt.get("count"), 0),
        });
    }
    if prompt_kind == JavaPromptKind::MulliganPutBack {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "handCardIds": to_card_ids(prompt.get("cards")),
            "cards": to_prompt_cards(prompt.get("cards")),
            "count": as_usize(prompt.get("count"), as_usize(prompt.get("max"), 0)),
        });
    }
    if prompt_kind == JavaPromptKind::RevealCards {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "cards": to_prompt_cards(prompt.get("cards")),
            "zone": optional_string(prompt.get("zone")).unwrap_or_else(|| "unknown".to_string()),
            "ownerPlayerId": optional_string(prompt.get("ownerPlayerId")).unwrap_or_else(|| format!("player-{player}")),
            "message": optional_string(prompt.get("message")).unwrap_or_else(|| "Look at these cards".to_string()),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseAttackers {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "availableAttackerIds": to_card_ids(prompt.get("attackers")),
            "possibleDefenderIds": to_defender_ids(prompt.get("defenders")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseBlockers {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "attackerIds": to_card_ids(prompt.get("attackers")),
            "availableBlockerIds": to_card_ids(prompt.get("blockers")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseDamageAssignmentOrder {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "attackerId": optional_normalized_card_id(prompt.get("attackerId")).unwrap_or_default(),
            "blockerIds": to_card_ids(prompt.get("blockers")),
            "blockerCards": to_prompt_cards(prompt.get("blockers")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseCombatDamageAssignment {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "attackerId": optional_normalized_card_id(prompt.get("attackerId")).unwrap_or_default(),
            "blockerIds": to_card_ids(prompt.get("blockers")),
            "defenderId": optional_normalized_card_id(prompt.get("defenderId"))
                .or_else(|| optional_string(prompt.get("defenderId"))),
            "totalDamage": as_i64(prompt.get("totalDamage"), 0),
            "attackerHasDeathtouch": prompt
                .get("attackerHasDeathtouch")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseCardsForEffect {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validCardIds": to_card_ids(prompt.get("cards")),
            "zoneCards": to_prompt_cards(prompt.get("cards")),
            "minChoices": as_usize(prompt.get("min"), 1),
            "maxChoices": as_usize(prompt.get("max"), 1),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "description": optional_string(prompt.get("description")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseMode {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "options": to_strings(prompt.get("options")),
            "minChoices": as_usize(prompt.get("min"), 1),
            "maxChoices": as_usize(prompt.get("max"), 1),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ConfirmOrTrigger {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "description": optional_string(prompt.get("description")).unwrap_or_else(|| "Confirm?".to_string()),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "promptKind": optional_string(prompt.get("promptKind")),
            "optionLabels": to_strings(prompt.get("optionLabels")),
            "mode": optional_string(prompt.get("mode")),
            "api": optional_string(prompt.get("api")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::PayCostToPreventEffect {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "description": optional_string(prompt.get("description")).unwrap_or_else(|| "Pay cost?".to_string()),
            "costKind": optional_string(prompt.get("mode")).unwrap_or_else(|| "Cost".to_string()),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "api": optional_string(prompt.get("api")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseNumber {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "min": as_i64(prompt.get("min"), 0),
            "max": as_i64(prompt.get("max"), 0),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "description": optional_string(prompt.get("description")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseColor {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validColors": to_strings(prompt.get("options")),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseType {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "typeCategory": optional_string(prompt.get("description")).unwrap_or_else(|| "Card".to_string()),
            "validTypes": to_strings(prompt.get("options")),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseCardName {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validNames": to_strings(prompt.get("options")),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::Scry {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "cardIds": to_card_ids(prompt.get("cards")),
            "cards": to_prompt_cards(prompt.get("cards")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::Surveil {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "cardIds": to_card_ids(prompt.get("cards")),
            "cards": to_prompt_cards(prompt.get("cards")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::Dig {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "cardIds": to_card_ids(prompt.get("cards")),
            "cards": to_prompt_cards(prompt.get("cards")),
            "numToTake": as_usize(prompt.get("max"), 1),
            "optional": prompt.get("optional").and_then(Value::as_bool).unwrap_or(false),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseDelve {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validCardIds": to_card_ids(prompt.get("cards")),
            "zoneCards": to_prompt_cards(prompt.get("cards")),
            "maxCards": as_usize(prompt.get("max"), 0),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseConvoke {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validCardIds": to_card_ids(prompt.get("cards")),
            "remainingCost": optional_string(prompt.get("description")).unwrap_or_default(),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseImprovise {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validCardIds": to_card_ids(prompt.get("cards")),
            "remainingCost": optional_string(prompt.get("description")).unwrap_or_default(),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ReorderLibrary {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "cardIds": to_card_ids(prompt.get("cards")),
            "cards": to_prompt_cards(prompt.get("cards")),
            "sourceCardName": optional_string(prompt.get("sourceCardName")),
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseTargetPlayer {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validPlayerIds": to_target_ids(prompt.get("players")),
            "sourceCardId": optional_normalized_card_id(prompt.get("sourceCardId")),
            "hostile": true,
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseTargetCard {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validCardIds": to_target_card_ids(prompt.get("cards")),
            "sourceCardId": optional_normalized_card_id(prompt.get("sourceCardId")),
            "hostile": true,
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseTargetAny {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validPlayerIds": to_target_ids(prompt.get("players")),
            "validCardIds": to_target_card_ids(prompt.get("cards")),
            "sourceCardId": optional_normalized_card_id(prompt.get("sourceCardId")),
            "hostile": true,
            "autoPassDisabled": true,
        });
    }
    if prompt_kind == JavaPromptKind::ChooseTargetSpell {
        return json!({
            "type": prompt_type,
            "gameView": game_view,
            "displayEvents": [],
            "validSpellIds": to_target_ids(prompt.get("spells")),
            "sourceCardId": optional_normalized_card_id(prompt.get("sourceCardId")),
            "autoPassDisabled": true,
        });
    }

    if let Some(kind) = prompt.get("kind").and_then(Value::as_str) {
        if kind != "priority" {
            warn!(
                kind,
                "unrecognized java prompt kind; coercing to chooseAction"
            );
        }
    }

    let my_hand = game_view
        .get("myHand")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let my_command_zone = game_view
        .get("myCommandZone")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut playable_options = Vec::new();
    let mut playable_card_ids_by_key =
        card_ids_by_key(my_hand.iter().chain(my_command_zone.iter()));
    let mut playable_card_ids_by_name =
        card_ids_by_name(my_hand.iter().chain(my_command_zone.iter()));
    for action in &actions {
        let Some(card_name) = action.get("cardName").and_then(Value::as_str) else {
            continue;
        };
        let card_id = action
            .get("cardKey")
            .and_then(Value::as_str)
            .and_then(|card_key| playable_card_ids_by_key.get(card_key).cloned())
            .or_else(|| {
                let card_id = pop_card_id(&mut playable_card_ids_by_name, card_name)?;
                if let Some(card_key) = action.get("cardKey").and_then(Value::as_str) {
                    playable_card_ids_by_key.insert(card_key.to_string(), card_id.clone());
                }
                Some(card_id)
            });
        if let Some(card_id) = card_id {
            playable_options.push(json!({
                "cardId": card_id,
                "mode": action.get("id").and_then(Value::as_str).unwrap_or_default(),
                "modeLabel": action.get("label").and_then(Value::as_str).unwrap_or_default(),
            }));
        }
    }

    let battlefield = game_view
        .get("battlefield")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut activatable_ability_ids = Vec::new();
    let mut mana_ability_options = Vec::new();
    let mut tappable_land_ids = Vec::new();
    let my_slot = format!("player-{player}");
    let mut battlefield_card_ids_by_key =
        card_ids_by_key(battlefield.iter().filter(|card| {
            card.get("controllerId").and_then(Value::as_str) == Some(my_slot.as_str())
        }));
    let mut battlefield_card_ids_by_name =
        card_ids_by_name(battlefield.iter().filter(|card| {
            card.get("controllerId").and_then(Value::as_str) == Some(my_slot.as_str())
        }));
    for action in &actions {
        let kind = action.get("kind").and_then(Value::as_str);
        if kind != Some("mana") && kind != Some("ability") {
            continue;
        }
        let Some(card_name) = action.get("cardName").and_then(Value::as_str) else {
            continue;
        };
        let card_id = action
            .get("cardKey")
            .and_then(Value::as_str)
            .and_then(|card_key| battlefield_card_ids_by_key.get(card_key).cloned())
            .or_else(|| {
                let card_id = pop_card_id(&mut battlefield_card_ids_by_name, card_name)?;
                if let Some(card_key) = action.get("cardKey").and_then(Value::as_str) {
                    battlefield_card_ids_by_key.insert(card_key.to_string(), card_id.clone());
                }
                Some(card_id)
            });
        if let Some(card_id) = card_id {
            let ability = json!({
                "cardId": card_id,
                "abilityIndex": action_index(action.get("id")).unwrap_or(usize::MAX),
                "description": action.get("label").and_then(Value::as_str).unwrap_or_default(),
                "isManaAbility": kind == Some("mana"),
            });
            if kind == Some("mana") {
                if !tappable_land_ids.iter().any(|id| id == &card_id) {
                    tappable_land_ids.push(card_id);
                }
                mana_ability_options.push(ability);
            } else {
                activatable_ability_ids.push(ability);
            }
        }
    }

    json!({
        "type": prompt_type,
        "gameView": game_view,
        "displayEvents": [],
        "playableCardIds": playable_options
            .iter()
            .filter_map(|option| option.get("cardId").and_then(Value::as_str))
            .collect::<Vec<_>>(),
        "playableOptions": playable_options,
        "autoPassDisabled": true,
        "tappableLandIds": tappable_land_ids,
        "untappableLandIds": [],
        "activatableAbilityIds": activatable_ability_ids,
        "manaAbilityOptions": mana_ability_options,
    })
}

pub fn translate_java_player_action(action: &PlayerAction) -> Value {
    match action {
        PlayerAction::PlayCard { card_id, mode } => mode
            .as_deref()
            .and_then(|mode| {
                mode.strip_prefix("prompt-action-")
                    .or_else(|| mode.strip_prefix("java-forge-action:"))
            })
            .or_else(|| {
                if mode.as_deref() == Some("java-forge-action") {
                    card_id.strip_prefix("java-action-")
                } else {
                    None
                }
            })
            .and_then(|index| index.parse::<usize>().ok())
            .map(|index| json!({ "kind": "choose_action", "index": index }))
            .unwrap_or_else(|| json!({ "kind": "pass" })),
        PlayerAction::DiscardDecision { discarded_card_ids } => {
            json!({ "kind": "choose_cards", "card_ids": discarded_card_ids })
        }
        PlayerAction::MulliganDecision { keep } => {
            json!({ "kind": "mulligan_decision", "keep": keep })
        }
        PlayerAction::MulliganPutBackDecision { card_ids } => {
            json!({ "kind": "choose_cards", "card_ids": card_ids })
        }
        PlayerAction::RevealCardsAcknowledged => {
            json!({ "kind": "reveal_cards_acknowledged" })
        }
        PlayerAction::ChooseCardsDecision { chosen_card_ids } => {
            json!({ "kind": "choose_cards", "card_ids": chosen_card_ids })
        }
        PlayerAction::ModeDecision { chosen_indices } => {
            json!({ "kind": "mode_decision", "indices": chosen_indices })
        }
        PlayerAction::OptionalTriggerDecision { accept }
        | PlayerAction::PayCostToPreventEffectDecision { accept } => {
            json!({ "kind": "boolean_decision", "accept": accept })
        }
        PlayerAction::ColorDecision { color } => {
            json!({ "kind": "string_decision", "value": color.as_deref().unwrap_or_default() })
        }
        PlayerAction::TypeDecision { chosen_type } => {
            json!({ "kind": "string_decision", "value": chosen_type.as_deref().unwrap_or_default() })
        }
        PlayerAction::NumberDecision { chosen_number } => {
            json!({ "kind": "number_decision", "number": chosen_number.unwrap_or_default() })
        }
        PlayerAction::CardNameDecision { chosen_name } => {
            json!({ "kind": "string_decision", "value": chosen_name.as_deref().unwrap_or_default() })
        }
        PlayerAction::ScryDecision { bottom_card_ids } => {
            json!({ "kind": "scry_decision", "bottom_card_ids": bottom_card_ids })
        }
        PlayerAction::SurveilDecision { graveyard_card_ids } => {
            json!({ "kind": "surveil_decision", "graveyard_card_ids": graveyard_card_ids })
        }
        PlayerAction::DigDecision { chosen_card_ids } => {
            json!({ "kind": "dig_decision", "chosen_card_ids": chosen_card_ids })
        }
        PlayerAction::DelveDecision { chosen_card_ids }
        | PlayerAction::ConvokeDecision { chosen_card_ids }
        | PlayerAction::ImproviseDecision { chosen_card_ids } => {
            json!({ "kind": "choose_cards", "card_ids": chosen_card_ids })
        }
        PlayerAction::ReorderLibraryDecision { ordered_card_ids } => {
            json!({ "kind": "reorder_library_decision", "ordered_card_ids": ordered_card_ids })
        }
        PlayerAction::DamageAssignmentOrderDecision {
            ordered_blocker_ids,
        } => {
            json!({ "kind": "damage_assignment_order_decision", "ordered_card_ids": ordered_blocker_ids })
        }
        PlayerAction::CombatDamageAssignmentDecision { assignments } => json!({
            "kind": "combat_damage_assignment_decision",
            "assignments": assignments
                .iter()
                .map(|assignment| json!({
                    "assigneeId": assignment.assignee_id,
                    "damage": assignment.damage,
                }))
                .collect::<Vec<_>>(),
        }),
        PlayerAction::TargetPlayer { player_id } => json!({
            "kind": "target_choice",
            "target": {
                "kind": "player",
                "id": player_id.as_deref().unwrap_or_default(),
            },
        }),
        PlayerAction::TargetCard { card_id } => json!({
            "kind": "target_choice",
            "target": {
                "kind": "card",
                "id": card_id.as_deref().unwrap_or_default(),
            },
        }),
        PlayerAction::TargetAny { target } => match target {
            TargetAnyChoice::Player { player_id } => json!({
                "kind": "target_choice",
                "target": { "kind": "player", "id": player_id },
            }),
            TargetAnyChoice::Card { card_id } => json!({
                "kind": "target_choice",
                "target": { "kind": "card", "id": card_id },
            }),
            TargetAnyChoice::None => json!({ "kind": "pass" }),
        },
        PlayerAction::TargetSpell { spell_id } => json!({
            "kind": "target_choice",
            "target": {
                "kind": "spell",
                "id": spell_id.as_deref().unwrap_or_default(),
            },
        }),
        PlayerAction::DeclareAttackers { assignments } => json!({
            "kind": "declare_attackers",
            "assignments": assignments
                .iter()
                .map(|assignment| json!({
                    "attackerId": assignment.attacker_id,
                    "defenderId": assignment.defender_id,
                }))
                .collect::<Vec<_>>(),
        }),
        PlayerAction::DeclareBlockers { assignments } => json!({
            "kind": "declare_blockers",
            "assignments": assignments
                .iter()
                .map(|assignment| json!({
                    "blockerId": assignment.blocker_id,
                    "attackerId": assignment.attacker_id,
                }))
                .collect::<Vec<_>>(),
        }),
        PlayerAction::TapLand {
            ability_index: Some(index),
            ..
        }
        | PlayerAction::ActivateAbility {
            ability_index: index,
            ..
        } => json!({ "kind": "choose_action", "index": index }),
        PlayerAction::Pass { .. } => json!({ "kind": "pass" }),
        PlayerAction::Concede => json!({ "kind": "pass" }),
        other => {
            warn!(
                action = serde_json::to_string(other).unwrap_or_default(),
                "PlayerAction has no java translation; defaulting to pass"
            );
            json!({ "kind": "pass" })
        }
    }
}

pub fn translate_java_action_value(action_value: &Value) -> Value {
    if action_value.get("kind").is_some() {
        return action_value.clone();
    }
    serde_json::from_value::<PlayerAction>(action_value.clone())
        .map(|action| translate_java_player_action(&action))
        .unwrap_or_else(|_| json!({ "kind": "pass" }))
}

fn is_java_prompt(prompt: &Value) -> bool {
    matches!(
        prompt.get("kind").and_then(Value::as_str),
        Some(
            "priority"
                | "choose_discard"
                | "mulligan"
                | "mulligan_put_back"
                | "reveal_cards"
                | "choose_attackers"
                | "choose_blockers"
                | "choose_damage_assignment_order"
                | "choose_combat_damage_assignment"
                | "choose_cards_for_effect"
                | "choose_mode"
                | "choose_optional_trigger"
                | "confirm_action"
                | "pay_cost_to_prevent_effect"
                | "choose_number"
                | "choose_color"
                | "choose_type"
                | "choose_card_name"
                | "choose_scry"
                | "choose_surveil"
                | "choose_dig"
                | "choose_delve"
                | "choose_convoke"
                | "choose_improvise"
                | "reorder_library"
                | "choose_target_player"
                | "choose_target_card"
                | "choose_target_any"
                | "choose_target_spell"
        )
    ) && prompt.get("snapshot").is_some_and(Value::is_object)
}

fn snapshot_to_game_view(
    snapshot: &Value,
    session_id: Option<&Value>,
    actions: &[Value],
    viewer: usize,
) -> Value {
    let players_source = snapshot
        .get("players")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut players: Vec<Value> = players_source
        .iter()
        .enumerate()
        .map(|(index, player)| to_player(player, index))
        .collect();
    while players.len() < 2 {
        let index = players.len();
        players.push(to_player(&Value::Null, index));
    }

    let action_card_names: Vec<&str> = actions
        .iter()
        .filter_map(|action| action.get("cardName").and_then(Value::as_str))
        .collect();
    let active_player_id = player_id(snapshot.get("active_player"));
    let mut battlefield = Vec::new();
    for (player_index, player) in players_source.iter().enumerate() {
        for (card_index, card) in player
            .get("battlefield_cards")
            .or_else(|| player.get("battlefield"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .enumerate()
        {
            battlefield.push(to_card(
                &card,
                player_index,
                card_index,
                "battlefield",
                &action_card_names,
            ));
        }
    }
    let stack: Vec<Value> = snapshot
        .get("stack")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, entry)| to_stack_object(&entry, index, &active_player_id))
        .collect();
    let me = players_source.get(viewer);
    let my_hand = zone_cards(me, "hand_cards", viewer, "hand", &action_card_names);
    let my_command_zone = zone_cards(
        me,
        "command_zone_cards",
        viewer,
        "command",
        &action_card_names,
    );
    let graveyard = zone_cards(me, "graveyard", viewer, "graveyard", &action_card_names);
    let exile = zone_cards(me, "exile", viewer, "exile", &action_card_names);

    let mut opponent_zones = serde_json::Map::new();
    for (i, opp) in players_source
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != viewer)
    {
        let opp_graveyard = zone_cards(
            Some(opp),
            "graveyard",
            i,
            "opponentGraveyard",
            &action_card_names,
        );
        let opp_exile = zone_cards(Some(opp), "exile", i, "opponentExile", &action_card_names);
        let opp_command = zone_cards(
            Some(opp),
            "command_zone_cards",
            i,
            "opponentCommand",
            &action_card_names,
        );
        opponent_zones.insert(
            format!("player-{i}"),
            json!({
                "graveyard": opp_graveyard,
                "exile": opp_exile,
                "commandZone": opp_command,
            }),
        );
    }

    json!({
        "gameId": session_id.and_then(Value::as_str).unwrap_or("engine-game"),
        "turn": as_i64(snapshot.get("turn"), 0),
        "step": normalize_step(snapshot.get("phase")),
        "activePlayerId": active_player_id,
        "priorityPlayerId": player_id(snapshot.get("priority_player")),
        "players": players,
        "myHand": my_hand,
        "battlefield": battlefield,
        "stack": stack,
        "exile": exile,
        "graveyard": graveyard,
        "myCommandZone": my_command_zone,
        "opponentZones": opponent_zones,
        "combatAssignments": [],
        "gameOver": snapshot.get("game_over").and_then(Value::as_bool).unwrap_or(false),
        "winnerId": snapshot.get("winner").and_then(Value::as_u64).map(|_| player_id(snapshot.get("winner"))),
        "monarchId": null,
        "initiativeHolderId": null,
    })
}

fn to_player(player: &Value, fallback_index: usize) -> Value {
    let index = as_usize(player.get("index"), fallback_index);
    json!({
        "id": player_id(Some(&json!(index))),
        "name": player.get("name").and_then(Value::as_str).unwrap_or("Player"),
        "isHuman": index == 0,
        "life": as_i64(player.get("life"), 20),
        "poison": as_i64(player.get("poison"), 0),
        "handCount": array_len(player.get("hand")),
        "libraryCount": as_i64(player.get("library_size"), 0),
        "graveyardCount": array_len(player.get("graveyard")),
        "exileCount": array_len(player.get("exile")),
        "manaPool": {},
        "commanderDamage": {},
        "energyCounters": 0,
        "radiationCounters": 0,
        "hasCityBlessing": false,
        "ringLevel": 0,
        "speed": 0,
    })
}

fn zone_cards(
    player: Option<&Value>,
    source_zone: &str,
    player_index: usize,
    zone_id: &str,
    action_card_names: &[&str],
) -> Vec<Value> {
    player
        .and_then(|player| {
            player.get(source_zone).or_else(|| {
                source_zone
                    .strip_suffix("_cards")
                    .and_then(|fallback_zone| player.get(fallback_zone))
            })
        })
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(card_index, card)| {
            to_card(&card, player_index, card_index, zone_id, action_card_names)
        })
        .collect()
}

fn to_card(
    card: &Value,
    player_index: usize,
    card_index: usize,
    zone_id: &str,
    action_card_names: &[&str],
) -> Value {
    let name = card
        .as_str()
        .or_else(|| card.get("name").and_then(Value::as_str))
        .unwrap_or("Unknown Card");
    let power = card.get("power").and_then(Value::as_i64);
    let toughness = card.get("toughness").and_then(Value::as_i64);
    let controller_index = card
        .get("controller")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(player_index);
    let id = card
        .get("id")
        .and_then(Value::as_str)
        .map(normalize_card_id)
        .unwrap_or_else(|| format!("engine-card-{player_index}-{zone_id}-{card_index}"));
    json!({
        "id": id,
        "name": name,
        "setCode": card.get("setCode").and_then(Value::as_str).unwrap_or(""),
        "cardNumber": card.get("cardNumber").and_then(Value::as_str).unwrap_or(""),
        "color": "",
        "manaCost": "",
        "types": [],
        "subtypes": [],
        "supertypes": [],
        "power": power.map(|value| value.to_string()),
        "toughness": toughness.map(|value| value.to_string()),
        "basePower": power,
        "baseToughness": toughness,
        "text": "",
        "isPlayable": action_card_names.contains(&name),
        "isSelected": false,
        "isChoosable": false,
        "controllerId": format!("player-{controller_index}"),
        "ownerId": format!("player-{player_index}"),
        "zoneId": zone_id,
        "tapped": card.get("tapped").and_then(Value::as_bool).unwrap_or(false),
        "counters": card.get("counters").cloned().unwrap_or_else(|| json!({})),
        "damage": card.get("damage").and_then(Value::as_i64).unwrap_or(0),
        "summoningSick": card.get("summoning_sick").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn to_stack_object(entry: &Value, index: usize, controller_id: &str) -> Value {
    json!({
        "id": entry
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("engine-stack-{index}")),
        "sourceId": format!("engine-stack-source-{index}"),
        "controllerId": controller_id,
        "name": entry
            .as_str()
            .or_else(|| entry.get("name").and_then(Value::as_str))
            .unwrap_or("Stack object"),
        "text": entry
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "isPermanentSpell": false,
        "isCasting": false,
        "targets": [],
    })
}

fn to_actions(actions: Option<&Value>) -> Vec<Value> {
    actions
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter_map(|(fallback_index, action)| {
            let index = as_usize(action.get("index"), fallback_index);
            let raw_label = action
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let label = format_action_label(raw_label);
            (!label.is_empty()).then(|| {
                json!({
                    "id": format!("prompt-action-{index}"),
                    "label": label,
                    "cardName": action_card_name(raw_label),
                    "cardKey": action_card_key(raw_label),
                    "kind": action_kind(raw_label),
                })
            })
        })
        .collect()
}

fn card_ids_by_name<'a, I>(cards: I) -> HashMap<String, Vec<String>>
where
    I: IntoIterator<Item = &'a Value>,
{
    let mut ids_by_name: HashMap<String, Vec<String>> = HashMap::new();
    for card in cards {
        let Some(name) = card.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(id) = card.get("id").and_then(Value::as_str) else {
            continue;
        };
        ids_by_name
            .entry(name.to_string())
            .or_default()
            .push(id.to_string());
    }
    ids_by_name
}

fn card_ids_by_key<'a, I>(cards: I) -> HashMap<String, String>
where
    I: IntoIterator<Item = &'a Value>,
{
    let mut ids_by_key = HashMap::new();
    for card in cards {
        let Some(id) = card.get("id").and_then(Value::as_str) else {
            continue;
        };
        if let Some(key) = id.strip_prefix("engine-card-") {
            if !key.contains('-') {
                ids_by_key.insert(key.to_string(), id.to_string());
            }
        }
    }
    ids_by_key
}

fn pop_card_id(ids_by_name: &mut HashMap<String, Vec<String>>, card_name: &str) -> Option<String> {
    let ids = ids_by_name.get_mut(card_name)?;
    if ids.is_empty() {
        None
    } else {
        Some(ids.remove(0))
    }
}

fn to_card_ids(cards: Option<&Value>) -> Vec<String> {
    cards
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|card| {
            card.get("id")
                .and_then(Value::as_str)
                .map(normalize_card_id)
        })
        .collect()
}

fn to_target_ids(targets: Option<&Value>) -> Vec<String> {
    targets
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|target| target.get("id").and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn to_target_card_ids(cards: Option<&Value>) -> Vec<String> {
    cards
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|card| {
            card.get("id")
                .and_then(Value::as_str)
                .map(normalize_card_id)
        })
        .collect()
}

fn optional_normalized_card_id(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(normalize_card_id)
}

fn to_prompt_cards(cards: Option<&Value>) -> Vec<Value> {
    cards
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|card| {
            let id = card.get("id").and_then(Value::as_str)?;
            let name = card
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("Unknown Card");
            Some(json!({
                "id": normalize_card_id(id),
                "name": name,
            }))
        })
        .collect()
}

fn to_strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

fn to_defender_ids(defenders: Option<&Value>) -> Vec<Value> {
    defenders
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|defender| {
            let id = defender.get("id").and_then(Value::as_str)?;
            let label = defender.get("label").and_then(Value::as_str).unwrap_or(id);
            Some(json!({
                "id": id,
                "label": label,
            }))
        })
        .collect()
}

fn normalize_card_id(id: &str) -> String {
    id.strip_prefix("java-card-")
        .map(|suffix| format!("engine-card-{suffix}"))
        .unwrap_or_else(|| id.to_string())
}

fn action_kind(label: &str) -> Option<&'static str> {
    match strip_action_suffix(label)
        .split_once(':')
        .map(|(kind, _)| kind)
    {
        Some("LAND") => Some("play"),
        Some("SPELL") => Some("cast"),
        Some("CYCLE") => Some("ability"),
        Some("MANA") => Some("mana"),
        Some("AB") => Some("ability"),
        _ => None,
    }
}

fn format_action_label(label: &str) -> String {
    let normalized = strip_action_suffix(label);
    let Some((kind, card_name)) = normalized.split_once(':') else {
        return normalized;
    };
    let display_name = action_display_name(card_name);
    match kind {
        "LAND" => format!("Play {display_name}"),
        "SPELL" => format!("Cast {display_name}"),
        "CYCLE" => format!("Cycle {display_name}"),
        "MANA" => format!("Activate mana: {display_name}"),
        "AB" => format!("Activate {display_name}"),
        _ => normalized,
    }
}

fn action_card_name(label: &str) -> Option<String> {
    strip_action_suffix(label)
        .split_once(':')
        .map(|(_, card_name)| action_host_name(card_name).to_string())
}

fn action_display_name(card_name: &str) -> &str {
    card_name
        .split_once('|')
        .map(|(_, face_name)| face_name)
        .unwrap_or(card_name)
}

fn action_host_name(card_name: &str) -> &str {
    card_name
        .split_once('|')
        .map(|(host, _)| host)
        .unwrap_or(card_name)
}

fn action_card_key(label: &str) -> Option<String> {
    label
        .split('@')
        .nth(1)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
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

fn action_index(value: Option<&Value>) -> Option<usize> {
    value
        .and_then(Value::as_str)
        .and_then(|id| id.strip_prefix("prompt-action-"))
        .and_then(|index| index.parse::<usize>().ok())
}

fn player_id(index: Option<&Value>) -> String {
    format!("player-{}", as_usize(index, 0))
}

fn normalize_step(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_str).unwrap_or_default() {
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

fn as_usize(value: Option<&Value>, fallback: usize) -> usize {
    value
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(fallback)
}

fn as_i64(value: Option<&Value>, fallback: i64) -> i64 {
    value.and_then(Value::as_i64).unwrap_or(fallback)
}

fn array_len(value: Option<&Value>) -> usize {
    value.and_then(Value::as_array).map(Vec::len).unwrap_or(0)
}
