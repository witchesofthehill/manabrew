use std::fs;
use std::path::Path;

use std::collections::BTreeMap;

use anyhow::{bail, Result};
use serde::Serialize;
use serde_json::Value;

use crate::workspace::Workspace;

pub const MANIFEST_PATH: &str = "ops/manifest.json";

#[derive(Serialize)]
struct Manifest {
    version: u64,
    packages: BTreeMap<String, String>,
}

/// Render `ops/manifest.json`: a monotonic release counter plus every
/// workspace package's version. Served at play.manabrew.app/manifest.json for
/// the desktop auto-updater and self-hosted nodes.
pub fn render(ws: &Workspace, counter: u64) -> String {
    let manifest = Manifest {
        version: counter,
        packages: ws
            .packages
            .iter()
            .map(|p| (p.name.clone(), p.version.to_string()))
            .collect(),
    };
    serde_json::to_string_pretty(&manifest).unwrap() + "\n"
}

pub fn current_counter(root: &Path) -> u64 {
    fs::read_to_string(root.join(MANIFEST_PATH))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v.get("version").and_then(Value::as_u64))
        .unwrap_or(0)
}

pub fn generate(ws: &Workspace, root: &Path, increment: bool) -> Result<()> {
    let counter = current_counter(root) + u64::from(increment);
    let out = render(ws, counter);
    fs::write(root.join(MANIFEST_PATH), &out)?;
    eprintln!("wrote {MANIFEST_PATH} (version {counter})");
    Ok(())
}

/// Fails when the checked-in manifest doesn't match the workspace (same check
/// `gen-manifest.mjs --check` used to do; the counter itself only moves in
/// release commits now).
pub fn check(ws: &Workspace, root: &Path) -> Result<()> {
    let expected = render(ws, current_counter(root));
    let actual = fs::read_to_string(root.join(MANIFEST_PATH)).unwrap_or_default();
    if expected != actual {
        bail!("{MANIFEST_PATH} is stale — run `cargo xtask manifest`");
    }
    println!("{MANIFEST_PATH} is up to date");
    Ok(())
}
