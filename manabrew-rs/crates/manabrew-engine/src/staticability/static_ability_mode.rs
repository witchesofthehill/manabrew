//! Parsing helpers for `StaticMode`. Mirrors Java
//! `StaticAbilityMode.smartValueOf` / `setValueOf`.

pub use crate::staticability::StaticMode;

/// Mirrors Java `StaticAbilityMode.smartValueOf(value)`. Case-insensitive
/// (Java uses `compareToIgnoreCase`); unrecognised values are returned as
/// `StaticMode::Other(<original casing>)` rather than throwing.
pub fn smart_value_of(value: &str) -> StaticMode {
    value.trim().parse().unwrap_or_else(|_| {
        // StaticMode derives `EnumString` with a default `Other(String)` variant,
        // so this is only a defensive fallback if that derive contract changes.
        StaticMode::Other(value.trim().to_string())
    })
}

/// Mirrors Java `StaticAbilityMode.setValueOf(values)`: split on `[, ]+`,
/// dedup while preserving order.
pub fn set_value_of(values: &str) -> Vec<StaticMode> {
    let mut out: Vec<StaticMode> = Vec::new();
    for token in values
        .split(|c: char| c == ',' || c.is_whitespace())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let parsed = smart_value_of(token);
        if !out.contains(&parsed) {
            out.push(parsed);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_value_of_known_modes() {
        assert_eq!(smart_value_of("Continuous"), StaticMode::Continuous);
        assert_eq!(smart_value_of("CantAttack"), StaticMode::CantAttack);
        assert_eq!(smart_value_of("RaiseCost"), StaticMode::RaiseCost);
    }

    #[test]
    fn smart_value_of_is_case_insensitive() {
        assert_eq!(smart_value_of("continuous"), StaticMode::Continuous);
        assert_eq!(smart_value_of("CANTATTACK"), StaticMode::CantAttack);
        assert_eq!(smart_value_of("RaIsEcOsT"), StaticMode::RaiseCost);
    }

    #[test]
    fn smart_value_of_unknown_keeps_original_casing() {
        assert_eq!(
            smart_value_of("Whatever"),
            StaticMode::Other("Whatever".to_string())
        );
    }

    #[test]
    fn smart_value_of_recognises_late_added_java_modes() {
        assert_eq!(smart_value_of("OptionalCost"), StaticMode::OptionalCost);
        assert_eq!(
            smart_value_of("PlayerMustAttack"),
            StaticMode::PlayerMustAttack
        );
        assert_eq!(
            smart_value_of("AttackRequirement"),
            StaticMode::AttackRequirement
        );
    }

    #[test]
    fn set_value_of_comma() {
        assert_eq!(
            set_value_of("CantAttack,CantBlock"),
            vec![StaticMode::CantAttack, StaticMode::CantBlock]
        );
    }

    #[test]
    fn set_value_of_space() {
        assert_eq!(
            set_value_of("CantAttack CantBlock"),
            vec![StaticMode::CantAttack, StaticMode::CantBlock]
        );
    }

    #[test]
    fn set_value_of_three_modes() {
        assert_eq!(
            set_value_of("CantAttack,CantBlock,CantBeActivated"),
            vec![
                StaticMode::CantAttack,
                StaticMode::CantBlock,
                StaticMode::CantBeActivated,
            ]
        );
    }

    #[test]
    fn set_value_of_continuous_combo() {
        assert_eq!(
            set_value_of("Continuous,CantPlayLand,CantBeCast"),
            vec![
                StaticMode::Continuous,
                StaticMode::CantPlayLand,
                StaticMode::CantBeCast,
            ]
        );
    }

    #[test]
    fn set_value_of_preserves_unknown_per_token() {
        assert_eq!(
            set_value_of("CantAttack,Bogus"),
            vec![
                StaticMode::CantAttack,
                StaticMode::Other("Bogus".to_string()),
            ]
        );
    }

    #[test]
    fn set_value_of_dedups() {
        assert_eq!(
            set_value_of("CantAttack,CantAttack"),
            vec![StaticMode::CantAttack]
        );
    }
}
