use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Core card types in MTG. Mirrors Java `CardType.CoreType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum CoreType {
    Kindred,
    Artifact,
    Battle,
    Conspiracy,
    Creature,
    Dungeon,
    Enchantment,
    Instant,
    Land,
    Phenomenon,
    Plane,
    Planeswalker,
    Scheme,
    Sorcery,
    Vanguard,
}

impl CoreType {
    pub const ALL: [CoreType; 15] = [
        CoreType::Kindred,
        CoreType::Artifact,
        CoreType::Battle,
        CoreType::Conspiracy,
        CoreType::Creature,
        CoreType::Dungeon,
        CoreType::Enchantment,
        CoreType::Instant,
        CoreType::Land,
        CoreType::Phenomenon,
        CoreType::Plane,
        CoreType::Planeswalker,
        CoreType::Scheme,
        CoreType::Sorcery,
        CoreType::Vanguard,
    ];

    pub fn is_permanent(self) -> bool {
        matches!(
            self,
            CoreType::Artifact
                | CoreType::Battle
                | CoreType::Creature
                | CoreType::Enchantment
                | CoreType::Land
                | CoreType::Planeswalker
        )
    }

    pub fn name(self) -> &'static str {
        match self {
            CoreType::Kindred => "Kindred",
            CoreType::Artifact => "Artifact",
            CoreType::Battle => "Battle",
            CoreType::Conspiracy => "Conspiracy",
            CoreType::Creature => "Creature",
            CoreType::Dungeon => "Dungeon",
            CoreType::Enchantment => "Enchantment",
            CoreType::Instant => "Instant",
            CoreType::Land => "Land",
            CoreType::Phenomenon => "Phenomenon",
            CoreType::Plane => "Plane",
            CoreType::Planeswalker => "Planeswalker",
            CoreType::Scheme => "Scheme",
            CoreType::Sorcery => "Sorcery",
            CoreType::Vanguard => "Vanguard",
        }
    }

    pub fn from_name(s: &str) -> Option<CoreType> {
        match s {
            "Kindred" => Some(CoreType::Kindred),
            "Artifact" => Some(CoreType::Artifact),
            "Battle" => Some(CoreType::Battle),
            "Conspiracy" => Some(CoreType::Conspiracy),
            "Creature" => Some(CoreType::Creature),
            "Dungeon" => Some(CoreType::Dungeon),
            "Enchantment" => Some(CoreType::Enchantment),
            "Instant" => Some(CoreType::Instant),
            "Land" => Some(CoreType::Land),
            "Phenomenon" => Some(CoreType::Phenomenon),
            "Plane" => Some(CoreType::Plane),
            "Planeswalker" => Some(CoreType::Planeswalker),
            "Scheme" => Some(CoreType::Scheme),
            "Sorcery" => Some(CoreType::Sorcery),
            "Vanguard" => Some(CoreType::Vanguard),
            _ => None,
        }
    }
}

impl std::fmt::Display for CoreType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// Supertypes in MTG. Mirrors Java `CardType.Supertype`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Supertype {
    Basic,
    Elite,
    Host,
    Legendary,
    Snow,
    Ongoing,
    World,
}

impl Supertype {
    pub fn name(self) -> &'static str {
        match self {
            Supertype::Basic => "Basic",
            Supertype::Elite => "Elite",
            Supertype::Host => "Host",
            Supertype::Legendary => "Legendary",
            Supertype::Snow => "Snow",
            Supertype::Ongoing => "Ongoing",
            Supertype::World => "World",
        }
    }

    pub fn from_name(s: &str) -> Option<Supertype> {
        match s {
            "Basic" => Some(Supertype::Basic),
            "Elite" => Some(Supertype::Elite),
            "Host" => Some(Supertype::Host),
            "Legendary" => Some(Supertype::Legendary),
            "Snow" => Some(Supertype::Snow),
            "Ongoing" => Some(Supertype::Ongoing),
            "World" => Some(Supertype::World),
            _ => None,
        }
    }
}

impl std::fmt::Display for Supertype {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// A parsed type line (supertypes + core types + subtypes).
/// e.g. "Legendary Creature - Human Wizard"
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardTypeLine {
    pub supertypes: BTreeSet<Supertype>,
    pub core_types: BTreeSet<CoreType>,
    pub subtypes: Vec<String>,
}

impl CardTypeLine {
    pub fn new() -> Self {
        CardTypeLine {
            supertypes: BTreeSet::new(),
            core_types: BTreeSet::new(),
            subtypes: Vec::new(),
        }
    }

    /// Parse a type line string like "Legendary Creature - Human Wizard".
    /// The dash separates supertypes+core types from subtypes.
    pub fn parse(s: &str) -> Self {
        let mut result = Self::new();
        if s.is_empty() {
            return result;
        }

        // Split on " - " or " — " (em-dash)
        let (before_dash, after_dash) = if let Some(idx) = s.find(" - ") {
            (&s[..idx], Some(&s[idx + 3..]))
        } else if let Some(idx) = s.find(" \u{2014} ") {
            (&s[..idx], Some(&s[idx + 4..]))
        } else {
            (s, None)
        };

        // Parse supertypes, core types, and subtypes.
        // In MTG type lines WITHOUT a dash (e.g. "Land Forest Island"),
        // words that are not supertypes or core types are subtypes.
        // This handles shock lands, tribal lands, etc.
        for word in before_dash.split_whitespace() {
            if let Some(st) = Supertype::from_name(word) {
                result.supertypes.insert(st);
            } else if let Some(ct) = CoreType::from_name(word) {
                result.core_types.insert(ct);
            } else if after_dash.is_none() {
                // No dash in the type line — unrecognized words are subtypes
                result.subtypes.push(word.to_string());
            }
        }

        // Parse subtypes
        if let Some(sub_str) = after_dash {
            for word in sub_str.split_whitespace() {
                if !word.is_empty() {
                    result.subtypes.push(word.to_string());
                }
            }
        }

        result
    }

    pub fn is_permanent(&self) -> bool {
        self.core_types.iter().any(|ct| ct.is_permanent())
    }

    pub fn is_creature(&self) -> bool {
        self.core_types.contains(&CoreType::Creature)
    }

    pub fn is_land(&self) -> bool {
        self.core_types.contains(&CoreType::Land)
    }

    pub fn is_instant(&self) -> bool {
        self.core_types.contains(&CoreType::Instant)
    }

    pub fn is_sorcery(&self) -> bool {
        self.core_types.contains(&CoreType::Sorcery)
    }

    pub fn is_artifact(&self) -> bool {
        self.core_types.contains(&CoreType::Artifact)
    }

    pub fn is_enchantment(&self) -> bool {
        self.core_types.contains(&CoreType::Enchantment)
    }

    pub fn is_planeswalker(&self) -> bool {
        self.core_types.contains(&CoreType::Planeswalker)
    }

    pub fn is_basic(&self) -> bool {
        self.supertypes.contains(&Supertype::Basic)
    }

    pub fn is_legendary(&self) -> bool {
        self.supertypes.contains(&Supertype::Legendary)
    }

    pub fn is_snow(&self) -> bool {
        self.supertypes.contains(&Supertype::Snow)
    }

    pub fn has_subtype(&self, subtype: &str) -> bool {
        self.subtypes
            .iter()
            .any(|s| s.eq_ignore_ascii_case(subtype))
    }

    pub fn add_type(&mut self, t: &str) {
        if let Some(st) = Supertype::from_name(t) {
            self.supertypes.insert(st);
        } else if let Some(ct) = CoreType::from_name(t) {
            self.core_types.insert(ct);
        } else if !self.subtypes.iter().any(|s| s == t) {
            self.subtypes.push(t.to_string());
        }
    }
}

impl Default for CardTypeLine {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for CardTypeLine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut parts = Vec::new();
        for st in &self.supertypes {
            parts.push(st.name().to_string());
        }
        for ct in &self.core_types {
            parts.push(ct.name().to_string());
        }

        write!(f, "{}", parts.join(" "))?;

        if !self.subtypes.is_empty() {
            write!(f, " - {}", self.subtypes.join(" "))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_creature_type() {
        let tl = CardTypeLine::parse("Legendary Creature - Human Wizard");
        assert!(tl.is_legendary());
        assert!(tl.is_creature());
        assert!(tl.has_subtype("Human"));
        assert!(tl.has_subtype("Wizard"));
        assert!(tl.is_permanent());
    }

    #[test]
    fn parse_instant() {
        let tl = CardTypeLine::parse("Instant");
        assert!(tl.is_instant());
        assert!(!tl.is_permanent());
        assert!(tl.subtypes.is_empty());
    }

    #[test]
    fn parse_basic_land() {
        let tl = CardTypeLine::parse("Basic Land - Mountain");
        assert!(tl.is_basic());
        assert!(tl.is_land());
        assert!(tl.has_subtype("Mountain"));
    }

    #[test]
    fn core_type_from_name() {
        assert_eq!(CoreType::from_name("Creature"), Some(CoreType::Creature));
        assert_eq!(CoreType::from_name("Blah"), None);
    }

    #[test]
    fn display_type_line() {
        let tl = CardTypeLine::parse("Legendary Creature - Human Wizard");
        assert_eq!(format!("{}", tl), "Legendary Creature - Human Wizard");
    }
}
