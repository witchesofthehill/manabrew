//! Regenerates every TypeScript type the frontend consumes from Rust:
//! the wire protocol (via manabrew-protocol's own publishable gen-protocol
//! bin, run as a subprocess) and the hub REST DTOs (in-process via ts-rs).

use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{ensure, Context, Result};
use manabrew_hub::dto::{
    AccountDeckDetail, AccountDeckList, AccountDeckSummary, AdminTopDeckSnapshotRequest,
    AuthProviders, AuthSessionResponse, CreateAccountDeckRequest, DeckHubEntryDetail,
    DeckHubEntryList, DeckHubEntrySummary, DeckHubFacets, DeckHubTag, DeckVersionDetail,
    DeckVersionSummary, EmailVerifyRequest, ExchangeCodeRequest, FavoriteResponse, HubCapabilities,
    HubDeckDetail, HubDeckList, HubDeckSummary, MagicLinkRequest, MeResponse, OAuthStartRequest,
    OAuthStartResponse, PublishDeckHubEntryRequest, PublishDeckRequest, PublishDeckResponse,
    SaveDeckVersionRequest, TopDeckBucket, TopDeckSnapshot, TopDeckStat, UpdateDeckHubEntryRequest,
    UpdateHandleRequest,
};
use ts_rs::TS;

const PROTOCOL_OUT: &str = "src/protocol";
const HUB_OUT: &str = "src/api";
const DECK_IMPORT: &str = "import type { Deck, DeckFormat } from \"@/protocol/deck\";\n\n";

pub fn generate(root: &Path) -> Result<()> {
    let hub_path = root.join(HUB_OUT).join("hubTypes.ts");
    let _ = fs::remove_file(&hub_path);
    let status = Command::new("cargo")
        .args([
            "run",
            "-q",
            "-p",
            "manabrew-protocol",
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
    PublishDeckRequest::export_all_to(&out).context("export PublishDeckRequest")?;
    PublishDeckResponse::export_all_to(&out).context("export PublishDeckResponse")?;
    HubDeckSummary::export_all_to(&out).context("export HubDeckSummary")?;
    HubDeckList::export_all_to(&out).context("export HubDeckList")?;
    HubDeckDetail::export_all_to(&out).context("export HubDeckDetail")?;
    TopDeckStat::export_all_to(&out).context("export TopDeckStat")?;
    HubCapabilities::export_all_to(&out).context("export HubCapabilities")?;
    CreateAccountDeckRequest::export_all_to(&out).context("export CreateAccountDeckRequest")?;
    SaveDeckVersionRequest::export_all_to(&out).context("export SaveDeckVersionRequest")?;
    AccountDeckSummary::export_all_to(&out).context("export AccountDeckSummary")?;
    AccountDeckList::export_all_to(&out).context("export AccountDeckList")?;
    AccountDeckDetail::export_all_to(&out).context("export AccountDeckDetail")?;
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

    AuthProviders::export_all_to(&out).context("export AuthProviders")?;
    OAuthStartRequest::export_all_to(&out).context("export OAuthStartRequest")?;
    OAuthStartResponse::export_all_to(&out).context("export OAuthStartResponse")?;
    ExchangeCodeRequest::export_all_to(&out).context("export ExchangeCodeRequest")?;
    AuthSessionResponse::export_all_to(&out).context("export AuthSessionResponse")?;
    MeResponse::export_all_to(&out).context("export MeResponse")?;
    MagicLinkRequest::export_all_to(&out).context("export MagicLinkRequest")?;
    EmailVerifyRequest::export_all_to(&out).context("export EmailVerifyRequest")?;
    UpdateHandleRequest::export_all_to(&out).context("export UpdateHandleRequest")?;

    let path = out.join("hubTypes.ts");
    let generated = fs::read_to_string(&path).context("read hubTypes.ts")?;
    fs::write(&path, format!("{DECK_IMPORT}{generated}")).context("write hubTypes.ts")?;
    eprintln!("wrote {PROTOCOL_OUT}/, {HUB_OUT}/hubTypes.ts and {HUB_OUT}/authTypes.ts");
    Ok(())
}
