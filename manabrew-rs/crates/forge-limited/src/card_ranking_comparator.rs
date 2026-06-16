use std::cmp::Ordering;

use forge_foundation::sealed_product::PaperCard;

pub struct CardRankingComparator;

impl CardRankingComparator {
    pub fn compare(a: &(f64, PaperCard), b: &(f64, PaperCard)) -> Ordering {
        match b.0.partial_cmp(&a.0) {
            Some(o) if o != Ordering::Equal => o,
            _ => a.1.name.cmp(&b.1.name),
        }
    }

    pub fn sort(entries: &mut Vec<(f64, PaperCard)>) {
        entries.sort_by(Self::compare);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::sealed_product::Rarity;

    fn entry(score: f64, name: &str) -> (f64, PaperCard) {
        (score, PaperCard::new(name, "TST", "1", Rarity::Common))
    }

    #[test]
    fn sorts_high_score_first() {
        let mut v = vec![entry(0.5, "low"), entry(0.9, "high"), entry(0.7, "mid")];
        CardRankingComparator::sort(&mut v);
        assert_eq!(v[0].1.name, "high");
        assert_eq!(v[1].1.name, "mid");
        assert_eq!(v[2].1.name, "low");
    }

    #[test]
    fn breaks_ties_alphabetically() {
        let mut v = vec![entry(0.5, "Bear"), entry(0.5, "Apple")];
        CardRankingComparator::sort(&mut v);
        assert_eq!(v[0].1.name, "Apple");
    }
}
