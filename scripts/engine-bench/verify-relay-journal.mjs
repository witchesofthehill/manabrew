import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { harness } from "./journal-harness.mjs";

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

async function hashAssets(root) {
  const paths = [];
  async function collect(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await collect(join(directory, entry.name), name + "/");
      else {
        assert(entry.isFile(), "journal assets must be regular files");
        paths.push(name);
      }
    }
  }
  await collect(root);
  assert(paths.length, "journal assets directory is empty");
  paths.sort((a, b) => {
    const left = a.split("/"),
      right = b.split("/");
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const order = Buffer.compare(Buffer.from(left[i]), Buffer.from(right[i]));
      if (order) return order;
    }
    return left.length - right.length;
  });
  const hash = createHash("sha256").update("manabrew-assets-v1\0");
  for (const path of paths) {
    const name = Buffer.from(path);
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(name.length));
    hash
      .update(length)
      .update(name)
      .update(await hashFile(join(root, path)));
  }
  return hash.digest("hex");
}

export async function verifyRelayJournal({ database, journalKey, jar, forgeHome, java }) {
  const db = new DatabaseSync(database, { readOnly: true });
  let shadow;
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    db.exec("BEGIN");
    const row = db.prepare("SELECT * FROM engine_journals WHERE game_id = ?").get(journalKey);
    assert(row, "journal does not exist");
    assert.equal(row.unavailable_reason, null, "journal is invalidated");
    assert(Number.isSafeInteger(row.sequence) && row.sequence >= 0);
    const extent = db
      .prepare(
        "SELECT COUNT(*) AS count, MIN(sequence) AS first, MAX(sequence) AS last FROM engine_decisions WHERE game_id = ?",
      )
      .get(journalKey);
    assert(
      extent.count === row.sequence &&
        (row.sequence === 0 || (extent.first === 1 && extent.last === row.sequence)),
      "journal prefix is incomplete",
    );
    const manifest = JSON.parse(row.manifest);
    assert.equal(await hashFile(jar), manifest.engine_sha256, "engine artifact mismatch");
    assert.equal(
      await hashAssets(join(forgeHome, "res")),
      manifest.assets_sha256,
      "rules assets mismatch",
    );
    const start = JSON.parse(manifest.start_request);
    assert.equal(start.decisionJournal, true);
    assert.equal(start.decisionJournalCommitBarrier, true);
    shadow = harness({ java, jar, forgeHome, sessionId: start.gameId });
    await shadow.call("startGame", { payload: manifest.start_request });
    const initial = JSON.parse(await shadow.call("readDecisionJournal"));
    assert.equal(initial.commitBarrier, true);
    assert.equal(initial.startRequest, manifest.start_request);
    assert.equal(initial.nextSequence, 1);
    assert.deepEqual(initial.entries, []);
    assert.equal(initial.unavailableReason, undefined);
    await shadow.call("acknowledgeDecisionJournal", { sequence: 0 });
    let sequence = 0,
      previousPrompt;
    const entries = db.prepare(
      "SELECT sequence, entry FROM engine_decisions WHERE game_id = ? ORDER BY sequence",
    );
    for (const stored of entries.iterate(journalKey)) {
      const entry = JSON.parse(stored.entry);
      assert.equal(stored.sequence, ++sequence, "journal sequence gap");
      assert.equal(entry.sequence, sequence);
      assert(sequence <= row.sequence, "entry exceeds committed prefix");
      const prompt = await shadow.prompt(previousPrompt);
      assert.deepEqual(prompt, entry.prompt, `prompt divergence at decision ${sequence}`);
      await shadow.call("submitAction", { payload: JSON.stringify(entry.action) });
      const deadline = performance.now() + 10_000;
      let batch;
      do {
        batch = JSON.parse((await shadow.call("readDecisionJournal")) || "null");
        assert.equal(batch?.unavailableReason, undefined);
        if (batch?.entries.length) break;
        assert(performance.now() < deadline, `decision ${sequence} was not consumed`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      } while (true);
      assert.equal(batch.commitBarrier, true);
      assert.equal(batch.nextSequence, sequence + 1);
      assert.deepEqual(batch.entries, [entry], `consumption divergence at decision ${sequence}`);
      await shadow.call("acknowledgeDecisionJournal", { sequence });
      previousPrompt = entry.action.type === "directive" ? undefined : prompt.promptId;
    }
    assert.equal(sequence, row.sequence, "journal prefix is incomplete");
    return {
      journalKey,
      epoch: row.epoch,
      decisions: sequence,
      engineSha256: manifest.engine_sha256,
      assetsSha256: manifest.assets_sha256,
      verification: "committed prompts and consumed decisions in a fresh JVM",
    };
  } finally {
    shadow?.close();
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      database: { type: "string" },
      "journal-key": { type: "string" },
      jar: { type: "string" },
      "forge-home": { type: "string" },
      java: { type: "string", default: "java" },
    },
  });
  assert(
    values.database && values["journal-key"] && values.jar && values["forge-home"],
    "--database, --journal-key, --jar and --forge-home are required",
  );
  console.log(
    JSON.stringify(
      await verifyRelayJournal({
        database: values.database,
        journalKey: values["journal-key"],
        jar: values.jar,
        forgeHome: values["forge-home"],
        java: values.java,
      }),
      null,
      2,
    ),
  );
}
