use serde::{Deserialize, Serialize};

use manabrew_engine::player::actions::PlayerAction as EnginePlayerAction;
use manabrew_protocol::prompts::choose_roll_swap_value::RollSwapValue;

pub use manabrew_protocol::prompts::choose_action::{AvailableAction, AvailableActionKind};
pub use manabrew_protocol::prompts::common::*;
pub use manabrew_protocol::transport::{AgentPrompt, StateUpdate};
pub use manabrew_protocol::{display::DisplayEvent, prompts::PromptInput};

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum AgentMessage {
    State(StateUpdate),
    Display(DisplayEvent),
    Prompt(AgentPrompt),
}

/// Sent from frontend to game thread: the human player's response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlayerAction {
    Act {
        #[serde(rename = "actionId")]
        action_id: String,
    },
    /// Canonical engine-defined response payload for engine-owned actions.
    EngineAction {
        action: EnginePlayerAction,
    },
    MulliganDecision {
        keep: bool,
    },
    /// Response to MulliganPutBack: IDs of the cards to put on the bottom.
    MulliganPutBackDecision {
        #[serde(rename = "cardIds")]
        card_ids: Vec<String>,
    },
    /// Unified pass action. Replaces the old "PlayCard with null cardId" convention.
    /// `until_phase` is the phase id the player wants to auto-pass until (e.g. "main1").
    /// None means atomic pass without passing any further
    Pass {
        #[serde(rename = "untilPhase")]
        until_phase: Option<String>,
    },
    PlayCard {
        #[serde(rename = "cardId")]
        card_id: String,
        /// Optional play mode, e.g. "normal", "alternative:spectacle"
        #[serde(default)]
        mode: Option<String>,
    },
    DeclareAttackers {
        /// Attack assignments: each attacker paired with its defender.
        assignments: Vec<AttackAssignment>,
    },
    DeclareBlockers {
        assignments: Vec<BlockAssignment>,
    },
    TargetPlayer {
        #[serde(rename = "playerId")]
        player_id: Option<String>,
    },
    TargetCard {
        #[serde(rename = "cardId")]
        card_id: Option<String>,
    },
    TargetAny {
        target: TargetAnyChoice,
    },
    TapLand {
        #[serde(rename = "cardId")]
        card_id: String,
        #[serde(rename = "abilityIndex")]
        ability_index: Option<usize>,
        /// Optional color choice for 'any color' mana abilities.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    UntapLand {
        #[serde(rename = "cardId")]
        card_id: String,
    },
    ActivateAbility {
        #[serde(rename = "cardId")]
        card_id: String,
        #[serde(rename = "abilityIndex")]
        ability_index: usize,
    },
    /// Response to Scry prompt: IDs of cards the player wants on the bottom.
    ScryDecision {
        #[serde(rename = "bottomCardIds")]
        bottom_card_ids: Vec<String>,
    },
    /// Response to Surveil prompt: IDs of cards the player wants in the graveyard.
    SurveilDecision {
        #[serde(rename = "graveyardCardIds")]
        graveyard_card_ids: Vec<String>,
    },
    /// Response to Dig prompt: IDs of the cards the player wants to take.
    DigDecision {
        #[serde(rename = "chosenCardIds")]
        chosen_card_ids: Vec<String>,
    },
    /// Response to ChooseDiscard prompt: IDs of the cards the player discards.
    DiscardDecision {
        #[serde(rename = "discardedCardIds")]
        discarded_card_ids: Vec<String>,
    },
    /// Response to ChooseTargetSpell prompt: the stack entry ID the player targets.
    TargetSpell {
        #[serde(rename = "spellId")]
        spell_id: Option<String>,
    },
    /// Response to ChooseOptionalTrigger: whether the player accepts.
    OptionalTriggerDecision {
        accept: bool,
    },
    RevealCardsAcknowledged,
    PayCostToPreventEffectDecision {
        accept: bool,
    },
    /// Response to ChooseMode prompt: indices (0-based) of chosen modes.
    ModeDecision {
        #[serde(rename = "chosenIndices")]
        chosen_indices: Vec<usize>,
    },
    /// Response to ChoosePhyrexian prompt: whether to pay 2 life.
    PhyrexianDecision {
        #[serde(rename = "payLife")]
        pay_life: bool,
    },
    /// Response to ChooseKicker prompt: whether the player pays the kicker.
    KickerDecision {
        kicked: bool,
    },
    /// Response to ChooseBuyback prompt.
    BuybackDecision {
        #[serde(rename = "buybackPaid")]
        buyback_paid: bool,
    },
    /// Response to ChooseMultikicker prompt: how many times.
    MultikickerDecision {
        #[serde(rename = "kickCount")]
        kick_count: u32,
    },
    /// Response to ChooseReplicate prompt: how many times.
    ReplicateDecision {
        #[serde(rename = "replicateCount")]
        replicate_count: u32,
    },
    /// Response to ChooseAlternativeCost prompt: index of chosen option.
    AlternativeCostDecision {
        #[serde(rename = "chosenIndex")]
        chosen_index: usize,
    },
    /// Response to ChooseColor prompt: the chosen color name.
    ColorDecision {
        color: Option<String>,
    },
    /// Response to ChooseType prompt: the chosen type name.
    TypeDecision {
        #[serde(rename = "chosenType")]
        chosen_type: Option<String>,
    },
    /// Response to ChooseNumber prompt: the chosen number.
    NumberDecision {
        #[serde(rename = "chosenNumber")]
        chosen_number: Option<i32>,
    },
    /// Response to ChooseCardName prompt: the chosen card name.
    CardNameDecision {
        #[serde(rename = "chosenName")]
        chosen_name: Option<String>,
    },
    /// Response to ChooseDamageAssignmentOrder: ordered blocker IDs.
    DamageAssignmentOrderDecision {
        #[serde(rename = "orderedBlockerIds")]
        ordered_blocker_ids: Vec<String>,
    },
    /// Response to ChooseCombatDamageAssignment: exact assignee→damage map.
    CombatDamageAssignmentDecision {
        assignments: Vec<CombatDamageAssignmentEntry>,
    },
    /// Response to ChooseExertAttackers: IDs of attackers to exert.
    ExertDecision {
        #[serde(rename = "chosenAttackerIds")]
        chosen_attacker_ids: Vec<String>,
    },
    /// Response to ChooseEnlistAttackers: IDs of attackers to enlist.
    EnlistDecision {
        #[serde(rename = "chosenAttackerIds")]
        chosen_attacker_ids: Vec<String>,
    },
    /// Response to ReorderLibrary: ordered card IDs (last = top of library).
    ReorderLibraryDecision {
        #[serde(rename = "orderedCardIds")]
        ordered_card_ids: Vec<String>,
    },
    /// Response to ExploreDecision: whether to put in graveyard.
    ExploreResponse {
        #[serde(rename = "putInGraveyard")]
        put_in_graveyard: bool,
    },
    /// Response to HelpPayAssist: amount of generic mana to pay.
    AssistDecision {
        #[serde(rename = "amountToPay")]
        amount_to_pay: u32,
    },
    /// Response to ChooseCardsForEffect prompt: IDs of chosen cards.
    ChooseCardsDecision {
        #[serde(rename = "chosenCardIds")]
        chosen_card_ids: Vec<String>,
    },
    /// Pay the attack cost from the mana pool.
    PayCombatCost,
    /// Decline to pay the attack cost (remove attacker).
    DeclineCombatCost,
    /// Host-only control action: restore engine state to a checkpoint.
    RestoreSnapshot {
        #[serde(rename = "checkpointId")]
        checkpoint_id: u64,
    },
    /// Response to ChooseDelve: IDs of graveyard cards to exile.
    DelveDecision {
        #[serde(rename = "chosenCardIds")]
        chosen_card_ids: Vec<String>,
    },
    /// Response to ChooseConvoke: IDs of creatures to tap.
    ConvokeDecision {
        #[serde(rename = "chosenCardIds")]
        chosen_card_ids: Vec<String>,
    },
    /// Response to ChooseImprovise: IDs of artifacts to tap.
    ImproviseDecision {
        #[serde(rename = "chosenCardIds")]
        chosen_card_ids: Vec<String>,
    },
    /// Response to SpecifyManaCombo: list of color letters chosen.
    ManaComboDecision {
        /// Color letters, e.g. ["W", "W", "U"], totaling the requested amount.
        #[serde(rename = "chosenColors")]
        chosen_colors: Vec<String>,
    },
    /// Confirm mana cost payment from the mana pool.
    /// `auto=true` asks the engine to finish the payment session via engine auto-pay.
    PayManaCost {
        #[serde(default)]
        auto: bool,
    },
    /// Pay a phyrexian (or PayLifeInsteadOf:B black) shard with life during mana cost payment.
    PayLife,
    /// Cancel casting the spell (mana cost payment).
    CancelManaCost,
    /// Acknowledge a `DiceRolled` display-only prompt (UI animation done).
    DiceRolledAcknowledged,
    /// Acknowledge a `FirstPlayerRoll` display-only prompt.
    FirstPlayerRollAcknowledged,
    /// Response to ChooseRollToIgnore.
    RollToIgnoreDecision {
        roll: Option<i32>,
    },
    /// Response to ChooseRollToSwap.
    RollToSwapDecision {
        roll: Option<i32>,
    },
    /// Response to ChooseRollToModify.
    RollToModifyDecision {
        roll: Option<i32>,
    },
    /// Response to ChooseDiceToReroll.
    DiceToRerollDecision {
        rolls: Vec<i32>,
    },
    RollSwapValueDecision {
        choice: Option<RollSwapValue>,
    },
    Concede,
}
