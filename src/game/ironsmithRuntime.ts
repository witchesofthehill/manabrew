import { IronsmithEngine } from "./ironsmithEngine";
import type {
  IronsmithDeckIssue,
  IronsmithEngineMethods,
  IronsmithInput,
  IronsmithMatchConfig,
} from "./ironsmithEngine.types";
import { reportClientError } from "@/lib/errorReporting";
import { getPlatform } from "@/platform";
import { type BotRecovery, newBotRecovery, recoverBotAnswer } from "./ironsmithBotRecovery";
import { withBothCardParts } from "./ironsmithDeckFaces";
import { createRoomRelayEnvelope, isRoomRelayProtocol } from "./roomRelay";
import type {
  IGameApi,
  RespondParams,
  SendDirectiveParams,
  StartGameParams,
  StartMultiplayerGameParams,
} from "@/platform";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { Deck } from "@/protocol/deck";
import type { DirectiveInput, GameFormat, Prompt, PromptOutput, ProtocolError } from "@/protocol";

import type { GameViewDto } from "@/protocol/game";
import type { RoomInfo, RoomMessagePayload } from "@/types/server";

export type { IronsmithDeckIssue } from "./ironsmithEngine.types";

const IRONSMITH_RELAY_PROTOCOL = "ironsmith-trusted";

export class IronsmithUnsupportedDeckError extends Error {
  readonly issues: IronsmithDeckIssue[];
  constructor(issues: IronsmithDeckIssue[]) {
    const cards = [...new Set(issues.map((i) => i.cardName))];
    const shown = cards.slice(0, 3).join(", ");
    const rest = cards.length > 3 ? ` and ${cards.length - 3} more` : "";
    super(
      cards.length
        ? `Ironsmith can't run this deck yet — ${cards.length} unsupported ${cards.length === 1 ? "card" : "cards"} (${shown}${rest}).`
        : "Ironsmith can't run this deck yet.",
    );
    this.name = "IronsmithUnsupportedDeckError";
    this.issues = issues;
  }
}

function enrichDeckFaces(deck: Deck): Promise<Deck> {
  const store = useScryfallStore.getState();
  return withBothCardParts(deck, async (card) => {
    const { info } = await store.getCard({
      name: card.identity.name,
      setCode: card.identity.setCode,
      collectorNumber: card.identity.cardNumber,
    });
    return info.card_faces;
  });
}

function matchConfig(params: {
  playerNames: string[];
  decks: Deck[];
  commanderNames: Array<string | null>;
  startingLife: number;
  format?: GameFormat | null;
  botPlayerSlots?: string[];
}): IronsmithMatchConfig {
  const botPlayers = (params.botPlayerSlots ?? []).map((slot) =>
    Number(slot.replace("player-", "")),
  );
  return {
    playerNames: params.playerNames,
    startingLife: params.startingLife,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    format: params.format ?? null,
    decks: params.decks,
    commanderNames: params.commanderNames,
    openingHandSize: 7,
    botPlayers,
    humanPlayers: params.playerNames.map((_, index) => !botPlayers.includes(index)),
  };
}

interface EncryptedRelayPayload {
  iv: string;
  data: string;
}

// Every seat runs its own copy of the engine. The host is only the sequencer:
// it orders the inputs (prompt responses and directives) into a transcript and
// every seat applies that transcript to its own engine, then renders its own
// view. Because each seat already holds the whole game, any seat can take over
// as host when the room hands it the role.
// `digest` fingerprints the public game state after the input was applied and
// `rejected` says whether the host's engine refused it, so a seat whose engine
// disagrees with the host's on either notices and resyncs.
type IronsmithTranscriptEntry = IronsmithInput & {
  seq: number;
  digest: string;
  rejected: boolean;
};

type IronsmithPrivatePayload =
  // Host to seat. `config` restarts the seat's engine from the match setup;
  // without it the entries extend what the seat already has.
  | {
      type: "sync";
      config?: IronsmithMatchConfig;
      from: number;
      entries: IronsmithTranscriptEntry[];
      more: boolean;
    }
  | { type: "entry"; entry: IronsmithTranscriptEntry }
  | { type: "fatal"; message: string }
  // Seat to host.
  | { type: "syncRequest"; have: number; restart: boolean }
  | { type: "response"; promptId: number; action: PromptOutput }
  | { type: "directive"; directive: DirectiveInput };

type IronsmithRoomRelayPayload =
  | { type: "hello"; seat: string; publicKey: JsonWebKey; transcript?: number }
  | { type: "private"; to: string; encrypted: EncryptedRelayPayload };

const IRONSMITH_TRANSCRIPT_VERSION = 1;
const SYNC_CHUNK_ENTRIES = 200;
const SYNC_RETRY_MS = 2000;

// Trusted mode encrypts per-seat payloads against casual room observers, but it
// is not a cryptographic identity system. Seat identity is bound only to the
// relay-authenticated username for this room; a seat's key lasts for its page
// load and is replaced when that seat comes back from a reload.
export class IronsmithTrustedGameApi implements IGameApi {
  private game: IronsmithEngine | null = null;
  private generation = 0;
  private isMultiplayer = false;
  private isHost = false;
  private localPlayerSlot: string | null = null;
  private playerNames: string[] = [];
  private playerSlots: string[] = [];
  private botPlayerSlots = new Set<string>();
  private botRecovery = new Map<string, BotRecovery>();
  private prompts = new Map<string, Prompt>();
  private roomRelayUnsubscribe: (() => void) | null = null;
  private keyPairPromise: Promise<CryptoKeyPair | null> | null = null;
  private peerPublicKeys = new Map<string, CryptoKey>();
  private peerKeyFingerprints = new Map<string, string>();
  private sharedKeys = new Map<string, CryptoKey>();
  private hostPlayerSlot: string | null = null;
  private concededPlayerSlots = new Set<string>();
  private config: IronsmithMatchConfig | null = null;
  private entries: IronsmithTranscriptEntry[] = [];
  // Serializes everything that touches the engine or the transcript.
  private work: Promise<void> = Promise.resolve();
  private needsSync = false;
  private syncRestart = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private roomUnsubscribes: Array<() => void> = [];
  private versionMismatchReported = false;
  // The local seat's last input the host has not put in the transcript yet.
  // If the host is lost before it does, the input goes to the next host.
  private pendingInput: IronsmithInput | null = null;
  private resendPending = false;

  async startGame(params: StartGameParams): Promise<string> {
    const opponentDeck = params.opponentDecks?.[0] ?? params.deck;
    await this.startHost(
      {
        playerNames: ["You", "Opponent"],
        decks: [params.deck, opponentDeck],
        commanderNames: [params.commanderName, null],
        startingLife: params.startingLife,
        format: null,
        enginePlayerIndex: 0,
        localIsHost: true,
      },
      new Set(["player-1"]),
    );
    return "ironsmith";
  }

  async startMultiplayerGame(params: StartMultiplayerGameParams): Promise<void> {
    this.resetGame();
    const generation = this.generation;
    this.isMultiplayer = true;
    this.isHost = params.localIsHost;
    this.localPlayerSlot = `player-${params.enginePlayerIndex}`;
    this.playerNames = params.playerNames;
    this.playerSlots = params.playerNames.map((_, index) => `player-${index}`);
    this.botPlayerSlots = new Set(params.botPlayerSlots ?? []);
    this.hostPlayerSlot =
      params.hostPlayerSlot ?? (params.localIsHost ? this.localPlayerSlot : null);
    this.peerPublicKeys.clear();
    this.peerKeyFingerprints.clear();
    this.sharedKeys.clear();
    this.installRoomRelayListener();
    this.installRoomListeners();
    await this.sendRelayHello();
    this.assertGeneration(generation);

    if (params.localIsHost) {
      await this.startHost(params);
      return;
    }
    this.requestSync(true);
  }

  async respond(params: RespondParams): Promise<void> {
    const playerSlot = params.playerSlot ?? this.localPlayerSlot ?? "player-0";
    await this.submit({
      kind: "response",
      slot: playerSlot,
      promptId: params.promptId,
      action: params.action,
    });
  }

  async sendHostDirective(_directive: DirectiveInput): Promise<void> {
    throw new Error("The Ironsmith runtime takes no host directives.");
  }

  async sendDirective(params: SendDirectiveParams): Promise<void> {
    const playerSlot = params.playerSlot ?? this.localPlayerSlot ?? "player-0";
    await this.submit({ kind: "directive", slot: playerSlot, directive: params.directive });
  }

  async endGame(): Promise<void> {
    this.roomRelayUnsubscribe?.();
    this.roomRelayUnsubscribe = null;
    for (const unsubscribe of this.roomUnsubscribes) unsubscribe();
    this.roomUnsubscribes = [];
    this.resetGame();
    this.isMultiplayer = false;
    this.isHost = false;
    this.localPlayerSlot = null;
    this.playerNames = [];
    this.playerSlots = [];
    this.botPlayerSlots.clear();
    this.peerPublicKeys.clear();
    this.peerKeyFingerprints.clear();
    this.sharedKeys.clear();
    this.hostPlayerSlot = null;
  }

  async getPrompt(): Promise<Prompt | null> {
    return this.localPlayerSlot ? (this.prompts.get(this.localPlayerSlot) ?? null) : null;
  }

  private resetGame(): void {
    this.generation += 1;
    this.work = Promise.resolve();
    this.game?.dispose();
    this.game = null;
    this.botRecovery.clear();
    this.config = null;
    this.entries = [];
    this.prompts.clear();
    this.concededPlayerSlots.clear();
    this.needsSync = false;
    this.syncRestart = false;
    this.versionMismatchReported = false;
    this.pendingInput = null;
    this.resendPending = false;
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  private createEngine(): IronsmithEngine {
    const engine = new IronsmithEngine((error) => {
      if (this.game !== engine) return;
      reportClientError(error, "engine-worker");
      getPlatform().events.emit("game:fatal", { message: error.message });
    });
    this.game = engine;
    return engine;
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new DOMException("Ironsmith game ended", "AbortError");
    }
  }

  private async callEngine<K extends keyof IronsmithEngineMethods>(
    method: K,
    ...args: Parameters<IronsmithEngineMethods[K]>
  ): Promise<Awaited<ReturnType<IronsmithEngineMethods[K]>>> {
    const game = this.game;
    if (!game) throw new Error("Ironsmith game is not initialized");
    const result = await game.call(method, ...args);
    if (game !== this.game) throw new DOMException("Ironsmith game ended", "AbortError");
    return result;
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const generation = this.generation;
    const execute = async () => {
      this.assertGeneration(generation);
      await run();
      this.assertGeneration(generation);
    };
    const next = this.work.then(execute);
    this.work = next.catch(() => undefined);
    return next;
  }

  private runBackground(run: () => Promise<void>): void {
    const generation = this.generation;
    void run().catch((error: unknown) => {
      if (generation !== this.generation) return;
      reportClientError(error, "engine-operation");
      getPlatform().events.emit("game:fatal", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async startHost(
    params: StartMultiplayerGameParams,
    botSlots = new Set(params.botPlayerSlots ?? []),
  ): Promise<void> {
    this.resetGame();
    const generation = this.generation;
    const game = this.createEngine();
    this.isHost = true;
    this.localPlayerSlot = `player-${params.enginePlayerIndex}`;
    this.playerNames = params.playerNames;
    this.playerSlots = params.playerNames.map((_, index) => `player-${index}`);
    this.botPlayerSlots = botSlots;
    this.hostPlayerSlot = this.localPlayerSlot;
    const decks = await Promise.all(params.decks.map(enrichDeckFaces));
    this.assertGeneration(generation);
    const config = matchConfig({ ...params, decks, botPlayerSlots: [...botSlots] });
    try {
      const issues = await this.callEngine("start", config, true);
      if (issues) throw new IronsmithUnsupportedDeckError(issues);
    } catch (error) {
      game.dispose();
      if (this.game === game) this.game = null;
      throw error;
    }
    this.config = config;
    await this.enqueue(async () => {
      await this.broadcastPublicState();
      this.assertGeneration(generation);
      for (const slot of this.remoteHumanSlots()) {
        await this.sendSync(slot, 0, true);
        this.assertGeneration(generation);
      }
      await this.afterChange();
    });
  }

  // A seat's input goes to the host, which orders it into the transcript.
  private async submit(input: IronsmithInput): Promise<void> {
    const generation = this.generation;
    if (!this.isMultiplayer || this.isHost) {
      await this.enqueue(() => this.hostApply(input));
      return;
    }
    if (!this.hostPlayerSlot) {
      await this.sendRelayHello();
      throw new Error("Ironsmith host relay is not ready yet; try again in a moment.");
    }
    if (!(await this.sendToHost(input))) {
      throw new Error("Ironsmith private relay is not ready yet; try again in a moment.");
    }
    this.assertGeneration(generation);
    this.pendingInput = input;
  }

  private async sendToHost(input: IronsmithInput): Promise<boolean> {
    if (!this.hostPlayerSlot) return false;
    return this.sendPrivateRelay(
      this.hostPlayerSlot,
      input.kind === "response"
        ? { type: "response", promptId: input.promptId, action: input.action }
        : { type: "directive", directive: input.directive },
    );
  }

  // After a host change: an input the lost host never recorded is still the
  // local seat's answer, so hand it to whoever hosts now.
  private async resubmitPending(): Promise<void> {
    if (!this.resendPending) return;
    this.resendPending = false;
    const input = this.pendingInput;
    if (!input || !this.localPlayerSlot) return;
    if (input.kind === "response") {
      const open = this.prompts.get(this.localPlayerSlot);
      if (Number(open?.promptId ?? -1) !== input.promptId) {
        this.pendingInput = null;
        return;
      }
    }
    if (this.isHost) {
      this.pendingInput = null;
      await this.hostApply(input);
    } else {
      await this.sendToHost(input);
    }
  }

  // Host only: apply an input, record it, and send it to every other seat.
  // Rejected inputs are recorded too, so every engine sees the same history.
  private async hostApply(input: IronsmithInput): Promise<void> {
    if (!this.game || (this.isMultiplayer && !this.isHost)) return;
    const generation = this.generation;
    const { error, digest } = await this.applyToEngine(input);
    const entry: IronsmithTranscriptEntry = {
      ...input,
      seq: this.entries.length + 1,
      digest,
      rejected: error !== null,
    };
    this.entries.push(entry);
    if (error && input.kind === "response" && this.botPlayerSlots.has(input.slot)) {
      this.recoveryFor(input.slot).refusedPromptId = input.promptId;
    }
    if (error && input.slot === this.localPlayerSlot) {
      getPlatform().events.emit("game:error", error);
    }
    if (this.isMultiplayer) {
      // The room's public view goes out first, so a seat's own (private) view,
      // which it draws when the entry arrives, is the one left on screen.
      await this.broadcastPublicState();
      this.assertGeneration(generation);
      for (const slot of this.remoteHumanSlots()) {
        await this.sendPrivateRelay(slot, { type: "entry", entry });
        this.assertGeneration(generation);
      }
    }
    await this.afterChange();
  }

  private async broadcastPublicState(): Promise<void> {
    if (!this.isMultiplayer || !this.isHost || !this.game) return;
    try {
      await getPlatform().server?.broadcastState({
        kind: "state",
        state: await this.readPublicState(),
      });
    } catch (error) {
      console.warn("[Ironsmith] failed to publish the public game state", error);
    }
  }

  private async applyToEngine(input: IronsmithInput) {
    if (input.kind === "directive" && input.directive.type === "concede") {
      this.concededPlayerSlots.add(input.slot);
    }
    return this.callEngine("apply", input);
  }

  // Shows the local seat its own view; the host also plays the bots.
  private async afterChange(): Promise<void> {
    if (!this.game) return;
    const generation = this.generation;
    await this.emitLocalView();
    this.assertGeneration(generation);
    if (this.isMultiplayer && !this.isHost) return;
    for (const slot of this.botPlayerSlots) {
      if (!this.game) return;
      const index = Number(slot.replace("player-", ""));
      const { prompt, gameView } = await this.readManabrewView(index);
      if (!prompt || prompt.decidingPlayerId !== slot) continue;
      const recovered = recoverBotAnswer(prompt, this.recoveryFor(slot));
      if (recovered === "stalled") {
        console.warn(`[Ironsmith] the engine refused ${slot}'s answer to ${prompt.input.type}`);
        return;
      }
      const action = recovered ?? (await this.callEngine("botAction", slot, gameView, prompt));
      await this.hostApply({
        kind: "response",
        slot,
        promptId: Number(prompt.promptId ?? 0),
        action,
      });
      return;
    }
  }

  private recoveryFor(slot: string): BotRecovery {
    let recovery = this.botRecovery.get(slot);
    if (!recovery) {
      recovery = newBotRecovery();
      this.botRecovery.set(slot, recovery);
    }
    return recovery;
  }

  private async emitLocalView(stateOnly = false): Promise<void> {
    const slot = this.localPlayerSlot;
    if (!this.game || !slot) return;
    const platform = getPlatform();
    const generation = this.generation;
    const { gameView, prompt, error } = await this.readManabrewView(
      Number(slot.replace("player-", "")),
    );
    platform.events.emit("game:state", { gameView });
    this.assertGeneration(generation);
    if (stateOnly) return;
    if (error) platform.events.emit("game:error", error);
    if (prompt && prompt.decidingPlayerId === slot) {
      this.prompts.set(slot, prompt);
      platform.events.emit("game:prompt", prompt);
    } else {
      this.prompts.delete(slot);
    }
  }

  private remoteHumanSlots(): string[] {
    return this.playerSlots.filter(
      (slot) => slot !== this.localPlayerSlot && !this.botPlayerSlots.has(slot),
    );
  }

  // Host only: send a seat the transcript from `have` on, or the whole match
  // when it has to restart its engine.
  private async sendSync(slot: string, have: number, restart: boolean): Promise<void> {
    if (!this.config) return;
    const generation = this.generation;
    const from = restart || have > this.entries.length ? 0 : have;
    const withConfig = restart || have > this.entries.length;
    let cursor = from;
    do {
      const entries = this.entries.slice(cursor, cursor + SYNC_CHUNK_ENTRIES);
      const more = cursor + entries.length < this.entries.length;
      await this.sendPrivateRelay(slot, {
        type: "sync",
        ...(withConfig && cursor === from ? { config: this.config } : {}),
        from: cursor,
        entries,
        more,
      });
      this.assertGeneration(generation);
      cursor += entries.length;
    } while (cursor < this.entries.length);
  }

  // Seat only: ask the host for the transcript until it arrives. `restart`
  // rebuilds the local engine from the match setup instead of extending it.
  private requestSync(restart: boolean): void {
    this.needsSync = true;
    this.syncRestart = this.syncRestart || restart || !this.game;
    const ask = () => {
      if (!this.needsSync || this.isHost || !this.hostPlayerSlot) return;
      const slot = this.hostPlayerSlot;
      this.runBackground(async () => {
        await this.sendPrivateRelay(slot, {
          type: "syncRequest",
          have: this.entries.length,
          restart: this.syncRestart,
        });
      });
    };
    ask();
    this.syncTimer ??= setInterval(ask, SYNC_RETRY_MS);
  }

  private async applySync(
    payload: Extract<IronsmithPrivatePayload, { type: "sync" }>,
  ): Promise<void> {
    const generation = this.generation;
    if (payload.config) {
      if (
        !this.needsSync &&
        this.game &&
        payload.from + payload.entries.length <= this.entries.length
      ) {
        return;
      }
      this.botRecovery.clear();
      this.game?.dispose();
      this.createEngine();
      await this.callEngine("start", payload.config, false);
      this.config = payload.config;
      this.entries = [];
      this.concededPlayerSlots.clear();
      this.syncRestart = false;
    } else if (this.syncRestart) {
      // An extension of an engine this seat was told to discard.
      return;
    }
    if (!this.game || payload.from > this.entries.length) {
      this.requestSync(!this.game);
      return;
    }
    for (const entry of payload.entries.slice(this.entries.length - payload.from)) {
      if (!(await this.applyEntry(entry))) return;
    }
    if (payload.more) return;
    this.needsSync = false;
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    await this.emitLocalView();
    this.assertGeneration(generation);
    await this.resubmitPending();
  }

  // Applies the host's next entry to the local engine. Returns false, after
  // asking for a restart, when this engine no longer matches the host's.
  private async applyEntry(entry: IronsmithTranscriptEntry): Promise<boolean> {
    if (!this.game) return false;
    if (entry.seq !== this.entries.length + 1) {
      if (entry.seq > this.entries.length + 1) this.requestSync(false);
      return entry.seq <= this.entries.length;
    }
    const generation = this.generation;
    let error: ProtocolError | null = null;
    let diverged = false;
    try {
      const result = await this.applyToEngine(entry);
      error = result.error;
      diverged = (error !== null) !== entry.rejected || result.digest !== entry.digest;
    } catch (cause) {
      this.assertGeneration(generation);
      console.warn("[Ironsmith] engine failed applying the host transcript", cause);
      diverged = true;
    }
    if (diverged) {
      console.warn(`[Ironsmith] local game diverged from the host at input ${entry.seq}`);
      this.requestSync(true);
      return false;
    }
    this.entries.push(entry);
    if (entry.slot === this.localPlayerSlot) this.pendingInput = null;
    if (error && entry.slot === this.localPlayerSlot) {
      getPlatform().events.emit("game:error", error);
    }
    return true;
  }

  // The room names its host. When the host's seat is lost the room hands the
  // role to another seat, and every seat follows.
  private installRoomListeners(): void {
    for (const unsubscribe of this.roomUnsubscribes) unsubscribe();
    const events = getPlatform().events;
    this.roomUnsubscribes = [
      // The room's public view carries no hidden cards. A seat that receives
      // it draws its own view again on top, whatever order the two arrived in.
      events.on<{ state?: { kind?: string } }>("server:state_update", (payload) => {
        if (!this.isMultiplayer || this.isHost || payload?.state?.kind !== "state") return;
        const generation = this.generation;
        setTimeout(() => {
          if (generation !== this.generation) return;
          this.runBackground(() => this.enqueue(() => this.emitLocalView(true)));
        }, 0);
      }),
      events.on<{ room: RoomInfo }>("server:room_update", ({ room }) => {
        const hostSlot = this.slotForUsername(room.host);
        if (!this.isMultiplayer || !hostSlot || this.botPlayerSlots.has(hostSlot)) return;
        this.runBackground(() => this.enqueue(() => this.followHost(hostSlot)));
      }),
      events.on<{ username: string }>("server:player_left", ({ username }) => {
        const slot = this.slotForUsername(username);
        if (!this.isMultiplayer || !slot || slot === this.localPlayerSlot) return;
        // A seat that left the room is out of the game.
        this.runBackground(() =>
          this.enqueue(async () => {
            if (!this.isHost || !this.game || this.concededPlayerSlots.has(slot)) return;
            if ((await this.readPublicState()).gameView.gameOver) return;
            await this.hostApply({ kind: "directive", slot, directive: { type: "concede" } });
          }),
        );
      }),
    ];
  }

  private async followHost(hostSlot: string): Promise<void> {
    if (hostSlot === this.hostPlayerSlot) return;
    const generation = this.generation;
    this.hostPlayerSlot = hostSlot;
    this.resendPending = true;
    if (hostSlot !== this.localPlayerSlot) {
      // Another seat hosts now. Its transcript is the game: catch up to it,
      // or restart from it if this seat got ahead of it.
      this.isHost = false;
      if (this.game) await this.callEngine("clearBots");
      this.botRecovery.clear();
      this.requestSync(false);
      return;
    }
    if (!this.game) {
      getPlatform().events.emit("game:fatal", {
        message: "The host left before this game finished loading.",
      });
      return;
    }
    this.isHost = true;
    this.needsSync = false;
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    await this.broadcastPublicState();
    this.assertGeneration(generation);
    await this.afterChange();
    this.assertGeneration(generation);
    await this.resubmitPending();
  }

  private async readManabrewView(viewer: number): Promise<{
    state: { gameView: GameViewDto };
    gameView: GameViewDto;
    prompt: Prompt | null;
    error: ProtocolError | null;
  }> {
    if (!this.game) throw new Error("Ironsmith game is not initialized");
    const view = await this.callEngine("view", viewer);
    const rawGameView = view.state?.gameView;
    const gameView = rawGameView ? this.applyKnownPlayerStatuses(rawGameView) : null;
    if (!gameView) {
      throw new Error("Ironsmith WASM did not return a Manabrew game view");
    }
    return {
      state: { gameView },
      gameView,
      prompt: view.prompt ?? null,
      error: view.error ?? null,
    };
  }

  private async readPublicState(): Promise<{ gameView: GameViewDto }> {
    const state = await this.callEngine("publicState");
    if (state?.gameView) return { gameView: this.applyKnownPlayerStatuses(state.gameView) };
    throw new Error("Ironsmith WASM did not return a public Manabrew game view");
  }

  private applyKnownPlayerStatuses(gameView: GameViewDto): GameViewDto {
    return {
      ...gameView,
      players: gameView.players.map((player) => {
        if (this.concededPlayerSlots.has(player.id)) {
          return { ...player, status: "conceded" };
        }
        if (gameView.gameOver && gameView.winnerId && player.id !== gameView.winnerId) {
          return { ...player, status: player.status === "conceded" ? "conceded" : "lost" };
        }
        return { ...player, status: player.status ?? "playing" };
      }),
    };
  }

  private installRoomRelayListener(): void {
    this.roomRelayUnsubscribe?.();
    this.roomRelayUnsubscribe = getPlatform().events.on<
      RoomMessagePayload<IronsmithRoomRelayPayload>
    >("server:room_message", (payload) => {
      this.runBackground(() => this.handleRoomRelay(payload));
    });
  }

  private async handleRoomRelay(
    message: RoomMessagePayload<IronsmithRoomRelayPayload>,
  ): Promise<void> {
    const generation = this.generation;
    const envelope = message.state;
    if (!isRoomRelayProtocol<IronsmithRoomRelayPayload>(envelope, IRONSMITH_RELAY_PROTOCOL)) {
      return;
    }
    const relayPayload = envelope.payload;
    const sender = this.authenticatedSenderSlot(message, envelope.fromPlayer);
    if (!sender) return;
    if (sender && sender === this.localPlayerSlot) return;

    if (relayPayload.type === "hello") {
      if (relayPayload.seat === this.localPlayerSlot) return;
      if (relayPayload.seat !== sender) {
        console.warn(
          `[Ironsmith] ignored relay hello claiming ${relayPayload.seat} from authenticated ${sender}`,
        );
        return;
      }
      if (relayPayload.transcript !== IRONSMITH_TRANSCRIPT_VERSION) {
        if (!this.versionMismatchReported) {
          this.versionMismatchReported = true;
          getPlatform().events.emit("game:fatal", {
            message: "Every player needs the same Manabrew version to play an Ironsmith game.",
          });
        }
        return;
      }
      const changed = await this.rememberPeerKey(relayPayload.seat, relayPayload.publicKey);
      this.assertGeneration(generation);
      if (changed) {
        await this.sendRelayHello();
        this.assertGeneration(generation);
        if (this.isHost && this.game) {
          const seat = relayPayload.seat;
          await this.enqueue(() => this.sendSync(seat, 0, true));
        }
      }
      return;
    }

    if (relayPayload.type !== "private") return;
    if (relayPayload.to !== this.localPlayerSlot) return;
    const privatePayload = await this.decryptPrivatePayload(sender, relayPayload.encrypted);
    this.assertGeneration(generation);
    if (!privatePayload) return;
    switch (privatePayload.type) {
      case "sync":
        if (this.isHost || sender !== this.hostPlayerSlot) return;
        await this.enqueue(() => this.applySync(privatePayload));
        return;
      case "entry":
        if (this.isHost || sender !== this.hostPlayerSlot) return;
        await this.enqueue(async () => {
          if (this.syncRestart) return;
          if (await this.applyEntry(privatePayload.entry)) await this.emitLocalView();
        });
        return;
      case "fatal":
        if (sender !== this.hostPlayerSlot) return;
        getPlatform().events.emit("game:fatal", { message: privatePayload.message });
        return;
      case "syncRequest":
        await this.enqueue(async () => {
          if (!this.isHost || !this.game) return;
          await this.sendSync(sender, privatePayload.have, privatePayload.restart);
        });
        return;
      case "response":
        await this.enqueue(async () => {
          if (!this.isHost) return;
          await this.hostApply({
            kind: "response",
            slot: sender,
            promptId: privatePayload.promptId,
            action: privatePayload.action,
          });
        });
        return;
      case "directive":
        await this.enqueue(async () => {
          if (!this.isHost) return;
          await this.hostApply({
            kind: "directive",
            slot: sender,
            directive: privatePayload.directive,
          });
        });
        return;
    }
  }

  private async sendRelayHello(): Promise<void> {
    const slot = this.localPlayerSlot;
    if (!slot) return;
    const keyPair = await this.ownKeyPair();
    if (!keyPair) return;
    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    await this.sendRelayPayload({
      type: "hello",
      seat: slot,
      publicKey,
      transcript: IRONSMITH_TRANSCRIPT_VERSION,
    });
  }

  private async sendPrivateRelay(to: string, payload: IronsmithPrivatePayload): Promise<boolean> {
    const encrypted = await this.encryptPrivatePayload(to, payload);
    if (!encrypted) {
      await this.sendRelayHello();
      return false;
    }
    await this.sendRelayPayload({ type: "private", to, encrypted }, to);
    return true;
  }

  private async sendRelayPayload(
    payload: IronsmithRoomRelayPayload,
    targetPlayer?: string,
  ): Promise<void> {
    const fromPlayer = this.localPlayerSlot ?? undefined;
    await getPlatform().server?.sendRoomMessage(
      createRoomRelayEnvelope({
        protocol: IRONSMITH_RELAY_PROTOCOL,
        fromPlayer,
        targetPlayer: targetPlayer
          ? this.playerNames[this.playerSlots.indexOf(targetPlayer)]
          : undefined,
        payload,
      }),
    );
  }

  private async ownKeyPair(): Promise<CryptoKeyPair | null> {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      throw new Error(
        "Ironsmith trusted multiplayer requires Web Crypto in a secure context. Use HTTPS, localhost, or a browser that exposes crypto.subtle.",
      );
    }
    this.keyPairPromise ??= crypto.subtle
      .generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"])
      .catch((error) => {
        console.warn("[Ironsmith] relay key generation failed", error);
        this.keyPairPromise = null;
        return null;
      });
    return this.keyPairPromise;
  }

  private async rememberPeerKey(slot: string, publicKey: JsonWebKey): Promise<boolean> {
    if (!this.playerSlots.includes(slot)) {
      console.warn(`[Ironsmith] ignored relay key for unknown slot ${slot}`);
      return false;
    }
    const fingerprint = JSON.stringify(publicKey);
    if (this.peerKeyFingerprints.get(slot) === fingerprint) return false;
    // A seat that reloaded its page comes back with a new key. The relay has
    // already authenticated the sender as that seat, so the new key replaces
    // the old one; nothing sent under the old key can be read by it anyway.
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        publicKey,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
      this.peerPublicKeys.set(slot, key);
      this.peerKeyFingerprints.set(slot, fingerprint);
      this.sharedKeys.delete(slot);
      return true;
    } catch (error) {
      console.warn(`[Ironsmith] failed to import relay key for ${slot}`, error);
      return false;
    }
  }

  private async sharedKeyFor(slot: string): Promise<CryptoKey | null> {
    const cached = this.sharedKeys.get(slot);
    if (cached) return cached;
    const keyPair = await this.ownKeyPair();
    const publicKey = this.peerPublicKeys.get(slot);
    if (!keyPair || !publicKey) return null;
    const key = await crypto.subtle.deriveKey(
      { name: "ECDH", public: publicKey },
      keyPair.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    this.sharedKeys.set(slot, key);
    return key;
  }

  private async encryptPrivatePayload(
    slot: string,
    payload: IronsmithPrivatePayload,
  ): Promise<EncryptedRelayPayload | null> {
    try {
      const key = await this.sharedKeyFor(slot);
      if (!key) return null;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(payload));
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
      );
      return { iv: bytesToBase64(iv), data: bytesToBase64(encrypted) };
    } catch (error) {
      console.warn(`[Ironsmith] failed to encrypt relay payload for ${slot}`, error);
      return null;
    }
  }

  private async decryptPrivatePayload(
    slot: string,
    payload: EncryptedRelayPayload,
  ): Promise<IronsmithPrivatePayload | null> {
    try {
      const key = await this.sharedKeyFor(slot);
      if (!key) return null;
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
        key,
        base64ToBytes(payload.data),
      );
      return JSON.parse(new TextDecoder().decode(decrypted)) as IronsmithPrivatePayload;
    } catch (error) {
      console.warn(`[Ironsmith] failed to decrypt relay payload from ${slot}`, error);
      return null;
    }
  }

  private authenticatedSenderSlot(
    message: RoomMessagePayload<IronsmithRoomRelayPayload>,
    envelopeFromPlayer: string | undefined,
  ): string | null {
    const authenticatedSlot = this.slotForUsername(message.from_player);
    if (!authenticatedSlot) {
      console.warn(`[Ironsmith] ignored relay from unknown room player ${message.from_player}`);
      return null;
    }
    if (envelopeFromPlayer && envelopeFromPlayer !== authenticatedSlot) {
      console.warn(
        `[Ironsmith] ignored relay envelope from ${envelopeFromPlayer}; authenticated sender is ${authenticatedSlot}`,
      );
      return null;
    }
    return authenticatedSlot;
  }

  private slotForUsername(username: string): string | null {
    const index = this.playerNames.indexOf(username);
    if (index >= 0) return `player-${index}`;
    return this.playerSlots.includes(username) ? username : null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
