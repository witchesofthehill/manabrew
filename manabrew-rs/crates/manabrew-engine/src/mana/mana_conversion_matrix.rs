use forge_foundation::mana::ManaAtom;

/// Ordered mana type array matching Java's ManaAtom.MANATYPES.
const MANA_TYPES: [u16; 6] = [
    ManaAtom::WHITE,
    ManaAtom::BLUE,
    ManaAtom::BLACK,
    ManaAtom::RED,
    ManaAtom::GREEN,
    ManaAtom::COLORLESS,
];

/// Identity matrix: each color maps to itself.
const IDENTITY: [u8; 6] = [
    ManaAtom::WHITE as u8,
    ManaAtom::BLUE as u8,
    ManaAtom::BLACK as u8,
    ManaAtom::RED as u8,
    ManaAtom::GREEN as u8,
    ManaAtom::COLORLESS as u8,
];

/// Mana conversion/restriction matrix controlling what colors can pay for what.
///
/// Mirrors Java's `forge.game.mana.ManaConversionMatrix`.
///
/// The conversion matrix ORs byte values to make mana more payable (additive).
/// The restriction matrix ANDs byte values to make mana less payable (restrictive).
#[derive(Debug, Clone)]
pub struct ManaConversionMatrix {
    /// Conversion matrix: OR-ed values broaden what each color can pay for.
    color_conversion_matrix: [u8; 6],
    /// Restriction matrix: AND-ed values narrow what each color can pay for.
    color_restriction_matrix: [u8; 6],
    /// Whether snow mana can substitute for colored mana.
    snow_for_color: bool,
}

impl Default for ManaConversionMatrix {
    fn default() -> Self {
        let mut m = Self {
            color_conversion_matrix: [0; 6],
            color_restriction_matrix: [0xFF; 6],
            snow_for_color: false,
        };
        m.restore_color_replacements();
        m
    }
}

impl ManaConversionMatrix {
    /// Create a new matrix with identity conversion and no restrictions.
    /// Mirrors Java's constructor which calls `restoreColorReplacements()`.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the effective color uses for a given color after applying conversion and restriction.
    /// Mirrors Java's `ManaConversionMatrix.getPossibleColorUses()`.
    pub fn get_possible_color_uses(&self, color: u8) -> u8 {
        let idx = get_index_of_first_mana_type(color);
        let matrix_idx = if idx < 0 { 5 } else { idx as usize };
        self.color_conversion_matrix[matrix_idx] & self.color_restriction_matrix[matrix_idx]
    }

    /// Adjust color replacement: additive ORs into conversion, restrictive ANDs into restriction.
    /// Mirrors Java's `ManaConversionMatrix.adjustColorReplacement()`.
    pub fn adjust_color_replacement(&mut self, original: u8, replacement: u8, additive: bool) {
        let row_idx = get_index_of_first_mana_type(original);
        let idx = if row_idx < 0 { 5 } else { row_idx as usize };
        if additive {
            self.color_conversion_matrix[idx] |= replacement;
        } else {
            self.color_restriction_matrix[idx] &= replacement;
        }
    }

    /// Merge another matrix into this one: OR conversion, AND restriction.
    /// Mirrors Java's `ManaConversionMatrix.applyCardMatrix()`.
    pub fn apply_card_matrix(&mut self, other: &ManaConversionMatrix) {
        for i in 0..6 {
            self.color_conversion_matrix[i] |= other.color_conversion_matrix[i];
        }
        for i in 0..6 {
            self.color_restriction_matrix[i] &= other.color_restriction_matrix[i];
        }
        self.snow_for_color = other.snow_for_color;
    }

    /// Reset to identity: each color pays only itself, no restrictions.
    /// Mirrors Java's `ManaConversionMatrix.restoreColorReplacements()`.
    pub fn restore_color_replacements(&mut self) {
        self.color_conversion_matrix = IDENTITY;
        self.color_restriction_matrix = [ManaAtom::ALL_MANA_TYPES as u8; 6];
        self.snow_for_color = false;
    }

    /// Whether snow mana can substitute for colored mana.
    /// Mirrors Java's `ManaConversionMatrix.isSnowForColor()`.
    pub fn is_snow_for_color(&self) -> bool {
        self.snow_for_color
    }

    /// Set whether snow mana can substitute for colored mana.
    /// Mirrors Java's `ManaConversionMatrix.setSnowForColor()`.
    pub fn set_snow_for_color(&mut self, value: bool) {
        self.snow_for_color = value;
    }
}

/// Find the index into MANA_TYPES for the given color bitmask.
/// Returns -1 if not found (mirrors Java's `ManaAtom.getIndexOfFirstManaType()`).
fn get_index_of_first_mana_type(color: u8) -> i32 {
    for (i, &mt) in MANA_TYPES.iter().enumerate() {
        if (color as u16 & mt) != 0 {
            return i as i32;
        }
    }
    -1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_matrix_maps_each_color_to_itself() {
        let m = ManaConversionMatrix::new();
        assert_eq!(
            m.get_possible_color_uses(ManaAtom::WHITE as u8),
            ManaAtom::WHITE as u8
        );
        assert_eq!(
            m.get_possible_color_uses(ManaAtom::BLUE as u8),
            ManaAtom::BLUE as u8
        );
        assert_eq!(
            m.get_possible_color_uses(ManaAtom::COLORLESS as u8),
            ManaAtom::COLORLESS as u8
        );
    }

    #[test]
    fn additive_replacement_broadens_uses() {
        let mut m = ManaConversionMatrix::new();
        m.adjust_color_replacement(ManaAtom::WHITE as u8, ManaAtom::BLUE as u8, true);
        let uses = m.get_possible_color_uses(ManaAtom::WHITE as u8);
        assert_ne!(uses & ManaAtom::WHITE as u8, 0);
        assert_ne!(uses & ManaAtom::BLUE as u8, 0);
    }

    #[test]
    fn restrictive_replacement_narrows_uses() {
        let mut m = ManaConversionMatrix::new();
        // Restrict WHITE to only pay for WHITE (no other bits set after AND)
        m.adjust_color_replacement(ManaAtom::WHITE as u8, ManaAtom::WHITE as u8, false);
        let uses = m.get_possible_color_uses(ManaAtom::WHITE as u8);
        assert_eq!(uses, ManaAtom::WHITE as u8);
    }

    #[test]
    fn restore_resets_matrix() {
        let mut m = ManaConversionMatrix::new();
        m.adjust_color_replacement(ManaAtom::RED as u8, ManaAtom::GREEN as u8, true);
        m.restore_color_replacements();
        let uses = m.get_possible_color_uses(ManaAtom::RED as u8);
        assert_eq!(uses, ManaAtom::RED as u8);
    }
}
