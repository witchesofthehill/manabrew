import { createPortal } from "react-dom";
import { Loader2, RotateCw } from "lucide-react";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { CARD_RAIL_WIDTH } from "@/components/game/CardRail";
import { CardRailPreview } from "@/components/game/CardRailPreview";
import { PtBadge } from "@/components/game/PtBadge";
import { GameIcon } from "@/components/game/GameIcon";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { FLASH_CARD_SIZE } from "./game.styles";
import { CARD_BADGES, CARD_BACK_IMAGE_URL } from "./game.constants";
import { isFacelessCard } from "@/lib/gameCard";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { isCreature, isLethalDamage } from "./game.utils";
import { isHorizontalGameCard } from "@/lib/horizontalGameCard";
import { cn } from "@/lib/utils";
import { getSafeAreaInsets } from "@/lib/safeArea";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { DEBUG_KEYWORD_CARD_ID, useGameDevStore } from "@/stores/useGameDevStore";
import { asDeckCard } from "@/lib/decks";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useCardFaces } from "@/hooks/useCardFaces";
import { useKeybindings } from "@/hooks/useKeybindings";
import type { CardRailState } from "@/components/game/cardRailState";
import { deriveCardRailEffects, deriveCardRailState } from "@/components/game/cardRailState";

interface CardPreviewProps {
  card: CardDto;
  mouseX: number;
  mouseY: number;
  anchorRect?: DOMRect | null;
  placement?: "auto" | "top-center" | "pinned";
  showBackFace?: boolean;
  actions?: HandActionOption[];
  onSelectAction?: (action: HandActionOption) => void;
  onDismiss?: () => void;
  onFlip?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isSticky?: boolean;
  slot?: HTMLElement | null;
  imageSize?: "normal" | "large";
}

const { w: CARD_W, h: CARD_H } = FLASH_CARD_SIZE;
const ACTIONS_PANEL_W = 220;
const MAX_PREVIEW_KEYWORDS = 8;

interface IndexedPreviewAction {
  action: HandActionOption;
  index: number;
  shortcut: number;
}

function getPreviewActionShortcut(
  index: number,
  classLevelUpIndex: number | null,
  classLevel: number | null,
): number {
  if (classLevel !== null && index === classLevelUpIndex) return classLevel;
  const actionPosition =
    index - (classLevelUpIndex !== null && classLevelUpIndex < index ? 1 : 0) + 1;
  return classLevel !== null && actionPosition >= classLevel ? actionPosition + 1 : actionPosition;
}

function PreviewActions({
  actions,
  onSelect,
  ringColor,
  showHelp,
  hasFlippableFaces,
}: {
  actions: IndexedPreviewAction[];
  onSelect: (action: HandActionOption) => void;
  ringColor: string;
  showHelp: boolean;
  hasFlippableFaces: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        {actions.map(({ action, index, shortcut }) => (
          <button
            key={index}
            onClick={() => onSelect(action)}
            className={cn(
              "group flex w-full flex-col rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-medium text-popover-foreground shadow-lg backdrop-blur-md",
              "transition-all duration-150 ease-out",
              "hover:scale-[1.02] hover:-translate-y-px hover:shadow-xl",
            )}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = ringColor;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.backgroundColor = "";
              event.currentTarget.style.borderColor = "";
            }}
          >
            <span className="mb-0.5 flex w-full items-center justify-between">
              <span className="flex h-5 min-w-[22px] items-center justify-center rounded border border-border bg-muted text-xs font-bold shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                {shortcut}
              </span>
              {action.cost && (
                <span className="flex items-center gap-0.5 text-[11px] opacity-90">
                  <DynamicTextRender text={action.cost} />
                </span>
              )}
            </span>
            <span className="text-[13px] font-semibold leading-snug">
              <DynamicTextRender text={action.label} />
            </span>
          </button>
        ))}
      </div>
      {showHelp && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">1</kbd>
            -
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">9</kbd>{" "}
            select
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
              Esc
            </kbd>{" "}
            close
          </span>
          {hasFlippableFaces && (
            <span>
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                F
              </kbd>{" "}
              flip
            </span>
          )}
        </div>
      )}
    </>
  );
}

function CardDetailOverlay({
  card,
  horizontal,
  rail,
  compactRail,
}: {
  card: CardDto;
  horizontal: boolean;
  rail: CardRailState | null;
  compactRail: boolean;
}) {
  const themeColors = useTheme().gameTheme;
  const creature = isCreature(card);
  const lethal = isLethalDamage(card);

  const statusBadges = useMemo(() => {
    const out: { key: string; label: string; style: string }[] = [];
    if (card.exerted) out.push({ key: "exerted", ...CARD_BADGES.exerted });
    if (card.isFaceDown) out.push({ key: "morph", ...CARD_BADGES.morph });
    if (card.isBestowed) out.push({ key: "bestow", ...CARD_BADGES.bestow });
    if (card.isTransformed) out.push({ key: "transformed", ...CARD_BADGES.transformed });
    if (card.isPlotted) out.push({ key: "plotted", ...CARD_BADGES.plotted });
    if (card.isMadnessExiled) out.push({ key: "madness", ...CARD_BADGES.madnessExiled });
    if (card.isWarpExiled) out.push({ key: "warped", ...CARD_BADGES.warpExiled });
    if (card.isCopy) out.push({ key: "copy", ...CARD_BADGES.copy });
    if (card.identity.isToken) out.push({ key: "token", ...CARD_BADGES.token });
    return out;
  }, [
    card.exerted,
    card.isFaceDown,
    card.isBestowed,
    card.isTransformed,
    card.isPlotted,
    card.isMadnessExiled,
    card.isWarpExiled,
    card.isCopy,
    card.identity.isToken,
  ]);

  const keywords = card.keywords ?? [];
  const visibleKeywords = keywords.slice(0, MAX_PREVIEW_KEYWORDS);
  const hiddenKeywordCount = keywords.length - visibleKeywords.length;

  const damage = card.damage ?? 0;

  const ptState = useMemo(() => {
    if (lethal) return "lethal" as const;
    if (card.basePower == null || card.power == null) return "unknown" as const;
    const curP = parseInt(card.power, 10);
    const curT = parseInt(card.toughness ?? "0", 10);
    if (curP > card.basePower || curT > (card.baseToughness ?? 0)) return "buffed" as const;
    if (curP < card.basePower || curT < (card.baseToughness ?? 0)) return "debuffed" as const;
    return "neutral" as const;
  }, [lethal, card.basePower, card.baseToughness, card.power, card.toughness]);

  const ptStyle: CSSProperties = {
    color: themeColors.textOnTinted,
    backgroundColor:
      ptState === "lethal"
        ? themeColors.pt.lethal
        : ptState === "buffed"
          ? themeColors.pt.buffed
          : ptState === "debuffed"
            ? themeColors.pt.debuffed
            : themeColors.pt.neutral,
  };
  const ptToughness = parseInt(card.toughness ?? "0", 10);
  if (ptState !== "lethal" && damage > 0 && ptToughness > 0) {
    const tint = withAlpha(themeColors.pt.lethal, Math.min(0.85, damage / ptToughness));
    ptStyle.backgroundImage = `linear-gradient(${tint}, ${tint})`;
  }

  const isPlaneswalker = card.types?.some((t) => t.toLowerCase() === "planeswalker") ?? false;
  const loyalty = card.counters?.Loyalty;
  const showLoyalty = isPlaneswalker && loyalty != null && !horizontal;
  const railRightClass = compactRail
    ? "!right-[calc(5.5cqw+var(--card-rail-width)+0.35rem)]"
    : undefined;
  const railRightStyle = compactRail ? "calc(5.5% + var(--card-rail-width) + 0.35rem)" : "5.5%";
  const showTopStrip = statusBadges.length > 0 || keywords.length > 0;
  const showPT = creature && !horizontal && !!card.power && !!card.toughness;

  const overlayCounters = useMemo(() => {
    if (!card.counters) return null;
    const entries = Object.entries(card.counters).filter(
      ([type, n]) =>
        n > 0 &&
        !(showLoyalty && type === "Loyalty") &&
        !(rail?.kind === "saga" && type === "Lore"),
    );
    return entries.length ? Object.fromEntries(entries) : null;
  }, [card.counters, showLoyalty, rail]);

  return (
    <>
      {damage > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: withAlpha(
              themeColors.pt.lethal,
              Math.min(0.5, (ptToughness > 0 ? damage / ptToughness : 1) * 0.5),
            ),
          }}
        />
      )}
      {showTopStrip && (
        <div className="absolute top-2 left-2 right-2 z-10 flex flex-col items-center gap-1 pointer-events-none">
          {statusBadges.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {statusBadges.map((b) => (
                <span
                  key={b.key}
                  className={cn(
                    "text-[11px] font-bold px-2 py-0.5 rounded shadow-md uppercase tracking-wide",
                    b.style,
                  )}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {visibleKeywords.map((kw, i) => {
                const colonIdx = kw.indexOf(":");
                const label = colonIdx === -1 ? kw : kw.slice(0, colonIdx);
                const cost = colonIdx === -1 ? null : kw.slice(colonIdx + 1);
                return (
                  <span
                    key={`${kw}-${i}`}
                    className="inline-flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wide bg-black/75 text-white px-2 py-0.5 rounded shadow-md"
                  >
                    {label}
                    {cost && <ManaSymbols cost={cost} size="sm" />}
                  </span>
                );
              })}
              {hiddenKeywordCount > 0 && (
                <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wide bg-black/75 text-white px-2 py-0.5 rounded shadow-md">
                  +{hiddenKeywordCount}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showPT && (
        <PtBadge
          value={`${card.power}/${card.toughness}`}
          style={ptStyle}
          className={railRightClass}
          baseValue={
            (ptState === "buffed" || ptState === "debuffed") &&
            card.basePower != null &&
            card.baseToughness != null
              ? `${card.basePower}/${card.baseToughness}`
              : null
          }
        />
      )}

      {showLoyalty && (
        <div
          className="absolute bottom-[5.5%] z-10 pointer-events-none"
          style={{ right: railRightStyle }}
        >
          <span
            className="text-lg font-bold px-3 py-1 rounded-md shadow-md leading-none"
            style={{
              backgroundColor: themeColors.counter.loyalty,
              color: themeColors.textOnTinted,
            }}
          >
            {loyalty}
          </span>
        </div>
      )}

      {overlayCounters && (
        <div
          className={cn(
            "absolute bottom-1 left-1 z-10 max-w-[70%]",
            "flex flex-wrap gap-0.5 pointer-events-none",
            compactRail
              ? "pr-[calc(3rem+var(--card-rail-width)+0.35rem)]"
              : showPT || showLoyalty
                ? "pr-12"
                : "right-1",
          )}
        >
          <CounterDisplay counters={overlayCounters} size="md" />
        </div>
      )}

      {card.isRingBearer && (
        <div
          className="absolute top-2 left-2 z-10 flex h-9 w-9 items-center justify-center rounded-full shadow-lg ring-2 pointer-events-none"
          style={{
            backgroundColor: themeColors.badges.ring,
            color: themeColors.textOnTinted,
            // @ts-expect-error CSS var
            "--tw-ring-color": themeColors.badges.ring,
          }}
          title="Ring-bearer"
        >
          <GameIcon name="ring" className="h-6 w-6" />
        </div>
      )}
    </>
  );
}

export function CardPreview({
  card,
  mouseX,
  mouseY,
  anchorRect,
  placement = "auto",
  showBackFace = false,
  actions,
  onSelectAction,
  onDismiss,
  onFlip,
  onMouseEnter,
  onMouseLeave,
  isSticky = false,
  slot,
  imageSize = "large",
}: CardPreviewProps) {
  const hasActions = Boolean(actions?.length && onSelectAction);
  const themeColors = useTheme().gameTheme;
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);
  const ringColor = themeColors.cardRing;
  const rail = deriveCardRailState(card);
  const nextClassLevel =
    rail?.kind === "class" && rail.current < rail.max ? rail.current + 1 : null;
  const availableActions = hasActions ? (actions ?? []) : [];
  const classLevelUpIndex = nextClassLevel
    ? availableActions.findIndex((action) => action.isClassLevelUp)
    : -1;
  const integratedClassLevelUpIndex = classLevelUpIndex >= 0 ? classLevelUpIndex : null;
  const indexedActions = availableActions.map((action, index) => ({
    action,
    index,
    shortcut: getPreviewActionShortcut(
      index,
      integratedClassLevelUpIndex,
      integratedClassLevelUpIndex === null ? null : nextClassLevel,
    ),
  }));
  const classLevelUpActions = indexedActions.filter(({ action }) => action.isClassLevelUp);
  const railClassLevelUpAction =
    integratedClassLevelUpIndex === null ? undefined : indexedActions[integratedClassLevelUpIndex];
  const rightActions = railClassLevelUpAction
    ? classLevelUpActions.filter(({ index }) => index !== railClassLevelUpAction.index)
    : classLevelUpActions;
  const leftActions = indexedActions.filter(({ action }) => !action.isClassLevelUp);
  const railInteractions =
    nextClassLevel && railClassLevelUpAction
      ? [
          {
            position: nextClassLevel,
            shortcut: railClassLevelUpAction.shortcut,
            label: railClassLevelUpAction.action.label,
            onActivate: () => onSelectAction!(railClassLevelUpAction.action),
          },
        ]
      : [];
  const hasRightPanel = Boolean(rail || rightActions.length);
  const hasLeftPanel = leftActions.length > 0;
  const showSidePanel = hasLeftPanel || hasRightPanel;
  const deck = useGameStore((s) => s.gameDecks[card.ownerId]);
  const isDebugCard = card.id === DEBUG_KEYWORD_CARD_ID;
  const deckCard: DeckCard = isDebugCard
    ? ({
        identity: { id: "", name: card.identity.name, setCode: "", cardNumber: "" },
        uris: {},
      } as DeckCard)
    : asDeckCard(deck, card);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const { setCode, cardNumber } = deckCard.identity;
  const cardFaces = useCardFaces(
    isDebugCard
      ? { name: card.identity.name }
      : {
          name: card.identity.name,
          setCode: setCode || undefined,
          cardNumber: cardNumber || undefined,
        },
  );
  const front = cardFaces.faces[0];
  const back = cardFaces.faces[1];
  const railEffects = rail ? deriveCardRailEffects(card, rail) : [];
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const [leftPanelHeight, setLeftPanelHeight] = useState(0);
  const [rightPanelHeight, setRightPanelHeight] = useState(0);
  const [, setLayoutVersion] = useState(0);

  useLayoutEffect(() => {
    const update = () => setLayoutVersion((version) => version + 1);
    const observer = new ResizeObserver(update);
    if (slot) observer.observe(slot);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [slot]);

  useLayoutEffect(() => {
    const measure = () => {
      setLeftPanelHeight(leftPanelRef.current?.offsetHeight ?? 0);
      setRightPanelHeight(rightPanelRef.current?.offsetHeight ?? 0);
    };
    const observer = new ResizeObserver(measure);
    if (leftPanelRef.current) observer.observe(leftPanelRef.current);
    if (rightPanelRef.current) observer.observe(rightPanelRef.current);
    const frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [hasLeftPanel, hasRightPanel, card.id]);

  const faceless = isFacelessCard(card);
  const imageUrl = faceless
    ? CARD_BACK_IMAGE_URL
    : deckCard.uris[imageSize] || front?.imageUris?.[imageSize];
  const hasFlippableFaces =
    cardFaces.isFlippable && !!front?.imageUris?.[imageSize] && !!back?.imageUris?.[imageSize];
  const doubleFacedData = hasFlippableFaces
    ? {
        frontImageUrl: front!.imageUris![imageSize],
        backImageUrl: back!.imageUris![imageSize],
        frontImageUrlLow: front!.imageUris!.normal,
        backImageUrlLow: back!.imageUris!.normal,
        frontName: front!.name,
        backName: back!.name,
      }
    : null;

  const horizontalCard = isDebugCard
    ? false
    : isHorizontalGameCard(card, deckCard.layout, showBackFace ? 1 : 0);
  const fallbackCounters =
    rail?.kind === "saga" && card.counters
      ? Object.fromEntries(
          Object.entries(card.counters).filter(([type, count]) => count > 0 && type !== "Lore"),
        )
      : card.counters;
  const [orientationFlipped, setOrientationFlipped] = useState(false);
  const [prevCardId, setPrevCardId] = useState(card.id);
  if (prevCardId !== card.id) {
    setPrevCardId(card.id);
    setOrientationFlipped(false);
  }

  useKeybindings({
    "flip-card": () => {
      if (horizontalCard) setOrientationFlipped((prev) => !prev);
      else if (onFlip && hasFlippableFaces) onFlip();
    },
  });

  useEffect(() => {
    if (!onDismiss) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onDismiss!();
        return;
      }
      if (!hasActions) return;
      const num = parseInt(e.key);
      const action = actions?.find(
        (_, index) =>
          getPreviewActionShortcut(
            index,
            integratedClassLevelUpIndex,
            integratedClassLevelUpIndex === null ? null : nextClassLevel,
          ) === num,
      );
      if (num >= 1 && num <= 9 && action) {
        e.preventDefault();
        onSelectAction!(action);
      }
    }
    function handleClick(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-card-preview]")) {
        onDismiss!();
      }
    }
    window.addEventListener("keydown", handleKey);
    const timer = setTimeout(() => {
      if (isSticky) {
        window.addEventListener("pointerdown", handleClick);
      }
    }, 100);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handleClick);
    };
  }, [
    hasActions,
    isSticky,
    onDismiss,
    onSelectAction,
    actions,
    integratedClassLevelUpIndex,
    nextClassLevel,
  ]);

  const horizontal = horizontalCard && !orientationFlipped;
  const safe = getSafeAreaInsets();
  const viewLeft = safe.left;
  const viewRight = window.innerWidth - safe.right;
  const viewTop = safe.top;
  const viewBottom = window.innerHeight - safe.bottom;
  const naturalCardWidth = horizontal ? CARD_H : CARD_W;
  const naturalCardHeight = horizontal ? CARD_W : CARD_H;
  const usableWidth = slot ? slot.clientWidth : viewRight - viewLeft;
  const panelCount = Number(hasLeftPanel) + Number(hasRightPanel);
  const maxPanelWidth =
    panelCount > 0 ? (usableWidth - naturalCardWidth * 0.1 - panelCount * 10 - 16) / panelCount : 0;
  const sidePanelWidth = showSidePanel
    ? Math.max(48, Math.min(ACTIONS_PANEL_W, usableWidth * 0.4, maxPanelWidth))
    : 0;
  const leftPanelSpace = hasLeftPanel ? sidePanelWidth + 10 : 0;
  const rightPanelSpace = hasRightPanel ? sidePanelWidth + 10 : 0;
  const horizontalScale = Math.max(
    0.1,
    (usableWidth - leftPanelSpace - rightPanelSpace - 16) / naturalCardWidth,
  );
  const availableHeight = Math.max(1, slot ? slot.clientHeight - 8 : viewBottom - viewTop - 16);
  const verticalScale = availableHeight / naturalCardHeight;
  const previewScale = Math.min(1, horizontalScale, verticalScale);
  const cardWidth = naturalCardWidth * previewScale;
  const cardHeight = naturalCardHeight * previewScale;
  const effectiveLeftPanelHeight = hasLeftPanel ? leftPanelHeight : 0;
  const effectiveRightPanelHeight = hasRightPanel ? rightPanelHeight : 0;
  const leftPanelScale =
    effectiveLeftPanelHeight > 0 ? Math.min(1, availableHeight / effectiveLeftPanelHeight) : 1;
  const rightPanelScale =
    effectiveRightPanelHeight > 0 ? Math.min(1, availableHeight / effectiveRightPanelHeight) : 1;
  const previewHeight = Math.max(
    cardHeight,
    effectiveLeftPanelHeight * leftPanelScale,
    effectiveRightPanelHeight * rightPanelScale,
  );
  const totalWidth = leftPanelSpace + cardWidth + rightPanelSpace;

  let cardLeft: number;
  let top: number;

  if (placement === "pinned") {
    cardLeft = viewRight - cardWidth - rightPanelSpace - 16;
    top = viewTop + 80;
  } else if (placement === "top-center" && anchorRect) {
    cardLeft = anchorRect.left + anchorRect.width / 2 - cardWidth / 2;
    top = anchorRect.top - cardHeight - 12;
    cardLeft = Math.max(
      viewLeft + leftPanelSpace + 8,
      Math.min(cardLeft, viewRight - cardWidth - rightPanelSpace - 8),
    );
    top = Math.max(viewTop + 8, top);
  } else {
    const anchorLeft = anchorRect ? anchorRect.left : mouseX;
    const anchorRight = anchorRect ? anchorRect.right : mouseX;
    const anchorTop = anchorRect ? anchorRect.top : mouseY;
    const anchorBottom = anchorRect ? anchorRect.bottom : mouseY;
    const anchorMidY = anchorRect ? anchorRect.top + anchorRect.height / 2 : mouseY;

    const fitsRight = anchorRight + 16 + totalWidth <= viewRight - 8;
    const fitsLeft = anchorLeft - 16 - totalWidth >= viewLeft + 8;

    if (fitsRight) {
      cardLeft = anchorRight + 16 + leftPanelSpace;
    } else if (fitsLeft) {
      cardLeft = anchorLeft - cardWidth - rightPanelSpace - 16;
    } else {
      cardLeft = Math.max(
        viewLeft + leftPanelSpace + 8,
        Math.min(
          (anchorLeft + anchorRight) / 2 - totalWidth / 2 + leftPanelSpace,
          viewRight - cardWidth - rightPanelSpace - 8,
        ),
      );
    }

    if (fitsRight || fitsLeft) {
      top = Math.min(
        Math.max(anchorMidY - cardHeight / 2, viewTop + 8),
        viewBottom - cardHeight - 8,
      );
    } else {
      const spaceAbove = anchorTop - 16;
      const spaceBelow = viewBottom - anchorBottom - 16;
      top =
        spaceBelow >= spaceAbove
          ? Math.min(anchorBottom + 12, viewBottom - cardHeight - 8)
          : Math.max(viewTop + 8, anchorTop - cardHeight - 12);
    }
  }

  cardLeft = Math.max(
    viewLeft + leftPanelSpace + 8,
    Math.min(cardLeft, viewRight - cardWidth - rightPanelSpace - 8),
  );
  top = Math.max(viewTop + 8, Math.min(top, viewBottom - previewHeight - 8));

  const hasDoubleFace = !!doubleFacedData;
  const currentImageUrl = hasDoubleFace && showBackFace ? doubleFacedData.backImageUrl : imageUrl;
  const currentCardName =
    hasDoubleFace && showBackFace ? doubleFacedData.backName : card.identity.name;
  const currentLowResUrl =
    imageSize !== "large"
      ? null
      : hasDoubleFace
        ? showBackFace
          ? doubleFacedData.backImageUrlLow
          : doubleFacedData.frontImageUrlLow
        : deckCard.uris.normal;
  const imgLoaded = loadedSrc === currentImageUrl;

  return createPortal(
    <>
      {hasActions && isSticky && (
        <div
          className="fixed inset-0 z-[9998] bg-black/30 animate-in fade-in duration-150"
          onClick={onDismiss}
        />
      )}
      <div
        data-card-preview
        className={cn(
          "select-none transition-opacity",
          slot
            ? "relative w-full h-full flex items-start justify-start pointer-events-none"
            : cn(
                "fixed z-[9999]",
                showSidePanel && placement !== "pinned"
                  ? "pointer-events-auto"
                  : "pointer-events-none",
              ),
        )}
        style={slot ? undefined : { left: cardLeft, top }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div
          className="relative @container"
          style={
            {
              ["--card-rail-width" as string]: CARD_RAIL_WIDTH,
              width: cardWidth,
              height: cardHeight,
              marginLeft: slot
                ? Math.max(leftPanelSpace, (slot.clientWidth - totalWidth) / 2 + leftPanelSpace)
                : undefined,
            } as CSSProperties
          }
        >
          <div
            className={cn(
              "w-full h-full rounded-xl shadow-2xl overflow-hidden bg-black transition-shadow duration-200 relative",
              hasActions ? "ring-2" : "ring-1 ring-black/20",
              card.foil && "draft-tile-foil",
            )}
            style={
              hasActions
                ? ({
                    "--tw-ring-color": ringColor,
                    boxShadow: `0 0 20px ${ringColor}`,
                  } as CSSProperties)
                : undefined
            }
          >
            {currentImageUrl ? (
              <>
                {currentLowResUrl &&
                  !imgLoaded &&
                  (horizontal ? (
                    <ScryfallImg
                      src={currentLowResUrl}
                      alt=""
                      title=""
                      aria-hidden
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7]"
                    />
                  ) : (
                    <ScryfallImg
                      src={currentLowResUrl}
                      alt=""
                      title=""
                      aria-hidden
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ))}
                {horizontal ? (
                  <ScryfallImg
                    src={currentImageUrl}
                    alt={currentCardName}
                    title=""
                    onLoad={() => setLoadedSrc(currentImageUrl)}
                    className={cn(
                      "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7] transition-opacity duration-200",
                      imgLoaded ? "opacity-100" : "opacity-0",
                    )}
                  />
                ) : (
                  <ScryfallImg
                    src={currentImageUrl}
                    alt={currentCardName}
                    title=""
                    onLoad={() => setLoadedSrc(currentImageUrl)}
                    className={cn(
                      "w-full h-full object-cover transition-opacity duration-200",
                      imgLoaded ? "opacity-100" : "opacity-0",
                    )}
                  />
                )}
                {!imgLoaded && !currentLowResUrl && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 bg-black">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground text-center">
                      {currentCardName}
                    </span>
                  </div>
                )}
                <CardDetailOverlay
                  card={card}
                  horizontal={horizontal}
                  rail={rail}
                  compactRail={false}
                />
                {showHoverAreas && (
                  <div
                    className="pointer-events-none absolute inset-0 z-30"
                    style={{ backgroundColor: withAlpha(themeColors.success, 0.28) }}
                  />
                )}
                {hasDoubleFace && onFlip && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFlip();
                    }}
                    className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/65 hover:bg-black/85 text-white text-[10px] font-semibold uppercase tracking-wide px-2 py-1 pointer-coarse:px-3 pointer-coarse:py-2 shadow pointer-events-auto"
                    title={`Flip card (F) — ${showBackFace ? doubleFacedData.frontName : doubleFacedData.backName}`}
                  >
                    <RotateCw className="h-3 w-3" />
                    {showBackFace ? "Front" : "Back"}
                  </button>
                )}
                {horizontalCard && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOrientationFlipped((prev) => !prev);
                    }}
                    className="absolute top-2 left-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/65 hover:bg-black/85 text-white text-[10px] font-semibold uppercase tracking-wide px-2 py-1 pointer-coarse:px-3 pointer-coarse:py-2 shadow pointer-events-auto"
                    title="Rotate the card to read it (F)"
                  >
                    <RotateCw className="h-3 w-3" />
                    {orientationFlipped ? "Read" : "Rotate"}
                  </button>
                )}
              </>
            ) : (
              <div className="w-full h-full p-4 bg-card">
                <div className="flex h-full min-w-0 flex-col gap-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-bold text-sm leading-tight">{currentCardName}</span>
                    {!hasDoubleFace &&
                      (card.effectiveManaCost ? (
                        <div className="flex flex-col items-end">
                          <span className="line-through opacity-50">
                            <ManaSymbols cost={card.manaCost} size="md" />
                          </span>
                          <span
                            className="rounded border px-0.5"
                            style={{ borderColor: ringColor }}
                          >
                            <ManaSymbols cost={card.effectiveManaCost} size="md" />
                          </span>
                        </div>
                      ) : (
                        <ManaSymbols cost={card.manaCost} size="md" />
                      ))}
                  </div>
                  {!hasDoubleFace && (
                    <div className="text-xs text-muted-foreground">{card.types?.join(" ")}</div>
                  )}
                  <div className="flex-1 text-xs text-foreground/80 whitespace-pre-wrap">
                    {hasDoubleFace && showBackFace
                      ? `Back face: ${doubleFacedData!.backName}`
                      : hasDoubleFace && !showBackFace
                        ? `Front face: ${doubleFacedData!.frontName}`
                        : card.text}
                  </div>
                  {fallbackCounters && <CounterDisplay counters={fallbackCounters} size="md" />}
                  {card.power && card.toughness && (
                    <div className="text-right font-bold text-sm">
                      {card.power}/{card.toughness}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {hasLeftPanel && (
            <div
              ref={leftPanelRef}
              className="absolute top-0 flex flex-col gap-1.5"
              style={{
                right: cardWidth + 10,
                width: sidePanelWidth,
                transform: `scale(${leftPanelScale})`,
                transformOrigin: "top right",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  right: -10 - cardWidth,
                  width: cardWidth + 10 + sidePanelWidth,
                  height: cardHeight,
                  backgroundColor: showHoverAreas
                    ? withAlpha(themeColors.success, 0.28)
                    : "transparent",
                  borderBottomRightRadius: "0",
                  borderBottomLeftRadius: "100%",
                  zIndex: -1,
                }}
              />
              <PreviewActions
                actions={leftActions}
                onSelect={onSelectAction!}
                ringColor={ringColor}
                showHelp
                hasFlippableFaces={hasFlippableFaces}
              />
            </div>
          )}

          {hasRightPanel && (
            <div
              ref={rightPanelRef}
              className="absolute top-0 flex flex-col gap-1.5"
              style={{
                left: cardWidth + 10,
                width: sidePanelWidth,
                transform: `scale(${rightPanelScale})`,
                transformOrigin: "top left",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: -10 - cardWidth,
                  width: cardWidth + 10 + sidePanelWidth,
                  height: cardHeight,
                  backgroundColor: showHoverAreas
                    ? withAlpha(themeColors.success, 0.28)
                    : "transparent",
                  borderBottomRightRadius: "100%",
                  borderBottomLeftRadius: "0",
                  zIndex: -1,
                }}
              />
              {rail && (
                <CardRailPreview
                  state={rail}
                  effects={railEffects}
                  interactions={railInteractions}
                />
              )}
              {rightActions.length > 0 && (
                <PreviewActions
                  actions={rightActions}
                  onSelect={onSelectAction!}
                  ringColor={ringColor}
                  showHelp={!hasLeftPanel}
                  hasFlippableFaces={hasFlippableFaces}
                />
              )}
              {!hasActions && hasFlippableFaces && (
                <div className="px-1 text-[10px] text-muted-foreground">
                  <span>
                    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                      F
                    </kbd>{" "}
                    flip
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    slot ?? document.body,
  );
}
