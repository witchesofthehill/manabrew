/// Mirrors Java's `AttackRestrictionType.java`.
/// Tracks conditions under which a creature cannot legally attack.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AttackRestrictionType {
    /// Creature can only attack alone (no other attackers allowed).
    OnlyAlone,
    /// Creature can't attack alone (must have at least one other attacker).
    NotAlone,
    /// Creature can't attack unless another attacking creature has greater power.
    NeedGreaterPower,
    /// Creature can't attack unless a black or green creature also attacks.
    NeedBlackOrGreen,
    /// Creature can't attack unless at least two other creatures attack
    /// alongside it.
    NeedTwoOthers,
    /// Creature can never attack (e.g. "CARDNAME can't attack").
    Never,
}
