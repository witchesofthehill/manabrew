import { useState, useRef, useEffect } from "react";
import { useCardSearch } from "@/hooks/useCards";
import { useKeybindings } from "@/hooks/useKeybindings";
import { Input } from "@/components/ui/input";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  LayoutGrid,
  List,
  Info,
  Plus,
  SlidersHorizontal,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScryfallCard } from "@/types/scryfall";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import { useDraggable } from "@dnd-kit/core";
import { toast } from "sonner";
import { useDeckStore } from "@/stores/useDeckStore";
import { CardDetailModal } from "@/components/editor/CardDetailModal";
import { CardThumbnail } from "@/components/editor/deckEditor.primitives";
import { SetSelect } from "@/components/editor/SetSelect";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { manaSymbolUrl } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { useCardPreview } from "@/hooks/useCardPreview";
import type { ManaCode } from "@/types/scryfall";

// ─── Filter definitions ────────────────────────────────────────────────────────

const COLOR_FILTERS = [
  { id: "W", label: "W", scryfall: "c:w", title: "White" },
  { id: "U", label: "U", scryfall: "c:u", title: "Blue" },
  { id: "B", label: "B", scryfall: "c:b", title: "Black" },
  { id: "R", label: "R", scryfall: "c:r", title: "Red" },
  { id: "G", label: "G", scryfall: "c:g", title: "Green" },
  { id: "C", label: "C", scryfall: "c:c", title: "Colorless" },
  { id: "M", label: "M", scryfall: "c:m", title: "Multicolor" },
] as const;

const TYPE_FILTERS = [
  { id: "Creature", label: "Creature" },
  { id: "Land", label: "Land" },
  { id: "Instant", label: "Instant" },
  { id: "Sorcery", label: "Sorcery" },
  { id: "Enchantment", label: "Enchant." },
  { id: "Artifact", label: "Artifact" },
  { id: "Planeswalker", label: "PW" },
] as const;

const CMC_FILTERS = [
  { id: "any", label: "Any" },
  { id: "0", label: "0" },
  { id: "1", label: "1" },
  { id: "2", label: "2" },
  { id: "3", label: "3" },
  { id: "4", label: "4" },
  { id: "5", label: "5" },
  { id: "6", label: "6+" },
] as const;

const RARITY_FILTERS = [
  { id: "common", label: "C", title: "Common" },
  { id: "uncommon", label: "U", title: "Uncommon" },
  { id: "rare", label: "R", title: "Rare" },
  { id: "mythic", label: "M", title: "Mythic" },
] as const;

const FORMAT_FILTERS = [
  { id: "standard", label: "Standard" },
  { id: "pioneer", label: "Pioneer" },
  { id: "modern", label: "Modern" },
  { id: "legacy", label: "Legacy" },
  { id: "vintage", label: "Vintage" },
  { id: "commander", label: "Commander" },
  { id: "pauper", label: "Pauper" },
  { id: "historic", label: "Historic" },
  { id: "brawl", label: "Brawl" },
  { id: "alchemy", label: "Alchemy" },
  { id: "explorer", label: "Explorer" },
  { id: "penny", label: "Penny" },
  { id: "oathbreaker", label: "Oathbreaker" },
] as const;

const COLOR_IDENTITY_FILTERS = [
  { id: "W", label: "W", scryfall: "id:w", title: "White" },
  { id: "U", label: "U", scryfall: "id:u", title: "Blue" },
  { id: "B", label: "B", scryfall: "id:b", title: "Black" },
  { id: "R", label: "R", scryfall: "id:r", title: "Red" },
  { id: "G", label: "G", scryfall: "id:g", title: "Green" },
] as const;

const PRODUCES_FILTERS = [
  { id: "W", label: "W", title: "White" },
  { id: "U", label: "U", title: "Blue" },
  { id: "B", label: "B", title: "Black" },
  { id: "R", label: "R", title: "Red" },
  { id: "G", label: "G", title: "Green" },
  { id: "C", label: "C", title: "Colorless" },
] as const;

const FRAME_FILTERS = [
  { id: "old", label: "Old" },
  { id: "modern", label: "Modern" },
  { id: "future", label: "Future" },
] as const;

const BORDER_FILTERS = [
  { id: "black", label: "Black" },
  { id: "white", label: "White" },
  { id: "borderless", label: "Borderless" },
  { id: "gold", label: "Gold" },
] as const;

const GAME_FILTERS = [
  { id: "paper", label: "Paper" },
  { id: "arena", label: "Arena" },
  { id: "mtgo", label: "MTGO" },
] as const;

const SORT_OPTIONS = [
  { id: "cmc", label: "Mana Value" },
  { id: "name", label: "Name" },
  { id: "set", label: "Set" },
  { id: "released", label: "Release Date" },
  { id: "rarity", label: "Rarity" },
  { id: "color", label: "Color" },
  { id: "power", label: "Power" },
  { id: "toughness", label: "Toughness" },
  { id: "edhrec", label: "EDHREC Rank" },
  { id: "usd", label: "Price (USD)" },
  { id: "eur", label: "Price (EUR)" },
  { id: "artist", label: "Artist" },
] as const;

type CmcId = (typeof CMC_FILTERS)[number]["id"];

interface AdvancedFilters {
  rarity: Set<string>;
  format: string;
  colorIdentity: Set<string>;
  oracleText: string;
  flavorText: string;
  manaCost: string;
  power: string;
  powerOp: string;
  toughness: string;
  toughnessOp: string;
  loyalty: string;
  loyaltyOp: string;
  set: string;
  artist: string;
  keyword: string;
  produces: Set<string>;
  year: string;
  frame: string;
  border: string;
  game: string;
  language: string;
  is: Set<string>;
  sort: string;
  sortDir: string;
}

const INITIAL_ADVANCED: AdvancedFilters = {
  rarity: new Set(),
  format: "",
  colorIdentity: new Set(),
  oracleText: "",
  flavorText: "",
  manaCost: "",
  power: "",
  powerOp: "=",
  toughness: "",
  toughnessOp: "=",
  loyalty: "",
  loyaltyOp: "=",
  set: "",
  artist: "",
  keyword: "",
  produces: new Set(),
  year: "",
  frame: "",
  border: "",
  game: "",
  language: "",
  is: new Set(),
  sort: "",
  sortDir: "auto",
};

const IS_FILTERS = [
  { id: "transform", label: "Transform" },
  { id: "modal", label: "Modal DFC" },
  { id: "split", label: "Split" },
  { id: "flip", label: "Flip" },
  { id: "adventure", label: "Adventure" },
  { id: "meld", label: "Meld" },
  { id: "saga", label: "Saga" },
  { id: "leveler", label: "Level Up" },
  { id: "vanilla", label: "Vanilla" },
  { id: "token", label: "Token" },
  { id: "spell", label: "Spell" },
  { id: "permanent", label: "Permanent" },
  { id: "foil", label: "Foil" },
  { id: "nonfoil", label: "Non-Foil" },
  { id: "promo", label: "Promo" },
  { id: "digital", label: "Digital Only" },
  { id: "textless", label: "Textless" },
  { id: "fullart", label: "Full Art" },
  { id: "funny", label: "Un-cards" },
  { id: "booster", label: "In Boosters" },
  { id: "commander", label: "Commander" },
  { id: "reserved", label: "Reserved List" },
  { id: "reprint", label: "Reprint" },
  { id: "firstprint", label: "First Print" },
  { id: "unique", label: "Unique Art" },
  { id: "fetchland", label: "Fetchland" },
  { id: "dualland", label: "Dual Land" },
  { id: "shockland", label: "Shockland" },
] as const;

const COMPARISON_OPS = ["=", ">", "<", ">=", "<="] as const;

function pushOrGroup(parts: string[], items: Set<string>, prefix: string) {
  if (items.size === 0) return;
  const clauses = [...items].map((v) => `${prefix}${v}`);
  parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" or ")})`);
}

function buildScryfallQuery(
  text: string,
  colors: Set<string>,
  types: Set<string>,
  cmc: CmcId,
  adv: AdvancedFilters,
): string {
  const parts: string[] = [];
  if (text.trim()) parts.push(text.trim());
  if (colors.size > 0) {
    const clauses = [...colors].map((id) => COLOR_FILTERS.find((f) => f.id === id)!.scryfall);
    parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" or ")})`);
  }
  if (types.size > 0) {
    const clauses = [...types].map((t) => `t:${t.toLowerCase()}`);
    parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" or ")})`);
  }
  if (cmc !== "any") {
    parts.push(cmc === "6" ? "cmc>=6" : `cmc=${cmc}`);
  }
  pushOrGroup(parts, adv.rarity, "r:");
  if (adv.format) parts.push(`f:${adv.format}`);
  if (adv.colorIdentity.size > 0) {
    const clauses = [...adv.colorIdentity].map(
      (id) => COLOR_IDENTITY_FILTERS.find((f) => f.id === id)!.scryfall,
    );
    parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" or ")})`);
  }
  if (adv.oracleText.trim()) parts.push(`o:"${adv.oracleText.trim()}"`);
  if (adv.flavorText.trim()) parts.push(`ft:"${adv.flavorText.trim()}"`);
  if (adv.manaCost.trim()) parts.push(`m:${adv.manaCost.trim()}`);
  if (adv.power.trim()) parts.push(`pow${adv.powerOp}${adv.power.trim()}`);
  if (adv.toughness.trim()) parts.push(`tou${adv.toughnessOp}${adv.toughness.trim()}`);
  if (adv.loyalty.trim()) parts.push(`loy${adv.loyaltyOp}${adv.loyalty.trim()}`);
  if (adv.set.trim()) parts.push(`s:${adv.set.trim().toLowerCase()}`);
  if (adv.artist.trim()) parts.push(`a:"${adv.artist.trim()}"`);
  if (adv.keyword.trim()) parts.push(`kw:${adv.keyword.trim().toLowerCase()}`);
  pushOrGroup(parts, adv.produces, "produces:");
  if (adv.year.trim()) parts.push(`year:${adv.year.trim()}`);
  if (adv.frame) parts.push(`frame:${adv.frame}`);
  if (adv.border) parts.push(`border:${adv.border}`);
  if (adv.game) parts.push(`game:${adv.game}`);
  if (adv.language.trim()) parts.push(`lang:${adv.language.trim().toLowerCase()}`);
  for (const modifier of adv.is) parts.push(`is:${modifier}`);
  return parts.join(" ");
}

function countAdvancedFilters(adv: AdvancedFilters): number {
  let count = adv.rarity.size > 0 ? 1 : 0;
  if (adv.format) count++;
  count += adv.colorIdentity.size > 0 ? 1 : 0;
  if (adv.oracleText.trim()) count++;
  if (adv.flavorText.trim()) count++;
  if (adv.manaCost.trim()) count++;
  if (adv.power.trim()) count++;
  if (adv.toughness.trim()) count++;
  if (adv.loyalty.trim()) count++;
  if (adv.set.trim()) count++;
  if (adv.artist.trim()) count++;
  if (adv.keyword.trim()) count++;
  count += adv.produces.size > 0 ? 1 : 0;
  if (adv.year.trim()) count++;
  if (adv.frame) count++;
  if (adv.border) count++;
  if (adv.game) count++;
  if (adv.language.trim()) count++;
  count += adv.is.size;
  return count;
}

// ─── Filter UI helpers ───────────────────────────────────────────────────────

function FilterBtn({
  active,
  onClick,
  title,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "h-6 min-w-[1.5rem] px-1.5 rounded text-xs font-semibold border transition-colors select-none",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ManaFilterBtn({
  symbol,
  active,
  onClick,
  title,
}: {
  symbol: ManaCode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "h-7 w-7 rounded-full border-2 transition-all select-none flex items-center justify-center p-0.5",
        active
          ? "border-primary ring-2 ring-primary/30 scale-110"
          : "border-transparent opacity-70 hover:opacity-100 hover:scale-105",
      )}
    >
      <ScryfallImg src={manaSymbolUrl(symbol)} alt={symbol} className="w-5 h-5" draggable={false} />
    </button>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">{children}</span>
  );
}

function FilterRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-1.5", className)}>{children}</div>;
}

function FilterSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
        {label}
      </span>
      <div className="flex-1 border-t border-border/30" />
    </div>
  );
}

// ─── Draggable card wrapper (grid mode) ───────────────────────────────────────

function DraggableCardGrid({
  card,
  onMoreInfo,
  onAdd,
  standalone,
  onHover,
  onLeave,
}: {
  card: DeckCard;
  onMoreInfo: () => void;
  onAdd?: () => void;
  standalone?: boolean;
  onHover?: (card: DeckCard, e: React.MouseEvent) => void;
  onLeave?: () => void;
}) {
  const dragDisabled = !!standalone;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `search-${card.identity.id}`,
    data: { card },
    disabled: dragDisabled,
  });

  return (
    <div
      ref={dragDisabled ? undefined : setNodeRef}
      {...(dragDisabled ? {} : { ...listeners, ...attributes })}
      onPointerEnter={onHover ? (e) => e.pointerType !== "touch" && onHover(card, e) : undefined}
      onPointerMove={onHover ? (e) => e.pointerType !== "touch" && onHover(card, e) : undefined}
      onPointerLeave={onLeave ? (e) => e.pointerType !== "touch" && onLeave() : undefined}
      className={cn(
        "relative group",
        !dragDisabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
    >
      <CardThumbnail card={card} />
      <div className="absolute inset-0 bg-overlay/60 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 rounded-lg pointer-events-none group-hover:pointer-events-auto pointer-coarse:pointer-events-auto">
        {onAdd && (
          <Button
            size="sm"
            className="w-4/5 gap-1"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="w-4/5 gap-1"
          onClick={(e) => {
            e.stopPropagation();
            onMoreInfo();
          }}
        >
          <Info className="h-3 w-3" />
          More Info
        </Button>
      </div>
    </div>
  );
}

// ─── Draggable card wrapper (list mode) ───────────────────────────────────────

function DraggableCardRow({
  card,
  onMoreInfo,
  onAdd,
  standalone,
  onHover,
  onLeave,
}: {
  card: DeckCard;
  onMoreInfo: () => void;
  onAdd?: () => void;
  standalone?: boolean;
  onHover?: (card: DeckCard, e: React.MouseEvent) => void;
  onLeave?: () => void;
}) {
  const dragDisabled = !!standalone;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `search-${card.identity.id}`,
    data: { card },
    disabled: dragDisabled,
  });

  const typeStr = [...(card.supertypes ?? []), ...(card.types ?? [])].join(" ");

  return (
    <div
      ref={dragDisabled ? undefined : setNodeRef}
      {...(dragDisabled ? {} : { ...listeners, ...attributes })}
      onPointerEnter={onHover ? (e) => e.pointerType !== "touch" && onHover(card, e) : undefined}
      onPointerMove={onHover ? (e) => e.pointerType !== "touch" && onHover(card, e) : undefined}
      onPointerLeave={onLeave ? (e) => e.pointerType !== "touch" && onLeave() : undefined}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group border-b border-border/30 last:border-0",
        !dragDisabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
    >
      <div className="w-8 h-8 shrink-0 rounded overflow-hidden bg-muted">
        <ScryfallImg
          src={card.uris.small}
          alt=""
          className="w-full h-full object-cover object-top"
          draggable={false}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate leading-tight">{card.identity.name}</div>
        <div className="text-xs text-muted-foreground truncate leading-tight">{typeStr}</div>
      </div>

      {card.manaCost && <ManaSymbols cost={card.manaCost} size="sm" className="shrink-0" />}

      {onAdd && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs gap-1 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity shrink-0 pointer-events-none group-hover:pointer-events-auto pointer-coarse:pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs gap-1 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity shrink-0 pointer-events-none group-hover:pointer-events-auto pointer-coarse:pointer-events-auto"
        onClick={(e) => {
          e.stopPropagation();
          onMoreInfo();
        }}
      >
        <Info className="h-3 w-3" />
        Info
      </Button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface CardSearchProps {
  standalone?: boolean;
  onClose?: () => void;
  /** Shared rail slot — when provided, the hover preview portals into it
   *  (pinned). When absent, the search panel renders no preview of its own. */
  previewSlot?: HTMLElement | null;
  /** Bump to focus the search box (used by the deck editor's `/` shortcut). */
  focusSignal?: number;
}

export function CardSearch({ standalone, onClose, previewSlot, focusSignal }: CardSearchProps) {
  const preview = useCardPreview();
  const addToMain = useDeckStore((s) => s.addToMain);
  const addCard = (card: DeckCard) => {
    addToMain({ ...card, identity: { ...card.identity, id: crypto.randomUUID() } });
    toast.success(`Added ${card.identity.name}`);
  };
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  const [activeColors, setActiveColors] = useState<Set<string>>(new Set());
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [activeCmc, setActiveCmc] = useState<CmcId>("any");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [detailCard, setDetailCard] = useState<ScryfallCard | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(INITIAL_ADVANCED);

  const advCount = countAdvancedFilters(advanced);
  const basicCount = activeColors.size + activeTypes.size + (activeCmc !== "any" ? 1 : 0);
  const hasActiveFilters = basicCount > 0 || advCount > 0;

  const observerTarget = useRef(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const focusSearchInput = () => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };

  // On the standalone search page CardSearch owns the `/` shortcut. As the
  // deck-editor panel the editor owns it (so it can open the panel first)
  // and drives focus through `focusSignal`.
  useKeybindings(standalone ? { "card-search-focus": focusSearchInput } : {});

  useEffect(() => {
    if (focusSignal) focusSearchInput();
  }, [focusSignal]);

  const effectiveQuery = buildScryfallQuery(
    debouncedText,
    activeColors,
    activeTypes,
    activeCmc,
    advanced,
  );
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } = useCardSearch(
    effectiveQuery,
    advanced.sort || undefined,
    advanced.sortDir !== "auto" ? advanced.sortDir : undefined,
  );

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedText(text), 500);
    return () => clearTimeout(handler);
  }, [text]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage) fetchNextPage();
      },
      { threshold: 1.0 },
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  function toggleColor(id: string) {
    setActiveColors((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleType(id: string) {
    setActiveTypes((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAdvSet(field: "rarity" | "is" | "colorIdentity" | "produces", id: string) {
    setAdvanced((prev) => {
      const n = new Set(prev[field]);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return { ...prev, [field]: n };
    });
  }
  function setAdv<K extends keyof AdvancedFilters>(key: K, value: AdvancedFilters[K]) {
    setAdvanced((prev) => ({ ...prev, [key]: value }));
  }
  function toggleAdvString(key: keyof AdvancedFilters, value: string) {
    setAdvanced((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }));
  }

  // Keep both DeckCard and raw ScryfallCard arrays in sync
  const rawCards: ScryfallCard[] = data?.pages.flatMap((p) => p.data) ?? [];
  const allCards: DeckCard[] = rawCards.map(scryfallToDeckCard);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Filters */}
      <div className="p-3 border-b space-y-2 shrink-0">
        <div className="flex gap-2">
          {onClose && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              title="Close search panel"
              onClick={onClose}
            >
              <PanelRightClose className="h-4 w-4" />
            </Button>
          )}
          <Input
            ref={searchInputRef}
            placeholder="Search cards…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            variant={showFilters || hasActiveFilters ? "secondary" : "outline"}
            className={cn(
              "h-8 px-2 gap-1 shrink-0",
              hasActiveFilters && !showFilters && "border-primary",
            )}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="text-xs">Filters</span>
            {hasActiveFilters && (
              <span className="bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                {basicCount + advCount}
              </span>
            )}
          </Button>
          <div className="flex border rounded-md overflow-hidden shrink-0">
            <button
              type="button"
              title="Grid view"
              onClick={() => setViewMode("grid")}
              className={cn(
                "px-2 py-1 text-xs transition-colors",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="List view"
              onClick={() => setViewMode("list")}
              className={cn(
                "px-2 py-1 text-xs transition-colors border-l",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="space-y-1 pt-1">
            {/* ── Colors ── */}
            <FilterSeparator label="Colors & Mana" />

            <FilterRow>
              <FilterLabel>Color</FilterLabel>
              <div className="flex items-center gap-0.5">
                {COLOR_FILTERS.map((f) =>
                  f.id === "M" ? (
                    <FilterBtn
                      key={f.id}
                      active={activeColors.has(f.id)}
                      onClick={() => toggleColor(f.id)}
                      title={f.title}
                    >
                      M
                    </FilterBtn>
                  ) : (
                    <ManaFilterBtn
                      key={f.id}
                      symbol={f.id}
                      active={activeColors.has(f.id)}
                      onClick={() => toggleColor(f.id)}
                      title={f.title}
                    />
                  ),
                )}
              </div>
            </FilterRow>

            <FilterRow>
              <FilterLabel>Identity</FilterLabel>
              <div className="flex items-center gap-0.5">
                {COLOR_IDENTITY_FILTERS.map((f) => (
                  <ManaFilterBtn
                    key={f.id}
                    symbol={f.id}
                    active={advanced.colorIdentity.has(f.id)}
                    onClick={() => toggleAdvSet("colorIdentity", f.id)}
                    title={`Color Identity: ${f.title}`}
                  />
                ))}
              </div>
            </FilterRow>

            <FilterRow>
              <FilterLabel>Produces</FilterLabel>
              <div className="flex items-center gap-0.5">
                {PRODUCES_FILTERS.map((f) => (
                  <ManaFilterBtn
                    key={f.id}
                    symbol={f.id}
                    active={advanced.produces.has(f.id)}
                    onClick={() => toggleAdvSet("produces", f.id)}
                    title={`Produces ${f.title} mana`}
                  />
                ))}
              </div>
            </FilterRow>

            <FilterRow>
              <FilterLabel>Mana</FilterLabel>
              <Input
                className="h-7 text-xs w-40"
                placeholder="e.g. {2}{W}{W}"
                value={advanced.manaCost}
                onChange={(e) => setAdv("manaCost", e.target.value)}
              />
            </FilterRow>

            {/* ── Card Properties ── */}
            <FilterSeparator label="Card Properties" />

            <FilterRow className="flex-wrap">
              <FilterLabel>Type</FilterLabel>
              {TYPE_FILTERS.map((f) => (
                <FilterBtn
                  key={f.id}
                  active={activeTypes.has(f.id)}
                  onClick={() => toggleType(f.id)}
                >
                  {f.label}
                </FilterBtn>
              ))}
            </FilterRow>

            <FilterRow className="flex-wrap">
              <FilterLabel>CMC</FilterLabel>
              {CMC_FILTERS.map((f) => (
                <FilterBtn
                  key={f.id}
                  active={activeCmc === f.id}
                  onClick={() => setActiveCmc(f.id)}
                >
                  {f.label}
                </FilterBtn>
              ))}
            </FilterRow>

            <FilterRow className="flex-wrap">
              <FilterLabel>Rarity</FilterLabel>
              {RARITY_FILTERS.map((f) => (
                <FilterBtn
                  key={f.id}
                  active={advanced.rarity.has(f.id)}
                  onClick={() => toggleAdvSet("rarity", f.id)}
                  title={f.title}
                >
                  {f.label}
                </FilterBtn>
              ))}
            </FilterRow>

            <FilterRow className="flex-wrap">
              <FilterLabel>Stats</FilterLabel>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 uppercase">pow</span>
                <select
                  className="h-6 text-xs pointer-coarse:h-9 pointer-coarse:text-base bg-background border rounded px-1"
                  value={advanced.powerOp}
                  onChange={(e) => setAdv("powerOp", e.target.value)}
                >
                  {COMPARISON_OPS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <Input
                  className="h-6 text-xs w-10"
                  placeholder="—"
                  value={advanced.power}
                  onChange={(e) => setAdv("power", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 uppercase">tou</span>
                <select
                  className="h-6 text-xs pointer-coarse:h-9 pointer-coarse:text-base bg-background border rounded px-1"
                  value={advanced.toughnessOp}
                  onChange={(e) => setAdv("toughnessOp", e.target.value)}
                >
                  {COMPARISON_OPS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <Input
                  className="h-6 text-xs w-10"
                  placeholder="—"
                  value={advanced.toughness}
                  onChange={(e) => setAdv("toughness", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 uppercase">loy</span>
                <select
                  className="h-6 text-xs pointer-coarse:h-9 pointer-coarse:text-base bg-background border rounded px-1"
                  value={advanced.loyaltyOp}
                  onChange={(e) => setAdv("loyaltyOp", e.target.value)}
                >
                  {COMPARISON_OPS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <Input
                  className="h-6 text-xs w-10"
                  placeholder="—"
                  value={advanced.loyalty}
                  onChange={(e) => setAdv("loyalty", e.target.value)}
                />
              </div>
            </FilterRow>

            {/* ── Text Search ── */}
            <FilterSeparator label="Text Search" />

            <FilterRow>
              <FilterLabel>Oracle</FilterLabel>
              <Input
                className="h-7 text-xs flex-1"
                placeholder="Card text contains…"
                value={advanced.oracleText}
                onChange={(e) => setAdv("oracleText", e.target.value)}
              />
            </FilterRow>

            <FilterRow>
              <FilterLabel>Flavor</FilterLabel>
              <Input
                className="h-7 text-xs flex-1"
                placeholder="Flavor text contains…"
                value={advanced.flavorText}
                onChange={(e) => setAdv("flavorText", e.target.value)}
              />
            </FilterRow>

            <FilterRow>
              <FilterLabel>Keyword</FilterLabel>
              <Input
                className="h-7 text-xs flex-1"
                placeholder="e.g. flying, haste, deathtouch"
                value={advanced.keyword}
                onChange={(e) => setAdv("keyword", e.target.value)}
              />
            </FilterRow>

            {/* ── Format & Legality ── */}
            <FilterSeparator label="Format & Legality" />

            <FilterRow className="flex-wrap">
              <FilterLabel>Format</FilterLabel>
              {FORMAT_FILTERS.map((f) => (
                <FilterBtn
                  key={f.id}
                  active={advanced.format === f.id}
                  onClick={() => toggleAdvString("format", f.id)}
                >
                  {f.label}
                </FilterBtn>
              ))}
            </FilterRow>

            {/* ── Printing & Availability ── */}
            <FilterSeparator label="Printing & Availability" />

            <FilterRow>
              <FilterLabel>Set</FilterLabel>
              <SetSelect value={advanced.set} onChange={(v) => setAdv("set", v)} className="w-48" />
              <FilterLabel>Artist</FilterLabel>
              <Input
                className="h-7 text-xs flex-1"
                placeholder="Artist name…"
                value={advanced.artist}
                onChange={(e) => setAdv("artist", e.target.value)}
              />
              <FilterLabel>Year</FilterLabel>
              <Input
                className="h-7 text-xs w-16"
                placeholder="2024"
                value={advanced.year}
                onChange={(e) => setAdv("year", e.target.value)}
              />
            </FilterRow>

            <FilterRow className="flex-wrap gap-3">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">
                  Frame
                </span>
                {FRAME_FILTERS.map((f) => (
                  <FilterBtn
                    key={f.id}
                    active={advanced.frame === f.id}
                    onClick={() => toggleAdvString("frame", f.id)}
                  >
                    {f.label}
                  </FilterBtn>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">
                  Border
                </span>
                {BORDER_FILTERS.map((f) => (
                  <FilterBtn
                    key={f.id}
                    active={advanced.border === f.id}
                    onClick={() => toggleAdvString("border", f.id)}
                  >
                    {f.label}
                  </FilterBtn>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">
                  Game
                </span>
                {GAME_FILTERS.map((f) => (
                  <FilterBtn
                    key={f.id}
                    active={advanced.game === f.id}
                    onClick={() => toggleAdvString("game", f.id)}
                  >
                    {f.label}
                  </FilterBtn>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">
                  Lang
                </span>
                <Input
                  className="h-6 text-xs w-14"
                  placeholder="en"
                  value={advanced.language}
                  onChange={(e) => setAdv("language", e.target.value)}
                />
              </div>
            </FilterRow>

            {/* ── Card Modifiers ── */}
            <FilterSeparator label="Card Modifiers" />

            <FilterRow className="flex-wrap">
              <FilterLabel>Is</FilterLabel>
              {IS_FILTERS.map((f) => (
                <FilterBtn
                  key={f.id}
                  active={advanced.is.has(f.id)}
                  onClick={() => toggleAdvSet("is", f.id)}
                >
                  {f.label}
                </FilterBtn>
              ))}
            </FilterRow>

            {/* ── Sort ── */}
            <FilterSeparator label="Sort & Order" />

            <FilterRow>
              <FilterLabel>Sort by</FilterLabel>
              <select
                className="h-7 text-xs pointer-coarse:h-9 pointer-coarse:text-base bg-background border rounded px-2"
                value={advanced.sort}
                onChange={(e) => setAdv("sort", e.target.value)}
              >
                <option value="">Default (CMC)</option>
                {SORT_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                className="h-7 text-xs pointer-coarse:h-9 pointer-coarse:text-base bg-background border rounded px-2"
                value={advanced.sortDir}
                onChange={(e) => setAdv("sortDir", e.target.value)}
              >
                <option value="auto">Auto</option>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </FilterRow>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3">
          {status === "pending" && effectiveQuery && (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {status === "error" && (
            <div className="text-center p-8 text-destructive">
              Error fetching cards. Please try again.
            </div>
          )}
          {!effectiveQuery && (
            <p className="text-center text-sm text-muted-foreground py-12">
              Enter a card name or select filters to search.
            </p>
          )}

          {viewMode === "grid" ? (
            <div className="flex flex-wrap gap-3 pb-4">
              {allCards.map((card, i) => (
                <div
                  key={card.identity.id}
                  className="shrink-0"
                  style={{ width: standalone ? 130 : 110 }}
                >
                  <DraggableCardGrid
                    card={card}
                    onMoreInfo={() => setDetailCard(rawCards[i])}
                    onAdd={standalone ? undefined : () => addCard(card)}
                    standalone={standalone}
                    onHover={(c, e) =>
                      preview.handleMouseEnter(c as unknown as CardDto, e, { useDelay: true })
                    }
                    onLeave={preview.handleMouseLeave}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="pb-4">
              {allCards.map((card, i) => (
                <DraggableCardRow
                  key={card.identity.id}
                  card={card}
                  onMoreInfo={() => setDetailCard(rawCards[i])}
                  onAdd={standalone ? undefined : () => addCard(card)}
                  standalone={standalone}
                  onHover={(c, e) =>
                    preview.handleMouseEnter(c as unknown as CardDto, e, { useDelay: true })
                  }
                  onLeave={preview.handleMouseLeave}
                />
              ))}
            </div>
          )}

          <div ref={observerTarget} className="h-10 flex justify-center items-center">
            {isFetchingNextPage && (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </ScrollArea>

      {detailCard && <CardDetailModal card={detailCard} onClose={() => setDetailCard(null)} />}
      <HoverCardPreview preview={preview} slot={previewSlot} pinned imageSize="normal" />
    </div>
  );
}
