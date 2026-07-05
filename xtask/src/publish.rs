use std::path::Path;
use std::thread;
use std::time::Duration;

use anyhow::Result;
use serde_json::Value;

use crate::util::{capture, run_inherit};
use crate::workspace::Workspace;

/// Publish every publishable workspace crate whose current version is not on
/// crates.io yet, in dependency order. Idempotent: already-published versions
/// are skipped, so a partially failed run heals on the next release.
pub fn publish(ws: &Workspace, root: &Path, dry_run: bool) -> Result<()> {
    if std::env::var_os("CARGO_REGISTRY_TOKEN").is_none() && !dry_run {
        eprintln!("CARGO_REGISTRY_TOKEN not set — skipping crates.io publishing");
        return Ok(());
    }

    let mut failed = Vec::new();
    for pkg in ws.publish_order() {
        let version = pkg.version.to_string();
        match published_versions(&pkg.name)? {
            Some(versions) if versions.iter().any(|v| v == &version) => {
                eprintln!("  {} {version} already on crates.io — skip", pkg.name);
                continue;
            }
            _ => {}
        }
        if dry_run {
            println!("  would publish {} {version}", pkg.name);
            continue;
        }
        // A failed dep blocks its dependents; publish what we can, report the
        // rest, and stay green — the next release run retries. This also
        // absorbs crates.io's new-crate rate limit on the first rollout.
        // --no-verify: the workspace builds every crate in CI already, and a
        // full verify build per crate would dominate release time.
        eprintln!("publishing {} {version}", pkg.name);
        let blocked = pkg.internal_deps.iter().any(|d| failed.contains(d));
        if blocked
            || run_inherit(root, "cargo", &["publish", "-p", &pkg.name, "--no-verify"]).is_err()
        {
            eprintln!(
                "  {} {version} NOT published{}",
                pkg.name,
                if blocked { " (dependency failed)" } else { "" }
            );
            failed.push(pkg.name.clone());
            continue;
        }
        // Give the index a moment before publishing dependents.
        thread::sleep(Duration::from_secs(5));
    }

    if failed.is_empty() {
        eprintln!("crates.io publishing complete");
    } else {
        eprintln!(
            "crates.io publishing incomplete ({} pending: {}) — the next release run will retry",
            failed.len(),
            failed.join(", ")
        );
    }
    Ok(())
}

/// Version strings already on crates.io, or None if the crate doesn't exist.
fn published_versions(name: &str) -> Result<Option<Vec<String>>> {
    let url = format!("https://crates.io/api/v1/crates/{name}/versions");
    let out = capture(
        Path::new("."),
        "curl",
        &[
            "--silent",
            "--fail-with-body",
            "--max-time",
            "30",
            "--header",
            "User-Agent: manabrew-xtask (github.com/witchesofthehill/manabrew)",
            &url,
        ],
    )?;
    if !out.status.success() {
        return Ok(None); // 404: never published (or transient error → cargo publish decides)
    }
    let body: Value = serde_json::from_slice(&out.stdout)?;
    Ok(body
        .get("versions")
        .and_then(Value::as_array)
        .map(|versions| {
            versions
                .iter()
                .filter_map(|v| v.get("num").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        }))
}
