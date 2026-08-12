import { useState, type MouseEvent } from "react";
import { ChevronDown, Palette, X } from "lucide-react";
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE } from "./deckBuilder.utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { DeckCard } from "@/protocol/deck";
import { tokenIdentityKey } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";

export interface TokenSectionProps {
  tokens: DeckCard[];
  customizedTokens?: DeckCard[];
  cardSize: number;
  onShowInfo?: (token: DeckCard) => void;
  onPickPrint?: (token: DeckCard) => void;
  onResetPrint?: (token: DeckCard) => void;
  onHover?: (token: DeckCard, e: MouseEvent) => void;
  onLeave?: () => void;
}

export function TokenSection({
  tokens,
  customizedTokens,
  cardSize,
  onShowInfo,
  onPickPrint,
  onResetPrint,
  onHover,
  onLeave,
}: TokenSectionProps) {
  const [open, setOpen] = useState(true);
  if (tokens.length === 0) return null;

  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? CARD_WIDTH_MAP[DEFAULT_CARD_SIZE];

  return (
    <section className="rounded-xl border bg-card/40 p-6">
      <button
        type="button"
        className="mb-4 flex items-center gap-2.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        <h3 className="text-base font-semibold">Tokens</h3>
        <span className="text-xs text-muted-foreground/70">
          {tokens.length} token{tokens.length !== 1 ? "s" : ""} produced by this deck
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-3">
          {tokens.map((t) => (
            <div
              key={`${t.identity.name}-${t.identity.setCode}-${t.identity.cardNumber}`}
              className="shrink-0"
              style={{ width: cardWidth }}
            >
              <TokenGridCard
                token={t}
                customized={customizedTokens?.some(
                  (candidate) => tokenIdentityKey(candidate) === tokenIdentityKey(t),
                )}
                onShowInfo={onShowInfo}
                onPickPrint={onPickPrint}
                onReset={onResetPrint}
                onHover={onHover}
                onLeave={onLeave}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Grid card with token image + print picker ──────────────────────────────

function TokenGridCard({
  token,
  customized,
  onShowInfo,
  onPickPrint,
  onReset,
  onHover,
  onLeave,
}: {
  token: DeckCard;
  customized?: boolean;
  onShowInfo?: (token: DeckCard) => void;
  onPickPrint?: (token: DeckCard) => void;
  onReset?: (token: DeckCard) => void;
  onHover?: (token: DeckCard, e: MouseEvent) => void;
  onLeave?: () => void;
}) {
  const { name } = token.identity;
  return (
    <div
      className="relative group cursor-pointer"
      onClick={() => onShowInfo?.(token)}
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
      <div className="absolute top-1 right-1 z-20 flex gap-1 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
        {onPickPrint && (
          <button
            type="button"
            className="rounded-full p-0.5 shadow bg-overlay/70 text-muted-foreground hover:text-foreground transition-colors"
            title="Change printing"
            onClick={(e) => {
              e.stopPropagation();
              onPickPrint(token);
            }}
          >
            <Palette className="h-3.5 w-3.5" />
          </button>
        )}
        {customized && onReset && (
          <button
            type="button"
            className="rounded-full p-0.5 shadow bg-overlay/70 text-muted-foreground hover:text-destructive transition-colors"
            title="Reset printing"
            onClick={(e) => {
              e.stopPropagation();
              onReset(token);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
