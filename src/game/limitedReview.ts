import { updateLimitedSave } from "@/game/limitedStorage";
import type { BuildSession } from "@/components/limited/useLimitedBuildStore";
import type {
  DraftCard,
  DraftState,
  WinstonState,
  SealedPool,
  LimitedDraftDecision,
} from "@/types/limited";
import type { LimitedReviewDocument, LimitedSavedSession } from "@/game/limitedPersistence.types";

export function limitedReviewCards(saved: LimitedSavedSession): DraftCard[] {
  if (saved.reviewCards) return saved.reviewCards;
  if (saved.build) return saved.build.pool;
  if (saved.kind === "sealed" && saved.state) return (saved.state as SealedPool).cards;
  if ((saved.kind === "draft" || saved.kind === "winston") && saved.state)
    return (saved.state as DraftState | WinstonState).pickedPile;
  return (saved.peerSession as { pool?: DraftCard[] } | undefined)?.pool ?? [];
}

export function exportLimitedReview(saved: LimitedSavedSession): void {
  if (saved.kind === "gauntlet")
    throw new Error("Open the original pool or draft to export its review.");
  if (saved.history.some((decision) => decision.seat !== saved.seat))
    throw new Error("Review contains another seat's private decisions and cannot be exported.");
  const cards = limitedReviewCards(saved);
  const allowed = new Set(cards.map((card) => card.id));
  if (saved.build?.pool.some((card) => !allowed.has(card.id)))
    throw new Error("The saved build contains cards outside your acquired pool.");
  const document: LimitedReviewDocument = {
    format: "manabrew-limited-review",
    schemaVersion: 1,
    kind: saved.kind,
    title: saved.title,
    exportedAt: new Date().toISOString(),
    complete: saved.complete,
    seat: saved.seat,
    cards,
    history: saved.history.map((decision) => ({
      ...decision,
      visibleCards: decision.visibleCards.map((card) => ({ ...card })),
      selectedIds: [...decision.selectedIds],
    })),
    ...(saved.build ? { build: saved.build } : {}),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${saved.kind}-review-${saved.sessionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function card(value: unknown): DraftCard {
  if (!value || typeof value !== "object") throw new Error("Invalid card printing in review.");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.name !== "string" ||
    !row.name ||
    typeof row.setCode !== "string" ||
    typeof row.cardNumber !== "string" ||
    (row.foil !== undefined && typeof row.foil !== "boolean")
  )
    throw new Error("Each review card needs an occurrence ID and original printing.");
  return {
    id: row.id,
    name: row.name,
    setCode: row.setCode,
    cardNumber: row.cardNumber,
    ...(row.foil === undefined ? {} : { foil: row.foil }),
  };
}

function allocation(value: unknown, allowed: Set<string>): BuildSession["allocation"] {
  const row = value as BuildSession["allocation"];
  if (
    !row ||
    !Array.isArray(row.mainIds) ||
    !Array.isArray(row.sideboardIds) ||
    !Array.isArray(row.maybeIds) ||
    !Array.isArray(row.basics)
  )
    throw new Error("Invalid build allocation.");
  const basics = row.basics.map(card);
  if (
    new Set(basics.map((printing) => printing.id)).size !== basics.length ||
    basics.some((printing) => allowed.has(printing.id))
  )
    throw new Error("Added basics need unique occurrence IDs outside the acquired pool.");
  if (
    basics.some(
      (printing) =>
        !["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(printing.name),
    )
  )
    throw new Error("Added build cards must be basic lands.");
  const ids = [...row.mainIds, ...row.sideboardIds, ...row.maybeIds];
  const all = new Set([...allowed, ...basics.map((printing) => printing.id)]);
  if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !all.has(id)))
    throw new Error("Build zones must contain unique acquired occurrences.");
  return {
    mainIds: [...row.mainIds],
    sideboardIds: [...row.sideboardIds],
    maybeIds: [...row.maybeIds],
    basics,
  };
}

export async function importLimitedReview(text: string): Promise<LimitedSavedSession> {
  const row = JSON.parse(text) as Record<string, unknown>;
  const keys = [
    "format",
    "schemaVersion",
    "kind",
    "title",
    "exportedAt",
    "complete",
    "seat",
    "cards",
    "history",
    "build",
  ];
  if (
    !row ||
    row.format !== "manabrew-limited-review" ||
    row.schemaVersion !== 1 ||
    !["draft", "winston", "sealed"].includes(String(row.kind)) ||
    Object.keys(row).some((key) => !keys.includes(key))
  )
    throw new Error("Import a version 1 Manabrew Limited review, not a private engine checkpoint.");
  if (
    !Number.isSafeInteger(row.seat) ||
    Number(row.seat) < 0 ||
    typeof row.title !== "string" ||
    typeof row.complete !== "boolean" ||
    !Array.isArray(row.cards) ||
    !Array.isArray(row.history)
  )
    throw new Error("Invalid Limited review metadata.");
  const seat = Number(row.seat);
  const cards = row.cards.map(card);
  const allowed = new Set(cards.map((printing) => printing.id));
  if (allowed.size !== cards.length)
    throw new Error("The acquired pool contains duplicate occurrence IDs.");
  const history = row.history.map((value): LimitedDraftDecision => {
    const decision = value as LimitedDraftDecision;
    if (
      !decision ||
      decision.seat !== seat ||
      !Number.isSafeInteger(decision.revision) ||
      !Number.isSafeInteger(decision.round) ||
      !Number.isSafeInteger(decision.pickNumber) ||
      !["pick", "take", "pass"].includes(decision.action) ||
      typeof decision.packId !== "string" ||
      typeof decision.automatic !== "boolean" ||
      !Array.isArray(decision.visibleCards) ||
      !Array.isArray(decision.selectedIds) ||
      decision.selectedIds.some((id) => typeof id !== "string" || !allowed.has(id))
    )
      throw new Error("Review decisions must belong only to your seat and acquired occurrences.");
    return {
      revision: decision.revision,
      seat,
      round: decision.round,
      pickNumber: decision.pickNumber,
      action: decision.action,
      packId: decision.packId,
      automatic: decision.automatic,
      visibleCards: decision.visibleCards.map(card),
      selectedIds: [...decision.selectedIds],
    };
  });
  let build: BuildSession | undefined;
  if (row.build) {
    const input = row.build as BuildSession;
    if (
      !Array.isArray(input.pool) ||
      !Array.isArray(input.builds) ||
      !Array.isArray(input.undo) ||
      !Array.isArray(input.redo) ||
      !["none", "color", "cmc", "type", "rarity"].includes(input.group) ||
      !["gallery", "list"].includes(input.mode) ||
      !Number.isFinite(input.cardSize)
    )
      throw new Error("Invalid named build data.");
    const pool = input.pool.map(card);
    if (
      pool.length !== cards.length ||
      new Set(pool.map((printing) => printing.id)).size !== allowed.size ||
      pool.some(
        (printing) => !cards.some((owned) => JSON.stringify(owned) === JSON.stringify(printing)),
      )
    )
      throw new Error("Build printings must match each acquired occurrence exactly once.");
    build = {
      pool,
      allocation: allocation(input.allocation, allowed),
      undo: input.undo.map((item) => allocation(item, allowed)),
      redo: input.redo.map((item) => allocation(item, allowed)),
      builds: input.builds.map((item) => {
        if (typeof item.id !== "string" || typeof item.name !== "string")
          throw new Error("Invalid named build.");
        return { ...allocation(item, allowed), id: item.id, name: item.name };
      }),
      group: input.group,
      mode: input.mode,
      cardSize: input.cardSize,
    };
  }
  const saved: LimitedSavedSession = {
    schemaVersion: 1,
    sessionId: crypto.randomUUID(),
    kind: row.kind as LimitedReviewDocument["kind"],
    role: "review",
    title: row.title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: true,
    complete: row.complete,
    checkpoint: null,
    state: null,
    seat,
    history,
    reviewCards: cards,
    ...(build ? { build } : {}),
  };
  await updateLimitedSave(saved.sessionId, () => saved);
  return saved;
}
