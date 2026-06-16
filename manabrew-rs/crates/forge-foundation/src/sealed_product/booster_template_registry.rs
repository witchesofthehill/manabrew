use std::collections::HashMap;
use std::sync::RwLock;

use super::sealed_template::SealedTemplate;

static REGISTRY: RwLock<RegistryInner> = RwLock::new(RegistryInner::new());

struct RegistryInner {
    by_name: Option<HashMap<String, SealedTemplate>>,
}

impl RegistryInner {
    const fn new() -> Self {
        Self { by_name: None }
    }
}

pub fn install(templates: HashMap<String, SealedTemplate>) {
    let mut guard = REGISTRY
        .write()
        .expect("booster template registry poisoned");
    guard.by_name = Some(templates);
}

pub fn register(name: impl Into<String>, template: SealedTemplate) {
    let mut guard = REGISTRY
        .write()
        .expect("booster template registry poisoned");
    guard
        .by_name
        .get_or_insert_with(HashMap::new)
        .insert(name.into(), template);
}

pub fn clear() {
    let mut guard = REGISTRY
        .write()
        .expect("booster template registry poisoned");
    guard.by_name = None;
}

pub fn get(name: &str) -> Option<SealedTemplate> {
    let guard = REGISTRY.read().expect("booster template registry poisoned");
    let table = guard.by_name.as_ref()?;
    if let Some(t) = table.get(name) {
        return Some(t.clone());
    }
    for (k, v) in table.iter() {
        if k.eq_ignore_ascii_case(name) {
            return Some(v.clone());
        }
    }
    None
}

pub fn is_populated() -> bool {
    let guard = REGISTRY.read().expect("booster template registry poisoned");
    guard.by_name.as_ref().is_some_and(|t| !t.is_empty())
}

pub fn parse_boosters_special(body: &str) -> HashMap<String, SealedTemplate> {
    let mut out = HashMap::new();
    for raw in body.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(template) = SealedTemplate::parse_line(line) {
            if let Some(name) = template.name.clone() {
                out.insert(name, template);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_few_real_lines() {
        let body = "#Prerelease boosters
RTR Prerelease Azorius Guild: 10 Common:fromSheet(\"RTR Azorius Guild\"), 3 Uncommon:fromSheet(\"RTR Azorius Guild\"), 1 RareMythic:fromSheet(\"RTR Azorius Guild\"), 2 promo(\"Azorius GuildGate|RTR\")

# Jump Start
JMP Above the Clouds 1: 1 wholeSheet(\"JMP Above the Clouds 1\")
";
        let map = parse_boosters_special(body);
        assert_eq!(map.len(), 2);
        let pre = map.get("RTR Prerelease Azorius Guild").unwrap();
        assert_eq!(pre.slots.len(), 4);
        assert_eq!(
            pre.slots[0],
            ("Common:fromSheet(\"RTR Azorius Guild\")".into(), 10)
        );
        let jmp = map.get("JMP Above the Clouds 1").unwrap();
        assert_eq!(jmp.slots[0].0, "wholeSheet(\"JMP Above the Clouds 1\")");
    }

    #[test]
    fn install_get_clear_round_trip() {
        clear();
        let body = "X: 1 Any\nY: 1 Common\n";
        install(parse_boosters_special(body));
        assert!(is_populated());
        assert!(get("X").is_some());
        assert!(get("y").is_some());
        clear();
        assert!(!is_populated());
    }
}
