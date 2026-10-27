import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { useMemo } from "react";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { parseTypeLine } from "@/lib/scryfall.utils";
import type { DeckCard } from "@/protocol/deck";
import { ExternalLink, Sparkles } from "lucide-react";
import type { SpellbookCombo } from "@/api/commanderSpellbook";
function steps(combo: SpellbookCombo): string[] {
  return combo.description
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
function prerequisites(combo: SpellbookCombo): string[] {
  return [combo.notablePrerequisites, combo.easyPrerequisites]
    .flatMap((block) => block.split("\n"))
    .map((s) => s.trim())
    .filter(Boolean);
}
export function ComboDetailModal({
  combo,
  onClose,
}: {
  combo: SpellbookCombo;
  onClose: () => void;
}) {
  const produces = combo.produces.map((p) => p.feature.name);
  const prereqs = prerequisites(combo);
  const cards = useMemo<DeckCard[]>(
    () =>
      combo.uses.map(({ card }) => {
        const image = card.imageUriFrontNormal ?? "";
        return {
          identity: { id: "", name: card.name, setCode: "", cardNumber: "" },
          uris: {
            small: image,
            normal: image,
            large: image,
            png: image,
            border_crop: image,
            art_crop: "",
          },
          color: "",
          colorIdentity: [],
          manaCost: "",
          cmc: 0,
          text: "",
          ...parseTypeLine(card.typeLine ?? ""),
        };
      }),
    [combo.uses],
  );
  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <Modal.Header onClose={onClose}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-counter-charge shrink-0" />
          <h2 className="text-lg font-bold break-words">{produces.join(", ") || `Combo`}</h2>
        </div>
      </Modal.Header>

      <Modal.Body className="p-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap gap-3">
              {cards.map((card) => (
                <div key={card.identity.name} className="w-32 shrink-0">
                  <GeneratedCardImage
                    deckCard={card}
                    className="w-full rounded-lg border border-border/50 shadow-sm"
                  />
                  <div
                    className="text-ui-label text-center mt-1 break-words"
                    title={card.identity.name}
                  >
                    {card.identity.name}
                  </div>
                </div>
              ))}
            </div>

            {produces.length > 0 && (
              <div>
                <div className="text-ui-label font-semibold text-muted-foreground mb-1">
                  Produces
                </div>
                <div className="flex flex-wrap gap-1">
                  {produces.map((name) => (
                    <span
                      key={name}
                      className="text-ui-label rounded bg-counter-charge/10 text-counter-charge px-1.5 py-0.5"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(prereqs.length > 0 || combo.manaNeeded) && (
              <div>
                <div className="text-ui-label font-semibold text-muted-foreground mb-1">
                  Prerequisites
                </div>
                {combo.manaNeeded && (
                  <div className="flex flex-wrap items-center gap-1.5 text-ui-label mb-1">
                    <span className="text-muted-foreground">Mana:</span>
                    <ManaSymbols cost={combo.manaNeeded} size="sm" />
                  </div>
                )}
                <ul className="space-y-0.5">
                  {prereqs.map((req, i) => (
                    <li
                      key={i}
                      className="text-ui-body text-muted-foreground flex items-start gap-1.5"
                    >
                      <span className="shrink-0 mt-0.5">&#x2022;</span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="text-ui-label font-semibold text-muted-foreground mb-1">Steps</div>
              <ol className="space-y-1.5">
                {steps(combo).map((step, i) => (
                  <li key={i} className="text-ui-body flex gap-2">
                    <span className="shrink-0 font-mono tabular-nums text-counter-charge">
                      {i + 1}.
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </ScrollArea>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex flex-wrap gap-2 w-full justify-between">
          <a
            href={`https://commanderspellbook.com/combo/${combo.id}/`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Button
              size="sm"
              variant="outline"
              className="h-auto touch:min-h-11 touch:min-w-11 gap-1.5 whitespace-normal text-ui-label"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View on Commander Spellbook
            </Button>
          </a>
          <Button
            size="sm"
            variant="ghost"
            className="h-auto touch:min-h-11 touch:min-w-11 text-ui-label"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
