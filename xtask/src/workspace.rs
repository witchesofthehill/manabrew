use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use semver::Version;
use serde::Deserialize;

use crate::util::run;

/// The desktop app package: owns the plain `v*` tags and mirrors its version
/// into package.json / tauri.conf.json.
pub const APP_PACKAGE: &str = "manabrew";
/// Files/dirs outside `src-tauri/` that count as app changes (the web bundle
/// ships inside the desktop app and at play.manabrew.app).
pub const APP_EXTRA_DIRS: &[&str] = &["src", "public"];
pub const APP_EXTRA_FILES: &[&str] = &[
    "package.json",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "yarn.lock",
];
pub const APP_MIRROR_FILES: &[&str] = &["package.json", "src-tauri/tauri.conf.json"];
/// Internal-tooling crates that never version, tag, or appear in the manifest.
pub const IGNORED_PACKAGES: &[&str] = &["xtask"];

pub struct Package {
    pub name: String,
    pub version: Version,
    /// Repo-relative directory of the crate.
    pub dir: PathBuf,
    /// Repo-relative path to Cargo.toml.
    pub manifest: PathBuf,
    /// `publish = false` unset (i.e. publishable to crates.io).
    pub publishable: bool,
    /// Names of workspace-internal path dependencies (normal + build kinds;
    /// dev-deps excluded — they don't affect shipped artifacts).
    pub internal_deps: BTreeSet<String>,
}

pub struct Workspace {
    pub root: PathBuf,
    pub packages: Vec<Package>,
}

#[derive(Deserialize)]
struct Metadata {
    packages: Vec<MetaPackage>,
    workspace_root: PathBuf,
}

#[derive(Deserialize)]
struct MetaPackage {
    name: String,
    version: String,
    manifest_path: PathBuf,
    publish: Option<Vec<String>>,
    dependencies: Vec<MetaDep>,
}

#[derive(Deserialize)]
struct MetaDep {
    path: Option<PathBuf>,
    kind: Option<String>,
}

impl Workspace {
    pub fn load(root: &Path) -> Result<Workspace> {
        let json = run(
            root,
            "cargo",
            &["metadata", "--no-deps", "--format-version", "1"],
        )?;
        let meta: Metadata = serde_json::from_str(&json).context("parsing cargo metadata")?;
        let root = meta.workspace_root;

        let dir_to_name: BTreeMap<PathBuf, String> = meta
            .packages
            .iter()
            .map(|p| {
                (
                    p.manifest_path.parent().unwrap().to_path_buf(),
                    p.name.clone(),
                )
            })
            .collect();

        let mut packages = Vec::new();
        for p in &meta.packages {
            if IGNORED_PACKAGES.contains(&p.name.as_str()) {
                continue;
            }
            let internal_deps = p
                .dependencies
                .iter()
                .filter(|d| d.kind.as_deref() != Some("dev"))
                .filter_map(|d| d.path.as_ref())
                .filter_map(|path| dir_to_name.get(path).cloned())
                .filter(|name| !IGNORED_PACKAGES.contains(&name.as_str()))
                .collect();
            let manifest_abs = &p.manifest_path;
            packages.push(Package {
                name: p.name.clone(),
                version: Version::parse(&p.version)
                    .with_context(|| format!("bad version for {}", p.name))?,
                dir: manifest_abs
                    .parent()
                    .unwrap()
                    .strip_prefix(&root)
                    .with_context(|| format!("{} outside workspace root", p.name))?
                    .to_path_buf(),
                manifest: manifest_abs.strip_prefix(&root).unwrap().to_path_buf(),
                publishable: p.publish.is_none(),
                internal_deps,
            });
        }
        packages.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(Workspace { root, packages })
    }

    pub fn get(&self, name: &str) -> Option<&Package> {
        self.packages.iter().find(|p| p.name == name)
    }

    /// Repo-relative path globs owned by a package (for git-cliff --include-path).
    pub fn include_globs(&self, pkg: &Package) -> Vec<String> {
        let mut globs = vec![format!("{}/**", pkg.dir.display())];
        if pkg.name == APP_PACKAGE {
            globs.extend(APP_EXTRA_DIRS.iter().map(|d| format!("{d}/**")));
            globs.extend(APP_EXTRA_FILES.iter().map(|f| f.to_string()));
        }
        globs
    }

    /// name -> names of packages that (transitively, via non-dev path deps)
    /// depend on it.
    pub fn reverse_deps(&self) -> BTreeMap<&str, BTreeSet<&str>> {
        let mut direct: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for p in &self.packages {
            for dep in &p.internal_deps {
                direct
                    .entry(dep.as_str())
                    .or_default()
                    .insert(p.name.as_str());
            }
        }
        // Transitive closure: dependents of my dependents are my dependents.
        let names: Vec<&str> = self.packages.iter().map(|p| p.name.as_str()).collect();
        let mut closed: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for &name in &names {
            let mut seen: BTreeSet<&str> = BTreeSet::new();
            let mut stack: Vec<&str> = direct.get(name).into_iter().flatten().copied().collect();
            while let Some(n) = stack.pop() {
                if seen.insert(n) {
                    stack.extend(direct.get(n).into_iter().flatten().copied());
                }
            }
            closed.insert(name, seen);
        }
        closed
    }

    /// Publishable packages in dependency order (dependencies before dependents).
    pub fn publish_order(&self) -> Vec<&Package> {
        let set: BTreeSet<&str> = self
            .packages
            .iter()
            .filter(|p| p.publishable)
            .map(|p| p.name.as_str())
            .collect();
        let mut ordered: Vec<&Package> = Vec::new();
        let mut placed: BTreeSet<&str> = BTreeSet::new();
        while placed.len() < set.len() {
            let before = placed.len();
            for p in self
                .packages
                .iter()
                .filter(|p| set.contains(p.name.as_str()))
            {
                if placed.contains(p.name.as_str()) {
                    continue;
                }
                let ready = p
                    .internal_deps
                    .iter()
                    .filter(|d| set.contains(d.as_str()))
                    .all(|d| placed.contains(d.as_str()));
                if ready {
                    placed.insert(p.name.as_str());
                    ordered.push(p);
                }
            }
            assert!(placed.len() > before, "dependency cycle in publish set");
        }
        ordered
    }
}
