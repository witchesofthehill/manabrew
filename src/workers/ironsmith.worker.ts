import initIronsmith, { WasmGame } from "ironsmith-wasm";
import ironsmithWasmModuleUrl from "ironsmith-wasm/ironsmith_bg.wasm?url";
import type { WasmManabot } from "@/wasm/wasm";
import type {
  IronsmithDeckIssue,
  IronsmithEngineMethods,
  IronsmithEngineRequest,
  IronsmithEngineResponse,
  IronsmithViewResult,
} from "@/game/ironsmithEngine.types";
import type { DirectiveInput, PromptOutput } from "@/protocol";
import type { GameViewDto } from "@/protocol/game";

type IronsmithWasmGame = InstanceType<typeof WasmGame> & {
  validateManabrewMatchConfig(config: unknown): { valid?: boolean; issues?: IronsmithDeckIssue[] };
  startManabrewMatch(config: unknown): unknown;
  manabrewView(viewer: number): IronsmithViewResult;
  manabrewPublicState(): { gameView?: GameViewDto };
  manabrewRespond(player: number, promptId: number, output: PromptOutput): IronsmithViewResult;
  manabrewApplyDirective(player: number, directive: DirectiveInput): IronsmithViewResult;
};

const bots = new Map<string, WasmManabot>();
let game: IronsmithWasmGame;
let initialized: Promise<void> | null = null;
let work = Promise.resolve();
const realm = globalThis as unknown as {
  postMessage(message: IronsmithEngineResponse): void;
  onmessage: (event: MessageEvent<IronsmithEngineRequest>) => void;
};

async function initialize(): Promise<void> {
  initialized ??= initIronsmith({ module_or_path: ironsmithWasmModuleUrl })
    .then(() => {
      game = new WasmGame() as IronsmithWasmGame;
    })
    .catch((error) => {
      initialized = null;
      throw error;
    });
  await initialized;
}

const methods: IronsmithEngineMethods = {
  start(config, validate) {
    methods.clearBots();
    if (validate) {
      const result = game.validateManabrewMatchConfig(config);
      if (result?.valid === false) return result.issues ?? [];
    }
    game.startManabrewMatch(config);
    game.manabrewView(0);
    return null;
  },
  view(viewer) {
    const view = plainify(game.manabrewView(viewer)) as IronsmithViewResult;
    if (view.prompt?.input.type === "payManaCost") view.prompt.input.cancellable ??= true;
    return view;
  },
  publicState() {
    return plainify(game.manabrewPublicState()) as { gameView?: GameViewDto };
  },
  apply(input) {
    const player = Number(input.slot.replace("player-", ""));
    const result = plainify(
      input.kind === "directive"
        ? game.manabrewApplyDirective(player, input.directive)
        : game.manabrewRespond(player, input.promptId, input.action),
    ) as IronsmithViewResult;
    return {
      error: result.error ?? null,
      digest: fnv1a(JSON.stringify(methods.publicState())),
    };
  },
  async botAction(slot, gameView, prompt) {
    let agent = bots.get(slot);
    if (!agent) {
      const wasm = await import("@/wasm/wasm");
      await wasm.default();
      agent = new wasm.WasmManabot();
      bots.set(slot, agent);
    }
    agent.observe_state(JSON.stringify({ gameView }));
    const response = agent.decide(JSON.stringify(prompt));
    if (!response) throw new Error(`Manabot did not answer ${prompt.input.type} for ${slot}`);
    return JSON.parse(response) as PromptOutput;
  },
  clearBots() {
    for (const agent of bots.values()) agent.free();
    bots.clear();
  },
};

async function dispatch(request: IronsmithEngineRequest): Promise<unknown> {
  await initialize();
  switch (request.method) {
    case "start":
      return methods.start(...request.args);
    case "view":
      return methods.view(...request.args);
    case "publicState":
      return methods.publicState();
    case "apply":
      return methods.apply(...request.args);
    case "botAction":
      return methods.botAction(...request.args);
    case "clearBots":
      return methods.clearBots();
  }
}

realm.onmessage = ({ data }) => {
  work = work.then(async () => {
    try {
      const value = await dispatch(data);
      realm.postMessage({ id: data.id, ok: true, value });
    } catch (cause) {
      const error =
        cause instanceof Error
          ? { name: cause.name, message: cause.message, stack: cause.stack }
          : { name: "Error", message: String(cause) };
      realm.postMessage({ id: data.id, ok: false, error });
    }
  });
};

function plainify(value: unknown): unknown {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of value) out[String(key)] = plainify(entry);
    return out;
  }
  if (Array.isArray(value)) return value.map(plainify);
  return value;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
