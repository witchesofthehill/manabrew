//! ZoneType — game zone types.
//!
//! Mirrors Java's `ZoneType.java`.
//! The core enum lives in `forge_foundation::ZoneType`; this module
//! re-exports it and adds zone-module-specific helper functions.

pub use forge_foundation::ZoneType;

/// Whether this zone holds hidden information.
/// Mirrors Java's `ZoneType.isHidden()`.
pub fn is_hidden(zone: ZoneType) -> bool {
    zone.is_hidden()
}

/// Whether this zone holds known (public) information.
/// Mirrors Java's `ZoneType.isKnown()`.
pub fn is_known(zone: ZoneType) -> bool {
    zone.is_known()
}

/// Parse a zone type from a string.
/// Mirrors Java's `ZoneType.smartValueOf()`.
pub fn smart_value_of(value: &str) -> Option<ZoneType> {
    ZoneType::from_str_compat(value)
}

/// Parse a comma/space-separated list of zone types.
/// "All" returns the standard set of zones.
/// Mirrors Java's `ZoneType.listValueOf()`.
pub fn list_value_of(values: &str) -> Vec<ZoneType> {
    if values.trim().eq_ignore_ascii_case("All") {
        return vec![
            ZoneType::Battlefield,
            ZoneType::Hand,
            ZoneType::Graveyard,
            ZoneType::Exile,
            ZoneType::Stack,
            ZoneType::Library,
            ZoneType::Command,
        ];
    }
    let mut result = Vec::new();
    for s in values.split([',', ' ']) {
        let s = s.trim();
        if s.is_empty() {
            continue;
        }
        if let Some(zt) = smart_value_of(s) {
            result.push(zt);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_value_of_test() {
        assert_eq!(smart_value_of("Battlefield"), Some(ZoneType::Battlefield));
        assert_eq!(smart_value_of("Hand"), Some(ZoneType::Hand));
        assert_eq!(smart_value_of("All"), None);
    }

    #[test]
    fn list_value_of_test() {
        let result = list_value_of("Hand,Graveyard");
        assert_eq!(result, vec![ZoneType::Hand, ZoneType::Graveyard]);
    }

    #[test]
    fn list_value_of_all() {
        let result = list_value_of("All");
        assert_eq!(result.len(), 7);
        assert!(result.contains(&ZoneType::Battlefield));
    }
}
