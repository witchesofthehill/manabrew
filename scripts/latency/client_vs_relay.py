"""Per seat: what the relay saw a decision cost, beside what the client reported.

The relay stamps a seat's response arriving and the node's first reply to that
seat leaving; add that seat's own heartbeat round trip and you have everything
outside the player's machine. The client's engine report for the same game
carries what the player actually waited. The difference is the client: payload
transfer and on-machine work. On 2026-09-10 it was ~250ms on web and 1.1-1.7s
on two desktop machines for 4-seat hosted games, which is what
`replyWait` / `clientWork` in the engine report now split.

    python3 scripts/latency/client_vs_relay.py 'captures/2026-09-10/*.zst' reports.json

`reports.json` is the `--json` output of the intel probe for

    select json_extract(payload,'$.game_id') gid, json_extract(payload,'$.username') u,
           json_extract(payload,'$.platform') plat, json_extract(payload,'$.engine') eng,
           json_extract(payload,'$.decisions') dec, json_extract(payload,'$.turnaround_p50') ta50
    from events where event='engine_stats' and ts >= '<date>'

Seats are matched by slot: capture `player-N` is `players[N]` of the game_started
header. Games with more than one human are printed but not summarised: the other
human's think is inside the client number and not inside the relay's.

See docs/agents/LATENCY_ANALYSIS.md for the traps. This one closes a decision at
the node's first reply to the seat (trap 6) and drops decisions where the node
prompted another seat first (trap 1).
"""
import glob
import json
import os
import statistics
import subprocess
import sys
from datetime import datetime
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state_delta import SeatStates


def ts(raw):
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()


def pct(values, p):
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def one(path):
    raw = subprocess.run(["zstd", "-dcq", path], capture_output=True, timeout=180).stdout
    lines = raw.splitlines()
    if not lines:
        return None
    header = json.loads(lines[0])
    if header.get("event") != "game_started":
        return None
    seats = SeatStates()
    pending, answered, per = {}, [], {}

    def close(seat, when, node_ms):
        for row in answered:
            if row[0] == seat and row[1] is not None:
                d = (when - row[1]) * 1000
                if 0 <= d < 120000 and not row[3]:
                    p = per.setdefault(seat, {"raw": [], "rtt": [], "node": [], "perceived": []})
                    p["raw"].append(d)
                    if row[2] is not None:
                        p["rtt"].append(row[2])
                        p["perceived"].append(d + row[2])
                    if node_ms is not None:
                        p["node"].append(node_ms)
                row[1] = None
                break

    for line in lines[1:]:
        try:
            e = json.loads(line)
        except Exception:
            continue
        env = e.get("envelope") or {}
        if "ts" not in e:
            continue
        kind, when = env.get("kind"), ts(e["ts"])
        if kind in ("state", "stateDelta"):
            if kind == "stateDelta" and not seats.observe(env):
                continue
            node_ms = env.get("engineMs")
            if node_ms is not None and env.get("emitMs") is not None:
                node_ms += env["emitMs"]
            close(env.get("forPlayer") or "", when, node_ms)
        elif kind == "prompt":
            seat = env.get("forPlayer")
            close(seat, when, None)
            for row in answered:
                if row[1] is not None and row[0] != seat:
                    row[3] = True
            pending[seat] = when
        elif kind == "response":
            seat = env.get("fromPlayer")
            if seat not in pending:
                continue
            pending.pop(seat)
            answered.append([seat, when, e.get("clientRttMs"), False])

    players = header.get("players") or []
    humans = sum(1 for p in players if not p.get("is_bot"))
    out = []
    for seat, p in per.items():
        if len(p["raw"]) < 10:
            continue
        index = int(seat.split("-")[1]) if seat.startswith("player-") else -1
        username = players[index]["username"] if 0 <= index < len(players) else None
        out.append({
            "game": header.get("game_id"), "seat": seat, "username": username,
            "humans": humans, "seats": len(players), "n": len(p["raw"]),
            "node_p50": pct(p["node"], 50), "rtt_p50": pct(p["rtt"], 50),
            "relay_p50": pct(p["raw"], 50), "perceived_p50": pct(p["perceived"], 50),
        })
    return out


def find_rows(obj):
    if isinstance(obj, dict):
        if "rows" in obj and "columns" in obj:
            return obj
        for value in obj.values():
            found = find_rows(value)
            if found:
                return found
    if isinstance(obj, list):
        for value in obj:
            found = find_rows(value)
            if found:
                return found
    return None


if __name__ == "__main__":
    paths = sorted(glob.glob(os.path.expanduser(sys.argv[1])))
    reports = {}
    if len(sys.argv) > 2:
        table = find_rows(json.load(open(sys.argv[2])))
        for row in table["rows"]:
            r = dict(zip(table["columns"], row))
            reports[(r["gid"], r["u"])] = r
    rows = []
    with Pool(8) as pool:
        for res in pool.imap_unordered(one, paths):
            rows.extend(res or [])
    print(f"{'game':8} {'seat':8} {'plat':6} {'hum':>3} {'seats':>5} {'n':>4} {'node':>5} {'rtt':>5} "
          f"{'relay':>5} {'perc':>5} {'client':>6} {'gap':>6}")
    gaps = {}
    for r in sorted(rows, key=lambda r: (r["humans"], r["seats"], r["game"])):
        rep = reports.get((r["game"], r["username"]))
        client = rep["ta50"] if rep else None
        gap = client - r["perceived_p50"] if client is not None and r["perceived_p50"] else None
        print(f"{r['game'][:8]:8} {r['seat']:8} {(rep or {}).get('plat', '?'):6} {r['humans']:>3} {r['seats']:>5} "
              f"{r['n']:>4} {round(r['node_p50'] or 0):>5} {round(r['rtt_p50'] or 0):>5} "
              f"{round(r['relay_p50']):>5} {round(r['perceived_p50'] or 0):>5} "
              f"{'' if client is None else client:>6} {'' if gap is None else round(gap):>6}")
        if gap is not None and r["humans"] == 1:
            gaps.setdefault(((rep or {}).get("plat", "?"), r["seats"]), []).append(gap)
    print("\nclient minus relay-perceived, solo games only (the other human's think is otherwise inside it):")
    for (plat, seats), values in sorted(gaps.items()):
        print(f"  {plat:6} {seats}-seat  n={len(values):<3} median {statistics.median(values):.0f} ms  "
              f"p25 {pct(values, 25):.0f}  p75 {pct(values, 75):.0f}")
