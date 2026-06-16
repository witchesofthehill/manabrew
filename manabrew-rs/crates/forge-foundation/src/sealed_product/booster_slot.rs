use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoosterSlot {
    slot_name: String,
    base_rarity: Option<String>,
    slot_percentages: Vec<(f64, String)>,
    start_range: f64,
}

impl BoosterSlot {
    pub fn new(slot_name: impl Into<String>) -> Self {
        Self {
            slot_name: slot_name.into(),
            base_rarity: None,
            slot_percentages: Vec::new(),
            start_range: 0.0,
        }
    }

    pub fn slot_name(&self) -> &str {
        &self.slot_name
    }

    pub fn base_rarity(&self) -> Option<&str> {
        self.base_rarity.as_deref()
    }

    pub fn parse_slot(slot_name: impl Into<String>, contents: &[String]) -> Self {
        let mut s = Self::new(slot_name);
        for content in contents {
            let trimmed = content.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let (key, value) = match trimmed.split_once('=') {
                Some(kv) => kv,
                None => continue,
            };
            if key.eq_ignore_ascii_case("Base") {
                s.base_rarity = Some(value.trim().to_string());
            } else if key.eq_ignore_ascii_case("Replace") {
                let mut parts = value.splitn(2, ' ');
                let pct_str = match parts.next() {
                    Some(p) => p.trim().trim_end_matches('%'),
                    None => continue,
                };
                let pct: f64 = match pct_str.parse() {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let target = match parts.next() {
                    Some(t) => t.trim().to_string(),
                    None => continue,
                };
                let normalized = if pct > 1.0 { pct / 100.0 } else { pct };
                s.start_range += normalized;
                s.slot_percentages.push((s.start_range, target));
            }
        }
        s
    }

    pub fn replace_slot<R: Rng + ?Sized>(&self, rng: &mut R) -> Option<String> {
        let rand: f64 = rng.gen_range(0.0..1.0);
        for (key, value) in &self.slot_percentages {
            if rand < *key {
                return Some(value.clone());
            }
        }
        self.base_rarity.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn rolls_match_replacement_distribution() {
        let slot = BoosterSlot::parse_slot(
            "RareMythic",
            &[
                "Base=RareMythic".to_string(),
                "Replace=5% Special".to_string(),
                "Replace=10% dfc".to_string(),
            ],
        );
        let mut rng = StdRng::seed_from_u64(0);
        let mut special = 0;
        let mut dfc = 0;
        let mut base = 0;
        for _ in 0..10_000 {
            match slot.replace_slot(&mut rng).as_deref() {
                Some("Special") => special += 1,
                Some("dfc") => dfc += 1,
                _ => base += 1,
            }
        }
        assert!((special as f64 / 10_000.0 - 0.05).abs() < 0.02);
        assert!((dfc as f64 / 10_000.0 - 0.10).abs() < 0.02);
        assert!(base > 8000);
    }
}
