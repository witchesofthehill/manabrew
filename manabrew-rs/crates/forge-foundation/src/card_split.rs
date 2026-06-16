use serde::{Deserialize, Serialize};

/// How a split/transform/modal card selects which face to show.
/// Mirrors Java `CardSplitType.FaceSelectionMethod`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FaceSelectionMethod {
    UseActiveFace,
    UsePrimaryFace,
    Combine,
}

/// The type of split/transform/modal card.
/// Mirrors Java `CardSplitType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CardSplitType {
    None,
    Transform,
    Meld,
    Split,
    Flip,
    Adventure,
    Omen,
    Modal,
    Specialize,
}

impl CardSplitType {
    pub fn aggregation_method(self) -> FaceSelectionMethod {
        match self {
            Self::None => FaceSelectionMethod::UsePrimaryFace,
            Self::Transform => FaceSelectionMethod::UseActiveFace,
            Self::Meld => FaceSelectionMethod::UseActiveFace,
            Self::Split => FaceSelectionMethod::Combine,
            Self::Flip => FaceSelectionMethod::UsePrimaryFace,
            Self::Adventure => FaceSelectionMethod::UsePrimaryFace,
            Self::Omen => FaceSelectionMethod::UsePrimaryFace,
            Self::Modal => FaceSelectionMethod::UseActiveFace,
            Self::Specialize => FaceSelectionMethod::UseActiveFace,
        }
    }

    pub fn changed_state_name(self) -> Option<CardStateName> {
        match self {
            Self::None => None,
            Self::Transform => Some(CardStateName::Backside),
            Self::Meld => Some(CardStateName::Meld),
            Self::Split => Some(CardStateName::RightSplit),
            Self::Flip => Some(CardStateName::Flipped),
            Self::Adventure => Some(CardStateName::Secondary),
            Self::Omen => Some(CardStateName::Secondary),
            Self::Modal => Some(CardStateName::Backside),
            Self::Specialize => None,
        }
    }

    pub fn is_dual_faced(self) -> bool {
        matches!(self, Self::Transform | Self::Meld | Self::Modal)
    }

    pub fn from_str_compat(s: &str) -> Option<Self> {
        match s {
            "None" => Some(Self::None),
            "Transform" | "DoubleFaced" => Some(Self::Transform),
            "Meld" => Some(Self::Meld),
            "Split" => Some(Self::Split),
            "Flip" => Some(Self::Flip),
            "Adventure" => Some(Self::Adventure),
            "Omen" => Some(Self::Omen),
            "Modal" => Some(Self::Modal),
            "Specialize" => Some(Self::Specialize),
            _ => None,
        }
    }
}

impl Default for CardSplitType {
    fn default() -> Self {
        Self::None
    }
}

/// Which face/state a card is currently showing.
/// Mirrors Java `CardStateName`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CardStateName {
    Original,
    FaceDown,
    Flipped,
    Backside,
    Meld,
    LeftSplit,
    RightSplit,
    Secondary,
    EmptyRoom,
    SpecializeW,
    SpecializeU,
    SpecializeB,
    SpecializeR,
    SpecializeG,
}

impl CardStateName {
    pub fn from_str_compat(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.eq_ignore_ascii_case("All") {
            return None;
        }
        match s {
            "Original" => Some(Self::Original),
            "FaceDown" => Some(Self::FaceDown),
            "Flipped" | "Flip" => Some(Self::Flipped),
            "Backside" | "DoubleFaced" => Some(Self::Backside),
            "Meld" => Some(Self::Meld),
            "LeftSplit" => Some(Self::LeftSplit),
            "RightSplit" => Some(Self::RightSplit),
            "Secondary" => Some(Self::Secondary),
            "EmptyRoom" => Some(Self::EmptyRoom),
            "SpecializeW" => Some(Self::SpecializeW),
            "SpecializeU" => Some(Self::SpecializeU),
            "SpecializeB" => Some(Self::SpecializeB),
            "SpecializeR" => Some(Self::SpecializeR),
            "SpecializeG" => Some(Self::SpecializeG),
            _ => {
                // Case-insensitive fallback
                let lower = s.to_ascii_lowercase();
                match lower.as_str() {
                    "original" => Some(Self::Original),
                    "facedown" => Some(Self::FaceDown),
                    "flipped" | "flip" => Some(Self::Flipped),
                    "backside" | "doublefaced" => Some(Self::Backside),
                    "meld" => Some(Self::Meld),
                    "leftsplit" => Some(Self::LeftSplit),
                    "rightsplit" => Some(Self::RightSplit),
                    "secondary" => Some(Self::Secondary),
                    "emptyroom" => Some(Self::EmptyRoom),
                    "specializew" => Some(Self::SpecializeW),
                    "specializeu" => Some(Self::SpecializeU),
                    "specializeb" => Some(Self::SpecializeB),
                    "specializer" => Some(Self::SpecializeR),
                    "specializeg" => Some(Self::SpecializeG),
                    _ => None,
                }
            }
        }
    }
}

impl Default for CardStateName {
    fn default() -> Self {
        Self::Original
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_type_compat() {
        assert_eq!(
            CardSplitType::from_str_compat("DoubleFaced"),
            Some(CardSplitType::Transform)
        );
        assert_eq!(
            CardSplitType::from_str_compat("Transform"),
            Some(CardSplitType::Transform)
        );
    }

    #[test]
    fn state_name_compat() {
        assert_eq!(
            CardStateName::from_str_compat("Flip"),
            Some(CardStateName::Flipped)
        );
        assert_eq!(
            CardStateName::from_str_compat("DoubleFaced"),
            Some(CardStateName::Backside)
        );
        assert_eq!(CardStateName::from_str_compat("All"), None);
    }

    #[test]
    fn dual_faced() {
        assert!(CardSplitType::Transform.is_dual_faced());
        assert!(CardSplitType::Modal.is_dual_faced());
        assert!(!CardSplitType::Split.is_dual_faced());
        assert!(!CardSplitType::None.is_dual_faced());
    }
}
