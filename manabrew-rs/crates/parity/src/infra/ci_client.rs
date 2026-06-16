//! CI client mode for submitting and polling parity regression jobs.
//!
//! This is a simple HTTP client that talks to the parity server's job queue API.
//! It avoids the need for python3/jq/curl on the CI runner.
//!
//! Usage:
//!   parity ci-client submit --server http://localhost:8080 --file regression.json
//!   parity ci-client poll --server http://localhost:8080 --batch-id 1
//!   parity ci-client health --server http://localhost:8080

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub fn main() {
    let args: Vec<String> = std::env::args().collect();
    run(&args);
}

pub fn run(args: &[String]) {
    if args.len() < 2 {
        eprintln!("Usage: parity ci-client <health|submit|poll> [options]");
        std::process::exit(1);
    }

    let command = &args[1];
    let server = get_arg(&args, "--server").unwrap_or_else(|| "http://localhost:8080".to_string());
    let (host, port) = parse_host_port(&server);

    match command.as_str() {
        "health" => cmd_health(&host, port),
        "submit" => {
            let file = get_arg(&args, "--file").unwrap_or_else(|| {
                eprintln!("--file is required for submit");
                std::process::exit(1);
            });
            cmd_submit(&host, port, &file);
        }
        "poll" => {
            let batch_id = get_arg(&args, "--batch-id").unwrap_or_else(|| {
                eprintln!("--batch-id is required for poll");
                std::process::exit(1);
            });
            let pr_comment = get_arg(&args, "--pr").filter(|p| p != "0");
            let repo = get_arg(&args, "--repo");
            cmd_poll(
                &host,
                port,
                &batch_id,
                pr_comment.as_deref(),
                repo.as_deref(),
            );
        }
        _ => {
            eprintln!("Unknown command: {command}. Use health, submit, or poll.");
            std::process::exit(1);
        }
    }
}

fn get_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn parse_host_port(server: &str) -> (String, u16) {
    let s = server
        .strip_prefix("http://")
        .or_else(|| server.strip_prefix("https://"))
        .unwrap_or(server);
    match s.rsplit_once(':') {
        Some((host, port_str)) => {
            let port = port_str.parse().unwrap_or(8080);
            (host.to_string(), port)
        }
        None => (s.to_string(), 8080),
    }
}

fn tcp_connect(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
    use std::net::ToSocketAddrs;
    let addr_str = format!("{host}:{port}");
    let addr = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("resolve {addr_str}: {e}"))?
        .next()
        .ok_or_else(|| format!("no addresses for {addr_str}"))?;
    let stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("connect {addr_str}: {e}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();
    Ok(stream)
}

fn http_get(host: &str, port: u16, path: &str, timeout: Duration) -> Result<(u16, String), String> {
    let mut stream = tcp_connect(host, port, timeout)?;

    let request = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("write: {e}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| format!("read: {e}"))?;

    parse_http_response(&response)
}

fn http_post(
    host: &str,
    port: u16,
    path: &str,
    body: &str,
    timeout: Duration,
) -> Result<(u16, String), String> {
    let mut stream = tcp_connect(host, port, timeout)?;

    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("write: {e}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| format!("read: {e}"))?;

    parse_http_response(&response)
}

fn parse_http_response(raw: &str) -> Result<(u16, String), String> {
    let (headers, body) = raw
        .split_once("\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response".to_string())?;

    let status_line = headers
        .lines()
        .next()
        .ok_or_else(|| "no status line".to_string())?;
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Handle chunked transfer encoding
    if headers
        .to_lowercase()
        .contains("transfer-encoding: chunked")
    {
        let decoded = decode_chunked(body);
        Ok((status_code, decoded))
    } else {
        Ok((status_code, body.to_string()))
    }
}

fn decode_chunked(body: &str) -> String {
    let mut result = String::new();
    let mut remaining = body;

    while let Some((size_str, rest)) = remaining.split_once("\r\n") {
        let chunk_size = usize::from_str_radix(size_str.trim(), 16).unwrap_or(0);
        if chunk_size == 0 {
            break;
        }
        if rest.len() < chunk_size {
            // Incomplete chunk, take what we have
            result.push_str(rest);
            break;
        }
        result.push_str(&rest[..chunk_size]);
        // Skip past chunk data + \r\n
        remaining = if rest.len() > chunk_size + 2 {
            &rest[chunk_size + 2..]
        } else {
            ""
        };
    }

    result
}

fn cmd_health(host: &str, port: u16) {
    eprintln!("[ci] Waiting for server at {host}:{port} ...");
    for i in 1..=120 {
        match http_get(host, port, "/api/health", Duration::from_secs(5)) {
            Ok((200, _)) => {
                println!("Server ready after {i}s");
                return;
            }
            Ok((code, body)) => {
                if i % 10 == 0 {
                    eprintln!("[ci] Health check returned {code}: {body}");
                }
            }
            Err(e) => {
                if i % 10 == 0 {
                    eprintln!("[ci] Health check failed: {e}");
                }
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    eprintln!("[ci] Server failed to start within 120s");
    std::process::exit(1);
}

fn cmd_submit(host: &str, port: u16, file: &str) {
    let body = match std::fs::read_to_string(file) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[ci] Failed to read {file}: {e}");
            std::process::exit(1);
        }
    };

    eprintln!("[ci] Submitting regression jobs from {file}...");
    match http_post(host, port, "/api/jobs", &body, Duration::from_secs(30)) {
        Ok((200, resp_body)) => {
            let v: serde_json::Value = match serde_json::from_str(&resp_body) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("[ci] Failed to parse response: {e}");
                    eprintln!("[ci] Raw response: {resp_body}");
                    std::process::exit(1);
                }
            };
            let batch_id = v["batch_id"].as_u64().unwrap_or(0);
            let total = v["total_jobs"].as_u64().unwrap_or(0);
            eprintln!("[ci] Submitted batch {batch_id} with {total} jobs");
            // Print batch_id to stdout for the workflow to capture
            println!("{batch_id}");
        }
        Ok((code, body)) => {
            eprintln!("[ci] Submit failed with HTTP {code}: {body}");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("[ci] Submit request failed: {e}");
            std::process::exit(1);
        }
    }
}

fn cmd_poll(host: &str, port: u16, batch_id: &str, pr: Option<&str>, repo: Option<&str>) {
    let path = format!("/api/jobs/{batch_id}");
    eprintln!("[ci] Polling batch {batch_id}...");

    let mut poll_count = 0u32;
    let mut last_completed = 0u64;
    let mut consecutive_failures = 0u32;
    let mut last_seen_batch: Option<serde_json::Value> = None;

    loop {
        poll_count += 1;

        match http_get(host, port, &path, Duration::from_secs(30)) {
            Ok((200, body)) => {
                let v: serde_json::Value = match serde_json::from_str(&body) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[poll {poll_count}] Parse error: {e}");
                        eprintln!("[poll {poll_count}] Raw: {}", &body[..body.len().min(200)]);
                        std::thread::sleep(Duration::from_secs(5));
                        continue;
                    }
                };
                last_seen_batch = Some(v.clone());
                consecutive_failures = 0;

                let completed = v["completed"].as_u64().unwrap_or(0);
                let total = v["total"].as_u64().unwrap_or(0);
                let passed = v["passed"].as_u64().unwrap_or(0);
                let failed = v["failed"].as_u64().unwrap_or(0);
                let errors = v["errors"].as_u64().unwrap_or(0);
                let done = v["done"].as_bool().unwrap_or(false);

                // Print progress when it changes or every 10 polls
                if completed != last_completed || poll_count % 10 == 0 {
                    eprintln!(
                        "[poll {poll_count}] Progress: {completed}/{total} (pass={passed} fail={failed} error={errors})"
                    );
                    if completed == last_completed {
                        if let Some(active) = describe_active_job(&v) {
                            eprintln!("[poll {poll_count}] Active: {active}");
                        }
                    }
                    last_completed = completed;
                }

                if done {
                    println!();
                    println!("=== Final Results ===");
                    println!("Total:  {total}");
                    println!("Passed: {passed}");
                    println!("Failed: {failed}");
                    println!("Errors: {errors}");

                    if failed > 0 || errors > 0 {
                        let report = build_failure_report(&v);
                        println!("{report}");

                        // Post as PR comment if requested
                        if let (Some(pr_num), Some(repo_name)) = (pr, repo) {
                            post_pr_comment(
                                repo_name, pr_num, &report, total, passed, failed, errors,
                            );
                        }

                        std::process::exit(1);
                    }

                    // Post success comment if requested
                    if let (Some(pr_num), Some(repo_name)) = (pr, repo) {
                        let comment = format!(
                            "## Parity Regression: All Passing\n\n\
                             | Metric | Count |\n|--------|-------|\n\
                             | Total | {total} |\n| Passed | {passed} |\n| Failed | 0 |\n| Errors | 0 |"
                        );
                        gh_comment(repo_name, pr_num, &comment);
                    }

                    std::process::exit(0);
                }
            }
            Ok((code, body)) => {
                eprintln!(
                    "[poll {poll_count}] HTTP {code}: {}",
                    &body[..body.len().min(200)]
                );
            }
            Err(e) => {
                eprintln!("[poll {poll_count}] Request failed: {e}");
                consecutive_failures += 1;
                if consecutive_failures >= 3 {
                    print_server_crash_diagnostics(&last_seen_batch);
                    std::process::exit(1);
                }
            }
        }

        std::thread::sleep(Duration::from_secs(5));
    }
}

fn describe_active_job(batch: &serde_json::Value) -> Option<String> {
    let active = batch.get("active_job")?;
    if active.is_null() {
        return None;
    }
    let regression = active
        .get("regression_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let deck1 = active
        .get("deck1")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let deck2 = active
        .get("deck2")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let seed = active.get("seed").and_then(|v| v.as_u64()).unwrap_or(0);
    let max_turns = active
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Some(format!(
        "{regression} {deck1} vs {deck2} seed={seed} max_turns={max_turns}"
    ))
}

fn print_server_crash_diagnostics(last_seen_batch: &Option<serde_json::Value>) {
    eprintln!();
    eprintln!("[ci] Parity server became unreachable during polling.");

    if let Some(v) = last_seen_batch {
        let completed = v["completed"].as_u64().unwrap_or(0);
        let total = v["total"].as_u64().unwrap_or(0);
        let passed = v["passed"].as_u64().unwrap_or(0);
        let failed = v["failed"].as_u64().unwrap_or(0);
        let errors = v["errors"].as_u64().unwrap_or(0);
        eprintln!(
            "[ci] Last seen progress: {completed}/{total} (pass={passed} fail={failed} error={errors})"
        );

        if let Some(active) = format_active_job(&v["active_job"]) {
            eprintln!("[ci] Matchup in progress when the server disappeared: {active}");
        }
    }

    if let Some(snippet) = read_server_log_snippet("parity-server.log") {
        eprintln!("[ci] Recent panic/server log:");
        eprintln!("{snippet}");
    } else {
        eprintln!("[ci] parity-server.log not available from the current working directory");
    }
}

fn format_active_job(v: &serde_json::Value) -> Option<String> {
    if v.is_null() {
        return None;
    }
    let regression = v["regression_name"].as_str().unwrap_or("?");
    let deck1 = v["deck1"].as_str().unwrap_or("?");
    let deck2 = v["deck2"].as_str().unwrap_or("?");
    let seed = v["seed"].as_u64().unwrap_or(0);
    let max_turns = v["max_turns"].as_u64().unwrap_or(0);
    Some(format!(
        "{regression}: {deck1} vs {deck2} seed={seed} max_turns={max_turns}"
    ))
}

fn read_server_log_snippet(path: &str) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let lines: Vec<&str> = raw.lines().collect();

    let mut start = lines.len().saturating_sub(20);
    for (idx, line) in lines.iter().enumerate().rev() {
        if line.contains("panicked at") || line.contains("parity panicked") {
            start = idx.saturating_sub(3);
            break;
        }
    }

    Some(lines[start..].join("\n"))
}

/// Build a failure report with unified diffs for each failing matchup.
fn build_failure_report(v: &serde_json::Value) -> String {
    let mut report = String::new();
    let results = match v["results"].as_array() {
        Some(r) => r,
        None => return report,
    };

    report.push_str("\n=== Failed/Error details ===\n");

    for r in results {
        let status = r["status"].as_str().unwrap_or("?");
        if status == "pass" {
            continue;
        }

        let d1 = r["deck1"].as_str().unwrap_or("?");
        let d2 = r["deck2"].as_str().unwrap_or("?");
        let seed = r["seed"].as_u64().unwrap_or(0);
        report.push_str(&format!("\n--- {status}: {d1} vs {d2} seed={seed}\n"));

        if let Some(err) = r["error"].as_str() {
            report.push_str(&format!("    error: {err}\n"));
        }

        if let Some(field) = r["divergence_field"].as_str() {
            let loc = r["divergence_location"].as_str().unwrap_or("?");
            let rv = r["rust_value"].as_str().unwrap_or("?");
            let jv = r["java_value"].as_str().unwrap_or("?");
            report.push_str(&format!("    at {loc}, field: {field}\n"));
            report.push_str(&format!("      rust: {rv}\n"));
            report.push_str(&format!("      java: {jv}\n"));
        }

        // Generate unified diff from traces
        let rust_trace = r["rust_trace"].as_str();
        let java_trace = r["java_trace"].as_str();
        if let (Some(rt), Some(jt)) = (rust_trace, java_trace) {
            report.push_str(&unified_diff(rt, jt, d1, d2, seed));
        }
    }

    report
}

/// Generate a unified diff between Rust and Java traces.
fn unified_diff(rust_trace: &str, java_trace: &str, d1: &str, d2: &str, seed: u64) -> String {
    let rust_lines: Vec<&str> = rust_trace.lines().collect();
    let java_lines: Vec<&str> = java_trace.lines().collect();

    let mut diff = String::new();
    diff.push_str(&format!("--- rust ({d1} vs {d2} seed={seed})\n"));
    diff.push_str(&format!("+++ java ({d1} vs {d2} seed={seed})\n"));

    // Simple line-by-line diff: find first divergence region and show context
    let max_lines = rust_lines.len().max(java_lines.len());
    let mut in_diff = false;
    let mut context_before: Vec<String> = Vec::new();
    #[allow(unused_assignments)]
    let mut diff_start = 0usize;
    let mut diff_lines: Vec<String> = Vec::new();

    for i in 0..max_lines {
        let rl = rust_lines.get(i).copied();
        let jl = java_lines.get(i).copied();

        match (rl, jl) {
            (Some(r), Some(j)) if r == j => {
                if in_diff {
                    // Context after diff — print and stop
                    diff_lines.push(format!(" {r}"));
                    if diff_lines.len() > 50 {
                        break; // enough context
                    }
                } else {
                    // Track last 3 context lines before diff
                    context_before.push(format!(" {r}"));
                    if context_before.len() > 3 {
                        context_before.remove(0);
                    }
                }
            }
            _ => {
                if !in_diff {
                    in_diff = true;
                    diff_start = i.saturating_sub(3);
                    diff.push_str(&format!("@@ -{} +{} @@\n", diff_start + 1, diff_start + 1));
                    for ctx in &context_before {
                        diff.push_str(ctx);
                        diff.push('\n');
                    }
                }
                if let Some(r) = rl {
                    diff_lines.push(format!("-{r}"));
                }
                if let Some(j) = jl {
                    diff_lines.push(format!("+{j}"));
                }
            }
        }
    }

    for line in &diff_lines {
        diff.push_str(line);
        diff.push('\n');
    }

    if diff_lines.is_empty() && !in_diff {
        diff.push_str("(traces identical — divergence may be in snapshot comparison only)\n");
    }

    diff
}

/// Post a comment to a GitHub PR using `gh` CLI.
fn post_pr_comment(
    repo: &str,
    pr: &str,
    report: &str,
    total: u64,
    passed: u64,
    failed: u64,
    errors: u64,
) {
    let body = format!(
        "## Parity Regression: {status}\n\n\
         | Metric | Count |\n|--------|-------|\n\
         | Total | {total} |\n| Passed | {passed} |\n| Failed | {failed} |\n| Errors | {errors} |\n\n\
         <details><summary>Failure details & diffs</summary>\n\n\
         ```diff\n{report}\n```\n\n</details>",
        status = if failed > 0 || errors > 0 { "Failures Detected" } else { "All Passing" },
    );
    gh_comment(repo, pr, &body);
}

/// Post a comment via GitHub API using curl + GITHUB_TOKEN.
fn gh_comment(repo: &str, pr: &str, body: &str) {
    let token = match std::env::var("GITHUB_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => {
            eprintln!("[ci] GITHUB_TOKEN not set, skipping PR comment");
            return;
        }
    };

    eprintln!("[ci] Posting PR comment to {repo}#{pr}...");
    let json = serde_json::json!({ "body": body });
    let url = format!("https://api.github.com/repos/{repo}/issues/{pr}/comments");

    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "-S",
            "-X",
            "POST",
            "-H",
            &format!("Authorization: token {token}"),
            "-H",
            "Accept: application/vnd.github.v3+json",
            "-H",
            "Content-Type: application/json",
            "-d",
            &json.to_string(),
            "-w",
            "\n%{http_code}",
            &url,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let stderr = String::from_utf8_lossy(&o.stderr);
            let http_code = stdout.lines().last().unwrap_or("?");
            if o.status.success() && (http_code == "201" || http_code == "200") {
                eprintln!("[ci] PR comment posted successfully (HTTP {http_code})");
            } else {
                eprintln!("[ci] Failed to post PR comment (HTTP {http_code}): {stderr}");
                let body_part: String = stdout.lines().take(3).collect::<Vec<_>>().join("\n");
                eprintln!("[ci] Response: {}", &body_part[..body_part.len().min(200)]);
            }
        }
        Err(e) => {
            eprintln!("[ci] Failed to run curl: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_chunked, parse_host_port, parse_http_response};

    #[test]
    fn parse_host_port_accepts_url_and_defaults_port() {
        assert_eq!(
            parse_host_port("http://localhost:9000"),
            ("localhost".to_string(), 9000)
        );
        assert_eq!(
            parse_host_port("127.0.0.1"),
            ("127.0.0.1".to_string(), 8080)
        );
    }

    #[test]
    fn parse_http_response_decodes_chunked_body() {
        let raw = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Transfer-Encoding: chunked\r\n",
            "\r\n",
            "5\r\nhello\r\n",
            "6\r\n world\r\n",
            "0\r\n\r\n"
        );

        assert_eq!(
            parse_http_response(raw),
            Ok((200, "hello world".to_string()))
        );
    }

    #[test]
    fn decode_chunked_tolerates_incomplete_final_chunk() {
        assert_eq!(decode_chunked("5\r\nhello\r\n6\r\n wor"), "hello wor");
    }
}
