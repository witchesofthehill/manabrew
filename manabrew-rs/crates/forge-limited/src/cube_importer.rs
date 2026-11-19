use forge_foundation::sealed_product::SealedTemplate;
use serde::Deserialize;

use crate::custom_limited::{CubeCardEntry, CustomLimited};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CubeHostingPlatform {
    CubeCobra,
    CubeArtisan,
}

impl CubeHostingPlatform {
    pub fn domain(self) -> &'static str {
        match self {
            CubeHostingPlatform::CubeCobra => "cubecobra.com/cube/",
            CubeHostingPlatform::CubeArtisan => "cubeartisan.net/cube/",
        }
    }

    pub fn from_input(input: &str) -> Self {
        for p in [Self::CubeCobra, Self::CubeArtisan] {
            if input.contains(p.domain()) {
                return p;
            }
        }
        Self::CubeCobra
    }
}

#[derive(Debug, Clone)]
pub struct CubeImporter {
    pub platform: CubeHostingPlatform,
    pub cube_id: String,
}

impl CubeImporter {
    pub fn new(input: &str) -> Result<Self, String> {
        if input.trim().is_empty() {
            return Err("cube id or url is empty".into());
        }
        let platform = CubeHostingPlatform::from_input(input);
        let cube_id = parse_cube_id(input, platform)?;
        Ok(Self { platform, cube_id })
    }

    pub fn cubecobra_download_url(&self) -> Result<String, String> {
        match self.platform {
            CubeHostingPlatform::CubeCobra => Ok(format!(
                "https://cubecobra.com/cube/api/cubeJSON/{}",
                self.cube_id
            )),
            CubeHostingPlatform::CubeArtisan => Err("cubeartisan import isn't wired up yet".into()),
        }
    }

    pub fn parse(&self, body: &str) -> Result<CustomLimited, String> {
        let parsed: CubeCobraBody = serde_json::from_str(body)
            .map_err(|error| format!("invalid CubeCobra JSON: {error}"))?;
        if parsed.cards.mainboard.is_empty() {
            return Err("imported cube has no main cards".into());
        }
        let template = SealedTemplate::generic_no_slot_booster();
        let timestamp = current_yyyymmdd_hhmm();
        let name = if parsed.name.is_empty() {
            format!("{}_{}", self.cube_id, timestamp)
        } else {
            format!("{}_{}", parsed.name, timestamp)
        };
        Ok(CustomLimited {
            name,
            num_packs: 3,
            singleton: true,
            land_set_code: None,
            template,
            cards: parsed
                .cards
                .mainboard
                .into_iter()
                .map(|card| CubeCardEntry {
                    name: card.details.name,
                    set_code: Some(card.details.set),
                    collector_number: Some(card.details.collector_number),
                    count: 1,
                })
                .collect(),
        })
    }
}

fn parse_cube_id(input: &str, platform: CubeHostingPlatform) -> Result<String, String> {
    let id = match platform {
        CubeHostingPlatform::CubeCobra => {
            let last = input
                .trim()
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or("");
            last.to_string()
        }
        CubeHostingPlatform::CubeArtisan => {
            return Err("cubeartisan parse isn't wired up yet".into());
        }
    };
    if id.is_empty() {
        return Err("could not extract a cube id".into());
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("cube id must contain only [A-Za-z0-9-]".into());
    }
    Ok(id)
}

fn current_yyyymmdd_hhmm() -> String {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("{secs:x}")
    }
    #[cfg(target_arch = "wasm32")]
    {
        "0".to_string()
    }
}

#[derive(Deserialize)]
struct CubeCobraBody {
    name: String,
    cards: CubeCobraCards,
}

#[derive(Deserialize)]
struct CubeCobraCards {
    mainboard: Vec<CubeCobraCard>,
}

#[derive(Deserialize)]
struct CubeCobraCard {
    details: CubeCobraCardDetails,
}

#[derive(Deserialize)]
struct CubeCobraCardDetails {
    name: String,
    set: String,
    collector_number: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bare_cube_id() {
        let imp = CubeImporter::new("abc123").unwrap();
        assert_eq!(imp.platform, CubeHostingPlatform::CubeCobra);
        assert_eq!(imp.cube_id, "abc123");
    }

    #[test]
    fn parses_cubecobra_overview_url() {
        let imp = CubeImporter::new("https://cubecobra.com/cube/overview/my-cube-1").unwrap();
        assert_eq!(imp.platform, CubeHostingPlatform::CubeCobra);
        assert_eq!(imp.cube_id, "my-cube-1");
    }

    #[test]
    fn rejects_invalid_cube_id() {
        let err = CubeImporter::new("bad/cube id!").unwrap_err();
        assert!(err.contains("only"), "{err}");
    }

    #[test]
    fn parses_cubecobra_json() {
        let body = r#"{
            "name": "Tiny Cube",
            "cards": {
                "mainboard": [
                    {"details": {"name": "Lightning Bolt", "set": "m11", "collector_number": "146"}},
                    {"details": {"name": "Lightning Bolt", "set": "m11", "collector_number": "146"}},
                    {"details": {"name": "Shock", "set": "m21", "collector_number": "159"}}
                ],
                "maybeboard": [
                    {"details": {"name": "Counterspell", "set": "a25", "collector_number": "50"}}
                ]
            }
        }"#;
        let imp = CubeImporter::new("abc").unwrap();
        let cube = imp.parse(body).unwrap();
        assert!(cube.name.starts_with("Tiny Cube_"));
        assert!(cube.singleton);
        assert_eq!(cube.num_packs, 3);
        assert_eq!(cube.cards.len(), 3);
        assert_eq!(cube.cards[0].name, "Lightning Bolt");
        assert_eq!(cube.cards[0].set_code.as_deref(), Some("m11"));
        assert_eq!(cube.cards[0].collector_number.as_deref(), Some("146"));
        assert_eq!(cube.cards[0].count, 1);
        assert_eq!(cube.cards[1].name, "Lightning Bolt");
        assert_eq!(cube.cards[1].collector_number.as_deref(), Some("146"));
        assert_eq!(cube.cards[2].name, "Shock");
        assert_eq!(cube.cards[2].set_code.as_deref(), Some("m21"));
        assert_eq!(cube.cards[2].collector_number.as_deref(), Some("159"));
    }
}
