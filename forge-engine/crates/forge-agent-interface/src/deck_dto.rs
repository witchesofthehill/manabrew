//! Wire-format `Deck` exchanged with the UI. Identical shape to
//! `src/types/manabrew.ts` — the engine deserializes only the fields
//! it cares about (cards, sideboard, commanders, supplementary decks)
//! and serde silently drops the rest (UI-only state like
//! `stackPositions`, `customTags`, `coverCardName`, etc.).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardIdentity {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub name: String,
    pub set_code: String,
    pub card_number: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foil: Option<bool>,
}

/// Mirror of `manabrew.ts:CardRulesSummary`. The engine derives most
/// of this from its own card DB; included here so the same wire shape
/// round-trips losslessly.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardRulesSummary {
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub color_identity: Vec<String>,
    #[serde(default)]
    pub mana_cost: String,
    #[serde(default)]
    pub cmc: f32,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub subtypes: Vec<String>,
    #[serde(default)]
    pub supertypes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toughness: Option<String>,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_double_faced: Option<bool>,
}

/// Mirror of `manabrew.ts:DeckCard`. `uris` is deliberately a
/// catch-all `serde_json::Value` — image URLs are UI-only and the
/// engine doesn't model the Scryfall image-uris shape.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckCard {
    #[serde(flatten)]
    pub identity: CardIdentity,
    #[serde(flatten)]
    pub rules: CardRulesSummary,
    #[serde(default)]
    pub uris: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckLabel {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Mirror of `manabrew.ts:Deck`. The engine cares about `cards`,
/// `sideboard`, `commanders`, and the supplementary decks
/// (`attractions`/`contraptions`/`schemes`/`planes`); the rest is UI
/// state preserved here only so the wire shape stays identical.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default)]
    pub cards: Vec<DeckCard>,
    #[serde(default)]
    pub sideboard: Vec<DeckCard>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attractions: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contraptions: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schemes: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub planes: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commanders: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub companion: Option<DeckCard>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maybeboard: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<DeckLabel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_tags: Option<std::collections::HashMap<String, Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_card_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_card_face: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack_positions: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<Vec<DeckCard>>,
}
