use std::fmt::Write as _;
use std::fs;
use std::path::Path;

use anyhow::{bail, Result};
use semver::Version;

use crate::cliff;
use crate::plan::{self, Entry};
use crate::util::{run, run_inherit};
use crate::workspace::{Workspace, APP_PACKAGE};

pub fn print_plan(plan: &[Entry]) {
    if plan.is_empty() {
        println!("nothing to release");
        return;
    }
    for e in plan {
        println!(
            "  {:32} {} -> {}  ({})",
            e.name, e.current, e.next, e.reason
        );
    }
}

pub fn github_summary(plan: &[Entry]) -> String {
    let mut out = String::from("### Release plan on merge\n\n");
    if plan.is_empty() {
        out.push_str("No package versions change.\n");
        return out;
    }
    out.push_str("| package | current | next | level | why |\n|---|---|---|---|---|\n");
    for e in plan {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} |",
            e.name, e.current, e.next, e.level, e.reason
        );
    }
    out.push_str("\nComputed from conventional commits since each package's last release tag; squash-merge titles become the commit that counts.\n");
    out
}

/// The whole continuous-release step, run on main after a merge:
/// plan -> apply -> chore(release) commit -> per-crate tags -> push ->
/// GitHub Release with notes (app only). Installers and deploys hang off the
/// push events this generates.
pub fn release(ws: &Workspace, root: &Path, dry_run: bool) -> Result<()> {
    if !dry_run {
        ensure_clean(root)?;
    }
    let entries = plan::compute(ws, root)?;
    print_plan(&entries);
    if entries.is_empty() {
        return Ok(());
    }

    let app = entries.iter().find(|e| e.name == APP_PACKAGE);
    // Render the app's release notes BEFORE applying/committing: git-cliff
    // reads the git history, and the notes must describe the commits being
    // released, not the release commit.
    let notes = app
        .map(|e| {
            let app_pkg = ws.get(APP_PACKAGE).unwrap();
            cliff::render_notes(
                root,
                cliff::APP_TAG_PATTERN,
                &ws.include_globs(app_pkg),
                &e.tag,
            )
        })
        .transpose()?;

    if dry_run {
        if let Some(notes) = &notes {
            println!("\n--- release notes (app) ---\n{notes}");
        }
        println!("\ndry run: no files changed, nothing committed");
        return Ok(());
    }

    crate::apply::apply(ws, root, &entries)?;
    if let (Some(app), Some(notes)) = (app, &notes) {
        prepend_changelog(root, &app.next, notes)?;
    }

    let mut message = format!("chore(release): {} package(s)\n\n", entries.len());
    for e in &entries {
        let _ = writeln!(message, "- {}: {} -> {}", e.name, e.current, e.next);
    }
    run(root, "git", &["add", "--all"])?;
    run(root, "git", &["commit", "--message", &message])?;
    for e in &entries {
        run(
            root,
            "git",
            &["tag", "--annotate", "--message", &e.tag, &e.tag],
        )?;
    }

    let mut push_args: Vec<&str> = vec!["push", "origin", "HEAD:main"];
    for e in &entries {
        push_args.push(&e.tag);
    }
    run_inherit(root, "git", &push_args)?;

    // The GitHub Release must exist with notes before release-artifacts.yml
    // (triggered by the tag push) attaches installers to it.
    if let (Some(app), Some(notes)) = (app, &notes) {
        let notes_path = root.join("target/release-notes.md");
        fs::write(&notes_path, notes)?;
        let created = run_inherit(
            root,
            "gh",
            &[
                "release",
                "create",
                &app.tag,
                "--verify-tag",
                "--title",
                &app.tag,
                "--notes-file",
                notes_path.to_str().unwrap(),
            ],
        );
        if created.is_err() {
            eprintln!(
                "warning: could not create GitHub Release {} — release-artifacts will create a bare one",
                app.tag
            );
        }
    }

    println!(
        "released: {}",
        entries
            .iter()
            .map(|e| e.tag.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    Ok(())
}

fn ensure_clean(root: &Path) -> Result<()> {
    let status = run(root, "git", &["status", "--porcelain"])?;
    if !status.trim().is_empty() {
        bail!("working tree not clean — release must run on a pristine checkout of main");
    }
    Ok(())
}

/// Insert the new section under the "# Changelog" header, release-please
/// style (newest first).
fn prepend_changelog(root: &Path, _next: &Version, notes: &str) -> Result<()> {
    let path = root.join("CHANGELOG.md");
    let existing = fs::read_to_string(&path).unwrap_or_else(|_| "# Changelog\n".to_string());
    let insert_at = existing
        .find("\n## ")
        .map(|i| i + 1)
        .unwrap_or(existing.len());
    let mut out = String::with_capacity(existing.len() + notes.len() + 2);
    out.push_str(&existing[..insert_at]);
    out.push_str(notes.trim_end());
    out.push_str("\n\n");
    out.push_str(&existing[insert_at..]);
    fs::write(&path, out)?;
    Ok(())
}
