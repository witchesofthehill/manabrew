//! PhaseType — turn phases/steps.
//!
//! Mirrors Java's `PhaseType.java`.
//! The core enum lives in `forge_foundation::PhaseType`; this module
//! re-exports it and adds phase-module-specific helper functions.

pub use forge_foundation::PhaseType;

use std::collections::HashSet;

/// Phase group index — maps each phase to its parent group.
/// Mirrors Java's `PHASE_INDEX` map.
///
/// Groups: 0=Beginning (Untap/Upkeep/Draw), 1=Main1, 2=Combat,
///         3=Main2, 4=EndOfTurn, 5=Cleanup
pub fn phase_group_index(phase: PhaseType) -> usize {
    match phase {
        PhaseType::Untap | PhaseType::Upkeep | PhaseType::Draw => 0,
        PhaseType::Main1 => 1,
        PhaseType::CombatBegin
        | PhaseType::CombatDeclareAttackers
        | PhaseType::CombatDeclareBlockers
        | PhaseType::CombatFirstStrikeDamage
        | PhaseType::CombatDamage
        | PhaseType::CombatEnd => 2,
        PhaseType::Main2 => 3,
        PhaseType::EndOfTurn => 4,
        PhaseType::Cleanup => 5,
    }
}

/// Parse a range of phases from a comma-separated string.
/// Supports "Phase1->Phase2" range syntax and "Main" alias for Main1+Main2.
/// Mirrors Java's `PhaseType.parseRange()`.
pub fn parse_range(values: &str) -> HashSet<PhaseType> {
    let mut result = HashSet::new();
    for s in values.split(',') {
        let s = s.trim();
        if let Some(idx) = s.find("->") {
            let from_str = &s[..idx];
            let to_str = &s[idx + 2..];
            let from = smart_value_of(from_str);
            let to = if to_str.trim().is_empty() {
                Some(PhaseType::Cleanup)
            } else {
                smart_value_of(to_str)
            };
            if let (Some(from), Some(to)) = (from, to) {
                let from_idx = from.index();
                let to_idx = to.index();
                for &phase in &PhaseType::TURN_ORDER[from_idx..=to_idx] {
                    result.insert(phase);
                }
            }
        } else if s.eq_ignore_ascii_case("Main") {
            result.insert(PhaseType::Main1);
            result.insert(PhaseType::Main2);
        } else if let Some(phase) = smart_value_of(s) {
            result.insert(phase);
        }
    }
    result
}

/// Parse a phase type from a string, matching by script name or enum name.
/// Mirrors Java's `PhaseType.smartValueOf()`.
pub fn smart_value_of(value: &str) -> Option<PhaseType> {
    PhaseType::from_script_name(value)
}

/// Returns true if this is the last phase in the turn.
/// Mirrors Java's `PhaseType.isLast()`.
pub fn is_last(phase: PhaseType) -> bool {
    phase == PhaseType::Cleanup
}

/// Get the next phase, optionally with reversed phase order (Topsy Turvy).
/// Mirrors Java's `PhaseType.getNext(current, isTopsy)`.
pub fn get_next(phase: PhaseType, is_topsy: bool) -> PhaseType {
    if is_topsy {
        let idx = phase.index();
        if idx == 0 {
            PhaseType::TURN_ORDER[PhaseType::TURN_ORDER.len() - 1]
        } else {
            PhaseType::TURN_ORDER[idx - 1]
        }
    } else {
        phase.next()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_simple() {
        let result = parse_range("Upkeep");
        assert!(result.contains(&PhaseType::Upkeep));
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn parse_range_main_alias() {
        let result = parse_range("Main");
        assert!(result.contains(&PhaseType::Main1));
        assert!(result.contains(&PhaseType::Main2));
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn parse_range_arrow() {
        let result = parse_range("Upkeep->Main1");
        assert!(result.contains(&PhaseType::Upkeep));
        assert!(result.contains(&PhaseType::Draw));
        assert!(result.contains(&PhaseType::Main1));
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn smart_value_of_test() {
        assert_eq!(smart_value_of("BeginCombat"), Some(PhaseType::CombatBegin));
        assert_eq!(smart_value_of("End of Turn"), Some(PhaseType::EndOfTurn));
    }

    #[test]
    fn is_last_test() {
        assert!(is_last(PhaseType::Cleanup));
        assert!(!is_last(PhaseType::EndOfTurn));
    }

    #[test]
    fn get_next_normal() {
        assert_eq!(get_next(PhaseType::Untap, false), PhaseType::Upkeep);
        assert_eq!(get_next(PhaseType::Cleanup, false), PhaseType::Untap);
    }

    #[test]
    fn get_next_topsy() {
        assert_eq!(get_next(PhaseType::Upkeep, true), PhaseType::Untap);
        assert_eq!(get_next(PhaseType::Untap, true), PhaseType::Cleanup);
    }
}
