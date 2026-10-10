import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { binary: { type: "string" } } });
if (!values.binary) {
  const build = spawn("cargo", ["build", "-p", "manabrew-server"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  assert.equal((await once(build, "exit"))[0], 0);
}
const binary = resolve(
  values.binary ??
    join(
      process.env.CARGO_TARGET_DIR ?? "target",
      "debug",
      process.platform === "win32" ? "manabrew-server.exe" : "manabrew-server",
    ),
);
const directory = await mkdtemp(join(tmpdir(), "manabrew-journal-wire-"));
const secret = randomUUID(),
  password = randomUUID(),
  device = randomUUID();
const sockets = new Set();
let relay,
  stderr = "";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
const wsPort = await port(),
  healthPort = await port();
async function start(enabled) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(FORGE_|MANABREW_|SECRET_MANABREW_)/.test(key),
    ),
  );
  Object.assign(env, {
    FORGE_HOST: "127.0.0.1",
    FORGE_PORT: String(wsPort),
    FORGE_HEALTH_PORT: String(healthPort),
    SECRET_MANABREW_KEY: secret,
    MANABREW_SERVER_KEY: password,
  });
  if (enabled) env.MANABREW_JOURNAL_DB = join(directory, "journal.db");
  relay = spawn(binary, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  relay.stderr.on("data", (bytes) => {
    stderr = (stderr + bytes).slice(-8192);
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    assert.equal(relay.exitCode, null, stderr);
    const ready = await new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: healthPort });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ready) return;
    await pause(20);
  }
  throw new Error(`relay did not start: ${stderr}`);
}
async function stop() {
  for (const socket of sockets) socket.close();
  if (relay && relay.exitCode === null && relay.signalCode === null) {
    const exited = once(relay, "exit");
    relay.kill("SIGKILL");
    await exited;
  }
  relay = null;
}
async function client(username, service = false, identity = randomUUID()) {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  sockets.add(ws);
  const queue = [],
    history = [];
  let wake;
  ws.onmessage = ({ data }) => {
    const value = JSON.parse(data);
    queue.push(value);
    history.push(value);
    wake?.();
  };
  ws.onclose = () => {
    sockets.delete(ws);
    wake?.();
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (value) => ws.send(JSON.stringify(value));
  async function next(predicate) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return queue.splice(index, 1)[0];
      const error = queue.find((message) => message.type === "Error");
      assert(!error, JSON.stringify(error));
      assert.equal(
        ws.readyState,
        WebSocket.OPEN,
        `socket closed: ${JSON.stringify(history.slice(-3))}`,
      );
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 100);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    throw new Error(`response timed out: ${JSON.stringify(history.slice(-3))}: ${stderr}`);
  }
  send({
    type: "Authenticate",
    username,
    password,
    service,
    identity: { device: identity },
    client_version: "3.17.0",
    features: ["decision_journal_v1"],
  });
  const auth = await next((message) => message.type === "AuthResult");
  assert(auth.success, auth.error);
  return {
    auth,
    history,
    send,
    next,
    async journal(request, game = gameId, key = secret, handoff = undefined) {
      const request_id = randomUUID();
      send({
        type: "DecisionJournal",
        game_id: game,
        request_id,
        official_key: key,
        request,
        ...(handoff ? { handoff } : {}),
      });
      const reply = await next(
        (message) => message.type === "DecisionJournalResult" && message.request_id === request_id,
      );
      assert.equal(reply.game_id, game);
      if (reply.result.Err !== undefined) throw new Error(reply.result.Err);
      return JSON.parse(reply.result.Ok);
    },
  };
}
const gameId = randomUUID(),
  roomId = randomUUID();
const spec = {
  type: "ResumeRoom",
  room_id: roomId,
  resume_token: randomUUID(),
  room_name: "Journal probe",
  max_players: 2,
  format: "Commander",
  hosted: true,
  engine: "Forge",
  official_key: secret,
  player_order: ["alice", "bob"],
  player_decks: [],
  starting_life: 40,
  game_id: gameId,
};
const manifest = JSON.stringify({
  engine_sha256: "a".repeat(64),
  assets_sha256: "b".repeat(64),
  start_request: '{"seed":9223372036854775806,"decisionJournal":true}',
});
const open = { operation: "open", manifest };
const read = { operation: "read", after: 0, limit: 100 };
const entry = (sequence) => ({
  sequence,
  playerIndex: 0,
  prompt: { promptId: sequence },
  action: { type: "response", secretChoice: sequence },
});
const append = (epoch, sequence) => ({
  operation: "append",
  epoch,
  batch: JSON.stringify({ version: 1, nextSequence: sequence + 1, entries: [entry(sequence)] }),
});
async function resume(host, request = spec) {
  host.send(request);
  await host.next((message) => message.type === "RoomResumed");
}
try {
  await start(false);
  const disabled = await client("disabled", true);
  assert(!disabled.auth.features.includes("decision_journal_v1"));
  await assert.rejects(disabled.journal(open), /disabled/);
  await stop();
  await start(true);
  let host = await client("node-a", true, device);
  assert(host.auth.features.includes("decision_journal_v1"));
  assert(!host.auth.features.includes("host_handoff"), "checkpoint handoff must stay opt-in");
  await assert.rejects(host.journal(open), /denied/);
  await resume(host);
  const alice = await client("alice");
  alice.send({ type: "JoinRoom", room_id: roomId, observe: false });
  await alice.next((message) => message.type === "RoomUpdate" && message.room.room_id === roomId);
  await assert.rejects(alice.journal(open), /denied/);
  await assert.rejects(host.journal(open, gameId, "wrong-key"), /denied/);
  await assert.rejects(host.journal(open, randomUUID()), /denied/);
  assert.equal((await host.journal(open)).epoch, 1);
  assert.equal((await host.journal(open)).epoch, 1);
  assert.equal((await host.journal(append(1, 1))).sequence, 1);
  assert.equal((await host.journal(append(1, 1))).sequence, 1);
  assert.deepEqual((await host.journal(read)).entries, [entry(1)]);
  await assert.rejects(alice.journal(read), /denied/);
  const handoff = { room_id: roomId, resume_token: spec.resume_token };
  const taker = await client("node-taker", true);
  assert.deepEqual((await taker.journal(read, gameId, secret, handoff)).entries, [entry(1)]);
  await assert.rejects(
    taker.journal(read, gameId, secret, { ...handoff, resume_token: randomUUID() }),
    /denied/,
  );
  await assert.rejects(taker.journal(read, randomUUID(), secret, handoff), /denied/);
  await assert.rejects(taker.journal(open, gameId, secret, handoff), /denied/);
  await assert.rejects(taker.journal(append(1, 2), gameId, secret, handoff), /denied/);
  await assert.rejects(alice.journal(read, gameId, secret, handoff), /denied/);
  assert.equal((await host.journal(read)).position.epoch, 1, "a handoff read must not fence");
  const changed = {
    ...append(1, 1),
    batch: JSON.stringify({ version: 1, nextSequence: 2, entries: [{ ...entry(1), action: {} }] }),
  };
  await assert.rejects(host.journal(changed), /conflicting/);
  const other = await client("node-other", true);
  await resume(other, { ...spec, room_id: randomUUID(), resume_token: randomUUID() });
  await assert.rejects(other.journal(read));
  assert.equal((await other.journal(open)).epoch, 1);
  assert.equal((await other.journal(append(1, 1))).sequence, 1);
  assert.equal((await host.journal(read)).position.epoch, 1);
  const replacement = await client("node-a", true, device);
  await host.next((message) => message.type === "SessionTakenOver");
  host = replacement;
  assert.equal((await host.journal(open)).epoch, 2);
  await assert.rejects(host.journal(append(1, 2)), /stale/);
  assert.equal((await host.journal(append(2, 2))).sequence, 2);
  alice.send({ type: "Ping" });
  await alice.next((message) => message.type === "Pong");
  assert(
    alice.history
      .filter((message) => message.type === "DecisionJournalResult")
      .every((message) => message.result.Err !== undefined),
    "journal data leaked to a seat",
  );
  await stop();
  await start(true);
  host = await client("node-a", true, device);
  await resume(host);
  assert.deepEqual((await host.journal(read)).entries, [entry(1), entry(2)]);
  assert.equal((await host.journal(open)).epoch, 3);
  await assert.rejects(host.journal(append(2, 3)), /stale/);
  assert.equal((await host.journal(append(3, 3))).sequence, 3);
  const nextHost = await client("node-b", true);
  await resume(nextHost);
  const mismatched = JSON.parse(manifest);
  mismatched.assets_sha256 = "c".repeat(64);
  await assert.rejects(
    nextHost.journal({ ...open, manifest: JSON.stringify(mismatched) }),
    /another manifest/,
  );
  assert.equal((await nextHost.journal(read)).position.epoch, 3);
  assert.equal((await nextHost.journal(open)).epoch, 4);
  assert.equal((await nextHost.journal(append(4, 4))).sequence, 4);
  assert.deepEqual((await nextHost.journal(read)).entries, [
    entry(1),
    entry(2),
    entry(3),
    entry(4),
  ]);
  await assert.rejects(host.journal(append(3, 5)));
  const invalidation = {
    operation: "append",
    epoch: 4,
    batch: JSON.stringify({
      version: 1,
      nextSequence: 5,
      entries: [],
      unavailableReason: "snapshot restore",
    }),
  };
  assert.equal((await nextHost.journal(invalidation)).unavailable_reason, "snapshot restore");
  assert.equal((await nextHost.journal(invalidation)).unavailable_reason, "snapshot restore");
  await assert.rejects(nextHost.journal(append(4, 5)), /invalidated/);
  console.log(
    JSON.stringify(
      {
        persistedDecisions: 4,
        epochs: 4,
        authorization: "fleet secret + current hosted game owner",
        reconnect: "old epoch rejected",
        relayRestart: "durable history recovered",
        hostChange: "new writer fenced",
        handoffRead: "resume token reads only, without fencing",
        privacy: "no journal data sent to seats",
        disabled: "feature not advertised",
      },
      null,
      2,
    ),
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
