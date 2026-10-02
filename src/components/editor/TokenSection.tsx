import { type MouseEvent } from "react";
import { ChevronDown, Palette, X } from "lucide-react";
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE } from "./deckBuilder.utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import type { DeckCard } from "@/protocol/deck";
import { tokenIdentityKey } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";
import { useDeckSectionOpen } from "./deckSectionExpansion";
import { EDITOR_PANEL_CLASS } from "./deckEditor.styles";
export interface TokenSectionProps {
  tokens: DeckCard[];
  customizedTokens?: DeckCard[];
  cardSize: number;
  showHeader?: boolean;
  onShowInfo?: (token: DeckCard) => void;
  onInspect?: (token: DeckCard, anchor: HTMLElement | DOMRect) => void;
  onDismiss?: () => void;
  onPickPrint?: (token: DeckCard) => void;
  onResetPrint?: (token: DeckCard) => void;
  onHover?: (token: DeckCard, e: MouseEvent) => void;
  onLeave?: () => void;
}
export function TokenSection({
  tokens,
  customizedTokens,
  cardSize,
  showHeader = true,
  onShowInfo,
  onInspect,
  onDismiss,
  onPickPrint,
  onResetPrint,
  onHover,
  onLeave,
}: TokenSectionProps) {
  const [open, setOpen] = useDeckSectionOpen();
  if (tokens.length === 0) return null;
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? CARD_WIDTH_MAP[DEFAULT_CARD_SIZE];
  return (
    <section className={EDITOR_PANEL_CLASS}>
      {showHeader && (
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
      )}
      {(!showHeader || open) && (
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
                onInspect={onInspect}
                onDismiss={onDismiss}
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
function TokenGridCard({
  token,
  customized,
  onShowInfo,
  onInspect,
  onDismiss,
  onPickPrint,
  onReset,
  onHover,
  onLeave,
}: {
  token: DeckCard;
  customized?: boolean;
  onShowInfo?: (token: DeckCard) => void;
  onInspect?: (token: DeckCard, anchor: HTMLElement | DOMRect) => void;
  onDismiss?: () => void;
  onPickPrint?: (token: DeckCard) => void;
  onReset?: (token: DeckCard) => void;
  onHover?: (token: DeckCard, e: MouseEvent) => void;
  onLeave?: () => void;
}) {
  const { name } = token.identity;
  const longPress = useLongPressPreview({
    resolve: (event) =>
      onInspect ? { item: token, anchor: event.currentTarget as HTMLElement } : null,
    show: (item, anchor) => onInspect?.(item, anchor),
    hide: () => onDismiss?.(),
    hideOnRelease: false,
  });
  return (
    <div className="relative group">
      <button
        type="button"
        className="block w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Inspect ${name} token`}
        disabled={!onInspect && !onShowInfo}
        onClick={(event) => {
          if (onInspect) onInspect(token, event.currentTarget);
          else onShowInfo?.(token);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") onHover?.(token, event);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") onLeave?.();
        }}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() !== "i" || !onInspect) return;
          event.preventDefault();
          onInspect(token, event.currentTarget);
        }}
        {...longPress}
      >
        <ScryfallImg
          src={token.uris.normal}
          alt={name}
          className="w-full rounded-lg border border-border/50 shadow-sm"
          draggable={false}
        />
      </button>
      <div className="absolute top-1 right-1 z-20 flex gap-1 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
        {onPickPrint && (
          <button
            type="button"
            className="rounded-full p-0.5 shadow bg-overlay/70 text-muted-foreground hover:text-foreground transition-colors"
            title={`Change printing`}
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
            title={`Reset printing`}
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
