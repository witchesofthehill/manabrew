use std::collections::HashMap;

pub struct ReadDraftRankings;

impl ReadDraftRankings {
    pub fn parse(body: &str) -> HashMap<String, u32> {
        let mut out = HashMap::new();
        for line in body.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let mut parts = trimmed.split('|');
            let rank_str = match parts.next() {
                Some(s) => s.trim(),
                None => continue,
            };
            let name = match parts.next() {
                Some(s) => s.trim(),
                None => continue,
            };
            let rank: u32 = match rank_str.parse() {
                Ok(n) => n,
                Err(_) => continue,
            };
            if name.is_empty() {
                continue;
            }
            out.insert(name.to_lowercase(), rank);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_simple_rnk_body() {
        let body = "\
            # Comment line\n\
            1|Lightning Bolt|C|M11\n\
            2|Shock|C|M21\n\
            3|Hill Giant|C|M14\n";
        let ranks = ReadDraftRankings::parse(body);
        assert_eq!(ranks.len(), 3);
        assert_eq!(ranks.get("lightning bolt"), Some(&1));
        assert_eq!(ranks.get("shock"), Some(&2));
        assert_eq!(ranks.get("hill giant"), Some(&3));
    }

    #[test]
    fn ignores_blank_lines_and_bad_lines() {
        let body = "\
            \n\
            not a rank line\n\
            12|Counterspell|U|MMA\n\
            \n";
        let ranks = ReadDraftRankings::parse(body);
        assert_eq!(ranks.len(), 1);
        assert_eq!(ranks.get("counterspell"), Some(&12));
    }
}
