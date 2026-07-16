//! Regenerates every TypeScript type the frontend consumes from Rust:
//! the wire protocol (via manabrew-protocol's own publishable gen-protocol
//! bin, run as a subprocess) and the hub REST DTOs (in-process via ts-rs).

use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{ensure, Context, Result};
use manabrew_hub::dto::{
    AuthProviders, AuthSessionResponse, EmailVerifyRequest, ExchangeCodeRequest, HubDeckDetail,
    HubDeckList, HubDeckSummary, MagicLinkRequest, MeResponse, OAuthStartRequest,
    OAuthStartResponse, PublishDeckRequest, PublishDeckResponse, TopDeckStat, UpdateHandleRequest,
};
use ts_rs::TS;

const PROTOCOL_OUT: &str = "src/protocol";
const HUB_OUT: &str = "src/api";
const DECK_IMPORT: &str = "import type { Deck, DeckFormat } from \"@/protocol/deck\";\n\n";

pub fn generate(root: &Path) -> Result<()> {
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
