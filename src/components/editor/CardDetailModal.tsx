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
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useSetLookup } from "@/stores/useScryfallStore";
import { FORMAT_DISPLAY, LEGALITY_STYLES } from "@/lib/constants";
import { toast } from "sonner";
import type { ScryfallCard } from "@/types/scryfall";

interface DeckEditorActions {
  onAddOne: (cardName: string) => void;
  onRemoveOne: (cardName: string) => void;
  onPickPrint: (cardName: string) => void;
  onSetCommander: (cardName: string) => void;
  isCommander?: boolean;
  deckFormat?: string;
  customTags?: string[];
  onTagCard?: (cardName: string, tag: string) => void;
  onAddTag?: (tag: string) => void;
  isToken?: boolean;
  onUpdateTokenPrint?: (tokenName: string, print: ScryfallCard) => void;
}

interface CardDetailModalProps {
  card: ScryfallCard;
  onClose: () => void;
  deckEditorActions?: DeckEditorActions;
}

export function CardDetailModal({
  card: initialCard,
  onClose,
  deckEditorActions,
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
  const storeCard = useCard({
    id: card.id,
    name: card.name,
    setCode: card.set,
    collectorNumber: card.collector_number,
  });
  const isDoubleFaced = !!(card.card_faces && card.card_faces.length >= 2);

  const activeFace = isDoubleFaced ? card.card_faces![faceIndex] : null;
  const imageUrl =
    activeFace?.image_uris?.large ?? activeFace?.image_uris?.normal ?? storeCard?.uris.large;
  const manaCost = activeFace?.mana_cost ?? getScryfallManaCost(card);
  const displayName = activeFace?.name ?? card.name;
  const typeLine = activeFace?.type_line ?? card.type_line;
  const oracleText = activeFace?.oracle_text ?? card.oracle_text;
  const power = (activeFace as { power?: string } | null)?.power ?? card.power;
  const toughness = (activeFace as { toughness?: string } | null)?.toughness ?? card.toughness;

  const rulings = rulingsData?.data ?? [];

  // Active face's type line drives orientation, not the parent layout.
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
    deckEditorActions.onTagCard(card.name, newTagInput.trim());
    toast.success(`Tagged "${card.name}" with "${newTagInput.trim()}"`);
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
    if (deckEditorActions && deckEditorActions.isToken && deckEditorActions.onUpdateTokenPrint) {
      deckEditorActions.onUpdateTokenPrint(card.name, print);
    } else if (deckEditorActions) {
      updatePrint(card.name, print);
    }
  }

  return (
    <>
      <Modal onClose={onClose} maxWidth="max-w-4xl" maxHeight="max-h-[90vh]">
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

                  {/* Flip button — only for double-faced cards */}
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
            {deckEditorActions ? (
              <div className="flex items-center gap-1">
                {/* +/- stepper */}
                <div className="flex items-center rounded-md border bg-muted/30 p-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Remove one copy"
                    onClick={() => {
                      deckEditorActions.onRemoveOne(card.name);
                      toast.success(`Removed one ${card.name}`);
                    }}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="min-w-6 px-1 text-center text-xs font-semibold tabular-nums">
                    {currentDeck.cards.filter((c) => c.name === card.name).length}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Add one copy"
                    onClick={() => {
                      deckEditorActions.onAddOne(card.name);
                      toast.success(`Added ${card.name}`);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Icon toolbar */}
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
                  {deckEditorActions.deckFormat === "commander" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn("h-7 w-7", deckEditorActions.isCommander && "text-commander")}
                      title={
                        deckEditorActions.isCommander ? "Remove as commander" : "Set as commander"
                      }
                      onClick={() => {
                        deckEditorActions.onSetCommander(card.name);
                        toast.success(
                          deckEditorActions.isCommander
                            ? `Removed ${card.name} as commander`
                            : `Set ${card.name} as commander`,
                        );
                      }}
                    >
                      <GameIcon name="overlord-helm" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {/* Tag dropdown */}
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
                              deckEditorActions.onTagCard!(card.name, tag);
                              setShowDeckPicker(false);
                              toast.success(`Tagged "${card.name}" with "${tag}"`);
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
            ) : (
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
            )}
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
          isToken={deckEditorActions?.isToken}
        />
      )}
    </>
  );
}
