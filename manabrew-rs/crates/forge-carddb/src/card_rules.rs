use forge_foundation::{CardSplitType, ColorSet, ManaCost};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::card_face::CardFace;

/// Complete card definition with all faces. Mirrors Java `CardRules`.
/// This is the immutable definition loaded from a script file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardRules {
    pub split_type: CardSplitType,
    pub main_part: CardFace,
    pub other_part: Option<CardFace>,
    pub specialized_parts: HashMap<String, CardFace>,
    pub color_identity: ColorSet,
    pub normalized_name: String,
    pub meld_with: Option<String>,
    pub partner_with: Option<String>,
}

impl CardRules {
    pub fn name(&self) -> String {
        match self.split_type.aggregation_method() {
            forge_foundation::FaceSelectionMethod::Combine => {
                if let Some(ref other) = self.other_part {
                    format!("{} // {}", self.main_part.name, other.name)
                } else {
                    self.main_part.name.clone()
                }
            }
            _ => self.main_part.name.clone(),
        }
    }

    pub fn mana_cost(&self) -> ManaCost {
        match self.split_type.aggregation_method() {
            forge_foundation::FaceSelectionMethod::Combine => {
                if let Some(ref other) = self.other_part {
                    ManaCost::combine(&self.main_part.mana_cost, &other.mana_cost)
                } else {
                    self.main_part.mana_cost.clone()
                }
            }
            _ => self.main_part.mana_cost.clone(),
        }
    }

    pub fn color(&self) -> ColorSet {
        match self.split_type.aggregation_method() {
            forge_foundation::FaceSelectionMethod::Combine => {
                let c1 = self.main_part.resolved_color();
                if let Some(ref other) = self.other_part {
                    c1.union(other.resolved_color())
                } else {
                    c1
                }
            }
            _ => self.main_part.resolved_color(),
        }
    }

    pub fn cmc(&self) -> i32 {
        self.mana_cost().cmc()
    }

    /// Calculate color identity from face colors + mana symbols in oracle text.
    pub(crate) fn calculate_color_identity(face: &CardFace) -> u8 {
        let mut mask = face.resolved_color().mask();

        // Check static abilities for characteristic-defining "SetColor$ All"
        for sa in &face.static_abilities {
            if sa.contains("CharacteristicDefining$ True") && sa.contains("SetColor$ All") {
                return 0b11111; // all colors
            }
        }

        if mask == 0b11111 {
            return mask;
        }

        // Scan oracle text for mana symbols {W}, {U}, {B}, {R}, {G}
        let oracle = &face.oracle_text;
        let mut in_reminder = false;
        let mut in_symbol = false;
        let bytes = oracle.as_bytes();
        let len = bytes.len();
        let mut i = 0;

        while i < len {
            match bytes[i] {
                b'(' if i > 0 => in_reminder = true,
                b')' => in_reminder = false,
                b'{' => in_symbol = true,
                b'}' => in_symbol = false,
                c if in_symbol && !in_reminder => match c {
                    b'W' => mask |= 1,
                    b'U' => mask |= 2,
                    b'B' => mask |= 4,
                    b'R' => mask |= 8,
                    b'G' => mask |= 16,
                    _ => {}
                },
                _ => {}
            }
            i += 1;
        }

        mask
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_identity_basic() {
        let mut face = CardFace::new("Lightning Bolt".to_string());
        face.mana_cost = ManaCost::parse("R");
        face.oracle_text = "Lightning Bolt deals 3 damage to any target.".to_string();
        face.assign_missing_fields();

        let ci = CardRules::calculate_color_identity(&face);
        assert_eq!(ci, 8); // Red only
    }

    #[test]
    fn color_identity_with_symbols() {
        let mut face = CardFace::new("Test".to_string());
        face.mana_cost = ManaCost::parse("1 R");
        face.oracle_text = "Add {G} or {W}.".to_string();
        face.assign_missing_fields();

        let ci = CardRules::calculate_color_identity(&face);
        assert!(ci & 8 != 0); // Red from cost
        assert!(ci & 16 != 0); // Green from oracle
        assert!(ci & 1 != 0); // White from oracle
    }
}
