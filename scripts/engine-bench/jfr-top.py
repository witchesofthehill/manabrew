#!/usr/bin/env python3
"""Top frames in a JFR recording, by self and by inclusive samples.

    python3 scripts/engine-bench/jfr-top.py g4.jfr
    python3 scripts/engine-bench/jfr-top.py g4.jfr --thread 'Game AI Eval'

Read the traps in the engine-bench README before believing a number here. JFR
over-counts allocating code unless the recording was taken with
-XX:+UnlockDiagnosticVMOptions -XX:+DebugNonSafepoints, which forge-jvm-game.py
passes. And a profile is a profile: confirm a finding with a measurement that
is not one.
"""
import argparse
import re
import subprocess
import sys
from collections import Counter

ap = argparse.ArgumentParser()
ap.add_argument("recording")
ap.add_argument("--thread", default="", help="only samples on threads whose name contains this")
ap.add_argument("--top", type=int, default=25)
ap.add_argument("--prefix", default="forge.", help="only report frames under this package")
args = ap.parse_args()

out = subprocess.run(["jfr", "print", "--events", "ExecutionSample", args.recording],
                     capture_output=True, text=True)
if out.returncode:
    sys.exit(out.stderr.strip() or "jfr print failed")

FRAME = re.compile(r"^\s+([\w.$]+)\.(\w+|<init>)\(.*?\) line:")
self_time, inclusive, threads = Counter(), Counter(), Counter()
current, thread_name, in_trace = [], "", False


def flush():
    if not current:
        return
    if args.thread and args.thread not in thread_name:
        return
    threads[thread_name] += 1
    self_time[current[0]] += 1
    for frame in set(current):
        inclusive[frame] += 1


for line in out.stdout.splitlines():
    if line.startswith("jdk.ExecutionSample"):
        flush()
        current, in_trace, thread_name = [], False, ""
        continue
    stripped = line.strip()
    if stripped.startswith("sampledThread ="):
        # jfr renders it as `sampledThread = "name" (javaThreadId = N)`
        rest = stripped.split("=", 1)[1].strip()
        thread_name = rest.split('"')[1] if '"' in rest else rest
        continue
    if stripped.startswith("stackTrace = ["):
        in_trace = True
        continue
    if in_trace:
        found = FRAME.match(line)
        if found:
            current.append(f"{found.group(1)}.{found.group(2)}")
flush()

total = sum(threads.values())
if not total:
    sys.exit("no samples matched")
print(f"{total:,} samples" + (f" on threads matching {args.thread!r}" if args.thread else ""))
for name, n in threads.most_common(6):
    print(f"  {100 * n / total:>5.1f}%  {name}")

for label, counter in (("self", self_time), ("inclusive", inclusive)):
    print(f"\n{label}:")
    shown = 0
    for frame, n in counter.most_common():
        if not frame.startswith(args.prefix):
            continue
        print(f"  {100 * n / total:>5.2f}%  {frame}")
        shown += 1
        if shown >= args.top:
            break
