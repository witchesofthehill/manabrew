//! Multi-round agentic tool-calling loop for parity failure analysis.
//!
//! Ported from nxt-ai agent patterns. The agent can explore code, look up MTG rules,
//! query Scryfall, and re-run parity tests before diagnosing failures.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::infra::llm::{ClusterContext, LlmAnalysis, LlmClient};
use crate::tools::{code_tools, mtg_tools, parity_tools};

/// Maximum tool-calling rounds before forcing a final answer.
const MAX_ROUNDS: usize = 8;

/// Overall timeout for the agent loop.
const AGENT_TIMEOUT: Duration = Duration::from_secs(300);

/// Maximum bytes per tool result.
const MAX_TOOL_RESULT_BYTES: usize = 4096;

/// Conservative chars-per-token estimate for JSON content.
const CHARS_PER_TOKEN: f64 = 3.2;

/// Result of a completed agent analysis run.
pub struct AgentResult {
    pub analysis: LlmAnalysis,
    pub duration: Duration,
    pub rounds_used: usize,
    pub tools_called: usize,
}

/// Configuration for agent tool execution.
pub struct AgentConfig {
    pub project_root: PathBuf,
    pub java_jar: Option<String>,
    pub cards_dir: Option<String>,
}

/// Run the agentic analysis loop for a failure cluster.
///
/// The agent gets a system prompt + cluster context, then iteratively calls tools
/// to explore the codebase and MTG rules before producing a structured analysis.
/// Falls back to single-shot on any error.
pub async fn run_agent_analysis(
    llm: &LlmClient,
    ctx: &ClusterContext,
    config: &AgentConfig,
    ctx_size: usize,
) -> Result<AgentResult, String> {
    let start = Instant::now();

    let system_prompt = build_agent_system_prompt();
    let user_message = build_agent_user_message(ctx);
    let tools = tool_definitions();

    let mut messages: Vec<Value> = vec![
        json!({"role": "system", "content": system_prompt}),
        json!({"role": "user", "content": user_message}),
    ];

    let parity_config = parity_tools::ParityToolConfig {
        java_jar: config.java_jar.clone(),
        cards_dir: config.cards_dir.clone(),
        project_root: config.project_root.to_string_lossy().to_string(),
    };

    let mut seen_calls: HashSet<String> = HashSet::new();
    let mut rounds_used = 0;
    let mut tools_called = 0;

    for _round in 0..MAX_ROUNDS {
        // Check timeout
        if start.elapsed() > AGENT_TIMEOUT {
            tracing::warn!(elapsed_s = start.elapsed().as_secs(), "Agent timeout");
            break;
        }

        rounds_used += 1;

        // Trim messages to fit context budget
        trim_messages(&mut messages, ctx_size);

        // Call LLM with tools
        let response = llm.chat_completions(&messages, &tools).await?;

        // Extract tool calls (structured or XML fallback)
        let mut msg = response.clone();
        let tool_calls = extract_tool_calls(&mut msg);

        if tool_calls.is_empty() {
            // No tool calls — try to parse the final answer
            if let Some(text) = msg["content"].as_str() {
                let json_str = extract_json(text);
                if let Ok(analysis) = serde_json::from_str::<LlmAnalysis>(json_str) {
                    return Ok(AgentResult {
                        analysis,
                        duration: start.elapsed(),
                        rounds_used,
                        tools_called,
                    });
                }
            }
            // Append the message and continue (model may just be thinking)
            messages.push(msg);
            break;
        }

        // Append assistant message with tool_calls
        messages.push(msg);

        // Check for duplicates, execute tools
        let mut all_duplicate = true;
        let mut pending: Vec<(String, Value, String)> = Vec::new(); // (name, args, call_id)

        for tc in &tool_calls {
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let args: Value = tc["function"]["arguments"]
                .as_str()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(json!({}));
            let call_id = tc["id"].as_str().unwrap_or("").to_string();

            let call_key = format!("{}:{}", name, args);
            if !seen_calls.insert(call_key) {
                // Duplicate
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": format!("Already called {name} with these arguments. Use different parameters or answer with what you have."),
                }));
                tools_called += 1;
            } else {
                all_duplicate = false;
                pending.push((name, args, call_id));
            }
        }

        if all_duplicate {
            tracing::debug!("Agent: all tool calls duplicate, breaking loop");
            break;
        }

        // Execute non-duplicate tools concurrently
        let futures: Vec<_> = pending
            .iter()
            .map(|(name, args, _)| {
                execute_tool(
                    name,
                    args,
                    &config.project_root,
                    &parity_config,
                    llm.http_client(),
                )
            })
            .collect();

        let results = futures::future::join_all(futures).await;

        for ((name, _, call_id), result) in pending.iter().zip(results) {
            tools_called += 1;
            let truncated = truncate_result(&result, MAX_TOOL_RESULT_BYTES);
            tracing::debug!(
                tool = %name,
                bytes = result.len(),
                truncated = result.len() > MAX_TOOL_RESULT_BYTES,
                "Agent tool call"
            );
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": truncated,
            }));
        }
    }

    // Max rounds reached or loop broken — nudge for final answer
    if rounds_used >= MAX_ROUNDS || start.elapsed() > AGENT_TIMEOUT {
        tracing::debug!(rounds = rounds_used, "Agent: nudging for final answer");
    }

    messages.push(json!({
        "role": "user",
        "content": "Please provide your final analysis now as JSON. Do not call any more tools.\n\nRespond with JSON only: {\"mechanic\": \"...\", \"root_cause\": \"...\", \"files_to_check\": [...], \"repro_command\": \"...\", \"severity\": \"high|medium|low\"}"
    }));

    trim_messages(&mut messages, ctx_size);
    let final_response = llm.chat_completions_no_tools(&messages).await?;

    if let Some(text) = final_response["content"].as_str() {
        let json_str = extract_json(text);
        if let Ok(analysis) = serde_json::from_str::<LlmAnalysis>(json_str) {
            return Ok(AgentResult {
                analysis,
                duration: start.elapsed(),
                rounds_used,
                tools_called,
            });
        }
        return Err(format!("Failed to parse final agent response: {text}"));
    }

    Err("Agent produced no parseable response".to_string())
}

/// Execute a single tool by name and return the result string.
async fn execute_tool(
    name: &str,
    args: &Value,
    project_root: &PathBuf,
    parity_config: &parity_tools::ParityToolConfig,
    http_client: &reqwest::Client,
) -> String {
    match name {
        "grep_code" => {
            let pattern = args["pattern"].as_str().unwrap_or("");
            code_tools::grep_code(project_root, pattern)
        }
        "read_file" => {
            let path = args["path"].as_str().unwrap_or("");
            let start = args["start_line"].as_u64().map(|n| n as usize);
            let end = args["end_line"].as_u64().map(|n| n as usize);
            code_tools::read_file(project_root, path, start, end)
        }
        "list_files" => {
            let pattern = args["pattern"].as_str().unwrap_or("");
            code_tools::list_files(project_root, pattern)
        }
        "scryfall_card" => {
            let card_name = args["card_name"].as_str().unwrap_or("");
            mtg_tools::scryfall_card(http_client, card_name).await
        }
        "mtg_rules" => {
            let query = args["query"].as_str().unwrap_or("");
            mtg_tools::mtg_rules(query)
        }
        "run_parity_test" => {
            let deck1 = args["deck1"].as_str().unwrap_or("");
            let deck2 = args["deck2"].as_str().unwrap_or("");
            let seed = args["seed"].as_u64().unwrap_or(42);
            parity_tools::run_parity_test(parity_config, deck1, deck2, seed).await
        }
        _ => format!("Unknown tool: {name}"),
    }
}

/// Extract tool calls from an LLM response, with XML fallback for Qwen models.
fn extract_tool_calls(msg: &mut Value) -> Vec<Value> {
    // Check for structured tool_calls first
    if let Some(tcs) = msg.get("tool_calls").and_then(|tc| tc.as_array()) {
        if !tcs.is_empty() {
            return tcs.clone();
        }
    }

    // XML fallback for Qwen models
    if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
        let parsed = parse_xml_tool_calls(content);
        if !parsed.is_empty() {
            // Strip <tool_call> blocks from content
            let clean = content.split("<tool_call>").next().unwrap_or("").trim();
            if clean.is_empty() {
                msg["content"] = Value::Null;
            } else {
                msg["content"] = Value::String(clean.to_string());
            }
            msg["tool_calls"] = Value::Array(parsed.clone());
            tracing::debug!(calls = parsed.len(), "Agent: XML tool call fallback");
            return parsed;
        }
    }

    Vec::new()
}

/// Parse XML-style tool calls from content text (Qwen3 compatibility).
///
/// Format: `<tool_call><function=name><parameter=key>value</parameter></function></tool_call>`
fn parse_xml_tool_calls(content: &str) -> Vec<Value> {
    let mut calls = Vec::new();
    let mut search_from = 0;

    while let Some(tc_start) = content[search_from..].find("<tool_call>") {
        let tc_start = search_from + tc_start;
        let Some(tc_end_offset) = content[tc_start..].find("</tool_call>") else {
            break;
        };
        let tc_end = tc_start + tc_end_offset + "</tool_call>".len();
        let block = &content[tc_start..tc_end];
        search_from = tc_end;

        // Extract function name: <function=NAME>
        let Some(fn_start) = block.find("<function=") else {
            continue;
        };
        let fn_name_start = fn_start + "<function=".len();
        let Some(fn_name_end) = block[fn_name_start..].find('>') else {
            continue;
        };
        let fn_name = &block[fn_name_start..fn_name_start + fn_name_end];

        // Extract parameters: <parameter=KEY>VALUE</parameter>
        let mut args = serde_json::Map::new();
        let mut param_search = 0;
        while let Some(p_start) = block[param_search..].find("<parameter=") {
            let p_start = param_search + p_start;
            let key_start = p_start + "<parameter=".len();
            let Some(key_end) = block[key_start..].find('>') else {
                break;
            };
            let key = &block[key_start..key_start + key_end];
            let val_start = key_start + key_end + 1;
            let Some(val_end) = block[val_start..].find("</parameter>") else {
                break;
            };
            let val = block[val_start..val_start + val_end].trim();
            args.insert(key.to_string(), Value::String(val.to_string()));
            param_search = val_start + val_end + "</parameter>".len();
        }

        let id = format!("xml_tc_{}", calls.len());
        calls.push(json!({
            "index": calls.len(),
            "id": id,
            "type": "function",
            "function": {
                "name": fn_name,
                "arguments": serde_json::to_string(&args).unwrap_or_default(),
            }
        }));
    }
    calls
}

/// Estimate token count from a JSON value.
fn estimate_tokens(value: &Value) -> usize {
    serde_json::to_string(value)
        .map(|s| (s.len() as f64 / CHARS_PER_TOKEN) as usize)
        .unwrap_or(0)
}

/// Trim messages to fit within 75% of context window.
///
/// Strategy:
/// 1. Truncate tool results to 1KB each
/// 2. Drop oldest tool round pairs (assistant + tool messages)
/// Never drops system prompt or original user message.
fn trim_messages(messages: &mut Vec<Value>, ctx_size: usize) {
    let budget = (ctx_size as f64 * 0.75) as usize;

    // 1. Truncate long tool results
    if estimate_tokens(&json!(messages)) > budget {
        for msg in messages.iter_mut() {
            if msg.get("role").and_then(|r| r.as_str()) == Some("tool") {
                if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                    if content.len() > 1000 {
                        let truncated = &content[..content[..1000].rfind('\n').unwrap_or(1000)];
                        msg["content"] =
                            Value::String(format!("{truncated}\n\n[Truncated for context budget]"));
                    }
                }
            }
        }
    }

    // 2. Drop oldest tool round pairs (keep system + first user + last messages)
    while estimate_tokens(&json!(messages)) > budget && messages.len() > 3 {
        let drop_idx = messages.iter().position(|m| {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            role == "tool"
                || (role == "assistant"
                    && m.get("tool_calls").and_then(|tc| tc.as_array()).is_some())
        });
        match drop_idx {
            Some(idx) if idx >= 2 => {
                messages.remove(idx);
            }
            _ => break,
        }
    }
}

/// Truncate a tool result to max bytes, preserving line boundaries.
fn truncate_result(result: &str, max_bytes: usize) -> String {
    if result.len() <= max_bytes {
        return result.to_string();
    }
    let truncated = &result[..result[..max_bytes].rfind('\n').unwrap_or(max_bytes)];
    format!("{truncated}\n[truncated at {max_bytes} bytes]")
}

/// Extract JSON from a string that may contain markdown fences or surrounding text.
fn extract_json(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            return &trimmed[start..=end];
        }
    }
    trimmed
}

/// Build the system prompt for the agent.
fn build_agent_system_prompt() -> String {
    r#"You are an expert game engine parity analyst with access to tools. The Rust Forge engine is being compared against the Java Forge reference implementation for Magic: The Gathering.

You have 6 tools available:
- grep_code: Search Rust source files by regex within manabrew-engine/
- read_file: Read a file (or line range) from the project
- list_files: List files matching a glob pattern
- scryfall_card: Look up an MTG card on Scryfall (oracle text, rulings)
- mtg_rules: Search the MTG Comprehensive Rules by rule number or keyword
- run_parity_test: Run a single parity test with specified decks and seed

Your workflow:
1. Analyze the failure cluster to understand what game mechanic is involved
2. Use scryfall_card to look up the oracle text of involved cards
3. Use mtg_rules to check the relevant rules for the mechanic
4. Use grep_code and read_file to find the actual Rust implementation
5. Identify the likely root cause by comparing rules vs implementation
6. Optionally run_parity_test to verify

IMPORTANT:
- Always verify file paths exist before including them in your analysis
- Use grep_code to discover actual file locations, don't guess
- Be specific about the root cause — reference actual code lines when possible
- Your final answer MUST be valid JSON

Respond with your final analysis as JSON (no markdown fences):
{"mechanic": "...", "root_cause": "...", "files_to_check": [...], "repro_command": "...", "severity": "high|medium|low"}"#
        .to_string()
}

/// Build the user message from cluster context.
fn build_agent_user_message(ctx: &ClusterContext) -> String {
    format!(
        r#"Analyze this parity failure cluster:

Failure count: {count}
Divergence field: {field}
Rust value: {rust}
Java value: {java}
Affected deck pairs: {decks}
Cards involved: {cards}
Sample seeds: {seeds}

Use your tools to investigate the root cause. Check the actual source files and MTG rules before diagnosing."#,
        count = ctx.count,
        field = ctx.divergence_field,
        rust = ctx.rust_value,
        java = ctx.java_value,
        decks = ctx.deck_pairs,
        cards = ctx.covered_cards,
        seeds = ctx.sample_seeds,
    )
}

/// OpenAI function-calling tool schemas for the 6 agent tools.
fn tool_definitions() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "grep_code",
                "description": "Search Rust source files by regex pattern within manabrew-engine/. Returns up to 30 matching lines in file:line:content format.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Regex pattern to search for (e.g. 'fn resolve_damage', 'impl Combat')"
                        }
                    },
                    "required": ["pattern"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a file from the project, optionally specifying a line range. Returns up to 4KB with line numbers.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "File path relative to project root (e.g. 'manabrew-rs/crates/manabrew-engine/src/combat/mod.rs')"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "First line to read (1-indexed, optional)"
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Last line to read (inclusive, optional)"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files matching a glob pattern relative to the project root. Returns up to 50 file paths.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Glob pattern (e.g. 'manabrew-rs/crates/manabrew-engine/src/**/*.rs', 'manabrew-engine/**/combat*')"
                        }
                    },
                    "required": ["pattern"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "scryfall_card",
                "description": "Look up an MTG card on Scryfall. Returns oracle text, type line, mana cost, keywords, and up to 5 rulings.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "card_name": {
                            "type": "string",
                            "description": "Exact card name (e.g. 'Lightning Bolt', 'Tarmogoyf')"
                        }
                    },
                    "required": ["card_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "mtg_rules",
                "description": "Search the MTG Comprehensive Rules. Pass a rule number (e.g. '702.2') for direct lookup, or a keyword (e.g. 'first strike') for text search.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Rule number (e.g. '702.2') or keyword (e.g. 'trample', 'combat damage')"
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_parity_test",
                "description": "Run a single parity test with the specified decks and seed. Returns pass/fail with divergence details. Has a 60s timeout.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "deck1": {
                            "type": "string",
                            "description": "Name of the first deck"
                        },
                        "deck2": {
                            "type": "string",
                            "description": "Name of the second deck"
                        },
                        "seed": {
                            "type": "integer",
                            "description": "RNG seed for reproducibility"
                        }
                    },
                    "required": ["deck1", "deck2", "seed"]
                }
            }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_xml_tool_calls_single() {
        let content = r#"Let me search for this.
<tool_call>
<function=grep_code>
<parameter=pattern>fn resolve_damage</parameter>
</function>
</tool_call>"#;
        let calls = parse_xml_tool_calls(content);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["function"]["name"], "grep_code");
        let args: Value =
            serde_json::from_str(calls[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["pattern"], "fn resolve_damage");
    }

    #[test]
    fn parse_xml_tool_calls_multiple() {
        let content = r#"<tool_call>
<function=grep_code>
<parameter=pattern>combat</parameter>
</function>
</tool_call>
<tool_call>
<function=scryfall_card>
<parameter=card_name>Lightning Bolt</parameter>
</function>
</tool_call>"#;
        let calls = parse_xml_tool_calls(content);
        assert_eq!(calls.len(), 2);
    }

    #[test]
    fn parse_xml_tool_calls_empty() {
        let calls = parse_xml_tool_calls("Just a normal response without tools.");
        assert!(calls.is_empty());
    }

    #[test]
    fn truncate_result_short() {
        let result = "short";
        assert_eq!(truncate_result(result, 100), "short");
    }

    #[test]
    fn truncate_result_long() {
        let result = "line1\nline2\nline3\nline4\n";
        let truncated = truncate_result(result, 12);
        assert!(truncated.contains("[truncated"));
    }

    #[test]
    fn extract_json_from_text() {
        let input = "Here is the analysis: {\"mechanic\": \"combat\"} done.";
        assert_eq!(extract_json(input), r#"{"mechanic": "combat"}"#);
    }

    #[test]
    fn tool_definitions_valid() {
        let tools = tool_definitions();
        let arr = tools.as_array().unwrap();
        assert_eq!(arr.len(), 6);
        for tool in arr {
            assert!(tool["function"]["name"].is_string());
        }
    }

    /// Integration test: runs the full agent loop against a live LLM.
    /// Requires OPENAI_API_KEY + OPENAI_API_BASE to be set.
    /// Run with: cargo test -p parity --features analyze -- agent_loop::tests::live_agent --nocapture --ignored
    #[tokio::test]
    #[ignore]
    async fn live_agent_loop() {
        let llm = crate::infra::llm::LlmClient::from_env()
            .expect("Set OPENAI_API_KEY + OPENAI_API_BASE for this test");

        eprintln!(
            "Backend: supports_tool_calling={}, ctx_size={}",
            llm.supports_tool_calling(),
            llm.context_size()
        );

        let ctx = crate::infra::llm::ClusterContext {
            count: 3,
            divergence_field: "players[0].life".to_string(),
            rust_value: "18".to_string(),
            java_value: "20".to_string(),
            deck_pairs: "red_burn vs green_stompy".to_string(),
            covered_cards: "Lightning Bolt, Shock, Searing Spear".to_string(),
            sample_seeds: "42, 100".to_string(),
        };

        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap();

        let config = AgentConfig {
            project_root: project_root.to_path_buf(),
            java_jar: None,
            cards_dir: None,
        };

        eprintln!(
            "\n--- Starting agent analysis (project_root: {}) ---\n",
            project_root.display()
        );

        match run_agent_analysis(&llm, &ctx, &config, llm.context_size()).await {
            Ok(result) => {
                eprintln!("\n=== AGENT RESULT ===");
                eprintln!("Duration: {}s", result.duration.as_secs());
                eprintln!("Rounds: {}", result.rounds_used);
                eprintln!("Tools called: {}", result.tools_called);
                eprintln!("Mechanic: {}", result.analysis.mechanic);
                eprintln!("Root cause: {}", result.analysis.root_cause);
                eprintln!("Files: {:?}", result.analysis.files_to_check);
                eprintln!("Severity: {}", result.analysis.severity);

                // Verify the agent actually used tools
                assert!(
                    result.tools_called > 0,
                    "Agent should have called at least one tool"
                );
                // Verify files_to_check contain real paths
                assert!(
                    !result.analysis.files_to_check.is_empty(),
                    "Should suggest files to check"
                );
                assert!(
                    !result.analysis.mechanic.is_empty(),
                    "Should identify a mechanic"
                );
            }
            Err(e) => {
                eprintln!("\n=== AGENT FAILED ===");
                eprintln!("Error: {e}");
                panic!("Agent failed: {e}");
            }
        }
    }
}
