#!/usr/bin/env node
// Plays `manabot-game.mjs`'s game against the harness jar instead of the Web
// Image: the Manabot wasm answers its seats in-process, the JVM hosts Forge.
// The JVM runs a whole game in seconds where the wasm engine takes minutes,
// and it needs no Web Image toolchain, so a harness change can be read
// against the real bot before a preview build exists. Not a latency reading.
//
//   node scripts/harness.mjs build
//   node scripts/engine-bench/manabot-jvm-game.mjs --seed 7001 --forge-ai-seats 1,3
//   node scripts/engine-bench/manabot-jvm-game.mjs --seats 2 --decks a,b --hints --disagreements d.jsonl
//
// --hints asks the harness for Forge's own pick on every chooseAction prompt
// (aiScore, bench-only) and counts how often the bot agrees; --disagreements
// writes each prompt where it did not, with the bot's view, for rule mining.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const presets = join(root, "public", "preset_decks");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const wasmDir = resolve(option("wasm", join(root, "src", "wasm")));
const jar = resolve(
  option("jar", join(root, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar")),
);
const java = option("java", process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/java` : "java");
const deckNames = option(
  "decks",
  "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander",
).split(",");
const seatCount = Number(option("seats", deckNames.length));
const seed = Number(option("seed", 7015));
const forgeAiSeats = option("forge-ai-seats", "").split(",").filter(Boolean).map(Number);
const hints = process.argv.includes("--hints");
const disagreements = option("disagreements", null);
const trace = process.argv.includes("--trace");
const timeoutS = Number(option("timeout", 900));
const output = option("out", null);
const sysprops = process.argv.flatMap((arg, i) => (arg === "--sysprop" ? [`-D${process.argv[i + 1]}`] : []));

const frontFace = (name) => (name.includes(" // ") ? name.slice(0, name.indexOf(" // ")) : name);

function loadDeck(name) {
  const raw = JSON.parse(readFileSync(join(presets, `${name}.json`), "utf8"));
  const cards = raw.cards.flatMap((entry) => {
    const card = { name: frontFace(entry.name) };
    if (entry.set) card.setCode = entry.set;
    if (entry.cardNumber) card.collectorNumber = entry.cardNumber;
    return Array(entry.count ?? 1).fill(card);
  });
  return { cards, commander: raw.commander ? frontFace(raw.commander) : null, format: raw.format };
}

const decks = Array.from({ length: seatCount }, (_, i) => loadDeck(deckNames[i % deckNames.length]));
const commanderGame = decks[0].format === "commander";
const botSeats = decks.map((_, i) => i).filter((i) => !forgeAiSeats.includes(i));
if (botSeats.length === 0) throw new Error("at least one Manabot seat is required");

const wasm = await import(pathToFileURL(join(wasmDir, "wasm.js")).href);
await wasm.default({ module_or_path: readFileSync(join(wasmDir, "wasm_bg.wasm")) });
const bots = new Map(botSeats.map((seat) => [seat, new wasm.WasmManabot()]));

const jvm = spawn(java, [...sysprops, "-jar", jar, "--interactive-server", "--forge-home", join(root, "forge", "forge-gui")], {
  stdio: ["pipe", "pipe", "pipe"],
});
const stderr = [];
const stderrFile = option("stderr", null);
jvm.stderr.on("data", (chunk) => {
  if (stderrFile) appendFileSync(stderrFile, chunk);
  for (const line of String(chunk).split("\n")) {
    if (line.includes("[mana-brew]") || line.includes("Exception") || line.includes("[harness]")) stderr.push(line);
  }
});
const lines = createInterface({ input: jvm.stdout });
const pending = [];
lines.on("line", (line) => {
  if (line.startsWith('{"ok"')) pending.shift()?.(JSON.parse(line));
});
const call = (body) =>
  new Promise((resolveReply, reject) => {
    pending.push((reply) => (reply.ok ? resolveReply(reply.result) : reject(new Error(reply.error))));
    jvm.stdin.write(`${JSON.stringify(body)}\n`);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const request = {
  gameId: "bench",
  variant: commanderGame ? "Commander" : "Constructed",
  startingLife: Number(option("starting-life", commanderGame ? 40 : 20)),
  seed,
  players: decks.map((deck, i) => ({
    name: forgeAiSeats.includes(i) ? `Forge AI ${i + 1}` : `Manabot ${i + 1}`,
    ai: forgeAiSeats.includes(i),
    hints: hints && !forgeAiSeats.includes(i),
    deck: deck.cards,
    commanderNames: commanderGame && deck.commander ? [deck.commander] : [],
  })),
};

const session = JSON.parse(await call({ command: "startGame", payload: JSON.stringify(request) })).sessionId;
const startedAt = Date.now();
const seats = Object.fromEntries(
  botSeats.map((seat) => [
    seat,
    { prompts: 0, acts: 0, passes: 0, hinted: 0, hintAgreed: 0, hintDisagreed: 0, botMs: 0 },
  ]),
);
let lastPromptId = null;
let turn = 0;
let reason = "game_over";
while (true) {
  if (Date.now() - startedAt > timeoutS * 1000) {
    reason = "timeout";
    break;
  }
  const raw = await call({ command: "getPrompt", sessionId: session, playerIndex: 0 });
  const prompt = raw ? JSON.parse(raw) : null;
  if (!prompt || prompt.promptId === lastPromptId) {
    if ((await call({ command: "getGameOver", sessionId: session })).trim() === "true") break;
    await sleep(2);
    continue;
  }
  lastPromptId = prompt.promptId;
  const seat = Number(String(prompt.decidingPlayerId).slice("player-".length));
  const bot = bots.get(seat);
  if (!bot) continue;
  const stats = seats[seat];
  stats.prompts += 1;
  const view = await call({ command: "getSnapshot", sessionId: session, viewer: seat });
  const started = performance.now();
  bot.observe_state(`{"checkpointId":0,"label":"forge","gameView":${view}}`);
  const parsedView = JSON.parse(view);
  turn = parsedView?.turn ?? turn;
  const decided = bot.decide(JSON.stringify(prompt));
  stats.botMs += performance.now() - started;
  if (!decided) {
    reason = `unanswered:${prompt.input?.type}`;
    break;
  }
  const action = JSON.parse(decided);
  if (trace) {
    process.stderr.write(
      `${turn} ${parsedView?.step} seat${seat} ${prompt.input?.type} ${prompt.input?.presentation?.title ?? ""} -> ${JSON.stringify(action.output).slice(0, 160)}\n`,
    );
  }
  if (prompt.input?.type === "chooseAction") {
    const actions = prompt.input.actions ?? [];
    const chosen = action.output?.type === "act" ? actions.find((a) => a.id === action.output.actionId) : null;
    if (chosen) stats.acts += 1;
    else stats.passes += 1;
    const ranked = actions.filter((a) => a.aiScore != null);
    const candidates = actions.filter((a) => a.type !== "undoMana" && !a.isManaAbility);
    if (ranked.length && candidates.length) {
      stats.hinted += 1;
      const forgePick = actions.find((a) => a.aiScore > 0) ?? null;
      const name = (a) => (a ? (a.label ?? a.description ?? a.id) : null);
      const agreed = name(chosen) === name(forgePick) || (chosen && chosen.aiScore == null);
      if (agreed) stats.hintAgreed += 1;
      else {
        stats.hintDisagreed += 1;
        if (disagreements) {
          appendFileSync(
            disagreements,
            `${JSON.stringify({ seed, seat, turn, step: parsedView?.step, bot: chosen?.label ?? chosen?.description ?? null, forge: forgePick?.label ?? forgePick?.description ?? null, actions: candidates.map((a) => [a.label ?? a.description, a.aiScore]), view: parsedView })}\n`,
          );
        }
      }
    }
  }
  await call({ command: "submitAction", sessionId: session, payload: JSON.stringify(action) });
}

const finalView = JSON.parse((await call({ command: "getSnapshot", sessionId: session, viewer: 0 })) || "{}");
jvm.stdin.write('{"command":"quit"}\n');
for (const bot of bots.values()) bot.free();
const life = (finalView?.players ?? []).map((p) => p.life);
const alive = (finalView?.players ?? []).filter((p) => !p.hasLost && p.life > 0).map((p) => p.id);
const result = {
  seed,
  decks: deckNames.slice(0, seatCount),
  forgeAiSeats,
  hints,
  reason,
  turn,
  seconds: Math.round((Date.now() - startedAt) / 1000),
  life,
  lost: (finalView?.players ?? []).filter((p) => p.hasLost).map((p) => p.id),
  winner: alive.length === 1 ? alive[0] : null,
  seats,
  engineWarnings: stderr.slice(0, 20),
};
console.log(JSON.stringify(result, null, 2));
if (output) writeFileSync(output, JSON.stringify(result, null, 2));
