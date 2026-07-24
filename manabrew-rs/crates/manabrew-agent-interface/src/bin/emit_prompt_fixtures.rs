//! Emits one example of every `PromptInput` variant as JSONL — the corpus
//! the UI prompt-handling test replays. A new variant won't compile until added.
use manabrew_agent_interface::game_view_dto::{
    target_ref_card, target_ref_player, target_ref_spell, CardDto, CardIdentity, TargetingIntent,
    ZoneKind,
};
use manabrew_agent_interface::prompt::{
    AgentPrompt, AvailableAction, AvailableActionKind, Mana, ManaColor, PlayCardMode, PromptInput,
};
use manabrew_protocol::prompts::*;

fn wrap(inner: PromptInput) -> AgentPrompt {
    AgentPrompt {
        prompt_id: 0,
        deciding_player_id: "player-0".to_string(),
        source_card: Some(CardDto {
            id: "card-1".to_string(),
            identity: CardIdentity {
                name: "Lightning Bolt".to_string(),
                set_code: "M11".to_string(),
                card_number: "149".to_string(),
                is_token: false,
            },
            owner_id: "player-0".to_string(),
            controller_id: "player-0".to_string(),
            ..CardDto::default()
        }),
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
                        mode: PlayCardMode::Normal,
                        label: "Cast normally".into(),
                    },
                },
                AvailableAction {
                    id: "1".into(),
                    kind: AvailableActionKind::Cast {
                        card_id: "card-2".into(),
                        mode: PlayCardMode::Normal,
                        label: "Play land".into(),
                    },
                },
                AvailableAction {
                    id: "2".into(),
                    kind: AvailableActionKind::ActivateAbility(common::ActivatableAbilityInfo {
                        card_id: "card-3".into(),
                        ability_index: 0,
                        description: "{T}: Add {G}.".into(),
                        cost: Some("{T}".into()),
                        is_mana_ability: true,
                        produced_mana: Some(vec![Mana {
                            color: ManaColor::Green,
                            amount: 1,
                        }]),
                    }),
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
            presentation: common::PromptPresentation {
                title: "Damage".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            candidates: vec![
                target_ref_player("player-1".into()),
                target_ref_card("card-1".into()),
                target_ref_spell("stack-1".into()),
            ],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 1,
            max_targets: 1,
            chosen_targets: 0,
        }),
        GameOver(game_over::GameOverInput {}),
        RevealCards(reveal::RevealCardsInput {
            presentation: common::PromptPresentation {
                title: "Look at these cards".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            cards: vec![],
            zone: ZoneKind::Library,
            owner_player_id: String::new(),
        }),
        Scry(scry::ScryInput {
            presentation: common::PromptPresentation {
                title: "Scry".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            cards: vec![],
            zones: vec![
                scry::ScryDestination::LibraryTop,
                scry::ScryDestination::LibraryBottom,
            ],
        }),
        ChooseColor(choose_color::ChooseColorInput {
            presentation: common::PromptPresentation {
                title: "Choose a color".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            valid_colors: vec![],
            amount: 1,
            repeat_allowed: false,
        }),
        ChooseNumber(choose_number::ChooseNumberInput {
            presentation: common::PromptPresentation {
                title: "Choose a number".to_string(),
                description: Some("Pay {2} for each replicate.".to_string()),
                text: None,
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
            presentation: common::PromptPresentation {
                title: "Lightning Bolt".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            card_id: String::new(),
            card_name: String::new(),
            mana_cost: String::new(),
            can_confirm_from_pool: false,
            actions: vec![],
        }),
        ChooseBoolean(choose_boolean::ChooseBooleanInput {
            presentation: common::PromptPresentation {
                title: "Pay Buyback?".to_string(),
                description: Some("Pay additional buyback cost: {3}{G}".to_string()),
                text: Some(
                    "If paid, this spell returns to your hand instead of going to the graveyard."
                        .to_string(),
                ),
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
                targets: Vec::new(),
            },
            options: vec![
                choose_from_selection::SelectionOption {
                    label: "Destroy target artifact".to_string(),
                    weight: 1,
                    can_repeat: false,
                },
                choose_from_selection::SelectionOption {
                    label: "Destroy target enchantment".to_string(),
                    weight: 1,
                    can_repeat: false,
                },
            ],
            min_total: 1,
            max_total: 2,
        }),
        DiceRolled(dice_rolled::DiceRolledInput {
            presentation: common::PromptPresentation {
                title: "Dice roll".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            sides: 0,
            rolls: vec![],
            source_card_name: None,
        }),
        ChooseCards(choose_cards::ChooseCardsInput {
            presentation: common::PromptPresentation {
                title: "Choose cards".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            cards: vec![],
            min: 0,
            max: 0,
        }),
        Reorder(reorder::ReorderInput {
            presentation: common::PromptPresentation {
                title: "Reorder".to_string(),
                description: None,
                text: None,
                targets: Vec::new(),
            },
            items: vec![],
        }),
    ];

    for inner in prompts {
        println!(
            "{}",
            serde_json::to_string(&wrap(inner)).expect("serialize prompt")
        );
    }
}
