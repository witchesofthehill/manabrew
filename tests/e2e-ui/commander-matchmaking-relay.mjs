import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openSync, closeSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
const port = Number(process.env.MATCHMAKING_TEST_PORT || 19514);
const logPath = join(mkdtempSync(join(tmpdir(), "matchmaking-relay-")), "relay.log");
console.log(`Relay log: ${logPath}`);
const log = openSync(logPath, "w");
const relay = spawn("target/debug/manabrew-server", [], {
  env: {
    ...process.env,
    FORGE_HOST: "127.0.0.1",
    FORGE_PORT: String(port),
    FORGE_HEALTH_PORT: String(port + 1),
    MANABREW_SERVER_KEY: "pr1214-local",
    MANABREW_LAN_ADVERTISE: "false",
  },
  stdio: ["ignore", log, log],
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
let sequence = 0;
async function client(service = false) {
  const name = `Test${++sequence}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  ws.addEventListener("message", (e) => messages.push(JSON.parse(e.data)));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const c = {
    name,
    ws,
    messages,
    send(type, fields = {}) {
      ws.send(JSON.stringify({ type, ...fields }));
    },
    async wait(type, predicate = () => true, timeout = 7000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const i = messages.findIndex((m) => m.type === type && predicate(m));
        if (i >= 0) return messages.splice(i, 1)[0];
        await pause(20);
      }
      throw Error(`${name}: timeout ${type}: ${JSON.stringify(messages).slice(-1500)}`);
    },
    async absent(type, ms = 1200) {
      await pause(ms);
      assert(!messages.some((m) => m.type === type), `${name} unexpectedly received ${type}`);
    },
    clear() {
      messages.length = 0;
    },
  };
  clients.push(c);
  c.send("Authenticate", {
    username: name,
    password: "pr1214-local",
    service,
    engine_gate: "in_browser",
    client_platform: "web",
  });
  const auth = await c.wait("AuthResult");
  assert(auth.success, JSON.stringify(auth));
  c.clear();
  return c;
}
const deck = (name, bracket = 3) => ({
  deck_name: name,
  bracket,
  commander_name: "Lathril, Blade of the Elves",
  deck: { name, format: "commander", cards: [], sideboard: [] },
});
async function queue(c, decks = [deck("First")], sizes = [2], can_host = true) {
  c.send("EnterQueue", { format: "Commander", pod_sizes: sizes, decks, can_host });
  await c.wait("QueueStatus", (m) => m.queued);
}
async function room(c, fields = {}) {
  c.send("CreateRoom", {
    room_name: "Validation table",
    max_players: 2,
    format: "Commander",
    engine: "Forge",
    protocol_version: 6,
    ...fields,
  });
  return (await c.wait("RoomCreated")).room;
}
async function cleanup() {
  for (const c of clients.splice(0)) {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.send("LeaveQueue");
      c.send("LeaveRoom");
      c.ws.close();
    }
  }
  await pause(200);
}
async function test(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } finally {
    await cleanup();
  }
}
try {
  for (let i = 0; i < 100; i++) {
    const ready = await new Promise((resolve) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ready) break;
    if (i === 99) throw Error("relay failed to start");
    await pause(100);
  }
  await test("invalid queue rejected", async () => {
    const a = await client();
    a.send("EnterQueue", {
      format: "Commander",
      pod_sizes: [1],
      decks: [deck("A")],
      can_host: true,
    });
    assert.equal((await a.wait("Error")).code, "invalid_queue");
  });
  await test("multi-deck choice, busy player, browser room, shared auto-start, start signal", async () => {
    const a = await client(),
      b = await client();
    a.send("SetLocalGame", { kind: "Singleplayer" });
    await queue(a, [deck("Same name"), deck("Same name"), deck("Wrong bracket", 5)]);
    await queue(b);
    await a.wait("MatchProposal");
    await b.wait("MatchProposal");
    a.send("AcceptMatch", { deck_index: 2 });
    assert.equal((await a.wait("Error")).code, "invalid_queue");
    a.send("AcceptMatch", { deck_index: 1 });
    b.send("AcceptMatch", { deck_index: 0 });
    await a.absent("MatchFound");
    a.send("SetLocalGame", { kind: null });
    const match = await a.wait("MatchFound");
    await b.wait("MatchFound");
    assert.equal(match.room.auto_start, true);
    assert.equal(match.room.players.length, 2);
    assert(match.room.players.every((p) => p.ready && p.selected_deck_name));
    const host = match.room.host === a.name ? a : b,
      guest = host === a ? b : a;
    guest.send("SetAutoStart", { enabled: false });
    await guest.wait("Error");
    host.clear();
    guest.clear();
    host.send("SetAutoStart", { enabled: false });
    assert.equal((await guest.wait("RoomUpdate")).room.auto_start, false);
    host.send("StartGame");
    await host.wait("GameStarted");
    await guest.wait("GameStarted");
  });
  await test("decline and disconnect requeue remaining player", async () => {
    const a = await client(),
      b = await client();
    await queue(a);
    await queue(b);
    await a.wait("MatchProposal");
    await b.wait("MatchProposal");
    a.send("DeclineMatch");
    await b.wait("QueueStatus", (m) => m.queued);
    const c = await client();
    await queue(c);
    await b.wait("MatchProposal");
    await c.wait("MatchProposal");
    c.ws.close();
    await b.wait("QueueStatus", (m) => m.queued);
  });
  await test("node room preferred, empty room size restored", async () => {
    const node = await client(true);
    const pool = await room(node, { hosted: true, max_players: 4, format: "Any" });
    const a = await client(),
      b = await client();
    await queue(a);
    await queue(b);
    await a.wait("MatchProposal");
    await b.wait("MatchProposal");
    a.send("AcceptMatch");
    b.send("AcceptMatch");
    const match = await a.wait("MatchFound");
    await b.wait("MatchFound");
    assert.equal(match.room.room_id, pool.room_id);
    assert.equal(match.room.max_players, 2);
    assert.equal(match.room.hosted, true);
    assert.equal(match.room.format, "Commander");
    a.send("LeaveRoom");
    b.send("LeaveRoom");
    await pause(200);
    node.send("ListRooms");
    const restored = (await node.wait("RoomList")).rooms.find((r) => r.room_id === pool.room_id);
    assert.equal(restored.max_players, 4);
    assert.equal(restored.players.length, 0);
    assert.equal(restored.matchmade_bracket ?? null, null);
  });
  await test("open table invites matching bracket, chosen deck, decline keeps search", async () => {
    const host = await client();
    const table = await room(host, { max_players: 4 });
    host.send("AnnounceTable", { bracket: 3 });
    await host.wait("RoomUpdate", (m) => m.room.table_bracket === 3);
    const a = await client(),
      b = await client(),
      other = await client();
    await queue(a, [deck("First"), deck("Second")], [4], false);
    await queue(b, [deck("B")], [4], false);
    await queue(other, [deck("B2", 2)], [4], false);
    await a.wait("TableCall");
    await b.wait("TableCall");
    await other.absent("TableCall");
    b.send("AnswerTableCall", { room_id: table.room_id, join: false });
    a.send("AnswerTableCall", { room_id: table.room_id, join: true, deck_index: 1 });
    const match = await a.wait("MatchFound");
    assert.equal(match.deck_name, "Second");
    assert.equal(match.room.room_id, table.room_id);
    b.send("ListPlayers");
    await b.wait("PlayerList");
    await b.wait("QueueStatus", (m) => m.queued, 7000);
  });
  await test("private tables default manual and reject queue recruitment", async () => {
    const host = await client();
    const table = await room(host, { password: "private" });
    assert.equal(table.auto_start, false);
    host.send("AnnounceTable", { bracket: 3 });
    host.send("ListRooms");
    assert.equal(
      (await host.wait("RoomList")).rooms.find((r) => r.room_id === table.room_id).table_bracket ??
        null,
      null,
    );
  });
  await test("proposal timeout removes silent player and requeues accepter", async () => {
    const a = await client(),
      b = await client();
    await queue(a);
    await queue(b);
    await a.wait("MatchProposal");
    await b.wait("MatchProposal");
    a.send("AcceptMatch");
    await a.wait("QueueStatus", (m) => m.queued, 34000);
    await b.wait("QueueStatus", (m) => !m.queued);
  });
  await test("bracket offers and bot fill require explicit acceptance", async () => {
    const a = await client(),
      b = await client();
    await queue(a, [deck("A")], [4]);
    await queue(b, [deck("B")], [4]);
    await a.wait("QueueStepOffer", () => true, 34000);
    await a.wait("QueueBotFillOffer");
    await b.wait("QueueBotFillOffer");
    a.send("AcceptBotFill");
    await a.absent("MatchProposal");
    b.send("AcceptBotFill");
    await a.wait("MatchProposal");
    await b.wait("MatchProposal");
    a.send("AcceptMatch");
    b.send("AcceptMatch");
    const match = await a.wait("MatchFound");
    assert.equal(match.room.matchmade_bot_fill, true);
    assert.equal(match.room.max_players, 4);
    assert.equal(match.room.players.length, 2);
  });
  console.log("All relay matchmaking scenarios passed");
} finally {
  await cleanup();
  relay.kill("SIGTERM");
  closeSync(log);
}
