import type { Prompt, PromptOutput } from "@/protocol";
import type { CardDto, GameViewDto, StackObjectDto, TargetingIntent } from "@/protocol/game";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { TargetRef } from "@/protocol/prompts/common";

type JsonRecord = Record<string, unknown>;

export interface IronsmithPromptBinding {
  promptId: string;
  playerSlot: string;
  decisionKind: string;
  actionRefs: Record<string, unknown>;
  targetKinds: Record<string, "player" | "object" | "planeswalker" | "battle">;
  optionIndices: Record<string, number>;
}

export interface IronsmithPromptMapping {
  forPlayer: string;
  prompt: Prompt;
  binding: IronsmithPromptBinding;
}

export interface IronsmithFatalPrompt {
  forPlayer: string;
  message: string;
}

export type IronsmithPromptResult = IronsmithPromptMapping | IronsmithFatalPrompt | null;

export interface IronsmithExternalCardSource {
  canonicalName: string;
  aliases: Array<{ alias: string; canonical: string }>;
  group: {
    kind: "single";
    name: string;
    block: string;
    score: number;
  };
}

const CARD_DEFAULTS = {
  color: "",
  manaCost: "",
  cmc: 0,
  types: [],
  subtypes: [],
  supertypes: [],
  power: null,
  toughness: null,
  text: "",
  tapped: false,
  isCrewed: false,
  isAttacking: false,
  keywords: [],
  counters: {},
  damage: 0,
  summoningSick: false,
  isCopy: false,
  isDoubleFaced: false,
  isTransformed: false,
  isFaceDown: false,
  isBestowed: false,
  phasedOut: false,
  exerted: false,
  isRingBearer: false,
  attachmentIds: [],
  isMadnessExiled: false,
  isPlotted: false,
  isWarpExiled: false,
  foil: false,
  wouldDieInCombat: false,
} satisfies Omit<CardDto, "id" | "identity" | "controllerId" | "ownerId" | "zoneId">;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function valueOf<T>(source: JsonRecord, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (key in source) return source[key] as T;
  }
  return undefined;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function playerSlot(index: unknown): string {
  return `player-${Math.max(0, Math.trunc(numberValue(index)))}`;
}

export function cardId(raw: unknown): string {
  return `card-${String(raw ?? "unknown")}`;
}

function stackId(raw: unknown): string {
  return `stack-${String(raw ?? "unknown")}`;
}

function hiddenCardId(owner: string, index: number): string {
  return `hidden-${owner}-${index}`;
}

function parseObjectId(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function parsePlayerIndex(id: string): number {
  const match = /^player-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function splitPowerToughness(value: unknown): [string | null, string | null] {
  if (typeof value !== "string") return [null, null];
  const [power, toughness] = value.split("/");
  return [power || null, toughness || null];
}

function identity(name: string, token = false) {
  return { name, setCode: "", cardNumber: "", isToken: token };
}

function counters(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of arrayOf(value)) {
    const counter = record(entry);
    const kind = stringValue(valueOf(counter, "kind"));
    if (kind) result[kind] = numberValue(valueOf(counter, "amount"));
  }
  return result;
}

function manaPool(value: unknown): Record<string, number> {
  const pool = record(value);
  return {
    W: numberValue(valueOf(pool, "white")),
    U: numberValue(valueOf(pool, "blue")),
    B: numberValue(valueOf(pool, "black")),
    R: numberValue(valueOf(pool, "red")),
    G: numberValue(valueOf(pool, "green")),
    C: numberValue(valueOf(pool, "colorless")),
  };
}

function cardFromZoneCard(
  value: unknown,
  ownerId: string,
  controllerId: string,
  zoneId: string,
): CardDto {
  const card = record(value);
  const name = stringValue(valueOf(card, "name"), "Hidden Card");
  const [power, toughness] = splitPowerToughness(
    valueOf(card, "power_toughness", "powerToughness"),
  );
  return {
    ...CARD_DEFAULTS,
    id: cardId(valueOf(card, "id", "stable_id", "stableId")),
    identity: identity(name),
    manaCost: stringValue(valueOf(card, "mana_cost", "manaCost")),
    types: arrayOf(valueOf(card, "card_types", "cardTypes")).map((type) => String(type)),
    power,
    toughness,
    text: stringValue(valueOf(card, "oracle_text", "oracleText")),
    controllerId,
    ownerId,
    zoneId,
  };
}

function hiddenCard(ownerId: string, index: number): CardDto {
  return {
    ...CARD_DEFAULTS,
    id: hiddenCardId(ownerId, index),
    identity: identity("Hidden Card"),
    controllerId: ownerId,
    ownerId,
    zoneId: "hand",
    isFaceDown: true,
  };
}

function permanentCard(value: unknown, ownerId: string): CardDto {
  const permanent = record(value);
  const name = stringValue(valueOf(permanent, "name"), "Permanent");
  const [power, toughness] = splitPowerToughness(
    valueOf(permanent, "power_toughness", "powerToughness"),
  );
  const lane = stringValue(valueOf(permanent, "lane")).toLowerCase();
  return {
    ...CARD_DEFAULTS,
    id: cardId(valueOf(permanent, "id", "stable_id", "stableId")),
    identity: identity(name, boolValue(valueOf(permanent, "token"))),
    manaCost: stringValue(valueOf(permanent, "mana_cost", "manaCost")),
    types: lane.includes("land") ? ["Land"] : [],
    power,
    toughness,
    text: stringValue(valueOf(permanent, "oracle_text", "oracleText")),
    controllerId: ownerId,
    ownerId,
    zoneId: "battlefield",
    tapped: boolValue(valueOf(permanent, "tapped")),
    counters: counters(valueOf(permanent, "counters")),
  };
}

function stackObject(value: unknown): StackObjectDto {
  const stack = record(value);
  const id = stackId(valueOf(stack, "id", "stable_id", "stableId"));
  const controllerId = playerSlot(valueOf(stack, "controller"));
  const name = stringValue(valueOf(stack, "name"), "Stack object");
  return {
    id,
    sourceId: cardId(
      valueOf(
        stack,
        "inspect_object_id",
        "inspectObjectId",
        "source_stable_id",
        "sourceStableId",
        "stable_id",
        "stableId",
        "id",
      ),
    ),
    controllerId,
    identity: identity(name),
    text: stringValue(valueOf(stack, "ability_text", "abilityText", "effect_text", "effectText")),
    isPermanentSpell: false,
    isCasting: false,
    targets: arrayOf(valueOf(stack, "targets")).flatMap((target) => targetRef(target)),
  };
}

function normalizeStep(snapshot: JsonRecord): string {
  const raw = stringValue(
    valueOf(snapshot, "step"),
    stringValue(valueOf(snapshot, "phase"), "main1"),
  );
  const normalized = raw.toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("precombat")) return "main1";
  if (normalized.includes("postcombat")) return "main2";
  if (normalized.includes("combat")) return "combat";
  if (normalized.includes("draw")) return "draw";
  if (normalized.includes("upkeep")) return "upkeep";
  if (normalized.includes("end")) return "end";
  return normalized || "main1";
}

function gameOver(snapshot: JsonRecord): { over: boolean; winnerId: string | null } {
  const raw = record(valueOf(snapshot, "game_over", "gameOver"));
  const kind = stringValue(valueOf(raw, "kind"));
  if (!kind) return { over: false, winnerId: null };
  if (kind === "winner") return { over: true, winnerId: playerSlot(valueOf(raw, "player")) };
  if (kind === "remaining") {
    const remaining = arrayOf(valueOf(raw, "players"));
    return {
      over: remaining.length <= 1,
      winnerId: remaining.length === 1 ? playerSlot(remaining[0]) : null,
    };
  }
  return { over: true, winnerId: null };
}

export function mapIronsmithSnapshotToGameView(snapshotValue: unknown): GameViewDto {
  const snapshot = record(snapshotValue);
  const players = arrayOf(valueOf(snapshot, "players")).map((playerValue) => {
    const player = record(playerValue);
    const id = playerSlot(valueOf(player, "id"));
    const handCards = arrayOf(valueOf(player, "hand_cards", "handCards")).map((card) =>
      cardFromZoneCard(card, id, id, "hand"),
    );
    const handSize = numberValue(valueOf(player, "hand_size", "handSize"), handCards.length);
    const visibleHand =
      handCards.length > 0 || boolValue(valueOf(player, "can_view_hand", "canViewHand"));
    return {
      id,
      name: stringValue(valueOf(player, "name"), id),
      isHuman: true,
      life: numberValue(valueOf(player, "life"), 20),
      poison: 0,
      hand: visibleHand
        ? handCards
        : Array.from({ length: handSize }, (_, index) => hiddenCard(id, index)),
      graveyard: arrayOf(valueOf(player, "graveyard_cards", "graveyardCards")).map((card) =>
        cardFromZoneCard(card, id, id, "graveyard"),
      ),
      exile: arrayOf(valueOf(player, "exile_cards", "exileCards")).map((card) =>
        cardFromZoneCard(card, id, id, "exile"),
      ),
      commandZone: arrayOf(valueOf(player, "command_cards", "commandCards")).map((card) =>
        cardFromZoneCard(card, id, id, "command"),
      ),
      libraryCount: numberValue(valueOf(player, "library_size", "librarySize")),
      manaPool: manaPool(valueOf(player, "mana_pool", "manaPool")),
      commanderDamage: {},
      energyCounters: 0,
      radiationCounters: 0,
      hasCityBlessing: false,
      ringLevel: 0,
      speed: 0,
      experienceCounters: 0,
      ticketCounters: 0,
    };
  });
  const battlefield = arrayOf(valueOf(snapshot, "players")).flatMap((playerValue) => {
    const player = record(playerValue);
    const ownerId = playerSlot(valueOf(player, "id"));
    return arrayOf(valueOf(player, "battlefield")).map((permanent) =>
      permanentCard(permanent, ownerId),
    );
  });
  const over = gameOver(snapshot);
  return {
    gameId: `ironsmith-${String(valueOf(snapshot, "snapshot_id", "snapshotId") ?? "game")}`,
    turn: numberValue(valueOf(snapshot, "turn_number", "turnNumber"), 1),
    step: normalizeStep(snapshot),
    combatAssignments: [],
    activePlayerId: playerSlot(valueOf(snapshot, "active_player", "activePlayer")),
    priorityPlayerId: playerSlot(
      valueOf(snapshot, "priority_player", "priorityPlayer") ??
        valueOf(snapshot, "active_player", "activePlayer"),
    ),
    players,
    battlefield,
    stack: arrayOf(valueOf(snapshot, "stack_objects", "stackObjects")).map(stackObject),
    gameOver: over.over,
    winnerId: over.winnerId,
    concededPlayerIds: [],
    monarchId: null,
    initiativeHolderId: null,
  };
}

export function redactPrivateGameView(gameView: GameViewDto): GameViewDto {
  return {
    ...gameView,
    players: gameView.players.map((player) => ({
      ...player,
      hand: player.hand.map((_, index) => hiddenCard(player.id, index)),
    })),
  };
}

function presentation(title: string, description?: string, sourceCardId?: string) {
  return { title, description, sourceCardId, targets: [] };
}

function sourceCardId(decision: JsonRecord): string | undefined {
  const raw = valueOf(decision, "source_id", "sourceId");
  return raw == null ? undefined : cardId(raw);
}

function legalOptions(decision: JsonRecord): JsonRecord[] {
  return arrayOf(valueOf(decision, "options"))
    .map(record)
    .filter((option) => boolValue(valueOf(option, "legal"), true));
}

function optionDescription(option: JsonRecord): string {
  return stringValue(valueOf(option, "description"), String(valueOf(option, "index") ?? ""));
}

function targetRef(value: unknown): TargetRef[] {
  const target = record(value);
  const kind = stringValue(valueOf(target, "kind"));
  if (kind === "player") return [{ kind: "player", id: playerSlot(valueOf(target, "player")) }];
  if (kind === "object") return [{ kind: "card", id: cardId(valueOf(target, "object")) }];
  return [];
}

const ZERO_PAYLOAD_PRIORITY_REF_KINDS: Record<string, string> = {
  PassPriority: "pass_priority",
  passPriority: "pass_priority",
  pass_priority: "pass_priority",
  KeepOpeningHand: "keep_opening_hand",
  keepOpeningHand: "keep_opening_hand",
  keep_opening_hand: "keep_opening_hand",
  TakeMulligan: "take_mulligan",
  takeMulligan: "take_mulligan",
  take_mulligan: "take_mulligan",
  ContinuePregame: "continue_pregame",
  continuePregame: "continue_pregame",
  continue_pregame: "continue_pregame",
  BeginGame: "begin_game",
  beginGame: "begin_game",
  begin_game: "begin_game",
};

function priorityActionRefKind(actionRef: unknown): string {
  if (typeof actionRef === "string") return ZERO_PAYLOAD_PRIORITY_REF_KINDS[actionRef] ?? "";
  const kind = stringValue(valueOf(record(actionRef), "kind"));
  return ZERO_PAYLOAD_PRIORITY_REF_KINDS[kind] ?? kind;
}

function normalizePriorityActionRef(actionRef: unknown): unknown | null {
  if (actionRef == null) return null;
  const kind = priorityActionRefKind(actionRef);
  if (!kind) return actionRef;
  if (typeof actionRef === "string") return { kind };
  return { ...record(actionRef), kind };
}

function priorityActionLabel(action: JsonRecord, index: number): string {
  return stringValue(valueOf(action, "label"), `Action ${index + 1}`);
}

function bindPriorityAction(action: JsonRecord, index: number, binding: IronsmithPromptBinding) {
  const actionRef = valueOf(action, "action_ref", "actionRef");
  const normalizedActionRef = normalizePriorityActionRef(actionRef);
  binding.actionRefs[String(index)] = normalizedActionRef;
}

function priorityPrompt(decision: JsonRecord, promptId: string): IronsmithPromptMapping {
  const forPlayer = playerSlot(valueOf(decision, "player"));
  const binding: IronsmithPromptBinding = {
    promptId,
    playerSlot: forPlayer,
    decisionKind: "priority",
    actionRefs: {},
    targetKinds: {},
    optionIndices: {},
  };
  const actions = arrayOf(valueOf(decision, "actions")).map(record);
  actions.forEach((action, index) => bindPriorityAction(action, index, binding));
  const description = stringValue(valueOf(decision, "description"));
  return {
    forPlayer,
    prompt: {
      promptId,
      decidingPlayerId: forPlayer,
      input: {
        type: "chooseFromSelection",
        presentation: presentation("Choose action", description || undefined),
        options: actions.map(priorityActionLabel),
        minChoices: actions.length > 0 ? 1 : 0,
        maxChoices: actions.length > 0 ? 1 : 0,
      },
    },
    binding,
  };
}

function numberPrompt(decision: JsonRecord, promptId: string): IronsmithPromptMapping {
  const forPlayer = playerSlot(valueOf(decision, "player"));
  return {
    forPlayer,
    prompt: {
      promptId,
      decidingPlayerId: forPlayer,
      sourceCardId: sourceCardId(decision),
      input: {
        type: "chooseNumber",
        presentation: presentation(
          "Choose a number",
          stringValue(valueOf(decision, "description")),
          sourceCardId(decision),
        ),
        min: numberValue(valueOf(decision, "min")),
        max: numberValue(valueOf(decision, "max")),
      },
    },
    binding: {
      promptId,
      playerSlot: forPlayer,
      decisionKind: "number",
      actionRefs: {},
      targetKinds: {},
      optionIndices: {},
    },
  };
}

function optionsPrompt(decision: JsonRecord, promptId: string): IronsmithPromptMapping {
  const forPlayer = playerSlot(valueOf(decision, "player"));
  const binding: IronsmithPromptBinding = {
    promptId,
    playerSlot: forPlayer,
    decisionKind: "select_options",
    actionRefs: {},
    targetKinds: {},
    optionIndices: {},
  };
  const options = legalOptions(decision);
  options.forEach((option, index) => {
    binding.optionIndices[String(index)] = numberValue(valueOf(option, "index"), index);
  });
  const labels = options.map(optionDescription);
  const colorSet = new Set([
    "White",
    "Blue",
    "Black",
    "Red",
    "Green",
    "Colorless",
    "W",
    "U",
    "B",
    "R",
    "G",
    "C",
  ]);
  if (labels.length > 0 && labels.every((label) => colorSet.has(label))) {
    labels.forEach((label, index) => {
      binding.optionIndices[colorLetter(label)] = numberValue(
        valueOf(options[index], "index"),
        index,
      );
    });
    return {
      forPlayer,
      prompt: {
        promptId,
        decidingPlayerId: forPlayer,
        sourceCardId: sourceCardId(decision),
        input: {
          type: "chooseColor",
          validColors: labels.map((label) => colorLetter(label)),
          amount: numberValue(valueOf(decision, "max"), 1),
          repeatAllowed: true,
        },
      },
      binding,
    };
  }
  if (
    labels.length === 2 &&
    numberValue(valueOf(decision, "min")) === 1 &&
    numberValue(valueOf(decision, "max")) === 1
  ) {
    return {
      forPlayer,
      prompt: {
        promptId,
        decidingPlayerId: forPlayer,
        sourceCardId: sourceCardId(decision),
        input: {
          type: "chooseBoolean",
          presentation: presentation(
            "Choose",
            stringValue(valueOf(decision, "description")),
            sourceCardId(decision),
          ),
          confirmLabel: labels[0],
          denyLabel: labels[1],
        },
      },
      binding,
    };
  }
  return {
    forPlayer,
    prompt: {
      promptId,
      decidingPlayerId: forPlayer,
      sourceCardId: sourceCardId(decision),
      input: {
        type: "chooseFromSelection",
        presentation: presentation(
          "Choose",
          stringValue(valueOf(decision, "description")),
          sourceCardId(decision),
        ),
        options: labels,
        minChoices: numberValue(valueOf(decision, "min")),
        maxChoices: numberValue(valueOf(decision, "max"), labels.length),
      },
    },
    binding,
  };
}

function colorLetter(label: string): string {
  return (
    {
      White: "W",
      Blue: "U",
      Black: "B",
      Red: "R",
      Green: "G",
      Colorless: "C",
    }[label] ?? label
  );
}

function objectChoiceCard(value: unknown, ownerId: string): CardDto {
  const candidate = record(value);
  return {
    ...CARD_DEFAULTS,
    id: cardId(valueOf(candidate, "id", "stable_id", "stableId")),
    identity: identity(stringValue(valueOf(candidate, "name"), "Card")),
    controllerId: playerSlot(
      valueOf(candidate, "object_controller", "objectController") ?? parsePlayerIndex(ownerId),
    ),
    ownerId,
    zoneId: "choice",
  };
}

function objectsPrompt(decision: JsonRecord, promptId: string): IronsmithPromptMapping {
  const forPlayer = playerSlot(valueOf(decision, "player"));
  const candidates = arrayOf(valueOf(decision, "candidates")).filter((candidate) =>
    boolValue(valueOf(record(candidate), "legal"), true),
  );
  const cards = candidates.map((candidate) => objectChoiceCard(candidate, forPlayer));
  const reorder = stringValue(
    valueOf(decision, "selection_identity", "selectionIdentity"),
  ).includes("order");
  const binding: IronsmithPromptBinding = {
    promptId,
    playerSlot: forPlayer,
    decisionKind: reorder ? "reorder_objects" : "select_objects",
    actionRefs: {},
    targetKinds: {},
    optionIndices: {},
  };
  if (reorder) {
    return {
      forPlayer,
      prompt: {
        promptId,
        decidingPlayerId: forPlayer,
        sourceCardId: sourceCardId(decision),
        input: {
          type: "reorderCards",
          presentation: presentation(
            "Reorder cards",
            stringValue(valueOf(decision, "description")),
            sourceCardId(decision),
          ),
          cards,
          targetLabel: "top",
          topOfDeck: true,
        },
      },
      binding,
    };
  }
  return {
    forPlayer,
    prompt: {
      promptId,
      decidingPlayerId: forPlayer,
      sourceCardId: sourceCardId(decision),
      input: {
        type: "chooseCards",
        presentation: presentation(
          "Choose cards",
          stringValue(valueOf(decision, "description")),
          sourceCardId(decision),
        ),
        cards,
        min: numberValue(valueOf(decision, "min")),
        max: numberValue(valueOf(decision, "max"), cards.length),
      },
    },
    binding,
  };
}

function targetsPrompt(decision: JsonRecord, promptId: string): IronsmithPromptMapping {
  const forPlayer = playerSlot(valueOf(decision, "player"));
  const binding: IronsmithPromptBinding = {
    promptId,
    playerSlot: forPlayer,
    decisionKind: "targets",
    actionRefs: {},
    targetKinds: {},
    optionIndices: {},
  };
  const requirements = arrayOf(valueOf(decision, "requirements")).map(record);
  const candidates = requirements.flatMap((requirement) =>
    arrayOf(valueOf(requirement, "legal_targets", "legalTargets")).flatMap((target) => {
      const refs = targetRef(target);
      refs.forEach((ref) => {
        binding.targetKinds[ref.id] = ref.kind === "player" ? "player" : "object";
      });
      return refs;
    }),
  );
  const minTargets = requirements.reduce(
    (sum, req) => sum + numberValue(valueOf(req, "min_targets", "minTargets")),
    0,
  );
  const maxTargets = requirements.reduce(
    (sum, req) =>
      sum +
      numberValue(
        valueOf(req, "max_targets", "maxTargets"),
        numberValue(valueOf(req, "min_targets", "minTargets")),
      ),
    0,
  );
  return {
    forPlayer,
    prompt: {
      promptId,
      decidingPlayerId: forPlayer,
      sourceCardId: sourceCardId(decision),
      input: {
        type: "chooseBoardTargets",
        candidates,
        hostile: true,
        intent: "hostile" as TargetingIntent,
        minTargets,
        maxTargets,
        chosenTargets: 0,
        label: stringValue(valueOf(decision, "context"), "Choose targets"),
      },
    },
    binding,
  };
}

function attackersPrompt(decision: JsonRecord, promptId: string): IronsmithPromptMapping {
  const forPlayer = playerSlot(valueOf(decision, "player"));
  const targetMap = new Map<
    string,
    { id: string; label: string; kind: "player" | "planeswalker" | "battle" }
  >();
  const attackers = arrayOf(valueOf(decision, "attacker_options", "attackerOptions")).map(
    (optionValue) => {
      const option = record(optionValue);
      const validTargetIds = arrayOf(valueOf(option, "valid_targets", "validTargets")).flatMap(
        (targetValue) => {
          const target = record(targetValue);
          const kind = stringValue(valueOf(target, "kind"));
          const id =
            kind === "player"
              ? playerSlot(valueOf(target, "player"))
              : cardId(valueOf(target, "object"));
          targetMap.set(id, {
            id,
            label: stringValue(valueOf(target, "name"), id),
            kind: kind === "player" ? "player" : "planeswalker",
          });
          return [id];
        },
      );
      return {
        attackerId: cardId(valueOf(option, "creature")),
        validTargetIds,
        mustAttack: boolValue(valueOf(option, "must_attack", "mustAttack")),
      };
    },
  );
  return {
    forPlayer,
    prompt: {
      promptId,
      decidingPlayerId: forPlayer,
      input: {
        type: "chooseAttackers",
        attackers,
        attackTargets: [...targetMap.values()],
      },
    },
    binding: {
      promptId,
      playerSlot: forPlayer,
      decisionKind: "attackers",
      actionRefs: {},
      targetKinds: Object.fromEntries(
        [...targetMap.values()].map((target) => [
          target.id,
          target.kind === "player" ? "player" : "planeswalker",
        ]),
      ),
      optionIndices: {},
    },
  };
}

function blockersPrompt(decision: JsonRecord, promptId: string): IronsmithPromptMapping {
  const forPlayer = playerSlot(valueOf(decision, "player"));
  const blockers = new Set<string>();
  const attackers = arrayOf(valueOf(decision, "blocker_options", "blockerOptions")).map(
    (optionValue) => {
      const option = record(optionValue);
      const validBlockerIds = arrayOf(valueOf(option, "valid_blockers", "validBlockers")).map(
        (blockerValue) => {
          const id = cardId(valueOf(record(blockerValue), "id"));
          blockers.add(id);
          return id;
        },
      );
      return {
        attackerId: cardId(valueOf(option, "attacker")),
        validBlockerIds,
        minBlockers: numberValue(valueOf(option, "min_blockers", "minBlockers")),
        maxBlockers: undefined,
        mustBeBlocked: numberValue(valueOf(option, "min_blockers", "minBlockers")) > 0,
      };
    },
  );
  return {
    forPlayer,
    prompt: {
      promptId,
      decidingPlayerId: forPlayer,
      input: {
        type: "chooseBlockers",
        attackers,
        availableBlockerIds: [...blockers],
      },
    },
    binding: {
      promptId,
      playerSlot: forPlayer,
      decisionKind: "blockers",
      actionRefs: {},
      targetKinds: {},
      optionIndices: {},
    },
  };
}

export function mapIronsmithPrompt(
  snapshotValue: unknown,
  promptId: string,
): IronsmithPromptResult {
  const snapshot = record(snapshotValue);
  const decision = record(valueOf(snapshot, "decision"));
  const kind = stringValue(valueOf(decision, "kind"));
  if (!kind) return null;
  if (kind === "text_input") {
    return {
      forPlayer: playerSlot(valueOf(decision, "player")),
      message: stringValue(
        valueOf(decision, "description"),
        "Ironsmith text input prompts are not supported in Manabrew yet.",
      ),
    };
  }
  if (kind === "priority") {
    return priorityPrompt(decision, promptId);
  }
  if (kind === "number") return numberPrompt(decision, promptId);
  if (kind === "select_options") return optionsPrompt(decision, promptId);
  if (kind === "select_objects") return objectsPrompt(decision, promptId);
  if (kind === "targets") return targetsPrompt(decision, promptId);
  if (kind === "attackers") return attackersPrompt(decision, promptId);
  if (kind === "blockers") return blockersPrompt(decision, promptId);
  return {
    forPlayer: playerSlot(valueOf(decision, "player")),
    message: `Ironsmith decision kind is not supported in Manabrew yet: ${kind}`,
  };
}

function optionIndicesFromColors(
  output: Extract<PromptOutput, { type: "chooseColor" }>,
  binding: IronsmithPromptBinding,
): number[] {
  const colors = output.output.chosenColors;
  return Object.entries(colors).flatMap(([color, amount]) =>
    Array.from({ length: amount ?? 0 }, () => binding.optionIndices[color] ?? 0),
  );
}

function isPassPriorityActionId(actionId: string): boolean {
  return priorityActionRefKind(actionId) === "pass_priority";
}

function passPriorityActionRef(binding: IronsmithPromptBinding): unknown {
  const passLikeKinds = new Set([
    "pass_priority",
    "keep_opening_hand",
    "continue_pregame",
    "begin_game",
  ]);
  return (
    Object.values(binding.actionRefs)
      .map(normalizePriorityActionRef)
      .find((ref) => passLikeKinds.has(priorityActionRefKind(ref))) ?? { kind: "pass_priority" }
  );
}

function numericRefField(actionRef: unknown, ...keys: string[]): number | null {
  const value = valueOf(record(actionRef), ...keys);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseLegacyCastActionId(actionId: string): { objectId: number } | null {
  const rest = actionId.startsWith("cast:") ? actionId.slice("cast:".length) : null;
  if (!rest) return null;
  const [idPart] = rest.split(":");
  return { objectId: parseObjectId(idPart ?? "") };
}

function parseLegacyIndexedActionId(
  actionId: string,
  prefix: "ability:" | "tap:",
): { objectId: number; abilityIndex: number | null } | null {
  if (!actionId.startsWith(prefix)) return null;
  const parts = actionId.slice(prefix.length).split(":").filter(Boolean);
  if (parts.length === 0) return null;
  const maybeColor = parts.at(-1);
  if (maybeColor && /^[WUBRGC]$/.test(maybeColor)) parts.pop();
  const maybeIndex = parts.at(-1);
  const abilityIndex = maybeIndex != null && /^\d+$/.test(maybeIndex) ? Number(parts.pop()) : null;
  return { objectId: parseObjectId(parts.join(":")), abilityIndex };
}

function parseLegacyUntapActionId(actionId: string): { objectId: number } | null {
  const rest = actionId.startsWith("untap:") ? actionId.slice("untap:".length) : null;
  return rest ? { objectId: parseObjectId(rest) } : null;
}

function actionRefMatchesAbility(
  actionRef: unknown,
  objectId: number,
  abilityIndex: number | null,
): boolean {
  const source = numericRefField(actionRef, "source", "card_id", "cardId");
  if (source !== objectId) return false;
  if (abilityIndex == null) return true;
  return numericRefField(actionRef, "ability_index", "abilityIndex") === abilityIndex;
}

function findBoundPriorityActionRef(
  binding: IronsmithPromptBinding,
  predicate: (actionRef: unknown) => boolean,
): unknown | null {
  for (const actionRef of Object.values(binding.actionRefs).map(normalizePriorityActionRef)) {
    if (actionRef != null && typeof actionRef === "object" && predicate(actionRef))
      return actionRef;
  }
  return null;
}

function legacyManabrewActionRef(
  binding: IronsmithPromptBinding,
  actionId: string,
): unknown | null {
  const cast = parseLegacyCastActionId(actionId);
  if (cast) {
    return findBoundPriorityActionRef(binding, (actionRef) => {
      const kind = priorityActionRefKind(actionRef);
      if (kind === "cast_spell") {
        return numericRefField(actionRef, "spell_id", "spellId") === cast.objectId;
      }
      if (kind === "play_land") {
        return (
          numericRefField(actionRef, "land_id", "landId", "card_id", "cardId") === cast.objectId
        );
      }
      if (kind === "special_action") {
        const nested = valueOf(record(actionRef), "action");
        return (
          priorityActionRefKind(nested) === "play_land" &&
          numericRefField(nested, "card_id", "cardId", "land_id", "landId") === cast.objectId
        );
      }
      return false;
    });
  }

  const tap = parseLegacyIndexedActionId(actionId, "tap:");
  if (tap) {
    return findBoundPriorityActionRef(
      binding,
      (actionRef) =>
        priorityActionRefKind(actionRef) === "activate_mana_ability" &&
        actionRefMatchesAbility(actionRef, tap.objectId, tap.abilityIndex),
    );
  }

  const ability = parseLegacyIndexedActionId(actionId, "ability:");
  if (ability) {
    return findBoundPriorityActionRef(binding, (actionRef) => {
      const kind = priorityActionRefKind(actionRef);
      return (
        (kind === "activate_ability" || kind === "activate_mana_ability") &&
        actionRefMatchesAbility(actionRef, ability.objectId, ability.abilityIndex)
      );
    });
  }

  const untap = parseLegacyUntapActionId(actionId);
  if (untap) {
    return findBoundPriorityActionRef(
      binding,
      (actionRef) =>
        priorityActionRefKind(actionRef) === "untap_land" &&
        numericRefField(actionRef, "stable_id", "stableId", "land_id", "landId") === untap.objectId,
    );
  }

  return null;
}

function boundPriorityActionRef(binding: IronsmithPromptBinding, actionId: string): unknown {
  if (isPassPriorityActionId(actionId)) return passPriorityActionRef(binding);
  const legacyActionRef = legacyManabrewActionRef(binding, actionId);
  if (legacyActionRef) return legacyActionRef;
  if (!Object.prototype.hasOwnProperty.call(binding.actionRefs, actionId)) {
    throw new Error(`Unknown Ironsmith priority action id: ${actionId}`);
  }
  const actionRef = normalizePriorityActionRef(binding.actionRefs[actionId]);
  if (actionRef == null || typeof actionRef !== "object") {
    throw new Error(`Unsupported Ironsmith priority action ref for ${actionId}`);
  }
  return actionRef;
}

export function mapPromptOutputToIronsmithCommand(
  output: PromptOutput,
  binding: IronsmithPromptBinding,
): unknown {
  if (output.type === "chooseAction") {
    if (output.output.type === "concede") return { type: "forfeit_player" };
    if (output.output.type === "pass") {
      return { type: "priority_action", action_ref: passPriorityActionRef(binding) };
    }
    if (output.output.type === "act") {
      return {
        type: "priority_action",
        action_ref: boundPriorityActionRef(binding, output.output.actionId),
      };
    }
  }
  if (output.type === "payManaCost") {
    if (output.output.type === "cancel")
      return { type: "priority_action", action_ref: passPriorityActionRef(binding) };
    if (output.output.type === "act") {
      return {
        type: "priority_action",
        action_ref: boundPriorityActionRef(binding, output.output.actionId),
      };
    }
    const first = Object.keys(binding.actionRefs)[0];
    return {
      type: "priority_action",
      action_ref: first ? boundPriorityActionRef(binding, first) : passPriorityActionRef(binding),
    };
  }
  if (output.type === "chooseNumber") {
    return { type: "number_choice", value: output.output.chosenNumber ?? 0 };
  }
  if (output.type === "chooseBoolean") {
    return {
      type: "select_options",
      option_indices: [
        binding.optionIndices[output.output.value ? "0" : "1"] ?? (output.output.value ? 0 : 1),
      ],
    };
  }
  if (output.type === "chooseFromSelection") {
    if (binding.decisionKind === "priority") {
      const chosenIndex = output.output.chosenIndices[0];
      return {
        type: "priority_action",
        action_ref:
          chosenIndex == null
            ? passPriorityActionRef(binding)
            : boundPriorityActionRef(binding, String(chosenIndex)),
      };
    }
    return {
      type: "select_options",
      option_indices: output.output.chosenIndices.map(
        (index) => binding.optionIndices[String(index)] ?? index,
      ),
    };
  }
  if (output.type === "chooseColor") {
    return { type: "select_options", option_indices: optionIndicesFromColors(output, binding) };
  }
  if (output.type === "chooseCards") {
    return { type: "select_objects", object_ids: output.output.chosenCardIds.map(parseObjectId) };
  }
  if (output.type === "reorderCards") {
    return { type: "select_objects", object_ids: output.output.orderedCardIds.map(parseObjectId) };
  }
  if (output.type === "chooseBoardTargets") {
    return {
      type: "select_targets",
      targets: output.output.chosen.map((target) =>
        target.kind === "player"
          ? { kind: "player", player: parsePlayerIndex(target.id) }
          : { kind: "object", object: parseObjectId(target.id) },
      ),
    };
  }
  if (output.type === "chooseAttackers") {
    return {
      type: "declare_attackers",
      declarations: output.output.assignments.map((assignment) => {
        const targetKind = binding.targetKinds[assignment.targetId];
        return {
          creature: parseObjectId(assignment.attackerId),
          target:
            targetKind === "player"
              ? { kind: "player", player: parsePlayerIndex(assignment.targetId) }
              : { kind: "planeswalker", object: parseObjectId(assignment.targetId) },
        };
      }),
    };
  }
  if (output.type === "chooseBlockers") {
    return {
      type: "declare_blockers",
      declarations: output.output.assignments.map((assignment) => ({
        blocker: parseObjectId(assignment.blockerId),
        blocking: parseObjectId(assignment.attackerId),
      })),
    };
  }
  throw new Error(`Unsupported Ironsmith prompt output: ${output.type}`);
}

export function deckCardNames(deck: Deck): string[] {
  return deck.cards.map((card: DeckCard) => card.identity.name);
}

export function deckSideboardNames(deck: Deck): string[] {
  return deck.sideboard.map((card: DeckCard) => card.identity.name);
}

export function deckCommanderNames(deck: Deck, commanderName: string | null): string[] {
  const explicit = deck.commanders?.map((card) => card.identity.name) ?? [];
  if (explicit.length > 0) return explicit;
  return commanderName ? [commanderName] : [];
}

function allDeckCards(deck: Deck): DeckCard[] {
  return [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.commanders ?? []),
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...(deck.maybeboard ?? []),
    ...(deck.tokens ?? []),
    ...(deck.companion ? [deck.companion] : []),
  ];
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.map((value) => value?.trim() ?? "").filter(Boolean);
}

function typeLine(card: DeckCard): string {
  const front = compactStrings([...(card.supertypes ?? []), ...(card.types ?? [])]).join(" ");
  const subtypes = compactStrings(card.subtypes ?? []).join(" ");
  if (!front) return subtypes || "Card";
  return subtypes ? `${front} \u2014 ${subtypes}` : front;
}

function sourceBlock(card: DeckCard): string {
  const lines: string[] = [];
  if (card.manaCost.trim()) lines.push(`Mana cost: ${card.manaCost.trim()}`);
  lines.push(`Type: ${typeLine(card)}`);
  if (card.power != null && card.toughness != null) {
    lines.push(`Power/Toughness: ${card.power}/${card.toughness}`);
  }
  if (card.text.trim()) lines.push(card.text.trim());
  return lines.join("\n");
}

export function buildIronsmithDeckSources(decks: Deck[]): IronsmithExternalCardSource[] {
  const byName = new Map<string, IronsmithExternalCardSource>();
  for (const deck of decks) {
    for (const card of allDeckCards(deck)) {
      const name = card.identity.name.trim();
      if (!name || byName.has(name.toLocaleLowerCase("en-US"))) continue;
      byName.set(name.toLocaleLowerCase("en-US"), {
        canonicalName: name,
        aliases: [],
        group: {
          kind: "single",
          name,
          block: sourceBlock(card),
          score: 1,
        },
      });
    }
  }
  return Array.from(byName.values());
}
