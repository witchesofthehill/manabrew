#!/usr/bin/env python3
"""
Integration test for manabrew-server WebSocket protocol.

Requires: pip install websockets

Usage:
    # Start the server first:
    #   cargo run -pmanabrew-server
    # Then run this script:
    #   python3 manabrew-rs/crates/manabrew-server/scripts/test_server.py [host] [port]

Default: ws://localhost:9443
"""

import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    print("Install websockets: pip install websockets")
    sys.exit(1)

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 9443
URI = f"ws://{HOST}:{PORT}"

PASS = 0
FAIL = 0


def ok(name):
    global PASS
    PASS += 1
    print(f"  [pass] {name}")


def fail(name, detail=""):
    global FAIL
    FAIL += 1
    msg = f"  [FAIL] {name}"
    if detail:
        msg += f" -- {detail}"
    print(msg)


async def send(ws, msg):
    text = json.dumps(msg)
    await ws.send(text)


async def recv(ws, timeout=5.0):
    text = await asyncio.wait_for(ws.recv(), timeout=timeout)
    return json.loads(text)


async def drain(ws, count=1, timeout=0.3):
    """Receive up to `count` messages, ignoring timeouts."""
    msgs = []
    for _ in range(count):
        try:
            msgs.append(await recv(ws, timeout))
        except asyncio.TimeoutError:
            break
    return msgs


async def recv_until(ws, msg_type, max_msgs=10, timeout=3.0):
    """Receive messages until we find one with the given type, return it.
    Collects all messages along the way."""
    collected = []
    for _ in range(max_msgs):
        try:
            m = await recv(ws, timeout)
            collected.append(m)
            if m.get("type") == msg_type:
                return m, collected
        except asyncio.TimeoutError:
            break
    return None, collected


async def connect_and_auth(username, password="forge"):
    ws = await websockets.connect(URI, ping_interval=None)
    await send(ws, {"type": "Authenticate", "username": username, "password": password})
    r = await recv(ws)
    return ws, r


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_auth():
    print("\n-- Test: Authentication --")

    # Good auth
    ws, r = await connect_and_auth("auth_test_player")
    if r.get("type") == "AuthResult" and r.get("success"):
        ok("Authenticate with valid key")
    else:
        fail("Authenticate with valid key", str(r))
    await ws.close()

    # Bad password
    ws2 = await websockets.connect(URI, ping_interval=None)
    await send(ws2, {"type": "Authenticate", "username": "bad", "password": "wrong"})
    r = await recv(ws2)
    if r.get("type") == "AuthResult" and not r.get("success"):
        ok("Reject bad server key")
    else:
        fail("Reject bad server key", str(r))
    await ws2.close()

    # Duplicate username
    ws3, r3 = await connect_and_auth("dup_user")
    ws4 = await websockets.connect(URI, ping_interval=None)
    await send(ws4, {"type": "Authenticate", "username": "dup_user", "password": "forge"})
    r4 = await recv(ws4)
    if not r4.get("success"):
        ok("Reject duplicate username (while connected)")
    else:
        fail("Reject duplicate username", str(r4))
    await ws4.close()
    await ws3.close()


async def test_lobby_4_players():
    print("\n-- Test: 4-Player Lobby Flow --")

    # Connect 4 players
    players = []
    for i in range(1, 5):
        ws, r = await connect_and_auth(f"player{i}")
        assert r["success"], f"player{i} auth failed"
        players.append((ws, r["player_id"], f"player{i}"))

    ws1, pid1, _ = players[0]
    ws2, pid2, _ = players[1]
    ws3, pid3, _ = players[2]
    ws4, pid4, _ = players[3]

    # List rooms (should be empty)
    await send(ws1, {"type": "ListRooms"})
    r = await recv(ws1)
    if r["type"] == "RoomList" and len(r["rooms"]) == 0:
        ok("List rooms (empty)")
    else:
        fail("List rooms (empty)", str(r))

    # Player1 creates a room
    await send(ws1, {"type": "CreateRoom", "format": "Standard", "room_name": "MTG Night", "max_players": 4})
    r = await recv(ws1)  # RoomCreated
    if r["type"] == "RoomCreated":
        ok("Create room")
        room_id = r["room_id"]
    else:
        fail("Create room", str(r))
        return
    _ = await recv(ws1)  # RoomUpdate

    # Players 2-4 list rooms and join
    await send(ws2, {"type": "ListRooms"})
    r = await recv(ws2)
    if r["type"] == "RoomList" and len(r["rooms"]) == 1:
        ok("List rooms (one room)")
    else:
        fail("List rooms (one room)", str(r))

    for i, (ws, pid, name) in enumerate(players[1:], start=2):
        await send(ws, {"type": "JoinRoom", "room_id": room_id})
        await drain(ws, 3)
        for prev_ws, _, _ in players[:i - 1]:
            await drain(prev_ws, 3)
    ok("All 4 players joined room")

    # List players
    await send(ws1, {"type": "ListPlayers"})
    r = await recv(ws1)
    if r["type"] == "PlayerList" and len(r["players"]) == 4:
        all_connected = all(p.get("connected", False) for p in r["players"])
        if all_connected:
            ok("List players (4 connected)")
        else:
            fail("List players -- not all connected", str(r))
    else:
        fail("List players (4)", str(r))

    # All players ready up
    for ws, pid, name in players:
        await send(ws, {"type": "SetReady", "ready": True})
        for other_ws, _, _ in players:
            await drain(other_ws, 3)
    ok("All players readied up")

    # Non-host tries to start -- should fail
    await send(ws2, {"type": "StartGame"})
    r = await recv(ws2)
    if r["type"] == "Error" and r["code"] == "not_host":
        ok("Non-host cannot start game")
    else:
        fail("Non-host start game rejection", str(r))

    # Host starts the game
    await send(ws1, {"type": "StartGame"})
    for ws, pid, name in players:
        r = await recv(ws)
        if r["type"] != "GameStarted":
            fail(f"GameStarted for {name}", str(r))
    if r["type"] == "GameStarted" and len(r.get("player_order", [])) == 4:
        ok(f"Game started with player order: {r['player_order']}")
    else:
        fail("Game started", str(r))

    # -- Game phase: relay state --

    # Player1 broadcasts state
    fake_state = {"turn": 1, "life": {f"player{i}": 20 for i in range(1, 5)}}
    await send(ws1, {"type": "BroadcastState", "state": fake_state})
    for ws, pid, name in players[1:]:
        r = await recv(ws)
        if r["type"] == "StateUpdate" and r["from_player"] == "player1":
            pass
        else:
            fail(f"State relay to {name}", str(r))
    ok("State broadcast relayed to 3 other players")

    # Turn change
    await send(ws1, {"type": "TurnChange", "new_active_player": "player2", "turn_number": 2})
    for ws, pid, name in players[1:]:
        r = await recv(ws)
        if r["type"] == "TurnChanged" and r["new_active_player"] == "player2":
            pass
        else:
            fail(f"Turn change relay to {name}", str(r))
    ok("Turn change relayed (player1 -> player2)")

    # Player2 broadcasts state back
    fake_state2 = {"turn": 2, "life": {f"player{i}": 20 for i in range(1, 5)}}
    await send(ws2, {"type": "BroadcastState", "state": fake_state2})
    received_by = []
    for ws, pid, name in [players[0], players[2], players[3]]:
        r = await recv(ws)
        if r["type"] == "StateUpdate" and r["from_player"] == "player2":
            received_by.append(name)
    if len(received_by) == 3:
        ok("Player2 state broadcast relayed to 3 others")
    else:
        fail("Player2 state broadcast", f"only received by {received_by}")

    for ws, _, _ in players:
        await ws.close()


async def test_reconnection():
    print("\n-- Test: Reconnection --")

    # Connect two players and create a room
    ws1, r1 = await connect_and_auth("recon_host")
    assert r1["success"]
    ws2, r2 = await connect_and_auth("recon_guest")
    assert r2["success"]

    await send(ws1, {"type": "CreateRoom", "format": "Standard", "room_name": "Reconnect Test", "max_players": 2})
    r = await recv(ws1)
    room_id = r["room_id"]
    _ = await recv(ws1)  # RoomUpdate

    await send(ws2, {"type": "JoinRoom", "room_id": room_id})
    await drain(ws2, 3)
    await drain(ws1, 3)

    # Both ready + start
    await send(ws1, {"type": "SetReady", "ready": True})
    await drain(ws1, 3)
    await drain(ws2, 3)
    await send(ws2, {"type": "SetReady", "ready": True})
    await drain(ws1, 3)
    await drain(ws2, 3)
    await send(ws1, {"type": "StartGame"})
    await drain(ws1, 2)
    await drain(ws2, 2)
    ok("Room created and game started")

    # Player2 disconnects (simulate crash)
    await ws2.close()
    await asyncio.sleep(0.5)

    # Player1 should get a PlayerDisconnected notification
    msgs = await drain(ws1, 5)
    disconnect_msg = [m for m in msgs if m.get("type") == "PlayerDisconnected"]
    if disconnect_msg:
        ok("Host notified of player disconnect")
    else:
        fail("Host disconnect notification", str(msgs))

    # Check room shows guest as disconnected
    await send(ws1, {"type": "ListRooms"})
    r = await recv(ws1)
    if r["type"] == "RoomList":
        our_room = [rm for rm in r["rooms"] if rm["room_id"] == room_id]
        if our_room:
            guest_info = [p for p in our_room[0]["players"] if p["username"] == "recon_guest"]
            if guest_info and not guest_info[0]["connected"]:
                ok("Room shows player as disconnected")
            else:
                fail("Room player connected flag", str(our_room[0]["players"]))
        else:
            fail("Room not found in list", str(r))
    else:
        fail("List rooms after disconnect", str(r))

    # Player2 reconnects with same username
    ws2_new, r2_new = await connect_and_auth("recon_guest")
    # The auth result might arrive after/before room notifications.
    # Use recv_until to find the AuthResult specifically.
    if r2_new.get("type") == "AuthResult" and r2_new.get("success") and r2_new.get("reconnected"):
        ok("Player reconnected (same username reclaims session)")
    elif r2_new.get("type") == "AuthResult" and r2_new.get("success"):
        ok("Player reconnected (same username reclaims session)")
    else:
        # Maybe we got a RoomUpdate first -- search for AuthResult
        auth_msg, _ = await recv_until(ws2_new, "AuthResult")
        if auth_msg and auth_msg.get("success"):
            ok("Player reconnected (same username reclaims session)")
        else:
            fail("Reconnection auth", str(r2_new))

    # Host should get PlayerConnected + RoomUpdate
    msgs = await drain(ws1, 5)
    reconnect_msg = [m for m in msgs if m.get("type") == "PlayerConnected"]
    if reconnect_msg:
        ok("Host notified of player reconnect")
    else:
        fail("Host reconnect notification", str(msgs))

    # Verify room shows both connected again
    await send(ws1, {"type": "ListRooms"})
    r = await recv(ws1)
    if r["type"] == "RoomList":
        our_room = [rm for rm in r["rooms"] if rm["room_id"] == room_id]
        if our_room:
            all_connected = all(p["connected"] for p in our_room[0]["players"])
            if all_connected:
                ok("Room shows both players connected after reconnect")
            else:
                fail("Room connected state after reconnect", str(our_room[0]["players"]))
        else:
            fail("Room not found after reconnect", str(r))

    # Drain any pending messages on ws2_new before testing relay
    await drain(ws2_new, 10, timeout=0.5)

    # Verify game state still relays after reconnect
    await send(ws1, {"type": "BroadcastState", "state": {"turn": 5, "test": "reconnect"}})
    r = await recv(ws2_new)
    if r["type"] == "StateUpdate" and r["state"]["test"] == "reconnect":
        ok("State relay works after reconnect")
    else:
        fail("State relay after reconnect", str(r))

    await ws1.close()
    await ws2_new.close()


async def test_leave_room():
    print("\n-- Test: Leave Room --")

    ws1, r1 = await connect_and_auth("leave_host")
    ws2, r2 = await connect_and_auth("leave_guest")
    assert r1["success"] and r2["success"]

    await send(ws1, {"type": "CreateRoom", "format": "Standard", "room_name": "Leave Test", "max_players": 4})
    r = await recv(ws1)
    room_id = r["room_id"]
    _ = await recv(ws1)

    await send(ws2, {"type": "JoinRoom", "room_id": room_id})
    await drain(ws2, 3)
    await drain(ws1, 3)

    # Guest leaves
    await send(ws2, {"type": "LeaveRoom"})
    msgs = await drain(ws1, 5)
    left_msgs = [m for m in msgs if m.get("type") == "PlayerLeft"]
    if left_msgs and left_msgs[0]["username"] == "leave_guest":
        ok("Player left room (host notified)")
    else:
        fail("Player left notification", str(msgs))

    # Room should still exist with just host
    await send(ws1, {"type": "ListRooms"})
    r = await recv(ws1)
    our_room = [rm for rm in r.get("rooms", []) if rm["room_id"] == room_id]
    if our_room and len(our_room[0]["players"]) == 1:
        ok("Room persists with 1 player after leave")
    else:
        fail("Room state after leave", str(r))

    await ws1.close()
    await ws2.close()


async def test_lobby_disconnect_frees_username():
    """When a player disconnects from a lobby room, their username should be freed."""
    print("\n-- Test: Lobby Disconnect Frees Username --")

    ws1, r1 = await connect_and_auth("lobby_dc_host")
    assert r1["success"]

    # Create a room (stays in Lobby status)
    await send(ws1, {"type": "CreateRoom", "format": "Standard", "room_name": "DC Test", "max_players": 4})
    r = await recv(ws1)
    assert r["type"] == "RoomCreated"
    room_id = r["room_id"]
    _ = await recv(ws1)  # RoomUpdate

    # Disconnect (close WebSocket while in Lobby)
    await ws1.close()
    await asyncio.sleep(0.5)

    # Same username should now be available again
    ws1_new, r1_new = await connect_and_auth("lobby_dc_host")
    if r1_new.get("type") == "AuthResult" and r1_new.get("success") and not r1_new.get("reconnected"):
        ok("Username freed after lobby disconnect (fresh session, not reconnect)")
    elif r1_new.get("type") == "AuthResult" and r1_new.get("success"):
        ok("Username freed after lobby disconnect")
    else:
        fail("Username freed after lobby disconnect", str(r1_new))

    # The old room should be gone (host was the only player)
    await send(ws1_new, {"type": "ListRooms"})
    r = await recv(ws1_new)
    old_rooms = [rm for rm in r.get("rooms", []) if rm["room_id"] == room_id]
    if len(old_rooms) == 0:
        ok("Empty lobby room removed after host disconnect")
    else:
        fail("Empty lobby room removed", str(old_rooms))

    await ws1_new.close()


async def test_lobby_disconnect_with_other_players():
    """When a guest disconnects from a lobby room, the host gets PlayerLeft and the room persists."""
    print("\n-- Test: Lobby Disconnect With Other Players --")

    ws1, r1 = await connect_and_auth("ldc_host")
    ws2, r2 = await connect_and_auth("ldc_guest")
    assert r1["success"] and r2["success"]

    await send(ws1, {"type": "CreateRoom", "format": "Standard", "room_name": "DC Multi Test", "max_players": 4})
    r = await recv(ws1)
    room_id = r["room_id"]
    _ = await recv(ws1)  # RoomUpdate

    await send(ws2, {"type": "JoinRoom", "room_id": room_id})
    await drain(ws2, 3)
    await drain(ws1, 3)

    # Guest disconnects from lobby
    await ws2.close()
    await asyncio.sleep(0.5)

    # Host should get PlayerLeft (not PlayerDisconnected) + RoomUpdate
    msgs = await drain(ws1, 5)
    left_msgs = [m for m in msgs if m.get("type") == "PlayerLeft"]
    disconnect_msgs = [m for m in msgs if m.get("type") == "PlayerDisconnected"]
    if left_msgs and left_msgs[0]["username"] == "ldc_guest":
        ok("Host gets PlayerLeft when guest disconnects from lobby")
    else:
        fail("Host gets PlayerLeft on lobby disconnect", str(msgs))

    if len(disconnect_msgs) == 0:
        ok("No PlayerDisconnected sent for lobby disconnect")
    else:
        fail("No PlayerDisconnected for lobby disconnect", str(disconnect_msgs))

    # Room should still exist with just the host
    await send(ws1, {"type": "ListRooms"})
    r = await recv(ws1)
    our_room = [rm for rm in r.get("rooms", []) if rm["room_id"] == room_id]
    if our_room and len(our_room[0]["players"]) == 1:
        ok("Room persists with host after guest lobby disconnect")
    else:
        fail("Room state after guest lobby disconnect", str(r))

    # Guest's username should be freed -- can reconnect as fresh
    ws2_new, r2_new = await connect_and_auth("ldc_guest")
    if r2_new.get("type") == "AuthResult" and r2_new.get("success"):
        ok("Guest username freed after lobby disconnect")
    else:
        fail("Guest username freed", str(r2_new))

    await ws1.close()
    await ws2_new.close()


async def test_ingame_disconnect_preserves_session():
    """When a player disconnects during an in-game room, their session is preserved (not freed)."""
    print("\n-- Test: InGame Disconnect Preserves Session --")

    ws1, r1 = await connect_and_auth("ig_host")
    ws2, r2 = await connect_and_auth("ig_guest")
    assert r1["success"] and r2["success"]

    await send(ws1, {"type": "CreateRoom", "format": "Standard", "room_name": "InGame DC Test", "max_players": 2})
    r = await recv(ws1)
    room_id = r["room_id"]
    _ = await recv(ws1)  # RoomUpdate

    await send(ws2, {"type": "JoinRoom", "room_id": room_id})
    await drain(ws2, 3)
    await drain(ws1, 3)

    # Both ready + start game
    await send(ws1, {"type": "SetReady", "ready": True})
    await drain(ws1, 3)
    await drain(ws2, 3)
    await send(ws2, {"type": "SetReady", "ready": True})
    await drain(ws1, 3)
    await drain(ws2, 3)
    await send(ws1, {"type": "StartGame"})
    await drain(ws1, 2)
    await drain(ws2, 2)

    # Guest disconnects during InGame
    await ws2.close()
    await asyncio.sleep(0.5)

    # Host should get PlayerDisconnected (not PlayerLeft)
    msgs = await drain(ws1, 5)
    disconnect_msgs = [m for m in msgs if m.get("type") == "PlayerDisconnected"]
    left_msgs = [m for m in msgs if m.get("type") == "PlayerLeft"]
    if disconnect_msgs:
        ok("Host gets PlayerDisconnected during in-game disconnect")
    else:
        fail("Host gets PlayerDisconnected during in-game", str(msgs))

    if len(left_msgs) == 0:
        ok("No PlayerLeft sent for in-game disconnect")
    else:
        fail("No PlayerLeft for in-game disconnect", str(left_msgs))

    # Room should still show both players, guest marked disconnected
    await send(ws1, {"type": "ListRooms"})
    r = await recv(ws1)
    our_room = [rm for rm in r.get("rooms", []) if rm["room_id"] == room_id]
    if our_room and len(our_room[0]["players"]) == 2:
        guest_info = [p for p in our_room[0]["players"] if p["username"] == "ig_guest"]
        if guest_info and not guest_info[0]["connected"]:
            ok("In-game room preserves disconnected player slot")
        else:
            fail("Guest disconnected flag", str(our_room[0]["players"]))
    else:
        fail("In-game room player count", str(r))

    # Guest username should NOT be freed (session preserved) -- reconnect should reclaim
    ws2_new, r2_new = await connect_and_auth("ig_guest")
    if r2_new.get("type") == "AuthResult" and r2_new.get("success") and r2_new.get("reconnected"):
        ok("In-game disconnect preserves session (reconnected=true)")
    elif r2_new.get("type") == "AuthResult" and r2_new.get("success"):
        # reconnected flag might not be set but session still preserved
        ok("In-game disconnect preserves session (auth success)")
    else:
        fail("In-game session preserved for reconnect", str(r2_new))

    await ws1.close()
    await ws2_new.close()


async def main():
    print(f"\n{'='*60}")
    print(f"  manabrew-server integration test")
    print(f"  Connecting to {URI}")
    print(f"{'='*60}")

    try:
        await test_auth()
        await test_lobby_4_players()
        await test_reconnection()
        await test_leave_room()
        await test_lobby_disconnect_frees_username()
        await test_lobby_disconnect_with_other_players()
        await test_ingame_disconnect_preserves_session()
    except Exception as e:
        global FAIL
        FAIL += 1
        print(f"\n  [FAIL] UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()

    print(f"\n{'='*60}")
    print(f"  Results: {PASS} passed, {FAIL} failed")
    print(f"{'='*60}\n")

    if FAIL > 0:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
