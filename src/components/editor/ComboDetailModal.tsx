import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { ScryfallImg } from "@/components/ScryfallImg";
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

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl" maxHeight="max-h-[90vh]">
      <Modal.Header onClose={onClose}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-counter-charge shrink-0" />
          <h2 className="text-lg font-bold truncate">{produces.join(", ") || "Combo"}</h2>
        </div>
      </Modal.Header>

      <Modal.Body className="p-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap gap-3">
              {combo.uses.map(({ card }) => (
                <div key={card.name} className="w-32 shrink-0">
                  {card.imageUriFrontNormal ? (
                    <ScryfallImg
                      src={card.imageUriFrontNormal}
                      alt={card.name}
                      className="w-full rounded-lg border border-border/50 shadow-sm"
                    />
                  ) : (
                    <div className="w-full aspect-[5/7] rounded-lg bg-muted flex items-center justify-center p-2 text-center">
                      <span className="text-xs text-muted-foreground">{card.name}</span>
                    </div>
                  )}
                  <div className="text-xs text-center mt-1 truncate" title={card.name}>
                    {card.name}
                  </div>
                </div>
              ))}
            </div>

            {produces.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-muted-foreground mb-1">Produces</div>
                <div className="flex flex-wrap gap-1">
                  {produces.map((name) => (
                    <span
                      key={name}
                      className="text-xs rounded bg-counter-charge/10 text-counter-charge px-1.5 py-0.5"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(prereqs.length > 0 || combo.manaNeeded) && (
              <div>
                <div className="text-sm font-semibold text-muted-foreground mb-1">
                  Prerequisites
                </div>
                {combo.manaNeeded && (
                  <div className="flex items-center gap-1.5 text-sm mb-1">
                    <span className="text-muted-foreground">Mana:</span>
                    <ManaSymbols cost={combo.manaNeeded} size="sm" />
                  </div>
                )}
                <ul className="space-y-0.5">
                  {prereqs.map((req, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-1.5">
                      <span className="shrink-0 mt-0.5">&#x2022;</span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="text-sm font-semibold text-muted-foreground mb-1">Steps</div>
              <ol className="space-y-1.5">
                {steps(combo).map((step, i) => (
                  <li key={i} className="text-sm flex gap-2">
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
        <div className="flex gap-2 w-full justify-between">
          <a
            href={`https://commanderspellbook.com/combo/${combo.id}/`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Button size="sm" variant="outline" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              View on Commander Spellbook
            </Button>
          </a>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
