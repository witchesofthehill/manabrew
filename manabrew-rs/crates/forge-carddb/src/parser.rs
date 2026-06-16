use std::collections::HashMap;

use forge_card_script::{ParsedCardScript, ScriptLineKind};
use forge_foundation::{CardSplitType, CardTypeLine, ColorSet, ManaCost};

use crate::card_face::CardFace;
use crate::card_rules::CardRules;

/// Line-by-line parser for Forge card script files.
/// Direct port of Java `CardRules.Reader.parseLine()`.
pub struct CardScriptParser {
    faces: Vec<Option<CardFace>>,
    cur_face: usize,
    alt_mode: CardSplitType,
    meld_with: Option<String>,
    partner_with: Option<String>,
    normalized_name: String,
}

impl CardScriptParser {
    pub fn new() -> Self {
        CardScriptParser {
            faces: vec![None, None, None, None, None, None, None],
            cur_face: 0,
            alt_mode: CardSplitType::None,
            meld_with: None,
            partner_with: None,
            normalized_name: String::new(),
        }
    }

    pub fn reset(&mut self) {
        self.faces = vec![None, None, None, None, None, None, None];
        self.cur_face = 0;
        self.alt_mode = CardSplitType::None;
        self.meld_with = None;
        self.partner_with = None;
        self.normalized_name.clear();
    }

    /// Parse all lines from a card script and produce a CardRules.
    pub fn parse<'a, I: IntoIterator<Item = &'a str>>(
        &mut self,
        lines: I,
        filename: Option<&str>,
    ) -> Result<CardRules, String> {
        self.reset();
        let raw = lines.into_iter().collect::<Vec<_>>().join("\n");
        let script = ParsedCardScript::parse(&raw);
        for line in script.lines() {
            match &line.kind {
                ScriptLineKind::Blank | ScriptLineKind::Comment(_) => {}
                _ => self.parse_line(line.raw),
            }
        }
        if let Some(f) = filename {
            self.normalized_name = f.to_string();
        }
        self.build()
    }

    /// Parse a single line of a card script.
    pub fn parse_line(&mut self, line: &str) {
        // Find the face to apply this line to
        let face_idx = self.cur_face;
        self.parse_line_for_face(line, face_idx);
    }

    fn parse_line_for_face(&mut self, line: &str, face_idx: usize) {
        let colon_pos = line.find(':');
        let (key, value) = match colon_pos {
            Some(pos) if pos > 0 => (&line[..pos], Some(line[pos + 1..].trim())),
            _ => (line, None),
        };

        let value_str = value.unwrap_or("");

        match key.as_bytes().first() {
            Some(b'A') => {
                if key == "A" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.abilities.push(value_str.to_string());
                    }
                } else if key == "AlternateMode" {
                    if let Some(mode) = CardSplitType::from_str_compat(value_str) {
                        self.alt_mode = mode;
                    }
                } else if key == "ALTERNATE" {
                    self.cur_face = 1;
                }
            }
            Some(b'C') => {
                if key == "Colors" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        let mut mask = 0u8;
                        for part in value_str.split(',') {
                            let cs = ColorSet::from_names(part.trim());
                            mask |= cs.mask();
                        }
                        face.color = Some(ColorSet::from_mask(mask));
                    }
                }
            }
            Some(b'D') => {
                if key == "Defense" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.defense = Some(value_str.to_string());
                    }
                } else if key == "Draft" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.draft_actions.push(value_str.to_string());
                    }
                }
                // DeckHints, DeckNeeds, DeckHas — ignored for engine purposes
            }
            Some(b'F') => {
                if key == "FlavorName" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.flavor_name = Some(value_str.to_string());
                    }
                }
            }
            Some(b'H') => {
                // HandLifeModifier — vanguard, ignored for now
            }
            Some(b'K') => {
                if key == "K" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.keywords.push(value_str.to_string());
                    }
                    // Track Partner with
                    if value_str.starts_with("Partner with:") {
                        if let Some(partner) = value_str.strip_prefix("Partner with:") {
                            self.partner_with = Some(partner.to_string());
                        }
                    }
                }
            }
            Some(b'L') => {
                if key == "Loyalty" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.initial_loyalty = Some(value_str.to_string());
                    }
                } else if key == "Lights" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.attraction_lights = value_str
                            .split_whitespace()
                            .filter_map(|s| s.parse::<u32>().ok())
                            .collect();
                    }
                }
            }
            Some(b'M') => {
                if key == "ManaCost" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.mana_cost = if value_str == "no cost" {
                            ManaCost::no_cost()
                        } else {
                            ManaCost::parse(value_str)
                        };
                    }
                } else if key == "MeldPair" {
                    self.meld_with = Some(value_str.to_string());
                }
            }
            Some(b'N') => {
                if key == "Name" {
                    self.faces[self.cur_face] = Some(CardFace::new(value_str.to_string()));
                }
            }
            Some(b'O') => {
                if key == "Oracle" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.oracle_text = value_str.to_string();
                    }
                }
            }
            Some(b'P') => {
                if key == "PT" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.set_pt(value_str);
                    }
                }
            }
            Some(b'R') => {
                if key == "R" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.replacements.push(value_str.to_string());
                    }
                }
            }
            Some(b'S') => {
                if key == "S" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.static_abilities.push(value_str.to_string());
                    }
                } else if key.starts_with("SPECIALIZE") {
                    match value_str {
                        "WHITE" => self.cur_face = 2,
                        "BLUE" => self.cur_face = 3,
                        "BLACK" => self.cur_face = 4,
                        "RED" => self.cur_face = 5,
                        "GREEN" => self.cur_face = 6,
                        _ => {}
                    }
                } else if key == "SVar" {
                    if let Some(val) = value {
                        let svar_colon = val.find(':');
                        let (var_name, var_value) = match svar_colon {
                            Some(pos) => (&val[..pos], &val[pos + 1..]),
                            None => (val, ""),
                        };
                        self.ensure_face(face_idx);
                        if let Some(face) = &mut self.faces[face_idx] {
                            face.svars
                                .insert(var_name.to_string(), var_value.to_string());
                        }
                    }
                } else if key.starts_with("SETCOLORID") {
                    // Ignored for now
                }
            }
            Some(b'T') => {
                if key == "T" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.triggers.push(value_str.to_string());
                    }
                } else if key == "Types" {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.type_line = CardTypeLine::parse(value_str);
                    }
                } else if key == "Text" && !value_str.is_empty() {
                    self.ensure_face(face_idx);
                    if let Some(face) = &mut self.faces[face_idx] {
                        face.non_ability_text = Some(value_str.to_string());
                    }
                }
            }
            Some(b'V') => {
                if key == "Variant" {
                    // Functional variants (Attractions, Un-cards) — store raw for now
                    // We parse the variant line recursively like Java does
                    if let Some(val) = value {
                        let variant_colon = val.find(':');
                        if let Some(pos) = variant_colon {
                            let _variant_name = &val[..pos];
                            let _variant_line = &val[pos + 1..];
                            // For now, we skip functional variants — they're rare
                            // and can be added later without architecture changes
                        }
                    }
                }
            }
            _ => {
                // AI:, other keys — ignored for engine
            }
        }
    }

    fn ensure_face(&mut self, idx: usize) {
        if self.faces[idx].is_none() {
            // This shouldn't happen in well-formed scripts (Name comes first),
            // but handle gracefully
            self.faces[idx] = Some(CardFace::new(format!("__unnamed_face_{}", idx)));
        }
    }

    /// Build the final CardRules from parsed data.
    pub fn build(&mut self) -> Result<CardRules, String> {
        let main = self.faces[0]
            .take()
            .ok_or_else(|| "Card has no main face (missing Name: line)".to_string())?;

        let other = self.faces[1].take();

        // Specialize faces
        let mut specialized = HashMap::new();
        let specialize_names = ["W", "U", "B", "R", "G"];
        for (i, name) in specialize_names.iter().enumerate() {
            if let Some(face) = self.faces[i + 2].take() {
                specialized.insert(format!("Specialize{}", name), face);
            }
        }

        let mut main = main;
        main.assign_missing_fields();

        let other = other.map(|mut f| {
            f.assign_missing_fields();
            f
        });

        for face in specialized.values_mut() {
            face.assign_missing_fields();
        }

        // Calculate color identity
        let mut ci_mask = CardRules::calculate_color_identity(&main);
        if let Some(ref other_face) = other {
            ci_mask |= CardRules::calculate_color_identity(other_face);
        }

        Ok(CardRules {
            split_type: self.alt_mode,
            main_part: main,
            other_part: other,
            specialized_parts: specialized,
            color_identity: ColorSet::from_mask(ci_mask),
            normalized_name: std::mem::take(&mut self.normalized_name),
            meld_with: self.meld_with.take(),
            partner_with: self.partner_with.take(),
        })
    }
}

impl Default for CardScriptParser {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience: parse a card from a single string (lines separated by newlines).
pub fn parse_card_script(script: &str) -> Result<CardRules, String> {
    let mut parser = CardScriptParser::new();
    let lines: Vec<&str> = script.lines().collect();
    parser.parse(lines, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lightning_bolt() {
        let script = "\
Name:Lightning Bolt
ManaCost:R
Types:Instant
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ CARDNAME deals 3 damage to any target.
Oracle:Lightning Bolt deals 3 damage to any target.";

        let card = parse_card_script(script).unwrap();
        assert_eq!(card.main_part.name, "Lightning Bolt");
        assert_eq!(card.main_part.mana_cost.cmc(), 1);
        assert!(card.main_part.type_line.is_instant());
        assert_eq!(card.main_part.abilities.len(), 1);
        assert!(card.main_part.abilities[0].contains("DealDamage"));
        assert!(card.main_part.resolved_color().has_red());
    }

    #[test]
    fn parse_grizzly_bears() {
        let script = "\
Name:Grizzly Bears
ManaCost:1 G
Types:Creature Bear
PT:2/2
Oracle:";

        let card = parse_card_script(script).unwrap();
        assert_eq!(card.main_part.name, "Grizzly Bears");
        assert_eq!(card.main_part.mana_cost.cmc(), 2);
        assert!(card.main_part.type_line.is_creature());
        assert_eq!(card.main_part.int_power, Some(2));
        assert_eq!(card.main_part.int_toughness, Some(2));
    }

    #[test]
    fn parse_transform_card() {
        let script = "\
Name:Lambholt Pacifist
ManaCost:1 G
Types:Creature Human Shaman Werewolf
PT:3/3
S:Mode$ CantAttack | ValidCard$ Card.Self
T:Mode$ Phase | Phase$ Upkeep | Execute$ TrigTransform
SVar:TrigTransform:DB$ SetState | Defined$ Self | Mode$ Transform
AlternateMode:DoubleFaced
Oracle:Test oracle text.

ALTERNATE

Name:Lambholt Butcher
ManaCost:no cost
Colors:green
Types:Creature Werewolf
PT:4/4
Oracle:Back face oracle.";

        let card = parse_card_script(script).unwrap();
        assert_eq!(card.main_part.name, "Lambholt Pacifist");
        assert_eq!(card.split_type, CardSplitType::Transform);
        assert!(card.other_part.is_some());
        let back = card.other_part.as_ref().unwrap();
        assert_eq!(back.name, "Lambholt Butcher");
        assert_eq!(back.int_power, Some(4));
        assert!(back.resolved_color().has_green());
    }

    #[test]
    fn parse_keywords_and_svars() {
        let script = "\
Name:Laelia, the Blade Reforged
ManaCost:2 R
Types:Legendary Creature Spirit Warrior
PT:2/2
K:Haste
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigExile
SVar:TrigExile:DB$ Dig | Defined$ You
Oracle:Haste";

        let card = parse_card_script(script).unwrap();
        assert_eq!(card.main_part.keywords, vec!["Haste"]);
        assert_eq!(card.main_part.triggers.len(), 1);
        assert!(card.main_part.svars.contains_key("TrigExile"));
        assert!(card.main_part.type_line.is_legendary());
    }
}
