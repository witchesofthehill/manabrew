import { useEffect, useMemo, useState } from "react";
import { ScryfallImg } from "@/components/ScryfallImg";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { CardPreview } from "@/components/game/CardPreview";
import { Button } from "@/components/ui/button";
import { DesktopBoardOverlayCanvas } from "@/pixi/DesktopBoardOverlayCanvas";
import type { BoardOverlayPreviewSpec } from "@/pixi/BoardOverlayCanvas";
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { DeckCard } from "@/protocol/deck";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { CardFoilOverlay } from "@/components/game/CardFoilOverlay";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";

const EMPTY_STACK = { cards: [], flash: null, showPreStackFlash: false, collapsed: true };
const ignore = () => undefined;

export function CardRenderingComparison({
  card,
  deckCard,
  imageUrl,
  face,
  actions,
  onFlip,
  onAction,
  lighting,
  pose,
  historicalPrinting,
}: {
  card: ClientCardDto;
  deckCard: DeckCard;
  imageUrl: string;
  face: 0 | 1;
  actions: HandActionOption[];
  onFlip: () => void;
  onAction: (action: HandActionOption) => void;
  lighting: CardLightingMode;
  pose: CardPose;
  historicalPrinting: boolean;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [printedHost, setPrintedHost] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  const [generated, setGenerated] = useState(true);
  const { info } = useResolvedGameCard(card);
  const hidden = card.isFaceDown || !card.identity.name;
  useEffect(() => {
    if (!host) return;
    const node = host;
    const update = () => setBounds(node.getBoundingClientRect());
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
    };
  }, [host]);
  const preview = useMemo<BoardOverlayPreviewSpec | null>(
    () =>
      bounds && generated
        ? {
            card,
            phase: "open",
            sticky: false,
            placement: "pinned",
            showBackFace: face === 1,
            suppressed: false,
            skipEnterAnimation: true,
            actions,
            reserveSidePanel: false,
            lighting,
            pose,
            mousePos: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
            anchorRect: null,
            slotRect: bounds,
          }
        : null,
    [bounds, generated, card, face, actions, lighting, pose],
  );
  return (
    <div className="grid grid-cols-1 gap-4 @[960px]:grid-cols-3">
      <section
        className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3"
        aria-label="Interactive Pixi card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Interactive Pixi</h2>
          <Button variant="outline" size="sm" onClick={() => setGenerated((value) => !value)}>
            {generated ? "Show Realistic" : "Show Manabrew"}
          </Button>
        </div>
        <div ref={setHost} className="relative h-[440px]" data-testid="interactive-card">
          <DesktopBoardOverlayCanvas
            scene={null}
            stackSpec={EMPTY_STACK}
            promptSpec={null}
            onTargetSpell={ignore}
            onHoverStack={ignore}
            onToggleStack={ignore}
            previewSpec={preview}
            onFlipPreview={onFlip}
            onTogglePreviewView={() => setGenerated(false)}
            onSelectPreviewAction={onAction}
          />
          {!generated && <div ref={setPrintedHost} className="absolute inset-0" />}
          {!generated && printedHost && (
            <CardPreview
              card={card}
              mouseX={0}
              mouseY={0}
              placement="pinned"
              slot={printedHost}
              skipEnterAnimation
              showBackFace={face === 1}
              lighting={lighting}
              pose={pose}
              actions={actions}
              onSelectAction={onAction}
              onFlip={onFlip}
              onToggleView={() => setGenerated(true)}
            />
          )}
        </div>
        <p className="text-ui-body text-muted-foreground">
          Production rules preview. Actions stay inside the card and support scrolling, keyboard
          focus, and screen readers.
        </p>
      </section>
      <section
        className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3"
        aria-label="Original scan"
      >
        <h2 className="font-semibold">Original</h2>
        <div className="flex min-h-[440px] items-center justify-center">
          <div className="relative max-w-full" style={GAME_CARD_SIZES.preview}>
            <ScryfallImg
              src={imageUrl}
              alt={`Original ${card.identity.name}`}
              className="h-full w-full rounded-[inherit] object-contain"
            />
            <CardFoilOverlay
              enabled={!hidden}
              foil={!hidden && !!card.foil}
              cosmetics={hidden ? undefined : card.cosmetics}
              etched={!hidden && isEtchedOnlyPrinting(info?.finishes)}
              lighting={lighting}
              pose={pose}
            />
          </div>
        </div>
        <p className="text-ui-meta text-muted-foreground">Selected printing, unchanged scan.</p>
      </section>
      <section
        className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3"
        aria-label="Card Glint generated DOM card"
        data-card-renderer="card-glint"
      >
        <h2 className="font-semibold">Card Glint DOM</h2>
        <div className="flex min-h-[440px] items-center justify-center">
          <div className="w-full" style={{ maxWidth: GAME_CARD_SIZES.preview.width }}>
            <GeneratedCardImage
              card={historicalPrinting ? undefined : card}
              deckCard={deckCard}
              faceIndex={face}
              lighting={lighting}
              pose={pose}
              fallback={
                <ScryfallImg
                  src={imageUrl}
                  alt="Original scan fallback"
                  className="h-full w-full object-contain"
                />
              }
            />
          </div>
        </div>
        <p className="text-ui-body text-muted-foreground">
          Production GeneratedCardImage. Loading and fallback states stay inspectable on the
          element.
        </p>
      </section>
    </div>
  );
}
