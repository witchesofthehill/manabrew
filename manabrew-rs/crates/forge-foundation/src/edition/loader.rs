#![cfg(not(target_arch = "wasm32"))]

use std::fs;
use std::io;
use std::path::Path;

use super::editions_registry::EditionsRegistry;

#[derive(Debug, Clone, Default)]
pub struct LoadReport {
    pub loaded: usize,
    pub errors: Vec<String>,
}

pub fn load_editions_dir(dir: &Path, registry: &mut EditionsRegistry) -> io::Result<LoadReport> {
    let mut report = LoadReport::default();
    for entry in fs::read_dir(dir)? {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                report.errors.push(format!("read_dir entry: {e}"));
                continue;
            }
        };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("txt") {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(body) => {
                let code = registry.ingest_file(&body);
                if code.is_empty() {
                    report
                        .errors
                        .push(format!("{}: missing Code= in [metadata]", path.display()));
                } else {
                    report.loaded += 1;
                }
            }
            Err(e) => report.errors.push(format!("{}: {e}", path.display())),
        }
    }
    Ok(report)
}
