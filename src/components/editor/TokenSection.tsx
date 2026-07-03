import type { MouseEvent } from "react";
import { Palette, X } from "lucide-react";
import { CARD_WIDTH_MAP } from "./deckBuilder.utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { DeckCard } from "@/protocol/deck";

export interface TokenSectionProps {
  tokens: DeckCard[];
  cardSize: number;
  onShowInfo?: (tokenName: string) => void;
  onPickPrint?: (tokenName: string) => void;
  onRemoveToken?: (tokenName: string) => void;
  onHover?: (token: DeckCard, e: MouseEvent) => void;
  onLeave?: () => void;
}

export function TokenSection({
  tokens,
  cardSize,
  onShowInfo,
  onPickPrint,
  onRemoveToken,
  onHover,
  onLeave,
}: TokenSectionProps) {
  if (tokens.length === 0) return null;

  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? 115;

  return (
    <section className="rounded-xl border bg-card/40 p-6">
      <div className="mb-4 flex items-baseline gap-2.5">
        <h3 className="text-base font-semibold">Tokens</h3>
        <span className="text-xs text-muted-foreground/70">
          {tokens.length} token{tokens.length !== 1 ? "s" : ""} produced by this deck
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {tokens.map((t) => (
          <div
            key={`${t.identity.name}-${t.identity.setCode}-${t.identity.cardNumber}`}
            className="shrink-0"
            style={{ width: cardWidth }}
          >
            <TokenGridCard
              token={t}
              onShowInfo={onShowInfo}
              onPickPrint={onPickPrint}
              onRemove={onRemoveToken}
              onHover={onHover}
              onLeave={onLeave}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Grid card with token image + print picker ──────────────────────────────

function TokenGridCard({
  token,
  onShowInfo,
  onPickPrint,
  onRemove,
  onHover,
  onLeave,
}: {
  token: DeckCard;
  onShowInfo?: (name: string) => void;
  onPickPrint?: (name: string) => void;
  onRemove?: (name: string) => void;
  onHover?: (token: DeckCard, e: MouseEvent) => void;
  onLeave?: () => void;
}) {
  const { name } = token.identity;
  return (
    <div
      className="relative group cursor-pointer"
      onClick={() => onShowInfo?.(name)}
      onMouseEnter={(e) => onHover?.(token, e)}
      onMouseLeave={() => onLeave?.()}
    >
      <ScryfallImg
        src={token.uris.normal}
        alt={name}
        className="w-full rounded-lg border border-border/50 shadow-sm"
        draggable={false}
      />

      {/* Action buttons — top-right on hover */}
      <div className="absolute top-1 right-1 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onPickPrint && (
          <button
            type="button"
            className="rounded-full p-0.5 shadow bg-overlay/70 text-muted-foreground hover:text-foreground transition-colors"
            title="Change printing"
            onClick={(e) => {
              e.stopPropagation();
              onPickPrint(name);
            }}
          >
            <Palette className="h-3.5 w-3.5" />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className="rounded-full p-0.5 shadow bg-overlay/70 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove token"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(name);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
