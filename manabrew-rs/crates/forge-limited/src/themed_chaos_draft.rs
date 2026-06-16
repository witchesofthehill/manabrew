#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ThemedChaosDraft {
    pub tag: String,
    pub label: String,
    pub order_number: i32,
}

impl ThemedChaosDraft {
    pub fn new(tag: impl Into<String>, label: impl Into<String>, order_number: i32) -> Self {
        Self {
            tag: tag.into(),
            label: label.into(),
            order_number,
        }
    }

    pub fn parse_line(line: &str) -> Option<Self> {
        let mut parts = line.splitn(3, ',');
        let order = parts.next()?.trim().parse().ok()?;
        let tag = parts.next()?.trim().to_string();
        let label = parts.next()?.trim().to_string();
        if tag.is_empty() || label.is_empty() {
            return None;
        }
        Some(Self::new(tag, label, order))
    }

    pub fn parse_all(body: &str) -> Vec<Self> {
        let mut out: Vec<Self> = body
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .filter_map(Self::parse_line)
            .collect();
        out.sort();
        out
    }
}

impl Ord for ThemedChaosDraft {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        match self.order_number.cmp(&other.order_number) {
            std::cmp::Ordering::Equal => self.label.cmp(&other.label),
            ord => ord,
        }
    }
}

impl PartialOrd for ThemedChaosDraft {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chaosdrafts_body() {
        let body = "\
            # comment\n\
            10, MODERN, Modern Sets Only\n\
            5, DEFAULT, All 15-card Boosters\n\
            \n\
            20, ZENDIKAR, Zendikar Block\n";
        let themes = ThemedChaosDraft::parse_all(body);
        assert_eq!(themes.len(), 3);
        assert_eq!(themes[0].tag, "DEFAULT");
        assert_eq!(themes[1].tag, "MODERN");
        assert_eq!(themes[2].tag, "ZENDIKAR");
    }

    #[test]
    fn skips_invalid_lines() {
        let body = "not,enough\nbad order,X,Y\n5,GOOD,Good Theme\n";
        let themes = ThemedChaosDraft::parse_all(body);
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].tag, "GOOD");
    }
}
