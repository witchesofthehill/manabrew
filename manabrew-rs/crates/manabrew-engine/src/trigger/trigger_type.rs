//! `TriggerType` enum + trigger script parser. Mirrors Java
//! `TriggerType.java` and `TriggerHandler.parseTrigger`.
//!
//! `EnumString` + `#[strum(ascii_case_insensitive)]` derives a case-insensitive
//! `FromStr` keyed on the variant name. Java aliases that aren't just a case
//! variation get explicit `#[strum(serialize = "...")]` entries.

use serde::{Deserialize, Serialize};
use strum_macros::EnumString;

use crate::trigger::trigger::{parse_trigger, Trigger};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default, EnumString)]
#[strum(ascii_case_insensitive)]
pub enum TriggerType {
    #[default]
    ChangesZone,
    Phase,
    SpellCast,
    Attacks,
    DamageDone,
    /// Two creatures fought each other (SP$ Fight).
    Fight,
    /// One or more creatures fought (batched).
    FightOnce,
    /// A card was discarded (SP$ Discard).
    Discarded,
    /// A spell was countered (SP$ Counter).
    Countered,
    // ── New trigger types (issue #19) ──
    /// A creature blocks an attacker.
    Blocks,
    /// An attacker is blocked by at least one creature.
    AttackerBlocked,
    /// An attacker is not blocked.
    AttackerUnblocked,
    /// A player gained life.
    LifeGained,
    /// A player lost life.
    LifeLost,
    /// A counter was added to a permanent.
    CounterAdded,
    /// A counter was removed from a permanent.
    CounterRemoved,
    /// A permanent was sacrificed.
    Sacrificed,
    /// A card was drawn.
    Drawn,
    /// A card was milled (library → graveyard).
    Milled,
    /// A permanent was tapped.
    Taps,
    /// A permanent was untapped.
    Untaps,
    /// A DFC was transformed.
    Transformed,
    /// An aura/equipment was attached.
    Attached,
    /// An aura/equipment was unattached.
    Unattached,
    /// A land was played.
    LandPlayed,
    /// A permanent became the target of a spell or ability.
    BecomesTarget,
    /// A permanent was tapped for mana.
    TapsForMana,
    /// An activated ability was activated.
    AbilityActivated,
    /// A creature explored.
    Explored,
    /// A creature became monstrous.
    BecomeMonstrous,
    /// A player became the monarch.
    BecomeMonarch,
    /// Damage was dealt to a player/creature for the first time this turn.
    DamageDealtOnce,
    /// A permanent was destroyed.
    Destroyed,
    /// A card was exiled.
    Exiled,
    /// A token was created.
    TokenCreated,
    /// A spell was copied (Storm, Replicate, etc.) — used by Magecraft.
    SpellCopied,
    /// A player took the initiative.
    TakeInitiative,
    /// A permanent phased out.
    PhasedOut,
    /// A permanent phased in.
    PhasedIn,
    // ── New trigger types (issue #54) ──
    /// All attackers declared at once (batch).
    AttackersDeclared,
    /// All blockers declared at once (batch).
    BlockersDeclared,
    /// A card changed zones (batch/all variant).
    ChangesZoneAll,
    /// A permanent changed controller.
    ChangesController,
    /// A turn began.
    #[strum(serialize = "TurnBegin", serialize = "newturn")]
    TurnBegin,
    /// Damage done once (first-time batch).
    DamageDoneOnce,
    /// Any spell cast (all players).
    SpellCastAll,
    /// Alias of SpellCast in Java TriggerType.
    AbilityCast,
    /// Alias of SpellCast in Java TriggerType.
    SpellAbilityCast,
    /// Alias of SpellCast in Java TriggerType.
    SpellAbilityCopy,
    /// Alias of SpellCast in Java TriggerType.
    SpellCastOrCopy,
    /// Alias of SpellCast in Java TriggerType.
    SpellCopy,
    /// Any player lost life (all players).
    LifeLostAll,
    /// Counter added once (batch).
    CounterAddedOnce,
    /// Any card discarded (all players).
    DiscardedAll,
    /// A permanent sacrificed once (batch).
    SacrificedOnce,
    /// A card was cycled.
    #[strum(serialize = "Cycled", serialize = "cycling")]
    Cycled,
    /// Alias of PhasedIn in Java TriggerType.
    PhaseIn,
    /// Alias of PhasedOut in Java TriggerType.
    PhaseOut,
    /// Always fires (every phase).
    Always,
    /// Fires immediately when registered.
    Immediate,
    /// A player surveilled.
    Surveil,
    /// A player scried.
    Scry,
    /// A card was foretold.
    #[strum(serialize = "Foretell", serialize = "foretold")]
    Foretell,
    /// A player searched their library.
    SearchedLibrary,
    /// A player shuffled their library.
    Shuffled,
    /// Mana was added to a player's pool.
    ManaAdded,
    /// A token was created (batch).
    TokenCreatedOnce,
    /// Any permanent tapped (all).
    TapAll,
    /// Any permanent untapped (all).
    UntapAll,
    /// A permanent became a target (batch).
    BecomesTargetOnce,
    /// An attacker was blocked by a specific creature.
    AttackerBlockedByCreature,
    /// An attacker was blocked (batch).
    AttackerBlockedOnce,
    /// An attacker was unblocked (batch).
    AttackerUnblockedOnce,
    /// Any spell cast (batch).
    SpellCastOnce,
    /// A spell of a specific type was cast.
    SpellCastOfType,
    /// Damage dealt (all instances).
    DamageAll,
    /// Damage was prevented (batch).
    DamagePreventedOnce,
    /// Excess damage dealt.
    ExcessDamage,
    /// A counter was removed (batch).
    CounterRemovedOnce,
    /// A creature was exerted.
    Exerted,
    /// A creature adapted.
    Adapt,
    /// A creature became renowned.
    BecomeRenowned,
    /// A creature evolved.
    Evolved,
    /// A player investigated.
    Investigated,
    /// A player proliferated.
    Proliferate,
    /// A player completed a dungeon.
    CompletedDungeon,
    /// Alias of CompletedDungeon in Java TriggerType.
    DungeonCompleted,
    /// A player committed a crime.
    CommitCrime,
    /// The Ring tempted a player.
    RingTemptsYou,
    /// A player paid life.
    PayLife,
    /// Echo was paid (or not) for a permanent.
    PayEcho,
    /// A new game started.
    NewGame,
    /// Day/night changed.
    DayTimeChanges,
    /// A class level was gained.
    ClassLevelGained,
    /// A card became plotted.
    BecomesPlotted,
    /// A player lost the game.
    LosesGame,
    /// A player discovered.
    Discover,
    /// Elementalbend event.
    Elementalbend,
    /// Alias of Elementalbend in Java TriggerType.
    #[strum(disabled)]
    ElementalBend,
    /// Alias of Elementalbend in Java TriggerType.
    Airbend,
    /// Alias of Elementalbend in Java TriggerType.
    Earthbend,
    /// Alias of Elementalbend in Java TriggerType.
    Firebend,
    /// Alias of Elementalbend in Java TriggerType.
    Waterbend,
    /// Multiple cards phased out.
    PhaseOutAll,
    /// Planar die was rolled.
    PlanarDice,
    /// A vote resolved.
    Vote,
    /// A gift was given.
    GiveGift,
    /// A player visited an attraction.
    VisitAttraction,
    /// A room was entered.
    EnteredRoom,
    /// Alias of EnteredRoom in Java TriggerType.
    RoomEntered,
    /// Multiple cards were milled.
    MilledAll,
    /// Cards were milled once for a player.
    MilledOnce,
    /// A scheme was abandoned.
    Abandoned,
    /// Manifest dread event.
    ManifestDread,
    /// A card specialized.
    Specializes,
    /// A card trained.
    Trains,
    /// A card devoured.
    Devoured,
    /// Cards were conjured in batch.
    ConjureAll,
    /// Cards were sought in batch.
    SeekAll,
    /// A card became crewed.
    BecomesCrewed,
    /// A card was championed.
    Championed,
    /// A clash happened.
    Clashed,
    /// A card was mentored.
    Mentored,
    /// A room/door became fully unlocked.
    FullyUnlock,
    /// A spell ability resolved.
    AbilityResolves,
    /// A spell ability triggered another trigger.
    AbilityTriggered,
    /// A door was unlocked.
    UnlockDoor,
    /// Counter-added batch event across multiple entities.
    CounterAddedAll,
    /// Counter-added batch event for a single object/source pair.
    CounterPlayerAddedAll,
    /// Counter-added batch event grouped by counter type.
    CounterTypeAddedAll,
    /// Crew/Saddle/Station grouped trigger.
    Crewed,
    /// Saddle alias for Crewed trigger class.
    Saddled,
    /// Station alias for Crewed trigger class.
    Stationed,
    /// Damage done once grouped by controller.
    DamageDoneOnceByController,
    /// Excess damage dealt to multiple targets.
    ExcessDamageAll,
    /// A player collected evidence.
    CollectEvidence,
    /// A player foraged.
    Forage,
    /// A creature enlisted another creature.
    Enlisted,
    /// A player flipped a coin.
    FlippedCoin,
    /// A player rolled a die.
    RolledDie,
    /// A player completed a die-roll action.
    RolledDieOnce,
    /// Mana was expended (cumulative per-turn tracking for Expend mechanic).
    ManaExpend,
    /// A face-down card was turned face-up (Morph/Megamorph/Manifest).
    TurnFaceUp,
    /// Alias of Explored in Java TriggerType.
    Explores,
    /// A creature was exploited (Exploit keyword).
    Exploited,
    /// Cumulative upkeep was paid (or not). Mirrors Java TriggerType.PayCumulativeUpkeep.
    PayCumulativeUpkeep,
    // ── Niche trigger types (Planechase, Unfinity, Ikoria, etc.) ──
    /// Chaos ensues (Planechase chaos die result).
    ChaosEnsues,
    /// A player planeswalked to a new plane (Planechase).
    Planeswalk,
    /// Alias of Planeswalk in Java TriggerType.
    PlaneswalkedFrom,
    /// Alias of Planeswalk in Java TriggerType.
    PlaneswalkedTo,
    /// A player claimed the prize from an attraction (Unfinity).
    ClaimPrize,
    /// A player advanced their crank counter (Unstable).
    CrankAdvanced,
    /// Alias of CrankAdvanced in Java TriggerType.
    CrankContraption,
    /// A Case enchantment was solved (MKM).
    CaseSolved,
    /// A creature became saddled (OTJ).
    BecomesSaddled,
    /// A scheme was set in motion (Archenemy).
    SetInMotion,
    /// A creature mutated onto another (IKO).
    Mutates,
    /// Alias of Unattached in Java TriggerType.
    Unattach,
    /// Alias of TakeInitiative in Java TriggerType.
    TakesInitiative,
    /// Alias of AttackersDeclared in Java TriggerType.
    AttackersDeclaredOneTarget,
}

impl TriggerType {
    /// Returns the string name of this trigger type, matching the Java TriggerType enum name.
    pub fn name(&self) -> &'static str {
        match self {
            TriggerType::ChangesZone => "ChangesZone",
            TriggerType::Phase => "Phase",
            TriggerType::SpellCast => "SpellCast",
            TriggerType::Attacks => "Attacks",
            TriggerType::DamageDone => "DamageDone",
            TriggerType::Fight => "Fight",
            TriggerType::FightOnce => "FightOnce",
            TriggerType::Discarded => "Discarded",
            TriggerType::Countered => "Countered",
            TriggerType::Blocks => "Blocks",
            TriggerType::AttackerBlocked => "AttackerBlocked",
            TriggerType::AttackerUnblocked => "AttackerUnblocked",
            TriggerType::LifeGained => "LifeGained",
            TriggerType::LifeLost => "LifeLost",
            TriggerType::CounterAdded => "CounterAdded",
            TriggerType::CounterRemoved => "CounterRemoved",
            TriggerType::Sacrificed => "Sacrificed",
            TriggerType::Drawn => "Drawn",
            TriggerType::Milled => "Milled",
            TriggerType::Taps => "Taps",
            TriggerType::Untaps => "Untaps",
            TriggerType::Transformed => "Transformed",
            TriggerType::Attached => "Attached",
            TriggerType::Unattached => "Unattached",
            TriggerType::LandPlayed => "LandPlayed",
            TriggerType::BecomesTarget => "BecomesTarget",
            TriggerType::TapsForMana => "TapsForMana",
            TriggerType::AbilityActivated => "AbilityActivated",
            TriggerType::Explored => "Explored",
            TriggerType::BecomeMonstrous => "BecomeMonstrous",
            TriggerType::BecomeMonarch => "BecomeMonarch",
            TriggerType::DamageDealtOnce => "DamageDealtOnce",
            TriggerType::Destroyed => "Destroyed",
            TriggerType::Exiled => "Exiled",
            TriggerType::TokenCreated => "TokenCreated",
            TriggerType::SpellCopied => "SpellCopied",
            TriggerType::TakeInitiative => "TakeInitiative",
            TriggerType::PhasedOut => "PhasedOut",
            TriggerType::PhasedIn => "PhasedIn",
            TriggerType::AttackersDeclared => "AttackersDeclared",
            TriggerType::BlockersDeclared => "BlockersDeclared",
            TriggerType::ChangesZoneAll => "ChangesZoneAll",
            TriggerType::ChangesController => "ChangesController",
            TriggerType::TurnBegin => "TurnBegin",
            TriggerType::DamageDoneOnce => "DamageDoneOnce",
            TriggerType::SpellCastAll => "SpellCastAll",
            TriggerType::AbilityCast => "AbilityCast",
            TriggerType::SpellAbilityCast => "SpellAbilityCast",
            TriggerType::SpellAbilityCopy => "SpellAbilityCopy",
            TriggerType::SpellCastOrCopy => "SpellCastOrCopy",
            TriggerType::SpellCopy => "SpellCopy",
            TriggerType::LifeLostAll => "LifeLostAll",
            TriggerType::CounterAddedOnce => "CounterAddedOnce",
            TriggerType::DiscardedAll => "DiscardedAll",
            TriggerType::SacrificedOnce => "SacrificedOnce",
            TriggerType::Cycled => "Cycled",
            TriggerType::PhaseIn => "PhaseIn",
            TriggerType::PhaseOut => "PhaseOut",
            TriggerType::Always => "Always",
            TriggerType::Immediate => "Immediate",
            TriggerType::Surveil => "Surveil",
            TriggerType::Scry => "Scry",
            TriggerType::Foretell => "Foretell",
            TriggerType::SearchedLibrary => "SearchedLibrary",
            TriggerType::Shuffled => "Shuffled",
            TriggerType::ManaAdded => "ManaAdded",
            TriggerType::TokenCreatedOnce => "TokenCreatedOnce",
            TriggerType::TapAll => "TapAll",
            TriggerType::UntapAll => "UntapAll",
            TriggerType::BecomesTargetOnce => "BecomesTargetOnce",
            TriggerType::AttackerBlockedByCreature => "AttackerBlockedByCreature",
            TriggerType::AttackerBlockedOnce => "AttackerBlockedOnce",
            TriggerType::AttackerUnblockedOnce => "AttackerUnblockedOnce",
            TriggerType::SpellCastOnce => "SpellCastOnce",
            TriggerType::SpellCastOfType => "SpellCastOfType",
            TriggerType::DamageAll => "DamageAll",
            TriggerType::DamagePreventedOnce => "DamagePreventedOnce",
            TriggerType::ExcessDamage => "ExcessDamage",
            TriggerType::CounterRemovedOnce => "CounterRemovedOnce",
            TriggerType::Exerted => "Exerted",
            TriggerType::Adapt => "Adapt",
            TriggerType::BecomeRenowned => "BecomeRenowned",
            TriggerType::Evolved => "Evolved",
            TriggerType::Investigated => "Investigated",
            TriggerType::Proliferate => "Proliferate",
            TriggerType::CompletedDungeon => "CompletedDungeon",
            TriggerType::DungeonCompleted => "DungeonCompleted",
            TriggerType::CommitCrime => "CommitCrime",
            TriggerType::RingTemptsYou => "RingTemptsYou",
            TriggerType::PayLife => "PayLife",
            TriggerType::PayEcho => "PayEcho",
            TriggerType::NewGame => "NewGame",
            TriggerType::DayTimeChanges => "DayTimeChanges",
            TriggerType::ClassLevelGained => "ClassLevelGained",
            TriggerType::BecomesPlotted => "BecomesPlotted",
            TriggerType::LosesGame => "LosesGame",
            TriggerType::Discover => "Discover",
            TriggerType::Elementalbend => "Elementalbend",
            TriggerType::ElementalBend => "ElementalBend",
            TriggerType::Airbend => "Airbend",
            TriggerType::Earthbend => "Earthbend",
            TriggerType::Firebend => "Firebend",
            TriggerType::Waterbend => "Waterbend",
            TriggerType::PhaseOutAll => "PhaseOutAll",
            TriggerType::PlanarDice => "PlanarDice",
            TriggerType::Vote => "Vote",
            TriggerType::GiveGift => "GiveGift",
            TriggerType::VisitAttraction => "VisitAttraction",
            TriggerType::EnteredRoom => "EnteredRoom",
            TriggerType::RoomEntered => "RoomEntered",
            TriggerType::MilledAll => "MilledAll",
            TriggerType::MilledOnce => "MilledOnce",
            TriggerType::Abandoned => "Abandoned",
            TriggerType::ManifestDread => "ManifestDread",
            TriggerType::Specializes => "Specializes",
            TriggerType::Trains => "Trains",
            TriggerType::Devoured => "Devoured",
            TriggerType::ConjureAll => "ConjureAll",
            TriggerType::SeekAll => "SeekAll",
            TriggerType::BecomesCrewed => "BecomesCrewed",
            TriggerType::Championed => "Championed",
            TriggerType::Clashed => "Clashed",
            TriggerType::Mentored => "Mentored",
            TriggerType::FullyUnlock => "FullyUnlock",
            TriggerType::AbilityResolves => "AbilityResolves",
            TriggerType::AbilityTriggered => "AbilityTriggered",
            TriggerType::UnlockDoor => "UnlockDoor",
            TriggerType::CounterAddedAll => "CounterAddedAll",
            TriggerType::CounterPlayerAddedAll => "CounterPlayerAddedAll",
            TriggerType::CounterTypeAddedAll => "CounterTypeAddedAll",
            TriggerType::Crewed => "Crewed",
            TriggerType::Saddled => "Saddled",
            TriggerType::Stationed => "Stationed",
            TriggerType::DamageDoneOnceByController => "DamageDoneOnceByController",
            TriggerType::ExcessDamageAll => "ExcessDamageAll",
            TriggerType::CollectEvidence => "CollectEvidence",
            TriggerType::Forage => "Forage",
            TriggerType::Enlisted => "Enlisted",
            TriggerType::FlippedCoin => "FlippedCoin",
            TriggerType::RolledDie => "RolledDie",
            TriggerType::RolledDieOnce => "RolledDieOnce",
            TriggerType::ManaExpend => "ManaExpend",
            TriggerType::TurnFaceUp => "TurnFaceUp",
            TriggerType::Explores => "Explores",
            TriggerType::Exploited => "Exploited",
            TriggerType::PayCumulativeUpkeep => "PayCumulativeUpkeep",
            TriggerType::ChaosEnsues => "ChaosEnsues",
            TriggerType::Planeswalk => "Planeswalk",
            TriggerType::PlaneswalkedFrom => "PlaneswalkedFrom",
            TriggerType::PlaneswalkedTo => "PlaneswalkedTo",
            TriggerType::ClaimPrize => "ClaimPrize",
            TriggerType::CrankAdvanced => "CrankAdvanced",
            TriggerType::CrankContraption => "CrankContraption",
            TriggerType::CaseSolved => "CaseSolved",
            TriggerType::BecomesSaddled => "BecomesSaddled",
            TriggerType::SetInMotion => "SetInMotion",
            TriggerType::Mutates => "Mutates",
            TriggerType::Unattach => "Unattach",
            TriggerType::TakesInitiative => "TakesInitiative",
            TriggerType::AttackersDeclaredOneTarget => "AttackersDeclaredOneTarget",
        }
    }
}
/// Case-insensitive TriggerType parser (Java `smartValueOf` parity).
///
/// Delegates to the `EnumString` derive on `TriggerType` — matches the variant
/// name case-insensitively, plus the explicit Java aliases
/// (`newturn`, `cycling`, `foretold`). Returns `None` for unknown values.
pub fn smart_value_of(value: &str) -> Option<TriggerType> {
    value.trim().parse().ok()
}

/// Java parity helper that parses a trigger script into a concrete Trigger.
pub fn create_trigger(raw_trigger: &str, next_id: &mut u32) -> Option<Trigger> {
    parse_trigger(raw_trigger, next_id)
}
