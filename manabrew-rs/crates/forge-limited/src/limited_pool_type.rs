use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum LimitedPoolType {
    Full,
    Block,
    Prerelease,
    FantasyBlock,
    Custom,
    Chaos,
    Import,
}

impl LimitedPoolType {
    pub const ALL: [Self; 7] = [
        Self::Full,
        Self::Block,
        Self::Prerelease,
        Self::FantasyBlock,
        Self::Custom,
        Self::Chaos,
        Self::Import,
    ];

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Full => "Full",
            Self::Block => "Block",
            Self::Prerelease => "Prerelease",
            Self::FantasyBlock => "Fantasy Block",
            Self::Custom => "Custom (Cube)",
            Self::Chaos => "Chaos",
            Self::Import => "Import",
        }
    }

    pub fn is_draftable(self) -> bool {
        !matches!(self, Self::Prerelease)
    }
}
