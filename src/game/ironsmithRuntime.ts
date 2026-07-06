import initIronsmith, { WasmGame } from "ironsmith-wasm";
import ironsmithWasmModuleUrl from "ironsmith-wasm/ironsmith_bg.wasm?url";
import { getPlatform } from "@/platform";
import { createRoomRelayEnvelope, isRoomRelayProtocol } from "./roomRelay";
import type {
  IGameApi,
  RespondParams,
  RestoreSnapshotParams,
  SendDirectiveParams,
  StartGameParams,
  StartMultiplayerGameParams,
} from "@/platform";
import type { Deck } from "@/protocol/deck";
import type { DirectiveInput, GameFormat, Prompt, PromptOutput } from "@/protocol";
import type { GameViewDto } from "@/protocol/game";
import type { RoomMessagePayload } from "@/types/server";

let ironsmithInit: Promise<unknown> | null = null;
const IRONSMITH_RELAY_PROTOCOL = "ironsmith-trusted";

interface IronsmithPromptBinding {
  promptId: string;
  playerSlot: string;
  decisionKind: string;
  actionRefs: Record<string, unknown>;
  targetKinds: Record<string, "player" | "object" | "planeswalker" | "battle">;
  optionIndices: Record<string, number>;
}

interface IronsmithPromptMapping {
  forPlayer: string;
  prompt: Prompt;
  binding: IronsmithPromptBinding;
}

interface IronsmithFatalPrompt {
  forPlayer: string;
  message: string;
}

type IronsmithPromptResult = IronsmithPromptMapping | IronsmithFatalPrompt | null;

async function ensureIronsmith(): Promise<void> {
  ironsmithInit ??= initIronsmith({ module_or_path: ironsmithWasmModuleUrl }).catch((error) => {
    ironsmithInit = null;
    throw error;
  });
  await ironsmithInit;
}

type IronsmithWasmGame = InstanceType<typeof WasmGame> & {
  validateManabrewMatchConfig: (config: unknown) => { valid?: boolean };
  startManabrewMatch: (config: unknown) => unknown;
  manabrewView: (promptId: string) => {
    state?: { gameView?: GameViewDto };
    promptResult?: IronsmithPromptResult;
  };
  manabrewPublicState: () => { gameView?: GameViewDto };
  manabrewCommandFromPromptOutput: (
    output: PromptOutput,
    binding: IronsmithPromptBinding,
  ) => unknown;
};

function matchConfig(params: {
  playerNames: string[];
  decks: Deck[];
  commanderNames: Array<string | null>;
  startingLife: number;
  format?: GameFormat | null;
}) {
  return {
    playerNames: params.playerNames,
    startingLife: params.startingLife,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    format: params.format ?? null,
    decks: params.decks,
    commanderNames: params.commanderNames,
    openingHandSize: 7,
  };
}

interface EncryptedRelayPayload {
  iv: string;
  data: string;
}

type IronsmithPrivatePayload =
  | { type: "state"; state: { gameView: GameViewDto } }
  | { type: "prompt"; prompt: Prompt }
  | { type: "fatal"; message: string }
  | { type: "response"; action: PromptOutput }
  | { type: "directive"; directive: DirectiveInput };

type IronsmithRoomRelayPayload =
  | { type: "hello"; seat: string; isHost: boolean; publicKey: JsonWebKey }
  | { type: "private"; to: string; encrypted: EncryptedRelayPayload };

export class IronsmithTrustedGameApi implements IGameApi {
  private game: IronsmithWasmGame | null = null;
  private isMultiplayer = false;
  private isHost = false;
  private localPlayerSlot: string | null = null;
  private playerSlots: string[] = [];
  private botPlayerSlots = new Set<string>();
  private pendingBinding: IronsmithPromptBinding | null = null;
  private prompts = new Map<string, Prompt>();
  private roomRelayUnsubscribe: (() => void) | null = null;
  private keyPairPromise: Promise<CryptoKeyPair | null> | null = null;
  private peerPublicKeys = new Map<string, CryptoKey>();
  private peerKeyFingerprints = new Map<string, string>();
  private sharedKeys = new Map<string, CryptoKey>();
  private hostPlayerSlot: string | null = null;
  private promptSeq = 0;
  private concededPlayerSlots = new Set<string>();

  async startGame(params: StartGameParams): Promise<string> {
    const opponentDeck = params.opponentDeck ?? params.deck;
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
    this.isMultiplayer = true;
    this.isHost = params.localIsHost;
    this.localPlayerSlot = `player-${params.enginePlayerIndex}`;
    this.playerSlots = params.playerNames.map((_, index) => `player-${index}`);
    this.botPlayerSlots = botPlayerSlots(params.playerNames);
    this.prompts.clear();
    this.pendingBinding = null;
    this.concededPlayerSlots.clear();
    this.hostPlayerSlot = null;
    this.peerPublicKeys.clear();
    this.peerKeyFingerprints.clear();
    this.sharedKeys.clear();
    this.installRoomRelayListener();
    await this.sendRelayHello();

    if (!params.localIsHost) return;

    await this.startHost(params);
  }

  async respond(params: RespondParams): Promise<void> {
    const action = params.action;
    const playerSlot = params.playerSlot ?? this.localPlayerSlot ?? "player-0";
    if (this.isMultiplayer && !this.isHost) {
      const hostSlot = this.hostPlayerSlot;
      if (!hostSlot) {
        await this.sendRelayHello();
        throw new Error("Ironsmith host relay is not ready yet; try again in a moment.");
      }
      const sent = await this.sendPrivateRelay(hostSlot, { type: "response", action });
      if (!sent) {
        throw new Error("Ironsmith private relay is not ready yet; try again in a moment.");
      }
      return;
    }
    await this.applyResponse(playerSlot, action);
  }

  async sendDirective(params: SendDirectiveParams): Promise<void> {
    const playerSlot = params.playerSlot ?? this.localPlayerSlot ?? "player-0";
    if (this.isMultiplayer && !this.isHost) {
      const hostSlot = this.hostPlayerSlot;
      if (!hostSlot) {
        await this.sendRelayHello();
        throw new Error("Ironsmith host relay is not ready yet; try again in a moment.");
      }
      const sent = await this.sendPrivateRelay(hostSlot, {
        type: "directive",
        directive: params.directive,
      });
      if (!sent) {
        throw new Error("Ironsmith private relay is not ready yet; try again in a moment.");
      }
      return;
    }
    await this.applyDirective(playerSlot, params.directive);
  }

  async endGame(): Promise<void> {
    this.roomRelayUnsubscribe?.();
    this.roomRelayUnsubscribe = null;
    this.game?.free();
    this.game = null;
    this.isMultiplayer = false;
    this.isHost = false;
    this.localPlayerSlot = null;
    this.playerSlots = [];
    this.botPlayerSlots.clear();
    this.pendingBinding = null;
    this.prompts.clear();
    this.peerPublicKeys.clear();
    this.peerKeyFingerprints.clear();
    this.sharedKeys.clear();
    this.concededPlayerSlots.clear();
    this.hostPlayerSlot = null;
  }

  async restoreSnapshot(_params: RestoreSnapshotParams): Promise<void> {
    throw new Error("Ironsmith trusted runtime snapshots are not wired to Manabrew restore yet");
  }

  async getPresetDecks(): Promise<Deck[]> {
    return [];
  }

  async getPrompt(): Promise<Prompt | null> {
    return this.localPlayerSlot ? (this.prompts.get(this.localPlayerSlot) ?? null) : null;
  }

  private async startHost(
    params: StartMultiplayerGameParams,
    botSlots = botPlayerSlots(params.playerNames),
  ): Promise<void> {
    await ensureIronsmith();
    await this.endHostOnly();
    const game = new WasmGame() as IronsmithWasmGame;
    this.game = game;
    this.isHost = true;
    this.localPlayerSlot = `player-${params.enginePlayerIndex}`;
    this.playerSlots = params.playerNames.map((_, index) => `player-${index}`);
    this.botPlayerSlots = botSlots;
    const config = matchConfig(params);
    const validation = game.validateManabrewMatchConfig(config);
    if (
      validation &&
      typeof validation === "object" &&
      "valid" in validation &&
      validation.valid === false
    ) {
      throw new Error(`Ironsmith rejected match config: ${JSON.stringify(validation)}`);
    }
    game.startManabrewMatch(config);
    await this.publish();
  }

  private async endHostOnly(): Promise<void> {
    this.game?.free();
    this.game = null;
    this.pendingBinding = null;
    this.prompts.clear();
    this.concededPlayerSlots.clear();
  }

  private async applyResponse(playerSlot: string, action: PromptOutput): Promise<void> {
    if (!this.game) return;
    const binding = this.pendingBinding;
    if (!binding || binding.playerSlot !== playerSlot) {
      await this.publish();
      return;
    }
    try {
      const command = this.mapPromptOutputToCommand(action, binding);
      this.game.dispatch(command);
    } finally {
      await this.publish();
    }
  }

  private async applyDirective(playerSlot: string, directive: DirectiveInput): Promise<void> {
    if (!this.game) return;
    try {
      if (directive.type === "concede") {
        this.concededPlayerSlots.add(playerSlot);
        this.game.forfeitPlayer(Number(playerSlot.replace("player-", "")));
      }
    } finally {
      await this.publish();
    }
  }

  private async publish(): Promise<void> {
    if (!this.game) return;
    const platform = getPlatform();
    this.prompts.clear();
    this.pendingBinding = null;
    let localStateSent = false;
    let publicStateSent = false;
    let botResponse: { slot: string; action: PromptOutput } | null = null;

    for (const slot of this.playerSlots) {
      const index = Number(slot.replace("player-", ""));
      this.game.setPerspective(index);
      const { gameView, prompt } = this.readManabrewView(String(++this.promptSeq));
      if (this.isMultiplayer && !publicStateSent) {
        publicStateSent = true;
        await platform.server?.broadcastState({
          kind: "state",
          state: this.readPublicState(),
        });
      }
      if (slot === this.localPlayerSlot) {
        platform.events.emit("game:state", { gameView });
        localStateSent = true;
      } else if (this.isMultiplayer && !this.botPlayerSlots.has(slot)) {
        await this.sendPrivateRelay(slot, { type: "state", state: { gameView } });
      }

      if (!prompt || prompt.forPlayer !== slot) continue;
      if ("message" in prompt) {
        if (slot === this.localPlayerSlot) {
          platform.events.emit("game:fatal", { message: prompt.message });
        } else if (this.isMultiplayer && !this.botPlayerSlots.has(slot)) {
          await this.sendPrivateRelay(slot, { type: "fatal", message: prompt.message });
        }
        continue;
      }
      this.prompts.set(slot, prompt.prompt);
      this.pendingBinding = prompt.binding;
      const autoAction =
        this.isHost && this.botPlayerSlots.has(slot) ? botPromptOutput(prompt.prompt) : null;
      if (autoAction) {
        botResponse = { slot, action: autoAction };
      } else if (slot === this.localPlayerSlot) {
        platform.events.emit("game:prompt", prompt.prompt);
      } else if (this.isMultiplayer && !this.botPlayerSlots.has(slot)) {
        await this.sendPrivateRelay(slot, { type: "prompt", prompt: prompt.prompt });
      }
    }

    if (!localStateSent && this.playerSlots.length === 0) {
      this.game.setPerspective(0);
      platform.events.emit("game:state", this.readManabrewView(String(++this.promptSeq)).state);
    }

    if (botResponse) {
      await this.applyResponse(botResponse.slot, botResponse.action);
    }
  }

  private readManabrewView(promptId: string): {
    state: { gameView: GameViewDto };
    gameView: GameViewDto;
    prompt: IronsmithPromptResult;
  } {
    if (!this.game) throw new Error("Ironsmith game is not initialized");
    const view = this.game.manabrewView(promptId);
    const rawGameView = view.state?.gameView;
    const gameView = rawGameView ? this.applyKnownPlayerStatuses(rawGameView) : null;
    if (!gameView) {
      throw new Error("Ironsmith WASM did not return a Manabrew game view");
    }
    return {
      state: { gameView },
      gameView,
      prompt: view.promptResult ?? null,
    };
  }

  private readPublicState(): { gameView: GameViewDto } {
    const state = this.game?.manabrewPublicState();
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

  private mapPromptOutputToCommand(action: PromptOutput, binding: IronsmithPromptBinding): unknown {
    if (!this.game) throw new Error("Ironsmith game is not initialized");
    return this.game.manabrewCommandFromPromptOutput(action, binding);
  }

  private installRoomRelayListener(): void {
    this.roomRelayUnsubscribe?.();
    this.roomRelayUnsubscribe = getPlatform().events.on<
      RoomMessagePayload<IronsmithRoomRelayPayload>
    >("server:room_message", (payload) => {
      void this.handleRoomRelay(payload);
    });
  }

  private async handleRoomRelay(
    message: RoomMessagePayload<IronsmithRoomRelayPayload>,
  ): Promise<void> {
    const envelope = message.state;
    if (!isRoomRelayProtocol<IronsmithRoomRelayPayload>(envelope, IRONSMITH_RELAY_PROTOCOL)) {
      return;
    }
    const relayPayload = envelope.payload;
    const sender = envelope.fromPlayer ?? message.from_player;
    if (sender && sender === this.localPlayerSlot) return;

    if (relayPayload.type === "hello") {
      if (relayPayload.seat === this.localPlayerSlot) return;
      const changed = await this.rememberPeerKey(relayPayload.seat, relayPayload.publicKey);
      if (relayPayload.isHost) this.hostPlayerSlot = relayPayload.seat;
      if (changed) {
        await this.sendRelayHello();
        if (this.isHost && this.game) await this.publish();
      }
      return;
    }

    if (relayPayload.type !== "private") return;
    if (relayPayload.to !== this.localPlayerSlot || !sender) return;
    const privatePayload = await this.decryptPrivatePayload(sender, relayPayload.encrypted);
    if (!privatePayload) return;
    const platform = getPlatform();
    switch (privatePayload.type) {
      case "state":
        platform.events.emit("game:state", privatePayload.state);
        return;
      case "prompt":
        if (this.localPlayerSlot) this.prompts.set(this.localPlayerSlot, privatePayload.prompt);
        platform.events.emit("game:prompt", privatePayload.prompt);
        return;
      case "fatal":
        platform.events.emit("game:fatal", { message: privatePayload.message });
        return;
      case "response":
        if (this.isHost) await this.applyResponse(sender, privatePayload.action);
        return;
      case "directive":
        if (this.isHost) await this.applyDirective(sender, privatePayload.directive);
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
      isHost: this.isHost,
      publicKey,
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
        targetPlayer,
        payload,
      }),
    );
  }

  private async ownKeyPair(): Promise<CryptoKeyPair | null> {
    if (!crypto.subtle) return null;
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
    const fingerprint = JSON.stringify(publicKey);
    if (this.peerKeyFingerprints.get(slot) === fingerprint) return false;
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

function botPlayerSlots(playerNames: string[]): Set<string> {
  return new Set(
    playerNames.flatMap((name, index) =>
      name.toLowerCase().includes("-bot-") ? [`player-${index}`] : [],
    ),
  );
}

function botPromptOutput(prompt: Prompt): PromptOutput | null {
  switch (prompt.input.type) {
    case "mulligan":
      return { type: "mulligan", output: { type: "mulliganDecision", keep: true } };
    case "mulliganPutBack": {
      const cards =
        prompt.input.cards.length > 0
          ? prompt.input.cards.map((card) => card.id)
          : prompt.input.handCardIds;
      return {
        type: "mulliganPutBack",
        output: { type: "mulliganPutBackDecision", cardIds: cards.slice(0, prompt.input.count) },
      };
    }
    case "chooseAction":
      return { type: "chooseAction", output: { type: "pass" } };
    case "payManaCost":
      return { type: "payManaCost", output: { type: "cancel" } };
    case "chooseBoardTargets":
      return {
        type: "chooseBoardTargets",
        output: {
          type: "boardTargets",
          chosen: prompt.input.candidates.slice(0, prompt.input.minTargets),
        },
      };
    case "chooseAttackers":
      return { type: "chooseAttackers", output: { type: "declareAttackers", assignments: [] } };
    case "chooseBlockers":
      return { type: "chooseBlockers", output: { type: "declareBlockers", assignments: [] } };
    case "chooseBoolean":
      return { type: "chooseBoolean", output: { type: "decision", value: false } };
    case "chooseFromSelection": {
      const count = Math.max(0, Math.min(prompt.input.minChoices, prompt.input.options.length));
      return {
        type: "chooseFromSelection",
        output: {
          type: "selectionDecision",
          chosenIndices: Array.from({ length: count }, (_, index) => index),
        },
      };
    }
    case "chooseNumber":
      return {
        type: "chooseNumber",
        output: { type: "numberDecision", chosenNumber: prompt.input.min },
      };
    case "chooseColor": {
      const color = prompt.input.validColors[0];
      if (!color) return null;
      return {
        type: "chooseColor",
        output: { type: "colorDecision", chosenColors: { [color]: prompt.input.amount } },
      };
    }
    case "chooseCards":
      return {
        type: "chooseCards",
        output: {
          type: "chooseCardsDecision",
          chosenCardIds: prompt.input.cards.slice(0, prompt.input.min).map((card) => card.id),
        },
      };
    case "reorderCards":
      return {
        type: "reorderCards",
        output: {
          type: "reorderDecision",
          orderedCardIds: prompt.input.cards.map((card) => card.id),
        },
      };
    case "revealCards":
      return { type: "revealCards", output: { type: "revealCardsAcknowledged" } };
    case "scry": {
      const firstZone = prompt.input.cards.map((card) => card.id);
      return {
        type: "scry",
        output: {
          type: "scryDecision",
          zoneCardIds: prompt.input.zones.map((_, index) => (index === 0 ? firstZone : [])),
        },
      };
    }
    case "chooseDamageAssignmentOrder":
      return {
        type: "chooseDamageAssignmentOrder",
        output: {
          type: "damageAssignmentOrderDecision",
          orderedBlockerIds: prompt.input.blockerIds,
        },
      };
    case "chooseCombatDamageAssignment": {
      const assigneeId = prompt.input.blockerIds[0] ?? prompt.input.defenderId;
      if (!assigneeId) return null;
      return {
        type: "chooseCombatDamageAssignment",
        output: {
          type: "combatDamageAssignmentDecision",
          assignments: [{ assigneeId, damage: prompt.input.totalDamage }],
        },
      };
    }
    case "diceRolled":
      return { type: "diceRolled", output: { type: "diceRolledAcknowledged" } };
    default:
      return null;
  }
}
