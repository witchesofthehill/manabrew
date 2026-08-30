//! Regenerates every TypeScript type the frontend consumes from Rust:
//! the wire protocol (via manabrew-relay-protocol's own publishable
//! gen-protocol bin, run as a subprocess) and the hub REST DTOs (in-process
//! via ts-rs).

use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{ensure, Context, Result};
use manabrew_hub::dto::{
    AccessTokenResponse, AccountAssetList, AccountDeckDetail, AccountDeckList, AccountDeckSummary,
    AccountExport, AdminTopDeckSnapshotRequest, AssetUpload, AuthProviders, AuthSessionResponse,
    Capability, CardCollection, CreateAccountDeckRequest, CreateAssetUploadRequest,
    DeckHubEntryDetail, DeckHubEntryList, DeckHubEntrySummary, DeckHubFacets, DeckHubTag,
    DeckPlayReportRequest, DeckVersionDetail, DeckVersionSummary, EmailVerifyRequest,
    ExchangeCodeRequest, FavoriteResponse, GuestTokenRequest, HubCapabilities, MagicLinkRequest,
    MeResponse, MissingCapabilityError, OAuthStartRequest, OAuthStartResponse,
    PublishDeckHubEntryRequest, RevocationRequest, SaveDeckVersionRequest, SetAccountAvatarRequest,
    TokenRequest, TopDeckBucket, TopDeckSnapshot, UpdateDeckHubEntryRequest, UpdateHandleRequest,
    VerifyCardPrintingsRequest, VerifyCardPrintingsResponse,
};
use ts_rs::TS;

const PROTOCOL_OUT: &str = "src/protocol";
const HUB_OUT: &str = "src/api";
const DECK_IMPORT: &str = "import type { Deck, DeckFormat } from \"@/protocol/deck\";\nimport type { EngineKind } from \"@/protocol\";\n\n";

pub fn generate(root: &Path) -> Result<()> {
    let hub_path = root.join(HUB_OUT).join("hubTypes.ts");
    let _ = fs::remove_file(&hub_path);
    let status = Command::new("cargo")
        .args([
            "run",
            "-q",
            "-p",
            "manabrew-relay-protocol",
            "--bin",
            "gen-protocol",
            "--",
            PROTOCOL_OUT,
        ])
        .current_dir(root)
        .status()
        .context("run gen-protocol")?;
    ensure!(status.success(), "gen-protocol failed");

    let out = root.join(HUB_OUT);
    HubCapabilities::export_all_to(&out).context("export HubCapabilities")?;
    Capability::export_all_to(&out).context("export Capability")?;
    MissingCapabilityError::export_all_to(&out).context("export MissingCapabilityError")?;
    CardCollection::export_all_to(&out).context("export CardCollection")?;
    VerifyCardPrintingsRequest::export_all_to(&out).context("export VerifyCardPrintingsRequest")?;
    VerifyCardPrintingsResponse::export_all_to(&out)
        .context("export VerifyCardPrintingsResponse")?;
    DeckPlayReportRequest::export_all_to(&out).context("export DeckPlayReportRequest")?;
    CreateAccountDeckRequest::export_all_to(&out).context("export CreateAccountDeckRequest")?;
    SaveDeckVersionRequest::export_all_to(&out).context("export SaveDeckVersionRequest")?;
    AccountDeckSummary::export_all_to(&out).context("export AccountDeckSummary")?;
    AccountDeckList::export_all_to(&out).context("export AccountDeckList")?;
    AccountDeckDetail::export_all_to(&out).context("export AccountDeckDetail")?;
    AccountExport::export_all_to(&out).context("export AccountExport")?;
    DeckVersionSummary::export_all_to(&out).context("export DeckVersionSummary")?;
    DeckVersionDetail::export_all_to(&out).context("export DeckVersionDetail")?;
    DeckHubTag::export_all_to(&out).context("export DeckHubTag")?;
    PublishDeckHubEntryRequest::export_all_to(&out).context("export PublishDeckHubEntryRequest")?;
    UpdateDeckHubEntryRequest::export_all_to(&out).context("export UpdateDeckHubEntryRequest")?;
    DeckHubEntrySummary::export_all_to(&out).context("export DeckHubEntrySummary")?;
    DeckHubEntryList::export_all_to(&out).context("export DeckHubEntryList")?;
    DeckHubEntryDetail::export_all_to(&out).context("export DeckHubEntryDetail")?;
    DeckHubFacets::export_all_to(&out).context("export DeckHubFacets")?;
    FavoriteResponse::export_all_to(&out).context("export FavoriteResponse")?;
    TopDeckBucket::export_all_to(&out).context("export TopDeckBucket")?;
    TopDeckSnapshot::export_all_to(&out).context("export TopDeckSnapshot")?;
    AdminTopDeckSnapshotRequest::export_all_to(&out)
        .context("export AdminTopDeckSnapshotRequest")?;

    CreateAssetUploadRequest::export_all_to(&out).context("export CreateAssetUploadRequest")?;
    AssetUpload::export_all_to(&out).context("export AssetUpload")?;
    AccountAssetList::export_all_to(&out).context("export AccountAssetList")?;
    SetAccountAvatarRequest::export_all_to(&out).context("export SetAccountAvatarRequest")?;

    AuthProviders::export_all_to(&out).context("export AuthProviders")?;
    OAuthStartRequest::export_all_to(&out).context("export OAuthStartRequest")?;
    OAuthStartResponse::export_all_to(&out).context("export OAuthStartResponse")?;
    ExchangeCodeRequest::export_all_to(&out).context("export ExchangeCodeRequest")?;
    AuthSessionResponse::export_all_to(&out).context("export AuthSessionResponse")?;
    MeResponse::export_all_to(&out).context("export MeResponse")?;
    MagicLinkRequest::export_all_to(&out).context("export MagicLinkRequest")?;
    EmailVerifyRequest::export_all_to(&out).context("export EmailVerifyRequest")?;
    UpdateHandleRequest::export_all_to(&out).context("export UpdateHandleRequest")?;
    AccessTokenResponse::export_all_to(&out).context("export AccessTokenResponse")?;
    TokenRequest::export_all_to(&out).context("export TokenRequest")?;
    GuestTokenRequest::export_all_to(&out).context("export GuestTokenRequest")?;
    RevocationRequest::export_all_to(&out).context("export RevocationRequest")?;

    let path = out.join("hubTypes.ts");
    let generated = fs::read_to_string(&path).context("read hubTypes.ts")?;
    fs::write(&path, format!("{DECK_IMPORT}{generated}")).context("write hubTypes.ts")?;
    eprintln!("wrote {PROTOCOL_OUT}/, {HUB_OUT}/hubTypes.ts and {HUB_OUT}/authTypes.ts");
    Ok(())
}
