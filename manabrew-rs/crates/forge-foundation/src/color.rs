use serde::{Deserialize, Serialize};

/// Individual MTG colors, matching Java MagicColor byte constants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Color {
    White = 1,
    Blue = 2,
    Black = 4,
    Red = 8,
    Green = 16,
}

impl Color {
    pub const ALL: [Color; 5] = [
        Color::White,
        Color::Blue,
        Color::Black,
        Color::Red,
        Color::Green,
    ];

    pub fn short_name(self) -> &'static str {
        match self {
            Color::White => "W",
            Color::Blue => "U",
            Color::Black => "B",
            Color::Red => "R",
            Color::Green => "G",
        }
    }

    pub fn long_name(self) -> &'static str {
        match self {
            Color::White => "white",
            Color::Blue => "blue",
            Color::Black => "black",
            Color::Red => "red",
            Color::Green => "green",
        }
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Color::White => "{W}",
            Color::Blue => "{U}",
            Color::Black => "{B}",
            Color::Red => "{R}",
            Color::Green => "{G}",
        }
    }

    pub fn basic_land_type(self) -> &'static str {
        match self {
            Color::White => "Plains",
            Color::Blue => "Island",
            Color::Black => "Swamp",
            Color::Red => "Mountain",
            Color::Green => "Forest",
        }
    }

    pub fn mask(self) -> u8 {
        self as u8
    }

    pub fn from_char(c: char) -> Option<Color> {
        match c.to_ascii_uppercase() {
            'W' => Some(Color::White),
            'U' => Some(Color::Blue),
            'B' => Some(Color::Black),
            'R' => Some(Color::Red),
            'G' => Some(Color::Green),
            _ => None,
        }
    }

    pub fn from_name(s: &str) -> Option<Color> {
        if s.len() == 1 {
            return Color::from_char(s.as_bytes()[0] as char);
        }
        match s.to_ascii_lowercase().as_str() {
            "white" => Some(Color::White),
            "blue" => Some(Color::Blue),
            "black" => Some(Color::Black),
            "red" => Some(Color::Red),
            "green" => Some(Color::Green),
            _ => None,
        }
    }
}

/// A set of 0-5 colors, stored as a u8 bitmask. All 32 combinations are valid.
/// Mirrors Java `ColorSet` — the ordinal IS the bitmask.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub struct ColorSet(u8);

impl ColorSet {
    pub const COLORLESS: ColorSet = ColorSet(0);
    pub const WHITE: ColorSet = ColorSet(1);
    pub const BLUE: ColorSet = ColorSet(2);
    pub const BLACK: ColorSet = ColorSet(4);
    pub const RED: ColorSet = ColorSet(8);
    pub const GREEN: ColorSet = ColorSet(16);
    pub const ALL_COLORS: ColorSet = ColorSet(0b11111);

    pub fn from_mask(mask: u8) -> Self {
        ColorSet(mask & 0b11111)
    }

    pub fn mask(self) -> u8 {
        self.0
    }

    pub fn is_colorless(self) -> bool {
        self.0 == 0
    }

    pub fn is_multicolor(self) -> bool {
        self.count_colors() > 1
    }

    pub fn is_mono_color(self) -> bool {
        self.count_colors() == 1
    }

    pub fn count_colors(self) -> u32 {
        self.0.count_ones()
    }

    pub fn has_color(self, color: Color) -> bool {
        (self.0 & color.mask()) != 0
    }

    pub fn has_white(self) -> bool {
        self.has_color(Color::White)
    }
    pub fn has_blue(self) -> bool {
        self.has_color(Color::Blue)
    }
    pub fn has_black(self) -> bool {
        self.has_color(Color::Black)
    }
    pub fn has_red(self) -> bool {
        self.has_color(Color::Red)
    }
    pub fn has_green(self) -> bool {
        self.has_color(Color::Green)
    }

    pub fn has_any_color(self, mask: u8) -> bool {
        (self.0 & mask) != 0
    }

    pub fn has_all_colors(self, mask: u8) -> bool {
        (self.0 & mask) == mask
    }

    pub fn contains_all_colors_from(self, other: ColorSet) -> bool {
        (!self.0 & other.0) == 0
    }

    pub fn shares_color_with(self, other: ColorSet) -> bool {
        (self.0 & other.0) != 0
    }

    pub fn union(self, other: ColorSet) -> ColorSet {
        ColorSet(self.0 | other.0)
    }

    pub fn intersection(self, other: ColorSet) -> ColorSet {
        ColorSet(self.0 & other.0)
    }

    pub fn inverse(self) -> ColorSet {
        ColorSet(self.0 ^ 0b11111)
    }

    pub fn iter(self) -> impl Iterator<Item = Color> {
        Color::ALL.into_iter().filter(move |c| self.has_color(*c))
    }

    pub fn from_names(s: &str) -> Self {
        let mut mask = 0u8;
        for c in s.chars() {
            if let Some(color) = Color::from_char(c) {
                mask |= color.mask();
            }
        }
        if mask == 0 {
            // Try full name
            if let Some(color) = Color::from_name(s) {
                mask = color.mask();
            }
        }
        ColorSet(mask & 0b11111)
    }
}

impl std::fmt::Debug for ColorSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.is_colorless() {
            return write!(f, "ColorSet(C)");
        }
        write!(f, "ColorSet(")?;
        for c in self.iter() {
            write!(f, "{}", c.short_name())?;
        }
        write!(f, ")")
    }
}

impl std::fmt::Display for ColorSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.is_colorless() {
            return write!(f, "C");
        }
        for c in self.iter() {
            write!(f, "{}", c.short_name())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_masks() {
        assert_eq!(Color::White.mask(), 1);
        assert_eq!(Color::Blue.mask(), 2);
        assert_eq!(Color::Black.mask(), 4);
        assert_eq!(Color::Red.mask(), 8);
        assert_eq!(Color::Green.mask(), 16);
    }

    #[test]
    fn color_from_char() {
        assert_eq!(Color::from_char('W'), Some(Color::White));
        assert_eq!(Color::from_char('u'), Some(Color::Blue));
        assert_eq!(Color::from_char('X'), None);
    }

    #[test]
    fn colorset_basics() {
        let cs = ColorSet::from_mask(Color::White.mask() | Color::Blue.mask());
        assert!(cs.has_white());
        assert!(cs.has_blue());
        assert!(!cs.has_black());
        assert!(cs.is_multicolor());
        assert_eq!(cs.count_colors(), 2);
    }

    #[test]
    fn colorset_all_32_valid() {
        for i in 0..32u8 {
            let cs = ColorSet::from_mask(i);
            assert_eq!(cs.mask(), i);
        }
    }

    #[test]
    fn colorset_inverse() {
        let wu = ColorSet::from_mask(Color::White.mask() | Color::Blue.mask());
        let brg = wu.inverse();
        assert!(brg.has_black());
        assert!(brg.has_red());
        assert!(brg.has_green());
        assert!(!brg.has_white());
        assert!(!brg.has_blue());
    }
}
