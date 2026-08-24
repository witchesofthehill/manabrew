"""Latency by board size, controlled for each game's own network floor.

See docs/agents/LATENCY_ANALYSIS.md for what the timestamps mean and which
traps make this easy to get wrong.

Reads state patches as well as full states (trap 6), so it keeps working on
captures from after the 2026-08-20 rollout. Where the node reports `engineMs`
and `emitMs`, prefer those over the floor: the floor is not the network, it is
the network plus the engine's cheapest decision.

    python3 scripts/latency/board_size_and_floor.py 'captures/*/*.zst'
"""
import json, re, subprocess, sys, glob, os
from collections import defaultdict
from datetime import datetime
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state_delta import SeatStates

TS = re.compile(rb'"ts":"([^"]+)"')
SEAT = re.compile(rb'"forPlayer":"([^"]+)"')
CARD = re.compile(rb'"summoningSick"')
def ts(raw):
    return datetime.fromisoformat(raw.decode().replace("Z", "+00:00")).timestamp()

def pct(v, p):
    if not v:
        return 0
    v = sorted(v)
    k = (len(v) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)

def bucket(n):
    for hi, label in ((40, "<40"), (80, "40-79"), (120, "80-119"),
                      (160, "120-159"), (220, "160-219")):
        if n < hi:
            return label
    return "220+"

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
        return None
    if str(h.get("engine", "")).lower() != "forge":
        return None
    rows = []
    pending, answered, last_cards = {}, [], {}
    seats = SeatStates()
    patched = b'"kind":"stateDelta"' in raw
    for line in lines[1:]:
        is_state = b'"kind":"state"' in line or (patched and b'"kind":"stateDelta"' in line)
        if is_state:
            if not patched:
                m, sm = TS.search(line), SEAT.search(line)
                if not m or not sm:
                    continue
                when, seat = ts(m.group(1)), sm.group(1).decode()
                last_cards[seat] = len(CARD.findall(line))
                node_ms = None
            else:
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                env = e.get("envelope") or {}
                if "ts" not in e or not seats.observe(env):
                    continue
                when = ts(e["ts"].encode())
                seat = env.get("forPlayer") or ""
                last_cards[seat] = seats.size_for(seat)
                node_ms = env.get("engineMs")
                if node_ms is not None and env.get("emitMs") is not None:
                    node_ms += env["emitMs"]
            for row in answered:
                if row[0] == seat and row[1] is not None:
                    d = (when - row[1]) * 1000
                    if 0 <= d < 120000 and not row[4]:
                        rows.append((row[5], row[3], d, node_ms))
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
                    row[4] = True
            inp = (env.get("prompt") or {}).get("input") or {}
            pending[seat] = (when, inp.get("type"), inp.get("actions") or [])
        elif env.get("kind") == "response":
            seat = env.get("fromPlayer")
            if seat not in pending:
                continue
            at, ptype, actions = pending.pop(seat)
            if ptype != "chooseAction":
                continue
            o = (env.get("action") or {}).get("output") or {}
            play = None
            if o.get("type") == "pass":
                play = "pass priority"
            elif o.get("type") == "act":
                c = next((a for a in actions if a.get("id") == o.get("actionId")), None)
                if c:
                    play = ("cast / play land" if c.get("type") == "cast" else
                            ("mana ability" if c.get("isManaAbility") else "activated ability")
                            if c.get("type") == "activateAbility" else c.get("type"))
            answered.append([seat, when, ptype, last_cards.get(seat, 0), False, play])
    if len(rows) < 30:
        return None
    floor = pct([d for _, _, d, _ in rows], 5)
    peak = max(c for _, c, _, _ in rows)
    measured = [(d - node_ms) for _, _, d, node_ms in rows if node_ms is not None]
    return (floor, peak, measured,
            [(play, cards, d, node_ms if node_ms is not None else max(0.0, d - floor))
             for play, cards, d, node_ms in rows])

def head(w=34):
    print(f"{'':{w}} {'n':>9} {'p50':>7} {'p75':>7} {'p90':>7} {'p95':>7} {'p99':>8} {'>10s':>7}")

def line(label, v, w=34):
    if len(v) < 30:
        return
    o10 = 100.0 * sum(1 for x in v if x > 10000) / len(v)
    print(f"{label:{w}} {len(v):>9} {pct(v,50):>7.0f} {pct(v,75):>7.0f} {pct(v,90):>7.0f} "
          f"{pct(v,95):>7.0f} {pct(v,99):>8.0f} {o10:>6.2f}%")

if __name__ == "__main__":
    floors, floors_by_peak = [], defaultdict(list)
    raw_ps, exc_ps = defaultdict(list), defaultdict(list)
    hops = []
    paths = sorted(glob.glob(os.path.expanduser(sys.argv[1])))
    with Pool(8) as pool:
        for n, res in enumerate(pool.imap_unordered(one, paths, chunksize=8)):
            if n % 1500 == 0:
                print(f"[{n}/{len(paths)}]", file=sys.stderr, flush=True)
            if not res:
                continue
            floor, peak, measured, rows = res
            floors.append(floor)
            hops.extend(measured)
            floors_by_peak[bucket(peak)].append(floor)
            for play, cards, d, excess in rows:
                if play:
                    raw_ps[(play, bucket(cards))].append(d)
                    exc_ps[(play, bucket(cards))].append(excess)

    if hops:
        print(f"\nMEASURED HOP (round trip minus the node's own engineMs + emitMs)")
        print(f"decisions with node timing: {len(hops)}")
        print(f"  p10 {pct(hops,10):.0f}   p50 {pct(hops,50):.0f}   "
              f"p90 {pct(hops,90):.0f}   p99 {pct(hops,99):.0f} ms")
        print("  Compare with the floor below. The floor is the network plus the")
        print("  engine's cheapest decision, so it runs well above the real hop.")

    print(f"\nPER-GAME NETWORK FLOOR (5th percentile of that game's node times)")
    print(f"games with a usable floor: {len(floors)}")
    print(f"  across games: p10 {pct(floors,10):.0f}   p50 {pct(floors,50):.0f}   "
          f"p90 {pct(floors,90):.0f}   p99 {pct(floors,99):.0f}   max {max(floors):.0f} ms")

    print(f"\nIS THE FLOOR WORSE IN BIG GAMES?  (floor by that game's largest board)")
    print(f"{'largest board':>16} {'games':>7} {'floor p50':>10} {'floor p90':>10}")
    for b in ("<40", "40-79", "80-119", "120-159", "160-219", "220+"):
        v = floors_by_peak.get(b, [])
        if len(v) < 10:
            continue
        print(f"{b:>16} {len(v):>7} {pct(v,50):>10.0f} {pct(v,90):>10.0f}")

    BUCKETS = ("<40", "40-79", "80-119", "120-159", "160-219", "220+")
    for title, data in (("RAW node time", raw_ps),
                        ("NODE-SIDE time: measured engineMs+emitMs where the node "
                         "reports it, otherwise excess over that game's own floor", exc_ps)):
        print(f"\n== {title}, ms ==")
        head()
        for play in ("pass priority", "cast / play land", "activated ability", "mana ability"):
            for b in BUCKETS:
                line(f"  {play:20.20} {b:>8}", data.get((play, b), []))
            print()
