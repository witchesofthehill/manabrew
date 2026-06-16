use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpellAbilityMode {
    Increase,
    Decrease,
    Transform,
    Flip,
    TurnFaceUp,
    TurnFaceDown,
    ThisDoor,
    Unlock,
    LockOrUnlock,
    Unsupported(String),
}

impl SpellAbilityMode {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "Increase" => Self::Increase,
            "Decrease" => Self::Decrease,
            "Transform" => Self::Transform,
            "Flip" => Self::Flip,
            "TurnFaceUp" => Self::TurnFaceUp,
            "TurnFaceDown" => Self::TurnFaceDown,
            "ThisDoor" => Self::ThisDoor,
            "Unlock" => Self::Unlock,
            "LockOrUnlock" => Self::LockOrUnlock,
            other => Self::Unsupported(other.to_string()),
        }
    }
}

impl std::fmt::Display for SpellAbilityMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Increase => write!(f, "Increase"),
            Self::Decrease => write!(f, "Decrease"),
            Self::Transform => write!(f, "Transform"),
            Self::Flip => write!(f, "Flip"),
            Self::TurnFaceUp => write!(f, "TurnFaceUp"),
            Self::TurnFaceDown => write!(f, "TurnFaceDown"),
            Self::ThisDoor => write!(f, "ThisDoor"),
            Self::Unlock => write!(f, "Unlock"),
            Self::LockOrUnlock => write!(f, "LockOrUnlock"),
            Self::Unsupported(raw) => write!(f, "{raw}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AbilityDuration {
    UntilHostLeavesPlay,
    UntilHostLeavesPlayOrEot,
    UntilLoseControlOfHost,
    UntilUntaps,
    UntilTargetedUntaps,
    AsLongAsControl,
    AsLongAsInPlay,
    UntilYourNextTurn,
    Permanent,
    Perpetual,
    Unsupported(String),
}

impl AbilityDuration {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "UntilHostLeavesPlay" => Self::UntilHostLeavesPlay,
            "UntilHostLeavesPlayOrEOT" => Self::UntilHostLeavesPlayOrEot,
            "UntilLoseControlOfHost" => Self::UntilLoseControlOfHost,
            "UntilUntaps" => Self::UntilUntaps,
            "UntilTargetedUntaps" => Self::UntilTargetedUntaps,
            "AsLongAsControl" => Self::AsLongAsControl,
            "AsLongAsInPlay" => Self::AsLongAsInPlay,
            "UntilYourNextTurn" => Self::UntilYourNextTurn,
            "Permanent" => Self::Permanent,
            "Perpetual" => Self::Perpetual,
            other => Self::Unsupported(other.to_string()),
        }
    }

    pub fn needs_host_in_play_or_stack(&self) -> bool {
        matches!(
            self,
            Self::UntilHostLeavesPlay
                | Self::UntilHostLeavesPlayOrEot
                | Self::UntilLoseControlOfHost
                | Self::UntilUntaps
                | Self::AsLongAsControl
                | Self::AsLongAsInPlay
        )
    }

    pub fn needs_host_not_phased_out(&self) -> bool {
        matches!(self, Self::AsLongAsControl | Self::AsLongAsInPlay)
    }

    pub fn needs_host_control(&self) -> bool {
        matches!(self, Self::UntilLoseControlOfHost | Self::AsLongAsControl)
    }

    pub fn needs_host_tapped(&self) -> bool {
        matches!(self, Self::UntilUntaps)
    }

    pub fn needs_targeted_card_tapped(&self) -> bool {
        matches!(self, Self::UntilTargetedUntaps)
    }

    pub fn returns_on_host_leave(&self) -> bool {
        matches!(
            self,
            Self::UntilHostLeavesPlay | Self::UntilHostLeavesPlayOrEot | Self::UntilYourNextTurn
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReplaceDyingCondition {
    Kicked,
    Unsupported(String),
}

impl ReplaceDyingCondition {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "Kicked" => Self::Kicked,
            other => Self::Unsupported(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TriggerCondition {
    Evolve,
    LifePaid,
    NoOpponentHasMoreLifeThanAttacked,
    Sacrificed,
    AttackedPlayerWithMostLife,
    AttackerHasUnattackedOpp,
    Unsupported(String),
}

impl TriggerCondition {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "Evolve" => Self::Evolve,
            "LifePaid" => Self::LifePaid,
            "NoOpponentHasMoreLifeThanAttacked" => Self::NoOpponentHasMoreLifeThanAttacked,
            "Sacrificed" => Self::Sacrificed,
            "AttackedPlayerWithMostLife" => Self::AttackedPlayerWithMostLife,
            "AttackerHasUnattackedOpp" => Self::AttackerHasUnattackedOpp,
            other => Self::Unsupported(other.to_string()),
        }
    }
}
