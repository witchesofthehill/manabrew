import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { WebSocket, WebSocketServer } from "ws";
import { scriptedAnswer } from "./journal-fixture.mjs";
import { verifyRelayJournal } from "./verify-relay-journal.mjs";

const { values } = parseArgs({
  options: {
    node: { type: "string" },
    relay: { type: "string" },
    jar: { type: "string" },
    "forge-home": { type: "string" },
    "java-home": { type: "string" },
    "engine-artifact": { type: "string" },
    "jvm-node": { type: "string" },
  },
});
assert(
  values.node && values.relay && values.jar && values["forge-home"],
  "--node, --relay, --jar and --forge-home are required",
);
const directory = await mkdtemp(join(tmpdir(), "manabrew-hosted-journal-"));
const database = join(directory, "journal.db");
const secret = randomUUID(),
  password = randomUUID();
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(SELF_HOSTED_NODE_|FORGE_|MANABREW_|MANA_BREW_|SECRET_MANABREW_)/.test(key),
  ),
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failure,
  relay,
  node,
  roomId,
  gameId,
  restart,
  outputs = 0,
  through = -1;
let logs = "",
  allowAnswers = true,
  restartPrompt = false,
  handedOff = false;
const sockets = new Set(),
  pending = new Map(),
  attempts = new Map(),
  held = new Set();
const epochs = new Set();
const seats = [0, 1].map((index) => ({
  name: `journal-seat-${index}`,
  identity: randomUUID(),
  answered: new Set(),
  messages: [],
  afterChange: [],
}));
function capture(child) {
  child.output = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (bytes) => {
      logs = (logs + bytes).slice(-16000);
      child.output = (child.output + bytes).slice(-64000);
    });
  child.on("error", (error) => {
    failure = error;
  });
  return child;
}
async function until(predicate, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (failure) throw failure;
    assert(Date.now() < end, `${label} timed out\n${logs}`);
    if (node) assert.equal(node.exitCode, null, logs);
    await pause(20);
  }
}
async function port() {
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const value = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return value;
}
const relayPort = await port(),
  healthPort = await port();
async function startRelay() {
  relay = capture(
    spawn(resolve(values.relay), [], {
      env: {
        ...cleanEnv,
        FORGE_HOST: "127.0.0.1",
        FORGE_PORT: String(relayPort),
        FORGE_HEALTH_PORT: String(healthPort),
        SECRET_MANABREW_KEY: secret,
        MANABREW_SERVER_KEY: password,
        MANABREW_JOURNAL_DB: database,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    ready = await new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: healthPort });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (!ready) await pause(20);
  }
  assert(ready, logs);
}
function spawnNode(relayUrl, jar, binary = values.node) {
  return capture(
    spawn(resolve(binary), [], {
      env: {
        ...cleanEnv,
        SELF_HOSTED_NODE_ENGINE_BACKEND: "forge",
        SELF_HOSTED_NODE_RELAY_URL: relayUrl,
        SELF_HOSTED_NODE_SERVER_KEY: password,
        SELF_HOSTED_NODE_OFFICIAL_KEY: secret,
        SELF_HOSTED_NODE_DECISION_JOURNAL: "1",
        SELF_HOSTED_NODE_BOT_ENABLED: "0",
        SELF_HOSTED_NODE_AUTO_START: "0",
        SELF_HOSTED_NODE_MAX_PLAYERS: "2",
        SELF_HOSTED_NODE_FORMAT: "standard",
        SELF_HOSTED_NODE_STATE_DELTA: "0",
        SELF_HOSTED_NODE_RECONNECT_TIMEOUT_S: "300",
        SELF_HOSTED_NODE_FORGE_HARNESS_JAR: jar,
        SELF_HOSTED_NODE_FORGE_ASSETS_DIR: resolve(values["forge-home"]),
        ...(values["java-home"]
          ? { SELF_HOSTED_NODE_JAVA_HOME: resolve(values["java-home"]) }
          : {}),
        RUST_LOG: "self_hosted_node=info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}
const takeovers = [];
async function stop(child, signal = "SIGKILL") {
  if (child?.signalCode === "SIGSTOP" || child?.stopped) child.kill("SIGCONT");
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill(signal);
    await exited;
  }
}
function position() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db
      .prepare("SELECT game_id, epoch, sequence, manifest, unavailable_reason FROM engine_journals")
      .get();
  } finally {
    db.close();
  }
}
function send(socket, value) {
  socket.send(JSON.stringify(value));
}
function answer(seat, prompt) {
  if (seat.answered.has(prompt.promptId)) return;
  seat.answered.add(prompt.promptId);
  for (let duplicate = 0; duplicate < 2; duplicate++) {
    send(seat.socket, {
      type: "BroadcastState",
      state: {
        kind: "response",
        fromPlayer: seat.slot,
        promptId: prompt.promptId,
        action: scriptedAnswer({ prompt }),
      },
    });
  }
}
async function joinSeat(seat, initial = false) {
  const socket = new WebSocket(`ws://127.0.0.1:${relayPort}`);
  sockets.add(socket);
  seat.socket = socket;
  seat.joined = false;
  seat.auth = false;
  seat.answered.clear();
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
  socket.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      seat.messages.push(message);
      if (message.type === "AuthResult") {
        assert(message.success, JSON.stringify(message));
        seat.auth = true;
      }
      if (message.type === "RoomUpdate" && message.room.room_id === roomId) {
        seat.joined ||= message.room.players.some(
          (player) => player.username === seat.name && player.connected,
        );
        seat.room = message.room;
      }
      if (message.type === "GameStarted") {
        gameId = message.game_id;
        seat.slot = `player-${message.player_order.indexOf(seat.name)}`;
      }
      if (message.type === "HostChanged") seat.hostChanged = message;
      const state = message.type === "StateUpdate" ? message.state : null;
      if (state && seat.hostChanged) seat.afterChange.push(message);
      if (state?.kind === "prompt" && state.forPlayer === seat.slot) {
        seat.prompt = state.prompt;
        if (allowAnswers) answer(seat, state.prompt);
      }
    } catch (error) {
      failure = error;
    }
  });
  await once(socket, "open");
  send(socket, {
    type: "Authenticate",
    username: seat.name,
    password,
    identity: { device: seat.identity },
    client_version: "3.17.0",
  });
  await until(() => seat.auth, "seat authentication");
  for (let i = 0; i < 100 && !seat.joined; i++) {
    send(socket, { type: "JoinRoom", room_id: roomId, observe: false });
    await pause(100);
  }
  assert(seat.joined, logs);
  if (!initial) send(socket, { type: "RequestResync" });
  if (initial) {
    const cards = Array.from({ length: 60 }, (_, i) => ({
      identity: {
        id: `card-${i}`,
        name: i < 40 ? "Forest" : "Grizzly Bears",
        setCode: "",
        cardNumber: "0",
      },
    }));
    send(socket, {
      type: "SetDeckSelection",
      deck_name: "Journal fixture",
      deck: { name: "Journal fixture", cards },
    });
    send(socket, { type: "SetReady", ready: true });
  }
}
const proxy = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await once(proxy, "listening");
proxy.on("connection", (downstream) => {
  const upstream = new WebSocket(`ws://127.0.0.1:${relayPort}`);
  sockets.add(downstream);
  sockets.add(upstream);
  const queued = [];
  for (const socket of [upstream, downstream]) {
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      upstream.terminate();
      downstream.terminate();
    });
  }
  upstream.on("open", () => {
    for (const data of queued) upstream.send(data, { binary: false });
  });
  downstream.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      assert.notEqual(
        message.type,
        "ReportCheckpoint",
        "journal games must not use lossy checkpoint handoff",
      );
      if (message.type === "DecisionJournal") {
        pending.set(message.request_id, message.request);
        if (message.request.operation === "append") {
          const sequence = JSON.parse(message.request.batch).nextSequence - 1;
          attempts.set(sequence, (attempts.get(sequence) ?? 0) + 1);
        }
      }
      if (
        message.type === "BroadcastState" &&
        message.state?.kind === "prompt" &&
        attempts.get(4) >= 2
      )
        restartPrompt = true;
      if (
        message.type === "BroadcastState" &&
        ["state", "stateDelta", "prompt", "display"].includes(message.state?.kind)
      )
        outputs++;
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: false });
      else queued.push(data);
    } catch (error) {
      failure = error;
    }
  });
  upstream.on("message", (data) => {
    void (async () => {
      const message = JSON.parse(data);
      if (message.type === "RoomCreated") roomId = message.room_id;
      if (message.type === "DecisionJournalResult") {
        const request = pending.get(message.request_id);
        pending.delete(message.request_id);
        if (handedOff) {
          if (message.result.Ok !== undefined)
            assert.notEqual(request?.operation, "append", "a fenced host appended");
          return;
        }
        assert.equal(message.result.Err, undefined, message.result.Err);
        const receipt = JSON.parse(message.result.Ok);
        epochs.add(receipt.epoch);
        if (request?.operation === "append" && !receipt.unavailable_reason) {
          through = receipt.sequence;
          assert.equal(position().sequence, through, "receipt must follow durable commit");
          if (through <= 1 && !held.has(through)) {
            held.add(through);
            await pause(100);
            const before = outputs;
            if (through === 0)
              assert.equal(before, 0, "startup output escaped the manifest barrier");
            await pause(500);
            assert.equal(outputs, before, "game output advanced without acknowledgement");
          }
          if (through === 2 && !held.has(2)) {
            held.add(2);
            downstream.terminate();
            upstream.terminate();
            return;
          }
          if (through === 3 && !held.has(3)) {
            held.add(3);
            return;
          }
          if (through === 4 && !held.has(4)) {
            held.add(4);
            restart = (async () => {
              await stop(relay);
              await startRelay();
              await until(() => restartPrompt, "prompt before seats rejoin");
              await Promise.all(seats.map((seat) => joinSeat(seat)));
            })();
            restart.catch((error) => {
              failure = error;
            });
            return;
          }
          if (through >= 8) allowAnswers = false;
        }
      }
      if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: false });
    })().catch((error) => {
      failure = error;
    });
  });
});
try {
  await startRelay();
  node = spawnNode(`ws://127.0.0.1:${proxy.address().port}`, resolve(values.jar));
  await until(() => roomId, "node room");
  for (const seat of seats) await joinSeat(seat, true);
  await until(
    () => seats[0].room?.players.filter((player) => player.ready).length === 2,
    "ready seats",
  );
  send(seats[0].socket, { type: "StartGame", format: "Standard" });
  await until(() => through >= 8, "committed decisions after reconnect and restart", 90_000);
  await restart;
  assert(attempts.get(2) >= 2, "lost reply must retry the retained decision");
  assert(attempts.get(3) >= 2, "lost reply on a live socket must retry after timeout");
  assert(attempts.get(4) >= 2, "relay restart must retry the retained decision");
  assert(epochs.size >= 3, "each replacement connection must claim a new writer epoch");
  const durable = position();
  const stored = new DatabaseSync(database, { readOnly: true });
  try {
    const entries = stored
      .prepare("SELECT entry FROM engine_decisions ORDER BY sequence")
      .all()
      .map(({ entry }) => JSON.parse(entry));
    assert.equal(
      new Set(entries.map((entry) => entry.prompt.promptId)).size,
      entries.length,
      "replayed seat responses must not become extra decisions",
    );
  } finally {
    stored.close();
  }
  const manifest = JSON.parse(durable.manifest);
  assert.equal(
    manifest.engine_sha256,
    createHash("sha256")
      .update(await readFile(values["engine-artifact"] ?? values.jar))
      .digest("hex"),
  );
  assert.match(manifest.assets_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(manifest.start_request).decisionJournalCommitBarrier, true);
  assert.equal(JSON.parse(manifest.start_request).snapshotRecording, false);
  const verificationOptions = {
    database,
    journalKey: durable.game_id,
    jar: resolve(values.jar),
    forgeHome: resolve(values["forge-home"]),
    java: values["java-home"] ? join(values["java-home"], "bin", "java") : "java",
  };
  let verification;
  if (!values["engine-artifact"]) {
    verification = await verifyRelayJournal(verificationOptions);
    assert.equal(verification.decisions, durable.sequence);
    await assert.rejects(
      verifyRelayJournal({ ...verificationOptions, jar: resolve(values.node) }),
      /engine artifact mismatch/,
    );
    const divergentDatabase = join(directory, "divergent.db");
    const original = new DatabaseSync(database, { readOnly: true });
    try {
      original.prepare("VACUUM INTO ?").run(divergentDatabase);
    } finally {
      original.close();
    }
    const divergent = new DatabaseSync(divergentDatabase);
    try {
      const first = JSON.parse(
        divergent.prepare("SELECT entry FROM engine_decisions WHERE sequence = 1").get().entry,
      );
      first.prompt.promptId += 1000;
      divergent
        .prepare("UPDATE engine_decisions SET entry = ? WHERE sequence = 1")
        .run(JSON.stringify(first));
      await assert.rejects(
        verifyRelayJournal({ ...verificationOptions, database: divergentDatabase }),
        /prompt divergence at decision 1/,
      );
      divergent.exec("DELETE FROM engine_decisions WHERE sequence = 1");
      await assert.rejects(
        verifyRelayJournal({ ...verificationOptions, database: divergentDatabase }),
        /journal prefix is incomplete/,
      );
    } finally {
      divergent.close();
    }
  }
  assert(
    seats.every((seat) =>
      seat.messages.every((message) => message.type !== "DecisionJournalResult"),
    ),
    "journal receipt leaked to a seat",
  );
  let handoff;
  const native = Boolean(values["engine-artifact"]);
  if (native) assert(values["jvm-node"], "--jvm-node is required with --engine-artifact");
  {
    const before = position();
    const waiting = seats.find((seat) => seat.prompt && !seat.answered.has(seat.prompt.promptId));
    assert(waiting, "a seat must hold an unanswered prompt when the host dies");
    const pendingPrompt = structuredClone(waiting.prompt);
    const marker = join(directory, "artifact-marker.txt");
    await writeFile(marker, "different engine artifact");
    const badJar = join(directory, "different-harness.jar");
    await copyFile(resolve(values.jar), badJar);
    const jarTool = values["java-home"] ? join(values["java-home"], "bin", "jar") : "jar";
    const packed = spawn(jarTool, ["uf", badJar, "-C", directory, "artifact-marker.txt"]);
    assert.equal((await once(packed, "exit"))[0], 0, "jar update failed");
    const declining = native
      ? spawnNode(`ws://127.0.0.1:${relayPort}`, resolve(values.jar), values["jvm-node"])
      : spawnNode(`ws://127.0.0.1:${relayPort}`, badJar);
    takeovers.push(declining);
    const writable = new DatabaseSync(database);
    const original = writable
      .prepare("SELECT entry FROM engine_decisions WHERE sequence = 1")
      .get().entry;
    const tampered = JSON.parse(original);
    tampered.prompt.promptId += 1000;
    writable
      .prepare("UPDATE engine_decisions SET entry = ? WHERE sequence = 1")
      .run(JSON.stringify(tampered));
    const diverging = spawnNode(`ws://127.0.0.1:${relayPort}`, resolve(values.jar));
    takeovers.push(diverging);
    await until(
      () => [declining, diverging].every((pod) => pod.output.includes("room created")),
      "declining pod lobbies",
      120_000,
    );
    node.stopped = true;
    node.kill("SIGSTOP");
    for (const socket of [...sockets])
      if (!seats.some((seat) => seat.socket === socket)) socket.terminate();
    await until(
      () =>
        [declining, diverging].every((pod) => pod.output.includes("declining journal takeover")),
      "mismatched and divergent pods decline",
      90_000,
    );
    assert.match(declining.output, /engine artifact mismatch/);
    assert.match(diverging.output, /prompt divergence at decision 1/);
    for (const pod of [declining, diverging])
      assert(!pod.output.includes("took over the room"), "a declining pod claimed the room");
    assert(
      seats.every((seat) => !seat.hostChanged),
      "a declined takeover became visible",
    );
    assert.deepEqual(
      { epoch: position().epoch, sequence: position().sequence },
      { epoch: before.epoch, sequence: before.sequence },
      "a declined takeover touched the journal",
    );
    writable.prepare("UPDATE engine_decisions SET entry = ? WHERE sequence = 1").run(original);
    writable.close();
    handedOff = true;
    const taker = spawnNode(`ws://127.0.0.1:${relayPort}`, resolve(values.jar));
    takeovers.push(taker);
    await until(() => seats.every((seat) => seat.hostChanged), "host changed", 240_000);
    const newHost = waiting.hostChanged.host;
    assert(taker.output.includes("took over the room from its journal"), taker.output);
    await until(() => position().epoch > before.epoch, "takeover claims a new writer epoch");
    await until(
      () => waiting.afterChange.some((message) => message.state?.kind === "prompt"),
      "first prompt from the new host",
    );
    const resumed = waiting.afterChange.find((message) => message.state?.kind === "prompt");
    assert.equal(resumed.from_player, newHost);
    assert.deepEqual(resumed.state.prompt, pendingPrompt, "replay must reach the identical prompt");
    node.kill("SIGCONT");
    node.stopped = false;
    allowAnswers = true;
    answer(waiting, resumed.state.prompt);
    await until(
      () => position().sequence >= before.sequence + 4,
      "decisions committed by the new host",
      90_000,
    );
    allowAnswers = false;
    await pause(2000);
    for (const seat of seats)
      for (const message of seat.afterChange)
        assert.equal(message.from_player, newHost, "stale host output reached a seat");
    const continued = position();
    assert(continued.epoch > before.epoch);
    assert.equal(JSON.parse(continued.manifest).engine_sha256, manifest.engine_sha256);
    const replayed = native
      ? { verification: "native takeover replay; the JVM verifier cannot load a native journal" }
      : await verifyRelayJournal(verificationOptions);
    if (!native) assert.equal(replayed.decisions, continued.sequence);
    handoff = {
      declined: `${native ? "JVM engine on a native journal" : "different harness jar"} and replay divergence, journal and visibility untouched`,
      claimedAfter: before.sequence,
      continuedTo: continued.sequence,
      epochs: [before.epoch, continued.epoch],
      firstPrompt: "identical to the prompt pending at host death",
      staleHost: "no output after the takeover",
      verification: replayed.verification,
    };
  }
  send(seats[0].socket, {
    type: "BroadcastState",
    state: {
      kind: "directive",
      fromPlayer: seats[0].slot,
      directive: { type: "requestRestore", checkpointId: 1 },
    },
  });
  await until(() => position().unavailable_reason, "durable invalidation");
  await assert.rejects(verifyRelayJournal(verificationOptions), /journal is invalidated/);
  await until(
    () => seats.some((seat) => seat.messages.some((message) => message.state?.kind === "fatal")),
    "fail-closed engine outcome",
  );
  console.log(
    JSON.stringify(
      {
        gameId,
        decisions: durable.sequence,
        epochs: [...epochs],
        withheldAcknowledgements: "startup and decision output stayed frozen",
        lostReply: "same decision retried",
        relayRestart: "retained prefix resumed",
        invalidation: "durable failure, no restore",
        artifactIdentity: "actual harness and rules assets",
        replay: verification ?? "JVM verifier requires a JVM journal",
        handoff,
        privacy: "no seat journal traffic",
      },
      null,
      2,
    ),
  );
} finally {
  for (const child of takeovers) await stop(child, "SIGTERM");
  await stop(node, "SIGTERM");
  await stop(relay);
  for (const socket of sockets) socket.terminate();
  await new Promise((resolve) => proxy.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
