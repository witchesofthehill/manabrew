import type { LucideIcon } from "lucide-react";
import {
  ArrowDownUp,
  Camera,
  ChevronsRight,
  CircleCheck,
  CircleDot,
  Crosshair,
  Dices,
  Eye,
  Flag,
  Gem,
  Hand,
  Hash,
  Layers,
  ListChecks,
  ScanEye,
  Shield,
  Shuffle,
  Sparkles,
  Swords,
  Undo2,
} from "lucide-react";
import type { CheckpointDto } from "@/protocol/game";

const PASS_PRIORITY = "Pass priority";

// Keys mirror the labels of forge-harness DecisionHistory.description.
const DECISION_ICONS: Record<string, LucideIcon> = {
  [PASS_PRIORITY]: ChevronsRight,
  "Play an action": Sparkles,
  "Keep opening hand": Hand,
  "Take a mulligan": Shuffle,
  "Put cards back after mulligan": Undo2,
  "Declare attackers": Swords,
  "Declare blockers": Shield,
  "Choose targets": Crosshair,
  "Pay mana": Gem,
  "Scry decision": Eye,
  "Surveil decision": Eye,
  "Choose cards": Layers,
  "Choose a number": Hash,
  "Choose an option": ListChecks,
  "Confirm a choice": CircleCheck,
  "Order cards or abilities": ArrowDownUp,
  "Acknowledge revealed cards": ScanEye,
  "Acknowledge dice roll": Dices,
  "Game control": Flag,
};

export function checkpointIcon(checkpoint: CheckpointDto): LucideIcon {
  if (!checkpoint.decision) return Camera;
  return DECISION_ICONS[checkpoint.decision] ?? CircleDot;
}

export type JournalEntry =
  | { kind: "checkpoint"; checkpoint: CheckpointDto }
  | { kind: "passes"; checkpoints: CheckpointDto[] };

function isQuietPass(checkpoint: CheckpointDto): boolean {
  return checkpoint.decision === PASS_PRIORITY && !checkpoint.log?.length;
}

export function journalEntries(checkpoints: CheckpointDto[]): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const checkpoint of checkpoints) {
    const last = entries.at(-1);
    if (isQuietPass(checkpoint) && last?.kind === "passes") {
      last.checkpoints.push(checkpoint);
    } else if (
      isQuietPass(checkpoint) &&
      last?.kind === "checkpoint" &&
      isQuietPass(last.checkpoint)
    ) {
      entries[entries.length - 1] = { kind: "passes", checkpoints: [last.checkpoint, checkpoint] };
    } else {
      entries.push({ kind: "checkpoint", checkpoint });
    }
  }
  return entries;
}

export function groupByTurn(checkpoints: CheckpointDto[]): [number, CheckpointDto[]][] {
  const turns = new Map<number, CheckpointDto[]>();
  for (const checkpoint of checkpoints) {
    turns.set(checkpoint.turn, [...(turns.get(checkpoint.turn) ?? []), checkpoint]);
  }
  return [...turns.entries()].reverse();
}
