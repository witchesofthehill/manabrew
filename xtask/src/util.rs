use std::path::Path;
use std::process::{Command, Output, Stdio};

use anyhow::{bail, Context, Result};

/// Run a command, capturing stdout; stderr passes through to the terminal.
pub fn run(cwd: &Path, program: &str, args: &[&str]) -> Result<String> {
    let out = capture(cwd, program, args)?;
    if !out.status.success() {
        bail!("`{program} {}` failed with {}", args.join(" "), out.status);
    }
    String::from_utf8(out.stdout).context("non-utf8 command output")
}

/// Run a command whose failure is expected/inspectable by the caller.
pub fn capture(cwd: &Path, program: &str, args: &[&str]) -> Result<Output> {
    Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .output()
        .with_context(|| format!("could not spawn `{program}` — is it installed?"))
}

/// Run a command inheriting stdio (for `cargo update`, `git push`, ...).
pub fn run_inherit(cwd: &Path, program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .status()
        .with_context(|| format!("could not spawn `{program}` — is it installed?"))?;
    if !status.success() {
        bail!("`{program} {}` failed with {status}", args.join(" "));
    }
    Ok(())
}
