use serde::{Deserialize, Serialize};

use crate::game_view_dto::{CardDto, GameViewDto, TargetingIntent};
use forge_engine_core::player::actions::PlayerAction as EnginePlayerAction;

fn default_intent() -> TargetingIntent {
    TargetingIntent::Hostile
}

fn default_top_of_deck() -> bool {
    true
}

/// A display-only event that the frontend should animate before rendering the prompt's game state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DisplayEvent {
    #[serde(rename_all = "camelCase")]
    CardPlayed {
        card_id: String,
        card_name: String,
        set_code: String,
        player_id: String,
    },
    #[serde(rename_all = "camelCase")]
    TurnChanged {
        active_player_id: String,
        active_player_name: String,
        turn_number: u32,
    },
}

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum AgentMessage {
    State(StateUpdate),
    Display(DisplayEvent),
    Prompt(AgentPrompt),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateUpdate {
    #[serde(rename = "gameView")]
    pub game_view: GameViewDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPrompt {
    /// Player this prompt is waiting on.
    #[serde(
        rename = "decidingPlayerId",
        default,
        skip_serializing_if = "String::is_empty"
    )]
    pub deciding_player_id: String,
    /// Engine card id of the prompt's source card (the spell being cast, the
    /// permanent whose ability triggered, etc.). The UI resolves the matching
    /// `DeckCard` from this for image rendering. `None` when the prompt has
    /// no source card (synthetic choosers, mulligans, etc.). Set by
    /// `PromptAgent::set_source` and attached automatically to every outgoing
    /// prompt — variant payloads no longer carry their own source field.
    #[serde(
        rename = "sourceCardId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub source_card_id: Option<String>,
    /// The actual prompt data (type + prompt-specific fields).
    pub input: AgentPromptInner,
}

/// The actual decision prompt variants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum AgentPromptInner {
    Mulligan {
        #[serde(rename = "handCardIds")]
        hand_card_ids: Vec<String>,
        #[serde(rename = "mulliganCount")]
        mulligan_count: u32,
    },
    /// London Mulligan: choose which cards to put on the bottom of the library.
    MulliganPutBack {
        #[serde(rename = "handCardIds")]
        hand_card_ids: Vec<String>,
        /// Card DTOs for display.
        cards: Vec<CardDto>,
        /// Number of cards that must be put back.
        count: usize,
    },
    ChooseAction {
        #[serde(rename = "playableCardIds")]
        playable_card_ids: Vec<String>,
        /// All play options with their modes (normal, spectacle, evoke, etc.).
        #[serde(rename = "playableOptions")]
        playable_options: Vec<PlayOptionDto>,
        /// Untapped lands (and creatures/artifacts with mana abilities) that the player can tap.
        #[serde(rename = "tappableLandIds")]
        tappable_land_ids: Vec<String>,
        /// Source IDs whose most recent mana action can currently be undone.
        #[serde(rename = "untappableLandIds")]
        untappable_land_ids: Vec<String>,
        /// Activated abilities on battlefield permanents.
        #[serde(rename = "activatableAbilityIds")]
        activatable_ability_ids: Vec<ActivatableAbilityInfo>,
        /// Mana abilities on tappable permanents (for per-color tap buttons on dual lands).
        #[serde(rename = "manaAbilityOptions", default)]
        mana_ability_options: Vec<ActivatableAbilityInfo>,
        /// Canonical engine-defined actions for this priority window.
        /// Backward-compatible addition: existing UI can ignore this and keep
        /// using the legacy response variants until migrated.
        #[serde(rename = "availablePlayerActions", default)]
        available_player_actions: Vec<EnginePlayerAction>,
    },
    ChooseAttackers {
        #[serde(rename = "availableAttackerIds")]
        available_attacker_ids: Vec<String>,
        /// Possible defenders: opponent players and their planeswalkers.
        #[serde(rename = "possibleDefenderIds")]
        possible_defender_ids: Vec<DefenderIdDto>,
    },
    ChooseBlockers {
        #[serde(rename = "attackerIds")]
        attacker_ids: Vec<String>,
        #[serde(rename = "availableBlockerIds")]
        available_blocker_ids: Vec<String>,
    },
    ChooseTargetPlayer {
        #[serde(rename = "validPlayerIds")]
        valid_player_ids: Vec<String>,
        /// Whether the targeting effect is hostile (damage/destroy) vs friendly (buff).
        /// Kept for backwards compatibility; prefer `intent`.
        #[serde(default)]
        hostile: bool,
        /// Semantic classification used by the UI to pick a pointer icon / glow color.
        #[serde(default = "default_intent")]
        intent: TargetingIntent,
    },
    ChooseTargetCard {
        #[serde(rename = "validCardIds")]
        valid_card_ids: Vec<String>,
        #[serde(default)]
        hostile: bool,
        #[serde(default = "default_intent")]
        intent: TargetingIntent,
        #[serde(rename = "minTargets", default)]
        min_targets: i32,
        #[serde(rename = "maxTargets", default)]
        max_targets: i32,
        #[serde(rename = "chosenTargets", default)]
        chosen_targets: i32,
    },
    ChooseTargetAny {
        #[serde(rename = "validPlayerIds")]
        valid_player_ids: Vec<String>,
        #[serde(rename = "validCardIds")]
        valid_card_ids: Vec<String>,
        #[serde(default)]
        hostile: bool,
        #[serde(default = "default_intent")]
        intent: TargetingIntent,
    },
    ChooseTargetCardFromZone {
        #[serde(rename = "validCardIds")]
        valid_card_ids: Vec<String>,
        zone: String,
        #[serde(rename = "zoneCards")]
        zone_cards: Vec<CardDto>,
        #[serde(default = "default_intent")]
        intent: TargetingIntent,
        #[serde(rename = "minTargets", default)]
        min_targets: i32,
        #[serde(rename = "maxTargets", default)]
        max_targets: i32,
        #[serde(rename = "chosenTargets", default)]
        chosen_targets: i32,
    },
    GameOver {},
    RevealCards {
        cards: Vec<CardDto>,
        zone: String,
        #[serde(rename = "ownerPlayerId")]
        owner_player_id: String,
        message: String,
    },
    /// Scry N: player sees `card_ids` (top N of library) and picks which go to bottom.
    Scry {
        /// The top N cards the player is looking at (in library order, last = topmost).
        #[serde(rename = "cardIds")]
        card_ids: Vec<String>,
        /// Card DTOs for display.
        #[serde(rename = "cards")]
        cards: Vec<CardDto>,
    },
    /// Surveil N: player sees `card_ids` (top N of library) and picks which go to graveyard.
    Surveil {
        #[serde(rename = "cardIds")]
        card_ids: Vec<String>,
        #[serde(rename = "cards")]
        cards: Vec<CardDto>,
    },
    /// Dig N, take K: player sees `card_ids` (top N) and picks up to `num_to_take` to keep.
    Dig {
        #[serde(rename = "cardIds")]
        card_ids: Vec<String>,
        #[serde(rename = "cards")]
        cards: Vec<CardDto>,
        #[serde(rename = "numToTake")]
        num_to_take: usize,
        optional: bool,
    },
    /// Discard N cards from hand.
    ChooseDiscard {
        /// All card IDs currently in hand.
        #[serde(rename = "handCardIds")]
        hand_card_ids: Vec<String>,
        /// How many cards must be discarded.
        #[serde(rename = "numToDiscard")]
        num_to_discard: usize,
    },
    /// Choose a target spell on the stack (for Counter).
    ChooseTargetSpell {
        /// Stack entry IDs (as strings) that can be countered.
        #[serde(rename = "validSpellIds")]
        valid_spell_ids: Vec<String>,
        #[serde(default = "default_intent")]
        intent: TargetingIntent,
    },
    /// Choose whether an optional triggered ability fires.
    ChooseOptionalTrigger {
        /// Description of the trigger.
        description: String,
        /// Optional card DTOs to show alongside the prompt (e.g. looked-at cards).
        #[serde(default)]
        cards: Vec<CardDto>,
        /// Optional context tag: e.g. "optional_trigger" or "confirm_action".
        #[serde(rename = "promptKind")]
        prompt_kind: Option<String>,
        /// Optional labels for decline/accept buttons.
        #[serde(rename = "optionLabels")]
        option_labels: Option<Vec<String>>,
        /// Optional confirm mode metadata from engine.
        mode: Option<String>,
        /// Optional API metadata from engine.
        api: Option<String>,
    },
    PayCostToPreventEffect {
        description: String,
        #[serde(rename = "costKind")]
        cost_kind: String,
        api: Option<String>,
    },
    /// Choose N modes for a modal spell (SP$ Charm).
    ChooseMode {
        /// Human-readable descriptions for each available mode.
        options: Vec<String>,
        /// Minimum number of modes that must be chosen.
        #[serde(rename = "minChoices")]
        min_choices: usize,
        /// Maximum number of modes that can be chosen.
        #[serde(rename = "maxChoices")]
        max_choices: usize,
        /// Synthetic header text for prompts without a source card
        /// ("Replacement Effect", "Choose colors", …). The card-anchored
        /// case uses the envelope `source_card_id`; this field is only set
        /// when no card source exists.
        #[serde(rename = "sourceCardName", skip_serializing_if = "Option::is_none")]
        source_card_name: Option<String>,
    },
    /// Choose whether to pay 2 life instead of mana for a Phyrexian mana shard.
    ChoosePhyrexian {
        /// The phyrexian shard string (e.g. "W/P", "U/P").
        #[serde(rename = "phyrexianColor")]
        phyrexian_color: String,
    },
    /// Choose whether to pay a kicker cost.
    ChooseKicker {
        /// The kicker cost string (e.g. "W", "2 R").
        #[serde(rename = "kickerCost")]
        kicker_cost: String,
    },
    /// Choose whether to pay buyback cost.
    ChooseBuyback {
        #[serde(rename = "buybackCost")]
        buyback_cost: String,
    },
    /// Choose how many times to pay multikicker cost.
    ChooseMultikicker {
        cost: String,
        #[serde(rename = "maxKicks")]
        max_kicks: u32,
    },
    /// Choose how many times to pay replicate cost.
    ChooseReplicate {
        cost: String,
        #[serde(rename = "maxReplicates")]
        max_replicates: u32,
    },
    /// Choose between normal cost and an alternative cost.
    ChooseAlternativeCost {
        options: Vec<String>,
    },
    /// Choose a color (for ChooseColorEffect).
    ChooseColor {
        #[serde(rename = "validColors")]
        valid_colors: Vec<String>,
    },
    /// Choose a creature/card type (for ChooseType effect).
    ChooseType {
        /// Category: "Creature", "Card", "Land", etc.
        #[serde(rename = "typeCategory")]
        type_category: String,
        /// Valid type choices.
        #[serde(rename = "validTypes")]
        valid_types: Vec<String>,
    },
    /// Choose a number (for ChooseNumber effect).
    ChooseNumber {
        min: i32,
        max: i32,
    },
    /// Choose a card name (for NameCard effect).
    ChooseCardName {
        /// Valid card name choices (for ChooseFromList mode).
        #[serde(rename = "validNames")]
        valid_names: Vec<String>,
    },
    /// Choose damage assignment order for a multi-blocked attacker.
    ChooseDamageAssignmentOrder {
        /// The attacker card ID.
        #[serde(rename = "attackerId")]
        attacker_id: String,
        /// The blocker card IDs (to be ordered by the player).
        #[serde(rename = "blockerIds")]
        blocker_ids: Vec<String>,
        /// CardDto info for blockers (so frontend can display them).
        #[serde(rename = "blockerCards")]
        blocker_cards: Vec<CardDto>,
    },
    /// Choose exact combat damage assignment amounts.
    ChooseCombatDamageAssignment {
        #[serde(rename = "attackerId")]
        attacker_id: String,
        #[serde(rename = "blockerIds")]
        blocker_ids: Vec<String>,
        /// Defender ID ("player-{i}" or "card-{i}") if defender is a legal assignee.
        #[serde(rename = "defenderId")]
        defender_id: Option<String>,
        #[serde(rename = "totalDamage")]
        total_damage: i32,
        #[serde(rename = "attackerHasDeathtouch")]
        attacker_has_deathtouch: bool,
    },
    /// Pay an attack cost (Propaganda, Ghostly Prison).
    PayCombatCost {
        #[serde(rename = "attackerId")]
        attacker_id: String,
        #[serde(rename = "attackerName")]
        attacker_name: String,
        cost: i32,
        description: String,
        #[serde(rename = "tappableLandIds")]
        tappable_land_ids: Vec<String>,
        #[serde(rename = "untappableLandIds")]
        untappable_land_ids: Vec<String>,
        #[serde(rename = "manaPoolTotal")]
        mana_pool_total: i32,
    },
    /// Choose graveyard cards to exile for Delve.
    ChooseDelve {
        #[serde(rename = "validCardIds")]
        valid_card_ids: Vec<String>,
        #[serde(rename = "zoneCards")]
        zone_cards: Vec<CardDto>,
        #[serde(rename = "maxCards")]
        max_cards: usize,
    },
    /// Choose creatures to tap for Convoke.
    ChooseConvoke {
        #[serde(rename = "validCardIds")]
        valid_card_ids: Vec<String>,
        #[serde(rename = "remainingCost")]
        remaining_cost: String,
    },
    /// Choose artifacts to tap for Improvise.
    ChooseImprovise {
        #[serde(rename = "validCardIds")]
        valid_card_ids: Vec<String>,
        #[serde(rename = "remainingCost")]
        remaining_cost: String,
    },
    /// Pay a mana cost interactively (for spells/abilities).
    PayManaCost {
        #[serde(rename = "cardId")]
        card_id: String,
        #[serde(rename = "cardName")]
        card_name: String,
        #[serde(rename = "manaCost")]
        mana_cost: String,
        #[serde(rename = "manaAbilityOptions")]
        mana_ability_options: Vec<ActivatableAbilityInfo>,
        #[serde(rename = "tappableLandIds")]
        tappable_land_ids: Vec<String>,
        #[serde(rename = "untappableLandIds")]
        untappable_land_ids: Vec<String>,
        #[serde(rename = "manaPoolTotal")]
        mana_pool_total: i32,
        #[serde(rename = "canConfirmFromPool")]
        can_confirm_from_pool: bool,
    },
    /// Specify mana color distribution for combo/any mana production.
    SpecifyManaCombo {
        /// Available color letters (e.g. ["W", "U", "B", "R", "G"]).
        #[serde(rename = "availableColors")]
        available_colors: Vec<String>,
        /// Total amount of mana to distribute.
        amount: usize,
    },
    /// Choose which attackers to exert.
    ChooseExertAttackers {
        #[serde(rename = "attackerIds")]
        attacker_ids: Vec<String>,
        #[serde(rename = "attackerCards")]
        attacker_cards: Vec<CardDto>,
    },
    /// Choose which attackers to enlist.
    ChooseEnlistAttackers {
        #[serde(rename = "attackerIds")]
        attacker_ids: Vec<String>,
        #[serde(rename = "attackerCards")]
        attacker_cards: Vec<CardDto>,
    },
    ReorderLibrary {
        /// Card IDs to reorder (in current top-first order).
        #[serde(rename = "cardIds")]
        card_ids: Vec<String>,
        /// Card DTOs for display.
        cards: Vec<CardDto>,
        /// Destination zone; absent means the library.
        #[serde(default)]
        destination: Option<String>,
        /// For deck destinations: whether the cards go to the top (false = bottom).
        #[serde(rename = "topOfDeck", default = "default_top_of_deck")]
        top_of_deck: bool,
    },
    /// Explore: choose whether to put the revealed nonland card in graveyard or on top.
    ExploreDecision {
        /// Name of the revealed card.
        #[serde(rename = "revealedCardName")]
        revealed_card_name: String,
        /// Card DTO for the revealed card (for display).
        #[serde(rename = "revealedCard")]
        revealed_card: Option<CardDto>,
    },
    /// Help pay for a spell with Assist.
    HelpPayAssist {
        #[serde(rename = "cardName")]
        card_name: String,
        #[serde(rename = "maxGeneric")]
        max_generic: u32,
    },
    /// Display-only: every player rolled a d20 to decide who goes first.
    /// Sent once with the full roll-off result + winner. The frontend
    /// animates every die in parallel and auto-acknowledges.
    FirstPlayerRoll {
        sides: i32,
        /// Per-player roll, in `player_order`.
        #[serde(rename = "firstPlayerRolls")]
        rolls: Vec<FirstPlayerRollEntry>,
        /// Player slot id of the winner (one of `firstPlayerRolls[i].playerId`).
        #[serde(rename = "winnerPlayerId")]
        winner_player_id: String,
    },
    /// Display-only: dice were just rolled. Sent for UI animation/feedback;
    /// no player decision required (acknowledged automatically by the game thread
    /// like `StateUpdate`).
    DiceRolled {
        #[serde(rename = "playerId")]
        player_id: String,
        sides: i32,
        /// Natural (pre-modifier) values, one per kept die.
        #[serde(rename = "naturalResults")]
        natural_results: Vec<i32>,
        /// Final values after modifiers/exchanges.
        #[serde(rename = "finalResults")]
        final_results: Vec<i32>,
        /// Rolls dropped before modification (ignore-lowest, choose-to-ignore).
        #[serde(rename = "ignoredRolls")]
        ignored_rolls: Vec<i32>,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
    },
    /// Choose one rolled value to drop (ignore).
    ChooseRollToIgnore {
        rolls: Vec<i32>,
    },
    /// Choose one rolled value to exchange with a creature's P/T.
    ChooseRollToSwap {
        rolls: Vec<i32>,
    },
    /// Choose one rolled value to increment/decrement by 1.
    ChooseRollToModify {
        rolls: Vec<i32>,
    },
    /// Choose any subset of dice to reroll.
    ChooseDiceToReroll {
        rolls: Vec<i32>,
    },
    /// Choose whether a roll/PT exchange swaps power or toughness.
    ChooseRollSwapValue {
        #[serde(rename = "currentResult")]
        current_result: i32,
        power: i32,
        toughness: i32,
    },
    /// Choose card(s) for an effect (ChooseCardEffect, CloneEffect).
    ChooseCardsForEffect {
        #[serde(rename = "validCardIds")]
        valid_card_ids: Vec<String>,
        #[serde(rename = "zoneCards")]
        zone_cards: Vec<CardDto>,
        #[serde(rename = "minChoices")]
        min_choices: usize,
        #[serde(rename = "maxChoices")]
        max_choices: usize,
        #[serde(rename = "sourceCardName")]
        source_card_name: Option<String>,
        #[serde(default)]
        optional: bool,
    },
}

/// One player's roll in the start-of-game first-player roll-off.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstPlayerRollEntry {
    pub player_id: String,
    pub player_name: String,
    pub value: i32,
}

/// Describes a single way to play a card (normal, alternative cost, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayOptionDto {
    pub card_id: String,
    /// e.g. "normal", "alternative:spectacle", "alternative:evoke", "staticAlternative", "foretellExile"
    pub mode: String,
    /// Human-readable label, e.g. "Cast normally", "Cast with Spectacle"
    pub mode_label: String,
}

/// Info about an activatable ability on a battlefield permanent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivatableAbilityInfo {
    pub card_id: String,
    pub ability_index: usize,
    pub description: String,
    pub is_mana_ability: bool,
    /// Human-readable cost string, e.g. "{T}", "{2}{W}", "Pay 3 life"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<String>,
}

/// Sent from frontend to game thread: the human player's response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlayerAction {
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
    /// Response to ChooseRollSwapValue. `choice` is "power" or "toughness".
    RollSwapValueDecision {
        choice: Option<String>,
    },
    Concede,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockAssignment {
    pub blocker_id: String,
    pub attacker_id: String,
}

/// An attack assignment: attacker paired with its defender.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackAssignment {
    pub attacker_id: String,
    pub defender_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatDamageAssignmentEntry {
    /// "card-{i}" for blockers or defender ID (e.g. "player-{i}" / "card-{i}").
    pub assignee_id: String,
    pub damage: i32,
}

/// A defender identifier sent to/from the frontend.
/// Format: "player-{index}" for players, "card-{index}" for permanents.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefenderIdDto {
    /// Serialized ID: "player-0", "card-42", etc.
    pub id: String,
    /// Human-readable label for display.
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TargetAnyChoice {
    Player {
        #[serde(rename = "playerId")]
        player_id: String,
    },
    Card {
        #[serde(rename = "cardId")]
        card_id: String,
    },
    None,
}
