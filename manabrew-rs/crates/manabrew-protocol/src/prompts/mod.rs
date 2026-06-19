use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod common;

pub mod choose_action;
pub mod choose_attackers;
pub mod choose_blockers;
pub mod choose_board_targets;
pub mod choose_boolean;
pub mod choose_card_name;
pub mod choose_cards;
pub mod choose_color;
pub mod choose_combat_damage_assignment;
pub mod choose_damage_assignment_order;
pub mod choose_delve;
pub mod choose_from_selection;
pub mod choose_number;
pub mod choose_type;
pub mod dice_rolled;
pub mod dig;
pub mod first_player_roll;
pub mod game_over;
pub mod mulligan;
pub mod mulligan_put_back;
pub mod pay_combat_cost;
pub mod pay_mana_cost;
pub mod reorder_cards;
pub mod reveal_cards;
pub mod scry;
pub mod specify_mana_combo;

pub use choose_action::{
    AvailableAction, AvailableActionKind, ChooseActionInput, ChooseActionOutput,
};
pub use choose_attackers::{ChooseAttackersInput, ChooseAttackersOutput};
pub use choose_blockers::{ChooseBlockersInput, ChooseBlockersOutput};
pub use choose_board_targets::{ChooseBoardTargetsInput, ChooseBoardTargetsOutput};
pub use choose_boolean::{ChooseBooleanInput, ChooseBooleanOutput};
pub use choose_card_name::{ChooseCardNameInput, ChooseCardNameOutput};
pub use choose_cards::{ChooseCardsInput, ChooseCardsOutput};
pub use choose_color::{ChooseColorInput, ChooseColorOutput};
pub use choose_combat_damage_assignment::{
    ChooseCombatDamageAssignmentInput, ChooseCombatDamageAssignmentOutput,
};
pub use choose_damage_assignment_order::{
    ChooseDamageAssignmentOrderInput, ChooseDamageAssignmentOrderOutput,
};
pub use choose_delve::{ChooseDelveInput, ChooseDelveOutput};
pub use choose_from_selection::{ChooseFromSelectionInput, ChooseFromSelectionOutput};
pub use choose_number::{ChooseNumberInput, ChooseNumberOutput};
pub use choose_type::{ChooseTypeInput, ChooseTypeOutput};
pub use common::ManaSourceAction;
pub use dice_rolled::{DiceRolledInput, DiceRolledOutput};
pub use dig::{DigInput, DigOutput};
pub use first_player_roll::{FirstPlayerRollInput, FirstPlayerRollOutput};
pub use game_over::GameOverInput;
pub use mulligan::{MulliganInput, MulliganOutput};
pub use mulligan_put_back::{MulliganPutBackInput, MulliganPutBackOutput};
pub use pay_combat_cost::{PayCombatCostInput, PayCombatCostOutput};
pub use pay_mana_cost::{PayManaCostInput, PayManaCostOutput};
pub use reorder_cards::{ReorderCardsInput, ReorderCardsOutput};
pub use reveal_cards::{RevealCardsInput, RevealCardsOutput};
pub use scry::{ScryInput, ScryOutput};
pub use specify_mana_combo::{SpecifyManaComboInput, SpecifyManaComboOutput};

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
    ChooseBoolean(choose_boolean::ChooseBooleanInput),
    ChooseFromSelection(choose_from_selection::ChooseFromSelectionInput),
    GameOver(game_over::GameOverInput),
    RevealCards(reveal_cards::RevealCardsInput),
    Scry(scry::ScryInput),
    Dig(dig::DigInput),
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
    PayManaCost(pay_mana_cost::PayManaCostInput),
    SpecifyManaCombo(specify_mana_combo::SpecifyManaComboInput),
    ChooseCards(choose_cards::ChooseCardsInput),
    ReorderCards(reorder_cards::ReorderCardsInput),
    FirstPlayerRoll(first_player_roll::FirstPlayerRollInput),
    DiceRolled(dice_rolled::DiceRolledInput),
}

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
    ChooseBoolean(choose_boolean::ChooseBooleanOutput),
    ChooseFromSelection(choose_from_selection::ChooseFromSelectionOutput),
    RevealCards(reveal_cards::RevealCardsOutput),
    Scry(scry::ScryOutput),
    Dig(dig::DigOutput),
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
    PayManaCost(pay_mana_cost::PayManaCostOutput),
    ManaSource(common::ManaSourceAction),
    SpecifyManaCombo(specify_mana_combo::SpecifyManaComboOutput),
    ChooseCards(choose_cards::ChooseCardsOutput),
    ReorderCards(reorder_cards::ReorderCardsOutput),
    FirstPlayerRoll(first_player_roll::FirstPlayerRollOutput),
    DiceRolled(dice_rolled::DiceRolledOutput),
}
