import { useState } from "react";

import { ChooseBooleanModal } from "../ChooseBooleanModal";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";
import { useGameStore } from "@/stores/useGameStore";
import type { ChooseBooleanInput, TargetRef } from "@/protocol";
import type { GameView } from "@/types/manabrew";

// ─── EDIT ME ────────────────────────────────────────────────────────────────
// Eyeball the pay-cost-to-prevent prompt (now a ChooseBoolean) with a pile of
// targets. The source card and targets are seeded from the live gameView (any
// zone, since the battlefield is empty early game). The "ids" panel lists every
// resolvable id so you can hand-build a sourceCardId / targets. Dev-only.
const MAX_CARD_TARGETS = 1;
// ─────────────────────────────────────────────────────────────────────────────

interface CardRow {
  id: string;
  name: string;
  zone: string;
}

export function ChooseBooleanModalPreview() {
  const gameView = useGameStore((s) => s.gameView);
  const [open, setOpen] = useState(true);
  const [showIds, setShowIds] = useState(false);

  const cards = gameView ? collectCards(gameView) : [];
  const cardTargets: TargetRef[] = cards
    .slice(0, MAX_CARD_TARGETS)
    .map((card) => ({ kind: "card", id: card.id }));
  const playerTargets: TargetRef[] = (gameView?.players ?? []).map((player) => ({
    kind: "player",
    id: player.id,
  }));

  const input: ChooseBooleanInput = {
    presentation: {
      title: "Pay 2 {LIFE}?",
      description: undefined,
      text: 'otherwise: "Enters tapped."',
      sourceCardId: cards[0]?.id,
      targets: [...cardTargets, ...playerTargets],
    },
    confirmLabel: "Pay",
    denyLabel: "Decline",
  };

  return (
    <>
      <div className="fixed bottom-2 left-2 z-[9999] flex gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
        >
          {open ? "Hide" : "Show"} prevent preview
        </button>
        <button
          type="button"
          onClick={() => setShowIds((v) => !v)}
          className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
        >
          {showIds ? "Hide" : "Show"} ids ({cards.length})
        </button>
      </div>

      {showIds && (
        <div className="fixed bottom-10 left-2 z-[9999] max-h-[60vh] w-[320px] overflow-auto rounded border bg-card p-2 text-xs">
          <p className="mb-1 font-semibold">Players</p>
          {(gameView?.players ?? []).map((p) => (
            <div key={p.id} className="font-mono text-muted-foreground">
              {p.id} — {p.name}
            </div>
          ))}
          <p className="mb-1 mt-2 font-semibold">Cards ({cards.length})</p>
          {cards.length === 0 && <p className="text-muted-foreground">no gameView / no cards</p>}
          {cards.map((c) => (
            <div key={c.id} className="font-mono text-muted-foreground">
              {c.id} — {c.name} <span className="opacity-60">[{c.zone}]</span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <PromptModalChromeContext.Provider
          value={{ showMinimize: true, onMinimize: () => setOpen(false) }}
        >
          <ChooseBooleanModal
            input={input}
            respond={(o) => console.log("[ChooseBooleanModalPreview] respond →", o)}
          />
        </PromptModalChromeContext.Provider>
      )}
    </>
  );
}

function collectCards(gameView: GameView): CardRow[] {
  const rows: CardRow[] = [];
  for (const card of gameView.battlefield) {
    rows.push({ id: card.id, name: card.name, zone: "battlefield" });
  }
  for (const player of gameView.players) {
    const zones = {
      hand: player.hand,
      graveyard: player.graveyard,
      exile: player.exile,
      command: player.commandZone,
    };
    for (const [zone, zoneCards] of Object.entries(zones)) {
      for (const card of zoneCards) {
        rows.push({ id: card.id, name: card.name, zone: `${player.name}:${zone}` });
      }
    }
  }
  return rows;
}
