//! Code exploration tools: grep_code, read_file, list_files.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Maximum lines returned by grep_code.
const MAX_GREP_LINES: usize = 30;

/// Maximum bytes returned by read_file.
const MAX_READ_BYTES: usize = 4096;

/// Maximum file entries returned by list_files.
const MAX_LIST_ENTRIES: usize = 50;

/// Resolve and validate a path relative to the project root.
/// Prevents directory traversal outside the project.
fn safe_resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Root path invalid: {e}"))?;
    let candidate = canonical_root.join(relative);
    let resolved = candidate
        .canonicalize()
        .map_err(|e| format!("Path not found: {relative} ({e})"))?;
    if !resolved.starts_with(&canonical_root) {
        return Err(format!("Path traversal blocked: {relative}"));
    }
    Ok(resolved)
}

/// Search Rust source files by regex pattern within `manabrew-engine/`.
///
/// Returns up to 30 matching lines in `file:line:content` format.
pub fn grep_code(project_root: &Path, pattern: &str) -> String {
    let canonical_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    let search_dir = canonical_root.join("manabrew-engine");
    if !search_dir.exists() {
        return "Error: manabrew-engine/ directory not found".to_string();
    }

    let output = Command::new("grep")
        .args(["-rn", "--include=*.rs", pattern])
        .arg(&search_dir)
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if stdout.is_empty() {
                return format!("No matches for pattern: {pattern}");
            }

            // Strip project root prefix for cleaner output
            let root_prefix = canonical_root.to_string_lossy();
            let lines: Vec<&str> = stdout.lines().take(MAX_GREP_LINES).collect();
            let mut result = String::new();
            for line in &lines {
                let clean = line
                    .strip_prefix(root_prefix.as_ref())
                    .map(|s| s.strip_prefix('/').unwrap_or(s))
                    .unwrap_or(line);
                result.push_str(clean);
                result.push('\n');
            }

            let total = stdout.lines().count();
            if total > MAX_GREP_LINES {
                result.push_str(&format!(
                    "\n[{} more matches truncated]",
                    total - MAX_GREP_LINES
                ));
            }
            result
        }
        Err(e) => format!("grep failed: {e}"),
    }
}

/// Read a file (or line range) with line numbers.
///
/// Returns up to 4KB of content, truncated with a notice.
pub fn read_file(
    project_root: &Path,
    relative_path: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> String {
    let path = match safe_resolve(project_root, relative_path) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return format!("Failed to read {relative_path}: {e}"),
    };

    let lines: Vec<&str> = content.lines().collect();
    let start = start_line.unwrap_or(1).saturating_sub(1);
    let end = end_line.unwrap_or(lines.len()).min(lines.len());

    if start >= lines.len() {
        return format!(
            "Start line {start} exceeds file length ({} lines)",
            lines.len()
        );
    }

    let mut result = String::new();
    let mut bytes = 0;
    for (i, line) in lines[start..end].iter().enumerate() {
        let numbered = format!("{:>4} | {}\n", start + i + 1, line);
        bytes += numbered.len();
        if bytes > MAX_READ_BYTES {
            result.push_str("[truncated at 4KB]\n");
            break;
        }
        result.push_str(&numbered);
    }
    result
}

/// List files matching a glob pattern relative to the project root.
///
/// Returns up to 50 matching file paths.
pub fn list_files(project_root: &Path, pattern: &str) -> String {
    let full_pattern = project_root.join(pattern).to_string_lossy().to_string();
    match glob::glob(&full_pattern) {
        Ok(paths) => {
            let root_str = project_root.to_string_lossy();
            let mut results = Vec::new();
            for entry in paths.flatten() {
                if results.len() >= MAX_LIST_ENTRIES {
                    break;
                }
                let display = entry
                    .to_string_lossy()
                    .strip_prefix(root_str.as_ref())
                    .map(|s| s.strip_prefix('/').unwrap_or(s).to_string())
                    .unwrap_or_else(|| entry.to_string_lossy().to_string());
                results.push(display);
            }

            if results.is_empty() {
                return format!("No files matching: {pattern}");
            }

            let total_hint = if results.len() >= MAX_LIST_ENTRIES {
                format!("\n[limited to {MAX_LIST_ENTRIES} results]")
            } else {
                String::new()
            };
            format!("{}{}", results.join("\n"), total_hint)
        }
        Err(e) => format!("Invalid glob pattern: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Get the workspace root (3 levels up from CARGO_MANIFEST_DIR for parity).
    fn workspace_root() -> PathBuf {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // manabrew-rs/crates/parity -> go up 3 levels to repo root
        manifest
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn safe_resolve_blocks_traversal() {
        let root = workspace_root();
        let result = safe_resolve(&root, "../../etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("traversal") || err.contains("not found"));
    }

    #[test]
    fn read_file_with_line_range() {
        let root = workspace_root();
        let result = read_file(
            &root,
            "manabrew-rs/crates/parity/src/tools/code_tools.rs",
            Some(1),
            Some(5),
        );
        assert!(result.contains("Code exploration tools"));
    }

    #[test]
    fn grep_code_finds_pattern() {
        let root = workspace_root();
        let result = grep_code(&root, "grep_code");
        assert!(result.contains("code_tools.rs"));
    }

    #[test]
    fn list_files_finds_rs_files() {
        let root = workspace_root();
        let result = list_files(&root, "manabrew-rs/crates/parity/src/tools/*.rs");
        assert!(result.contains("code_tools.rs"));
    }
}
