//! Emits one example of every `PromptInput` variant as JSONL — the corpus
//! the UI prompt-handling test replays. A new variant won't compile until added.
use manabrew_agent_interface::game_view_dto::TargetingIntent;
use manabrew_agent_interface::prompt::{
    AgentPrompt, AvailableAction, AvailableActionKind, PromptInput,
};
use manabrew_protocol::prompts::*;

fn wrap(inner: PromptInput) -> AgentPrompt {
    AgentPrompt {
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
                        produced_colors: Some(vec!["G".into()]),
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
        RevealCards(reveal_cards::RevealCardsInput {
            cards: vec![],
            zone: String::new(),
            owner_player_id: String::new(),
            message: String::new(),
        }),
        Scry(scry::ScryInput {
            card_ids: vec![],
            cards: vec![],
        }),
        Surveil(surveil::SurveilInput {
            card_ids: vec![],
            cards: vec![],
        }),
        Dig(dig::DigInput {
            card_ids: vec![],
            cards: vec![],
            num_to_take: 0,
            optional: false,
        }),
        ChooseDiscard(choose_discard::ChooseDiscardInput {
            hand_card_ids: vec![],
            num_to_discard: 0,
        }),
        ChooseMultikicker(choose_multikicker::ChooseMultikickerInput {
            cost: String::new(),
            max_kicks: 0,
        }),
        ChooseReplicate(choose_replicate::ChooseReplicateInput {
            cost: String::new(),
            max_replicates: 0,
        }),
        ChooseColor(choose_color::ChooseColorInput {
            valid_colors: vec![],
        }),
        ChooseType(choose_type::ChooseTypeInput {
            type_category: String::new(),
            valid_types: vec![],
        }),
        ChooseNumber(choose_number::ChooseNumberInput { min: 0, max: 0 }),
        ChooseCardName(choose_card_name::ChooseCardNameInput {
            valid_names: vec![],
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
        PayCombatCost(pay_combat_cost::PayCombatCostInput {
            attacker_id: String::new(),
            attacker_name: String::new(),
            cost: 0,
            description: String::new(),
            tappable_source_ids: vec![],
            untappable_source_ids: vec![],
            mana_pool_total: 0,
        }),
        ChooseDelve(choose_delve::ChooseDelveInput {
            valid_card_ids: vec![],
            zone_cards: vec![],
            max_cards: 0,
        }),
        PayManaCost(pay_mana_cost::PayManaCostInput {
            card_id: String::new(),
            card_name: String::new(),
            mana_cost: String::new(),
            mana_ability_options: vec![],
            tappable_source_ids: vec![],
            untappable_source_ids: vec![],
            mana_pool_total: 0,
            can_confirm_from_pool: false,
        }),
        SpecifyManaCombo(specify_mana_combo::SpecifyManaComboInput {
            available_colors: vec![],
            amount: 0,
        }),
        ReorderLibrary(reorder_library::ReorderLibraryInput {
            card_ids: vec![],
            cards: vec![],
            destination: None,
            top_of_deck: true,
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
        ExploreDecision(explore_decision::ExploreDecisionInput {
            revealed_card_name: String::new(),
            revealed_card: None,
        }),
        HelpPayAssist(help_pay_assist::HelpPayAssistInput {
            card_name: String::new(),
            max_generic: 0,
        }),
        FirstPlayerRoll(first_player_roll::FirstPlayerRollInput {
            sides: 0,
            rolls: vec![],
            winner_player_id: String::new(),
        }),
        DiceRolled(dice_rolled::DiceRolledInput {
            player_id: String::new(),
            sides: 0,
            natural_results: vec![],
            final_results: vec![],
            ignored_rolls: vec![],
            source_card_name: None,
        }),
        ChooseCardsForEffect(choose_cards_for_effect::ChooseCardsForEffectInput {
            valid_card_ids: vec![],
            zone_cards: vec![],
            min_choices: 0,
            max_choices: 0,
            source_card_name: None,
            optional: false,
        }),
    ];

    for inner in prompts {
        println!(
            "{}",
            serde_json::to_string(&wrap(inner)).expect("serialize prompt")
        );
    }
}
