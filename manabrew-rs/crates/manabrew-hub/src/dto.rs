use std::collections::BTreeMap;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub assets: Option<AssetCapabilities>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AssetCapabilities {
    #[ts(type = "number")]
    pub max_avatar_bytes: u64,
    #[ts(type = "number")]
    pub max_playmat_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub enum AssetKind {
    Avatar,
    Playmat,
}

impl AssetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AssetKind::Avatar => "avatar",
            AssetKind::Playmat => "playmat",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "avatar" => Some(AssetKind::Avatar),
            "playmat" => Some(AssetKind::Playmat),
            _ => None,
        }
    }

    /// Path segment under the owner's account id.
    pub fn folder(self) -> &'static str {
        match self {
            AssetKind::Avatar => "avatar",
            AssetKind::Playmat => "playmats",
        }
    }

    pub fn max_bytes(self) -> u64 {
        match self {
            AssetKind::Avatar => MAX_AVATAR_BYTES,
            AssetKind::Playmat => MAX_PLAYMAT_BYTES,
        }
    }
}

pub const MAX_AVATAR_BYTES: u64 = 256 * 1024;
pub const MAX_PLAYMAT_BYTES: u64 = 3 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub enum AssetState {
    Pending,
    Active,
}

impl AssetState {
    pub fn as_str(self) -> &'static str {
        match self {
            AssetState::Pending => "pending",
            AssetState::Active => "active",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(AssetState::Pending),
            "active" => Some(AssetState::Active),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct CreateAssetUploadRequest {
    pub kind: AssetKind,
    #[ts(type = "number")]
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AssetUpload {
    pub asset_id: String,
    pub upload_url: String,
    pub public_url: String,
    #[ts(type = "Record<string, string>")]
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountAsset {
    pub id: String,
    pub url: String,
    pub kind: AssetKind,
    #[ts(type = "number")]
    pub byte_size: u64,
    pub state: AssetState,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AccountAssetList {
    pub assets: Vec<AccountAsset>,
    #[serde(flatten)]
    #[ts(flatten)]
    pub quota: AssetQuota,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct AssetQuota {
    #[ts(type = "number")]
    pub used_bytes: u64,
    #[ts(type = "number")]
    pub quota_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "hubTypes.ts")]
pub struct SetAccountAvatarRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar_asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar_url: Option<String>,
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
    pub provider_avatar_url: Option<String>,
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
pub struct GuestTokenRequest {
    pub name: String,
    pub guest_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "authTypes.ts")]
pub struct RevocationRequest {
    pub token: String,
}
