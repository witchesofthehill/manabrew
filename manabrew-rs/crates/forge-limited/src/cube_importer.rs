use forge_foundation::sealed_product::SealedTemplate;

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
                "https://cubecobra.com/cube/download/forge/{}",
                self.cube_id
            )),
            CubeHostingPlatform::CubeArtisan => Err("cubeartisan import isn't wired up yet".into()),
        }
    }

    pub fn parse(&self, body: &str) -> Result<CustomLimited, String> {
        let parsed = ForgeDeckBody::parse(body)?;
        if parsed.main.is_empty() {
            return Err("imported deck has no main cards".into());
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
            cards: parsed.main,
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
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs:x}")
}

struct ForgeDeckBody {
    name: String,
    main: Vec<CubeCardEntry>,
}

impl ForgeDeckBody {
    fn parse(body: &str) -> Result<Self, String> {
        let mut name = String::new();
        let mut main: Vec<CubeCardEntry> = Vec::new();
        let mut current_section: Option<String> = None;

        for raw in body.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                current_section = Some(line[1..line.len() - 1].to_lowercase());
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                if key.trim().eq_ignore_ascii_case("name") {
                    name = value.trim().to_string();
                    continue;
                }
            }
            if matches!(current_section.as_deref(), Some("main")) {
                if let Some(entry) = parse_card_line(line) {
                    main.push(entry);
                }
            }
        }
        Ok(Self { name, main })
    }
}

fn parse_card_line(line: &str) -> Option<CubeCardEntry> {
    let mut parts = line.splitn(2, ' ');
    let count_str = parts.next()?.trim();
    let count: u32 = count_str.parse().ok()?;
    let rest = parts.next()?.trim();
    let mut segments = rest.split('|');
    let name = segments.next()?.trim().to_string();
    let set_code = segments
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Some(CubeCardEntry {
        name,
        set_code,
        count,
    })
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
    fn parses_forge_deck_body() {
        let body = "\
            [metadata]\n\
            Name=Tiny Cube\n\
            [Main]\n\
            4 Lightning Bolt|M11\n\
            2 Shock|M21\n\
            1 Counterspell\n";
        let imp = CubeImporter::new("abc").unwrap();
        let cube = imp.parse(body).unwrap();
        assert!(cube.name.starts_with("Tiny Cube_"));
        assert!(cube.singleton);
        assert_eq!(cube.num_packs, 3);
        assert_eq!(cube.cards.len(), 3);
        assert_eq!(cube.cards[0].name, "Lightning Bolt");
        assert_eq!(cube.cards[0].set_code.as_deref(), Some("M11"));
        assert_eq!(cube.cards[0].count, 4);
        assert!(cube.cards[2].set_code.is_none());
    }

    #[test]
    fn cubecobra_download_url() {
        let imp = CubeImporter::new("xyz").unwrap();
        let url = imp.cubecobra_download_url().unwrap();
        assert_eq!(url, "https://cubecobra.com/cube/download/forge/xyz");
    }
}
