//! Embeds the deploy config set into the binary at build time. The binary is
//! built at the release tag by CI, so the embedded files ARE that release's
//! config — `xtask deploy` needs no git checkout at runtime, and config/image
//! skew (issue #512 gap 1) becomes impossible by construction rather than
//! asserted. git runs here, at compile time, where a checkout always exists.

use std::path::PathBuf;
use std::process::Command;

const CONFIG_PATHS: [&str; 5] = [
    "compose.production.yml",
    "compose.staging.yml",
    "compose.selfhost.yml",
    "ops",
    "scripts/ingest-events.py",
];

fn main() {
    println!("cargo:rerun-if-env-changed=XTASK_BUILD_TAG");
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_path_buf();
    for p in CONFIG_PATHS {
        println!("cargo:rerun-if-changed={}", root.join(p).display());
    }

    let mut args = vec!["ls-files", "-z", "--"];
    args.extend(CONFIG_PATHS);
    let out = Command::new("git")
        .args(&args)
        .current_dir(&root)
        .output()
        .expect("git is required to build xtask (it embeds the tracked deploy config)");
    assert!(out.status.success(), "git ls-files failed");
    let files: Vec<&str> = std::str::from_utf8(&out.stdout)
        .unwrap()
        .split('\0')
        .filter(|f| !f.is_empty())
        .collect();
    assert!(files.len() > 10, "suspiciously small config set: {files:?}");

    let mut code = String::from("pub static CONFIG_FILES: &[(&str, &[u8])] = &[\n");
    for f in &files {
        let abs = root.join(f);
        code.push_str(&format!(
            "    ({f:?}, include_bytes!({:?})),\n",
            abs.display().to_string()
        ));
    }
    code.push_str("];\n");
    let dest = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("config_embed.rs");
    std::fs::write(dest, code).unwrap();
}
