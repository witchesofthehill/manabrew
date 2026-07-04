//! Release automation for the manabrew workspace.
//!
//! Continuous, non-lockstep versioning: every crate is versioned
//! independently from the conventional commits that touch its files (parsed
//! by git-cliff), released via per-crate git tags (`<crate>-vX.Y.Z`; the
//! desktop app owns the plain `vX.Y.Z` tags), and summarized in
//! `ops/manifest.json` for the auto-updaters.
//!
//! Commands:
//!   cargo xtask plan [--github-summary]   what a release run would do
//!   cargo xtask release [--dry-run]       bump, commit to main, tag, push,
//!                                         create the GitHub Release
//!   cargo xtask manifest [--check]        (re)generate ops/manifest.json
//!   cargo xtask publish [--dry-run]       publish pending crates to crates.io
//!
//! Requires `git-cliff` on PATH (brew install git-cliff / taiki-e/install-action).

mod apply;
mod cliff;
mod manifest;
mod plan;
mod publish;
mod release;
mod util;
mod workspace;

use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use lexopt::prelude::*;

use workspace::Workspace;

fn main() -> Result<()> {
    let mut parser = lexopt::Parser::from_env();
    let mut command: Option<String> = None;
    let mut dry_run = false;
    let mut check = false;
    let mut summary = false;
    while let Some(arg) = parser.next()? {
        match arg {
            Value(v) if command.is_none() => command = Some(v.string()?),
            Long("dry-run") => dry_run = true,
            Long("check") => check = true,
            Long("github-summary") => summary = true,
            Long("help") | Short('h') => {
                print_help();
                return Ok(());
            }
            _ => return Err(arg.unexpected().into()),
        }
    }

    let ws = Workspace::load(&workspace_root()?)?;
    let root = ws.root.clone();

    match command.as_deref() {
        Some("plan") => {
            let entries = plan::compute(&ws, &root)?;
            release::print_plan(&entries);
            if summary {
                if let Ok(path) = std::env::var("GITHUB_STEP_SUMMARY") {
                    OpenOptions::new()
                        .append(true)
                        .open(path)?
                        .write_all(release::github_summary(&entries).as_bytes())?;
                }
            }
        }
        Some("release") => release::release(&ws, &root, dry_run)?,
        Some("manifest") if check => manifest::check(&ws, &root)?,
        Some("manifest") => manifest::generate(&ws, &root, false)?,
        Some("publish") => publish::publish(&ws, &root, dry_run)?,
        _ => {
            print_help();
            bail!("pick a command: plan | release | manifest | publish");
        }
    }
    Ok(())
}

fn workspace_root() -> Result<PathBuf> {
    // xtask always runs via `cargo xtask`, so CARGO_MANIFEST_DIR/.. is the root.
    let dir = std::env::var("CARGO_MANIFEST_DIR").context("run via `cargo xtask`")?;
    Ok(PathBuf::from(dir).parent().unwrap().to_path_buf())
}

fn print_help() {
    println!(
        "usage: cargo xtask <command>\n\n  \
         plan [--github-summary]   show the pending release plan\n  \
         release [--dry-run]       run the continuous-release step (CI/main only)\n  \
         manifest [--check]        regenerate or verify ops/manifest.json\n  \
         publish [--dry-run]       publish pending crates to crates.io"
    );
}
