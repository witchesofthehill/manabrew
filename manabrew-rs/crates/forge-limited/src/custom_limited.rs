use serde::{Deserialize, Serialize};

use forge_foundation::sealed_product::SealedTemplate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomLimited {
    pub name: String,
    pub num_packs: u32,
    pub singleton: bool,
    pub land_set_code: Option<String>,
    pub template: SealedTemplate,
    pub cards: Vec<CubeCardEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CubeCardEntry {
    pub name: String,
    pub set_code: Option<String>,
    pub count: u32,
}

impl CustomLimited {
    fn default_template() -> SealedTemplate {
        SealedTemplate::generic_no_slot_booster()
    }

    pub fn parse(body: &str) -> Self {
        let mut name = String::new();
        let mut num_packs: u32 = 3;
        let mut singleton = false;
        let mut land_set_code: Option<String> = None;
        let mut template: Option<SealedTemplate> = None;
        let mut cards: Vec<CubeCardEntry> = Vec::new();
        let mut in_cards = false;

        for raw in body.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if in_cards {
                cards.push(parse_card_entry(line));
                continue;
            }
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                match key {
                    "Name" => name = value.to_string(),
                    "NumPacks" => num_packs = value.parse().unwrap_or(3),
                    "Singleton" => singleton = value.eq_ignore_ascii_case("true"),
                    "LandSetCode" => land_set_code = Some(value.to_string()),
                    "SealedTemplate" => {
                        template = Some(SealedTemplate::new(
                            None,
                            forge_foundation::sealed_product::sealed_template::parse_slots(value),
                        ));
                    }
                    "Cards" => {
                        in_cards = true;
                    }
                    _ => {}
                }
            }
        }

        Self {
            name,
            num_packs,
            singleton,
            land_set_code,
            template: template.unwrap_or_else(Self::default_template),
            cards,
        }
    }
}

fn parse_card_entry(line: &str) -> CubeCardEntry {
    let mut parts = line.splitn(2, ' ');
    let count_str = parts.next().unwrap_or("1").trim();
    let count: u32 = count_str.parse().unwrap_or(1);
    let rest = parts.next().unwrap_or("").trim();
    let (name, set_code) = match rest.rsplit_once('|') {
        Some((n, s)) => (n.trim().to_string(), Some(s.trim().to_string())),
        None => (rest.to_string(), None),
    };
    CubeCardEntry {
        name,
        set_code,
        count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_minimal_cube() {
        let body = "\
            Name:Tiny Cube\n\
            NumPacks:3\n\
            Singleton:true\n\
            LandSetCode:M21\n\
            SealedTemplate:15 Any\n\
            Cards:\n\
            4 Lightning Bolt|M11\n\
            2 Shock|M21\n\
            1 Counterspell\n";
        let cube = CustomLimited::parse(body);
        assert_eq!(cube.name, "Tiny Cube");
        assert_eq!(cube.num_packs, 3);
        assert!(cube.singleton);
        assert_eq!(cube.land_set_code.as_deref(), Some("M21"));
        assert_eq!(cube.cards.len(), 3);
        assert_eq!(cube.cards[0].name, "Lightning Bolt");
        assert_eq!(cube.cards[0].set_code.as_deref(), Some("M11"));
        assert_eq!(cube.cards[0].count, 4);
        assert_eq!(cube.cards[2].set_code, None);
    }
}
