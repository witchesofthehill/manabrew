// Headless client-half check for the hosted prompt path: replays a corpus of
// normalized prompts (recorded by the node self-play harness) through the UI's
// real prompt-ingestion (`applyPrompt`) and asserts the UI knows and handles
// every type and ingests every prompt without throwing — bar rendering and
// the React choice handlers, which need a browser. Imports only the
// import-light store helpers, never `useGameStore` (which pulls Vite's
// `import.meta.env`), so it runs in plain node via tsx.
import { readFileSync } from "node:fs";

import { applyPrompt, HANDLED_PROMPT_TYPES } from "@/stores/gameStore.constants";
import { PromptType } from "@/types/promptType";
import type { AgentPrompt } from "@/stores/gameStore.types";

const corpusPath = process.argv[2] ?? "scripts/fixtures/prompt-corpus.jsonl";
const knownTypes = new Set<string>(Object.values(PromptType));

function makeStoreStub(myPlayerSlot: number) {
  let state: Record<string, unknown> = {
    gameView: null,
    deferredQueue: [],
    isFlashing: false,
    gameLog: [],
    currentPrompt: null,
    isWaitingForResponse: false,
    myPlayerSlot,
  };
  return {
    set: (partial: Record<string, unknown>) => {
      state = { ...state, ...partial };
    },
    get: () => state as never,
  };
}

const lines = readFileSync(corpusPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const seen = new Map<string, number>();
const unknownTypes = new Set<string>();
const unhandledSeen = new Set<string>();
let ingestThrows = 0;
let notRouted = 0;

for (const line of lines) {
  let prompt: AgentPrompt;
  try {
    prompt = JSON.parse(line) as AgentPrompt;
  } catch {
    continue;
  }
  const type = prompt.type as string;
  seen.set(type, (seen.get(type) ?? 0) + 1);
  if (!knownTypes.has(type)) unknownTypes.add(type);
  if (type !== PromptType.StateUpdate && !HANDLED_PROMPT_TYPES.has(type as PromptType)) {
    unhandledSeen.add(type);
  }

  const decider = (prompt as { decidingPlayerId?: number }).decidingPlayerId ?? 0;
  const store = makeStoreStub(decider);
  try {
    applyPrompt(prompt, "ui-prompt-check", store.set, store.get);
  } catch (error) {
    ingestThrows++;
    console.error(`INGEST THREW for type=${type}: ${(error as Error).message}`);
    continue;
  }
  // A decision prompt for us must land as the active currentPrompt; stateUpdate
  // intentionally does not (it only refreshes the board).
  const current = (store.get() as { currentPrompt: unknown }).currentPrompt;
  if (type !== PromptType.StateUpdate && current == null) {
    notRouted++;
    console.error(`NOT ROUTED to currentPrompt for type=${type}`);
  }
}

console.log(`\nprompt corpus: ${lines.length} prompts, ${seen.size} distinct types`);
for (const [type, count] of [...seen.entries()].sort()) {
  const handled = type === PromptType.StateUpdate || HANDLED_PROMPT_TYPES.has(type as PromptType);
  console.log(`  ${handled ? "ok " : "!! "} ${type.padEnd(32)} ${count}`);
}
if (unhandledSeen.size > 0) {
  console.warn(`\nWARN: emitted but NOT in HANDLED_PROMPT_TYPES: ${[...unhandledSeen].join(", ")}`);
}

const failed = unknownTypes.size > 0 || ingestThrows > 0 || notRouted > 0;
if (unknownTypes.size > 0) {
  console.error(`\nFAIL: emitted types the UI does not declare: ${[...unknownTypes].join(", ")}`);
}
if (ingestThrows > 0) console.error(`FAIL: ${ingestThrows} prompt(s) threw during ingestion`);
if (notRouted > 0)
  console.error(`FAIL: ${notRouted} decision prompt(s) did not become currentPrompt`);
console.log(failed ? "\nUI prompt handling: FAIL" : "\nUI prompt handling: OK");
process.exit(failed ? 1 : 0);
