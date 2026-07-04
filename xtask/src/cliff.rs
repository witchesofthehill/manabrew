use std::path::Path;

use anyhow::{Context, Result};
use semver::Version;
use serde::Deserialize;

use crate::util::run;

/// One conventional commit as parsed by git-cliff (post commit_parsers, so
/// hidden types like chore/docs are already filtered out — except breaking
/// ones, which protect_breaking_commits keeps).
pub struct ParsedCommit {
    pub summary: String,
    /// Conventional type ("feat", "fix", ...) — None when unconventional.
    pub typ: Option<String>,
    pub breaking: bool,
}

pub struct UnreleasedLog {
    /// Version of the newest tag matching the tag pattern, if any.
    pub tagged_version: Option<Version>,
    pub commits: Vec<ParsedCommit>,
}

#[derive(Deserialize)]
struct CtxRelease {
    previous: Option<CtxPrevious>,
    commits: Vec<CtxCommit>,
}

#[derive(Deserialize)]
struct CtxPrevious {
    version: Option<String>,
}

// git-cliff omits `breaking`/`conventional` entirely for commits that fail
// conventional parsing (e.g. "fix(ui) missing colon") — default both to false.
// `message` is the parsed description (type prefix stripped!); the type can
// only be recovered from `raw_message`.
#[derive(Deserialize)]
struct CtxCommit {
    message: String,
    raw_message: Option<String>,
    #[serde(default)]
    breaking: bool,
    #[serde(default)]
    conventional: bool,
}

/// Tag pattern for a crate's release tags: `<name>-vX.Y.Z`.
pub fn crate_tag_pattern(name: &str) -> String {
    format!("^{name}-v[0-9]")
}
/// The app's tags are plain `vX.Y.Z`.
pub const APP_TAG_PATTERN: &str = "^v[0-9]";

pub fn tag_name(pkg_name: &str, is_app: bool, version: &Version) -> String {
    if is_app {
        format!("v{version}")
    } else {
        format!("{pkg_name}-v{version}")
    }
}

fn parse_semver_suffix(tag: &str) -> Option<Version> {
    let idx = tag.rfind('v')?;
    Version::parse(&tag[idx + 1..]).ok()
}

/// Conventional type from a commit summary ("feat(scope)!: x" -> "feat").
pub fn conventional_type(summary: &str) -> Option<String> {
    let head = summary.split(':').next()?;
    let head = head.trim_end_matches('!');
    let head = head.split('(').next()?.trim();
    if !head.is_empty()
        && head.len() < summary.len()
        && head.chars().all(|c| c.is_ascii_alphabetic())
        && summary.contains(':')
    {
        Some(head.to_ascii_lowercase())
    } else {
        None
    }
}

/// Unreleased commits touching `include_globs`, relative to the newest tag
/// matching `tag_pattern`.
pub fn unreleased(
    root: &Path,
    tag_pattern: &str,
    include_globs: &[String],
) -> Result<UnreleasedLog> {
    let mut args: Vec<&str> = vec!["--unreleased", "--context", "--tag-pattern", tag_pattern];
    for g in include_globs {
        args.push("--include-path");
        args.push(g);
    }
    let json = run(root, "git-cliff", &args)?;
    let releases: Vec<CtxRelease> =
        serde_json::from_str(&json).context("parsing git-cliff --context output")?;
    let release = releases.into_iter().next();

    let tagged_version = release
        .as_ref()
        .and_then(|r| r.previous.as_ref())
        .and_then(|p| p.version.as_deref())
        .and_then(parse_semver_suffix);

    let commits = release
        .map(|r| r.commits)
        .unwrap_or_default()
        .into_iter()
        .map(|c| {
            let raw_summary = c
                .raw_message
                .as_deref()
                .unwrap_or(&c.message)
                .lines()
                .next()
                .unwrap_or_default()
                .to_string();
            ParsedCommit {
                typ: if c.conventional {
                    conventional_type(&raw_summary)
                } else {
                    None
                },
                summary: c.message,
                breaking: c.breaking,
            }
        })
        .collect();

    Ok(UnreleasedLog {
        tagged_version,
        commits,
    })
}

/// Render the changelog body for the app's next release (used both for the
/// GitHub Release notes and the CHANGELOG.md prepend).
pub fn render_notes(
    root: &Path,
    tag_pattern: &str,
    include_globs: &[String],
    next_tag: &str,
) -> Result<String> {
    let mut args: Vec<&str> = vec![
        "--unreleased",
        "--strip",
        "all",
        "--tag",
        next_tag,
        "--tag-pattern",
        tag_pattern,
    ];
    for g in include_globs {
        args.push("--include-path");
        args.push(g);
    }
    run(root, "git-cliff", &args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_conventional_type() {
        assert_eq!(conventional_type("feat: add x").as_deref(), Some("feat"));
        assert_eq!(
            conventional_type("feat(ui)!: redo y").as_deref(),
            Some("feat")
        );
        assert_eq!(conventional_type("FIX(a): b").as_deref(), Some("fix"));
        assert_eq!(conventional_type("Misc fixes post-release (#326)"), None);
        assert_eq!(conventional_type("no type here"), None);
    }

    #[test]
    fn parses_tag_versions() {
        assert_eq!(
            parse_semver_suffix("manabrew-protocol-v0.2.0"),
            Some(Version::new(0, 2, 0))
        );
        assert_eq!(parse_semver_suffix("v1.0.0"), Some(Version::new(1, 0, 0)));
        assert_eq!(parse_semver_suffix("nonsense"), None);
    }

    #[test]
    fn tag_names() {
        assert_eq!(tag_name("manabrew", true, &Version::new(1, 0, 0)), "v1.0.0");
        assert_eq!(
            tag_name("manabrew-protocol", false, &Version::new(0, 3, 0)),
            "manabrew-protocol-v0.3.0"
        );
    }
}
