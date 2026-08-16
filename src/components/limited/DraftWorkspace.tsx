import { useState } from "react";

import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { DraftCardTile } from "@/components/limited/DraftCardTile";
import { DraftPoolPanel } from "@/components/limited/DraftPoolPanel";
import { DraftPreviewPanel } from "@/components/limited/DraftPreviewPanel";
import { LimitedHoverPreviewPane } from "@/components/limited/LimitedHoverPreviewPane";
import {
  LimitedWorkspaceTabs,
  type LimitedWorkspaceTab,
} from "@/components/limited/LimitedWorkspaceTabs";
import { RaritySetBadge } from "@/components/limited/RaritySetBadge";
import { useCardPreview } from "@/hooks/useCardPreview";
import { cn } from "@/lib/utils";
import type { ConspiracyHook, DraftCard, DraftState } from "@/types/limited";

interface DraftWorkspaceProps {
  draft: DraftState;
  onPick: (card: DraftCard) => void | Promise<void>;
  onBuild?: () => void;
  pickPending?: boolean;
  conspiracyHooks?: ConspiracyHook[];
}

function cardKey(card: DraftCard, index: number): string {
  return `${card.name}:${card.setCode}:${card.cardNumber}:${index}`;
}

export function DraftWorkspace({
  draft,
  onPick,
  onBuild,
  pickPending = false,
  conspiracyHooks = [],
}: DraftWorkspaceProps) {
  const preview = useCardPreview([draft.round, draft.pickNumber]);
  const [mobileTab, setMobileTab] = useState<LimitedWorkspaceTab>("pack");
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [previewSlot, setPreviewSlot] = useState<HTMLDivElement | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("draft.previewPanelCollapsed") === "true",
  );
  const packKey = `${draft.round}:${draft.pickNumber}:${draft.currentPack.length}`;
  const selectedStillVisible = draft.currentPack.some(
    (card, index) => cardKey(card, index) === selectedCardKey,
  );
  const visibleSelectedKey = selectedStillVisible ? selectedCardKey : null;

  const submitPick = (card: DraftCard, index: number) => {
    if (!draft.awaitingHuman || pickPending) return;
    setSelectedCardKey(cardKey(card, index));
    void Promise.resolve(onPick(card)).catch(() => setSelectedCardKey(null));
  };

  const togglePreview = () => {
    setPreviewCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem("draft.previewPanelCollapsed", String(next));
      return next;
    });
  };

  const packPanel = (
    <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/70 bg-card/20">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Current pack ({draft.currentPack.length})
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {draft.awaitingHuman ? "Choose a card" : "Waiting for the next pack"}
        </span>
      </div>
      <div
        key={packKey}
        className="min-h-0 flex-1 overflow-y-auto p-3 motion-safe:animate-draft-pack-arrive"
      >
        {draft.currentPack.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
            Waiting for a pack…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {draft.currentPack.map((card, index) => {
              const key = cardKey(card, index);
              return (
                <DraftCardTile
                  key={key}
                  card={card}
                  index={index}
                  onClick={() => submitPick(card, index)}
                  disabled={!draft.awaitingHuman || pickPending}
                  preview={preview}
                  selected={visibleSelectedKey === key}
                  pickPending={pickPending}
                  overlay={<RaritySetBadge card={card} />}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  const poolPanel = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {draft.humanConspiracies && draft.humanConspiracies.length > 0 && (
        <section className="shrink-0 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Conspiracies ({draft.humanConspiracies.length})
          </h2>
          <ul className="space-y-1">
            {draft.humanConspiracies.map((name) => {
              const hook = conspiracyHooks.find((candidate) => candidate.cardName === name);
              return (
                <li key={name}>
                  <span className="font-medium">{name}</span>
                  {hook && <span className="ml-1 text-muted-foreground">· {hook.description}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <DraftPoolPanel cards={draft.pickedPile} preview={preview} onBuild={onBuild} />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <LimitedWorkspaceTabs value={mobileTab} onChange={setMobileTab} />

      <div className="hidden min-h-0 flex-1 gap-3 overflow-hidden lg:flex">
        <div className="flex min-w-0 flex-[2]">{packPanel}</div>
        <aside className="flex min-h-0 w-[320px] shrink-0 flex-col gap-3 xl:w-[360px]">
          {poolPanel}
          <DraftPreviewPanel
            setSlot={setPreviewSlot}
            collapsed={previewCollapsed}
            onCollapse={togglePreview}
          />
        </aside>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden lg:hidden">
        <div className={cn("h-full", mobileTab !== "pack" && "hidden")}>{packPanel}</div>
        <div className={cn("flex h-full", mobileTab !== "picks" && "hidden")}>{poolPanel}</div>
        <div className={cn("h-full", mobileTab !== "preview" && "hidden")}>
          <LimitedHoverPreviewPane preview={preview} className="h-full" />
        </div>
      </div>

      <HoverCardPreview
        preview={preview}
        slot={previewSlot}
        pinned={Boolean(previewSlot)}
        imageSize="normal"
      />
    </div>
  );
}
