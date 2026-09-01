#!/usr/bin/env python3
"""Plays the same game as `forge-wasm-game.mjs`, on the JVM harness.

Same decks, same seat count, same policy: the human seat passes on every
priority. The point of having both is that they differ in one way that matters.
A released wasm build carries no function names, so a profile there stops at
`wasm-function[51278]`; here JFR gives Java stacks for the same AI on the same
board. wasm is also single-threaded, which is how #817 was found: Forge bounds
its ability evaluation with a thread and a timed `future.get`, and that bound
does not exist in the browser.

    node scripts/harness.mjs build          # the fat jar this drives
    python3 scripts/engine-bench/forge-jvm-game.py --seats 4 --out g4.jsonl
    python3 scripts/engine-bench/forge-jvm-game.py --seats 4 --jfr g4.jfr

Whole-game A/B on this is not a measurement. Games diverge run to run even at a
fixed seed, so game length swamps any change: compare profiles, or pool
decisions across several games and read the percentiles.
"""
import json, subprocess, sys, time, os, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PRESETS = os.path.join(ROOT, "public", "preset_decks")

ap = argparse.ArgumentParser()
ap.add_argument("--seats", type=int, default=4)
ap.add_argument("--decks", default="kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander")
ap.add_argument("--jar", default=os.path.join(ROOT, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar"))
ap.add_argument("--forge-home", default=os.path.join(ROOT, "forge", "forge-gui"))
ap.add_argument("--java", default=os.environ.get("JAVA_HOME", "") + "/bin/java" if os.environ.get("JAVA_HOME") else "java")
ap.add_argument("--jfr", default="")
ap.add_argument("--sysprop", action="append", default=[])
ap.add_argument("--jvmarg", action="append", default=[],
                help="extra JVM flag, e.g. --jvmarg=-Xss4m")
ap.add_argument("--no-compile-huge", action="store_true",
                help="leave HotSpot's 8000-byte compile limit in place, which "
                     "no build we ship has")
ap.add_argument("--ai-timeout", type=int, default=0,
                help="seconds the AI may spend evaluating one decision (default 5). "
                     "Pass a large value to stop the deadline binding, which is "
                     "what makes an engine A/B controlled")
ap.add_argument("--out", default="jvm-4seat.jsonl")
ap.add_argument("--timeout", type=int, default=1800)
ap.add_argument("--seed", type=int, default=42)
ap.add_argument("--counters", action="store_true",
                help="count engine work per decision (#817) instead of only timing it")
args = ap.parse_args()


def front_face(name):
    cut = name.find(" // ")
    return name if cut < 0 else name[:cut]


def load_deck(basename):
    """A preset flattened the way the wasm worker flattens it: one entry per copy."""
    raw = json.load(open(os.path.join(PRESETS, f"{basename}.json")))
    cards = []
    for c in raw["cards"]:
        entry = {"name": front_face(c["name"])}
        if c.get("set"):
            entry["setCode"] = c["set"]
        if c.get("cardNumber"):
            entry["collectorNumber"] = c["cardNumber"]
        cards.extend([entry] * c.get("count", 1))
    return cards, front_face(raw["commander"])


deck_names = args.decks.split(",")
players = []
for i in range(args.seats):
    cards, commander = load_deck(deck_names[i % len(deck_names)])
    players.append({
        "name": "You" if i == 0 else f"Forge AI {i}",
        "ai": i != 0,
        "deck": cards,
        "commanderNames": [commander],
    })

request = {
    "gameId": "bench",
    "variant": "Commander",
    "startingLife": 40,
    "seed": args.seed,
    "players": players,
}

sysprops = list(args.sysprop)
if args.counters:
    sysprops.append("forge.engineCounters=true")
if args.ai_timeout:
    # The AI bounds its own evaluation against a wall clock, so a faster build
    # evaluates more candidates in the same budget, plays differently, and the
    # game diverges. Pin the deadline high and both arms play the same game.
    sysprops.append(f"forge.aiTimeout={args.ai_timeout}")
cmd = [args.java] + [f"-D{p}" for p in sysprops] + args.jvmarg
if not args.no_compile_huge:
    # CardProperty.cardHasProperty is 14,112 bytes of bytecode, and HotSpot
    # refuses to compile a method over 8000, so by default it runs interpreted
    # for the whole game: three to eight times its compiled cost, and the top
    # self frame in any profile taken here. Nothing we ship is HotSpot. The
    # desktop engine is a GraalVM native image and the browser one is Web
    # Image, and both compile every reachable method ahead of time. Leaving the
    # limit on makes this harness rank the engine wrongly, so turn it off.
    cmd.append("-XX:-DontCompileHugeMethods")
if args.jfr:
    # DebugNonSafepoints matters: without it the sampler can only land on
    # safepoint-pollable spots, which over-counts allocating code and
    # under-counts long branch chains.
    cmd += ["-XX:+UnlockDiagnosticVMOptions", "-XX:+DebugNonSafepoints",
            f"-XX:StartFlightRecording=settings=profile,filename={args.jfr},dumponexit=true"]
cmd += ["-jar", args.jar, "--interactive-server", "--forge-home", args.forge_home]

proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=open(args.out.replace(".jsonl", ".stderr"), "w"), text=True, bufsize=1)


def call(body):
    proc.stdin.write(json.dumps(body) + "\n")
    proc.stdin.flush()
    # JFR and the JVM print to stdout, which is also the protocol stream. Skip
    # anything that is not one of the harness's envelopes.
    while True:
        line = proc.stdout.readline()
        if not line:
            raise SystemExit("harness died; see the .stderr file")
        if line.startswith('{"ok"'):
            break
        sys.stderr.write("[stdout] " + line)
    reply = json.loads(line)
    if not reply.get("ok"):
        raise SystemExit(f"harness error: {reply.get('error')}")
    return reply["result"]


REPLIES = {
    "mulligan": lambda p: {"type": "mulliganDecision", "keep": True},
    "mulliganPutBack": lambda p: {"type": "mulliganPutBackDecision",
                                  "cardIds": p["input"].get("handCardIds", [])[: p["input"].get("count", 0)]},
    "diceRolled": lambda p: {"type": "diceRolledAcknowledged"},
    "revealCards": lambda p: {"type": "revealCardsAcknowledged"},
    "chooseAction": lambda p: {"type": "pass"},
    "chooseBoolean": lambda p: {"type": "decision", "value": False},
    "chooseCards": lambda p: {"type": "chooseCardsDecision",
                              "chosenCardIds": [c["id"] for c in p["input"].get("cards", [])][: p["input"].get("min", 0)]},
    "chooseAttackers": lambda p: {"type": "declareAttackers", "assignments": []},
    "chooseBlockers": lambda p: {"type": "declareBlockers", "assignments": []},
    "chooseBoardTargets": lambda p: {"type": "boardTargets",
                                     "chosen": p["input"].get("candidates", [])[: max(0, p["input"].get("minTargets", 0))]},
    "chooseColor": lambda p: {"type": "colorDecision",
                              "chosenColors": {(p["input"].get("validColors") or ["W"])[0]: p["input"].get("amount", 1)}},
    "chooseNumber": lambda p: {"type": "numberDecision", "chosenNumber": p["input"].get("min", 0)},
    "chooseFromSelection": lambda p: {"type": "selectionDecision",
                                      "chosenIndices": list(range(min(len(p["input"].get("options", [])), p["input"].get("minTotal", 0))))},
    "chooseCombatDamageAssignment": lambda p: {"type": "combatDamageAssignmentDecision",
                                               "assignments": ([{"assigneeId": (p["input"].get("blockerIds") or [p["input"].get("defenderId")])[0],
                                                                 "damage": p["input"].get("totalDamage", 0)}]
                                                               if (p["input"].get("blockerIds") or p["input"].get("defenderId")) else [])},
    "chooseDamageAssignmentOrder": lambda p: {"type": "damageAssignmentOrderDecision",
                                              "orderedBlockerIds": p["input"].get("blockerIds", [])},
    "scry": lambda p: {"type": "scryDecision",
                       "zoneCardIds": [[c["id"] for c in p["input"].get("cards", [])] if i == 0 else []
                                       for i, _ in enumerate(p["input"].get("zones", []))]},
    "reorder": lambda p: {"type": "reorderDecision", "orderedIds": [i["id"] for i in p["input"].get("items", [])]},
    "payManaCost": lambda p: {"type": "cancel"},
}

started = time.time()
out = open(args.out, "w")


def note(row):
    row["t"] = int((time.time() - started) * 1000)
    out.write(json.dumps(row) + "\n")
    out.flush()


session = json.loads(call({"command": "startGame", "payload": json.dumps(request)}))["sessionId"]
note({"ev": "start", "seats": args.seats, "session": session, "decks": deck_names[: args.seats]})

def counters():
    """Engine counters at this instant. Read while the engine is parked on our
    prompt, so it is not racing the game thread."""
    if not args.counters:
        return None
    return json.loads(call({"command": "getCounters"}) or "{}")


last_id, answered_at, decisions, turn = None, None, 0, 0
base_counters = None
while time.time() - started < args.timeout:
    raw = call({"command": "getPrompt", "sessionId": session, "playerIndex": 0})
    if not raw:
        if call({"command": "getGameOver", "sessionId": session}).strip() == "true":
            break
        time.sleep(0.002)
        continue
    prompt = json.loads(raw)
    pid = prompt.get("promptId")
    if pid == last_id:
        if call({"command": "getGameOver", "sessionId": session}).strip() == "true":
            break
        time.sleep(0.002)
        continue

    kind = prompt["input"]["type"]
    if answered_at is not None:
        ms = int((time.time() - answered_at) * 1000)
        decisions += 1
        row = {"ev": "decision", "type": kind, "ms": ms, "turn": turn}
        if base_counters is not None:
            now = counters()
            # Deltas over the same window as ms: what the engine did to
            # answer this one decision.
            # battlefield is a level, and the nanoTime calibration is a
            # constant; everything else is a delta over this decision.
            levels = ("battlefield", "calibrationNanos")
            row["n"] = {k: now[k] - base_counters[k] for k in now if k not in levels}
            row["n"]["calibrationNanos"] = now["calibrationNanos"]
            row["bf"] = now["battlefield"]
        note(row)
        if ms > 5000:
            print(f"  stall {ms}ms {kind} @turn {turn}", flush=True)
    reply = REPLIES.get(kind)
    if reply is None:
        note({"ev": "unhandled", "type": kind})
        break
    if decisions % 25 == 0:
        snap = json.loads(call({"command": "getSnapshot", "sessionId": session, "viewer": 0}) or "{}")
        turn = snap.get("gameView", snap).get("turn", turn)
    last_id = pid
    base_counters = counters()
    answered_at = time.time()
    call({"command": "submitAction", "sessionId": session,
          "payload": json.dumps({"type": kind, "output": reply(prompt)})})

note({"ev": "end", "decisions": decisions, "turn": turn})
if args.counters:
    note({"ev": "properties", "counts": json.loads(call({"command": "getCounterProperties"}) or "{}")})
    note({"ev": "callers", **json.loads(call({"command": "getCounterCallers"}) or "{}")})
print(f"\ndone: {decisions} decisions over {int(time.time() - started)}s, turn {turn}")
# quit closes stdout before replying, so do not wait for an envelope.
proc.stdin.write('{"command":"quit"}\n')
proc.stdin.flush()
proc.wait(timeout=120)
