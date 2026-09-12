#!/usr/bin/env python3
"""What the engine actually does to answer one decision.

Reads the JSONL from `forge-jvm-game.py --counters`. Wall clock on this
workload is not a measurement: games diverge run to run even at a fixed seed,
so game length swamps whatever is under test. A count does not, which is why
this bins counts rather than milliseconds.

Bins by battlefield size, not by turn. Turn number is a proxy for board size
and a bad one across seat counts, since a four-seat game has four players
adding permanents per round. Binning by the board says whether the growth is
the board or the opponents.

    python3 scripts/engine-bench/counters.py 'c4*.jsonl'
    python3 scripts/engine-bench/counters.py --type chooseAction 'c2*.jsonl' 'c4*.jsonl'
"""
import argparse
import glob
import json
from collections import defaultdict

FIELDS = [
    ("aiPriority", "aiPrio"),
    ("staticPasses", "static"),
    ("staticAbilitiesSeen", "stAbs"),
    ("affectedCardsCalls", "affect"),
    ("validCardsCalls", "valid"),
    ("validCardsExamined", "vExam"),
    ("cardIsValid", "isValid"),
    ("cardHasProperty", "hasProp"),
]


def median(values):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def load(patterns, kind):
    rows = []
    for pattern in patterns:
        for path in sorted(glob.glob(pattern)):
            for line in open(path):
                row = json.loads(line)
                if row.get("ev") != "decision" or "n" not in row:
                    continue
                if kind and row["type"] != kind:
                    continue
                rows.append(row)
    return rows


def table(rows, key, label, width):
    buckets = defaultdict(list)
    for row in rows:
        buckets[key(row)].append(row)
    header = f"  {label:>{width}} {'n':>5} {'ms':>6}" + "".join(
        f" {short:>8}" for _, short in FIELDS
    )
    print(header)
    for bucket in sorted(buckets):
        group = buckets[bucket]
        line = f"  {bucket:>{width}} {len(group):>5} {median([r['ms'] for r in group]):>6}"
        for field, _ in FIELDS:
            line += f" {median([r['n'][field] for r in group]):>8,}"
        print(line)


def per_priority(rows):
    """Per AI priority, not per decision.

    A decision here is the gap between two prompts to the human seat. At four
    seats that gap holds three AI seats taking priority where two seats holds
    one, so per-decision counts are not comparable across seat counts and
    per-priority ones are.
    """
    usable = [r for r in rows if r["n"].get("aiPriority")]
    if not usable:
        return
    print("\n  per AI priority:")
    buckets = defaultdict(list)
    for row in usable:
        buckets[(row["bf"] // 10) * 10].append(row)
    print(f"  {'board':>9} {'n':>5} {'prio':>6} {'isValid':>9} {'vExam':>9} {'hasProp':>9}")
    for bucket in sorted(buckets):
        group = buckets[bucket]
        prio = sum(r["n"]["aiPriority"] for r in group)
        print(f"  {bucket:>3}-{bucket + 9:<5} {len(group):>5} {prio:>6}"
              f" {sum(r['n']['cardIsValid'] for r in group) / prio:>9,.0f}"
              f" {sum(r['n']['validCardsExamined'] for r in group) / prio:>9,.0f}"
              f" {sum(r['n']['cardHasProperty'] for r in group) / prio:>9,.0f}")


def inside(rows):
    """How much of a decision is spent inside the two methods.

    The timers cost two nanoTime calls per outermost entry, which the harness
    calibrates at startup, so subtract that before believing the share. This is
    a measurement that is not the profile: JFR over-counts allocating code, so a
    profile finding needs confirming somewhere else.
    """
    timed = [r for r in rows if "cardHasPropertyNanos" in r["n"]]
    if not timed:
        return
    calibration = next((r["n"].get("calibrationNanos", 0) for r in timed), 0)
    print("\n  time inside the two methods (nanoTime overhead removed):")
    buckets = defaultdict(list)
    for row in timed:
        buckets[(row["bf"] // 10) * 10].append(row)
    print(f"  {'board':>9} {'n':>5} {'ms':>8} {'isValid':>9} {'hasProp':>9}"
          f" {'ns/isValid':>11} {'ns/hasProp':>11}")
    for bucket in sorted(buckets):
        group = buckets[bucket]
        ms = sum(r["ms"] for r in group)
        calls_v = sum(r["n"]["cardIsValid"] for r in group)
        calls_p = sum(r["n"]["cardHasProperty"] for r in group)
        ns_v = sum(r["n"]["cardIsValidNanos"] for r in group) - calibration * calls_v
        ns_p = sum(r["n"]["cardHasPropertyNanos"] for r in group) - calibration * calls_p
        share_v = 100 * ns_v / 1e6 / ms if ms else 0
        share_p = 100 * ns_p / 1e6 / ms if ms else 0
        print(f"  {bucket:>3}-{bucket + 9:<5} {len(group):>5} {ms:>7}ms"
              f" {share_v:>8.1f}% {share_p:>8.1f}%"
              f" {ns_v / calls_v if calls_v else 0:>11.0f} {ns_p / calls_p if calls_p else 0:>11.0f}")
    print(f"  (nanoTime pair calibrated at {calibration}ns; hasProp nests inside isValid)")


def report(patterns, kind):
    rows = load(patterns, kind)
    if not rows:
        print(f"no decisions in {patterns}")
        return
    print(f"\n=== {' '.join(patterns)}  {len(rows)} decisions"
          + (f", type {kind}" if kind else "") + "  (medians)")
    table(rows, lambda r: (r["bf"] // 5) * 5, "board", 5)
    print()
    table(rows, lambda r: min(r["turn"] // 10 * 10, 50), "turn", 5)

    per_priority(rows)
    inside(rows)

    # Per unit of board: if a decision's cost were linear in the board, this is
    # flat. If the engine re-walks the board once per thing on the board, it
    # climbs.
    sized = [r for r in rows if r["bf"] >= 5]
    if sized:
        print("\n  per card on the board:")
        buckets = defaultdict(list)
        for row in sized:
            buckets[(row["bf"] // 10) * 10].append(row)
        for bucket in sorted(buckets):
            group = buckets[bucket]
            exam = median([r["n"]["validCardsExamined"] for r in group])
            checks = median([r["n"]["cardIsValid"] for r in group])
            board = median([r["bf"] for r in group])
            print(f"  board {bucket:>3}-{bucket + 9:<3} n={len(group):>4} "
                  f"board={board:>3}  vExam/card={exam / board:>7.1f}  "
                  f"isValid/card={checks / board:>7.1f}")


def callers(patterns):
    """Who asked for a validity filter, from the sampled stack walks.

    Sampled one call in N, so the counts are scaled back up and are estimates.
    The second column is what matters: cards handed to the filter, which is the
    work, not the number of calls.
    """
    seen, sample = defaultdict(lambda: [0, 0]), 1
    for pattern in patterns:
        for path in sorted(glob.glob(pattern)):
            for line in open(path):
                row = json.loads(line)
                if row.get("ev") != "callers":
                    continue
                sample = row.get("sample", 1)
                for where, (calls, cards) in row.get("callers", {}).items():
                    seen[where][0] += calls
                    seen[where][1] += cards
    if not seen:
        return
    total = sum(v[1] for v in seen.values())
    print(f"\n=== who calls getValidCards  (sampled 1 in {sample})")
    print(f"  {'cards':>14} {'share':>6} {'calls':>12}  caller")
    for where, (calls, cards) in sorted(seen.items(), key=lambda kv: -kv[1][1])[:20]:
        print(f"  {cards * sample:>14,} {100 * cards / total:>5.1f}%"
              f" {calls * sample:>12,}  {where}")


ap = argparse.ArgumentParser()
ap.add_argument("--type", default="", help="only this decision type, e.g. chooseAction")
ap.add_argument("patterns", nargs="+")
args = ap.parse_args()
for pattern in args.patterns:
    report([pattern], args.type)
if len(args.patterns) > 1:
    report(args.patterns, args.type)
callers(args.patterns)
