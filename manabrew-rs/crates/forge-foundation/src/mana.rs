use serde::{Deserialize, Serialize};

use crate::color::{Color, ColorSet};

/// Bitmask constants for mana atoms, matching Java `ManaAtom`.
/// Each bit represents a property of a mana symbol.
pub struct ManaAtom;

impl ManaAtom {
    pub const WHITE: u16 = 1;
    pub const BLUE: u16 = 2;
    pub const BLACK: u16 = 4;
    pub const RED: u16 = 8;
    pub const GREEN: u16 = 16;
    pub const COLORLESS: u16 = 32;
    pub const GENERIC: u16 = 64;
    pub const IS_X: u16 = 256;
    pub const OR_2_GENERIC: u16 = 512;
    pub const OR_2_LIFE: u16 = 1024;
    pub const IS_SNOW: u16 = 2048;

    pub const ALL_MANA_COLORS: u16 =
        Self::WHITE | Self::BLUE | Self::BLACK | Self::RED | Self::GREEN;
    pub const ALL_MANA_TYPES: u16 = Self::ALL_MANA_COLORS | Self::COLORLESS;
    pub const COLORS_SUPERPOSITION: u16 = Self::ALL_MANA_COLORS;

    /// Convert a color name (lowercase) to its atom bitmask.
    pub fn from_name(name: &str) -> u16 {
        match name {
            "white" | "w" => Self::WHITE,
            "blue" | "u" => Self::BLUE,
            "black" | "b" => Self::BLACK,
            "red" | "r" => Self::RED,
            "green" | "g" => Self::GREEN,
            "colorless" | "c" => Self::COLORLESS,
            _ => 0,
        }
    }

    pub fn from_char(c: char) -> u16 {
        match c.to_ascii_uppercase() {
            'W' => Self::WHITE,
            'U' => Self::BLUE,
            'B' => Self::BLACK,
            'R' => Self::RED,
            'G' => Self::GREEN,
            'C' => Self::COLORLESS,
            'P' => Self::OR_2_LIFE,
            'S' => Self::IS_SNOW,
            'X' => Self::IS_X,
            '2' => Self::OR_2_GENERIC,
            c if c.is_ascii_digit() => Self::GENERIC,
            _ => 0,
        }
    }
}

/// Individual mana cost shard (one symbol in a mana cost).
/// Mirrors Java `ManaCostShard`. Each variant stores its atom bitmask and display string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ManaCostShard {
    // Pure colors
    White,
    Blue,
    Black,
    Red,
    Green,
    Colorless,
    // Hybrid
    WhiteBlue,
    WhiteBlack,
    BlueBlack,
    BlueRed,
    BlackRed,
    BlackGreen,
    RedWhite,
    RedGreen,
    GreenWhite,
    GreenBlue,
    // Or 2 generic
    White2,
    Blue2,
    Black2,
    Red2,
    Green2,
    // Or Colorless hybrid
    ColorlessWhite,
    ColorlessBlue,
    ColorlessBlack,
    ColorlessRed,
    ColorlessGreen,
    // Snow
    Snow,
    // Generic (value 1)
    Generic,
    // Phyrexian
    WhitePhyrexian,
    BluePhyrexian,
    BlackPhyrexian,
    RedPhyrexian,
    GreenPhyrexian,
    // Hybrid Phyrexian
    BlackGreenPhyrexian,
    BlackRedPhyrexian,
    GreenBluePhyrexian,
    GreenWhitePhyrexian,
    RedGreenPhyrexian,
    RedWhitePhyrexian,
    BlueBlackPhyrexian,
    BlueRedPhyrexian,
    WhiteBlackPhyrexian,
    WhiteBluePhyrexian,
    // X
    X,
    // Colored X (Emblazoned Golem)
    ColoredX,
}

impl ManaCostShard {
    pub fn shard(self) -> u16 {
        match self {
            Self::White => ManaAtom::WHITE,
            Self::Blue => ManaAtom::BLUE,
            Self::Black => ManaAtom::BLACK,
            Self::Red => ManaAtom::RED,
            Self::Green => ManaAtom::GREEN,
            Self::Colorless => ManaAtom::COLORLESS,
            Self::WhiteBlue => ManaAtom::WHITE | ManaAtom::BLUE,
            Self::WhiteBlack => ManaAtom::WHITE | ManaAtom::BLACK,
            Self::BlueBlack => ManaAtom::BLUE | ManaAtom::BLACK,
            Self::BlueRed => ManaAtom::BLUE | ManaAtom::RED,
            Self::BlackRed => ManaAtom::BLACK | ManaAtom::RED,
            Self::BlackGreen => ManaAtom::BLACK | ManaAtom::GREEN,
            Self::RedWhite => ManaAtom::RED | ManaAtom::WHITE,
            Self::RedGreen => ManaAtom::RED | ManaAtom::GREEN,
            Self::GreenWhite => ManaAtom::GREEN | ManaAtom::WHITE,
            Self::GreenBlue => ManaAtom::GREEN | ManaAtom::BLUE,
            Self::White2 => ManaAtom::WHITE | ManaAtom::OR_2_GENERIC,
            Self::Blue2 => ManaAtom::BLUE | ManaAtom::OR_2_GENERIC,
            Self::Black2 => ManaAtom::BLACK | ManaAtom::OR_2_GENERIC,
            Self::Red2 => ManaAtom::RED | ManaAtom::OR_2_GENERIC,
            Self::Green2 => ManaAtom::GREEN | ManaAtom::OR_2_GENERIC,
            Self::ColorlessWhite => ManaAtom::WHITE | ManaAtom::COLORLESS,
            Self::ColorlessBlue => ManaAtom::BLUE | ManaAtom::COLORLESS,
            Self::ColorlessBlack => ManaAtom::BLACK | ManaAtom::COLORLESS,
            Self::ColorlessRed => ManaAtom::RED | ManaAtom::COLORLESS,
            Self::ColorlessGreen => ManaAtom::GREEN | ManaAtom::COLORLESS,
            Self::Snow => ManaAtom::IS_SNOW,
            Self::Generic => ManaAtom::GENERIC,
            Self::WhitePhyrexian => ManaAtom::WHITE | ManaAtom::OR_2_LIFE,
            Self::BluePhyrexian => ManaAtom::BLUE | ManaAtom::OR_2_LIFE,
            Self::BlackPhyrexian => ManaAtom::BLACK | ManaAtom::OR_2_LIFE,
            Self::RedPhyrexian => ManaAtom::RED | ManaAtom::OR_2_LIFE,
            Self::GreenPhyrexian => ManaAtom::GREEN | ManaAtom::OR_2_LIFE,
            Self::BlackGreenPhyrexian => ManaAtom::BLACK | ManaAtom::GREEN | ManaAtom::OR_2_LIFE,
            Self::BlackRedPhyrexian => ManaAtom::BLACK | ManaAtom::RED | ManaAtom::OR_2_LIFE,
            Self::GreenBluePhyrexian => ManaAtom::GREEN | ManaAtom::BLUE | ManaAtom::OR_2_LIFE,
            Self::GreenWhitePhyrexian => ManaAtom::GREEN | ManaAtom::WHITE | ManaAtom::OR_2_LIFE,
            Self::RedGreenPhyrexian => ManaAtom::RED | ManaAtom::GREEN | ManaAtom::OR_2_LIFE,
            Self::RedWhitePhyrexian => ManaAtom::RED | ManaAtom::WHITE | ManaAtom::OR_2_LIFE,
            Self::BlueBlackPhyrexian => ManaAtom::BLUE | ManaAtom::BLACK | ManaAtom::OR_2_LIFE,
            Self::BlueRedPhyrexian => ManaAtom::BLUE | ManaAtom::RED | ManaAtom::OR_2_LIFE,
            Self::WhiteBlackPhyrexian => ManaAtom::WHITE | ManaAtom::BLACK | ManaAtom::OR_2_LIFE,
            Self::WhiteBluePhyrexian => ManaAtom::WHITE | ManaAtom::BLUE | ManaAtom::OR_2_LIFE,
            Self::X => ManaAtom::IS_X,
            Self::ColoredX => {
                ManaAtom::WHITE
                    | ManaAtom::BLUE
                    | ManaAtom::BLACK
                    | ManaAtom::RED
                    | ManaAtom::GREEN
                    | ManaAtom::IS_X
            }
        }
    }

    pub fn short_string(self) -> &'static str {
        match self {
            Self::White => "W",
            Self::Blue => "U",
            Self::Black => "B",
            Self::Red => "R",
            Self::Green => "G",
            Self::Colorless => "C",
            Self::WhiteBlue => "W/U",
            Self::WhiteBlack => "W/B",
            Self::BlueBlack => "U/B",
            Self::BlueRed => "U/R",
            Self::BlackRed => "B/R",
            Self::BlackGreen => "B/G",
            Self::RedWhite => "R/W",
            Self::RedGreen => "R/G",
            Self::GreenWhite => "G/W",
            Self::GreenBlue => "G/U",
            Self::White2 => "2/W",
            Self::Blue2 => "2/U",
            Self::Black2 => "2/B",
            Self::Red2 => "2/R",
            Self::Green2 => "2/G",
            Self::ColorlessWhite => "C/W",
            Self::ColorlessBlue => "C/U",
            Self::ColorlessBlack => "C/B",
            Self::ColorlessRed => "C/R",
            Self::ColorlessGreen => "C/G",
            Self::Snow => "S",
            Self::Generic => "1",
            Self::WhitePhyrexian => "W/P",
            Self::BluePhyrexian => "U/P",
            Self::BlackPhyrexian => "B/P",
            Self::RedPhyrexian => "R/P",
            Self::GreenPhyrexian => "G/P",
            Self::BlackGreenPhyrexian => "B/G/P",
            Self::BlackRedPhyrexian => "B/R/P",
            Self::GreenBluePhyrexian => "G/U/P",
            Self::GreenWhitePhyrexian => "G/W/P",
            Self::RedGreenPhyrexian => "R/G/P",
            Self::RedWhitePhyrexian => "R/W/P",
            Self::BlueBlackPhyrexian => "U/B/P",
            Self::BlueRedPhyrexian => "U/R/P",
            Self::WhiteBlackPhyrexian => "W/B/P",
            Self::WhiteBluePhyrexian => "W/U/P",
            Self::X => "X",
            Self::ColoredX => "1",
        }
    }

    pub fn cmc(self) -> i32 {
        let s = self.shard();
        if (s & ManaAtom::IS_X) != 0 {
            return 0;
        }
        if (s & ManaAtom::OR_2_GENERIC) != 0 {
            return 2;
        }
        1
    }

    pub fn color_mask(self) -> u8 {
        (self.shard() & ManaAtom::COLORS_SUPERPOSITION) as u8
    }

    pub fn color(self) -> ColorSet {
        ColorSet::from_mask(self.color_mask())
    }

    pub fn is_phyrexian(self) -> bool {
        (self.shard() & ManaAtom::OR_2_LIFE) != 0
    }

    /// Convert a Phyrexian shard to its non-Phyrexian color equivalent.
    /// E.g. WhitePhyrexian → White, BlackGreenPhyrexian → BlackGreen.
    pub fn to_non_phyrexian(self) -> ManaCostShard {
        match self {
            Self::WhitePhyrexian => Self::White,
            Self::BluePhyrexian => Self::Blue,
            Self::BlackPhyrexian => Self::Black,
            Self::RedPhyrexian => Self::Red,
            Self::GreenPhyrexian => Self::Green,
            Self::BlackGreenPhyrexian => Self::BlackGreen,
            Self::BlackRedPhyrexian => Self::BlackRed,
            Self::GreenBluePhyrexian => Self::GreenBlue,
            Self::GreenWhitePhyrexian => Self::GreenWhite,
            Self::RedGreenPhyrexian => Self::RedGreen,
            Self::RedWhitePhyrexian => Self::RedWhite,
            Self::BlueBlackPhyrexian => Self::BlueBlack,
            Self::BlueRedPhyrexian => Self::BlueRed,
            Self::WhiteBlackPhyrexian => Self::WhiteBlack,
            Self::WhiteBluePhyrexian => Self::WhiteBlue,
            other => other,
        }
    }

    pub fn is_snow(self) -> bool {
        (self.shard() & ManaAtom::IS_SNOW) != 0
    }

    pub fn is_x(self) -> bool {
        (self.shard() & ManaAtom::IS_X) != 0
    }

    pub fn is_generic(self) -> bool {
        let s = self.shard();
        (s & ManaAtom::GENERIC) != 0
            || (s & ManaAtom::IS_X) != 0
            || self.is_snow()
            || self.is_or_2_generic()
    }

    pub fn is_or_2_generic(self) -> bool {
        (self.shard() & ManaAtom::OR_2_GENERIC) != 0
    }

    pub fn is_colorless(self) -> bool {
        (self.shard() & ManaAtom::COLORLESS) != 0
    }

    pub fn is_mono_color(self) -> bool {
        (self.shard() & ManaAtom::COLORS_SUPERPOSITION).count_ones() == 1
    }

    pub fn is_multi_color(self) -> bool {
        (self.shard() & ManaAtom::COLORS_SUPERPOSITION).count_ones() == 2
    }

    /// Parse a non-generic mana symbol string (e.g. "W", "U/R", "W/P", "2/W")
    /// into a ManaCostShard. Matches Java `ManaCostShard.parseNonGeneric`.
    pub fn parse_non_generic(s: &str) -> Option<ManaCostShard> {
        let mut atoms: u16 = 0;
        for c in s.chars() {
            atoms |= ManaAtom::from_char(c);
        }
        // For cases when input is "2" or "12" or "20" — pure numeric
        if atoms == ManaAtom::OR_2_GENERIC || atoms == (ManaAtom::OR_2_GENERIC | ManaAtom::GENERIC)
        {
            atoms = ManaAtom::GENERIC;
        }
        Self::from_atoms(atoms)
    }

    /// Look up a shard by its atom bitmask.
    pub fn from_atoms(atoms: u16) -> Option<ManaCostShard> {
        if atoms == 0 {
            return Some(ManaCostShard::Generic);
        }
        // Check all variants
        const ALL: &[ManaCostShard] = &[
            ManaCostShard::White,
            ManaCostShard::Blue,
            ManaCostShard::Black,
            ManaCostShard::Red,
            ManaCostShard::Green,
            ManaCostShard::Colorless,
            ManaCostShard::WhiteBlue,
            ManaCostShard::WhiteBlack,
            ManaCostShard::BlueBlack,
            ManaCostShard::BlueRed,
            ManaCostShard::BlackRed,
            ManaCostShard::BlackGreen,
            ManaCostShard::RedWhite,
            ManaCostShard::RedGreen,
            ManaCostShard::GreenWhite,
            ManaCostShard::GreenBlue,
            ManaCostShard::White2,
            ManaCostShard::Blue2,
            ManaCostShard::Black2,
            ManaCostShard::Red2,
            ManaCostShard::Green2,
            ManaCostShard::ColorlessWhite,
            ManaCostShard::ColorlessBlue,
            ManaCostShard::ColorlessBlack,
            ManaCostShard::ColorlessRed,
            ManaCostShard::ColorlessGreen,
            ManaCostShard::Snow,
            ManaCostShard::Generic,
            ManaCostShard::WhitePhyrexian,
            ManaCostShard::BluePhyrexian,
            ManaCostShard::BlackPhyrexian,
            ManaCostShard::RedPhyrexian,
            ManaCostShard::GreenPhyrexian,
            ManaCostShard::BlackGreenPhyrexian,
            ManaCostShard::BlackRedPhyrexian,
            ManaCostShard::GreenBluePhyrexian,
            ManaCostShard::GreenWhitePhyrexian,
            ManaCostShard::RedGreenPhyrexian,
            ManaCostShard::RedWhitePhyrexian,
            ManaCostShard::BlueBlackPhyrexian,
            ManaCostShard::BlueRedPhyrexian,
            ManaCostShard::WhiteBlackPhyrexian,
            ManaCostShard::WhiteBluePhyrexian,
            ManaCostShard::X,
            ManaCostShard::ColoredX,
        ];
        ALL.iter().find(|&&shard| shard.shard() == atoms).copied()
    }
}

impl std::fmt::Display for ManaCostShard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{{{}}}", self.short_string())
    }
}

/// A complete mana cost (e.g. {2}{W}{U}).
/// Mirrors Java `ManaCost`. Immutable once constructed.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ManaCost {
    shards: Vec<ManaCostShard>,
    generic_cost: i32,
    has_no_cost: bool,
}

impl ManaCost {
    /// Represents a card with no mana cost (e.g. lands).
    pub fn no_cost() -> Self {
        ManaCost {
            shards: Vec::new(),
            generic_cost: 0,
            has_no_cost: true,
        }
    }

    /// Zero mana cost {0}.
    pub fn zero() -> Self {
        ManaCost {
            shards: Vec::new(),
            generic_cost: 0,
            has_no_cost: false,
        }
    }

    /// Pure generic cost (e.g. {3}).
    pub fn generic(n: i32) -> Self {
        if n < 0 {
            return Self::no_cost();
        }
        ManaCost {
            shards: Vec::new(),
            generic_cost: n,
            has_no_cost: false,
        }
    }

    /// Parse a mana cost string in Forge format (space-separated tokens).
    /// E.g. "2 W U", "3 G G", "X R", "0", "W/U W/U".
    pub fn parse(s: &str) -> Self {
        if s.is_empty() || s == "no cost" {
            return Self::no_cost();
        }

        let mut shards = Vec::new();
        let mut generic_cost: i32 = 0;
        let mut has_x = false;

        for token in s.split_whitespace() {
            // Try parsing as integer (generic mana)
            if let Ok(n) = token.parse::<i32>() {
                generic_cost += n;
            } else {
                // Forge can encode colored pips as adjacent symbols (e.g. "BR"
                // means "{B}{R}"), while hybrid/phyrexian/colorless-hybrid
                // symbols are slash-separated (e.g. "B/R", "W/P", "2/W").
                if token.contains('/') {
                    if let Some(shard) = ManaCostShard::parse_non_generic(token) {
                        if shard != ManaCostShard::Generic {
                            if shard == ManaCostShard::X {
                                has_x = true;
                            }
                            shards.push(shard);
                        }
                        // If it parsed to Generic, it was a numeric handled above
                    }
                } else {
                    // First try parsing the whole token as a single shard.
                    // In Forge card files, adjacent color chars like "BR" mean
                    // hybrid {B/R}, not separate {B}{R} (which would be "B R").
                    let whole = ManaCostShard::parse_non_generic(token);
                    if let Some(shard) = whole {
                        if shard.is_multi_color() || shard.is_phyrexian() {
                            // Hybrid shard (e.g. "BR" → BlackRed) or phyrexian (e.g. "GP" → GreenPhyrexian)
                            shards.push(shard);
                        } else {
                            // Mono-color or other — fall back to per-character
                            // so "WW" correctly becomes two White shards.
                            for c in token.chars() {
                                let sym = c.to_ascii_uppercase().to_string();
                                if let Some(shard) = ManaCostShard::parse_non_generic(&sym) {
                                    if shard != ManaCostShard::Generic {
                                        if shard == ManaCostShard::X {
                                            has_x = true;
                                        }
                                        shards.push(shard);
                                    }
                                }
                            }
                        }
                    } else {
                        for c in token.chars() {
                            let sym = c.to_ascii_uppercase().to_string();
                            if let Some(shard) = ManaCostShard::parse_non_generic(&sym) {
                                if shard != ManaCostShard::Generic {
                                    if shard == ManaCostShard::X {
                                        has_x = true;
                                    }
                                    shards.push(shard);
                                }
                            }
                        }
                    }
                }
            }
        }

        let has_no_cost = !has_x && generic_cost < 0;
        if has_no_cost {
            generic_cost = 0;
        }

        ManaCost {
            shards,
            generic_cost,
            has_no_cost,
        }
    }

    pub fn cmc(&self) -> i32 {
        let shard_total: i32 = self.shards.iter().map(|s| s.cmc()).sum();
        shard_total + self.generic_cost
    }

    pub fn color_profile(&self) -> u8 {
        let mut result: u8 = 0;
        for s in &self.shards {
            result |= s.color_mask();
        }
        result
    }

    pub fn color_set(&self) -> ColorSet {
        ColorSet::from_mask(self.color_profile())
    }

    pub fn generic_cost(&self) -> i32 {
        self.generic_cost
    }

    pub fn shards(&self) -> &[ManaCostShard] {
        &self.shards
    }

    pub fn is_no_cost(&self) -> bool {
        self.has_no_cost
    }

    pub fn is_zero(&self) -> bool {
        self.generic_cost == 0 && self.shards.is_empty() && !self.has_no_cost
    }

    pub fn is_pure_generic(&self) -> bool {
        self.shards.is_empty() && !self.has_no_cost
    }

    pub fn count_x(&self) -> usize {
        self.shards
            .iter()
            .filter(|s| **s == ManaCostShard::X)
            .count()
    }

    pub fn has_phyrexian(&self) -> bool {
        self.shards.iter().any(|s| s.is_phyrexian())
    }

    /// Build a ManaCost from explicit shards and generic cost.
    pub fn from_parts(shards: Vec<ManaCostShard>, generic_cost: i32) -> ManaCost {
        ManaCost {
            shards,
            generic_cost,
            has_no_cost: false,
        }
    }

    /// Return a copy of this cost with all X shards removed.
    /// Used to compute the non-X portion for affordability checks.
    pub fn without_x(&self) -> ManaCost {
        ManaCost {
            shards: self.shards.iter().filter(|s| !s.is_x()).copied().collect(),
            generic_cost: self.generic_cost,
            has_no_cost: self.has_no_cost,
        }
    }

    /// Return a copy of this cost with all Phyrexian shards removed.
    /// Used for playability checks — Phyrexian shards can always be paid with 2 life.
    pub fn without_phyrexian(&self) -> ManaCost {
        ManaCost {
            shards: self
                .shards
                .iter()
                .filter(|s| !s.is_phyrexian())
                .copied()
                .collect(),
            generic_cost: self.generic_cost,
            has_no_cost: self.has_no_cost,
        }
    }

    /// Convert phyrexian shards to their colored equivalents (e.g. {B/P} → {B}).
    /// Non-phyrexian shards are kept as-is. Generic cost is preserved.
    pub fn phyrexian_to_colored(&self) -> ManaCost {
        ManaCost {
            shards: self
                .shards
                .iter()
                .map(|s| {
                    if s.is_phyrexian() {
                        s.to_non_phyrexian()
                    } else {
                        *s
                    }
                })
                .collect(),
            generic_cost: self.generic_cost,
            has_no_cost: self.has_no_cost,
        }
    }

    /// Convert mono-colored shards of the given color into their phyrexian variants.
    /// Used for effects like "you may pay 2 life rather than pay {B}".
    pub fn colored_to_phyrexian(&self, color_mask: u8) -> ManaCost {
        let shards = self
            .shards
            .iter()
            .map(|s| match (*s, color_mask) {
                (ManaCostShard::White, m) if m == ManaAtom::WHITE as u8 => {
                    ManaCostShard::WhitePhyrexian
                }
                (ManaCostShard::Blue, m) if m == ManaAtom::BLUE as u8 => {
                    ManaCostShard::BluePhyrexian
                }
                (ManaCostShard::Black, m) if m == ManaAtom::BLACK as u8 => {
                    ManaCostShard::BlackPhyrexian
                }
                (ManaCostShard::Red, m) if m == ManaAtom::RED as u8 => ManaCostShard::RedPhyrexian,
                (ManaCostShard::Green, m) if m == ManaAtom::GREEN as u8 => {
                    ManaCostShard::GreenPhyrexian
                }
                (other, _) => other,
            })
            .collect();
        ManaCost {
            shards,
            generic_cost: self.generic_cost,
            has_no_cost: self.has_no_cost,
        }
    }

    pub fn shard_count(&self, which: ManaCostShard) -> usize {
        if which == ManaCostShard::Generic {
            return self.generic_cost as usize;
        }
        self.shards.iter().filter(|s| **s == which).count()
    }

    /// Add another mana cost to this one, returning the combined cost.
    pub fn add(&self, other: &ManaCost) -> ManaCost {
        Self::combine(self, other)
    }

    /// Reduce the generic portion of this cost by `amount` (floor at 0).
    /// Used for Emerge (cost reduced by sacrificed creature's mana value).
    pub fn reduce_generic(&self, amount: i32) -> ManaCost {
        ManaCost {
            shards: self.shards.clone(),
            generic_cost: (self.generic_cost - amount).max(0),
            has_no_cost: self.has_no_cost,
        }
    }

    /// Return a copy with the generic cost set to the given value.
    pub fn with_generic(&self, generic: i32) -> ManaCost {
        ManaCost {
            shards: self.shards.clone(),
            generic_cost: generic.max(0),
            has_no_cost: self.has_no_cost,
        }
    }

    /// Check if this cost has a mono-color shard matching the given ManaAtom.
    pub fn has_color_shard(&self, atom: u16) -> bool {
        self.shards.iter().any(|s| {
            s.is_mono_color()
                && !s.is_phyrexian()
                && (s.shard() & ManaAtom::COLORS_SUPERPOSITION) == atom
        })
    }

    /// Remove one mono-color shard matching the given ManaAtom. Returns new cost.
    pub fn remove_color_shard(&self, atom: u16) -> ManaCost {
        let mut shards = self.shards.clone();
        if let Some(pos) = shards.iter().position(|s| {
            s.is_mono_color()
                && !s.is_phyrexian()
                && (s.shard() & ManaAtom::COLORS_SUPERPOSITION) == atom
        }) {
            shards.remove(pos);
        }
        ManaCost {
            shards,
            generic_cost: self.generic_cost,
            has_no_cost: self.has_no_cost,
        }
    }

    /// Remove up to `count` colored shards matching `color` from this cost.
    /// If `ignore_generic` is true, only removes colored shards (never converts to generic reduction).
    /// If `ignore_generic` is false and fewer matching shards exist than `count`, the remainder
    /// reduces the generic portion instead.
    pub fn reduce_color(&self, color: Color, count: i32, ignore_generic: bool) -> ManaCost {
        let mut shards = self.shards.clone();
        let mut remaining = count;
        let color_mask = color.mask() as u16;

        // Remove matching mono-color shards
        let mut i = 0;
        while i < shards.len() && remaining > 0 {
            let shard_colors = shards[i].shard() & ManaAtom::COLORS_SUPERPOSITION;
            // Match mono-color shards of this exact color (not hybrid/phyrexian)
            if shard_colors == color_mask && shards[i].is_mono_color() && !shards[i].is_phyrexian()
            {
                shards.remove(i);
                remaining -= 1;
            } else {
                i += 1;
            }
        }

        let generic_cost = if !ignore_generic && remaining > 0 {
            (self.generic_cost - remaining).max(0)
        } else {
            self.generic_cost
        };

        ManaCost {
            shards,
            generic_cost,
            has_no_cost: self.has_no_cost,
        }
    }

    pub fn combine(a: &ManaCost, b: &ManaCost) -> ManaCost {
        let mut shards = a.shards.clone();
        shards.extend_from_slice(&b.shards);
        ManaCost {
            shards,
            generic_cost: a.generic_cost + b.generic_cost,
            has_no_cost: false,
        }
    }
}

impl std::fmt::Debug for ManaCost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ManaCost({})", self)
    }
}

impl std::fmt::Display for ManaCost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.has_no_cost {
            return write!(f, "no cost");
        }
        // X shards first
        for s in &self.shards {
            if *s == ManaCostShard::X {
                write!(f, "{}", s)?;
            }
        }
        if self.generic_cost > 0 || (self.generic_cost == 0 && self.shards.is_empty()) {
            write!(f, "{{{}}}", self.generic_cost)?;
        }
        for s in &self.shards {
            if *s != ManaCostShard::X {
                write!(f, "{}", s)?;
            }
        }
        if self.generic_cost < 0 {
            write!(f, " {}", self.generic_cost)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_costs() {
        let cost = ManaCost::parse("2 W U");
        assert_eq!(cost.cmc(), 4);
        assert_eq!(cost.generic_cost(), 2);
        assert_eq!(cost.shards().len(), 2);
        assert!(cost.color_set().has_white());
        assert!(cost.color_set().has_blue());
    }

    #[test]
    fn parse_zero() {
        let cost = ManaCost::parse("0");
        assert!(cost.is_zero());
        assert_eq!(cost.cmc(), 0);
        assert_eq!(format!("{}", cost), "{0}");
    }

    #[test]
    fn parse_x_cost() {
        let cost = ManaCost::parse("X R");
        assert_eq!(cost.count_x(), 1);
        assert_eq!(cost.cmc(), 1); // X contributes 0
    }

    #[test]
    fn parse_hybrid() {
        let cost = ManaCost::parse("1 W/U");
        assert_eq!(cost.cmc(), 2);
        assert_eq!(cost.shards().len(), 1);
        assert!(cost.color_set().has_white());
        assert!(cost.color_set().has_blue());
    }

    #[test]
    fn parse_adjacent_multicolor_as_hybrid() {
        // In Forge card files, "BR" (single token) means hybrid {B/R},
        // while separate pips would be written as "B R".
        let cost = ManaCost::parse("2 BR");
        assert_eq!(cost.generic_cost(), 2);
        assert_eq!(cost.shards(), &[ManaCostShard::BlackRed]);
        assert_eq!(cost.cmc(), 3); // 2 generic + 1 hybrid
    }

    #[test]
    fn parse_separate_pips_not_hybrid() {
        // Space-separated "B R" means two separate color pips
        let cost = ManaCost::parse("2 B R");
        assert_eq!(cost.generic_cost(), 2);
        assert_eq!(cost.shards(), &[ManaCostShard::Black, ManaCostShard::Red]);
        assert_eq!(cost.cmc(), 4); // 2 generic + B + R
    }

    #[test]
    fn parse_repeated_same_color_not_hybrid() {
        // "WW" = two White pips (not hybrid)
        let cost = ManaCost::parse("WW");
        assert_eq!(cost.shards(), &[ManaCostShard::White, ManaCostShard::White]);
        assert_eq!(cost.cmc(), 2);
    }

    #[test]
    fn parse_phyrexian() {
        // Slash-separated format (e.g. "W/P")
        let cost = ManaCost::parse("W/P");
        assert!(cost.has_phyrexian());
        assert_eq!(cost.cmc(), 1);
        // Adjacent format from card files (e.g. "GP")
        let cost2 = ManaCost::parse("GP");
        assert!(cost2.has_phyrexian());
        assert_eq!(cost2.cmc(), 1);
        assert_eq!(cost2.shards().len(), 1);
        // Multi-shard: "1 BP BP" (Dismember)
        let cost3 = ManaCost::parse("1 BP BP");
        assert!(cost3.has_phyrexian());
        assert_eq!(cost3.shards().len(), 2);
        assert_eq!(cost3.generic_cost(), 1);
    }

    #[test]
    fn no_cost() {
        let cost = ManaCost::no_cost();
        assert!(cost.is_no_cost());
        assert_eq!(format!("{}", cost), "no cost");
    }

    #[test]
    fn shard_parse_non_generic() {
        assert_eq!(
            ManaCostShard::parse_non_generic("W"),
            Some(ManaCostShard::White)
        );
        assert_eq!(
            ManaCostShard::parse_non_generic("W/U"),
            Some(ManaCostShard::WhiteBlue)
        );
        assert_eq!(
            ManaCostShard::parse_non_generic("2/W"),
            Some(ManaCostShard::White2)
        );
        assert_eq!(
            ManaCostShard::parse_non_generic("W/P"),
            Some(ManaCostShard::WhitePhyrexian)
        );
    }

    #[test]
    fn shard_cmc() {
        assert_eq!(ManaCostShard::White.cmc(), 1);
        assert_eq!(ManaCostShard::White2.cmc(), 2);
        assert_eq!(ManaCostShard::X.cmc(), 0);
    }

    #[test]
    fn display_cost() {
        let cost = ManaCost::parse("3 R R");
        assert_eq!(format!("{}", cost), "{3}{R}{R}");
    }
}
