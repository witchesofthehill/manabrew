//! Run the Playwright UI e2e suite (`tests/e2e-ui/`) against a live dev stack.
//!
//! The scripts are plain node programs (no test runner) that each print
//! `PASS`/`FAIL` and exit accordingly; see `tests/e2e-ui/README.md` for the
//! prerequisites (relay on :9443, `yarn dev:web` on :1420, system Chrome).

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};

/// Scripts run when no explicit list is given, relative to the repo root.
const DEFAULT_SCRIPTS: &[&str] = &["tests/e2e-ui/board-settings.mjs"];

pub fn run(root: &Path, scripts: &[String]) -> Result<()> {
    let defaults: Vec<String> = DEFAULT_SCRIPTS.iter().map(|s| s.to_string()).collect();
    let list = if scripts.is_empty() {
        &defaults
    } else {
        scripts
    };
    for script in list {
        if !root.join(script).exists() {
            bail!("e2e script not found: {script}");
        }
        eprintln!("── e2e-ui: {script}");
        let status = Command::new("node")
            .arg(script)
            .current_dir(root)
            .status()
            .with_context(|| format!("failed to spawn `node {script}`"))?;
        if !status.success() {
            bail!("e2e script failed: {script}");
        }
    }
    Ok(())
}
