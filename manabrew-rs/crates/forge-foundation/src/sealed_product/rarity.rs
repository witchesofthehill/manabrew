use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Mythic,
    Special,
    BasicLand,
    Token,
    Unknown,
}

impl Rarity {
    pub fn from_short(code: &str) -> Self {
        match code.trim() {
            "C" | "c" => Self::Common,
            "U" | "u" => Self::Uncommon,
            "R" | "r" => Self::Rare,
            "M" | "m" => Self::Mythic,
            "S" | "s" => Self::Special,
            "L" | "l" => Self::BasicLand,
            "T" | "t" => Self::Token,
            _ => Self::Unknown,
        }
    }

    pub fn short(self) -> &'static str {
        match self {
            Self::Common => "C",
            Self::Uncommon => "U",
            Self::Rare => "R",
            Self::Mythic => "M",
            Self::Special => "S",
            Self::BasicLand => "L",
            Self::Token => "T",
            Self::Unknown => "?",
        }
    }

    pub fn is_rare_or_mythic(self) -> bool {
        matches!(self, Self::Rare | Self::Mythic)
    }
}
