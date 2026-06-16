//! Constants for card filter strings used in ValidCard$, Affected$, ValidBlocker$, etc.
//!
//! These replace scattered magic strings throughout the engine. Using constants
//! prevents typos and makes it easy to find all usages.

// Card type filters
pub const CREATURE: &str = "Creature";
pub const LAND: &str = "Land";
pub const PERMANENT: &str = "Permanent";
pub const SPELL: &str = "Spell";
pub const CARD: &str = "Card";
pub const ARTIFACT: &str = "Artifact";
pub const ENCHANTMENT: &str = "Enchantment";
pub const PLANESWALKER: &str = "Planeswalker";
pub const INSTANT: &str = "Instant";
pub const SORCERY: &str = "Sorcery";

// Controller/ownership qualifiers
pub const YOU_CTRL: &str = "YouCtrl";
pub const YOU_CONTROL: &str = "YouControl";
pub const OPP_CTRL: &str = "OppCtrl";
pub const OPPONENT_CTRL: &str = "OpponentCtrl";
pub const YOU_DONT_CTRL: &str = "YouDontCtrl";

// Player references
pub const PLAYER: &str = "Player";
pub const YOU: &str = "You";
pub const OPPONENT: &str = "Opponent";
pub const ALL: &str = "All";
pub const EACH: &str = "Each";
pub const DEFENDING_PLAYER: &str = "DefendingPlayer";

// Self reference
pub const CARD_SELF: &str = "Card.Self";
pub const SELF_REF: &str = "Self";
pub const OTHER: &str = "Other";

// Boolean-like values
pub const TRUE: &str = "True";
pub const FALSE: &str = "False";
pub const ANY: &str = "Any";

// Type qualifiers
pub const NON_LAND: &str = "nonLand";
pub const NON_CREATURE: &str = "nonCreature";
pub const NON_ARTIFACT: &str = "nonArtifact";
pub const BASIC: &str = "Basic";

// Combat qualifiers
pub const ATTACKING: &str = "attacking";
pub const KICKED: &str = "kicked";
pub const WITH_FLYING: &str = "withFlying";

// SpellAbility kind tokens (used by `SpellAbility.isValid` — TargetType$ /
// SubAbilityKind$ / SubType$ filters). Mirror Java SpellAbility.isValid:2194-2236.
pub const ABILITY: &str = "Ability";
pub const TRIGGERED: &str = "Triggered";
pub const ACTIVATED: &str = "Activated";
pub const STATIC: &str = "Static";
pub const LAND_ABILITY: &str = "LandAbility";
pub const SPELL_ABILITY: &str = "SpellAbility";

// SpellAbility property qualifiers (after the `.` in tokens like
// `Spell.singleTarget`). Mirror Java ForgeScript.spellAbilityHasProperty.
pub const SINGLE_TARGET: &str = "singleTarget";
