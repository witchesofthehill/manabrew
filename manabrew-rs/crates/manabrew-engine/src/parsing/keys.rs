//! Compile-time constants for all DSL parameter keys.
//!
//! These replace raw magic strings like `params.selector_value("ValidCard")` with
//! `params.selector_value(keys::VALID_CARD)` — typos become compile errors and
//! keys are discoverable via IDE autocomplete.
//!
//! Mirrors the parameter keys used throughout Java Forge's ability text
//! format (pipe-delimited `Key$ Value` pairs).

// ── Ability/Effect type identifiers ─────────────────────────────────────

pub const AB: &str = "AB";
pub const DB: &str = "DB";
pub const SP: &str = "SP";
pub const ST: &str = "ST";
pub const MODE: &str = "Mode";
pub const EVENT: &str = "Event";

// ── Card/Target filters ────────────────────────────────────────────────

pub const AFFECTED: &str = "Affected";
pub const AFFECTED_ZONE: &str = "AffectedZone";
pub const MAY_PLAY: &str = "MayPlay";
pub const MAY_PLAY_ALT_MANA_COST: &str = "MayPlayAltManaCost";
pub const VALID: &str = "Valid";
pub const VALID_ACTIVATING_PLAYER: &str = "ValidActivatingPlayer";
pub const VALID_ACTIVATOR: &str = "ValidActivator";
pub const VALID_ATTACKED: &str = "ValidAttacked";
pub const VALID_ATTACKER: &str = "ValidAttacker";
pub const VALID_ATTACKER_RELATIVE: &str = "ValidAttackerRelative";
pub const VALID_ATTACKERS: &str = "ValidAttackers";
pub const VALID_ATTACKERS_AMOUNT: &str = "ValidAttackersAmount";
pub const VALID_BLOCKED: &str = "ValidBlocked";
pub const VALID_BLOCKER: &str = "ValidBlocker";
pub const VALID_BLOCKER_RELATIVE: &str = "ValidBlockerRelative";
pub const VALID_CARD: &str = "ValidCard";
pub const VALID_CARDS: &str = "ValidCards";
pub const VALID_CARD_TO_TARGET: &str = "ValidCardToTarget";
pub const VALID_CAUSE: &str = "ValidCause";
pub const VALID_CREATURE: &str = "ValidCreature";
pub const VALID_DEFENDER: &str = "ValidDefender";
pub const VALID_ENLISTED: &str = "ValidEnlisted";
pub const VALID_ENTITY: &str = "ValidEntity";
pub const VALID_LOSE_REASON: &str = "ValidLoseReason";
pub const VALID_MODE: &str = "ValidMode";
pub const VALID_PLAYER: &str = "ValidPlayer";
pub const VALID_RESULT: &str = "ValidResult";
pub const VALID_SA: &str = "ValidSA";
pub const VALID_SIDES: &str = "ValidSides";
pub const VALID_SOURCE: &str = "ValidSource";
pub const VALID_SPELL: &str = "ValidSpell";
pub const VALID_TARGET: &str = "ValidTarget";
pub const VALID_TGTS: &str = "ValidTgts";
pub const VALID_TRIGGER: &str = "ValidTrigger";
pub const VALID_TYPES: &str = "ValidTypes";
pub const VALID_COUNTER_TYPE: &str = "ValidCounterType";
pub const VALID_KEYWORD: &str = "ValidKeyword";
pub const VALID_ZONE: &str = "ValidZone";
pub const TARGET: &str = "Target";
pub const TARGET_MIN: &str = "TargetMin";
pub const TARGET_MAX: &str = "TargetMax";
pub const TARGET_TYPE: &str = "TargetType";
pub const TARGETING_PLAYER: &str = "TargetingPlayer";

// ── Zone/movement params ───────────────────────────────────────────────

pub const ACTIVE_ZONES: &str = "ActiveZones";
pub const ORIGIN: &str = "Origin";
pub const DESTINATION: &str = "Destination";
pub const DESTINATION_ALTERNATIVE: &str = "DestinationAlternative";
pub const NEW_DESTINATION: &str = "NewDestination";
pub const ZONE: &str = "Zone";
pub const LIBRARY_POSITION: &str = "LibraryPosition";
pub const LIBRARY_POSITION_ALTERNATIVE: &str = "LibraryPositionAlternative";

// ── Defined references ─────────────────────────────────────────────────

pub const DEFINED: &str = "Defined";
pub const DEFINED_MAGNET: &str = "DefinedMagnet";
pub const DEFINED_NAME: &str = "DefinedName";
pub const DEFINED_PLAYER: &str = "DefinedPlayer";
pub const DELAYED_TRIGGER_DEFINED_PLAYER: &str = "DelayedTriggerDefinedPlayer";

// ── Cost params ────────────────────────────────────────────────────────

pub const COST: &str = "Cost";
pub const ALTERNATE_COST: &str = "AlternateCost";
pub const PLAY_COST: &str = "PlayCost";
pub const FOR_COST: &str = "ForCost";
pub const UNLESS_COST: &str = "UnlessCost";

// ── Mana params ────────────────────────────────────────────────────────

pub const PRODUCED: &str = "Produced";
pub const MANA_CONVERSION: &str = "ManaConversion";
pub const MANA_REPLACEMENT: &str = "ManaReplacement";
pub const MANA_TYPE: &str = "ManaType";
pub const MIN_MANA: &str = "MinMana";
pub const TRIGGERS_WHEN_SPENT: &str = "TriggersWhenSpent";

// ── Numeric params ─────────────────────────────────────────────────────

pub const AMOUNT: &str = "Amount";
pub const ADDITIONAL: &str = "Additional";
pub const CONNIVE_NUM: &str = "ConniveNum";
pub const HIT_COUNT: &str = "HitCount";
pub const NUM_DMG: &str = "NumDmg";
pub const LIFE_AMOUNT: &str = "LifeAmount";
pub const DAMAGE_AMOUNT: &str = "DamageAmount";
pub const DAMAGE_MAP: &str = "DamageMap";
pub const CHANGE_NUM: &str = "ChangeNum";
pub const VALUE: &str = "Value";
pub const MIN: &str = "Min";
pub const MAX: &str = "Max";

// ── Power/Toughness ────────────────────────────────────────────────────

pub const ADD_POWER: &str = "AddPower";
pub const ADD_TOUGHNESS: &str = "AddToughness";
pub const POWER: &str = "Power";
pub const POWER_UP: &str = "PowerUp";
pub const PLANESWALKER: &str = "Planeswalker";
pub const SET_POWER: &str = "SetPower";
pub const SET_TOUGHNESS: &str = "SetToughness";
pub const TOUGHNESS: &str = "Toughness";

// ── Type/Color modification ────────────────────────────────────────────

pub const ADD_COLOR: &str = "AddColor";
pub const ADD_TYPE: &str = "AddType";
pub const TYPE: &str = "Type";
pub const TYPES: &str = "Types";
pub const ADD_TYPES: &str = "AddTypes";
pub const ADD_ALL_CREATURE_TYPES: &str = "AddAllCreatureTypes";
pub const REMOVE_ARTIFACT_TYPES: &str = "RemoveArtifactTypes";
pub const REMOVE_CARD_TYPES: &str = "RemoveCardTypes";
pub const REMOVE_COLOR: &str = "RemoveColor";
pub const REMOVE_ENCHANTMENT_TYPES: &str = "RemoveEnchantmentTypes";
pub const REMOVE_LAND_TYPES: &str = "RemoveLandTypes";
pub const REMOVE_SUB_TYPES: &str = "RemoveSubTypes";
pub const REMOVE_SUPER_TYPES: &str = "RemoveSuperTypes";
pub const REMOVE_TYPE: &str = "RemoveType";
pub const SECONDARY_TYPE: &str = "SecondaryType";
pub const COLOR: &str = "Color";
pub const COLOR_OR_TYPE: &str = "ColorOrType";
pub const COLORS: &str = "Colors";
pub const SET_COLOR: &str = "SetColor";
pub const CHANGE_TYPE: &str = "ChangeType";
pub const CHANGE_VALID: &str = "ChangeValid";

// ── Keywords ───────────────────────────────────────────────────────────

pub const KEYWORDS: &str = "Keywords";
pub const ALL_SUFFIX_KEYWORDS: &str = "AllSuffixKeywords";
pub const ADD_KEYWORD: &str = "AddKeyword";
pub const ADD_KEYWORDS: &str = "AddKeywords";
pub const ADD_ABILITY: &str = "AddAbility";
pub const ADD_REPLACEMENT_EFFECT: &str = "AddReplacementEffect";
pub const ADD_STATIC_ABILITY: &str = "AddStaticAbility";
pub const ADD_SVAR: &str = "AddSVar";
pub const ADD_TRIGGER: &str = "AddTrigger";
pub const ADD_KWS: &str = "AddKWs";
pub const CANT_HAVE_KEYWORD: &str = "CantHaveKeyword";
pub const GAINS_ABILITIES_OF: &str = "GainsAbilitiesOf";
pub const GAINS_ABILITIES_OF_DEFINED: &str = "GainsAbilitiesOfDefined";
pub const GAINS_TRIGGER_ABS_OF: &str = "GainsTriggerAbsOf";
pub const PUMP_KEYWORDS: &str = "PumpKeywords";
pub const GAINS: &str = "Gains";
pub const REMOVE_KEYWORD: &str = "RemoveKeyword";
pub const REMOVE_NON_MANA_ABILITIES: &str = "RemoveNonManaAbilities";
pub const SHARE_REMEMBERED_KEYWORDS: &str = "ShareRememberedKeywords";

// ── Attribute params ─────────────────────────────────────────────────────

pub const ACTIVATE: &str = "Activate";
pub const ATTRIBUTES: &str = "Attributes";

// ── Counter params ─────────────────────────────────────────────────────

pub const COUNTER_TYPE: &str = "CounterType";
pub const WITH_COUNTERS_TYPE: &str = "WithCountersType";
pub const WITH_COUNTERS_AMOUNT: &str = "WithCountersAmount";
pub const ADDS_COUNTERS: &str = "AddsCounters";
pub const ADDS_COUNTERS_VALID: &str = "AddsCountersValid";

// ── Boolean params ─────────────────────────────────────────────────────

pub const AI_PHYREXIAN_PAYMENT: &str = "AIPhyrexianPayment";
pub const ALWAYS_REMEMBER: &str = "AlwaysRemember";
pub const AT_RANDOM: &str = "AtRandom";
pub const COMBAT_DAMAGE: &str = "CombatDamage";
pub const ETB: &str = "ETB";
pub const EXPLOIT: &str = "Exploit";
pub const FACE_DOWN: &str = "FaceDown";
pub const EXILE_FACE_DOWN: &str = "ExileFaceDown";
pub const FORGET_CHANGED: &str = "ForgetChanged";
pub const GAIN_CONTROL: &str = "GainControl";
pub const GOAD: &str = "Goad";
pub const HIDDEN: &str = "Hidden";
pub const IMPRINT: &str = "Imprint";
pub const IS_COMBAT: &str = "IsCombat";
pub const IS_DAMAGE: &str = "IsDamage";
pub const MANDATORY: &str = "Mandatory";
pub const MODULAR: &str = "Modular";
pub const OPTIONAL: &str = "Optional";
/// `Upto$` (lowercase 'pto') — used by `DrawEffect` to let the decider pick
/// how many cards to draw (0..=N). Distinct from `UpTo` (different effects).
pub const UPTO: &str = "Upto";
/// `ReplaceGraveyard$` — `PlayEffect` adds a replacement that reroutes the
/// played card to the named zone instead of the graveyard. Diviner of Mist
/// uses `ReplaceGraveyard$ Exile`.
pub const REPLACE_GRAVEYARD: &str = "ReplaceGraveyard";
/// `TgtZone$` — explicit override for target-search zone. Mirrors Java
/// `TargetRestrictions.setupTargeting` (TargetRestrictions.java:152). Distinct
/// from `Origin$` (which most effects use for the source zone of a ChangeZone
/// move). When both appear, `TgtZone$` wins.
pub const TGT_ZONE: &str = "TgtZone";
pub const RESULT: &str = "Result";
pub const PREVENT: &str = "Prevent";
pub const REMEMBER_CHANGED: &str = "RememberChanged";
pub const REVEAL: &str = "Reveal";
pub const SHUFFLE: &str = "Shuffle";
pub const SKIP_UNTAP: &str = "SkipUntap";
pub const SORCERY_SPEED: &str = "SorcerySpeed";
pub const NO_REVEAL: &str = "NoReveal";
pub const TAPPED: &str = "Tapped";
pub const TRANSFORMED: &str = "Transformed";

// ── SubAbility/Execute chain ───────────────────────────────────────────

pub const SUB_ABILITY: &str = "SubAbility";
pub const EXECUTE: &str = "Execute";
pub const RESULT_SUB_ABILITIES: &str = "ResultSubAbilities";
pub const REPEAT: &str = "Repeat";
pub const REPEAT_CARDS: &str = "RepeatCards";
pub const REPEAT_PLAYERS: &str = "RepeatPlayers";
pub const REPEAT_SUB_ABILITY: &str = "RepeatSubAbility";
pub const ENTWINE: &str = "Entwine";

// ── Remember/Imprint ───────────────────────────────────────────────────

pub const REMEMBER_OBJECTS: &str = "RememberObjects";
pub const REMEMBER_PLAYERS: &str = "RememberPlayers";
pub const REMEMBER_REMOVED_CARDS: &str = "RememberRemovedCards";
pub const REMEMBER_SVAR_AMOUNT: &str = "RememberSVarAmount";
pub const REMEMBER_TAPPED: &str = "RememberTapped";

// ── Condition params ───────────────────────────────────────────────────

pub const CONDITION: &str = "Condition";
pub const CONDITION_CHECK_SVAR: &str = "ConditionCheckSVar";
pub const CONDITION_COMPARE: &str = "ConditionCompare";
pub const CONDITION_DEFINED: &str = "ConditionDefined";
pub const CONDITION_PRESENT: &str = "ConditionPresent";
pub const IS_PRESENT: &str = "IsPresent";
pub const CHECK_SVAR: &str = "CheckSVar";
pub const SVAR_COMPARE: &str = "SVarCompare";
pub const SVAR_NAME: &str = "SVarName";
pub const SVAR_VALUE: &str = "SVarValue";
pub const BRANCH_CONDITION_SVAR: &str = "BranchConditionSVar";
pub const BRANCH_CONDITION_SVAR_COMPARE: &str = "BranchConditionSVarCompare";

// ── Static ability specific ────────────────────────────────────────────

pub const ADDS_KEYWORDS: &str = "AddsKeywords";
pub const ADDS_KEYWORDS_VALID: &str = "AddsKeywordsValid";
pub const CUMULATIVE_UPKEEP: &str = "CumulativeUpkeep";
pub const REST_RANDOM_ORDER: &str = "RestRandomOrder";
pub const RESTRICT_VALID: &str = "RestrictValid";
pub const RESTRICT_FROM_ZONE: &str = "RestrictFromZone";
pub const RESTRICTION: &str = "Restriction";

// ── Static ability continuous layer params ─────────────────────────────

pub const ADD_HIDDEN_KEYWORD: &str = "AddHiddenKeyword";
pub const ADD_NAMES: &str = "AddNames";
pub const ADDITIONAL_OPTIONAL_VOTE: &str = "AdditionalOptionalVote";
pub const ADDITIONAL_VOTE: &str = "AdditionalVote";
pub const ADJUST_LAND_PLAYS: &str = "AdjustLandPlays";
pub const CAN_BLOCK_AMOUNT: &str = "CanBlockAmount";
pub const CAN_BLOCK_ANY: &str = "CanBlockAny";
pub const CHANGE_COLOR_WORDS_TO: &str = "ChangeColorWordsTo";
pub const CONTROL_VOTE: &str = "ControlVote";
pub const DECLARES_ATTACKERS: &str = "DeclaresAttackers";
pub const DECLARES_BLOCKERS: &str = "DeclaresBlockers";
pub const GAIN_TEXT_OF: &str = "GainTextOf";
pub const IGNORE_EFFECT_COST: &str = "IgnoreEffectCost";
pub const INCORPORATE: &str = "Incorporate";
pub const MANA_COST: &str = "ManaCost";
pub const SET_NAME: &str = "SetName";

// ── Replacement params ─────────────────────────────────────────────────

pub const REPLACE_AMOUNT: &str = "ReplaceAmount";
pub const REPLACE_COLOR: &str = "ReplaceColor";
pub const REPLACE_MANA: &str = "ReplaceMana";
pub const REPLACE_TYPE: &str = "ReplaceType";
pub const REPLACE_WITH: &str = "ReplaceWith";
pub const REPLACEMENT: &str = "Replacement";

// ── Token params ───────────────────────────────────────────────────────

pub const TOKEN_SCRIPT: &str = "TokenScript";
pub const TOKEN_OWNER: &str = "TokenOwner";
pub const TOKEN_TAPPED: &str = "TokenTapped";
pub const TOKEN_ATTACKING: &str = "TokenAttacking";
pub const TOKEN_BLOCKING: &str = "TokenBlocking";
pub const TOKEN_REMEMBERED: &str = "TokenRemembered";
pub const REMEMBER_TOKENS: &str = "RememberTokens";
pub const REMEMBER_ORIGINAL_TOKENS: &str = "RememberOriginalTokens";
pub const IMPRINT_TOKENS: &str = "ImprintTokens";
pub const REMEMBER_SOURCE: &str = "RememberSource";
pub const CLEANUP_FOR_EACH: &str = "CleanupForEach";
pub const ADD_TRIGGERS_FROM: &str = "AddTriggersFrom";
pub const AT_EOT_TRIG: &str = "AtEOTTrig";
pub const PUMP_DURATION: &str = "PumpDuration";

// ── Choice/Selection params ────────────────────────────────────────────

pub const CHOICES: &str = "Choices";
pub const CHOICE_ZONE: &str = "ChoiceZone";
pub const CHOOSER: &str = "Chooser";
pub const CHOOSE_FROM_DEFINED_CARDS: &str = "ChooseFromDefinedCards";
pub const CHOOSE_FROM_LIST: &str = "ChooseFromList";
pub const FOR_EACH: &str = "ForEach";
pub const PILES: &str = "Piles";
pub const SELECT_PROMPT: &str = "SelectPrompt";
pub const VOTE_MESSAGE: &str = "VoteMessage";

// ── Text/Description ───────────────────────────────────────────────────

pub const DESCRIPTION: &str = "Description";
pub const SPELL_DESCRIPTION: &str = "SpellDescription";
pub const NAME: &str = "Name";
pub const NAMES: &str = "Names";
pub const ORIGINAL: &str = "Original";
pub const CHANGE_COLOR_WORD: &str = "ChangeColorWord";
pub const CHANGE_TYPE_WORD: &str = "ChangeTypeWord";
pub const FORBIDDEN_NEW_TYPES: &str = "ForbiddenNewTypes";

// ── Trigger params ─────────────────────────────────────────────────────

pub const ALONE: &str = "Alone";
pub const ATTACKING_PLAYER: &str = "AttackingPlayer";
pub const ATTACKER: &str = "Attacker";
pub const NUMBER: &str = "Number";
pub const OPTIONAL_DECIDER: &str = "OptionalDecider";
pub const PHASE: &str = "Phase";
pub const PHASES: &str = "Phases";
pub const ACTIVE_PHASES: &str = "ActivePhases";
pub const STEP: &str = "Step";
pub const TRIGGER: &str = "Trigger";
pub const TRIGGER_DESCRIPTION: &str = "TriggerDescription";
pub const TRIGGER_ZONES: &str = "TriggerZones";
pub const TRIGGERS: &str = "Triggers";
pub const ACTIVATOR: &str = "Activator";
pub const ACTIVATOR_THIS_TURN_CAST: &str = "ActivatorThisTurnCast";
pub const CASTER: &str = "Caster";
pub const CONTROLLER: &str = "Controller";
pub const PLAYER: &str = "Player";
pub const PLAYER_TURN: &str = "PlayerTurn";
pub const SOURCE: &str = "Source";
pub const AT_EOT: &str = "AtEOT";

pub const LAYER: &str = "Layer";

// ── Clone/Copy params ────────────────────────────────────────────────
pub const SET_MANA_COST: &str = "SetManaCost";

// ── Meld/SetState params ─────────────────────────────────────────────
pub const ATTACKING: &str = "Attacking";
pub const MEGA: &str = "Mega";

// ── Counter params (extended) ────────────────────────────────────────
pub const COUNTER_NUM: &str = "CounterNum";
pub const ADAPT: &str = "Adapt";
pub const MONSTROSITY: &str = "Monstrosity";
pub const RENOWN: &str = "Renown";

// ── Dig params ───────────────────────────────────────────────────────
pub const DESTINATION_ZONE: &str = "DestinationZone";
pub const DESTINATION_ZONE_2: &str = "DestinationZone2";
pub const LIBRARY_POSITION_2: &str = "LibraryPosition2";
pub const PROMPT_TO_SKIP_OPTIONAL_ABILITY: &str = "PromptToSkipOptionalAbility";
pub const OPTIONAL_ABILITY_PROMPT: &str = "OptionalAbilityPrompt";

// ── Reflect params ───────────────────────────────────────────────────
pub const REFLECT_PROPERTY: &str = "ReflectProperty";

// ── Zone exchange params ─────────────────────────────────────────────
pub const ZONE1: &str = "Zone1";
pub const ZONE2: &str = "Zone2";

// ── Die roll params ──────────────────────────────────────────────────
pub const SIDES: &str = "Sides";

// ── Delayed trigger params ───────────────────────────────────────────
pub const REMEMBER_NUMBER: &str = "RememberNumber";

// ── Misc params ────────────────────────────────────────────────────────

pub const ATTACH_AFTER: &str = "AttachAfter";
pub const ATTACHED_TO: &str = "AttachedTo";
pub const ATTACHED_TO_PLAYER: &str = "AttachedToPlayer";
pub const CLONE_TARGET: &str = "CloneTarget";
pub const DURATION: &str = "Duration";
pub const EFFECT_SOURCE: &str = "EffectSource";
pub const EXCEPTION_SBA: &str = "ExceptionSBA";
pub const EXCEPTIONS: &str = "Exceptions";
pub const FOR_EACH_SHARD: &str = "ForEachShard";
pub const OBJECT: &str = "Object";
pub const PARAM_NAME: &str = "ParamName";
pub const PRIMARY: &str = "Primary";
pub const SECONDARY: &str = "Secondary";
pub const SPELLBOOK: &str = "Spellbook";
pub const STACK_ID: &str = "StackId";
pub const TOGGLE: &str = "Toggle";
pub const WARP: &str = "Warp";
pub const DUNGEON: &str = "Dungeon";
pub const MAY_SHUFFLE: &str = "MayShuffle";
pub const VAR_NAME: &str = "VarName";

// ── Static ability keys ─────────────────────────────────────────────────────
pub const CHARACTERISTIC_DEFINING: &str = "CharacteristicDefining";
pub const DRAW_LIMIT: &str = "DrawLimit";
pub const EFFECT_ZONE: &str = "EffectZone";
pub const EXCEPT_CAUSE: &str = "ExceptCause";
pub const IGNORE_EFFECT_CARDS: &str = "IgnoreEffectCards";
pub const IGNORE_EFFECT_PLAYERS: &str = "IgnoreEffectPlayers";
pub const MAX_ATTACKERS: &str = "MaxAttackers";
pub const MAX_BLOCKERS: &str = "MaxBlockers";
pub const MAX_NUM: &str = "MaxNum";
pub const PRESENT_COMPARE: &str = "PresentCompare";
pub const PRESENT_PLAYER: &str = "PresentPlayer";
pub const PRESENT_ZONE: &str = "PresentZone";
pub const NEW_TIME: &str = "NewTime";
pub const ONLY_SOURCE_ABS: &str = "OnlySourceAbs";
pub const TWICE: &str = "Twice";
pub const UNLESS_DEFENDER: &str = "UnlessDefender";
pub const DEFENDER_NOT_NEAREST_TO_YOU_IN_CHOSEN_DIRECTION: &str =
    "DefenderNotNearestToYouInChosenDirection";

// ── Animate params ──────────────────────────────────────────────────
pub const OVERWRITE_TYPES: &str = "OverwriteTypes";
pub const OVERWRITE_COLORS: &str = "OverwriteColors";
pub const REMOVE_CREATURE_TYPES: &str = "RemoveCreatureTypes";
pub const REMOVE_ALL_ABILITIES: &str = "RemoveAllAbilities";

// ── Mana metadata params ────────────────────────────────────────────
pub const ADDS_NO_COUNTER: &str = "AddsNoCounter";

// ── Charm params ────────────────────────────────────────────────────
pub const CAN_REPEAT_MODES: &str = "CanRepeatModes";
pub const CHARM_NUM: &str = "CharmNum";
pub const MIN_CHARM_NUM: &str = "MinCharmNum";

// ── Effect params ───────────────────────────────────────────────────
pub const STATIC_ABILITIES: &str = "StaticAbilities";
pub const EFFECT_OWNER: &str = "EffectOwner";
pub const FORGET_ON_MOVED: &str = "ForgetOnMoved";

// ── Token inline params ─────────────────────────────────────────────
pub const TOKEN_POWER: &str = "TokenPower";
pub const TOKEN_TOUGHNESS: &str = "TokenToughness";
pub const TOKEN_TYPES: &str = "TokenTypes";
pub const TOKEN_NAME: &str = "TokenName";
pub const TOKEN_COLORS: &str = "TokenColors";
pub const TOKEN_KEYWORDS: &str = "TokenKeywords";

// ── Sacrifice params ────────────────────────────────────────────────
pub const SAC_VALID: &str = "SacValid";
pub const STRICT_AMOUNT: &str = "StrictAmount";

// ── Unless params ───────────────────────────────────────────────────
pub const UNLESS_SWITCHED: &str = "UnlessSwitched";
pub const UNLESS_PAYER: &str = "UnlessPayer";

// ── Condition params (extra) ────────────────────────────────────────
pub const CONDITION_ZONE: &str = "ConditionZone";

// ── Effect-specific params (Params migration) ──────────────────────────────
pub const FALSE_SUB_ABILITY: &str = "FalseSubAbility";
pub const KW: &str = "KW";
pub const LOSE_CONTROL: &str = "LoseControl";
pub const MANA_ABILITY: &str = "ManaAbility";
pub const MULTIPLIER: &str = "Multiplier";
pub const NUM_ATT: &str = "NumAtt";
pub const NUM_DEF: &str = "NumDef";
pub const NUM_TURNS: &str = "NumTurns";
pub const RANDOM_TARGET: &str = "RandomTarget";
pub const REMEMBER_CHOSEN: &str = "RememberChosen";
pub const IMPRINT_CHOSEN: &str = "ImprintChosen";
pub const REMEMBER_COUNTERED: &str = "RememberCountered";
pub const REMEMBER_COUNTERED_CMC: &str = "RememberCounteredCMC";
pub const REMEMBER_FOR_COUNTER: &str = "RememberForCounter";
pub const REMEMBER_DAMAGED_CREATURE: &str = "RememberDamagedCreature";
pub const SECRETLY: &str = "Secretly";
pub const STORE_VOTE_NUM: &str = "StoreVoteNum";
pub const REMEMBER_VOTED_OBJECTS: &str = "RememberVotedObjects";
pub const TRUE_SUB_ABILITY: &str = "TrueSubAbility";
pub const UNTAP: &str = "Untap";
pub const VALID_PLAYERS: &str = "ValidPlayers";

// ── Mode cost params ────────────────────────────────────────────────
pub const MODE_COST: &str = "ModeCost";

// ── Additional params (magic-string migration) ─────────────────────────
pub const ACTIVATION_ZONE: &str = "ActivationZone";
pub const CANT_FIZZLE: &str = "CantFizzle";
pub const GAME_ACTIVATION_LIMIT: &str = "GameActivationLimit";
pub const PRECOST_DESC: &str = "PrecostDesc";
pub const REPLACE_ONLY: &str = "ReplaceOnly";
pub const SKIP: &str = "Skip";
pub const VALID_EXPLORER: &str = "ValidExplorer";

// ── Drain mana params ──────────────────────────────────────────────
pub const DRAIN_MANA: &str = "DrainMana";
pub const REMEMBER_DRAINED_MANA: &str = "RememberDrainedMana";

// ── Draw params ─────────────────────────────────────────────────────
pub const NUM_CARDS: &str = "NumCards";

// ── Magic-string migration (param_is_true / param_as_i32) ───────────
pub const ADD_ATTACKING: &str = "AddAttacking";
pub const CHAMPION: &str = "Champion";
pub const DIFFERENT_CMC: &str = "DifferentCMC";
pub const DIFFERENT_NAMES: &str = "DifferentNames";
pub const DIFFERENT_POWER: &str = "DifferentPower";
pub const EXACTLY: &str = "Exactly";
pub const FORETOLD: &str = "Foretold";
pub const FORETOLD_COST: &str = "ForetoldCost";
pub const FORGET_OTHER_REMEMBERED: &str = "ForgetOtherRemembered";
pub const IMPRINT_FOUND: &str = "ImprintFound";
pub const IMPRINT_LAST: &str = "ImprintLast";
pub const IMPRINT_MADE: &str = "ImprintMade";
pub const NINJUTSU: &str = "Ninjutsu";
pub const NO_LOOKING: &str = "NoLooking";
pub const NO_SHUFFLE: &str = "NoShuffle";
pub const NUM: &str = "Num";
pub const RANDOM_CHOSEN: &str = "RandomChosen";
pub const RANDOM_ORDER: &str = "RandomOrder";
pub const REMEMBER: &str = "Remember";
pub const REMEMBER_ALTERED: &str = "RememberAltered";
pub const REMEMBER_AMASS: &str = "RememberAmass";
pub const REMEMBER_CLASHER: &str = "RememberClasher";
pub const REMEMBER_CLOAKED: &str = "RememberCloaked";
pub const REMEMBER_DISCOVERED: &str = "RememberDiscovered";
pub const REMEMBER_DRAFTED: &str = "RememberDrafted";
pub const REMEMBER_EXCHANGED: &str = "RememberExchanged";
pub const REMEMBER_FOUND: &str = "RememberFound";
pub const REMEMBER_INVESTIGATING_PLAYERS: &str = "RememberInvestigatingPlayers";
pub const REMEMBER_LKI: &str = "RememberLKI";
pub const REMEMBER_MADE: &str = "RememberMade";
pub const REMEMBER_MANIFESTED: &str = "RememberManifested";
pub const REMEMBER_SACRIFICED: &str = "RememberSacrificed";
pub const REMEMBER_SEARCHED: &str = "RememberSearched";
pub const REMOVE_FROM_COMBAT: &str = "RemoveFromCombat";
pub const SEARCHED: &str = "Searched";
pub const SHARE_LAND_TYPE: &str = "ShareLandType";
pub const SHUFFLE_CHANGED_PILE: &str = "ShuffleChangedPile";
pub const SNEAK: &str = "Sneak";
pub const TRACK_DISCARDED: &str = "TrackDiscarded";
pub const UNEARTH: &str = "Unearth";
pub const UNIMPRINT: &str = "Unimprint";
pub const WITH_NOTED_COUNTERS: &str = "WithNotedCounters";
pub const WITH_TOTAL_CMC: &str = "WithTotalCMC";
pub const WITH_TOTAL_POWER: &str = "WithTotalPower";
