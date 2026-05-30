use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct JavaRawPrompt {
    #[serde(rename = "sessionId", default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub player: usize,
    #[serde(default)]
    pub snapshot: JavaRawSnapshot,
    #[serde(flatten)]
    pub body: JavaRawPromptBody,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JavaRawPromptBody {
    Priority {
        #[serde(default)]
        actions: Vec<JavaRawAction>,
    },
    ChooseDiscard {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(default)]
        min: usize,
        #[serde(default)]
        max: usize,
    },
    Mulligan {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(default)]
        count: u32,
    },
    MulliganPutBack {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(default)]
        count: usize,
        #[serde(default)]
        max: usize,
    },
    RevealCards {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        zone: Option<String>,
        #[serde(rename = "ownerPlayerId")]
        owner_player_id: Option<String>,
        message: Option<String>,
    },
    ChooseAttackers {
        #[serde(default)]
        attackers: Vec<JavaRawCardOption>,
        #[serde(default)]
        defenders: Vec<JavaRawCardOption>,
    },
    ChooseBlockers {
        #[serde(default)]
        attackers: Vec<JavaRawCardOption>,
        #[serde(default)]
        blockers: Vec<JavaRawCardOption>,
    },
    ChooseDamageAssignmentOrder {
        #[serde(rename = "attackerId")]
        attacker_id: Option<String>,
        #[serde(default)]
        blockers: Vec<JavaRawCardOption>,
    },
    ChooseCombatDamageAssignment {
        #[serde(rename = "attackerId")]
        attacker_id: Option<String>,
        #[serde(rename = "defenderId")]
        defender_id: Option<String>,
        #[serde(rename = "totalDamage", default)]
        total_damage: i64,
        #[serde(rename = "attackerHasDeathtouch", default)]
        attacker_has_deathtouch: bool,
        #[serde(default)]
        blockers: Vec<JavaRawCardOption>,
    },
    ChooseCardsForEffect {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(default = "one")]
        min: usize,
        #[serde(default = "one")]
        max: usize,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
        description: Option<String>,
    },
    ChooseMode {
        #[serde(default)]
        options: Vec<String>,
        #[serde(default = "one")]
        min: usize,
        #[serde(default = "one")]
        max: usize,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    #[serde(rename = "choose_optional_trigger", alias = "confirm_action")]
    ConfirmOrTrigger {
        description: Option<String>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
        #[serde(rename = "promptKind")]
        prompt_kind: Option<String>,
        #[serde(rename = "optionLabels", default)]
        option_labels: Vec<String>,
        mode: Option<String>,
        api: Option<String>,
    },
    PayCostToPreventEffect {
        description: Option<String>,
        mode: Option<String>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
        api: Option<String>,
    },
    ChooseNumber {
        #[serde(default)]
        min: i64,
        #[serde(default)]
        max: i64,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
        description: Option<String>,
    },
    ChooseColor {
        #[serde(default)]
        options: Vec<String>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ChooseType {
        #[serde(default)]
        options: Vec<String>,
        description: Option<String>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ChooseCardName {
        #[serde(default)]
        options: Vec<String>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ChooseScry {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
    },
    ChooseSurveil {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
    },
    ChooseDig {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(default = "one")]
        max: usize,
        #[serde(default)]
        optional: bool,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ChooseDelve {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(default)]
        max: usize,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ChooseConvoke {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        description: Option<String>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ChooseImprovise {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        description: Option<String>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ReorderLibrary {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    ChooseTargetPlayer {
        #[serde(default)]
        players: Vec<JavaRawCardOption>,
        #[serde(rename = "sourceCardId")]
        source_card_id: Option<String>,
    },
    ChooseTargetCard {
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(rename = "sourceCardId")]
        source_card_id: Option<String>,
    },
    ChooseTargetAny {
        #[serde(default)]
        players: Vec<JavaRawCardOption>,
        #[serde(default)]
        cards: Vec<JavaRawCardOption>,
        #[serde(rename = "sourceCardId")]
        source_card_id: Option<String>,
    },
    ChooseTargetSpell {
        #[serde(default)]
        spells: Vec<JavaRawCardOption>,
        #[serde(rename = "sourceCardId")]
        source_card_id: Option<String>,
    },
}

fn one() -> usize {
    1
}

impl JavaRawPromptBody {
    pub fn kind_label(&self) -> &'static str {
        match self {
            JavaRawPromptBody::Priority { .. } => "priority",
            JavaRawPromptBody::ChooseDiscard { .. } => "choose_discard",
            JavaRawPromptBody::Mulligan { .. } => "mulligan",
            JavaRawPromptBody::MulliganPutBack { .. } => "mulligan_put_back",
            JavaRawPromptBody::RevealCards { .. } => "reveal_cards",
            JavaRawPromptBody::ChooseAttackers { .. } => "choose_attackers",
            JavaRawPromptBody::ChooseBlockers { .. } => "choose_blockers",
            JavaRawPromptBody::ChooseDamageAssignmentOrder { .. } => {
                "choose_damage_assignment_order"
            }
            JavaRawPromptBody::ChooseCombatDamageAssignment { .. } => {
                "choose_combat_damage_assignment"
            }
            JavaRawPromptBody::ChooseCardsForEffect { .. } => "choose_cards_for_effect",
            JavaRawPromptBody::ChooseMode { .. } => "choose_mode",
            JavaRawPromptBody::ConfirmOrTrigger { .. } => "choose_optional_trigger",
            JavaRawPromptBody::PayCostToPreventEffect { .. } => "pay_cost_to_prevent_effect",
            JavaRawPromptBody::ChooseNumber { .. } => "choose_number",
            JavaRawPromptBody::ChooseColor { .. } => "choose_color",
            JavaRawPromptBody::ChooseType { .. } => "choose_type",
            JavaRawPromptBody::ChooseCardName { .. } => "choose_card_name",
            JavaRawPromptBody::ChooseScry { .. } => "choose_scry",
            JavaRawPromptBody::ChooseSurveil { .. } => "choose_surveil",
            JavaRawPromptBody::ChooseDig { .. } => "choose_dig",
            JavaRawPromptBody::ChooseDelve { .. } => "choose_delve",
            JavaRawPromptBody::ChooseConvoke { .. } => "choose_convoke",
            JavaRawPromptBody::ChooseImprovise { .. } => "choose_improvise",
            JavaRawPromptBody::ReorderLibrary { .. } => "reorder_library",
            JavaRawPromptBody::ChooseTargetPlayer { .. } => "choose_target_player",
            JavaRawPromptBody::ChooseTargetCard { .. } => "choose_target_card",
            JavaRawPromptBody::ChooseTargetAny { .. } => "choose_target_any",
            JavaRawPromptBody::ChooseTargetSpell { .. } => "choose_target_spell",
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct JavaRawAction {
    pub index: Option<usize>,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct JavaRawCardOption {
    pub id: Option<String>,
    pub label: Option<String>,
    #[serde(rename = "setCode")]
    pub set_code: Option<String>,
    #[serde(rename = "cardNumber")]
    pub card_number: Option<String>,
    pub owner: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct JavaRawSnapshot {
    pub turn: Option<u32>,
    pub phase: Option<String>,
    pub active_player: Option<usize>,
    pub priority_player: Option<usize>,
    #[serde(default)]
    pub game_over: bool,
    pub winner: Option<usize>,
    #[serde(default)]
    pub players: Vec<JavaRawSnapshotPlayer>,
    #[serde(default)]
    pub stack: Vec<JavaRawStackEntry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct JavaRawSnapshotPlayer {
    pub index: Option<usize>,
    pub name: Option<String>,
    pub life: Option<i32>,
    pub poison: Option<i32>,
    pub library_size: Option<i64>,
    #[serde(default)]
    pub hand: Vec<JavaRawCard>,
    #[serde(default)]
    pub graveyard: Vec<JavaRawCard>,
    #[serde(default)]
    pub exile: Vec<JavaRawCard>,
    #[serde(default)]
    pub battlefield: Vec<JavaRawCard>,
    #[serde(default)]
    pub battlefield_cards: Vec<JavaRawCard>,
    #[serde(default)]
    pub hand_cards: Vec<JavaRawCard>,
    #[serde(default)]
    pub command_zone_cards: Vec<JavaRawCard>,
}

impl JavaRawSnapshotPlayer {
    pub fn battlefield(&self) -> &[JavaRawCard] {
        if self.battlefield_cards.is_empty() {
            &self.battlefield
        } else {
            &self.battlefield_cards
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum JavaRawCard {
    Name(String),
    Full(JavaRawCardData),
}

impl JavaRawCard {
    pub fn data(&self) -> JavaRawCardData {
        match self {
            JavaRawCard::Name(name) => JavaRawCardData {
                name: Some(name.clone()),
                ..JavaRawCardData::default()
            },
            JavaRawCard::Full(data) => data.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct JavaRawCardData {
    pub id: Option<String>,
    pub name: Option<String>,
    pub label: Option<String>,
    #[serde(rename = "setCode")]
    pub set_code: Option<String>,
    #[serde(rename = "cardNumber")]
    pub card_number: Option<String>,
    pub power: Option<i64>,
    pub toughness: Option<i64>,
    pub controller: Option<usize>,
    pub owner: Option<u64>,
    #[serde(default)]
    pub tapped: bool,
    #[serde(default)]
    pub counters: BTreeMap<String, i32>,
    #[serde(default)]
    pub damage: i32,
    #[serde(default)]
    pub summoning_sick: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum JavaRawStackEntry {
    Name(String),
    Full {
        id: Option<String>,
        name: Option<String>,
        description: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JavaAction {
    Pass,
    ChooseAction {
        index: usize,
    },
    MulliganDecision {
        keep: bool,
    },
    ChooseCards {
        card_ids: Vec<String>,
    },
    ModeDecision {
        indices: Vec<usize>,
    },
    BooleanDecision {
        accept: bool,
    },
    NumberDecision {
        number: i32,
    },
    StringDecision {
        value: String,
    },
    ScryDecision {
        bottom_card_ids: Vec<String>,
    },
    SurveilDecision {
        graveyard_card_ids: Vec<String>,
    },
    DigDecision {
        chosen_card_ids: Vec<String>,
    },
    ReorderLibraryDecision {
        ordered_card_ids: Vec<String>,
    },
    DamageAssignmentOrderDecision {
        ordered_card_ids: Vec<String>,
    },
    CombatDamageAssignmentDecision {
        assignments: Vec<JavaCombatAssignment>,
    },
    TargetChoice {
        target: JavaTarget,
    },
    DeclareAttackers {
        assignments: Vec<JavaAttackAssignment>,
    },
    DeclareBlockers {
        assignments: Vec<JavaBlockAssignment>,
    },
    RevealCardsAcknowledged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaCombatAssignment {
    pub assignee_id: String,
    pub damage: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaAttackAssignment {
    pub attacker_id: String,
    pub defender_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaBlockAssignment {
    pub blocker_id: String,
    pub attacker_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct JavaTarget {
    pub kind: JavaTargetKind,
    pub id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JavaTargetKind {
    Player,
    Card,
    Spell,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JavaActionError {
    pub action_type: &'static str,
}

impl std::fmt::Display for JavaActionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "PlayerAction `{}` has no java-forge translation",
            self.action_type
        )
    }
}

impl std::error::Error for JavaActionError {}
