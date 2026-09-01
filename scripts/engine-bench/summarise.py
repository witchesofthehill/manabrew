#!/usr/bin/env python3
"""Reads the JSONL from `forge-wasm-game.mjs` and says what the decisions cost.

Two questions it answers. Was a stall the collector? Sum the `--trace-gc` pause
column from the run's log: if the largest single pause and the whole run's total
are both far under one stall, the collector is not what the stall is, and no
clock alignment is needed to say so. And does the cost scale with the opponents
or with the board? Bucket by turn number: a per-opponent multiplier is flat
across a game, a board-size cost climbs.

Reads the same-turn half only, the half that is one decision. See
`docs/agents/LATENCY_ANALYSIS.md`.

    python3 scripts/engine-bench/summarise.py 'game-4seat-*.jsonl'
"""
import glob
import json
import re
import sys
from collections import defaultdict

# [pid:0xisolate] <uptime> ms: <Kind> <before> (<cap>) -> <after> (<cap>) MB, ... <pause> / <ext> ms
GC_LINE = re.compile(
    r"^\[\d+:0x[0-9a-f]+\]\s+(\d+) ms: (\w+)[^,]*?(\d+\.\d+) \((\d+\.\d+)\) MB.*?([\d.]+) / [\d.]+ ms"
)


def quantile(values, percent):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(percent / 100 * len(ordered)))]


def read(path):
    rows = [json.loads(line) for line in open(path)]
    pauses, caps, by_kind = [], [], defaultdict(list)
    try:
        for line in open(path.replace(".jsonl", ".log")):
            found = GC_LINE.match(line)
            if found:
                _, kind, _, cap, pause = found.groups()
                pauses.append(float(pause))
                caps.append(float(cap))
                by_kind[kind].append(float(pause))
    except FileNotFoundError:
        pass
    return rows, pauses, caps, by_kind


def report(path):
    rows, pauses, caps, by_kind = read(path)
    decisions = [r for r in rows if r["ev"] == "decision"]
    if not decisions:
        print(f"{path}: no decisions")
        return []
    end = next((r for r in rows if r["ev"] == "end"), {})
    same = [r["ms"] for r in decisions if not r["turns"]]
    cross = [r["ms"] for r in decisions if r["turns"]]

    print(f"\n=== {path}  ({end.get('why')}, turn {end.get('turn')}, {len(decisions)} decisions)")
    for label, values in (("same-turn ", same), ("cross-turn", cross)):
        print(
            f"  {label} n={len(values):4d} p50={quantile(values, 50):6.0f} "
            f"p90={quantile(values, 90):6.0f} max={max(values or [0]):7.0f} ms"
        )
    if pauses:
        print(
            f"  GC         n={len(pauses):4d} total={sum(pauses) / 1000:.1f}s  "
            f"max pause={max(pauses):.1f}ms  peak heap={max(caps):.0f}MB"
        )
        for kind, kind_pauses in sorted(by_kind.items(), key=lambda kv: -sum(kv[1])):
            print(
                f"    {kind:<12} n={len(kind_pauses):5d} total={sum(kind_pauses) / 1000:6.2f}s "
                f"max={max(kind_pauses):7.1f}ms"
            )
    for stall in (r for r in decisions if r["ms"] > 5000):
        print(
            f"  stall {stall['ms']:>7}ms {stall['type']} turns={stall['turns']} "
            f"@turn {stall['turn']} uptime={stall.get('up')}ms"
        )
    return decisions


def by_turn(all_decisions):
    buckets = defaultdict(list)
    for decision in all_decisions:
        if not decision["turns"]:
            buckets[min(decision["turn"] // 10 * 10, 50)].append(decision["ms"])
    if not buckets:
        return
    print("\n  turns      n    p50    p90    max")
    for low in sorted(buckets):
        values = buckets[low]
        print(
            f"  {low:>2}-{low + 9:<3} {len(values):>5} {quantile(values, 50):>6} "
            f"{quantile(values, 90):>6} {max(values):>6}"
        )


paths = [p for pattern in sys.argv[1:] for p in sorted(glob.glob(pattern))]
pooled = [d for path in paths for d in report(path)]
if len(paths) > 1:
    print(f"\n=== pooled over {len(paths)} games")
    by_turn(pooled)
