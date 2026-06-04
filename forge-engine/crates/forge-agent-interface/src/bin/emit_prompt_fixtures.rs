//! Emits one example of every `AgentPromptInner` variant as JSONL — the corpus
//! the UI prompt-handling test replays. A new variant won't compile until added.
use forge_agent_interface::game_view_dto::{GameViewDto, TargetingIntent};
use forge_agent_interface::prompt::{AgentPrompt, AgentPromptInner};

fn wrap(inner: AgentPromptInner) -> AgentPrompt {
    AgentPrompt {
        deciding_player_id: "player-0".to_string(),
        display_events: vec![],
        source_card_id: None,
        inner,
    }
}

fn gv() -> GameViewDto {
    GameViewDto::default()
}

fn main() {
    use AgentPromptInner::*;
    let prompts = vec![
        Mulligan {
            game_view: gv(),
            hand_card_ids: vec![],
            mulligan_count: 0,
        },
        MulliganPutBack {
            game_view: gv(),
            hand_card_ids: vec![],
            cards: vec![],
            count: 0,
        },
        ChooseAction {
            game_view: gv(),
            playable_card_ids: vec![],
            playable_options: vec![],
            tappable_land_ids: vec![],
            untappable_land_ids: vec![],
            activatable_ability_ids: vec![],
            mana_ability_options: vec![],
            available_player_actions: vec![],
        },
        ChooseAttackers {
            game_view: gv(),
            available_attacker_ids: vec![],
            possible_defender_ids: vec![],
        },
        ChooseBlockers {
            game_view: gv(),
            attacker_ids: vec![],
            available_blocker_ids: vec![],
        },
        ChooseTargetPlayer {
            game_view: gv(),
            valid_player_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
        },
        ChooseTargetCard {
            game_view: gv(),
            valid_card_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
            min_targets: 1,
            max_targets: 1,
            chosen_targets: 0,
        },
        ChooseTargetAny {
            game_view: gv(),
            valid_player_ids: vec![],
            valid_card_ids: vec![],
            hostile: false,
            intent: TargetingIntent::default(),
        },
        ChooseTargetCardFromZone {
            game_view: gv(),
            valid_card_ids: vec![],
            zone: String::new(),
            zone_cards: vec![],
            intent: TargetingIntent::default(),
            min_targets: 0,
            max_targets: 3,
            chosen_targets: 1,
        },
        GameOver { game_view: gv() },
        StateUpdate { game_view: gv() },
        RevealCards {
            game_view: gv(),
            cards: vec![],
            zone: String::new(),
            owner_player_id: String::new(),
            message: String::new(),
        },
        Scry {
            game_view: gv(),
            card_ids: vec![],
            cards: vec![],
        },
        Surveil {
            game_view: gv(),
            card_ids: vec![],
            cards: vec![],
        },
        Dig {
            game_view: gv(),
            card_ids: vec![],
            cards: vec![],
            num_to_take: 0,
            optional: false,
        },
        ChooseDiscard {
            game_view: gv(),
            hand_card_ids: vec![],
            num_to_discard: 0,
        },
        ChooseTargetSpell {
            game_view: gv(),
            valid_spell_ids: vec![],
            intent: TargetingIntent::default(),
        },
        ChooseOptionalTrigger {
            game_view: gv(),
            description: String::new(),
            cards: vec![],
            prompt_kind: None,
            option_labels: None,
            mode: None,
            api: None,
        },
        PayCostToPreventEffect {
            game_view: gv(),
            description: String::new(),
            cost_kind: String::new(),
            api: None,
        },
        ChooseMode {
            game_view: gv(),
            options: vec![],
            min_choices: 0,
            max_choices: 0,
            source_card_name: None,
        },
        ChoosePhyrexian {
            game_view: gv(),
            phyrexian_color: String::new(),
        },
        ChooseKicker {
            game_view: gv(),
            kicker_cost: String::new(),
        },
        ChooseBuyback {
            game_view: gv(),
            buyback_cost: String::new(),
        },
        ChooseMultikicker {
            game_view: gv(),
            cost: String::new(),
            max_kicks: 0,
        },
        ChooseReplicate {
            game_view: gv(),
            cost: String::new(),
            max_replicates: 0,
        },
        ChooseAlternativeCost {
            game_view: gv(),
            options: vec![],
        },
        ChooseColor {
            game_view: gv(),
            valid_colors: vec![],
        },
        ChooseType {
            game_view: gv(),
            type_category: String::new(),
            valid_types: vec![],
        },
        ChooseNumber {
            game_view: gv(),
            min: 0,
            max: 0,
        },
        ChooseCardName {
            game_view: gv(),
            valid_names: vec![],
        },
        ChooseDamageAssignmentOrder {
            game_view: gv(),
            attacker_id: String::new(),
            blocker_ids: vec![],
            blocker_cards: vec![],
        },
        ChooseCombatDamageAssignment {
            game_view: gv(),
            attacker_id: String::new(),
            blocker_ids: vec![],
            defender_id: None,
            total_damage: 0,
            attacker_has_deathtouch: false,
        },
        PayCombatCost {
            game_view: gv(),
            attacker_id: String::new(),
            attacker_name: String::new(),
            cost: 0,
            description: String::new(),
            tappable_land_ids: vec![],
            untappable_land_ids: vec![],
            mana_pool_total: 0,
        },
        ChooseDelve {
            game_view: gv(),
            valid_card_ids: vec![],
            zone_cards: vec![],
            max_cards: 0,
        },
        ChooseConvoke {
            game_view: gv(),
            valid_card_ids: vec![],
            remaining_cost: String::new(),
        },
        ChooseImprovise {
            game_view: gv(),
            valid_card_ids: vec![],
            remaining_cost: String::new(),
        },
        PayManaCost {
            game_view: gv(),
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
            game_view: gv(),
            available_colors: vec![],
            amount: 0,
        },
        ChooseExertAttackers {
            game_view: gv(),
            attacker_ids: vec![],
            attacker_cards: vec![],
        },
        ChooseEnlistAttackers {
            game_view: gv(),
            attacker_ids: vec![],
            attacker_cards: vec![],
        },
        ReorderLibrary {
            game_view: gv(),
            card_ids: vec![],
            cards: vec![],
        },
        ExploreDecision {
            game_view: gv(),
            revealed_card_name: String::new(),
            revealed_card: None,
        },
        HelpPayAssist {
            game_view: gv(),
            card_name: String::new(),
            max_generic: 0,
        },
        FirstPlayerRoll {
            game_view: gv(),
            sides: 0,
            rolls: vec![],
            winner_player_id: String::new(),
        },
        DiceRolled {
            game_view: gv(),
            player_id: String::new(),
            sides: 0,
            natural_results: vec![],
            final_results: vec![],
            ignored_rolls: vec![],
            source_card_name: None,
        },
        ChooseRollToIgnore {
            game_view: gv(),
            rolls: vec![],
        },
        ChooseRollToSwap {
            game_view: gv(),
            rolls: vec![],
        },
        ChooseRollToModify {
            game_view: gv(),
            rolls: vec![],
        },
        ChooseDiceToReroll {
            game_view: gv(),
            rolls: vec![],
        },
        ChooseRollSwapValue {
            game_view: gv(),
            current_result: 0,
            power: 0,
            toughness: 0,
        },
        ChooseCardsForEffect {
            game_view: gv(),
            valid_card_ids: vec![],
            zone_cards: vec![],
            min_choices: 0,
            max_choices: 0,
            source_card_name: None,
        },
    ];

    for inner in prompts {
        println!(
            "{}",
            serde_json::to_string(&wrap(inner)).expect("serialize prompt")
        );
    }
}
