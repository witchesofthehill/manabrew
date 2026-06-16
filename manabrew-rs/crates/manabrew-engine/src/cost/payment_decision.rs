//! Payment decision data — the intermediary between deciding and executing cost payment.
//!
//! Mirrors Java's `forge.game.cost.PaymentDecision`.
//!
//! A `PaymentDecision` captures *what* was chosen to pay a particular `CostPart`,
//! without yet executing the payment. The engine's `CostPayment` orchestrator
//! collects decisions from the agent, then executes them via `pay_as_decided`.

use forge_foundation::color::Color;

use crate::ids::CardId;

/// The result of an agent deciding how to pay a single `CostPart`.
///
/// Mirrors Java's `PaymentDecision` class, which has factory methods:
/// `number(int)`, `card(Card)`, `card(Iterable<Card>)`, `type(String)`,
/// `colors(ColorSet)`, `mana(List<Mana>)`, `players(List<Player>)`, etc.
#[derive(Debug, Clone)]
pub enum PaymentDecision {
    /// A numeric decision (e.g. pay N life, N energy, N damage).
    /// Mirrors `PaymentDecision.number(int)`.
    Number(i32),

    /// One or more cards chosen for payment (sacrifice, discard, exile, etc.).
    /// Mirrors `PaymentDecision.card(Card)` / `card(Iterable<Card>)`.
    Cards(Vec<CardId>),

    /// A type name chosen (e.g. creature type for `CostChooseCreatureType`).
    /// Mirrors `PaymentDecision.type(String)`.
    Type(String),

    /// One or more colors chosen (e.g. for `CostChooseColor`).
    /// Mirrors `PaymentDecision.colors(ColorSet)`.
    Colors(Vec<Color>),

    /// No decision needed — the cost part is automatically payable
    /// (e.g. `CostTap`, `CostUntap`, `CostAddMana`).
    None,
}

impl PaymentDecision {
    pub fn number(n: i32) -> Self {
        PaymentDecision::Number(n)
    }

    pub fn card(card: CardId) -> Self {
        PaymentDecision::Cards(vec![card])
    }

    pub fn cards(cards: Vec<CardId>) -> Self {
        PaymentDecision::Cards(cards)
    }

    pub fn type_choice(choice: String) -> Self {
        PaymentDecision::Type(choice)
    }

    pub fn colors(choices: Vec<Color>) -> Self {
        PaymentDecision::Colors(choices)
    }

    pub fn mana(_symbols: Vec<String>) -> Self {
        PaymentDecision::None
    }

    pub fn players(_players: Vec<crate::ids::PlayerId>) -> Self {
        PaymentDecision::None
    }

    pub fn spellabilities(_ids: Vec<CardId>) -> Self {
        PaymentDecision::None
    }

    pub fn counters(_entries: Vec<(CardId, String, i32)>) -> Self {
        PaymentDecision::None
    }

    pub fn none() -> Self {
        PaymentDecision::None
    }
}
