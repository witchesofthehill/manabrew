use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::deck_dto::{Deck, DeckFormat};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hub/index.ts")]
pub struct PublishDeckRequest {
    pub author: String,
    pub deck: Deck,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hub/index.ts")]
pub struct PublishDeckResponse {
    pub id: String,
    pub management_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hub/index.ts")]
pub struct HubDeckSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
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
#[ts(export, export_to = "hub/index.ts")]
pub struct HubDeckList {
    pub decks: Vec<HubDeckSummary>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hub/index.ts")]
pub struct HubDeckDetail {
    #[serde(flatten)]
    #[ts(flatten)]
    pub summary: HubDeckSummary,
    pub deck: Deck,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hub/index.ts")]
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
