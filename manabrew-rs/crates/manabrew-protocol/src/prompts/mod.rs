use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod common;

pub mod choose_action;
pub mod choose_alternative_cost;
pub mod choose_attackers;
pub mod choose_blockers;
pub mod choose_board_targets;
pub mod choose_buyback;
pub mod choose_card_name;
pub mod choose_cards_for_effect;
pub mod choose_color;
pub mod choose_combat_damage_assignment;
pub mod choose_convoke;
pub mod choose_damage_assignment_order;
pub mod choose_delve;
pub mod choose_dice_to_reroll;
pub mod choose_discard;
pub mod choose_enlist_attackers;
pub mod choose_exert_attackers;
pub mod choose_improvise;
pub mod choose_kicker;
pub mod choose_mode;
pub mod choose_multikicker;
pub mod choose_number;
pub mod choose_optional_trigger;
pub mod choose_phyrexian;
pub mod choose_replicate;
pub mod choose_roll_swap_value;
pub mod choose_roll_to_ignore;
pub mod choose_roll_to_modify;
pub mod choose_roll_to_swap;
pub mod choose_type;
pub mod dice_rolled;
pub mod dig;
pub mod explore_decision;
pub mod first_player_roll;
pub mod game_over;
pub mod help_pay_assist;
pub mod mulligan;
pub mod mulligan_put_back;
pub mod pay_combat_cost;
pub mod pay_cost_to_prevent_effect;
pub mod pay_mana_cost;
pub mod reorder_library;
pub mod reveal_cards;
pub mod scry;
pub mod specify_mana_combo;
pub mod surveil;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, export_to = "prompts/promptInput.ts")]
pub enum PromptInput {
    Mulligan(mulligan::MulliganInput),
    MulliganPutBack(mulligan_put_back::MulliganPutBackInput),
    ChooseAction(choose_action::ChooseActionInput),
    ChooseAttackers(choose_attackers::ChooseAttackersInput),
    ChooseBlockers(choose_blockers::ChooseBlockersInput),
    ChooseBoardTargets(choose_board_targets::ChooseBoardTargetsInput),
    GameOver(game_over::GameOverInput),
    RevealCards(reveal_cards::RevealCardsInput),
    Scry(scry::ScryInput),
    Surveil(surveil::SurveilInput),
    Dig(dig::DigInput),
    ChooseDiscard(choose_discard::ChooseDiscardInput),
    ChooseOptionalTrigger(choose_optional_trigger::ChooseOptionalTriggerInput),
    PayCostToPreventEffect(pay_cost_to_prevent_effect::PayCostToPreventEffectInput),
    ChooseMode(choose_mode::ChooseModeInput),
    ChoosePhyrexian(choose_phyrexian::ChoosePhyrexianInput),
    ChooseKicker(choose_kicker::ChooseKickerInput),
    ChooseBuyback(choose_buyback::ChooseBuybackInput),
    ChooseMultikicker(choose_multikicker::ChooseMultikickerInput),
    ChooseReplicate(choose_replicate::ChooseReplicateInput),
    ChooseAlternativeCost(choose_alternative_cost::ChooseAlternativeCostInput),
    ChooseColor(choose_color::ChooseColorInput),
    ChooseType(choose_type::ChooseTypeInput),
    ChooseNumber(choose_number::ChooseNumberInput),
    ChooseCardName(choose_card_name::ChooseCardNameInput),
    ChooseDamageAssignmentOrder(choose_damage_assignment_order::ChooseDamageAssignmentOrderInput),
    ChooseCombatDamageAssignment(
        choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput,
    ),
    PayCombatCost(pay_combat_cost::PayCombatCostInput),
    ChooseDelve(choose_delve::ChooseDelveInput),
    ChooseConvoke(choose_convoke::ChooseConvokeInput),
    ChooseImprovise(choose_improvise::ChooseImproviseInput),
    PayManaCost(pay_mana_cost::PayManaCostInput),
    SpecifyManaCombo(specify_mana_combo::SpecifyManaComboInput),
    ChooseExertAttackers(choose_exert_attackers::ChooseExertAttackersInput),
    ChooseEnlistAttackers(choose_enlist_attackers::ChooseEnlistAttackersInput),
    ReorderLibrary(reorder_library::ReorderLibraryInput),
    ExploreDecision(explore_decision::ExploreDecisionInput),
    HelpPayAssist(help_pay_assist::HelpPayAssistInput),
    FirstPlayerRoll(first_player_roll::FirstPlayerRollInput),
    DiceRolled(dice_rolled::DiceRolledInput),
    ChooseRollToIgnore(choose_roll_to_ignore::ChooseRollToIgnoreInput),
    ChooseRollToSwap(choose_roll_to_swap::ChooseRollToSwapInput),
    ChooseRollToModify(choose_roll_to_modify::ChooseRollToModifyInput),
    ChooseDiceToReroll(choose_dice_to_reroll::ChooseDiceToRerollInput),
    ChooseRollSwapValue(choose_roll_swap_value::ChooseRollSwapValueInput),
    ChooseCardsForEffect(choose_cards_for_effect::ChooseCardsForEffectInput),
}

/// Union of every per-prompt response shape. Untagged because each `*Output` is
/// already a `type`-tagged union; this exists to generate the TS `PromptOutput`
/// union and to act as the ts-rs export root for the output types. The engine
/// wire response is `PlayerAction` (in `manabrew-agent-interface`), not this.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "prompts/promptOutput.ts")]
pub enum PromptOutput {
    Mulligan(mulligan::MulliganOutput),
    MulliganPutBack(mulligan_put_back::MulliganPutBackOutput),
    ChooseAction(choose_action::ChooseActionOutput),
    ChooseAttackers(choose_attackers::ChooseAttackersOutput),
    ChooseBlockers(choose_blockers::ChooseBlockersOutput),
    ChooseBoardTargets(choose_board_targets::ChooseBoardTargetsOutput),
    RevealCards(reveal_cards::RevealCardsOutput),
    Scry(scry::ScryOutput),
    Surveil(surveil::SurveilOutput),
    Dig(dig::DigOutput),
    ChooseDiscard(choose_discard::ChooseDiscardOutput),
    ChooseOptionalTrigger(choose_optional_trigger::ChooseOptionalTriggerOutput),
    PayCostToPreventEffect(pay_cost_to_prevent_effect::PayCostToPreventEffectOutput),
    ChooseMode(choose_mode::ChooseModeOutput),
    ChoosePhyrexian(choose_phyrexian::ChoosePhyrexianOutput),
    ChooseKicker(choose_kicker::ChooseKickerOutput),
    ChooseBuyback(choose_buyback::ChooseBuybackOutput),
    ChooseMultikicker(choose_multikicker::ChooseMultikickerOutput),
    ChooseReplicate(choose_replicate::ChooseReplicateOutput),
    ChooseAlternativeCost(choose_alternative_cost::ChooseAlternativeCostOutput),
    ChooseColor(choose_color::ChooseColorOutput),
    ChooseType(choose_type::ChooseTypeOutput),
    ChooseNumber(choose_number::ChooseNumberOutput),
    ChooseCardName(choose_card_name::ChooseCardNameOutput),
    ChooseDamageAssignmentOrder(choose_damage_assignment_order::ChooseDamageAssignmentOrderOutput),
    ChooseCombatDamageAssignment(
        choose_combat_damage_assignment::ChooseCombatDamageAssignmentOutput,
    ),
    PayCombatCost(pay_combat_cost::PayCombatCostOutput),
    ChooseDelve(choose_delve::ChooseDelveOutput),
    ChooseConvoke(choose_convoke::ChooseConvokeOutput),
    ChooseImprovise(choose_improvise::ChooseImproviseOutput),
    PayManaCost(pay_mana_cost::PayManaCostOutput),
    SpecifyManaCombo(specify_mana_combo::SpecifyManaComboOutput),
    ChooseExertAttackers(choose_exert_attackers::ChooseExertAttackersOutput),
    ChooseEnlistAttackers(choose_enlist_attackers::ChooseEnlistAttackersOutput),
    ReorderLibrary(reorder_library::ReorderLibraryOutput),
    ExploreDecision(explore_decision::ExploreDecisionOutput),
    HelpPayAssist(help_pay_assist::HelpPayAssistOutput),
    FirstPlayerRoll(first_player_roll::FirstPlayerRollOutput),
    DiceRolled(dice_rolled::DiceRolledOutput),
    ChooseRollToIgnore(choose_roll_to_ignore::ChooseRollToIgnoreOutput),
    ChooseRollToSwap(choose_roll_to_swap::ChooseRollToSwapOutput),
    ChooseRollToModify(choose_roll_to_modify::ChooseRollToModifyOutput),
    ChooseDiceToReroll(choose_dice_to_reroll::ChooseDiceToRerollOutput),
    ChooseRollSwapValue(choose_roll_swap_value::ChooseRollSwapValueOutput),
    ChooseCardsForEffect(choose_cards_for_effect::ChooseCardsForEffectOutput),
}
