#!/usr/bin/env python3
"""Reads a `stress.mjs` run as one population and says what the engine cost.

Pools the same-turn decisions of every game in the run by seat count and prompt
type, and reports the percentiles a client would feel. Games are never compared
one to one: at a fixed seed they still diverge, so the unit is the decision and
the population is the run.

    python3 scripts/engine-bench/pool.py runs/pr
    python3 scripts/engine-bench/pool.py runs/pr --baseline runs/main --fail-over 25

With `--baseline` the same table is read from another run and each cell is
shown as a ratio. `--fail-over N` exits 1 when any p50 or p90 with at least
`--min-n` decisions on both sides is more than N percent slower. `--json` writes
the pooled table for a later baseline.

`--ab runs/<tag>` reads a `stress.mjs --engines` run: the first arm is the
control, and every other arm is compared to it cell by cell with a bootstrap
interval on the p50 and p90 ratios and the share of resamples in which the arm
is slower. A ratio whose interval straddles 1.0 is noise at that sample size.
The per-arm tail line (p99, p99.9, max, counts over 1, 5 and 20 s) is where a
deadline shows; the ratio table is about the median and will not see it.
Games are the unit the bootstrap resamples, so the interval narrows with games,
not decisions: eight 2-seat games per arm put the `chooseAction` p50 interval
at about 0.7-1.2, thirty is where a 20% change separates from noise.

    python3 scripts/engine-bench/pool.py --ab runs/ab --fail-over 20
"""
import argparse
import glob
import json
import os
import random
import re
import sys
from collections import defaultdict

BOOT = 400

GC_LINE = re.compile(r"^\[\d+:0x[0-9a-f]+\]\s+(\d+) ms: (\w+).*?([\d.]+) / [\d.]+ ms")


def quantile(values, percent):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(percent / 100 * len(ordered)))]


def read_run(path):
    games = []
    for jsonl in sorted(glob.glob(os.path.join(path, "*.jsonl"))):
        rows = [json.loads(line) for line in open(jsonl) if line.strip()]
        start = next((r for r in rows if r["ev"] == "start"), {})
        pauses = []
        log = jsonl[:-6] + ".log"
        if os.path.exists(log):
            for line in open(log, errors="replace"):
                found = GC_LINE.match(line)
                if found:
                    pauses.append(float(found.group(3)))
        games.append({"name": os.path.basename(jsonl)[:-6], "seats": start.get("seats"), "rows": rows, "pauses": pauses})
    return games


def pool(games):
    """{(seats, type): [same-turn ms]} plus per-game facts.

    `by_game` keeps the same cells split per process, because decisions inside
    one game share its board and are not independent draws.
    """
    cells = defaultdict(list)
    by_game = defaultdict(list)
    facts = []
    for g in games:
        ends = [r for r in g["rows"] if r["ev"] == "end"]
        mine = defaultdict(list)
        for r in g["rows"]:
            if r["ev"] == "decision" and not r.get("turns"):
                mine[(g["seats"], r["type"])].append(r["ms"])
                mine[(g["seats"], "*")].append(r["ms"])
        for key, v in mine.items():
            cells[key].extend(v)
            by_game[key].append(v)
        plays = sum(1 for r in g["rows"] if r["ev"] == "play" and r["output"] == "act")
        loops = sum(1 for r in g["rows"] if r["ev"] == "loop")
        heaps = [e["memory"]["rss"] for e in ends if "memory" in e]
        facts.append(
            {
                "name": g["name"],
                "seats": g["seats"],
                "games": len(ends),
                "clean": all(e["why"] == "game:over" for e in ends) and bool(ends),
                "why": [e["why"] for e in ends],
                "turns": [e.get("turn") for e in ends],
                "seconds": [round(e.get("duration_ms", 0) / 1000) for e in ends],
                "acts": plays,
                "loops": loops,
                "rss_mb": [round(h / 1e6) for h in heaps],
                "gc_max_ms": max(g["pauses"]) if g["pauses"] else None,
                "gc_total_ms": round(sum(g["pauses"])) if g["pauses"] else None,
            }
        )
    pool.by_game = by_game
    return cells, facts


def summarise(cells):
    return {
        f"{seats}|{kind}": {
            "n": len(v),
            "p50": quantile(v, 50),
            "p90": quantile(v, 90),
            "p99": quantile(v, 99),
            "max": quantile(v, 100),
        }
        for (seats, kind), v in cells.items()
    }


def bootstrap(a_games, b_games, rng):
    """Ratio b/a of p50 and p90 with a 95% interval and P(b slower) on p50.

    Resamples games, not decisions: one game's decisions rise and fall with
    its board, so an A/A test over decisions reports differences that are
    not there.
    """
    a = [ms for g in a_games for ms in g]
    b = [ms for g in b_games for ms in g]
    r50, r90 = [], []
    for _ in range(BOOT):
        sa = [ms for _ in a_games for ms in a_games[rng.randrange(len(a_games))]]
        sb = [ms for _ in b_games for ms in b_games[rng.randrange(len(b_games))]]
        r50.append(quantile(sb, 50) / max(1, quantile(sa, 50)))
        r90.append(quantile(sb, 90) / max(1, quantile(sa, 90)))
    r50.sort()
    r90.sort()
    lo, hi = int(BOOT * 0.025), int(BOOT * 0.975) - 1
    return {
        "p50": quantile(b, 50) / max(1, quantile(a, 50)),
        "p50_lo": r50[lo],
        "p50_hi": r50[hi],
        "p90": quantile(b, 90) / max(1, quantile(a, 90)),
        "p90_lo": r90[lo],
        "p90_hi": r90[hi],
        "slower": sum(1 for r in r50 if r > 1) / BOOT,
    }


def ab(run, min_n, min_games, fail_over):
    manifest = json.load(open(os.path.join(run, "manifest.json")))
    arms = list(manifest["engines"])
    if len(arms) < 2:
        print(f"{run}: one arm only, nothing to compare")
        return 2
    pooled = {}
    per_game = {}
    for arm in arms:
        games = read_run(os.path.join(run, arm))
        cells, facts = pool(games)
        pooled[arm] = cells
        per_game[arm] = pool.by_game
        clean = sum(f["games"] for f in facts if f["clean"])
        print(f"{arm}: {manifest['engines'][arm]}; {len(games)} processes, {clean} clean, "
              f"{sum(len(v) for (s, k), v in cells.items() if k == '*')} same-turn decisions")
        for seats in sorted({s for s, k in cells}):
            v = cells[(seats, "*")]
            print(f"  {seats} seats tail: p99 {quantile(v, 99)} p99.9 {quantile(v, 99.9)} max {max(v)}, "
                  f"over 1s {sum(m > 1000 for m in v)}, over 5s {sum(m > 5000 for m in v)}, "
                  f"over 20s {sum(m > 20000 for m in v)}")
    control = arms[0]
    rng = random.Random(1)
    verdict = 0
    for arm in arms[1:]:
        print(f"\n{arm} vs {control}, ratio > 1 is slower, 95% bootstrap interval")
        print(f"{'seats':>5} {'type':<24}{'n ctl':>7}{'n arm':>7}{'p50':>7}{'interval':>16}{'p90':>7}{'interval':>16}{'P(slower)':>10}")
        bad = []
        for key in sorted(pooled[control], key=lambda k: (k[0], -len(pooled[control][k]))):
            a = pooled[control][key]
            b = pooled[arm].get(key, [])
            ga, gb = per_game[control][key], per_game[arm].get(key, [])
            if len(a) < min_n or len(b) < min_n or len(ga) < min_games or len(gb) < min_games:
                continue
            r = bootstrap(ga, gb, rng)
            seats, kind = key
            print(f"{seats:>5} {kind:<24}{len(a):>7}{len(b):>7}{r['p50']:>7.2f}"
                  f"{r['p50_lo']:>7.2f}-{r['p50_hi']:<8.2f}{r['p90']:>7.2f}"
                  f"{r['p90_lo']:>7.2f}-{r['p90_hi']:<8.2f}{r['slower']:>10.2f}")
            if fail_over is not None and r["p50_lo"] > 1 + fail_over / 100:
                bad.append((seats, kind, r["p50"]))
        if bad:
            verdict = 1
            print(f"\nFAIL {arm}: whole interval above {fail_over:.0f}% slower on " +
                  ", ".join(f"{s}-seat {k} ({r:.2f}x)" for s, k, r in bad))
        elif fail_over is not None:
            print(f"\nok {arm}: no cell whose whole interval is above {fail_over:.0f}% slower")
    return verdict


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", nargs="?")
    ap.add_argument("--ab", help="a stress.mjs --engines run directory")
    ap.add_argument("--baseline")
    ap.add_argument("--fail-over", type=float, default=None, help="percent slower on p50/p90 that fails")
    ap.add_argument("--min-n", type=int, default=100)
    ap.add_argument("--min-games", type=int, default=8, help="games per arm a cell needs for --ab")
    ap.add_argument("--json", help="write the pooled table here")
    args = ap.parse_args()

    if args.ab:
        return ab(args.ab, args.min_n, args.min_games, args.fail_over)
    if not args.run:
        ap.error("a run directory or --ab is required")

    games = read_run(args.run)
    if not games:
        print(f"{args.run}: no games")
        return 2
    cells, facts = pool(games)
    table = summarise(cells)

    base = None
    if args.baseline:
        if os.path.isdir(args.baseline):
            base = summarise(pool(read_run(args.baseline))[0])
        else:
            base = json.load(open(args.baseline))

    print(f"run {args.run}: {len(games)} processes, {sum(f['games'] for f in facts)} games, "
          f"{sum(f['games'] for f in facts if f['clean'])} clean")
    for seats in sorted({f["seats"] for f in facts}):
        fs = [f for f in facts if f["seats"] == seats]
        secs = [s for f in fs for s in f["seconds"]]
        turns = [t for f in fs for t in f["turns"] if t is not None]
        print(f"  {seats} seats: {len(fs)} processes, game {quantile(secs, 50)}s median / {max(secs) if secs else 0}s max, "
              f"turn {quantile(turns, 50)} median, {sum(f['acts'] for f in fs)} human acts, "
              f"{sum(f['loops'] for f in fs)} loop flips")
    dirty = [f for f in facts if not f["clean"]]
    if dirty:
        print("  not clean: " + ", ".join(f"{f['name']} {f['why']}" for f in dirty))

    print()
    head = f"{'seats':>5} {'type':<28}{'n':>7}{'p50':>8}{'p90':>8}{'p99':>8}{'max':>9}"
    if base:
        head += f"{'p50 vs':>9}{'p90 vs':>9}"
    print(head)
    worst = []
    for key in sorted(table, key=lambda k: (int(k.split('|')[0]), -table[k]["n"])):
        seats, kind = key.split("|")
        c = table[key]
        line = f"{seats:>5} {kind:<28}{c['n']:>7}{c['p50']:>8}{c['p90']:>8}{c['p99']:>8}{c['max']:>9}"
        if base:
            b = base.get(key)
            if b and b["n"] >= args.min_n and c["n"] >= args.min_n and b["p50"] and b["p90"]:
                r50 = c["p50"] / b["p50"]
                r90 = c["p90"] / b["p90"]
                line += f"{r50:>8.2f}x{r90:>8.2f}x"
                worst.append((max(r50, r90), key))
            else:
                line += f"{'':>9}{'':>9}"
        print(line)

    heapy = [f for f in facts if len(f["rss_mb"]) > 1]
    if heapy:
        print("\nrss per game in one engine (MB):")
        for f in heapy:
            print(f"  {f['name']}: {' '.join(str(m) for m in f['rss_mb'])}")
    gc = [f for f in facts if f["gc_max_ms"] is not None]
    if gc:
        print(f"\ngc: largest pause {max(f['gc_max_ms'] for f in gc):.0f}ms, "
              f"total per process median {quantile([f['gc_total_ms'] for f in gc], 50)}ms")

    if args.json:
        json.dump(table, open(args.json, "w"), indent=1)
        print(f"\nwrote {args.json}")

    if base and args.fail_over is not None:
        limit = 1 + args.fail_over / 100
        bad = [(r, k) for r, k in worst if r > limit]
        if bad:
            print(f"\nFAIL: {len(bad)} cells more than {args.fail_over:.0f}% slower than baseline:")
            for r, k in sorted(bad, reverse=True):
                print(f"  {k}: {r:.2f}x")
            return 1
        print(f"\nok: no cell more than {args.fail_over:.0f}% slower than baseline")
    return 0


if __name__ == "__main__":
    sys.exit(main())
