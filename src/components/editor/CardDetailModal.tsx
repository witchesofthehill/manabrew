import { useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Plus,
  Minus,
  Loader2,
  Image as ImageIcon,
  ChevronDown,
  Tag,
  Check,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  LibraryBig,
} from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";
import { Input } from "@/components/ui/input";
import { useCard, useCardRulings, useScryfallStore } from "@/stores/useScryfallStore";
import { isHorizontalCard } from "@/lib/cardLayout";
import { HorizontalCardImage } from "@/components/game/HorizontalCardImage";
import { ScryfallImg } from "@/components/ScryfallImg";
import { usePreferredPrintsStore } from "@/stores/usePreferredPrintsStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { PrintPickerModal } from "@/components/editor/PrintPickerModal";
import { getScryfallManaCost } from "@/api/scryfall";
import { frontFaceName, scryfallToDeckCard } from "@/lib/scryfall.utils";
import { cardFaceImageUris } from "@/lib/cardImage";
import { useSetLookup } from "@/stores/useScryfallStore";
import { FORMAT_DISPLAY, LEGALITY_STYLES } from "@/lib/constants";
import { formatRequiresCommander } from "@/lib/formats";
import { DEFAULT_COMMANDER_SLOT, type CommanderSlot } from "@/components/editor/deckEditor.utils";
import { toast } from "sonner";
import type { ScryfallCard } from "@/types/scryfall";
import type { DeckCard } from "@/protocol/deck";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { collectionOwnership, collectionQuantityForName } from "@/lib/collection";
import { useIsUnsupported } from "@/stores/useCardSupportStore";

interface DeckEditorActions {
  onAddOne: (cardName: string) => void;
  onRemoveOne: (cardName: string) => void;
  onPickPrint: (cardName: string) => void;
  onSetCommander: (cardName: string) => void;
  isCommander?: boolean;
  commanderSlot?: CommanderSlot;
  deckFormat?: string;
  customTags?: string[];
  onTagCard?: (cardName: string, tag: string) => void;
  onUntagCard?: (cardName: string, tag: string) => void;
  onAddTag?: (tag: string) => void;
  onToggleFoil?: (cardName: string) => void;
  onSetCover?: (cardName: string, face: 0 | 1) => void;
  token?: DeckCard;
  onUpdateTokenPrint?: (tokenName: string, print: ScryfallCard) => void;
}

interface CardDetailModalProps {
  card: ScryfallCard;
  onClose: () => void;
  deckEditorActions?: DeckEditorActions;
  readOnly?: boolean;
}

export function CardDetailModal({
  card: initialCard,
  onClose,
  deckEditorActions,
  readOnly = false,
}: CardDetailModalProps) {
  const [showPrints, setShowPrints] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [selectedPrint, setSelectedPrint] = useState<ScryfallCard | null>(null);
  const [faceIndex, setFaceIndex] = useState<0 | 1>(0);
  const rulingsData = useCardRulings(initialCard);
  const updatePrinting = useScryfallStore((s) => s.updatePrinting);
  const rulingsLoading = !rulingsData;
  const { setPreferredPrint } = usePreferredPrintsStore();
  const setLookup = useSetLookup();
  const { savedDecks, currentDeck, addToMain, addCardToSavedDeck, updatePrint } = useDeckStore();
  const collectionQuantities = useCollectionStore((state) => state.quantities);

  const cardId = initialCard?.id;
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (prevCardId !== cardId) {
    setPrevCardId(cardId);
    setSelectedPrint(null);
    setShowPrints(false);
    setShowDeckPicker(false);
    setFaceIndex(0);
  }

  const card = selectedPrint ?? initialCard;
  const deckCardName = frontFaceName(card.name);
  const deckCards = [
    ...currentDeck.cards,
    ...currentDeck.sideboard,
    ...(currentDeck.maybeboard ?? []),
    ...(currentDeck.commanders ?? []),
  ];
  const matchingDeckCard = deckCards.find((candidate) => candidate.identity.name === deckCardName);
  const unsupported = useIsUnsupported(deckCardName);
  const owned = collectionQuantityForName(collectionQuantities, deckCardName);
  const exactOwnership = matchingDeckCard
    ? collectionOwnership(
        collectionQuantities,
        deckCardName,
        matchingDeckCard.identity.setCode,
        matchingDeckCard.identity.cardNumber,
        matchingDeckCard.identity.foil,
      )
    : "none";
  const zoneCounts = {
    main: currentDeck.cards.filter((candidate) => candidate.identity.name === deckCardName).length,
    side: currentDeck.sideboard.filter((candidate) => candidate.identity.name === deckCardName)
      .length,
    maybe: (currentDeck.maybeboard ?? []).filter(
      (candidate) => candidate.identity.name === deckCardName,
    ).length,
    command: (currentDeck.commanders ?? []).filter(
      (candidate) => candidate.identity.name === deckCardName,
    ).length,
  };
  const appliedTags = currentDeck.cardTags?.[deckCardName.toLowerCase()] ?? [];
  const commanderSlot = deckEditorActions?.commanderSlot ?? DEFAULT_COMMANDER_SLOT;
  const storeCard = useCard({
    id: card.id,
    name: card.name,
    setCode: card.set,
    collectorNumber: card.collector_number,
  });
  const isDoubleFaced = !!(card.card_faces && card.card_faces.length >= 2);

  const activeFace = isDoubleFaced ? card.card_faces![faceIndex] : null;
  const faceUris = cardFaceImageUris(card, storeCard?.uris, faceIndex);
  const imageUrl = faceUris?.large ?? faceUris?.normal;
  const manaCost = activeFace?.mana_cost ?? getScryfallManaCost(card);
  const displayName = activeFace?.name ?? card.name;
  const typeLine = activeFace?.type_line ?? card.type_line;
  const oracleText = activeFace?.oracle_text ?? card.oracle_text;
  const power = (activeFace as { power?: string } | null)?.power ?? card.power;
  const toughness = (activeFace as { toughness?: string } | null)?.toughness ?? card.toughness;

  const rulings = rulingsData?.data ?? [];

  const isHorizontalActiveFace = activeFace
    ? isHorizontalCard({ typeLine: activeFace.type_line })
    : isHorizontalCard({ layout: card.layout, typeLine: card.type_line });

  function handleAddToCurrentDeck() {
    addToMain(scryfallToDeckCard(card));
    setShowDeckPicker(false);
    toast.success(`Added to ${currentDeck.name}`);
  }

  function handleAddToSavedDeck(deckId: string, deckName: string) {
    addCardToSavedDeck(deckId, scryfallToDeckCard(card));
    setShowDeckPicker(false);
    toast.success(`Added to ${deckName}`);
  }

  function handleAddNewTag() {
    if (!newTagInput.trim() || !deckEditorActions?.onTagCard) return;
    deckEditorActions.onAddTag?.(newTagInput.trim());
    deckEditorActions.onTagCard(deckCardName, newTagInput.trim());
    toast.success(`Tagged "${deckCardName}" with "${newTagInput.trim()}"`);
    setNewTagInput("");
    setShowDeckPicker(false);
  }

  function handleSelectPrint(print: ScryfallCard) {
    setSelectedPrint(print);
    setFaceIndex(0);
    const newEntry = updatePrinting(print);
    setPreferredPrint(initialCard!.oracle_id, {
      set: print.set,
      collectorNumber: print.collector_number,
      imageUrl: newEntry.uris.png,
    });
    if (deckEditorActions?.token && deckEditorActions.onUpdateTokenPrint) {
      deckEditorActions.onUpdateTokenPrint(deckCardName, print);
    } else if (deckEditorActions) {
      updatePrint(deckCardName, print);
    }
  }

  return (
    <>
      <Modal onClose={onClose} maxWidth="max-w-4xl" maxHeight="max-h-[90dvh]">
        <Modal.Header onClose={onClose}>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold truncate">{displayName}</h2>
            {isDoubleFaced && (
              <span className="text-xs text-muted-foreground shrink-0">
                {faceIndex === 0 ? "Front" : "Back"} face
              </span>
            )}
            {manaCost && <ManaSymbols cost={manaCost} size="sm" className="shrink-0" />}
          </div>
        </Modal.Header>

        <Modal.Body className="p-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <div className="flex flex-col gap-6 sm:flex-row">
                <div
                  className={cn(
                    "mx-auto w-full shrink-0 sm:mx-0",
                    isHorizontalActiveFace ? "max-w-96 sm:w-96" : "max-w-64 sm:w-64",
                  )}
                >
                  {imageUrl ? (
                    isHorizontalActiveFace ? (
                      <HorizontalCardImage
                        src={imageUrl}
                        alt={displayName}
                        className="w-full aspect-[7/5] rounded-lg shadow-lg"
                      />
                    ) : (
                      <ScryfallImg
                        src={imageUrl}
                        alt={displayName}
                        className="w-full rounded-lg shadow-lg"
                      />
                    )
                  ) : (
                    <div
                      className={cn(
                        "w-full rounded-lg bg-muted flex items-center justify-center",
                        isHorizontalActiveFace ? "aspect-[7/5]" : "aspect-[5/7]",
                      )}
                    >
                      <span className="text-muted-foreground text-sm">No Image</span>
                    </div>
                  )}

                  {isDoubleFaced && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 gap-1.5"
                      onClick={() => setFaceIndex(faceIndex === 0 ? 1 : 0)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {faceIndex === 0
                        ? `Show back: ${card.card_faces![1].name}`
                        : `Show front: ${card.card_faces![0].name}`}
                    </Button>
                  )}

                  {!deckEditorActions && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 gap-1"
                      onClick={() => setShowPrints(true)}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      Show All Printings
                    </Button>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-muted-foreground">Type</div>
                    <div className="text-sm">{typeLine}</div>
                  </div>

                  {deckEditorActions && matchingDeckCard && (
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="text-sm font-semibold">Deck inspector</div>
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {zoneCounts.main > 0 && (
                          <Badge variant="outline">Main {zoneCounts.main}</Badge>
                        )}
                        {zoneCounts.side > 0 && (
                          <Badge variant="outline">Side {zoneCounts.side}</Badge>
                        )}
                        {zoneCounts.maybe > 0 && (
                          <Badge variant="outline">Maybe {zoneCounts.maybe}</Badge>
                        )}
                        {zoneCounts.command > 0 && (
                          <Badge variant="outline">Command {zoneCounts.command}</Badge>
                        )}
                        <Badge variant="outline">
                          {matchingDeckCard.identity.foil ? "Foil" : "Non-foil"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <LibraryBig className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>
                          {exactOwnership === "exact"
                            ? `Exact printing owned · ${owned} total`
                            : exactOwnership === "other"
                              ? `Owned in another printing · ${owned} total`
                              : "Not in collection"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {unsupported ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                        ) : (
                          <Check className="h-3.5 w-3.5 text-legality-legal" />
                        )}
                        <span>
                          {unsupported
                            ? "Unsupported by the Manabrew and Forge engines"
                            : "Supported by the Manabrew and Forge engines"}
                        </span>
                      </div>
                      {!readOnly && appliedTags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {appliedTags.map((tag) => (
                            <Button
                              key={tag}
                              variant="outline"
                              size="sm"
                              className="h-6 gap-1 px-2 text-xs"
                              onClick={() => deckEditorActions.onUntagCard?.(deckCardName, tag)}
                            >
                              <Tag className="h-3 w-3" />
                              {tag}
                              <Minus className="h-3 w-3" />
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {oracleText && (
                    <div>
                      <div className="text-sm font-semibold text-muted-foreground">Oracle Text</div>
                      <div className="text-sm whitespace-pre-wrap bg-muted/30 rounded p-2 border">
                        {oracleText}
                      </div>
                    </div>
                  )}

                  {power && toughness && (
                    <div className="flex gap-4">
                      <div>
                        <span className="text-sm font-semibold text-muted-foreground">P/T: </span>
                        <span className="text-sm font-bold">
                          {power}/{toughness}
                        </span>
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-muted-foreground">CMC: </span>
                        <span className="text-sm">{card.cmc}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-muted-foreground">Set: </span>
                      {setLookup.get(card.set)?.icon_svg_uri && (
                        <ScryfallImg
                          src={setLookup.get(card.set)!.icon_svg_uri}
                          alt=""
                          className="h-4 w-4 shrink-0 brightness-0 dark:invert"
                        />
                      )}
                      <span>
                        {card.set_name} ({card.set.toUpperCase()})
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-muted-foreground">Rarity: </span>
                      <span className="capitalize">{card.rarity}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-muted-foreground"># </span>
                      <span>{card.collector_number}</span>
                    </div>
                  </div>

                  <div className="text-sm">
                    <span className="font-semibold text-muted-foreground">Artist: </span>
                    <span>{card.artist}</span>
                  </div>

                  {card.edhrec_rank && (
                    <div className="text-sm">
                      <span className="font-semibold text-muted-foreground">EDHREC Rank: </span>
                      <span>#{card.edhrec_rank.toLocaleString()}</span>
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-semibold text-muted-foreground mb-1">Prices</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      {card.prices.usd && <span>USD ${card.prices.usd}</span>}
                      {card.prices.usd_foil && <span>Foil ${card.prices.usd_foil}</span>}
                      {card.prices.eur && <span>EUR €{card.prices.eur}</span>}
                      {card.prices.tix && <span>TIX {card.prices.tix}</span>}
                      {!card.prices.usd && !card.prices.eur && !card.prices.tix && (
                        <span className="text-muted-foreground">No price data</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-muted-foreground mb-1">Legalities</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {Object.entries(FORMAT_DISPLAY).map(([key, label]) => {
                    const status = card.legalities[key] ?? "not_legal";
                    return (
                      <Badge
                        key={key}
                        variant="outline"
                        className={cn(
                          "text-xs justify-between px-2 py-0.5",
                          LEGALITY_STYLES[status],
                        )}
                      >
                        <span>{label}</span>
                        <span className="capitalize">{status.replace("_", " ")}</span>
                      </Badge>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-muted-foreground mb-1">
                  Rulings {rulings.length > 0 && `(${rulings.length})`}
                </div>
                {rulingsLoading && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!rulingsLoading && rulings.length === 0 && (
                  <p className="text-sm text-muted-foreground">No rulings available.</p>
                )}
                {rulings.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {rulings.map((r, i) => (
                      <div key={i} className="text-xs border rounded p-2 bg-muted/20">
                        <div className="text-muted-foreground mb-0.5">
                          {r.published_at} — {r.source}
                        </div>
                        <div>{r.comment}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </Modal.Body>

        <Modal.Footer>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {deckEditorActions && !readOnly ? (
              <div className="flex items-center gap-1">
                <div className="flex items-center rounded-md border bg-muted/30 p-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Remove one copy"
                    onClick={() => {
                      deckEditorActions.onRemoveOne(deckCardName);
                      toast.success(`Removed one ${deckCardName}`);
                    }}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  {deckEditorActions.onToggleFoil && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn("h-7 w-7", matchingDeckCard?.identity.foil && "text-warning")}
                      title={matchingDeckCard?.identity.foil ? "Remove foil" : "Make foil"}
                      onClick={() => deckEditorActions.onToggleFoil?.(deckCardName)}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {deckEditorActions.onSetCover && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn(
                        "h-7 w-7",
                        currentDeck.coverCardName === deckCardName && "text-primary",
                      )}
                      title={
                        currentDeck.coverCardName === deckCardName
                          ? "Remove deck cover"
                          : "Set as deck cover"
                      }
                      onClick={() => deckEditorActions.onSetCover?.(deckCardName, faceIndex)}
                    >
                      <GameIcon name="book-cover" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <span className="min-w-6 px-1 text-center text-xs font-semibold tabular-nums">
                    {currentDeck.cards.filter((c) => c.identity.name === deckCardName).length}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Add one copy"
                    onClick={() => {
                      deckEditorActions.onAddOne(deckCardName);
                      toast.success(`Added ${deckCardName}`);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex items-center rounded-md border bg-muted/30 p-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Change printing"
                    onClick={() => setShowPrints(true)}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                  </Button>
                  {isDoubleFaced && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title={
                        faceIndex === 0
                          ? `Flip to back: ${card.card_faces![1].name}`
                          : `Flip to front: ${card.card_faces![0].name}`
                      }
                      onClick={() => setFaceIndex(faceIndex === 0 ? 1 : 0)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {formatRequiresCommander(deckEditorActions.deckFormat) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn("h-7 w-7", deckEditorActions.isCommander && "text-commander")}
                      title={
                        deckEditorActions.isCommander
                          ? `Remove as ${commanderSlot.noun}`
                          : `Set as ${commanderSlot.noun}`
                      }
                      onClick={() => {
                        deckEditorActions.onSetCommander(deckCardName);
                        toast.success(
                          deckEditorActions.isCommander
                            ? `Removed ${deckCardName} as ${commanderSlot.noun}`
                            : `Set ${deckCardName} as ${commanderSlot.noun}`,
                        );
                      }}
                    >
                      <GameIcon name={commanderSlot.icon} className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {deckEditorActions.onTagCard && (
                  <div className="relative ml-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-8"
                      onClick={() => setShowDeckPicker((v) => !v)}
                    >
                      <Tag className="h-3.5 w-3.5" />
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                    {showDeckPicker && (
                      <div className="absolute bottom-full left-0 mb-1 w-48 bg-popover border rounded-md shadow-lg py-1 z-10">
                        {(deckEditorActions.customTags ?? []).map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
                            onClick={() => {
                              deckEditorActions.onTagCard!(deckCardName, tag);
                              setShowDeckPicker(false);
                              toast.success(`Tagged "${deckCardName}" with "${tag}"`);
                            }}
                          >
                            <Tag className="h-3 w-3 text-primary/60" />
                            <span className="flex-1 truncate">{tag}</span>
                          </button>
                        ))}
                        {(deckEditorActions.customTags ?? []).length > 0 && (
                          <div className="border-t my-1" />
                        )}
                        <div className="px-2 py-1 flex items-center gap-1">
                          <Input
                            className="h-7 text-xs flex-1"
                            placeholder="New tag…"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddNewTag();
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            disabled={!newTagInput.trim()}
                            onClick={handleAddNewTag}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : !readOnly ? (
              <div className="relative">
                <Button size="sm" className="gap-1" onClick={() => setShowDeckPicker((v) => !v)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add to Deck
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>

                {showDeckPicker && (
                  <div className="absolute bottom-full left-0 mb-1 w-64 bg-popover border rounded-md shadow-lg py-1 z-10">
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                      Select a deck
                    </div>
                    {currentDeck.name && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
                        onClick={handleAddToCurrentDeck}
                      >
                        <span className="flex-1 truncate">{currentDeck.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                          editing
                        </Badge>
                      </button>
                    )}
                    {savedDecks.length > 0 && <div className="border-t my-1" />}
                    <ScrollArea className={savedDecks.length > 6 ? "max-h-48" : ""}>
                      {savedDecks.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
                          onClick={() => handleAddToSavedDeck(s.id, s.deck.name)}
                        >
                          <span className="flex-1 truncate">{s.deck.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {s.deck.cards.length} cards
                          </span>
                        </button>
                      ))}
                    </ScrollArea>
                    {savedDecks.length === 0 && !currentDeck.name && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No decks available
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </Modal.Footer>
      </Modal>

      {showPrints && (
        <PrintPickerModal
          cardName={card.name}
          onClose={() => setShowPrints(false)}
          onSelect={handleSelectPrint}
          token={deckEditorActions?.token}
        />
      )}
    </>
  );
}
