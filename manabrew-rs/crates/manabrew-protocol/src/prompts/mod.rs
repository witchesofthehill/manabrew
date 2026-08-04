use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod common;

pub mod choose_action;
pub mod choose_attackers;
pub mod choose_blockers;
pub mod choose_board_targets;
pub mod choose_boolean;
pub mod choose_cards;
pub mod choose_color;
pub mod choose_combat_damage_assignment;
pub mod choose_damage_assignment_order;
pub mod choose_from_selection;
pub mod choose_number;
pub mod dice_rolled;
pub mod game_over;
pub mod mulligan;
pub mod mulligan_put_back;
pub mod pay_mana_cost;
pub mod reorder;
pub mod reveal;
pub mod scry;

pub use choose_action::{ChooseActionInput, ChooseActionOutput, PassUntil};
pub use choose_attackers::{ChooseAttackersInput, ChooseAttackersOutput};
pub use choose_blockers::{ChooseBlockersInput, ChooseBlockersOutput};
pub use choose_board_targets::{ChooseBoardTargetsInput, ChooseBoardTargetsOutput};
pub use choose_boolean::{ChooseBooleanInput, ChooseBooleanOutput};
pub use choose_cards::{ChooseCardsInput, ChooseCardsOutput};
pub use choose_color::{ChooseColorInput, ChooseColorOutput};
pub use choose_combat_damage_assignment::{
    ChooseCombatDamageAssignmentInput, ChooseCombatDamageAssignmentOutput,
};
pub use choose_damage_assignment_order::{
    ChooseDamageAssignmentOrderInput, ChooseDamageAssignmentOrderOutput,
};
pub use choose_from_selection::{
    ChooseFromSelectionInput, ChooseFromSelectionOutput, SelectionOption,
};
pub use choose_number::{ChooseNumberInput, ChooseNumberOutput};
pub use common::{
    ActivatableAbilityInfo, AlternativeCostKind, AvailableAction, AvailableActionKind,
    PaymentAction, PaymentActionKind, PaymentResourceKind, PlayCardMode,
};
pub use dice_rolled::{DiceRollEntry, DiceRolledInput, DiceRolledOutput};
pub use game_over::GameOverInput;
pub use mulligan::{MulliganInput, MulliganOutput};
pub use mulligan_put_back::{MulliganPutBackInput, MulliganPutBackOutput};
pub use pay_mana_cost::{PayManaCostInput, PayManaCostOutput};
pub use reorder::{ReorderInput, ReorderItem, ReorderOutput};
pub use reveal::{RevealCardsInput, RevealCardsOutput};
pub use scry::{ScryInput, ScryOutput};

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
    RevealCards(reveal::RevealCardsInput),
    Scry(scry::ScryInput),
    ChooseColor(choose_color::ChooseColorInput),
    ChooseNumber(choose_number::ChooseNumberInput),
    ChooseDamageAssignmentOrder(choose_damage_assignment_order::ChooseDamageAssignmentOrderInput),
    ChooseCombatDamageAssignment(
        choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput,
    ),
    PayManaCost(pay_mana_cost::PayManaCostInput),
    ChooseCards(choose_cards::ChooseCardsInput),
    Reorder(reorder::ReorderInput),
    DiceRolled(dice_rolled::DiceRolledInput),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "output", rename_all = "camelCase")]
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
    RevealCards(reveal::RevealCardsOutput),
    Scry(scry::ScryOutput),
    ChooseColor(choose_color::ChooseColorOutput),
    ChooseNumber(choose_number::ChooseNumberOutput),
    ChooseDamageAssignmentOrder(choose_damage_assignment_order::ChooseDamageAssignmentOrderOutput),
    ChooseCombatDamageAssignment(
        choose_combat_damage_assignment::ChooseCombatDamageAssignmentOutput,
    ),
    PayManaCost(pay_mana_cost::PayManaCostOutput),
    ChooseCards(choose_cards::ChooseCardsOutput),
    Reorder(reorder::ReorderOutput),
    DiceRolled(dice_rolled::DiceRolledOutput),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponseViolation {
    WrongPromptType,
    UnknownActionId(String),
    CancelNotAllowed,
}

impl PromptInput {
    /// The formal prompt/response contract: a response is valid only if its
    /// output family matches this prompt and every echoed action id was
    /// advertised by it. Engines reject anything else with a `ProtocolError`.
    pub fn validate_response(&self, output: &PromptOutput) -> Result<(), ResponseViolation> {
        use PromptInput as I;
        use PromptOutput as O;
        match (self, output) {
            (I::ChooseAction(input), O::ChooseAction(out)) => match out {
                ChooseActionOutput::Act { action_id }
                    if !input.actions.iter().any(|a| a.id == *action_id) =>
                {
                    Err(ResponseViolation::UnknownActionId(action_id.clone()))
                }
                _ => Ok(()),
            },
            (I::PayManaCost(input), O::PayManaCost(out)) => match out {
                PayManaCostOutput::Act { action_id }
                    if !input.actions.iter().any(|a| a.id == *action_id) =>
                {
                    Err(ResponseViolation::UnknownActionId(action_id.clone()))
                }
                _ => Ok(()),
            },
            (I::ChooseBoardTargets(input), O::ChooseBoardTargets(out)) => match out {
                ChooseBoardTargetsOutput::Cancel if !input.cancellable => {
                    Err(ResponseViolation::CancelNotAllowed)
                }
                _ => Ok(()),
            },
            (I::Mulligan(_), O::Mulligan(_))
            | (I::MulliganPutBack(_), O::MulliganPutBack(_))
            | (I::ChooseAttackers(_), O::ChooseAttackers(_))
            | (I::ChooseBlockers(_), O::ChooseBlockers(_))
            | (I::ChooseBoolean(_), O::ChooseBoolean(_))
            | (I::ChooseFromSelection(_), O::ChooseFromSelection(_))
            | (I::RevealCards(_), O::RevealCards(_))
            | (I::Scry(_), O::Scry(_))
            | (I::ChooseColor(_), O::ChooseColor(_))
            | (I::ChooseNumber(_), O::ChooseNumber(_))
            | (I::ChooseDamageAssignmentOrder(_), O::ChooseDamageAssignmentOrder(_))
            | (I::ChooseCombatDamageAssignment(_), O::ChooseCombatDamageAssignment(_))
            | (I::ChooseCards(_), O::ChooseCards(_))
            | (I::Reorder(_), O::Reorder(_))
            | (I::DiceRolled(_), O::DiceRolled(_)) => Ok(()),
            _ => Err(ResponseViolation::WrongPromptType),
        }
    }
}
