use manabrew_protocol::deck_dto::{Deck, DeckFormat};
use manabrew_protocol::game::EngineKind;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct HubCapabilities {
    pub account_decks: bool,
    pub tags: bool,
    pub favorites: bool,
    pub top_deck_snapshots: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct CardCollectionEntry {
    pub card_key: String,
    pub quantity: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct CardCollection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<u32>,
    pub cards: Vec<CardCollectionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct CardPrintingIdentifier {
    pub name: String,
    pub set_code: String,
    pub collector_number: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub foil: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct VerifyCardPrintingsRequest {
    pub identifiers: Vec<CardPrintingIdentifier>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct VerifyCardPrintingsResponse {
    pub matched: Vec<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckPlayReportRequest {
    pub report_id: String,
    pub deckhub_entry_id: String,
    pub deck_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "DeckFormat")]
    pub format: Option<DeckFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct CreateAccountDeckRequest {
    #[ts(type = "Deck")]
    pub deck: Deck,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct SaveDeckVersionRequest {
    #[ts(type = "Deck")]
    pub deck: Deck,
    pub expected_version_no: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountDeckSummary {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "DeckFormat")]
    pub format: Option<DeckFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub visibility: String,
    pub current_version_id: String,
    pub current_version_no: u32,
    pub publication_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub derived_from_preset_key: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountDeckList {
    pub decks: Vec<AccountDeckSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountDeckDetail {
    #[serde(flatten)]
    #[ts(flatten)]
    pub summary: AccountDeckSummary,
    #[ts(type = "Deck")]
    pub deck: Deck,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckVersionSummary {
    pub id: String,
    pub version_no: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notes: Option<String>,
    pub published: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckVersionDetail {
    #[serde(flatten)]
    #[ts(flatten)]
    pub summary: DeckVersionSummary,
    #[ts(type = "Deck")]
    pub deck: Deck,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckHubTag {
    pub id: String,
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct PublishDeckHubEntryRequest {
    pub deck_id: String,
    pub published_version_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct UpdateDeckHubEntryRequest {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckHubEntrySummary {
    pub id: String,
    pub deck_id: String,
    pub published_version_id: String,
    pub published_version_no: u32,
    pub slug: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub author: Option<String>,
    pub source_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preset_key: Option<String>,
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
    pub cover_card_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_card_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cover_image_url: Option<String>,
    pub status: String,
    pub published_at: String,
    #[serde(default)]
    pub tags: Vec<DeckHubTag>,
    pub favorite_count: u32,
    pub favorited: bool,
    pub owned_by_viewer: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Array<EngineKind>")]
    pub engines: Option<Vec<EngineKind>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckHubEntryList {
    pub entries: Vec<DeckHubEntrySummary>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckHubFacet {
    pub key: String,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckHubFacets {
    pub total: u32,
    pub formats: Vec<DeckHubFacet>,
    pub colors: Vec<DeckHubFacet>,
    pub tags: Vec<DeckHubFacet>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct DeckHubEntryDetail {
    #[serde(flatten)]
    #[ts(flatten)]
    pub entry: DeckHubEntrySummary,
    #[ts(type = "Deck")]
    pub deck: Deck,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct FavoriteResponse {
    pub favorite_count: u32,
    pub favorited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct TopDeckBucket {
    pub key: String,
    pub label: String,
    pub scope: String,
    pub entry_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct TopDeckSnapshotEntry {
    pub rank: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
    pub entry: DeckHubEntrySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct TopDeckSnapshot {
    pub bucket: TopDeckBucket,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub snapshot_date: Option<String>,
    pub entries: Vec<TopDeckSnapshotEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AdminTopDeckSnapshotEntry {
    pub deckhub_entry_id: String,
    pub rank: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AdminTopDeckSnapshotRequest {
    pub snapshot_date: String,
    pub entries: Vec<AdminTopDeckSnapshotEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct AuthProviders {
    pub github: bool,
    pub discord: bool,
    pub email: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct OAuthStartRequest {
    pub mode: String,
    pub client: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct OAuthStartResponse {
    pub authorize_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct ExchangeCodeRequest {
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct AuthAccount {
    pub id: String,
    pub handle: String,
    pub handle_pending: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "authTypes.ts")]
pub struct AuthSessionResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u32,
    pub refresh_token: String,
    pub account: AuthAccount,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct AuthIdentity {
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct MeResponse {
    pub account: AuthAccount,
    pub identities: Vec<AuthIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountExport {
    pub exported_at: String,
    pub account: AccountExportProfile,
    pub identities: Vec<AccountExportIdentity>,
    pub sessions: Vec<AccountExportSession>,
    pub decks: Vec<AccountExportDeck>,
    pub publications: Vec<AccountExportPublication>,
    pub favorites: Vec<AccountExportFavorite>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountExportProfile {
    #[serde(flatten)]
    #[ts(flatten)]
    pub account: AuthAccount,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountExportIdentity {
    #[serde(flatten)]
    #[ts(flatten)]
    pub identity: AuthIdentity,
    pub provider_user_id: String,
    pub email_verified: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountExportSession {
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountExportDeck {
    #[serde(flatten)]
    #[ts(flatten)]
    pub summary: AccountDeckSummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub deleted_at: Option<String>,
    pub versions: Vec<DeckVersionDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountExportPublication {
    pub id: String,
    pub deck_id: String,
    pub published_version_id: String,
    pub slug: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub published_at: Option<String>,
    pub created_at: String,
    pub play_count: u32,
    pub win_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountExportFavorite {
    pub deckhub_entry_id: String,
    pub slug: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct MagicLinkRequest {
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct EmailVerifyRequest {
    pub email: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "authTypes.ts")]
pub struct UpdateHandleRequest {
    pub handle: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "authTypes.ts")]
pub struct AccessTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "authTypes.ts")]
pub struct TokenRequest {
    pub grant_type: String,
    pub refresh_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub resource: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "authTypes.ts")]
pub struct RevocationRequest {
    pub token: String,
}
