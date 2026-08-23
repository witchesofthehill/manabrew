"""Per-decision latency for hosted Forge games, from relay capture files.

See docs/agents/LATENCY_ANALYSIS.md for what the timestamps mean and which
traps make this easy to get wrong.

    python3 scripts/latency/decision_latency.py 'captures/*/*.zst'
"""
import json, re, subprocess, sys, glob, os
from collections import defaultdict
from datetime import datetime
from multiprocessing import Pool

ERAS = [("A pre-leak-fix      -> 08-01", "0000-00-00", "2026-08-01"),
        ("B leak fix #583     08-02..19", "2026-08-02", "2026-08-19"),
        ("C GraalVM #697      08-20..21", "2026-08-20", "2026-08-21"),
        ("D AiCache #738      08-22 ->", "2026-08-22", "9999-99-99")]
SHORT = {n: n.split()[0] for n, _, _ in ERAS}
def era_of(d):
    for n, lo, hi in ERAS:
        if lo <= d <= hi:
            return n
    return "?"

TS = re.compile(rb'"ts":"([^"]+)"')
SEAT = re.compile(rb'"forPlayer":"([^"]+)"')
TURN = re.compile(rb'"turn":(\d+)')
def ts(raw):
    return datetime.fromisoformat(raw.decode().replace("Z", "+00:00")).timestamp()

def one(path):
    try:
        raw = subprocess.run(["zstd", "-dcq", path], capture_output=True, timeout=180).stdout
    except Exception:
        return None
    lines = raw.splitlines()
    if not lines:
        return None
    try:
        h = json.loads(lines[0])
    except Exception:
        return None
    if h.get("event") != "game_started":
        return None
    if any(str(p.get("username", "")).lower().startswith(("loadtest", "probe")) for p in h.get("players", [])):
        return ("skip", "synthetic")
    if str(h.get("engine", "")).lower() != "forge":
        return ("skip", "nonforge")
    era = era_of(os.path.basename(os.path.dirname(path)))
    rows = []
    pending, answered, turn = {}, [], 0
    for line in lines[1:]:
        if b'"kind":"state"' in line:
            m, sm = TS.search(line), SEAT.search(line)
            if not m or not sm:
                continue
            tm = TURN.search(line)
            if tm:
                turn = int(tm.group(1))
            when, seat = ts(m.group(1)), sm.group(1).decode()
            for row in answered:
                if row[0] == seat and row[1] is not None:
                    d = (when - row[1]) * 1000
                    if 0 <= d < 120000:
                        rows.append((era, row[2], row[3], row[4], d, row[5]))
                    row[1] = None
                    break
            continue
        if b'"kind":"prompt"' not in line and b'"kind":"response"' not in line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        env = e.get("envelope") or {}
        if "ts" not in e:
            continue
        when = ts(e["ts"].encode())
        if env.get("kind") == "prompt":
            seat = env.get("forPlayer")
            for row in answered:
                if row[1] is not None and row[0] != seat:
                    row[5] = True
            inp = (env.get("prompt") or {}).get("input") or {}
            pending[seat] = (when, inp.get("type"), inp.get("actions") or [])
        elif env.get("kind") == "response":
            seat = env.get("fromPlayer")
            if seat not in pending:
                continue
            at, ptype, actions = pending.pop(seat)
            o = (env.get("action") or {}).get("output") or {}
            play = None
            if ptype == "chooseAction":
                if o.get("type") == "pass":
                    play = "pass priority"
                elif o.get("type") == "act":
                    c = next((a for a in actions if a.get("id") == o.get("actionId")), None)
                    if c:
                        play = ("cast / play land" if c.get("type") == "cast" else
                                ("mana ability" if c.get("isManaAbility") else "activated ability")
                                if c.get("type") == "activateAbility" else c.get("type"))
            rows.append(("THINK", era, ptype, (when - at) * 1000))
            answered.append([seat, when, ptype, play, turn, False])
    return ("ok", rows)

def pct(v, p):
    if not v:
        return 0
    v = sorted(v)
    k = (len(v) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)

def head(label=""):
    print(f"{label:32} {'n':>9} {'p50':>7} {'p75':>7} {'p90':>7} {'p95':>7} {'p99':>8} {'>5s':>7} {'>10s':>7}")

def line(label, v):
    if not v:
        return
    o5 = 100.0 * sum(1 for x in v if x > 5000) / len(v)
    o10 = 100.0 * sum(1 for x in v if x > 10000) / len(v)
    print(f"{label:32} {len(v):>9} {pct(v,50):>7.0f} {pct(v,75):>7.0f} {pct(v,90):>7.0f} "
          f"{pct(v,95):>7.0f} {pct(v,99):>8.0f} {o5:>6.2f}% {o10:>6.2f}%")

if __name__ == "__main__":
    node_era, node_pt, node_play, node_turn = (defaultdict(list) for _ in range(4))
    excluded = defaultdict(list)
    think, rtt = defaultdict(list), defaultdict(list)
    games = skipped = defaultdict(int), 0
    games, synthetic, nonforge = 0, 0, 0
    paths = sorted(glob.glob(os.path.expanduser(sys.argv[1])))
    with Pool(8) as pool:
        for n, res in enumerate(pool.imap_unordered(one, paths, chunksize=8)):
            if n % 1500 == 0:
                print(f"[{n}/{len(paths)}]", file=sys.stderr, flush=True)
            if not res:
                continue
            if res[0] == "skip":
                if res[1] == "synthetic": synthetic += 1
                else: nonforge += 1
                continue
            games += 1
            for row in res[1]:
                if row[0] == "THINK":
                    _, era, ptype, d = row
                    think[ptype].append(d)
                    if ptype == "diceRolled" and 0 <= d < 30000:
                        rtt[era].append(d)
                    continue
                era, ptype, play, turn, d, interrupted = row
                if interrupted:
                    excluded[era].append(d)
                    continue
                node_era[era].append(d)
                node_pt[(ptype, era)].append(d)
                if play:
                    node_play[(play, era)].append(d)
                bucket = "turn 1-5" if turn <= 5 else "turn 6-10" if turn <= 10 else \
                         "turn 11-15" if turn <= 15 else "turn 16-20" if turn <= 20 else "turn 21+"
                node_turn[(bucket, era)].append(d)

    print(f"\nHOSTED FORGE LATENCY, 40 days of production captures")
    print(f"games: {games}   (excluded {synthetic} load/probe, {nonforge} non-Forge)")
    print("\nAll times are node time: response -> that seat's next board, as stamped")
    print("by the relay. Includes the relay<->node hop. Decisions where the node")
    print("prompted another seat first are excluded (that is a human thinking).")

    print("\n\n== 1. NODE TIME PER DECISION, BY ERA ==")
    head()
    for name, _, _ in ERAS:
        line(name, node_era[name])
    print("\n   excluded as 'another player was asked first':")
    head()
    for name, _, _ in ERAS:
        line("   " + SHORT[name], excluded[name])

    print("\n\n== 2. NODE TIME BY PROMPT TYPE AND ERA ==")
    tot = defaultdict(int)
    for (k, _), v in node_pt.items():
        tot[k] += len(v)
    head()
    for k in sorted(tot, key=lambda k: -tot[k]):
        if tot[k] < 500: continue
        for name, _, _ in ERAS:
            v = node_pt.get((k, name), [])
            if len(v) >= 30:
                line(f"  {k:22.22} {SHORT[name]}", v)
        print()

    print("\n== 3. NODE TIME BY KIND OF PLAY AND ERA ==")
    tot = defaultdict(int)
    for (k, _), v in node_play.items():
        tot[k] += len(v)
    head()
    for k in sorted(tot, key=lambda k: -tot[k]):
        for name, _, _ in ERAS:
            v = node_play.get((k, name), [])
            if len(v) >= 30:
                line(f"  {k:22.22} {SHORT[name]}", v)
        print()

    print("\n== 4. NODE TIME BY TURN (board size proxy) AND ERA ==")
    head()
    for k in ("turn 1-5", "turn 6-10", "turn 11-15", "turn 16-20", "turn 21+"):
        for name, _, _ in ERAS:
            v = node_turn.get((k, name), [])
            if len(v) >= 30:
                line(f"  {k:22.22} {SHORT[name]}", v)
        print()

    print("\n== 5. CLIENT ROUND TRIP (auto-acked dice roll, no human) ==")
    head()
    for name, _, _ in ERAS:
        line(name, rtt[name])

    print("\n\n== 6. PLAYER THINK TIME (prompt -> response; includes their round trip) ==")
    head()
    for k, v in sorted(think.items(), key=lambda kv: -len(kv[1]))[:12]:
        line("  " + k, v)
