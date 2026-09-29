import argparse
from collections import Counter
import select
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

from human_seat import HumanSeat

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=17179)
parser.add_argument("--capture", type=Path, required=True)
parser.add_argument("--expect-gap")
parser.add_argument("--human-port", type=int)
parser.add_argument("--ui-origin", default="http://localhost:1420")
parser.add_argument("--agent", type=Path)
parser.add_argument("--scenario", choices=["bolt", "combat", "blocking", "lethal", "activated", "manual-pool", "modal", "color", "x-cost", "any-mana", "echo"], default="bolt")
args = parser.parse_args()
human = HumanSeat(args.human_port, args.ui_origin) if args.human_port else None
args.capture.parent.mkdir(parents=True, exist_ok=True)
events = queue.Queue()
clients = []
logs = []
agents = []
request_id = 0
root = Path(__file__).resolve().parent
subprocess.run([str(root / "run"), "--build-only"], check=True)
table_id = None
joined_games = set()
findings = []
answered = 0
rejections = 0
superseded = 0
states = 0
result = None
mechanics = Counter()
native_callbacks = Counter()
combat_assignments = 0
minimum_life = 20
seen_names = set()
graveyard_names = set()
pending_requests = {}


def read(seat, process):
    for line in process.stdout:
        try:
            events.put((seat, json.loads(line)))
        except ValueError:
            events.put((seat, {"malformed": line}))
    events.put((seat, {"eof": True}))


with args.capture.open("w") as capture:

    def record(seat, direction, message):
        capture.write(json.dumps({"seat": seat, "direction": direction, "message": message}) + "\n")
        capture.flush()

    def send(seat, method, params, expect_error=None):
        global request_id
        request_id += 1
        message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        record(seat, "request", message)
        pending_requests[request_id] = (method, expect_error)
        clients[seat].stdin.write(json.dumps(message) + "\n")
        clients[seat].stdin.flush()
        return request_id

    try:
        for seat in range(2):
            log = args.capture.with_suffix(f".seat{seat}.log").open("w")
            logs.append(log)
            process = subprocess.Popen([str(root / "run"), "--no-build"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=log, text=True)
            clients.append(process)
            if args.agent:
                agents.append(subprocess.Popen([str(args.agent.resolve()), *(["--hold-attackers"] if args.scenario == "blocking" and seat == 1 else []), *(["--number-choice", "2"] if args.scenario == "x-cost" else []), *(["--confirm-label", "Yes"] if args.scenario == "echo" else [])], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True))
            threading.Thread(target=read, args=(seat, process), daemon=True).start()
            send(seat, "connect", {"host": "127.0.0.1", "port": args.port,
                                   "username": f"mba{os.getpid()}_{seat}", "autoSpendMana": args.scenario != "manual-pool"})
        connected = 0
        deck = {"name": "Protocol audit", "cards": [
            {"cardName": "Mountain", "setCode": "M15", "cardNumber": "262", "amount": 5},
            {"cardName": "Lightning Bolt", "setCode": "M11", "cardNumber": "149", "amount": 5}
        ], "sideboard": []}
        if args.scenario == "lethal":
            deck["cards"][0]["amount"] = 10
            deck["cards"][1]["amount"] = 20
        if args.scenario in ("combat", "blocking"):
            deck["cards"][1] = {"cardName": "Raging Goblin", "setCode": "M10", "cardNumber": "153", "amount": 5}
        if args.scenario == "activated":
            deck["cards"][1] = {"cardName": "Prodigal Pyromancer", "setCode": "M10", "cardNumber": "151", "amount": 5}
        if args.scenario == "modal":
            deck["cards"][1] = {"cardName": "You See a Pair of Goblins", "setCode": "AFR", "cardNumber": "170", "amount": 5}
        if args.scenario == "color":
            deck["cards"] = [
                {"cardName": "Plains", "setCode": "M14", "cardNumber": "230", "amount": 5},
                {"cardName": "Brave the Elements", "setCode": "M14", "cardNumber": "10", "amount": 5}
            ]
        if args.scenario == "any-mana":
            deck["cards"][0] = {"cardName": "City of Brass", "setCode": "8ED", "cardNumber": "322", "amount": 5}
        if args.scenario == "echo":
            deck["cards"][1] = {"cardName": "Goblin War Buggy", "setCode": "USG", "cardNumber": "196", "amount": 5}
        if args.scenario == "x-cost":
            deck["cards"][1] = {"cardName": "Fireball", "setCode": "M10", "cardNumber": "136", "amount": 10}
            deck["cards"][0]["amount"] = 10
        deadline = time.monotonic() + (1800 if human else 90)
        while time.monotonic() < deadline:
            seat, message = events.get(timeout=max(0.1, deadline - time.monotonic()))
            record(seat, "event", message)
            if "malformed" in message or "eof" in message:
                raise RuntimeError(message)
            if "id" in message:
                method, expect_error = pending_requests.pop(message["id"])
                if expect_error:
                    if message.get("error", {}).get("message") == "StalePrompt" and expect_error != "StalePrompt":
                        superseded += 1
                        continue
                    if message.get("error", {}).get("message") != expect_error:
                        raise RuntimeError(f"Expected {expect_error}, received {message}")
                    rejections += 1
                    continue
                if method == "respond" and message.get("error", {}).get("message") == "StalePrompt":
                    superseded += 1
                    continue
                if "error" in message:
                    raise RuntimeError(message["error"])
                if method == "connect":
                    connected += 1
                    if connected == 2:
                        send(0, "createTable", {"deckType": "Constructed - Freeform Unlimited"})
                elif method == "createTable":
                    table_id = message["result"]["tableId"]
                    send(0, "joinTable", {"tableId": table_id, "deck": deck})
                elif method == "joinTable":
                    if seat == 0:
                        send(1, "joinTable", {"tableId": table_id, "deck": deck})
                    else:
                        send(0, "startMatch", {"tableId": table_id})
                elif method == "respond":
                    answered += 1
                continue
            method = message.get("method")
            data = message.get("params", {})
            if method == "gameStarted":
                key = (seat, data["gameId"])
                if key not in joined_games:
                    joined_games.add(key)
                    send(seat, "joinGame", {"gameId": data["gameId"]})
            elif method == "prompt":
                family = data["input"]["type"]
                mechanics[family + (":" + data["input"]["intent"] if family == "chooseObject" else "")] += 1
                if family == "chooseBoolean":
                    output = {"type": "decision", "value": False}
                elif family == "chooseNumber":
                    output = {"type": "numberDecision", "chosenNumber": min(data["input"]["max"], max(data["input"]["min"], 2)) if args.scenario == "x-cost" else data["input"]["min"]}
                elif family == "chooseFromSelection":
                    output = {"type": "selectionDecision", "chosenIndices": [0]}
                elif family == "chooseAction":
                    actions = data["input"]["actions"]
                    casts = [action for action in actions if action["type"] == "cast"]
                    choices = casts or [action for action in actions if action["type"] == "unclassified"]
                    output = {"type": "act", "actionId": choices[0]["id"]} if choices else {"type": "pass"}
                elif family == "chooseObject":
                    selected = {target["id"] for target in data["input"]["selected"]}
                    candidates = [target for target in data["input"]["candidates"] if target["id"] not in selected]
                    opponents = [target for target in candidates if target["kind"] == "player" and target["id"] != data["decidingPlayerId"]]
                    target = next(iter(opponents or candidates), None)
                    output = {"type": "select", "target": target} if target else {"type": "finish" if data["input"]["canFinish"] else "cancel"}
                elif family == "payManaCost":
                    actions = data["input"]["actions"]
                    output = {"type": "act", "actionId": actions[0]["id"]} if actions else {"type": "cancel"}
                else:
                    raise RuntimeError(f"Smoke policy does not cover {family}")
                if family == "payManaCost":
                    mechanics.update("payment:" + action["type"] for action in data["input"]["actions"])
                    if "cardId" not in data["input"]:
                        mechanics["payment:without-source"] += 1
                response = {"kind": "response", "promptId": data["promptId"],
                            "action": {"type": family, "output": output}}
                if human and seat == 0:
                    response = human.decide(data, max(0.1, deadline - time.monotonic()))
                elif args.agent:
                    agent = agents[seat]
                    agent.stdin.write(json.dumps(data) + "\n")
                    agent.stdin.flush()
                    if not select.select([agent.stdout], [], [], 10)[0]:
                        raise TimeoutError("Bot decision exceeded ten seconds")
                    response = json.loads(agent.stdout.readline())
                if family in ("chooseAction", "payManaCost") and response["action"]["output"]["type"] == "act":
                    chosen_id = response["action"]["output"]["actionId"]
                    chosen_action = next(action for action in data["input"]["actions"] if action["id"] == chosen_id)
                    mechanics["submitted:" + chosen_action["type"]] += 1
                send(seat, "respond", {**response, "promptId": str(data["promptId"])}, "Expected integer")
                send(seat, "respond", {**response, "promptId": float(data["promptId"])}, "Expected integer")
                send(seat, "respond", {**response, "promptId": data["promptId"] + 1000}, "StalePrompt")
                send(seat, "respond", {**response, "action": {"type": "reorder", "output": {}}}, "WrongPromptType")
                if family == "chooseAction":
                    send(seat, "respond", {**response, "action": {"type": family, "output": {
                        "type": "act", "actionId": "not-offered"
                    }}}, "UnknownActionId")
                if family == "chooseObject":
                    send(seat, "respond", {**response, "action": {"type": family, "output": {
                        "type": "select", "target": {"kind": "card", "id": "not-offered"}
                    }}}, "UnknownObjectId")
                if family == "payManaCost":
                    send(seat, "respond", {**response, "action": {"type": family, "output": {
                        "type": "pay", "auto": True
                    }}}, "PaymentNotAvailable")
                if family == "chooseNumber":
                    if not data["input"].get("cancellable", True):
                        send(seat, "respond", {**response, "action": {"type": family, "output": {
                            "type": "numberDecision", "chosenNumber": None
                        }}}, "CancelNotAllowed")
                    send(seat, "respond", {**response, "action": {"type": family, "output": {
                        "type": "numberDecision", "chosenNumber": data["input"]["min"] - 1 if data["input"]["max"] == 2147483647 else data["input"]["max"] + 1
                    }}}, "Amount out of range")
                send(seat, "respond", response)
                send(seat, "respond", response, "StalePrompt")
            elif method == "compatibilityFinding":
                findings.append(data)
                if not answered or not rejections:
                    raise RuntimeError(f"Stopped before a prompt roundtrip: {data}")
                if data["code"] != args.expect_gap:
                    raise RuntimeError(f"Unexpected adapter boundary: {data}")
                break
            elif method == "callback":
                native_callbacks[data["callback"]] += 1
            elif method == "state":
                states += 1
                if human and seat == 0:
                    human.state(data)
                view = data["gameView"]
                own_id = next(player["id"] for player in view["players"] if player["name"] == f"mba{os.getpid()}_{seat}")
                minimum_life = min(minimum_life, *(player["life"] for player in view["players"]))
                combat_assignments += len(view["combatAssignments"])
                expected_names = {card["cardName"] for card in deck["cards"]}
                if args.scenario == "modal":
                    expected_names.update(["Goblin", "Goblin Token"])
                for zone in view["zones"]:
                    if zone["zone"] == "library" or (zone["zone"] == "hand" and zone["ownerId"] != own_id):
                        if zone["cards"]:
                            raise RuntimeError("Private zone disclosed")
                    for card in zone["cards"]:
                        if card["visibility"] == "visible":
                            name = card["identity"]["name"]
                            seen_names.add(name)
                            if zone["zone"] == "graveyard":
                                graveyard_names.add(name)
                            if name not in expected_names:
                                raise RuntimeError(f"Unexpected card printing: {name}")
            elif method == "gameEnded":
                result = data
                if args.expect_gap:
                    raise RuntimeError("Game ended before expected compatibility boundary")
                break
            elif method == "adapterError":
                raise RuntimeError(data)
        else:
            raise TimeoutError("No compatibility finding received")
        if result and not args.expect_gap and not human:
            if args.scenario not in ("modal", "color") and minimum_life >= 20:
                raise RuntimeError("Scenario completed without dealing damage")
            if args.scenario in ("combat", "blocking") and not mechanics["chooseObject:attack"]:
                raise RuntimeError("Scenario never declared attackers")
            if args.scenario == "blocking" and (not mechanics["chooseObject:block"] or not combat_assignments):
                raise RuntimeError("Scenario never assigned blockers")
            if args.scenario == "any-mana" and (not mechanics["payment:unclassified"] or "Lightning Bolt" not in graveyard_names):
                raise RuntimeError("Scenario never exercised non-basic mana payment and resolved a spell")
            if args.scenario == "echo" and not mechanics["payment:without-source"]:
                raise RuntimeError("Scenario never paid a resolution cost without an unpaid stack source")
            if args.scenario == "x-cost" and (not native_callbacks["GAME_GET_AMOUNT"] or "Fireball" not in graveyard_names):
                raise RuntimeError("Scenario never resolved an X-cost spell")
            if args.scenario == "color" and (not native_callbacks["GAME_CHOOSE_CHOICE"] or "Brave the Elements" not in graveyard_names):
                raise RuntimeError("Scenario never resolved a color-choice spell")
            if args.scenario == "modal" and (mechanics["chooseFromSelection"] < 2 or "You See a Pair of Goblins" not in graveyard_names):
                raise RuntimeError("Scenario never selected a spell mode")
            if args.scenario == "activated" and not mechanics["submitted:unclassified"]:
                raise RuntimeError("Scenario never selected an unclassified ability")
            if args.scenario == "manual-pool" and not mechanics["payment:spendMana"]:
                raise RuntimeError("Scenario never offered a manual pool choice")
            if args.scenario == "lethal" and min(player["life"] for player in result["players"]) > 0:
                raise RuntimeError("Scenario ended without lethal damage")
        print(json.dumps({"answered": answered, "rejected": rejections,
                          "superseded": superseded, "states": states, "result": result,
                          "mechanics": mechanics, "nativeCallbacks": native_callbacks, "combatAssignmentsObserved": combat_assignments,
                          "minimumLife": minimum_life, "cardsObserved": sorted(seen_names),
                          "graveyardCardsObserved": sorted(graveyard_names),
                          "findings": findings, "capture": str(args.capture)}, indent=2))
    finally:
        if human:
            human.finish(result is not None)
        for seat, game in joined_games:
            if clients[seat].poll() is None:
                send(seat, "concede", {"gameId": game})
        if table_id and clients[0].poll() is None:
            send(0, "removeTable", {"tableId": table_id})
        for process in clients:
            if process.poll() is None:
                process.stdin.close()
        for process in clients:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for log in logs:
            log.close()
        for agent in agents:
            agent.stdin.close()
            try:
                agent.wait(timeout=5)
            except subprocess.TimeoutExpired:
                agent.kill()
                agent.wait()

        if human:
            human.close()
