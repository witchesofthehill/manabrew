//! Emits one example of every `AgentPromptInner` variant as JSONL — the corpus
//! the UI prompt-handling test replays. A new variant won't compile until added.
use forge_agent_interface::game_view_dto::TargetingIntent;
use forge_agent_interface::prompt::{AgentPrompt, AgentPromptInner};

fn wrap(inner: AgentPromptInner) -> AgentPrompt {
    AgentPrompt {
        deciding_player_id: "player-0".to_string(),
        source_card_id: None,
        input: inner,
    }
}

fn main() {
    use AgentPromptInner::*;
    let prompts = vec![
        Mulligan {
            hand_card_ids: vec![],
            mulligan_count: 0,
        },
        MulliganPutBack {
            hand_card_ids: vec![],
            cards: vec![],
            count: 0,
        },
        ChooseAction {
            playable_card_ids: vec![],
            playable_options: vec![],
            tappable_land_ids: vec![],
            untappable_land_ids: vec![],
            activatable_ability_ids: vec![],
            mana_ability_options: vec![],
            available_player_actions: vec![],
        },
        ChooseAttackers {
            available_attacker_ids: vec![],
            possible_defender_ids: vec![],
        },
        ChooseBlockers {
            attacker_ids: vec![],
            available_blocker_ids: vec![],
        },
        ChooseTargetPlayer {
            valid_player_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        },
        ChooseTargetCard {
            valid_card_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 1,
            max_targets: 1,
            chosen_targets: 0,
        },
        ChooseTargetAny {
            valid_player_ids: vec![],
            valid_card_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        },
        ChooseTargetCardFromZone {
            valid_card_ids: vec![],
            zone: String::new(),
            zone_cards: vec![],
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        },
        GameOver {},
        RevealCards {
            cards: vec![],
            zone: String::new(),
            owner_player_id: String::new(),
            message: String::new(),
        },
        Scry {
            card_ids: vec![],
            cards: vec![],
        },
        Surveil {
            card_ids: vec![],
            cards: vec![],
        },
        Dig {
            card_ids: vec![],
            cards: vec![],
            num_to_take: 0,
            optional: false,
        },
        ChooseDiscard {
            hand_card_ids: vec![],
            num_to_discard: 0,
        },
        ChooseTargetSpell {
            valid_spell_ids: vec![],
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        },
        ChooseOptionalTrigger {
            description: String::new(),
            cards: vec![],
            prompt_kind: None,
            option_labels: None,
            mode: None,
            api: None,
        },
        PayCostToPreventEffect {
            description: String::new(),
            cost_kind: String::new(),
            api: None,
        },
        ChooseMode {
            options: vec![],
            min_choices: 0,
            max_choices: 0,
            source_card_name: None,
        },
        ChoosePhyrexian {
            phyrexian_color: String::new(),
        },
        ChooseKicker {
            kicker_cost: String::new(),
        },
        ChooseBuyback {
            buyback_cost: String::new(),
        },
        ChooseMultikicker {
            cost: String::new(),
            max_kicks: 0,
        },
        ChooseReplicate {
            cost: String::new(),
            max_replicates: 0,
        },
        ChooseAlternativeCost { options: vec![] },
        ChooseColor {
            valid_colors: vec![],
        },
        ChooseType {
            type_category: String::new(),
            valid_types: vec![],
        },
        ChooseNumber { min: 0, max: 0 },
        ChooseCardName {
            valid_names: vec![],
        },
        ChooseDamageAssignmentOrder {
            attacker_id: String::new(),
            blocker_ids: vec![],
            blocker_cards: vec![],
        },
        ChooseCombatDamageAssignment {
            attacker_id: String::new(),
            blocker_ids: vec![],
            defender_id: None,
            total_damage: 0,
            attacker_has_deathtouch: false,
        },
        PayCombatCost {
            attacker_id: String::new(),
            attacker_name: String::new(),
            cost: 0,
            description: String::new(),
            tappable_land_ids: vec![],
            untappable_land_ids: vec![],
            mana_pool_total: 0,
        },
        ChooseDelve {
            valid_card_ids: vec![],
            zone_cards: vec![],
            max_cards: 0,
        },
        ChooseConvoke {
            valid_card_ids: vec![],
            remaining_cost: String::new(),
        },
        ChooseImprovise {
            valid_card_ids: vec![],
            remaining_cost: String::new(),
        },
        PayManaCost {
            card_id: String::new(),
            card_name: String::new(),
            mana_cost: String::new(),
            mana_ability_options: vec![],
            tappable_land_ids: vec![],
            untappable_land_ids: vec![],
            mana_pool_total: 0,
            can_confirm_from_pool: false,
        },
        SpecifyManaCombo {
            available_colors: vec![],
            amount: 0,
        },
        ChooseExertAttackers {
            attacker_ids: vec![],
            attacker_cards: vec![],
        },
        ChooseEnlistAttackers {
            attacker_ids: vec![],
            attacker_cards: vec![],
        },
        ReorderLibrary {
            card_ids: vec![],
            cards: vec![],
            destination: None,
            top_of_deck: true,
        },
        ExploreDecision {
            revealed_card_name: String::new(),
            revealed_card: None,
        },
        HelpPayAssist {
            card_name: String::new(),
            max_generic: 0,
        },
        FirstPlayerRoll {
            sides: 0,
            rolls: vec![],
            winner_player_id: String::new(),
        },
        DiceRolled {
            player_id: String::new(),
            sides: 0,
            natural_results: vec![],
            final_results: vec![],
            ignored_rolls: vec![],
            source_card_name: None,
        },
        ChooseRollToIgnore { rolls: vec![] },
        ChooseRollToSwap { rolls: vec![] },
        ChooseRollToModify { rolls: vec![] },
        ChooseDiceToReroll { rolls: vec![] },
        ChooseRollSwapValue {
            current_result: 0,
            power: 0,
            toughness: 0,
        },
        ChooseCardsForEffect {
            valid_card_ids: vec![],
            zone_cards: vec![],
            min_choices: 0,
            max_choices: 0,
            source_card_name: None,
            optional: false,
        },
    ];

    for inner in prompts {
        println!(
            "{}",
            serde_json::to_string(&wrap(inner)).expect("serialize prompt")
        );
    }
}
