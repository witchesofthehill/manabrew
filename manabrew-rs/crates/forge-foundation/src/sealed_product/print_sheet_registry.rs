use std::collections::HashMap;
use std::sync::RwLock;

use super::print_sheet::PrintSheet;

static REGISTRY: RwLock<RegistryInner> = RwLock::new(RegistryInner::new());

struct RegistryInner {
    by_name: Option<HashMap<String, PrintSheet>>,
}

impl RegistryInner {
    const fn new() -> Self {
        Self { by_name: None }
    }
}

pub fn install(sheets: HashMap<String, PrintSheet>) {
    let mut guard = REGISTRY.write().expect("print sheet registry poisoned");
    guard.by_name = Some(sheets);
}

pub fn register(name: impl Into<String>, sheet: PrintSheet) {
    let mut guard = REGISTRY.write().expect("print sheet registry poisoned");
    guard
        .by_name
        .get_or_insert_with(HashMap::new)
        .insert(name.into(), sheet);
}

pub fn clear() {
    let mut guard = REGISTRY.write().expect("print sheet registry poisoned");
    guard.by_name = None;
}

pub fn get(name: &str) -> Option<PrintSheet> {
    let guard = REGISTRY.read().expect("print sheet registry poisoned");
    let table = guard.by_name.as_ref()?;
    if let Some(sheet) = table.get(name) {
        return Some(sheet.clone());
    }
    let key = name.to_ascii_lowercase();
    for (k, v) in table.iter() {
        if k.eq_ignore_ascii_case(&key) {
            return Some(v.clone());
        }
    }
    None
}

pub fn is_populated() -> bool {
    let guard = REGISTRY.read().expect("print sheet registry poisoned");
    guard.by_name.as_ref().is_some_and(|t| !t.is_empty())
}
