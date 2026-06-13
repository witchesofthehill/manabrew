use serde::{Deserialize, Serialize};

/// Turn phases/steps. Mirrors Java `PhaseType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PhaseType {
    Untap,
    Upkeep,
    Draw,
    Main1,
    CombatBegin,
    CombatDeclareAttackers,
    CombatDeclareBlockers,
    CombatFirstStrikeDamage,
    CombatDamage,
    CombatEnd,
    Main2,
    EndOfTurn,
    Cleanup,
}

impl PhaseType {
    /// The full turn sequence in order.
    pub const TURN_ORDER: [PhaseType; 13] = [
        PhaseType::Untap,
        PhaseType::Upkeep,
        PhaseType::Draw,
        PhaseType::Main1,
        PhaseType::CombatBegin,
        PhaseType::CombatDeclareAttackers,
        PhaseType::CombatDeclareBlockers,
        PhaseType::CombatFirstStrikeDamage,
        PhaseType::CombatDamage,
        PhaseType::CombatEnd,
        PhaseType::Main2,
        PhaseType::EndOfTurn,
        PhaseType::Cleanup,
    ];

    /// Phase groups for grouping related steps.
    pub const BEGINNING_PHASE: [PhaseType; 3] =
        [PhaseType::Untap, PhaseType::Upkeep, PhaseType::Draw];

    pub const COMBAT_PHASE: [PhaseType; 6] = [
        PhaseType::CombatBegin,
        PhaseType::CombatDeclareAttackers,
        PhaseType::CombatDeclareBlockers,
        PhaseType::CombatFirstStrikeDamage,
        PhaseType::CombatDamage,
        PhaseType::CombatEnd,
    ];

    pub fn is_main(self) -> bool {
        matches!(self, PhaseType::Main1 | PhaseType::Main2)
    }

    pub fn is_combat(self) -> bool {
        matches!(
            self,
            PhaseType::CombatBegin
                | PhaseType::CombatDeclareAttackers
                | PhaseType::CombatDeclareBlockers
                | PhaseType::CombatFirstStrikeDamage
                | PhaseType::CombatDamage
                | PhaseType::CombatEnd
        )
    }

    /// Index in the turn order (0-12).
    pub fn index(self) -> usize {
        Self::TURN_ORDER.iter().position(|&p| p == self).unwrap()
    }

    /// Get the next phase in the turn sequence. Wraps from Cleanup -> Untap.
    pub fn next(self) -> PhaseType {
        let idx = self.index();
        Self::TURN_ORDER[(idx + 1) % Self::TURN_ORDER.len()]
    }

    pub fn is_before(self, other: PhaseType) -> bool {
        self.index() < other.index()
    }

    pub fn is_after(self, other: PhaseType) -> bool {
        self.index() > other.index()
    }

    /// Parse a frontend step string (e.g. "main1", "declare_attackers") to PhaseType.
    pub fn from_step_string(s: &str) -> Option<Self> {
        match s {
            "untap" => Some(PhaseType::Untap),
            "upkeep" => Some(PhaseType::Upkeep),
            "draw" => Some(PhaseType::Draw),
            "main1" => Some(PhaseType::Main1),
            "begin_combat" => Some(PhaseType::CombatBegin),
            "declare_attackers" => Some(PhaseType::CombatDeclareAttackers),
            "declare_blockers" => Some(PhaseType::CombatDeclareBlockers),
            "first_strike_damage" => Some(PhaseType::CombatFirstStrikeDamage),
            "combat_damage" => Some(PhaseType::CombatDamage),
            "end_combat" => Some(PhaseType::CombatEnd),
            "main2" => Some(PhaseType::Main2),
            "end" => Some(PhaseType::EndOfTurn),
            "cleanup" => Some(PhaseType::Cleanup),
            _ => None,
        }
    }

    /// Script-compatible name used in card definition files.
    pub fn script_name(self) -> &'static str {
        match self {
            PhaseType::Untap => "Untap",
            PhaseType::Upkeep => "Upkeep",
            PhaseType::Draw => "Draw",
            PhaseType::Main1 => "Main1",
            PhaseType::CombatBegin => "BeginCombat",
            PhaseType::CombatDeclareAttackers => "Declare Attackers",
            PhaseType::CombatDeclareBlockers => "Declare Blockers",
            PhaseType::CombatFirstStrikeDamage => "First Strike Damage",
            PhaseType::CombatDamage => "Combat Damage",
            PhaseType::CombatEnd => "EndCombat",
            PhaseType::Main2 => "Main2",
            PhaseType::EndOfTurn => "End of Turn",
            PhaseType::Cleanup => "Cleanup",
        }
    }

    pub fn from_script_name(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.eq_ignore_ascii_case("EndStep") || s.eq_ignore_ascii_case("EndOfTurnStep") {
            return Some(PhaseType::EndOfTurn);
        }
        for &phase in &Self::TURN_ORDER {
            if phase.script_name().eq_ignore_ascii_case(s)
                || format!("{:?}", phase).eq_ignore_ascii_case(s)
            {
                return Some(phase);
            }
        }
        // "Main" matches both main phases — return Main1 as default
        if s.eq_ignore_ascii_case("Main") {
            return Some(PhaseType::Main1);
        }
        None
    }

    pub fn parse_range(values: &str) -> Vec<Self> {
        let mut result: Vec<Self> = Vec::new();
        let mut push = |phase: PhaseType, result: &mut Vec<Self>| {
            if !result.contains(&phase) {
                result.push(phase);
            }
        };
        for s in values.split(',') {
            let s = s.trim();
            if let Some(idx) = s.find("->") {
                let from = Self::from_script_name(&s[..idx]);
                let to_str = s[idx + 2..].trim();
                let to = if to_str.is_empty() {
                    Some(PhaseType::Cleanup)
                } else {
                    Self::from_script_name(to_str)
                };
                if let (Some(from), Some(to)) = (from, to) {
                    let mut in_range = false;
                    for &phase in &Self::TURN_ORDER {
                        if phase == from {
                            in_range = true;
                        }
                        if in_range {
                            push(phase, &mut result);
                        }
                        if phase == to {
                            break;
                        }
                    }
                }
            } else if s.eq_ignore_ascii_case("Main") {
                push(PhaseType::Main1, &mut result);
                push(PhaseType::Main2, &mut result);
            } else if let Some(phase) = Self::from_script_name(s) {
                push(phase, &mut result);
            }
        }
        result
    }
}

impl std::fmt::Display for PhaseType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.script_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_order() {
        assert_eq!(PhaseType::Untap.next(), PhaseType::Upkeep);
        assert_eq!(PhaseType::Cleanup.next(), PhaseType::Untap);
    }

    #[test]
    fn is_before_after() {
        assert!(PhaseType::Untap.is_before(PhaseType::Draw));
        assert!(PhaseType::Main2.is_after(PhaseType::Main1));
    }

    #[test]
    fn script_names() {
        assert_eq!(
            PhaseType::from_script_name("BeginCombat"),
            Some(PhaseType::CombatBegin)
        );
        assert_eq!(
            PhaseType::from_script_name("End of Turn"),
            Some(PhaseType::EndOfTurn)
        );
    }
}
