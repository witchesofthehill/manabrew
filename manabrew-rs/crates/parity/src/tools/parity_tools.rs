//! Parity test runner tool: run_parity_test.

use std::path::Path;
use std::time::Duration;

/// Timeout for a single parity test run.
const PARITY_TIMEOUT: Duration = Duration::from_secs(60);

/// Configuration needed to run parity tests.
pub struct ParityToolConfig {
    pub java_jar: Option<String>,
    pub cards_dir: Option<String>,
    pub project_root: String,
}

/// Run a single parity test with specified deck pair and seed.
///
/// Spawns the `parity` binary as a subprocess.
/// Returns pass/fail with divergence details.
pub async fn run_parity_test(
    config: &ParityToolConfig,
    deck1: &str,
    deck2: &str,
    seed: u64,
) -> String {
    let java_jar = match &config.java_jar {
        Some(jar) => jar.clone(),
        None => return "Error: java_jar not configured. Cannot run parity tests.".to_string(),
    };

    let cards_dir = config
        .cards_dir
        .as_deref()
        .unwrap_or("forge/forge-gui/res/cardsfolder");

    // Build command
    let parity_bin = Path::new(&config.project_root).join("target/release/parity");
    let parity_bin_str = if parity_bin.exists() {
        parity_bin.to_string_lossy().to_string()
    } else {
        // Fall back to debug build or cargo run
        "cargo".to_string()
    };

    let mut cmd = if parity_bin_str == "cargo" {
        let mut c = tokio::process::Command::new("cargo");
        c.args(["run", "-p", "parity", "--"]);
        c
    } else {
        tokio::process::Command::new(&parity_bin_str)
    };

    cmd.args([
        "--deck1",
        deck1,
        "--deck2",
        deck2,
        "--seed",
        &seed.to_string(),
        "--java-jar",
        &java_jar,
        "--cards-dir",
        cards_dir,
    ]);

    // Set JAVA_HOME for zulu-18 (critical for Java harness)
    let java_home = std::env::var("JAVA_HOME").unwrap_or_else(|_| {
        "/Library/Java/JavaVirtualMachines/zulu-18.jdk/Contents/Home".to_string()
    });
    cmd.env("JAVA_HOME", &java_home);

    cmd.current_dir(&config.project_root);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return format!("Failed to spawn parity test: {e}"),
    };

    // Wait with timeout
    match tokio::time::timeout(PARITY_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            if output.status.success() {
                format!("PASS: {deck1} vs {deck2} seed={seed}\n{stdout}")
            } else {
                let mut result = format!("FAIL: {deck1} vs {deck2} seed={seed}\n");
                if !stdout.is_empty() {
                    result.push_str(&format!("stdout:\n{stdout}\n"));
                }
                if !stderr.is_empty() {
                    // Truncate stderr to avoid flooding context
                    let stderr_str = stderr.to_string();
                    if stderr_str.len() > 2048 {
                        result.push_str(&format!(
                            "stderr (truncated):\n{}\n[...truncated...]",
                            &stderr_str[..2048]
                        ));
                    } else {
                        result.push_str(&format!("stderr:\n{stderr_str}\n"));
                    }
                }
                result
            }
        }
        Ok(Err(e)) => format!("Parity test error: {e}"),
        Err(_) => format!("Parity test timed out after {}s", PARITY_TIMEOUT.as_secs()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_without_java_jar() {
        let config = ParityToolConfig {
            java_jar: None,
            cards_dir: None,
            project_root: ".".to_string(),
        };
        // Can't actually run, but verify the config is valid
        assert!(config.java_jar.is_none());
    }
}
