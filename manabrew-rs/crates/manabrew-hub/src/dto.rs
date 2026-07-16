use manabrew_protocol::deck_dto::{Deck, DeckFormat};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct PublishDeckRequest {
    pub author: String,
    #[ts(type = "Deck")]
    pub deck: Deck,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct PublishDeckResponse {
    pub id: String,
    pub management_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct HubDeckSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "DeckFormat")]
    pub format: Option<DeckFormat>,
    #[serde(default)]
    pub commanders: Vec<String>,
    #[serde(default)]
    pub colors: String,
    pub card_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_image_url: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct HubDeckList {
    pub decks: Vec<HubDeckSummary>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct HubDeckDetail {
    #[serde(flatten)]
    #[ts(flatten)]
    pub summary: HubDeckSummary,
    #[ts(type = "Deck")]
    pub deck: Deck,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct TopDeckStat {
    pub deck_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub commander: Option<String>,
    pub plays: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_played: Option<String>,
}
