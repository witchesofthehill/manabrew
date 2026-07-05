use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;

use anyhow::{Context, Result};
use semver::Version;

use crate::cliff::{self, UnreleasedLog};
use crate::workspace::{Workspace, APP_PACKAGE};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    None,
    Patch,
    Minor,
    Major,
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Level::None => "none",
            Level::Patch => "patch",
            Level::Minor => "minor",
            Level::Major => "major",
        })
    }
}

/// Level implied by one conventional commit. The level applies to EVERY crate
/// the commit touches (team decision: a breaking PR majors everything it
/// touches; keep blast radius down by splitting PRs).
pub fn commit_level(typ: Option<&str>, breaking: bool) -> Level {
    if breaking {
        return Level::Major;
    }
    match typ {
        Some("feat") => Level::Minor,
        Some("docs" | "style" | "chore" | "test" | "build" | "ci") => Level::None,
        // fix/perf/refactor/revert, unknown types, and unconventional commits
        // are all real changes to the shipped artifact.
        _ => Level::Patch,
    }
}

pub fn log_level(log: &UnreleasedLog) -> Level {
    log.commits
        .iter()
        .map(|c| commit_level(c.typ.as_deref(), c.breaking))
        .max()
        .unwrap_or(Level::None)
}

pub fn bump(v: &Version, level: Level) -> Version {
    match level {
        Level::None => v.clone(),
        Level::Patch => Version::new(v.major, v.minor, v.patch + 1),
        Level::Minor => Version::new(v.major, v.minor + 1, 0),
        // Pre-1.0, a breaking change bumps 0.x -> 0.(x+1): that's cargo's
        // incompatibility boundary for 0.x versions (and matches the old
        // release-please bump-minor-pre-major behavior). Crates only reach
        // 1.0 via a hand-bump.
        Level::Major if v.major == 0 => Version::new(0, v.minor + 1, 0),
        Level::Major => Version::new(v.major + 1, 0, 0),
    }
}

pub struct Entry {
    pub name: String,
    pub current: Version,
    pub next: Version,
    pub level: Level,
    pub reason: String,
    pub tag: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BumpSource {
    /// Version was hand-set in Cargo.toml ahead of the last tag; released as-is.
    HandBumped,
    /// Version computed from the conventional commits since the last tag.
    Commits,
}

/// Next version for one crate.
///
/// Baseline is the newest release tag; a crate that has never been tagged
/// uses its Cargo.toml version as baseline (adoption path — commit range then
/// falls back to "since the newest app tag" via the caller's tag pattern).
/// Hand-bumps win: if Cargo.toml is already ahead of the computed next
/// version, the hand-set version is released as-is.
pub fn next_version(
    current: &Version,
    tagged: Option<&Version>,
    level: Level,
) -> Option<(Version, BumpSource)> {
    let baseline = tagged.unwrap_or(current);
    let computed = bump(baseline, level);
    let hand_bumped = tagged.is_some_and(|t| current > t);
    match (level, hand_bumped) {
        (Level::None, false) => None,
        (_, true) if *current >= computed => Some((current.clone(), BumpSource::HandBumped)),
        (Level::None, true) => Some((current.clone(), BumpSource::HandBumped)),
        _ => Some((computed, BumpSource::Commits)),
    }
}

pub fn compute(ws: &Workspace, root: &Path) -> Result<Vec<Entry>> {
    // Pass 1: direct bumps from each crate's own unreleased commits.
    let mut direct: BTreeMap<&str, (Level, String, Option<Version>)> = BTreeMap::new();
    for pkg in &ws.packages {
        let is_app = pkg.name == APP_PACKAGE;
        let own_pattern = if is_app {
            cliff::APP_TAG_PATTERN.to_string()
        } else {
            cliff::crate_tag_pattern(&pkg.name)
        };
        let mut log = cliff::unreleased(root, &own_pattern, &ws.include_globs(pkg))
            .with_context(|| format!("planning {}", pkg.name))?;
        if !is_app && log.tagged_version.is_none() {
            // Never tagged: don't scan the whole history — treat the newest
            // app tag as the adoption boundary.
            log = cliff::unreleased(root, cliff::APP_TAG_PATTERN, &ws.include_globs(pkg))
                .with_context(|| format!("planning {} (untagged fallback)", pkg.name))?;
            log.tagged_version = None;
        }
        let level = log_level(&log);
        let sample = log
            .commits
            .iter()
            .max_by_key(|c| commit_level(c.typ.as_deref(), c.breaking))
            .map(|c| c.summary.chars().take(60).collect::<String>())
            .unwrap_or_default();
        direct.insert(pkg.name.as_str(), (level, sample, log.tagged_version));
    }

    // Pass 2: resolve next versions, then cascade ≥patch to dependents of
    // anything that bumped, to a fixpoint (path deps are transitive already
    // via reverse_deps, but hand-bumps found late still need the loop).
    let mut entries: BTreeMap<&str, Entry> = BTreeMap::new();
    for pkg in &ws.packages {
        let (level, sample, tagged) = &direct[pkg.name.as_str()];
        if let Some((next, source)) = next_version(&pkg.version, tagged.as_ref(), *level) {
            let reason = match source {
                BumpSource::HandBumped => "hand-bumped in Cargo.toml".to_string(),
                BumpSource::Commits => format!("{level}: {sample}"),
            };
            entries.insert(
                pkg.name.as_str(),
                Entry {
                    name: pkg.name.clone(),
                    current: pkg.version.clone(),
                    tag: cliff::tag_name(&pkg.name, pkg.name == APP_PACKAGE, &next),
                    next,
                    level: *level,
                    reason,
                },
            );
        }
    }

    let reverse = ws.reverse_deps();
    loop {
        let bumped: Vec<String> = entries.keys().map(|s| s.to_string()).collect();
        let mut added = false;
        for name in &bumped {
            for dependent in reverse.get(name.as_str()).into_iter().flatten() {
                if entries.contains_key(dependent) {
                    continue;
                }
                let pkg = ws.get(dependent).unwrap();
                let tagged = direct[dependent].2.clone();
                let baseline = tagged.as_ref().unwrap_or(&pkg.version);
                let next = bump(baseline, Level::Patch);
                let next = if pkg.version > next {
                    pkg.version.clone()
                } else {
                    next
                };
                entries.insert(
                    pkg.name.as_str(),
                    Entry {
                        name: pkg.name.clone(),
                        current: pkg.version.clone(),
                        tag: cliff::tag_name(&pkg.name, pkg.name == APP_PACKAGE, &next),
                        next,
                        level: Level::Patch,
                        reason: format!("dependency {name} released"),
                    },
                );
                added = true;
            }
        }
        if !added {
            break;
        }
    }

    Ok(entries.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    #[test]
    fn levels() {
        assert_eq!(commit_level(Some("feat"), false), Level::Minor);
        assert_eq!(commit_level(Some("feat"), true), Level::Major);
        assert_eq!(commit_level(Some("fix"), false), Level::Patch);
        assert_eq!(commit_level(Some("refactor"), false), Level::Patch);
        assert_eq!(commit_level(Some("chore"), false), Level::None);
        assert_eq!(commit_level(Some("chore"), true), Level::Major);
        assert_eq!(commit_level(None, false), Level::Patch); // unconventional
    }

    #[test]
    fn bumps() {
        assert_eq!(bump(&v("1.2.3"), Level::Major), v("2.0.0"));
        assert_eq!(bump(&v("0.2.3"), Level::Minor), v("0.3.0"));
        assert_eq!(bump(&v("1.2.3"), Level::Patch), v("1.2.4"));
        // Pre-1.0: breaking bumps the 0.x compatibility boundary, not to 1.0.
        assert_eq!(bump(&v("0.6.0"), Level::Major), v("0.7.0"));
        assert_eq!(bump(&v("0.2.0"), Level::Major), v("0.3.0"));
    }

    #[test]
    fn next_from_commits() {
        // Tagged crate, minor changes since.
        assert_eq!(
            next_version(&v("0.6.0"), Some(&v("0.6.0")), Level::Minor),
            Some((v("0.7.0"), BumpSource::Commits))
        );
        // Nothing to do.
        assert_eq!(
            next_version(&v("0.6.0"), Some(&v("0.6.0")), Level::None),
            None
        );
    }

    #[test]
    fn hand_bump_wins() {
        // Cargo.toml pre-set to 1.0.0 while last tag is v0.6.0: release 1.0.0
        // even though the commits only justify a minor.
        assert_eq!(
            next_version(&v("1.0.0"), Some(&v("0.6.0")), Level::Minor),
            Some((v("1.0.0"), BumpSource::HandBumped))
        );
        // Hand-bump with no releasable commits still releases.
        assert_eq!(
            next_version(&v("0.6.1"), Some(&v("0.6.0")), Level::None),
            Some((v("0.6.1"), BumpSource::HandBumped))
        );
        // Commits computing PAST the hand-bump take precedence.
        assert_eq!(
            next_version(&v("0.6.1"), Some(&v("0.6.0")), Level::Major),
            Some((v("0.7.0"), BumpSource::Commits))
        );
    }

    #[test]
    fn untagged_uses_current_as_baseline() {
        assert_eq!(
            next_version(&v("0.1.0"), None, Level::Patch),
            Some((v("0.1.1"), BumpSource::Commits))
        );
        assert_eq!(next_version(&v("0.1.0"), None, Level::None), None);
    }
}
