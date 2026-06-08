// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
//
// Type-independent evaluation core shared by both the in-process agent (over
// engine `Card`s) and the protocol bot (over `CardDto`s). Each caller impls
// `CreatureStats` for its own card type; the heuristics below are written once.

pub trait CreatureStats {
    fn power(&self) -> i32;
    fn toughness(&self) -> i32;
    fn has_kw(&self, kw: &str) -> bool;
    fn tapped(&self) -> bool;
}

#[derive(Debug, Clone)]
pub struct KeywordBonuses {
    pub flying_mult: f64,
    pub trample_mult: f64,
    pub deathtouch_flat: f64,
    pub lifelink_mult: f64,
    pub hexproof_flat: f64,
    pub indestructible_flat: f64,
    pub first_strike_mult: f64,
    pub vigilance_flat: f64,
    pub menace_mult: f64,
    pub tapped_penalty: f64,
}

impl Default for KeywordBonuses {
    fn default() -> Self {
        Self {
            flying_mult: 1.0,
            trample_mult: 0.5,
            deathtouch_flat: 3.0,
            lifelink_mult: 0.5,
            hexproof_flat: 2.0,
            indestructible_flat: 4.0,
            first_strike_mult: 0.8,
            vigilance_flat: 1.0,
            menace_mult: 0.5,
            tapped_penalty: 1.5,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrategicIntent {
    PushLethal,
    Stabilize,
    PreserveAdvantage,
    Develop,
}

pub fn creature_combat_value<C: CreatureStats>(c: &C, b: &KeywordBonuses) -> f64 {
    let power = c.power() as f64;
    let toughness = c.toughness() as f64;
    let mut value = power * 1.5 + toughness;

    if c.has_kw("Flying") {
        value += power * b.flying_mult;
    }
    if c.has_kw("Trample") {
        value += power * b.trample_mult;
    }
    if c.has_kw("Deathtouch") {
        value += b.deathtouch_flat;
    }
    if c.has_kw("Lifelink") {
        value += power * b.lifelink_mult;
    }
    if c.has_kw("Hexproof") {
        value += b.hexproof_flat;
    }
    if c.has_kw("Indestructible") {
        value += b.indestructible_flat;
    }
    if c.has_kw("First Strike") || c.has_kw("Double Strike") {
        value += power * b.first_strike_mult;
    }
    if c.has_kw("Vigilance") {
        value += b.vigilance_flat;
    }
    if c.has_kw("Menace") {
        value += power * b.menace_mult;
    }

    value
}

pub fn evaluate_creature<C: CreatureStats>(c: &C, b: &KeywordBonuses) -> f64 {
    let mut value = creature_combat_value(c, b);
    if c.tapped() {
        value -= b.tapped_penalty;
    }
    value
}
