use serde::{Deserialize, Serialize};

/// Typed index into the card arena. Not a reference — just an index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct CardId(pub u32);

/// Typed index into the player arena.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct PlayerId(pub u32);

impl CardId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

impl PlayerId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

impl std::fmt::Display for CardId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Card#{}", self.0)
    }
}

impl std::fmt::Display for PlayerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Player#{}", self.0)
    }
}
