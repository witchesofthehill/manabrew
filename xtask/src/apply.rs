use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use semver::Version;
use toml_edit::{DocumentMut, Item, Value};

use crate::plan::Entry;
use crate::util::capture;
use crate::workspace::{Workspace, APP_MIRROR_FILES, APP_PACKAGE};

/// Replace a TOML value in place, keeping its surrounding whitespace/comments.
fn set_value_preserving_decor(item: &mut Item, next: &Version) -> bool {
    let Some(val) = item.as_value_mut() else {
        return false;
    };
    let decor = val.decor().clone();
    *val = Value::from(next.to_string());
    *val.decor_mut() = decor;
    true
}

/// Rewrite `[package] version` in a crate manifest, preserving formatting.
pub fn set_package_version(doc: &mut DocumentMut, next: &Version) -> Result<()> {
    let ok = doc
        .get_mut("package")
        .and_then(|p| p.get_mut("version"))
        .is_some_and(|v| set_value_preserving_decor(v, next));
    if !ok {
        bail!("no [package].version field");
    }
    Ok(())
}

/// Update `version = "..."` requirements on path deps pointing at `dep_name`,
/// in every dependency table of the document (normal/dev/build + target-
/// specific). Only existing `version` keys are touched: version-less path
/// deps stay version-less (adding reqs is a one-time manual decision tied to
/// crates.io publishing).
pub fn sync_dep_requirement(doc: &mut DocumentMut, dep_name: &str, next: &Version) {
    fn visit(item: &mut Item, dep_name: &str, next: &Version) {
        let Some(table) = item.as_table_like_mut() else {
            return;
        };
        let keys: Vec<String> = table.iter().map(|(k, _)| k.to_string()).collect();
        for key in keys {
            let is_dep_table = key.ends_with("dependencies");
            let entry = table.get_mut(&key).unwrap();
            if is_dep_table {
                if let Some(deps) = entry.as_table_like_mut() {
                    if let Some(dep) = deps.get_mut(dep_name) {
                        if let Some(spec) = dep.as_table_like_mut() {
                            if spec.contains_key("path") {
                                if let Some(version) = spec.get_mut("version") {
                                    set_value_preserving_decor(version, next);
                                }
                            }
                        }
                    }
                }
            } else {
                // Recurse for [target.'cfg(...)'.dependencies] and friends.
                visit(entry, dep_name, next);
            }
        }
    }
    visit(doc.as_item_mut(), dep_name, next);
}

/// Replace the first `"version": "..."` in a JSON file textually, preserving
/// formatting (package.json / tauri.conf.json keep their own style).
pub fn set_json_version(text: &str, next: &Version) -> Result<String> {
    let needle = "\"version\":";
    let start = text.find(needle).context("no \"version\" key")?;
    let after = &text[start + needle.len()..];
    let open = after.find('"').context("malformed version value")?;
    let close = after[open + 1..]
        .find('"')
        .context("malformed version value")?;
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..start + needle.len() + open + 1]);
    out.push_str(&next.to_string());
    out.push_str(&after[open + 1 + close..]);
    Ok(out)
}

/// Apply a release plan to the working tree: crate versions, path-dep version
/// requirements, app version mirrors, Cargo.lock, ops/manifest.json.
pub fn apply(ws: &Workspace, root: &Path, plan: &[Entry]) -> Result<()> {
    for pkg in &ws.packages {
        let path = root.join(&pkg.manifest);
        let text = fs::read_to_string(&path)?;
        let mut doc: DocumentMut = text
            .parse()
            .with_context(|| format!("parsing {}", pkg.manifest.display()))?;
        let mut changed = false;
        if let Some(entry) = plan.iter().find(|e| e.name == pkg.name) {
            set_package_version(&mut doc, &entry.next)
                .with_context(|| pkg.manifest.display().to_string())?;
            changed = true;
        }
        for entry in plan.iter().filter(|e| e.name != pkg.name) {
            let before = doc.to_string();
            sync_dep_requirement(&mut doc, &entry.name, &entry.next);
            changed |= doc.to_string() != before;
        }
        if changed {
            fs::write(&path, doc.to_string())?;
        }
    }

    if let Some(app) = plan.iter().find(|e| e.name == APP_PACKAGE) {
        for file in APP_MIRROR_FILES {
            let path = root.join(file);
            let text = fs::read_to_string(&path)?;
            fs::write(&path, set_json_version(&text, &app.next).context(*file)?)?;
        }
    }

    // Refresh Cargo.lock for the new workspace versions. Offline: versions of
    // path deps never need the network; tolerate failure the way bump.mjs did.
    let lock = capture(root, "cargo", &["update", "--workspace", "--offline"])?;
    if !lock.status.success() {
        eprintln!("note: `cargo update --workspace --offline` failed; run `cargo build` to refresh Cargo.lock");
    }

    // Reload: the manifest must reflect the versions just written to disk,
    // not the Workspace snapshot from before the bump.
    let reloaded = Workspace::load(root)?;
    crate::manifest::generate(&reloaded, root, true)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    #[test]
    fn rewrites_package_version_preserving_layout() {
        let src = "[package]\nname = \"demo\"\nversion = \"0.1.0\" # keep me\nedition = \"2021\"\n";
        let mut doc: DocumentMut = src.parse().unwrap();
        set_package_version(&mut doc, &v("0.2.0")).unwrap();
        assert_eq!(
            doc.to_string(),
            "[package]\nname = \"demo\"\nversion = \"0.2.0\" # keep me\nedition = \"2021\"\n"
        );
    }

    #[test]
    fn syncs_versioned_path_deps_only() {
        let src = r#"[dependencies]
forge-card-script = { path = "../forge-card-script", version = "0.1.0" }
other = { path = "../other" }

[dev-dependencies]
forge-card-script = { path = "../forge-card-script", version = "0.1.0" }

[target.'cfg(unix)'.dependencies]
forge-card-script = { path = "../x", version = "0.1.0" }
"#;
        let mut doc: DocumentMut = src.parse().unwrap();
        sync_dep_requirement(&mut doc, "forge-card-script", &v("0.2.0"));
        sync_dep_requirement(&mut doc, "other", &v("9.9.9"));
        let out = doc.to_string();
        assert_eq!(out.matches("version = \"0.2.0\"").count(), 3);
        // Version-less path dep untouched.
        assert!(out.contains("other = { path = \"../other\" }"));
    }

    #[test]
    fn rewrites_json_version() {
        let src =
            "{\n  \"name\": \"manabrew\",\n  \"version\": \"0.6.0\",\n  \"private\": true\n}\n";
        let out = set_json_version(src, &v("1.0.0")).unwrap();
        assert_eq!(
            out,
            "{\n  \"name\": \"manabrew\",\n  \"version\": \"1.0.0\",\n  \"private\": true\n}\n"
        );
    }
}
