//! Emits one example of every `PromptInput` variant as JSONL — the corpus
//! the UI prompt-handling test replays. A new variant won't compile until added.
use manabrew_agent_interface::game_view_dto::TargetingIntent;
use manabrew_agent_interface::prompt::{
    AgentPrompt, AvailableAction, AvailableActionKind, PromptInput,
};
use manabrew_protocol::prompts::*;

fn wrap(inner: PromptInput) -> AgentPrompt {
    AgentPrompt {
        prompt_id: 0,
        deciding_player_id: "player-0".to_string(),
        source_card_id: None,
        input: inner,
    }
}

fn main() {
    use PromptInput::*;
    let prompts = vec![
        Mulligan(mulligan::MulliganInput {
            hand_card_ids: vec![],
            mulligan_count: 0,
        }),
        MulliganPutBack(mulligan_put_back::MulliganPutBackInput {
            hand_card_ids: vec![],
            cards: vec![],
            count: 0,
        }),
        ChooseAction(choose_action::ChooseActionInput {
            actions: vec![
                AvailableAction {
                    id: "0".into(),
                    kind: AvailableActionKind::Cast {
                        card_id: "card-1".into(),
                        mode: "normal".into(),
                        mode_label: "Cast normally".into(),
                    },
                },
                AvailableAction {
                    id: "1".into(),
                    kind: AvailableActionKind::Cast {
                        card_id: "card-2".into(),
                        mode: "normal".into(),
                        mode_label: "Play land".into(),
                    },
                },
                AvailableAction {
                    id: "2".into(),
                    kind: AvailableActionKind::ActivateAbility {
                        card_id: "card-3".into(),
                        ability_index: 0,
                        description: "{T}: Add {G}.".into(),
                        cost: Some("{T}".into()),
                        is_mana_ability: true,
                        produced_mana: Some("G".into()),
                    },
                },
                AvailableAction {
                    id: "3".into(),
                    kind: AvailableActionKind::UndoMana {
                        card_id: "card-3".into(),
                    },
                },
            ],
        }),
        ChooseAttackers(choose_attackers::ChooseAttackersInput {
            attackers: vec![],
            attack_targets: vec![],
        }),
        ChooseBlockers(choose_blockers::ChooseBlockersInput {
            attackers: vec![],
            available_blocker_ids: vec![],
            error: None,
        }),
        ChooseBoardTargets(choose_board_targets::ChooseBoardTargetsInput {
            candidates: vec![
                common::TargetRef::Player {
                    id: "player-1".into(),
                },
                common::TargetRef::Card {
                    id: "card-1".into(),
                },
                common::TargetRef::Spell {
                    id: "stack-1".into(),
                },
            ],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 1,
            max_targets: 1,
            chosen_targets: 0,
            label: "Damage".to_string(),
        }),
        GameOver(game_over::GameOverInput {}),
        RevealCards(reveal::RevealCardsInput {
            cards: vec![],
            zone: String::new(),
            owner_player_id: String::new(),
            message: String::new(),
        }),
        Scry(scry::ScryInput {
            presentation: common::PromptPresentation {
                title: "Scry".to_string(),
                description: None,
                text: None,
                source_card_id: None,
                targets: Vec::new(),
            },
            cards: vec![],
            zones: vec![
                scry::ScryDestination::LibraryTop,
                scry::ScryDestination::LibraryBottom,
            ],
        }),
        ChooseColor(choose_color::ChooseColorInput {
            valid_colors: vec![],
            amount: 1,
            repeat_allowed: false,
        }),
        ChooseNumber(choose_number::ChooseNumberInput {
            presentation: common::PromptPresentation {
                title: "Choose a number".to_string(),
                description: Some("Pay {2} for each replicate.".to_string()),
                text: None,
                source_card_id: None,
                targets: Vec::new(),
            },
            min: 0,
            max: 5,
        }),
        ChooseDamageAssignmentOrder(
            choose_damage_assignment_order::ChooseDamageAssignmentOrderInput {
                attacker_id: String::new(),
                blocker_ids: vec![],
                blocker_cards: vec![],
            },
        ),
        ChooseCombatDamageAssignment(
            choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput {
                attacker_id: String::new(),
                blocker_ids: vec![],
                defender_id: None,
                total_damage: 0,
                attacker_has_deathtouch: false,
            },
        ),
        PayManaCost(pay_mana_cost::PayManaCostInput {
            card_id: String::new(),
            card_name: String::new(),
            description: None,
            mana_cost: String::new(),
            mana_ability_options: vec![],
            tappable_source_ids: vec![],
            untappable_source_ids: vec![],
            delve_source_ids: vec![],
            mana_pool_total: 0,
            can_confirm_from_pool: false,
        }),
        ChooseBoolean(choose_boolean::ChooseBooleanInput {
            presentation: common::PromptPresentation {
                title: "Pay Buyback?".to_string(),
                description: Some("Pay additional buyback cost: {3}{G}".to_string()),
                text: Some(
                    "If paid, this spell returns to your hand instead of going to the graveyard."
                        .to_string(),
                ),
                source_card_id: None,
                targets: Vec::new(),
            },
            confirm_label: "Pay Buyback".to_string(),
            deny_label: "No".to_string(),
        }),
        ChooseFromSelection(choose_from_selection::ChooseFromSelectionInput {
            presentation: common::PromptPresentation {
                title: "Choose Mode".to_string(),
                description: Some("Choose one or both —".to_string()),
                text: None,
                source_card_id: None,
                targets: Vec::new(),
            },
            options: vec![
                "Destroy target artifact".to_string(),
                "Destroy target enchantment".to_string(),
            ],
            min_choices: 1,
            max_choices: 2,
        }),
        DiceRolled(dice_rolled::DiceRolledInput {
            sides: 0,
            rolls: vec![],
            title: None,
            source_card_name: None,
        }),
        ChooseCards(choose_cards::ChooseCardsInput {
            presentation: common::PromptPresentation {
                title: "Choose cards".to_string(),
                description: None,
                text: None,
                source_card_id: None,
                targets: Vec::new(),
            },
            cards: vec![],
            min: 0,
            max: 0,
        }),
        ReorderCards(reorder_cards::ReorderCardsInput {
            presentation: common::PromptPresentation {
                title: "Reorder".to_string(),
                description: None,
                text: None,
                source_card_id: None,
                targets: Vec::new(),
            },
            cards: vec![],
            target_label: "Top of Library".to_string(),
            top_of_deck: true,
        }),
    ];

    for inner in prompts {
        println!(
            "{}",
            serde_json::to_string(&wrap(inner)).expect("serialize prompt")
        );
    }
}
