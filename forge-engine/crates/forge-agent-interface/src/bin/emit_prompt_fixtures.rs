//! Emits one example of every `PromptInput` variant as JSONL — the corpus
//! the UI prompt-handling test replays. A new variant won't compile until added.
use forge_agent_interface::game_view_dto::TargetingIntent;
use forge_agent_interface::prompt::{
    AgentPrompt, AvailableAction, AvailableActionKind, PromptInput,
};
use forge_protocol::prompts::*;

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
                    kind: AvailableActionKind::PlayLand {
                        card_id: "card-2".into(),
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
            available_attacker_ids: vec![],
            possible_defender_ids: vec![],
        }),
        ChooseBlockers(choose_blockers::ChooseBlockersInput {
            attacker_ids: vec![],
            available_blocker_ids: vec![],
        }),
        ChooseTargetPlayer(choose_target_player::ChooseTargetPlayerInput {
            valid_player_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        }),
        ChooseTargetCard(choose_target_card::ChooseTargetCardInput {
            valid_card_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 1,
            max_targets: 1,
            chosen_targets: 0,
        }),
        ChooseTargetAny(choose_target_any::ChooseTargetAnyInput {
            valid_player_ids: vec![],
            valid_card_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        }),
        ChooseTargetCardFromZone(
            choose_target_card_from_zone::ChooseTargetCardFromZoneInput {
                valid_card_ids: vec![],
                zone: String::new(),
                zone_cards: vec![],
                intent: TargetingIntent::default(),
                min_targets: 0,
                max_targets: 3,
                chosen_targets: 1,
            },
        ),
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
        ChooseTargetSpell(choose_target_spell::ChooseTargetSpellInput {
            valid_spell_ids: vec![],
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        }),
        ChooseOptionalTrigger(choose_optional_trigger::ChooseOptionalTriggerInput {
            description: String::new(),
            cards: vec![],
            prompt_kind: None,
            option_labels: None,
            mode: None,
            api: None,
        }),
        PayCostToPreventEffect(pay_cost_to_prevent_effect::PayCostToPreventEffectInput {
            description: String::new(),
            cost_kind: String::new(),
            api: None,
        }),
        ChooseMode(choose_mode::ChooseModeInput {
            options: vec![],
            min_choices: 0,
            max_choices: 0,
            source_card_name: None,
        }),
        ChoosePhyrexian(choose_phyrexian::ChoosePhyrexianInput {
            phyrexian_color: String::new(),
        }),
        ChooseKicker(choose_kicker::ChooseKickerInput {
            kicker_cost: String::new(),
        }),
        ChooseBuyback(choose_buyback::ChooseBuybackInput {
            buyback_cost: String::new(),
        }),
        ChooseMultikicker(choose_multikicker::ChooseMultikickerInput {
            cost: String::new(),
            max_kicks: 0,
        }),
        ChooseReplicate(choose_replicate::ChooseReplicateInput {
            cost: String::new(),
            max_replicates: 0,
        }),
        ChooseAlternativeCost(choose_alternative_cost::ChooseAlternativeCostInput {
            options: vec![],
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
            tappable_land_ids: vec![],
            untappable_land_ids: vec![],
            mana_pool_total: 0,
        }),
        ChooseDelve(choose_delve::ChooseDelveInput {
            valid_card_ids: vec![],
            zone_cards: vec![],
            max_cards: 0,
        }),
        ChooseConvoke(choose_convoke::ChooseConvokeInput {
            valid_card_ids: vec![],
            remaining_cost: String::new(),
        }),
        ChooseImprovise(choose_improvise::ChooseImproviseInput {
            valid_card_ids: vec![],
            remaining_cost: String::new(),
        }),
        PayManaCost(pay_mana_cost::PayManaCostInput {
            card_id: String::new(),
            card_name: String::new(),
            mana_cost: String::new(),
            mana_ability_options: vec![],
            tappable_land_ids: vec![],
            untappable_land_ids: vec![],
            mana_pool_total: 0,
            can_confirm_from_pool: false,
        }),
        SpecifyManaCombo(specify_mana_combo::SpecifyManaComboInput {
            available_colors: vec![],
            amount: 0,
        }),
        ChooseExertAttackers(choose_exert_attackers::ChooseExertAttackersInput {
            attacker_ids: vec![],
            attacker_cards: vec![],
        }),
        ChooseEnlistAttackers(choose_enlist_attackers::ChooseEnlistAttackersInput {
            attacker_ids: vec![],
            attacker_cards: vec![],
        }),
        ReorderLibrary(reorder_library::ReorderLibraryInput {
            card_ids: vec![],
            cards: vec![],
            destination: None,
            top_of_deck: true,
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
        ChooseRollToIgnore(choose_roll_to_ignore::ChooseRollToIgnoreInput { rolls: vec![] }),
        ChooseRollToSwap(choose_roll_to_swap::ChooseRollToSwapInput { rolls: vec![] }),
        ChooseRollToModify(choose_roll_to_modify::ChooseRollToModifyInput { rolls: vec![] }),
        ChooseDiceToReroll(choose_dice_to_reroll::ChooseDiceToRerollInput { rolls: vec![] }),
        ChooseRollSwapValue(choose_roll_swap_value::ChooseRollSwapValueInput {
            current_result: 0,
            power: 0,
            toughness: 0,
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
