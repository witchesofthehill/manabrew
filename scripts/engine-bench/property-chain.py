#!/usr/bin/env python3
"""Where each observed property sits in CardProperty's if/else chain.

`cardHasProperty` is one flat chain of `property.equals(...)` and
`property.startsWith(...)` tests, so the cost of a check is where its property
sits in that chain, and a property matching nothing walks all of it. This joins
the chain order to the property histogram that `forge-jvm-game.py --counters`
records, which says how much of the scanning is real.

    python3 scripts/engine-bench/property-chain.py 'j4*.jsonl'
"""
import glob, json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "forge", "forge-game", "src", "main", "java",
                   "forge", "game", "card", "CardProperty.java")

BRANCH = re.compile(r'^\s{8}\}?\s*(?:else\s+)?if\s*\((.*)$')
TEST = re.compile(r'property(?:\.toUpperCase\(\))?\.(equals|equalsIgnoreCase|startsWith|endsWith|contains)\("([^"]*)"\)')


def chain():
    """The top-level branches, in the order the engine tries them."""
    out = []
    for lineno, line in enumerate(open(SRC), 1):
        m = BRANCH.match(line)
        if not m or "property" not in m.group(1):
            continue
        tests = TEST.findall(m.group(1))
        if tests:
            out.append((lineno, tests, m.group(1).strip()))
    return out


def position(prop, branches):
    for i, (lineno, tests, text) in enumerate(branches):
        for kind, lit in tests:
            if kind in ("equals", "equalsIgnoreCase") and prop == lit:
                return i, lineno
            if kind == "startsWith" and prop.startswith(lit):
                return i, lineno
            if kind == "endsWith" and prop.endswith(lit):
                return i, lineno
            if kind == "contains" and lit in prop:
                return i, lineno
    return None, None


def main(patterns):
    branches = chain()
    counts = {}
    for path in sorted(sum((glob.glob(p) for p in patterns), [])):
        for line in open(path):
            row = json.loads(line)
            if row.get("ev") == "properties":
                for k, v in row["counts"].items():
                    counts[k] = counts.get(k, 0) + v
    if not counts:
        sys.exit("no property histogram in those files; run with --counters")

    total = sum(counts.values())
    rows = []
    for prop, n in counts.items():
        pos, lineno = position(prop, branches)
        rows.append((n, prop, pos, lineno))
    rows.sort(reverse=True, key=lambda r: r[0])

    print(f"{len(branches)} top-level branches in the chain, "
          f"{len(counts)} distinct properties, {total:,} calls\n")
    print(f"{'calls':>10} {'share':>6} {'pos':>5} {'line':>6}  property")
    for n, prop, pos, lineno in rows[:40]:
        p = "none" if pos is None else str(pos)
        l = "-" if lineno is None else str(lineno)
        print(f"{n:>10,} {100*n/total:>5.1f}% {p:>5} {l:>6}  {prop}")

    # Tests executed is the real number to cut: a property at position k costs
    # k+1 comparisons, and one that matches nothing costs the whole chain.
    tests = 0
    unresolved = 0
    for n, prop, pos, lineno in rows:
        tests += n * ((pos + 1) if pos is not None else len(branches))
        if pos is None:
            unresolved += n
    print(f"\ncomparisons walked: {tests:,} over {total:,} calls "
          f"= {tests/total:.1f} per call")
    print(f"properties matching no branch: {unresolved:,} calls "
          f"({100*unresolved/total:.1f}%), {len(branches)} comparisons each")
    weighted = sorted(rows, key=lambda r: -r[0] * ((r[2] + 1) if r[2] is not None else len(branches)))
    print("\nby comparisons walked:")
    for n, prop, pos, lineno in weighted[:15]:
        cost = n * ((pos + 1) if pos is not None else len(branches))
        p = "none" if pos is None else str(pos)
        print(f"{cost:>12,} {100*cost/tests:>5.1f}%  pos {p:>4}  {prop}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["j*.jsonl"])
