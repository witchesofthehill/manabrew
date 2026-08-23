use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt::Write;
use ts_rs::TS;

use crate::{game::PlaymatSettings, TokenScript};

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
    pub oracle_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub token_script: Option<TokenScript>,
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
    /// Back face of a transform / modal_dfc card, captured at deck import.
    /// Absent on single-faced cards and on decks saved before it existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub back_face: Option<CardBackFaceSummary>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardBackFaceSummary {
    pub name: String,
    #[serde(default)]
    pub mana_cost: String,
    #[serde(default)]
    pub type_line: String,
    #[serde(default)]
    pub oracle_text: String,
    #[serde(default)]
    pub uris: CardImageUris,
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

pub const OUTDATED_CLIENT_MESSAGE: &str =
    "this app version is out of date — download the latest release at manabrew.app to play online";

// Clients ≤ v0.5.2 serialize the identity fields flattened onto the card.
// Their gameplay wire (game view, prompts) has drifted too, so the legacy
// shape is detected and rejected with an actionable message rather than
// accepted into a game the client could not parse.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeckCardWire {
    #[serde(default)]
    identity: Option<DeckCardIdentity>,
    #[serde(default)]
    name: Option<String>,
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
            None if wire.name.is_some() => {
                return Err(serde::de::Error::custom(OUTDATED_CLIENT_MESSAGE));
            }
            None => return Err(serde::de::Error::missing_field("identity")),
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckEditorTag {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckEditorGroup {
    pub id: String,
    pub name: String,
    pub card_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub collapsed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pinned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckEditorGroupBy {
    Type,
    Cmc,
    Color,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckEditorSortBy {
    #[serde(rename = "name")]
    Name,
    #[serde(rename = "mana-value")]
    ManaValue,
    #[serde(rename = "quantity")]
    Quantity,
    #[serde(rename = "owned")]
    Owned,
    #[serde(rename = "not-owned")]
    NotOwned,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckEditorViewMode {
    List,
    Visual,
    Stack,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckEditorCollectionFilter {
    All,
    Exact,
    Other,
    Partial,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckEditorDestination {
    Main,
    Side,
    Maybe,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckEditorLayout {
    pub id: String,
    pub name: String,
    pub group_by: DeckEditorGroupBy,
    pub sort_by: DeckEditorSortBy,
    pub groups: Vec<DeckEditorGroup>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub filter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub card_size: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub view_mode: Option<DeckEditorViewMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub collection_filter: Option<DeckEditorCollectionFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default_destination: Option<DeckEditorDestination>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckPriceProvider {
    Tcgplayer,
    Cardmarket,
    Cardhoarder,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum DeckAcquisitionStatus {
    Ordered,
    Proxy,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckSideboardPlan {
    pub id: String,
    pub matchup: String,
    pub bring_in: String,
    pub take_out: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckEditorGoals {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub min_lands: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_lands: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_missing_cards: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_average_mana_value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, number>")]
    pub tag_targets: Option<BTreeMap<String, u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub struct DeckEditorMetadata {
    pub version: u32,
    #[serde(default)]
    pub tags: Vec<DeckEditorTag>,
    #[serde(default)]
    pub layouts: Vec<DeckEditorLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub active_layout_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sideboard_plans: Option<Vec<DeckSideboardPlan>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub budget_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub budget_amount: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub price_provider: Option<DeckPriceProvider>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub goals: Option<DeckEditorGoals>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dismissed_hints: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, \"ordered\" | \"proxy\">")]
    pub acquisition: Option<BTreeMap<String, DeckAcquisitionStatus>>,
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
    pub custom_tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, Array<string>>")]
    pub card_tags: Option<BTreeMap<String, Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub editor: Option<DeckEditorMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_face: Option<u8>,
    /// The hub fills this from `playmat_asset_id` and ignores whatever a write
    /// supplies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub playmat_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub playmat_asset_id: Option<String>,
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

pub fn deck_fingerprint(deck: &Deck) -> String {
    let mut hasher = Sha256::new();
    update_fingerprint(&mut hasher, &deck.name);
    update_fingerprint(
        &mut hasher,
        &serde_json::to_string(&deck.format).unwrap_or_default(),
    );
    let mut cards = Vec::new();
    cards.extend(deck.cards.iter().map(|card| ("main", card)));
    cards.extend(deck.sideboard.iter().map(|card| ("sideboard", card)));
    cards.extend(
        deck.attractions
            .iter()
            .flatten()
            .map(|card| ("attraction", card)),
    );
    cards.extend(
        deck.contraptions
            .iter()
            .flatten()
            .map(|card| ("contraption", card)),
    );
    cards.extend(deck.schemes.iter().flatten().map(|card| ("scheme", card)));
    cards.extend(deck.planes.iter().flatten().map(|card| ("plane", card)));
    cards.extend(
        deck.commanders
            .iter()
            .flatten()
            .map(|card| ("commander", card)),
    );
    cards.extend(deck.companion.iter().map(|card| ("companion", card)));
    cards.sort_by(|(left_section, left), (right_section, right)| {
        (
            left_section,
            &left.identity.name,
            &left.identity.set_code,
            &left.identity.card_number,
        )
            .cmp(&(
                right_section,
                &right.identity.name,
                &right.identity.set_code,
                &right.identity.card_number,
            ))
    });
    for (section, card) in cards {
        update_fingerprint(&mut hasher, section);
        update_fingerprint(&mut hasher, &card.identity.name);
        update_fingerprint(&mut hasher, &card.identity.set_code);
        update_fingerprint(&mut hasher, &card.identity.card_number);
    }
    let digest = hasher.finalize();
    let mut fingerprint = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(fingerprint, "{byte:02x}");
    }
    fingerprint
}

fn update_fingerprint(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u64).to_le_bytes());
    hasher.update(value.as_bytes());
}
