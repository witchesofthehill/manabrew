use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::PlaymatSettings;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckCardIdentity {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub name: String,
    pub set_code: String,
    pub card_number: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub foil: Option<bool>,
}

/// Mirror of `manabrew.ts:CardRulesSummary`. The engine derives most
/// of this from its own card DB; included here so the same wire shape
/// round-trips losslessly.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
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
    #[ts(optional)]
    pub keywords: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub power: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub toughness: Option<String>,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_double_faced: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardImageUris {
    #[serde(default)]
    pub small: String,
    #[serde(default)]
    pub normal: String,
    #[serde(default)]
    pub large: String,
    #[serde(default)]
    pub png: String,
    #[serde(default)]
    pub art_crop: String,
    #[serde(default)]
    pub border_crop: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardPartComponent {
    Token,
    ComboPiece,
    MeldPart,
    MeldResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardPart {
    pub name: String,
    pub component: CardPartComponent,
}

/// Mirror of `manabrew.ts:DeckCard`.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckCard {
    pub identity: DeckCardIdentity,
    #[serde(flatten)]
    #[ts(flatten)]
    pub rules: CardRulesSummary,
    #[serde(default)]
    pub uris: CardImageUris,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub all_parts: Option<Vec<CardPart>>,
}

// Wire-compat: clients ≤ v0.5.2 serialize the identity fields flattened onto
// the card instead of nested under `identity`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeckCardWire {
    #[serde(default)]
    identity: Option<DeckCardIdentity>,
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    set_code: Option<String>,
    #[serde(default)]
    card_number: Option<String>,
    #[serde(default)]
    foil: Option<bool>,
    #[serde(flatten)]
    rules: CardRulesSummary,
    #[serde(default)]
    uris: CardImageUris,
    #[serde(default)]
    all_parts: Option<Vec<CardPart>>,
}

impl<'de> Deserialize<'de> for DeckCard {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = DeckCardWire::deserialize(deserializer)?;
        let identity = match wire.identity {
            Some(identity) => identity,
            None => DeckCardIdentity {
                id: wire.id,
                name: wire
                    .name
                    .ok_or_else(|| serde::de::Error::missing_field("identity"))?,
                set_code: wire.set_code.unwrap_or_default(),
                card_number: wire.card_number.unwrap_or_default(),
                foil: wire.foil,
            },
        };
        Ok(DeckCard {
            identity,
            rules: wire.rules,
            uris: wire.uris,
            all_parts: wire.all_parts,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckLabel {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckFormat {
    Standard,
    Pioneer,
    Modern,
    Legacy,
    Vintage,
    Pauper,
    Commander,
    Brawl,
    Oathbreaker,
    Draft,
    Sealed,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct Deck {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub format: Option<DeckFormat>,
    #[serde(default)]
    pub cards: Vec<DeckCard>,
    #[serde(default)]
    pub sideboard: Vec<DeckCard>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attractions: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub contraptions: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schemes: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub planes: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub commanders: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub companion: Option<DeckCard>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub maybeboard: Option<Vec<DeckCard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub draft: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub labels: Option<Vec<DeckLabel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_face: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub playmat: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub playmat_settings: Option<PlaymatSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, { x: number; y: number }>")]
    pub stack_positions: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tokens: Option<Vec<DeckCard>>,
}

#[cfg(test)]
mod wire_compat_tests {
    use super::*;

    #[test]
    fn nested_identity_parses() {
        let card: DeckCard = serde_json::from_str(
            r#"{"identity":{"name":"Plains","setCode":"m21","cardNumber":"260"},"cmc":0,"types":["Land"]}"#,
        ).unwrap();
        assert_eq!(card.identity.name, "Plains");
        assert_eq!(card.identity.set_code, "m21");
    }

    #[test]
    fn legacy_flattened_identity_parses() {
        let card: DeckCard = serde_json::from_str(
            r#"{"id":"x","name":"Plains","setCode":"m21","cardNumber":"260","foil":false,"cmc":0,"types":["Land"],"text":"({T}: Add {W}.)"}"#,
        ).unwrap();
        assert_eq!(card.identity.name, "Plains");
        assert_eq!(card.identity.set_code, "m21");
        assert_eq!(card.identity.id, "x");
        assert_eq!(card.rules.types, vec!["Land"]);
    }

    #[test]
    fn missing_both_fails_with_identity_error() {
        let err = serde_json::from_str::<DeckCard>(r#"{"cmc":0}"#).unwrap_err();
        assert!(err.to_string().contains("identity"));
    }

    #[test]
    fn serialize_stays_nested() {
        let card = DeckCard {
            identity: DeckCardIdentity {
                name: "Plains".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let json = serde_json::to_value(&card).unwrap();
        assert!(json.get("identity").is_some());
        assert!(json.get("name").is_none());
    }
}
