import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { binary: { type: "string" } } });
if (!values.binary) {
  const build = spawn("cargo", ["build", "-p", "manabrew-server", "--example", "journal_store"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  assert.equal((await once(build, "exit"))[0], 0, "journal probe build failed");
}
const binary = resolve(
  values.binary ??
    join(
      process.env.CARGO_TARGET_DIR ?? "target",
      "debug",
      "examples",
      process.platform === "win32" ? "journal_store.exe" : "journal_store",
    ),
);
const directory = await mkdtemp(join(tmpdir(), "manabrew-journal-"));
const database = join(directory, "journal.db");
const processes = new Set();

function open() {
  const child = spawn(binary, [database], { stdio: ["pipe", "pipe", "pipe"] });
  processes.add(child);
  let pending,
    stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const lines = createInterface({ input: child.stdout });
  child.on("error", (error) => pending?.reject(error));
  child.stdin.on("error", (error) => pending?.reject(error));
  child.on("exit", () => {
    processes.delete(child);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`journal process exited: ${stderr}`));
      pending = null;
    }
    lines.close();
  });
  lines.on("line", (line) => {
    const current = pending;
    pending = null;
    if (!current) return;
    clearTimeout(current.timer);
    const response = JSON.parse(line);
    if (response.ok) current.resolve(response.result);
    else current.reject(new Error(response.error));
  });
  return {
    call(operation, fields = {}) {
      assert(!pending);
      return new Promise((resolve, reject) => {
        pending = {
          resolve,
          reject,
          timer: setTimeout(() => reject(new Error(`timeout: ${operation}: ${stderr}`)), 30_000),
        };
        child.stdin.write(JSON.stringify({ operation, game: "game-a", ...fields }) + "\n");
      });
    },
    async crash() {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    },
  };
}
const startRequest = '{"seed":9223372036854775806,"players":[],"decisionJournal":true}';
const manifest = {
  engine_sha256: "a".repeat(64),
  assets_sha256: "b".repeat(64),
  start_request: startRequest,
};
const entry = (sequence) => ({
  sequence,
  playerIndex: 0,
  prompt: { promptId: sequence },
  action: { type: "response", decision: sequence },
});
const batch = (entries, extra = {}) =>
  JSON.stringify({
    version: 1,
    nextSequence: (entries.at(-1)?.sequence ?? 0) + 1,
    entries,
    ...extra,
  });
const append = (engine, writer, epoch, entries, extra) =>
  engine.call("append", { writer, epoch, batch: batch(entries, extra) });
try {
  let source = open();
  assert.deepEqual(await source.call("begin", { writer: "writer-a", manifest }), {
    epoch: 1,
    sequence: 0,
    unavailable_reason: null,
  });
  await source.call("begin", { writer: "writer-a", manifest });
  await assert.rejects(
    source.call("begin", {
      writer: "writer-a",
      manifest: { ...manifest, assets_sha256: "c".repeat(64) },
    }),
    /another manifest/,
  );
  await assert.rejects(source.call("begin", { writer: "writer-b", manifest }), /another manifest/);
  await assert.rejects(
    append(source, "writer-a", 1, [{ ...entry(1), unknown: true }]),
    /unknown field/,
  );
  await assert.rejects(append(source, "writer-a", 1, [entry(2)]), /sequence gap/);
  await assert.rejects(append(source, "writer-a", 1, [entry(1), entry(3)]), /contiguous/);
  assert.equal((await source.call("read", { after: 0, limit: 10 })).position.sequence, 0);
  assert.equal(
    (await append(source, "writer-a", 1, [entry(1), entry(2)], { startRequest })).sequence,
    2,
  );
  assert.equal(
    (await append(source, "writer-a", 1, [entry(1)])).sequence,
    1,
    "acknowledge only the submitted prefix",
  );
  await source.crash();
  source = open();
  const recovered = await source.call("read", { after: 0, limit: 10 });
  assert.deepEqual(recovered.manifest, manifest);
  assert.deepEqual(recovered.entries, [entry(1), entry(2)]);
  assert.equal(recovered.position.sequence, 2);
  assert.equal((await append(source, "writer-a", 1, [entry(1), entry(2)])).sequence, 2);
  await assert.rejects(append(source, "writer-a", 1, [{ ...entry(2), action: {} }]), /conflicting/);
  await assert.rejects(append(source, "writer-a", 1, [entry(3)], { nextSequence: 5 }), /batch end/);
  assert.equal((await source.call("read", { after: 0, limit: 10 })).position.sequence, 2);
  assert.equal((await append(source, "writer-a", 1, [entry(2), entry(3)])).sequence, 3);
  const competitor = open();
  const claims = await Promise.allSettled([
    source.call("claim", { writer: "writer-b", epoch: 1 }),
    competitor.call("claim", { writer: "writer-c", epoch: 1 }),
  ]);
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  const writer = claims[0].status === "fulfilled" ? "writer-b" : "writer-c";
  assert.equal(
    (await source.call("claim", { writer, epoch: 1 })).epoch,
    2,
    "lost ownership reply is retryable",
  );
  await assert.rejects(append(source, "writer-a", 1, [entry(4)]), /stale journal writer/);
  await assert.rejects(append(source, writer, 1, [entry(4)]), /stale journal writer/);
  await source.crash();
  await competitor.crash();
  source = open();
  await assert.rejects(append(source, "writer-a", 1, [entry(4)]), /stale journal writer/);
  assert.equal((await append(source, writer, 2, [entry(4)])).sequence, 4);
  assert.deepEqual((await source.call("read", { after: 1, limit: 2 })).entries, [
    entry(2),
    entry(3),
  ]);
  await assert.rejects(source.call("read", { after: 5, limit: 1 }), /durable prefix/);
  const invalidation = {
    unavailableReason: "snapshot restore invalidates replay",
    nextSequence: 5,
  };
  assert.equal(
    (await append(source, writer, 2, [], invalidation)).unavailable_reason,
    invalidation.unavailableReason,
  );
  await source.crash();
  source = open();
  assert.equal(
    (await append(source, writer, 2, [], invalidation)).unavailable_reason,
    invalidation.unavailableReason,
  );
  await assert.rejects(append(source, writer, 2, [entry(5)]), /invalidated/);
  const invalid = await source.call("read", { after: 0, limit: 10 });
  assert.equal(invalid.position.unavailable_reason, invalidation.unavailableReason);
  assert.equal(invalid.entries.length, 4, "invalidation preserves the forensic prefix");
  await source.crash();
  source = open();
  const crashGame = "game-interrupted-write";
  await source.call("begin", { game: crashGame, writer: "writer-d", manifest });
  const burst = Array.from({ length: 4096 }, (_, index) => ({
    ...entry(index + 1),
    action: { padding: "x".repeat(256) },
  }));
  const interrupted = source
    .call("append", {
      game: crashGame,
      writer: "writer-d",
      epoch: 1,
      batch: batch(burst),
    })
    .catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await source.crash();
  await interrupted;
  source = open();
  const crashed = await source.call("read", { game: crashGame, after: 0, limit: 4096 });
  assert(
    [0, 4096].includes(crashed.position.sequence),
    "interrupted batch must be wholly present or absent",
  );
  assert.equal(crashed.entries.length, crashed.position.sequence);
  assert.equal(
    (
      await source.call("append", {
        game: crashGame,
        writer: "writer-d",
        epoch: 1,
        batch: batch(burst),
      })
    ).sequence,
    4096,
  );
  assert.equal(
    (await source.call("read", { after: 0, limit: 10 })).position.sequence,
    4,
    "game histories are isolated",
  );
  await source.crash();
  console.log(
    JSON.stringify(
      {
        durableDecisions: 4,
        crashRestarts: 4,
        interruptedCommitted: crashed.position.sequence,
        interruptedBatch: "4096 decisions atomically present or absent; retry converges",
        competingWriters: "one fenced owner",
        retries: "identical prefix accepted; conflicts rejected",
        rejectedBatches: "rolled back atomically",
        invalidation: "survives restart; rejects continuation",
        seed: "64-bit start request preserved verbatim",
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(
    [...processes].map(async (child) => {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }),
  );
  await rm(directory, { recursive: true, force: true });
}
