#!/usr/bin/env python3
"""
Parity Repair Agent v0.3 — autonomous divergence fixer for the Forge engine port.

Pulls failure clusters from the parity dashboard, decomposes them by covered cards,
invokes Claude Code to fix divergences with retry-on-failure, validates with parity
tests + regression sweep, and opens PRs.

Usage:
    python3 scripts/parity-repair-agent.py                  # interactive: pick a cluster
    python3 scripts/parity-repair-agent.py --auto           # autonomous loop
    python3 scripts/parity-repair-agent.py --auto --parallel 3  # fix 3 clusters concurrently
    python3 scripts/parity-repair-agent.py --field "players[*].life"
    python3 scripts/parity-repair-agent.py --dry-run        # analyze only, no code changes
"""

import argparse
import json
import os
import subprocess
import sys
import time
import textwrap
import re
import threading
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────

PARITY_API = "https://manabrewparity.federicovivaldo.com"
PARITY_AUTH = "manabrew-parity-api:trOlTk8DGl80YTUogWsgU43EA1ySI7QtblGbUVMEZSbdv9pgHmd9MjcLaxYa"
REPO_ROOT = Path(__file__).resolve().parent.parent
JAVA_HOME = "/Library/Java/JavaVirtualMachines/zulu-18.jdk/Contents/Home"
JAVA_JAR = REPO_ROOT / "forge-harness" / "target" / "forge-harness-jar-with-dependencies.jar"
CARDS_DIR = REPO_ROOT / "forge" / "forge-gui" / "res" / "cardsfolder"
MAX_ATTEMPTS = 3  # retries per cluster with error feedback
COOLDOWN_BETWEEN_CLUSTERS = 30  # seconds between cluster attempts in auto mode
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", os.path.expanduser("~/.local/bin/claude"))
CLAUDE_MODEL = "sonnet"
MAX_BUDGET_USD = 15.0  # per attempt (not per cluster)
RECENCY_HOURS = 24
LOG_DIR = REPO_ROOT / "logs" / "parity-repair"
HISTORY_FILE = REPO_ROOT / "logs" / "parity-repair" / "attempt-history.json"
REGRESSION_SEEDS = [42, 100, 999]
REGRESSION_DECKS = ["red_burn", "green_stompy", "white_aggro", "black_control"]


def _apply_config(model: str, budget: float, recency: int):
    global CLAUDE_MODEL, MAX_BUDGET_USD, RECENCY_HOURS
    CLAUDE_MODEL = model
    MAX_BUDGET_USD = budget
    RECENCY_HOURS = recency


# ── API helpers ─────────────────────────────────────────────────────────────

def api_get(endpoint: str, params: dict | None = None) -> dict | list:
    """GET from parity dashboard API with basic auth via curl."""
    url = f"{PARITY_API}{endpoint}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url += f"?{qs}"
    result = subprocess.run(
        ["curl", "-s", "-u", PARITY_AUTH, url],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise RuntimeError(f"API request failed: {result.stderr}")
    return json.loads(result.stdout)


def get_clusters(recency_hours: int = RECENCY_HOURS) -> list[dict]:
    """Fetch failure clusters sorted by total_failures descending, filtered to recent."""
    clusters = api_get("/api/clusters")
    if recency_hours > 0:
        cutoff = datetime.now(timezone.utc).timestamp() - (recency_hours * 3600)
        filtered = []
        for c in clusters:
            last_seen = c.get("last_seen", "")
            if last_seen:
                try:
                    ts = datetime.fromisoformat(last_seen.replace("Z", "+00:00")).timestamp()
                    if ts >= cutoff:
                        filtered.append(c)
                except (ValueError, TypeError):
                    pass
        clusters = filtered
    return sorted(clusters, key=lambda c: c.get("total_failures", 0), reverse=True)


def get_failure_details(field: str, limit: int = 10) -> list[dict]:
    """Fetch recent failures matching a divergence field."""
    try:
        results = api_get("/api/failures", {"limit": str(limit), "field": field})
        if results:
            return results
    except Exception:
        pass
    # Fallback: client-side filter
    all_failures = api_get("/api/failures", {"limit": "500"})
    normalized = normalize_field(field)
    matching = [
        f for f in all_failures
        if normalize_field(f.get("first_divergence_field", "")) == normalized
    ]
    return matching[:limit]


def normalize_field(field: str | None) -> str:
    if not field:
        return ""
    return re.sub(r'\[\d+\]', '[*]', field)


def get_stats() -> dict:
    return api_get("/api/stats")


# ── Cluster decomposition ──────────────────────────────────────────────────

def decompose_cluster(failures: list[dict]) -> list[dict]:
    """Group failures by covered cards to identify distinct sub-bugs.

    Returns a list of sub-clusters, each with a representative failure,
    a card signature, and count.
    """
    card_groups: dict[str, list[dict]] = {}
    for f in failures:
        cards = sorted(f.get("covered_cards", []))
        # Create a signature from the most distinctive cards (skip basic lands)
        basics = {"Plains", "Island", "Swamp", "Mountain", "Forest"}
        sig_cards = [c for c in cards if c not in basics][:5]
        sig = "|".join(sig_cards) if sig_cards else "basics-only"
        card_groups.setdefault(sig, []).append(f)

    sub_clusters = []
    for sig, group in sorted(card_groups.items(), key=lambda x: -len(x[1])):
        sub_clusters.append({
            "card_signature": sig,
            "count": len(group),
            "representative": group[0],
            "all_failures": group,
            "unique_cards": sig.split("|"),
        })
    return sub_clusters


# ── Attempt history ────────────────────────────────────────────────────────

def load_history() -> dict:
    """Load attempt history from disk."""
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_history(history: dict):
    """Save attempt history to disk."""
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, indent=2))


def record_attempt(field: str, attempt: int, result: str, details: str = ""):
    """Record an attempt in history."""
    history = load_history()
    key = normalize_field(field)
    if key not in history:
        history[key] = {"attempts": [], "status": "pending"}
    history[key]["attempts"].append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "attempt": attempt,
        "result": result,  # "success", "compile_fail", "test_fail", "claude_fail"
        "details": details[:500],
        "model": CLAUDE_MODEL,
    })
    if result == "success":
        history[key]["status"] = "fixed"
    elif len(history[key]["attempts"]) >= MAX_ATTEMPTS:
        history[key]["status"] = "exhausted"
    save_history(history)


def should_skip_cluster(field: str) -> bool:
    """Check if this cluster has been exhausted or already fixed."""
    history = load_history()
    key = normalize_field(field)
    entry = history.get(key, {})
    return entry.get("status") in ("fixed", "exhausted")


def get_previous_errors(field: str) -> list[str]:
    """Get error messages from previous failed attempts."""
    history = load_history()
    key = normalize_field(field)
    entry = history.get(key, {})
    return [
        a["details"] for a in entry.get("attempts", [])
        if a["result"] != "success" and a.get("details")
    ]


# ── Git helpers ─────────────────────────────────────────────────────────────

def git(*args, cwd=None, check=True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=cwd or REPO_ROOT, capture_output=True, text=True, check=check
    )


def current_branch(cwd=None) -> str:
    return git("branch", "--show-current", cwd=cwd).stdout.strip()


def is_clean(cwd=None) -> bool:
    return git("status", "--porcelain", cwd=cwd).stdout.strip() == ""


def branch_exists(name: str) -> bool:
    return bool(git("branch", "--list", name, check=False).stdout.strip())


def abandon_branch(branch_name: str, return_to: str):
    """Discard all changes and delete a failed attempt branch."""
    git("checkout", ".", check=False)  # discard modified files
    git("clean", "-fd", "--", "manabrew-engine/", check=False)  # remove untracked engine files
    git("checkout", return_to, check=False)
    git("branch", "-D", branch_name, check=False)


def make_branch_name(field: str, attempt: int = 1) -> str:
    safe = re.sub(r'[^a-zA-Z0-9]', '-', field)
    safe = re.sub(r'-+', '-', safe).strip('-').lower()
    timestamp = datetime.now().strftime("%m%d-%H%M")
    suffix = f"-v{attempt}" if attempt > 1 else ""
    return f"parity-fix/{safe}-{timestamp}{suffix}"


# ── Parity test runner ─────────────────────────────────────────────────────

def extract_divergence_field(stdout: str) -> str | None:
    """Extract the first divergence field from parity test output.

    The text report format is:
      1. [T1 Upkeep] players[0].life
         Rust: 20
         Java: 19
    """
    # Match the numbered divergence line: "  1. [T1 Phase] field.path"
    m = re.search(r'\d+\.\s*\[T\d+\s+\w+\]\s+(\S+)', stdout)
    if m:
        return m.group(1)
    # JSON fallback: "first_divergence_field": "..."
    m = re.search(r'"first_divergence_field"\s*:\s*"([^"]+)"', stdout)
    if m:
        return m.group(1)
    return None


def run_parity_test(deck1: str, deck2: str, seed: int, cwd=None, timeout: int = 120) -> dict:
    """Run a single parity test and return the result."""
    cmd = [
        "cargo", "run", "-p", "parity", "--bin", "parity", "--",
        "--deck1", deck1, "--deck2", deck2,
        "--seed", str(seed),
        "--java-jar", str(JAVA_JAR),
        "--cards-dir", str(CARDS_DIR),
    ]
    env = {**os.environ, "JAVA_HOME": JAVA_HOME}
    try:
        result = subprocess.run(
            cmd, cwd=cwd or REPO_ROOT, capture_output=True, text=True,
            timeout=timeout, env=env
        )
        # Check exit code: 0 = all passed, non-zero = at least one failure
        passed = result.returncode == 0
        divergence_field = None if passed else extract_divergence_field(result.stdout)
        return {
            "passed": passed,
            "stdout": result.stdout[-2000:],
            "stderr": result.stderr[-1000:],
            "returncode": result.returncode,
            "divergence_field": divergence_field,
        }
    except subprocess.TimeoutExpired:
        return {"passed": False, "stdout": "", "stderr": "TIMEOUT", "returncode": -1,
                "divergence_field": None}


def cargo_check(cwd=None) -> dict:
    """Run cargo check onmanabrew-engine  and parity."""
    result = subprocess.run(
        ["cargo", "check", "-p", "manabrew-engine"],
        cwd=cwd or REPO_ROOT, capture_output=True, text=True, timeout=300
    )
    if result.returncode != 0:
        return {"ok": False, "stderr": result.stderr[-3000:]}
    # Also check parity crate (agent may have modified deterministic_agent.rs)
    result2 = subprocess.run(
        ["cargo", "check", "-p", "parity"],
        cwd=cwd or REPO_ROOT, capture_output=True, text=True, timeout=300
    )
    if result2.returncode != 0:
        return {"ok": False, "stderr": result2.stderr[-3000:]}
    return {"ok": True, "stderr": ""}


def check_antipatterns(diff_text: str) -> list[str]:
    """Scan a unified diff for known bad patterns. Returns list of issues found."""
    import re
    issues = []

    # Only look at added lines (lines starting with +, not +++ header)
    added_lines = [
        line[1:]  # strip the leading +
        for line in diff_text.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    ]
    added_block = "\n".join(added_lines)

    # 1. Functions that unconditionally return None / empty to suppress behavior
    # e.g., "return None" as the only meaningful line in a new function
    # Check for new functions where ALL return paths are None
    none_return_pattern = re.findall(
        r'fn\s+(\w+).*?\{.*?return\s+None;?\s*\}',
        added_block, re.DOTALL
    )
    for fn_name in none_return_pattern:
        # Only flag if the function has no other return path
        if f"Some(" not in added_block.split(fn_name, 1)[-1].split("\n    fn ", 1)[0]:
            issues.append(
                f"Function `{fn_name}` unconditionally returns None — "
                "this suppresses behavior instead of fixing the bug"
            )

    # 2. Debug eprintln! in non-test code
    for line in added_lines:
        stripped = line.strip()
        if "eprintln!" in stripped and "if self.verbose" not in stripped:
            # Check it's not inside a test module or gated by verbose
            if "#[cfg(test)]" not in added_block[:added_block.index(stripped)] if stripped in added_block else True:
                issues.append(
                    f"Debug eprintln! found in non-test code: `{stripped[:80]}` — "
                    "use verbose logging or remove"
                )
                break  # one warning is enough

    # 3. Comment-only changes (no actual code modified)
    non_comment_additions = [
        l for l in added_lines
        if l.strip()
        and not l.strip().startswith("//")
        and not l.strip().startswith("/*")
        and not l.strip().startswith("*")
        and not l.strip().startswith("///")
    ]
    if not non_comment_additions and added_lines:
        issues.append(
            "Only comments were added — no actual code changes. "
            "A comment explaining why NOT to do something is not a fix."
        )

    # 4. Unconditional None return consuming RNG (the exact PR 262 pattern)
    if "let _consumed" in added_block and "return None" in added_block:
        issues.append(
            "Pattern detected: consuming RNG then returning None — "
            "this matches a Java bug instead of fixing it"
        )

    return issues


def run_regression_sweep(cwd=None) -> dict:
    """Run a small regression matrix to check for breakage.

    Tests REGRESSION_DECKS x REGRESSION_SEEDS (default: 4 decks x 3 seeds = ~18 matchups).
    Returns pass/fail counts.
    """
    passed = 0
    failed = 0
    errors = []
    deck_pairs_tested = set()

    for i, d1 in enumerate(REGRESSION_DECKS):
        for d2 in REGRESSION_DECKS[i:]:  # include self-matchups
            for seed in REGRESSION_SEEDS:
                pair_key = f"{d1}_vs_{d2}_s{seed}"
                if pair_key in deck_pairs_tested:
                    continue
                deck_pairs_tested.add(pair_key)

                result = run_parity_test(d1, d2, seed, cwd=cwd, timeout=60)
                if result["passed"]:
                    passed += 1
                else:
                    failed += 1
                    errors.append(f"{d1} vs {d2} seed {seed}")

    return {
        "passed": passed,
        "failed": failed,
        "total": passed + failed,
        "pass_rate": passed / max(passed + failed, 1),
        "errors": errors[:10],
    }


# ── Claude Code invocation ─────────────────────────────────────────────────

def build_repair_prompt(
    cluster: dict,
    failures: list[dict],
    sub_clusters: list[dict] | None = None,
    previous_errors: list[str] | None = None,
    attempt: int = 1,
) -> str:
    """Build the prompt that Claude Code will receive to fix a divergence."""

    field = cluster["field"]
    total = cluster["total_failures"]

    # Parse LLM analysis if available
    llm = {}
    if cluster.get("llm_analysis"):
        try:
            llm = json.loads(cluster["llm_analysis"])
        except (json.JSONDecodeError, TypeError):
            pass

    # Collect sample failures
    samples = []
    for f in failures[:3]:
        samples.append({
            "deck1": f.get("deck1"),
            "deck2": f.get("deck2"),
            "seed": f.get("seed"),
            "rust_value": f.get("first_divergence_rust"),
            "java_value": f.get("first_divergence_java"),
            "covered_cards": f.get("covered_cards", []),
        })

    # Get one failure with full traces
    trace_failure = None
    for f in failures:
        if f.get("rust_trace") and f.get("java_trace"):
            trace_failure = f
            break

    prompt = textwrap.dedent(f"""\
    # Parity Repair Task (Attempt {attempt}/{MAX_ATTEMPTS})

    You are fixing a parity divergence in the Forge MTG engine Rust port. The Rust
    engine produces different results than the Java reference implementation.

    ## Divergence Summary
    - **Field**: `{field}`
    - **Total failures**: {total} across {cluster.get('num_deck_pairs', '?')} deck pairs
    - **GitHub issue**: #{cluster.get('github_issue', 'none')}
    """)

    # Add previous attempt errors for retry context
    if previous_errors and attempt > 1:
        prompt += "\n## Previous Attempt Errors (DO NOT repeat these mistakes)\n"
        for i, err in enumerate(previous_errors, 1):
            prompt += f"\n### Attempt {i} failed:\n```\n{err[:300]}\n```\n"
        prompt += "\nAnalyze why the previous approach failed before trying a new one.\n"

    # Add sub-cluster decomposition
    if sub_clusters and len(sub_clusters) > 1:
        prompt += "\n## Failure Decomposition (grouped by cards involved)\n"
        prompt += "These sub-groups likely represent distinct bugs:\n\n"
        for i, sc in enumerate(sub_clusters[:5], 1):
            prompt += f"  {i}. **{sc['card_signature']}** — {sc['count']} failures\n"
            rep = sc["representative"]
            prompt += f"     Rust: `{rep.get('first_divergence_rust')}` vs Java: `{rep.get('first_divergence_java')}`\n"
            prompt += f"     Decks: {rep.get('deck1')} vs {rep.get('deck2')}, seed {rep.get('seed')}\n"
        prompt += "\nFocus on the most common sub-group first.\n"

    # Sample failures
    prompt += "\n## Sample Failures\n"
    for i, s in enumerate(samples, 1):
        prompt += f"""
### Sample {i}: {s['deck1']} vs {s['deck2']} (seed {s['seed']})
- Rust value: `{s['rust_value']}`
- Java value: `{s['java_value']}`
- Cards involved: {', '.join(s['covered_cards'][:15])}
"""

    if llm:
        prompt += f"""
## Prior LLM Analysis (from a small local model — MAY CONTAIN HALLUCINATIONS)
Treat this as a hint, NOT as ground truth. Verify all file paths and claims independently.
- **Mechanic**: {llm.get('mechanic', 'unknown')}
- **Root cause**: {llm.get('root_cause', 'unknown')}
- **Suggested files**: {', '.join(llm.get('files_to_check', []))} (these paths may not exist!)
- **Severity**: {llm.get('severity', 'unknown')}
"""

    if trace_failure:
        rust_trace = trace_failure.get("rust_trace", "")[:4000]
        java_trace = trace_failure.get("java_trace", "")[:4000]
        prompt += f"""
## Execution Traces ({trace_failure['deck1']} vs {trace_failure['deck2']}, seed {trace_failure['seed']})

<rust_trace>
{rust_trace}
</rust_trace>

<java_trace>
{java_trace}
</java_trace>
"""

    prompt += f"""
## Instructions

1. **Analyze**: Compare the Rust and Java traces to understand WHERE the divergence occurs.
2. **Find the Java reference**: Look in `forge/forge-game/src/main/java/forge/game/` for the
   correct behavior. The Java game engine is the source of truth for game rules.
3. **Find the Rust code**: Look in `manabrew-rs/crates/manabrew-engine/src/` for the corresponding
   Rust implementation.
4. **Diagnose**: Determine whether the bug is in:
   - **Rust engine** (most common) — the Rust port doesn't match Java game logic
   - **Java harness** (`forge-harness/`) — the deterministic test harness has a bug
     that makes Java behave incorrectly (the game engine is correct but the harness
     controller makes wrong decisions or stores data incorrectly)
   - **Rust parity agent** (`manabrew-rs/crates/parity/src/deterministic_agent.rs`)
     — the Rust test agent doesn't match the Java harness behavior (e.g., missing RNG
     calls, wrong selection logic)
5. **Fix**: Fix the code where the bug actually is.
   - If the bug is in the Rust engine, fix the engine code.
   - If the bug is in the Java harness, fix the harness code AND rebuild the JAR:
     `JAVA_HOME={JAVA_HOME} mvn -pl forge-harness -am -DskipTests package`
   - If the bug is in the Rust parity agent, fix the agent code.
6. **Verify compilation**: Run `cargo check -pmanabrew-engine ` to ensure it compiles.
7. **Verify parity**: Run this exact command to test:
   ```
   JAVA_HOME={JAVA_HOME} cargo run -p parity --bin parity -- \\
     --deck1 {samples[0]['deck1']} --deck2 {samples[0]['deck2']} --seed {samples[0]['seed']} \\
     --java-jar {JAVA_JAR} \\
     --cards-dir {CARDS_DIR}
   ```
8. If the test passes, stop. If it fails, analyze the new divergence and iterate.

## Rules
- Keep file/interface parity with Java Forge (same structure, same names)
- Do NOT modify game engine Java files in `forge/forge-game/` — those are the reference
- You CAN modify the Java harness in `forge-harness/` if the harness has a bug
- You CAN modify the Rust parity agent in `manabrew-rs/crates/parity/src/`
- Do NOT modify test files unless the test itself is wrong
- Update `features.md` if you implement or change a feature
- Make the smallest possible fix — don't refactor unrelated code

## CRITICAL: Anti-Patterns to Avoid
These are patterns that technically make parity tests pass but are WRONG. Do not do these:

1. **Never make a function return None/empty unconditionally** to suppress behavior.
   Example of WRONG fix: making `choose_target_spell()` always return `None` so counters
   never resolve. This "matches" a Java harness bug but breaks the game engine.
2. **Never add a workaround comment without actual code changes.** If the only change is
   a comment explaining why NOT to do something, that's not a fix.
3. **Never add debug print/eprintln! statements** in non-test code. Use existing verbose
   logging infrastructure if needed.
4. **Never match a Java bug by breaking Rust.** If Java's harness has a bug that causes
   incorrect behavior, fix the Java harness — don't make Rust equally broken.
5. **Verify your fix is semantically correct**: after making it pass, ask yourself "does
   this fix make the game rule work correctly in BOTH engines, or did I just suppress a
   feature to match a bug?" If the latter, find and fix the actual bug.
"""

    return prompt


def invoke_claude(prompt: str, cwd=None, dry_run: bool = False) -> dict:
    """Invoke Claude Code CLI to fix a divergence, streaming output in real-time."""

    cmd = [
        CLAUDE_BIN,
        "--print",
        "--model", CLAUDE_MODEL,
        "--max-budget-usd", str(MAX_BUDGET_USD),
        "--dangerously-skip-permissions",
        "--verbose",
        "--output-format", "stream-json",
        "-",  # read prompt from stdin
    ]

    if dry_run:
        cmd.insert(-1, "--permission-mode")
        cmd.insert(-1, "plan")

    _log(f"→ Invoking Claude Code ({CLAUDE_MODEL})...")
    _log(f"  Prompt: {len(prompt)} chars")
    _log(f"{'─'*60}")
    start = time.time()

    env = {**os.environ, "JAVA_HOME": JAVA_HOME}
    env.pop("CLAUDECODE", None)

    process = subprocess.Popen(
        cmd, cwd=cwd or REPO_ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env=env,
    )
    process.stdin.write(prompt)
    process.stdin.close()

    result_text = ""

    try:
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "assistant" and "message" in msg:
                content = msg["message"].get("content", "")
                if isinstance(content, str) and content:
                    _log(f"💭 {content}")
                    result_text += content
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict):
                            if block.get("type") == "text":
                                text = block.get("text", "")
                                _log(f"💭 {text}")
                                result_text += text
                            elif block.get("type") == "tool_use":
                                _log_tool_call(block.get("name", "?"), block.get("input", {}))

            elif msg_type == "result" and "result" in msg:
                result_text = msg["result"]

            elif msg_type == "content_block_delta":
                delta = msg.get("delta", {})
                if delta.get("type") == "text_delta":
                    text = delta.get("text", "")
                    sys.stdout.write(text)
                    sys.stdout.flush()
                    result_text += text

            elif msg_type == "content_block_start":
                block = msg.get("content_block", {})
                if block.get("type") == "tool_use":
                    _log(f"\n🔧 {block.get('name', '?')}", end="")
                elif block.get("type") == "text":
                    sys.stdout.write("\n")
                    sys.stdout.flush()

        process.wait(timeout=600)

    except subprocess.TimeoutExpired:
        process.kill()
        _log("\n⏱ TIMEOUT after 10 minutes")

    elapsed = time.time() - start
    _log(f"\n{'─'*60}")
    _log(f"→ Claude finished in {elapsed:.0f}s (exit code {process.returncode})")

    return {
        "success": process.returncode == 0,
        "elapsed": elapsed,
        "response": {"result": result_text[-3000:] if result_text else ""},
        "stderr": process.stderr.read()[-1000:] if process.stderr else "",
    }


# ── Logging ─────────────────────────────────────────────────────────────────

_log_file = None
_log_lock = threading.Lock()


def _init_log(field: str):
    global _log_file
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_field = re.sub(r'[^a-zA-Z0-9]', '-', field).strip('-')
    log_path = LOG_DIR / f"{ts}-{safe_field}.log"
    _log_file = open(log_path, "w")
    _log(f"Log file: {log_path}")
    return log_path


def _log(msg: str, end: str = "\n"):
    with _log_lock:
        print(msg, end=end, flush=True)
        if _log_file:
            _log_file.write(msg + end)
            _log_file.flush()


def _log_tool_call(name: str, input_data: dict):
    if name == "Read":
        path = input_data.get("file_path", "?")
        short = "/".join(path.split("/")[-3:]) if "/" in path else path
        _log(f"  📖 Read: {short}")
    elif name == "Edit":
        path = input_data.get("file_path", "?")
        short = "/".join(path.split("/")[-3:]) if "/" in path else path
        old = (input_data.get("old_string", ""))[:60]
        _log(f"  ✏️  Edit: {short} ('{old}...')")
    elif name == "Write":
        path = input_data.get("file_path", "?")
        short = "/".join(path.split("/")[-3:]) if "/" in path else path
        _log(f"  📝 Write: {short}")
    elif name == "Bash":
        cmd = input_data.get("command", "?")[:100]
        _log(f"  💻 Bash: {cmd}")
    elif name in ("Grep", "Glob"):
        pattern = input_data.get("pattern", "?")
        _log(f"  🔍 {name}: {pattern}")
    else:
        _log(f"  🔧 {name}: {json.dumps(input_data)[:100]}")


# ── Regression test ─────────────────────────────────────────────────────────

REGRESSION_JSON = REPO_ROOT / "manabrew-engine" / "crates" / "parity" / "regression.json"


def _add_regression_test(field: str, passing_test: dict):
    """Add a regression test entry for a passing seed to regression.json."""
    try:
        entries = json.loads(REGRESSION_JSON.read_text()) if REGRESSION_JSON.exists() else []
    except (json.JSONDecodeError, OSError):
        entries = []

    safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', field).strip('_').lower()
    deck1 = passing_test["deck1"]
    deck2 = passing_test["deck2"]
    seed = passing_test["seed"]

    # Don't duplicate
    for e in entries:
        if safe_name in e.get("name", ""):
            _log(f"  ℹ Regression test for {safe_name} already exists")
            return

    entries.append({
        "name": safe_name,
        "args": f"--deck1 {deck1} --deck2 {deck2} --seed {seed} --max-turns 15 --games 1",
    })
    REGRESSION_JSON.write_text(json.dumps(entries, indent=2) + "\n")
    _log(f"  ✓ Added regression test: {safe_name} ({deck1} vs {deck2} seed {seed})")


# ── PR creation ─────────────────────────────────────────────────────────────

def create_pr(branch: str, cluster: dict, test_results: list[dict],
              regression: dict | None = None) -> str | None:
    field = cluster["field"]
    total = cluster["total_failures"]
    issue = cluster.get("github_issue")

    title = f"fix(parity): Fix divergence in `{field}`"
    if len(title) > 70:
        short_field = field.split(".")[-1] if "." in field else field
        title = f"fix(parity): Fix `{short_field}` divergence"

    body_lines = [
        "## Summary",
        f"- Fixes parity divergence in `{field}` ({total} failures across {cluster.get('num_deck_pairs', '?')} deck pairs)",
    ]
    if issue:
        body_lines.append(f"- Closes #{issue}")

    body_lines.append("")
    body_lines.append("## Verification")
    for tr in test_results:
        if tr["passed"]:
            status = "PASS"
        elif tr.get("divergence_field") and normalize_field(tr["divergence_field"]) != normalize_field(field):
            status = f"FIELD FIXED (now diverges on `{tr['divergence_field']}`)"
        else:
            status = "FAIL"
        body_lines.append(f"- `{tr['deck1']} vs {tr['deck2']}` seed {tr['seed']}: **{status}**")

    if regression:
        body_lines.append("")
        body_lines.append("## Regression Sweep")
        body_lines.append(f"- {regression['passed']}/{regression['total']} passed ({regression['pass_rate']:.0%})")
        if regression["errors"]:
            body_lines.append(f"- Failures: {', '.join(regression['errors'][:5])}")

    body_lines.extend([
        "",
        "## Test plan",
        "- [ ] Review the fix against Java reference implementation",
        "- [ ] Run full parity matrix to check for regressions",
        "",
        "---",
        "*Generated by the Parity Repair Agent v0.3*",
        "",
        "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>",
    ])

    body = "\n".join(body_lines)

    push_result = git("push", "-u", "origin", branch, check=False)
    if push_result.returncode != 0:
        _log(f"  ✗ Failed to push: {push_result.stderr}")
        return None

    pr_result = subprocess.run(
        ["gh", "pr", "create", "--title", title, "--body", body, "--base", "main"],
        cwd=REPO_ROOT, capture_output=True, text=True
    )
    if pr_result.returncode == 0:
        pr_url = pr_result.stdout.strip()
        _log(f"  ✓ PR created: {pr_url}")
        return pr_url
    else:
        _log(f"  ✗ PR creation failed: {pr_result.stderr}")
        return None


# ── Main orchestration ──────────────────────────────────────────────────────

def attempt_repair(cluster: dict, dry_run: bool = False) -> bool:
    """Attempt to repair a cluster with retries. Returns True if PR was created."""

    field = cluster["field"]
    _init_log(field)
    _log(f"\n{'='*60}")
    _log(f"REPAIRING: {field}")
    _log(f"{'='*60}")

    # Check history
    if should_skip_cluster(field):
        _log(f"  ⏭ Skipping (already fixed or exhausted)")
        return False

    # 1. Fetch failure details
    _log("\n[1/7] Fetching failure details...")
    failures = get_failure_details(field, limit=20)
    if not failures:
        _log("  ✗ No failure details found")
        return False
    _log(f"  ✓ Found {len(failures)} matching failures")

    # 2. Decompose cluster
    _log("\n[2/7] Decomposing cluster by covered cards...")
    sub_clusters = decompose_cluster(failures)
    if len(sub_clusters) > 1:
        _log(f"  ✓ {len(sub_clusters)} distinct sub-groups:")
        for sc in sub_clusters[:5]:
            _log(f"    - {sc['card_signature']} ({sc['count']} failures)")
    else:
        _log(f"  ✓ Single homogeneous cluster")

    if dry_run:
        prompt = build_repair_prompt(cluster, failures, sub_clusters)
        _log(f"\n[DRY RUN] Prompt ({len(prompt)} chars):")
        _log("-" * 40)
        _log(prompt[:3000])
        _log("..." if len(prompt) > 3000 else "")
        _log("-" * 40)
        return False

    # 3. Prepare git state
    _log("\n[3/7] Preparing git state...")
    if not is_clean():
        _log("  ⚠ Working tree not clean. Stashing changes...")
        git("stash", "push", "-m", "parity-agent-stash")

    original_branch = current_branch()

    # Retry loop
    for attempt in range(1, MAX_ATTEMPTS + 1):
        _log(f"\n{'─'*40}")
        _log(f"  ATTEMPT {attempt}/{MAX_ATTEMPTS}")
        _log(f"{'─'*40}")

        branch_name = make_branch_name(field, attempt)
        if branch_exists(branch_name):
            branch_name += f"-{int(time.time()) % 10000}"

        # Create branch from main (clean slate each attempt)
        git("checkout", "main", check=False)
        git("checkout", ".", check=False)  # discard any uncommitted changes from previous attempt
        git("clean", "-fd", "--", "manabrew-engine/", check=False)  # remove untracked files in engine
        git("checkout", "-b", branch_name)
        _log(f"  ✓ On branch: {branch_name}")

        # Build prompt with retry context
        previous_errors = get_previous_errors(field) if attempt > 1 else []
        prompt = build_repair_prompt(
            cluster, failures, sub_clusters,
            previous_errors=previous_errors,
            attempt=attempt,
        )
        _log(f"  Prompt: {len(prompt)} chars")

        # 4. Invoke Claude Code
        _log(f"\n[4/7] Invoking Claude Code (attempt {attempt})...")
        claude_result = invoke_claude(prompt)

        if not claude_result["success"]:
            error_msg = claude_result.get("stderr", "unknown error")
            _log(f"  ✗ Claude failed: {error_msg}")
            record_attempt(field, attempt, "claude_fail", error_msg)
            abandon_branch(branch_name, original_branch)
            continue

        # 5. Validate: cargo check
        _log(f"\n[5/7] Validating fix (attempt {attempt})...")

        diff = git("diff", "--stat", "main")
        if not diff.stdout.strip():
            _log("  ✗ No code changes made")
            record_attempt(field, attempt, "no_changes", "Claude made no code changes")
            abandon_branch(branch_name, original_branch)
            continue

        _log(f"  Changes:\n{diff.stdout}")

        _log("  Running cargo check...")
        check = cargo_check()
        if not check["ok"]:
            error_msg = check["stderr"][:500]
            _log(f"  ✗ Compilation failed:\n{error_msg}")
            record_attempt(field, attempt, "compile_fail", error_msg)
            abandon_branch(branch_name, original_branch)
            continue
        _log("  ✓ Compiles")

        # 5b. Anti-pattern check: scan the diff for known bad patterns
        _log("  Running anti-pattern checks...")
        full_diff = git("diff", "main")
        antipattern_issues = check_antipatterns(full_diff.stdout)
        if antipattern_issues:
            issues_str = "; ".join(antipattern_issues)
            _log(f"  ✗ Anti-pattern detected: {issues_str}")
            record_attempt(field, attempt, "antipattern", issues_str)
            abandon_branch(branch_name, original_branch)
            continue
        _log("  ✓ Anti-pattern checks passed")

        # 5c. If Java harness was modified, rebuild the JAR
        if "forge-harness/" in full_diff.stdout or "forge-harness/" in diff.stdout:
            _log("  Java harness modified — rebuilding JAR...")
            jar_build = subprocess.run(
                ["mvn", "-pl", "forge-harness", "-am", "-DskipTests", "package", "-q"],
                cwd=REPO_ROOT,
                capture_output=True, text=True,
                env={**os.environ, "JAVA_HOME": JAVA_HOME},
            )
            if jar_build.returncode != 0:
                error_msg = f"JAR rebuild failed: {jar_build.stderr[:300]}"
                _log(f"  ✗ {error_msg}")
                record_attempt(field, attempt, "jar_build_fail", error_msg)
                abandon_branch(branch_name, original_branch)
                continue
            _log("  ✓ JAR rebuilt")

        # 6. Parity tests on sample failures
        _log(f"\n[6/7] Running parity tests (attempt {attempt})...")
        test_results = []
        for s in failures[:3]:
            deck1, deck2, seed = s["deck1"], s["deck2"], s["seed"]
            _log(f"  Testing: {deck1} vs {deck2} seed {seed}...")
            result = run_parity_test(deck1, deck2, seed)
            result["deck1"] = deck1
            result["deck2"] = deck2
            result["seed"] = seed
            test_results.append(result)
            status = 'PASS' if result['passed'] else 'FAIL'
            _log(f"    → {status}")
            if not result['passed'] and result.get('stderr') and result['returncode'] != 0:
                _log(f"    ⚠ stderr: {result['stderr'][:200]}")

        passed_count = sum(1 for t in test_results if t["passed"])
        total_tests = len(test_results)

        # Field-aware scoring: count tests where our TARGET field is fixed,
        # even if the test still fails on a DIFFERENT field
        target_normalized = normalize_field(field)
        field_fixed_count = 0
        for t in test_results:
            if t["passed"]:
                field_fixed_count += 1
            elif t.get("divergence_field"):
                # Test still fails, but on a different field = our fix worked
                result_field = normalize_field(t["divergence_field"])
                if result_field != target_normalized:
                    field_fixed_count += 1
                    _log(f"    ℹ {t['deck1']} vs {t['deck2']} seed {t['seed']}: "
                         f"target field fixed! (now diverges on `{t['divergence_field']}`)")

        _log(f"\n  Results: {passed_count}/{total_tests} fully passed, "
             f"{field_fixed_count}/{total_tests} target field fixed")

        if field_fixed_count == 0:
            error_msg = "Target field still diverges in all tests"
            # Include first failure details for retry context
            for t in test_results:
                if not t["passed"] and t.get("stdout"):
                    error_msg += f"\n{t['stdout'][-300:]}"
                    break
            _log(f"  ✗ Fix is ineffective (target field still diverges)")
            record_attempt(field, attempt, "test_fail", error_msg)
            abandon_branch(branch_name, original_branch)
            continue

        if field_fixed_count > 0 and passed_count == 0:
            _log(f"  ✓ Target field fixed in {field_fixed_count}/{total_tests} tests "
                 f"(remaining failures are on different fields)")

        # 7. Regression sweep
        _log(f"\n[7/7] Running regression sweep...")
        regression = run_regression_sweep()
        _log(f"  Regression: {regression['passed']}/{regression['total']} passed ({regression['pass_rate']:.0%})")
        if regression["errors"]:
            _log(f"  Regressions: {', '.join(regression['errors'][:5])}")

        # Add regression test for the passing seed
        passing_tests = [t for t in test_results if t["passed"]]
        if passing_tests:
            _add_regression_test(field, passing_tests[0])

        # Commit if needed
        uncommitted = git("status", "--porcelain")
        if uncommitted.stdout.strip():
            git("add", "-A")
            msg = f"fix(parity): Fix divergence in {field}\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
            git("commit", "-m", msg)

        # Create PR
        _log("\n  Creating pull request...")
        pr_url = create_pr(branch_name, cluster, test_results, regression)
        record_attempt(field, attempt, "success",
                       f"PR created: {pr_url}, {passed_count}/{total_tests} tests passed")

        git("checkout", original_branch, check=False)
        return pr_url is not None

    # All attempts exhausted
    _log(f"\n  ✗ All {MAX_ATTEMPTS} attempts exhausted for {field}")
    git("checkout", ".", check=False)  # ensure clean state
    git("checkout", original_branch, check=False)
    return False


def select_cluster(clusters: list[dict], target_field: str | None = None) -> dict | None:
    if target_field:
        normalized = normalize_field(target_field)
        for c in clusters:
            if normalize_field(c["field"]) == normalized:
                return c
        _log(f"  ✗ No cluster found for field: {target_field}")
        return None

    # Skip already-attempted clusters
    candidates = []
    for c in clusters:
        if c.get("total_failures", 0) < 10:
            continue
        if should_skip_cluster(c["field"]):
            continue
        candidates.append(c)

    if not candidates:
        _log("  No actionable clusters found.")
        return None
    return candidates[0]


def display_cluster(cluster: dict, index: int = 0):
    field = cluster["field"]
    total = cluster["total_failures"]
    pairs = cluster.get("num_deck_pairs", "?")
    issue = cluster.get("github_issue", "—")

    # Check history
    history = load_history()
    status = history.get(normalize_field(field), {}).get("status", "")
    status_badge = f" [{status}]" if status else ""

    llm_summary = ""
    if cluster.get("llm_analysis"):
        try:
            llm = json.loads(cluster["llm_analysis"])
            llm_summary = f" | {llm.get('mechanic', '?')}: {llm.get('root_cause', '?')[:50]}"
        except (json.JSONDecodeError, TypeError):
            pass

    print(f"  [{index}] {field}{status_badge}")
    print(f"      {total} failures, {pairs} deck pairs, issue #{issue}{llm_summary}")


def interactive_mode(clusters: list[dict], dry_run: bool = False):
    print("\n  Top failure clusters:\n")
    for i, c in enumerate(clusters[:15]):
        display_cluster(c, i)

    print()
    choice = input("  Pick a cluster [0-14] or 'q' to quit: ").strip()
    if choice.lower() == 'q':
        return

    try:
        idx = int(choice)
        cluster = clusters[idx]
    except (ValueError, IndexError):
        print("  Invalid choice")
        return

    attempt_repair(cluster, dry_run=dry_run)


def auto_mode(clusters: list[dict], max_prs: int = 5, dry_run: bool = False,
              parallel: int = 1):
    """Automatically fix clusters. parallel > 1 uses git worktrees."""

    if parallel > 1:
        _parallel_auto_mode(clusters, max_prs, dry_run, parallel)
        return

    prs_created = 0
    attempted = 0

    for cluster in clusters:
        if prs_created >= max_prs:
            print(f"\n  Reached PR limit ({max_prs}). Stopping.")
            break
        if cluster.get("total_failures", 0) < 10:
            continue
        if should_skip_cluster(cluster["field"]):
            print(f"  ⏭ Skipping {cluster['field']} (history)")
            continue

        attempted += 1
        success = attempt_repair(cluster, dry_run=dry_run)
        if success:
            prs_created += 1

        if not dry_run:
            print(f"\n  Cooling down {COOLDOWN_BETWEEN_CLUSTERS}s...")
            time.sleep(COOLDOWN_BETWEEN_CLUSTERS)

    print(f"\n{'='*60}")
    print(f"  Done. Attempted: {attempted}, PRs created: {prs_created}")
    print(f"{'='*60}")


def _parallel_auto_mode(clusters: list[dict], max_prs: int, dry_run: bool,
                         parallel: int):
    """Run multiple repairs concurrently using git worktrees."""

    # Select clusters to work on
    work_items = []
    for c in clusters:
        if len(work_items) >= max_prs:
            break
        if c.get("total_failures", 0) < 10:
            continue
        if should_skip_cluster(c["field"]):
            continue
        work_items.append(c)

    if not work_items:
        print("  No actionable clusters found.")
        return

    print(f"\n  Launching {min(parallel, len(work_items))} parallel repairs...")

    results = {}
    threads = []

    def worker(cluster):
        field = cluster["field"]
        try:
            success = attempt_repair(cluster, dry_run=dry_run)
            results[field] = success
        except Exception as e:
            _log(f"  ✗ Worker error for {field}: {e}")
            results[field] = False

    # Run in batches of `parallel`
    for batch_start in range(0, len(work_items), parallel):
        batch = work_items[batch_start:batch_start + parallel]
        threads = []
        for cluster in batch:
            t = threading.Thread(target=worker, args=(cluster,))
            t.start()
            threads.append(t)

        for t in threads:
            t.join(timeout=900)  # 15 min max per batch

    prs_created = sum(1 for v in results.values() if v)
    print(f"\n{'='*60}")
    print(f"  Done. Attempted: {len(results)}, PRs created: {prs_created}")
    for field, success in results.items():
        print(f"    {'✓' if success else '✗'} {field}")
    print(f"{'='*60}")


# ── Entry point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Parity Repair Agent v0.3")
    parser.add_argument("--auto", action="store_true", help="Autonomous mode")
    parser.add_argument("--field", type=str, help="Target a specific divergence field")
    parser.add_argument("--dry-run", action="store_true", help="Analyze only")
    parser.add_argument("--max-prs", type=int, default=5, help="Max PRs to create")
    parser.add_argument("--model", type=str, default=CLAUDE_MODEL, help="Claude model")
    parser.add_argument("--budget", type=float, default=MAX_BUDGET_USD, help="Max USD per attempt")
    parser.add_argument("--recency", type=int, default=RECENCY_HOURS, help="Recency filter (hours)")
    parser.add_argument("--parallel", type=int, default=1, help="Parallel repairs (auto mode)")
    parser.add_argument("--reset-history", action="store_true", help="Clear attempt history")
    args = parser.parse_args()

    _apply_config(model=args.model, budget=args.budget, recency=args.recency)

    if args.reset_history:
        if HISTORY_FILE.exists():
            HISTORY_FILE.unlink()
            print("  ✓ History cleared")

    print("╔══════════════════════════════════════╗")
    print("║     Parity Repair Agent v0.3         ║")
    print("╚══════════════════════════════════════╝")

    print("\n  Preflight checks:")

    if not JAVA_JAR.exists():
        print(f"  ✗ Java harness JAR not found: {JAVA_JAR}")
        print(f"    Build with: yarn build:harness  (or: mvn -pl forge-harness -am -DskipTests package)")
        sys.exit(1)
    print(f"  ✓ Java JAR: {JAVA_JAR.name}")

    stats = get_stats()
    print(f"  ✓ Parity API: {stats['total_games']} games, {stats['pass_rate']:.1%} pass rate")
    print(f"  ✓ Model: {CLAUDE_MODEL}, budget: ${MAX_BUDGET_USD}/attempt, max retries: {MAX_ATTEMPTS}")
    if RECENCY_HOURS > 0:
        print(f"  ✓ Recency filter: last {RECENCY_HOURS}h")
    if args.parallel > 1:
        print(f"  ✓ Parallel mode: {args.parallel} concurrent repairs")

    # Show history summary
    history = load_history()
    if history:
        fixed = sum(1 for v in history.values() if v.get("status") == "fixed")
        exhausted = sum(1 for v in history.values() if v.get("status") == "exhausted")
        total_attempts = sum(len(v.get("attempts", [])) for v in history.values())
        print(f"  ✓ History: {fixed} fixed, {exhausted} exhausted, {total_attempts} total attempts")

    if not is_clean() and not args.dry_run:
        print("  ⚠ Working tree has uncommitted changes")

    print("\n  Fetching failure clusters...")
    clusters = get_clusters()
    print(f"  ✓ {len(clusters)} clusters")

    if args.field:
        cluster = select_cluster(clusters, args.field)
        if cluster:
            attempt_repair(cluster, dry_run=args.dry_run)
    elif args.auto:
        auto_mode(clusters, max_prs=args.max_prs, dry_run=args.dry_run,
                  parallel=args.parallel)
    else:
        interactive_mode(clusters, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
