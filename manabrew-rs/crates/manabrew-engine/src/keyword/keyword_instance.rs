//! Keyword instance base data and the Keyword enum.
//!
//! Ported from Java's `KeywordInstance.java` and `Keyword.java` in `forge/game/keyword/`.

use std::collections::HashMap;
use std::fmt;

/// Base data shared by all keyword instances.
/// Mirrors Java's `KeywordInstance` abstract class fields.
#[derive(Debug, Clone)]
pub struct KeywordInstanceData {
    /// The keyword enum variant.
    pub keyword: Keyword,
    /// The original keyword string as parsed from the card.
    pub original: String,
    /// Whether this keyword is intrinsic (printed on the card).
    pub intrinsic: bool,
    /// Unique index for this keyword instance.
    pub idx: i64,
}

impl KeywordInstanceData {
    /// Create new keyword instance data.
    pub fn new(keyword: Keyword, original: String) -> Self {
        Self {
            keyword,
            original,
            intrinsic: false,
            idx: -1,
        }
    }
}

/// A keyword instance with its associated traits (triggers, replacement effects,
/// static abilities, spell abilities).
/// Mirrors Java's `KeywordInstance<T>` abstract class.
#[derive(Debug, Clone)]
pub struct KeywordInstance {
    /// The underlying keyword data (keyword enum, original string, intrinsic flag, idx).
    pub data: KeywordInstanceData,
    /// Trigger definitions associated with this keyword.
    pub triggers: Vec<String>,
    /// Replacement effect definitions associated with this keyword.
    pub replacements: Vec<String>,
    /// Spell ability definitions associated with this keyword.
    pub spell_abilities: Vec<String>,
    /// Static ability definitions associated with this keyword.
    pub static_abilities: Vec<String>,
    /// SVars associated with this keyword instance.
    pub svars: HashMap<String, String>,
}

impl KeywordInstance {
    /// Create a new keyword instance from base data.
    pub fn new(data: KeywordInstanceData) -> Self {
        Self {
            data,
            triggers: Vec::new(),
            replacements: Vec::new(),
            spell_abilities: Vec::new(),
            static_abilities: Vec::new(),
            svars: HashMap::new(),
        }
    }

    /// Initialize trait lists from the keyword. Clears existing traits and
    /// re-parses them from the keyword definition.
    /// Mirrors Java's `KeywordInstance.createTraits(Card, boolean)`.
    pub fn create_traits(&mut self) {
        self.triggers.clear();
        self.replacements.clear();
        self.spell_abilities.clear();
        self.static_abilities.clear();
    }

    /// Add a trigger definition string.
    /// Mirrors Java's `KeywordInstance.addTrigger(Trigger)`.
    pub fn add_trigger(&mut self, trigger: String) {
        self.triggers.push(trigger);
    }

    /// Add a replacement effect definition string.
    /// Mirrors Java's `KeywordInstance.addReplacement(ReplacementEffect)`.
    pub fn add_replacement(&mut self, replacement: String) {
        self.replacements.push(replacement);
    }

    /// Add a spell ability definition string.
    /// Mirrors Java's `KeywordInstance.addSpellAbility(SpellAbility)`.
    pub fn add_spell_ability(&mut self, ability: String) {
        self.spell_abilities.push(ability);
    }

    /// Add a static ability definition string.
    /// Mirrors Java's `KeywordInstance.addStaticAbility(StaticAbility)`.
    pub fn add_static_ability(&mut self, static_ab: String) {
        self.static_abilities.push(static_ab);
    }

    /// Returns true if any traits (triggers, replacements, spell abilities,
    /// or static abilities) are defined.
    /// Mirrors Java's `KeywordInstance.hasTraits()`.
    pub fn has_traits(&self) -> bool {
        !self.triggers.is_empty()
            || !self.replacements.is_empty()
            || !self.spell_abilities.is_empty()
            || !self.static_abilities.is_empty()
    }

    /// Apply this keyword's spell abilities to a card by parsing each spell
    /// ability string and adding it to the card's abilities list.
    /// Mirrors Java's `KeywordInstance.applySpellAbility(List)`.
    pub fn apply_spell_ability(&self, card: &mut crate::card::Card) {
        for sa in &self.spell_abilities {
            card.abilities.push(sa.clone());
        }
    }

    /// Apply this keyword's triggers to a card by parsing each trigger string
    /// and adding it to the card's triggers list.
    /// Mirrors Java's `KeywordInstance.applyTrigger(List)`.
    pub fn apply_trigger(&self, card: &mut crate::card::Card) {
        let mut next_id = card.triggers.len() as u32;
        for trig_str in &self.triggers {
            if let Some(trigger) = crate::trigger::trigger::parse_trigger(trig_str, &mut next_id) {
                card.add_trigger(trigger);
            }
        }
    }

    /// Apply this keyword's replacement effects to a card by parsing each
    /// replacement effect string and adding it to the card's replacement effects list.
    /// Mirrors Java's `KeywordInstance.applyReplacementEffect(List)`.
    pub fn apply_replacement_effect(&self, card: &mut crate::card::Card) {
        for repl_str in &self.replacements {
            if let Some(repl) =
                crate::replacement::replacement_effect::parse_replacement_effect(repl_str)
            {
                card.add_replacement_effect(repl);
            }
        }
    }

    /// Apply this keyword's static abilities to a card by parsing each static
    /// ability string and adding it to the card's static abilities list.
    /// Mirrors Java's `KeywordInstance.applyStaticAbility(List)`.
    pub fn apply_static_ability(&self, card: &mut crate::card::Card) {
        for sa_str in &self.static_abilities {
            if let Some(sa) = crate::staticability::static_ability::parse_static_ability(sa_str) {
                card.static_abilities.push(sa);
            }
        }
    }

    /// Create a deep copy of this keyword instance.
    /// Mirrors Java's `KeywordInstance.copy(Card, boolean)`.
    pub fn copy(&self) -> Self {
        self.clone()
    }

    /// Check if this keyword instance is redundant with another (same keyword text).
    /// Mirrors Java's `KeywordInstance.redundant(Collection)`.
    pub fn redundant(&self, other: &Self) -> bool {
        if !self.data.keyword.is_multiple_redundant() {
            return false;
        }
        self.data.original == other.data.original
    }

    /// Check if this keyword instance has an SVar with the given name.
    /// Mirrors Java's `KeywordInstance.hasSVar(String)`.
    pub fn has_s_var(&self, name: &str) -> bool {
        self.svars.contains_key(name)
    }

    /// Remove an SVar from this keyword instance by name.
    /// Mirrors Java's `KeywordInstance.removeSVar(String)`.
    pub fn remove_s_var(&mut self, name: &str) {
        self.svars.remove(name);
    }
}

/// The Keyword enum with all keyword variants.
/// Mirrors Java's `Keyword` enum with 213 entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Keyword {
    Undefined,
    Absorb,
    Adapt,
    Affinity,
    Afflict,
    Afterlife,
    Aftermath,
    Amplify,
    Annihilator,
    Ascend,
    Assist,
    AuraSwap,
    Awaken,
    Backup,
    Banding,
    BandsWith,
    Bargain,
    BattleCry,
    Bestow,
    Blitz,
    Bloodthirst,
    Bushido,
    Buyback,
    Cascade,
    Casualty,
    Champion,
    Changeling,
    ChooseABackground,
    Cipher,
    Companion,
    Compleated,
    Conspire,
    Convoke,
    Craft,
    Crew,
    CumulativeUpkeep,
    Cycling,
    Dash,
    Daybound,
    Deathtouch,
    Decayed,
    Defender,
    Delve,
    Demonstrate,
    Dethrone,
    Devour,
    Devoid,
    Disguise,
    Disturb,
    DoctorsCompanion,
    DoubleAgenda,
    DoubleStrike,
    DoubleTeam,
    Dredge,
    Echo,
    Embalm,
    Emerge,
    Enchant,
    Encore,
    Enlist,
    Entwine,
    Epic,
    Equip,
    Escape,
    Escalate,
    Eternalize,
    Evoke,
    Evolve,
    Exalted,
    Exploit,
    Extort,
    Fabricate,
    Fading,
    Fear,
    Firebending,
    FirstStrike,
    Flanking,
    Flash,
    Flashback,
    Flying,
    ForMirrodin,
    Foretell,
    Fortify,
    Freerunning,
    Frenzy,
    Fuse,
    Gift,
    Graft,
    Gravestorm,
    Harmonize,
    Haste,
    Haunt,
    Hexproof,
    Hideaway,
    HiddenAgenda,
    Horsemanship,
    Impending,
    Improvise,
    Indestructible,
    Infect,
    Ingest,
    Intimidate,
    Kicker,
    JobSelect,
    JumpStart,
    Landwalk,
    LevelUp,
    Lifelink,
    LivingMetal,
    LivingWeapon,
    Madness,
    Mayhem,
    Melee,
    Mentor,
    Menace,
    Megamorph,
    Miracle,
    Mobilize,
    Monstrosity,
    Modular,
    MoreThanMeetsTheEye,
    Morph,
    Multikicker,
    Mutate,
    Myriad,
    Nightbound,
    Ninjutsu,
    Outlast,
    Offering,
    Offspring,
    Overload,
    Partner,
    PartnerWith,
    Persist,
    Phasing,
    Plot,
    Poisonous,
    Protection,
    Prototype,
    Provoke,
    Prowess,
    Prowl,
    Rampage,
    Ravenous,
    Reach,
    ReadAhead,
    Rebound,
    Recover,
    Reconfigure,
    Reflect,
    Reinforce,
    Renown,
    Replicate,
    Retrace,
    Riot,
    Ripple,
    Saddle,
    Scavenge,
    Shadow,
    Shroud,
    Skulk,
    Sneak,
    Soulbond,
    Soulshift,
    SpaceSculptor,
    Specialize,
    Spectacle,
    Splice,
    SplitSecond,
    Spree,
    Squad,
    StartYourEngines,
    StartingIntensity,
    Station,
    Storm,
    Strive,
    Sunburst,
    Surge,
    Suspend,
    Tiered,
    Toxic,
    Training,
    Trample,
    Transfigure,
    Transmute,
    Tribute,
    TypeCycling,
    UmbraArmor,
    Undaunted,
    Undying,
    Unearth,
    Unleash,
    Vanishing,
    Vigilance,
    Ward,
    Warp,
    WebSlinging,
    Wither,
    MayFlashCost,
    MayFlashSac,
}

impl Keyword {
    /// Get the display name for this keyword.
    pub fn display_name(&self) -> &'static str {
        match self {
            Keyword::Undefined => "",
            Keyword::Absorb => "Absorb",
            Keyword::Adapt => "Adapt",
            Keyword::Affinity => "Affinity",
            Keyword::Afflict => "Afflict",
            Keyword::Afterlife => "Afterlife",
            Keyword::Aftermath => "Aftermath",
            Keyword::Amplify => "Amplify",
            Keyword::Annihilator => "Annihilator",
            Keyword::Ascend => "Ascend",
            Keyword::Assist => "Assist",
            Keyword::AuraSwap => "Aura swap",
            Keyword::Awaken => "Awaken",
            Keyword::Backup => "Backup",
            Keyword::Banding => "Banding",
            Keyword::BandsWith => "Bands with other",
            Keyword::Bargain => "Bargain",
            Keyword::BattleCry => "Battle cry",
            Keyword::Bestow => "Bestow",
            Keyword::Blitz => "Blitz",
            Keyword::Bloodthirst => "Bloodthirst",
            Keyword::Bushido => "Bushido",
            Keyword::Buyback => "Buyback",
            Keyword::Cascade => "Cascade",
            Keyword::Casualty => "Casualty",
            Keyword::Champion => "Champion",
            Keyword::Changeling => "Changeling",
            Keyword::ChooseABackground => "Choose a Background",
            Keyword::Cipher => "Cipher",
            Keyword::Companion => "Companion",
            Keyword::Compleated => "Compleated",
            Keyword::Conspire => "Conspire",
            Keyword::Convoke => "Convoke",
            Keyword::Craft => "Craft",
            Keyword::Crew => "Crew",
            Keyword::CumulativeUpkeep => "Cumulative upkeep",
            Keyword::Cycling => "Cycling",
            Keyword::Dash => "Dash",
            Keyword::Daybound => "Daybound",
            Keyword::Deathtouch => "Deathtouch",
            Keyword::Decayed => "Decayed",
            Keyword::Defender => "Defender",
            Keyword::Delve => "Delve",
            Keyword::Demonstrate => "Demonstrate",
            Keyword::Dethrone => "Dethrone",
            Keyword::Devour => "Devour",
            Keyword::Devoid => "Devoid",
            Keyword::Disguise => "Disguise",
            Keyword::Disturb => "Disturb",
            Keyword::DoctorsCompanion => "Doctor's companion",
            Keyword::DoubleAgenda => "Double agenda",
            Keyword::DoubleStrike => "Double Strike",
            Keyword::DoubleTeam => "Double team",
            Keyword::Dredge => "Dredge",
            Keyword::Echo => "Echo",
            Keyword::Embalm => "Embalm",
            Keyword::Emerge => "Emerge",
            Keyword::Enchant => "Enchant",
            Keyword::Encore => "Encore",
            Keyword::Enlist => "Enlist",
            Keyword::Entwine => "Entwine",
            Keyword::Epic => "Epic",
            Keyword::Equip => "Equip",
            Keyword::Escape => "Escape",
            Keyword::Escalate => "Escalate",
            Keyword::Eternalize => "Eternalize",
            Keyword::Evoke => "Evoke",
            Keyword::Evolve => "Evolve",
            Keyword::Exalted => "Exalted",
            Keyword::Exploit => "Exploit",
            Keyword::Extort => "Extort",
            Keyword::Fabricate => "Fabricate",
            Keyword::Fading => "Fading",
            Keyword::Fear => "Fear",
            Keyword::Firebending => "Firebending",
            Keyword::FirstStrike => "First Strike",
            Keyword::Flanking => "Flanking",
            Keyword::Flash => "Flash",
            Keyword::Flashback => "Flashback",
            Keyword::Flying => "Flying",
            Keyword::ForMirrodin => "For Mirrodin",
            Keyword::Foretell => "Foretell",
            Keyword::Fortify => "Fortify",
            Keyword::Freerunning => "Freerunning",
            Keyword::Frenzy => "Frenzy",
            Keyword::Fuse => "Fuse",
            Keyword::Gift => "Gift",
            Keyword::Graft => "Graft",
            Keyword::Gravestorm => "Gravestorm",
            Keyword::Harmonize => "Harmonize",
            Keyword::Haste => "Haste",
            Keyword::Haunt => "Haunt",
            Keyword::Hexproof => "Hexproof",
            Keyword::Hideaway => "Hideaway",
            Keyword::HiddenAgenda => "Hidden agenda",
            Keyword::Horsemanship => "Horsemanship",
            Keyword::Impending => "Impending",
            Keyword::Improvise => "Improvise",
            Keyword::Indestructible => "Indestructible",
            Keyword::Infect => "Infect",
            Keyword::Ingest => "Ingest",
            Keyword::Intimidate => "Intimidate",
            Keyword::Kicker => "Kicker",
            Keyword::JobSelect => "Job select",
            Keyword::JumpStart => "Jump-start",
            Keyword::Landwalk => "Landwalk",
            Keyword::LevelUp => "Level up",
            Keyword::Lifelink => "Lifelink",
            Keyword::LivingMetal => "Living metal",
            Keyword::LivingWeapon => "Living Weapon",
            Keyword::Madness => "Madness",
            Keyword::Mayhem => "Mayhem",
            Keyword::Melee => "Melee",
            Keyword::Mentor => "Mentor",
            Keyword::Menace => "Menace",
            Keyword::Megamorph => "Megamorph",
            Keyword::Miracle => "Miracle",
            Keyword::Mobilize => "Mobilize",
            Keyword::Monstrosity => "Monstrosity",
            Keyword::Modular => "Modular",
            Keyword::MoreThanMeetsTheEye => "More Than Meets the Eye",
            Keyword::Morph => "Morph",
            Keyword::Multikicker => "Multikicker",
            Keyword::Mutate => "Mutate",
            Keyword::Myriad => "Myriad",
            Keyword::Nightbound => "Nightbound",
            Keyword::Ninjutsu => "Ninjutsu",
            Keyword::Outlast => "Outlast",
            Keyword::Offering => "Offering",
            Keyword::Offspring => "Offspring",
            Keyword::Overload => "Overload",
            Keyword::Partner => "Partner",
            Keyword::PartnerWith => "Partner with",
            Keyword::Persist => "Persist",
            Keyword::Phasing => "Phasing",
            Keyword::Plot => "Plot",
            Keyword::Poisonous => "Poisonous",
            Keyword::Protection => "Protection",
            Keyword::Prototype => "Prototype",
            Keyword::Provoke => "Provoke",
            Keyword::Prowess => "Prowess",
            Keyword::Prowl => "Prowl",
            Keyword::Rampage => "Rampage",
            Keyword::Ravenous => "Ravenous",
            Keyword::Reach => "Reach",
            Keyword::ReadAhead => "Read ahead",
            Keyword::Rebound => "Rebound",
            Keyword::Recover => "Recover",
            Keyword::Reconfigure => "Reconfigure",
            Keyword::Reflect => "Reflect",
            Keyword::Reinforce => "Reinforce",
            Keyword::Renown => "Renown",
            Keyword::Replicate => "Replicate",
            Keyword::Retrace => "Retrace",
            Keyword::Riot => "Riot",
            Keyword::Ripple => "Ripple",
            Keyword::Saddle => "Saddle",
            Keyword::Scavenge => "Scavenge",
            Keyword::Shadow => "Shadow",
            Keyword::Shroud => "Shroud",
            Keyword::Skulk => "Skulk",
            Keyword::Sneak => "Sneak",
            Keyword::Soulbond => "Soulbond",
            Keyword::Soulshift => "Soulshift",
            Keyword::SpaceSculptor => "Space sculptor",
            Keyword::Specialize => "Specialize",
            Keyword::Spectacle => "Spectacle",
            Keyword::Splice => "Splice",
            Keyword::SplitSecond => "Split second",
            Keyword::Spree => "Spree",
            Keyword::Squad => "Squad",
            Keyword::StartYourEngines => "Start your engines",
            Keyword::StartingIntensity => "Starting intensity",
            Keyword::Station => "Station",
            Keyword::Storm => "Storm",
            Keyword::Strive => "Strive",
            Keyword::Sunburst => "Sunburst",
            Keyword::Surge => "Surge",
            Keyword::Suspend => "Suspend",
            Keyword::Tiered => "Tiered",
            Keyword::Toxic => "Toxic",
            Keyword::Training => "Training",
            Keyword::Trample => "Trample",
            Keyword::Transfigure => "Transfigure",
            Keyword::Transmute => "Transmute",
            Keyword::Tribute => "Tribute",
            Keyword::TypeCycling => "TypeCycling",
            Keyword::UmbraArmor => "Umbra armor",
            Keyword::Undaunted => "Undaunted",
            Keyword::Undying => "Undying",
            Keyword::Unearth => "Unearth",
            Keyword::Unleash => "Unleash",
            Keyword::Vanishing => "Vanishing",
            Keyword::Vigilance => "Vigilance",
            Keyword::Ward => "Ward",
            Keyword::Warp => "Warp",
            Keyword::WebSlinging => "Web-slinging",
            Keyword::Wither => "Wither",
            Keyword::MayFlashCost => "MayFlashCost",
            Keyword::MayFlashSac => "MayFlashSac",
        }
    }

    /// Whether multiple instances of this keyword are redundant.
    pub fn is_multiple_redundant(&self) -> bool {
        matches!(
            self,
            Keyword::Ascend
                | Keyword::Assist
                | Keyword::Banding
                | Keyword::Changeling
                | Keyword::Cipher
                | Keyword::Companion
                | Keyword::Compleated
                | Keyword::Convoke
                | Keyword::Daybound
                | Keyword::Deathtouch
                | Keyword::Decayed
                | Keyword::Defender
                | Keyword::Delve
                | Keyword::Devoid
                | Keyword::DoubleStrike
                | Keyword::Entwine
                | Keyword::Epic
                | Keyword::Fear
                | Keyword::FirstStrike
                | Keyword::Flash
                | Keyword::Flying
                | Keyword::Fuse
                | Keyword::Gift
                | Keyword::Haste
                | Keyword::Hexproof
                | Keyword::HiddenAgenda
                | Keyword::Horsemanship
                | Keyword::Improvise
                | Keyword::Indestructible
                | Keyword::Infect
                | Keyword::Intimidate
                | Keyword::Landwalk
                | Keyword::Lifelink
                | Keyword::LivingMetal
                | Keyword::LivingWeapon
                | Keyword::Mutate
                | Keyword::Nightbound
                | Keyword::Partner
                | Keyword::Phasing
                | Keyword::Protection
                | Keyword::Reach
                | Keyword::ReadAhead
                | Keyword::Rebound
                | Keyword::Shadow
                | Keyword::Shroud
                | Keyword::Skulk
                | Keyword::Soulbond
                | Keyword::SpaceSculptor
                | Keyword::SplitSecond
                | Keyword::Spree
                | Keyword::StartYourEngines
                | Keyword::StartingIntensity
                | Keyword::Tiered
                | Keyword::Trample
                | Keyword::UmbraArmor
                | Keyword::Vigilance
                | Keyword::Wither
        )
    }

    /// Look up a keyword by its display name (case-insensitive).
    pub fn smart_value_of(value: &str) -> Keyword {
        // Check all variants for a case-insensitive match on display name.
        for kw in Self::all_variants() {
            if kw.display_name().eq_ignore_ascii_case(value) {
                return kw;
            }
        }
        Keyword::Undefined
    }

    /// Return an iterator over all keyword variants (excluding Undefined).
    pub fn all_keywords() -> impl Iterator<Item = Keyword> {
        Self::all_variants()
            .into_iter()
            .filter(|k| *k != Keyword::Undefined)
    }

    /// Return all enum variants as a slice-like vec.
    fn all_variants() -> Vec<Keyword> {
        vec![
            Keyword::Undefined,
            Keyword::Absorb,
            Keyword::Adapt,
            Keyword::Affinity,
            Keyword::Afflict,
            Keyword::Afterlife,
            Keyword::Aftermath,
            Keyword::Amplify,
            Keyword::Annihilator,
            Keyword::Ascend,
            Keyword::Assist,
            Keyword::AuraSwap,
            Keyword::Awaken,
            Keyword::Backup,
            Keyword::Banding,
            Keyword::BandsWith,
            Keyword::Bargain,
            Keyword::BattleCry,
            Keyword::Bestow,
            Keyword::Blitz,
            Keyword::Bloodthirst,
            Keyword::Bushido,
            Keyword::Buyback,
            Keyword::Cascade,
            Keyword::Casualty,
            Keyword::Champion,
            Keyword::Changeling,
            Keyword::ChooseABackground,
            Keyword::Cipher,
            Keyword::Companion,
            Keyword::Compleated,
            Keyword::Conspire,
            Keyword::Convoke,
            Keyword::Craft,
            Keyword::Crew,
            Keyword::CumulativeUpkeep,
            Keyword::Cycling,
            Keyword::Dash,
            Keyword::Daybound,
            Keyword::Deathtouch,
            Keyword::Decayed,
            Keyword::Defender,
            Keyword::Delve,
            Keyword::Demonstrate,
            Keyword::Dethrone,
            Keyword::Devour,
            Keyword::Devoid,
            Keyword::Disguise,
            Keyword::Disturb,
            Keyword::DoctorsCompanion,
            Keyword::DoubleAgenda,
            Keyword::DoubleStrike,
            Keyword::DoubleTeam,
            Keyword::Dredge,
            Keyword::Echo,
            Keyword::Embalm,
            Keyword::Emerge,
            Keyword::Enchant,
            Keyword::Encore,
            Keyword::Enlist,
            Keyword::Entwine,
            Keyword::Epic,
            Keyword::Equip,
            Keyword::Escape,
            Keyword::Escalate,
            Keyword::Eternalize,
            Keyword::Evoke,
            Keyword::Evolve,
            Keyword::Exalted,
            Keyword::Exploit,
            Keyword::Extort,
            Keyword::Fabricate,
            Keyword::Fading,
            Keyword::Fear,
            Keyword::Firebending,
            Keyword::FirstStrike,
            Keyword::Flanking,
            Keyword::Flash,
            Keyword::Flashback,
            Keyword::Flying,
            Keyword::ForMirrodin,
            Keyword::Foretell,
            Keyword::Fortify,
            Keyword::Freerunning,
            Keyword::Frenzy,
            Keyword::Fuse,
            Keyword::Gift,
            Keyword::Graft,
            Keyword::Gravestorm,
            Keyword::Harmonize,
            Keyword::Haste,
            Keyword::Haunt,
            Keyword::Hexproof,
            Keyword::Hideaway,
            Keyword::HiddenAgenda,
            Keyword::Horsemanship,
            Keyword::Impending,
            Keyword::Improvise,
            Keyword::Indestructible,
            Keyword::Infect,
            Keyword::Ingest,
            Keyword::Intimidate,
            Keyword::Kicker,
            Keyword::JobSelect,
            Keyword::JumpStart,
            Keyword::Landwalk,
            Keyword::LevelUp,
            Keyword::Lifelink,
            Keyword::LivingMetal,
            Keyword::LivingWeapon,
            Keyword::Madness,
            Keyword::Mayhem,
            Keyword::Melee,
            Keyword::Mentor,
            Keyword::Menace,
            Keyword::Megamorph,
            Keyword::Miracle,
            Keyword::Mobilize,
            Keyword::Monstrosity,
            Keyword::Modular,
            Keyword::MoreThanMeetsTheEye,
            Keyword::Morph,
            Keyword::Multikicker,
            Keyword::Mutate,
            Keyword::Myriad,
            Keyword::Nightbound,
            Keyword::Ninjutsu,
            Keyword::Outlast,
            Keyword::Offering,
            Keyword::Offspring,
            Keyword::Overload,
            Keyword::Partner,
            Keyword::PartnerWith,
            Keyword::Persist,
            Keyword::Phasing,
            Keyword::Plot,
            Keyword::Poisonous,
            Keyword::Protection,
            Keyword::Prototype,
            Keyword::Provoke,
            Keyword::Prowess,
            Keyword::Prowl,
            Keyword::Rampage,
            Keyword::Ravenous,
            Keyword::Reach,
            Keyword::ReadAhead,
            Keyword::Rebound,
            Keyword::Recover,
            Keyword::Reconfigure,
            Keyword::Reflect,
            Keyword::Reinforce,
            Keyword::Renown,
            Keyword::Replicate,
            Keyword::Retrace,
            Keyword::Riot,
            Keyword::Ripple,
            Keyword::Saddle,
            Keyword::Scavenge,
            Keyword::Shadow,
            Keyword::Shroud,
            Keyword::Skulk,
            Keyword::Sneak,
            Keyword::Soulbond,
            Keyword::Soulshift,
            Keyword::SpaceSculptor,
            Keyword::Specialize,
            Keyword::Spectacle,
            Keyword::Splice,
            Keyword::SplitSecond,
            Keyword::Spree,
            Keyword::Squad,
            Keyword::StartYourEngines,
            Keyword::StartingIntensity,
            Keyword::Station,
            Keyword::Storm,
            Keyword::Strive,
            Keyword::Sunburst,
            Keyword::Surge,
            Keyword::Suspend,
            Keyword::Tiered,
            Keyword::Toxic,
            Keyword::Training,
            Keyword::Trample,
            Keyword::Transfigure,
            Keyword::Transmute,
            Keyword::Tribute,
            Keyword::TypeCycling,
            Keyword::UmbraArmor,
            Keyword::Undaunted,
            Keyword::Undying,
            Keyword::Unearth,
            Keyword::Unleash,
            Keyword::Vanishing,
            Keyword::Vigilance,
            Keyword::Ward,
            Keyword::Warp,
            Keyword::WebSlinging,
            Keyword::Wither,
            Keyword::MayFlashCost,
            Keyword::MayFlashSac,
        ]
    }
}

impl fmt::Display for Keyword {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.display_name())
    }
}
