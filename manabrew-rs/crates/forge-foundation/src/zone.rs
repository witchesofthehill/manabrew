use serde::{Deserialize, Serialize};

/// Game zones. Mirrors Java `ZoneType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ZoneType {
    Hand,
    Library,
    Graveyard,
    Battlefield,
    Exile,
    Flashback,
    Command,
    Stack,
    Sideboard,
    Ante,
    Merged,
    SchemeDeck,
    PlanarDeck,
    AttractionDeck,
    Junkyard,
    ContraptionDeck,
    Subgame,
    ExtraHand,
    None,
}

impl ZoneType {
    /// Whether this zone holds hidden information (cards not visible to opponents).
    pub fn is_hidden(self) -> bool {
        matches!(
            self,
            ZoneType::Hand
                | ZoneType::Library
                | ZoneType::Sideboard
                | ZoneType::SchemeDeck
                | ZoneType::PlanarDeck
                | ZoneType::AttractionDeck
                | ZoneType::ContraptionDeck
                | ZoneType::Subgame
                | ZoneType::ExtraHand
                | ZoneType::None
        )
    }

    pub fn is_known(self) -> bool {
        !self.is_hidden()
    }

    pub fn is_deck(self) -> bool {
        matches!(
            self,
            ZoneType::Library
                | ZoneType::SchemeDeck
                | ZoneType::PlanarDeck
                | ZoneType::AttractionDeck
                | ZoneType::ContraptionDeck
        )
    }

    pub fn is_part_of_command_zone(self) -> bool {
        matches!(
            self,
            ZoneType::Command
                | ZoneType::SchemeDeck
                | ZoneType::PlanarDeck
                | ZoneType::AttractionDeck
                | ZoneType::ContraptionDeck
                | ZoneType::Junkyard
        )
    }

    /// Zones that can host static abilities in Forge runtime checks.
    /// Mirrors Java's `ZoneType.STATIC_ABILITIES_SOURCE_ZONES` usage.
    pub fn is_static_ability_source(self) -> bool {
        matches!(self, ZoneType::Battlefield | ZoneType::Command)
    }

    pub fn from_str_compat(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.eq_ignore_ascii_case("All") {
            return None;
        }
        match s {
            "Hand" => Some(ZoneType::Hand),
            "Library" => Some(ZoneType::Library),
            "Graveyard" => Some(ZoneType::Graveyard),
            "Battlefield" => Some(ZoneType::Battlefield),
            "Exile" => Some(ZoneType::Exile),
            "Flashback" => Some(ZoneType::Flashback),
            "Command" => Some(ZoneType::Command),
            "Stack" => Some(ZoneType::Stack),
            "Sideboard" => Some(ZoneType::Sideboard),
            "Ante" => Some(ZoneType::Ante),
            "Merged" => Some(ZoneType::Merged),
            "SchemeDeck" => Some(ZoneType::SchemeDeck),
            "PlanarDeck" => Some(ZoneType::PlanarDeck),
            "AttractionDeck" => Some(ZoneType::AttractionDeck),
            "Junkyard" => Some(ZoneType::Junkyard),
            "ContraptionDeck" => Some(ZoneType::ContraptionDeck),
            "Subgame" => Some(ZoneType::Subgame),
            "ExtraHand" => Some(ZoneType::ExtraHand),
            "None" => Some(ZoneType::None),
            _ => {
                // Case-insensitive fallback
                for zt in Self::ALL.iter() {
                    if format!("{:?}", zt).eq_ignore_ascii_case(s) {
                        return Some(*zt);
                    }
                }
                None
            }
        }
    }

    pub const ALL: [ZoneType; 19] = [
        ZoneType::Hand,
        ZoneType::Library,
        ZoneType::Graveyard,
        ZoneType::Battlefield,
        ZoneType::Exile,
        ZoneType::Flashback,
        ZoneType::Command,
        ZoneType::Stack,
        ZoneType::Sideboard,
        ZoneType::Ante,
        ZoneType::Merged,
        ZoneType::SchemeDeck,
        ZoneType::PlanarDeck,
        ZoneType::AttractionDeck,
        ZoneType::Junkyard,
        ZoneType::ContraptionDeck,
        ZoneType::Subgame,
        ZoneType::ExtraHand,
        ZoneType::None,
    ];
}

impl std::fmt::Display for ZoneType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_hidden() {
        assert!(ZoneType::Hand.is_hidden());
        assert!(ZoneType::Library.is_hidden());
        assert!(!ZoneType::Graveyard.is_hidden());
        assert!(!ZoneType::Battlefield.is_hidden());
    }

    #[test]
    fn zone_from_str() {
        assert_eq!(
            ZoneType::from_str_compat("Battlefield"),
            Some(ZoneType::Battlefield)
        );
        assert_eq!(ZoneType::from_str_compat("All"), None);
    }
}
