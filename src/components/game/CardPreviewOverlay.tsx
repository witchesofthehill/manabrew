import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { CardDto } from "@/protocol/game";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { PtBadge } from "@/components/game/PtBadge";
import { GameIcon } from "@/components/game/GameIcon";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { CardChoiceIndicators } from "@/components/game/CardChoiceIndicators";
import { CardChoiceColorRing } from "@/components/game/CardChoiceColorRing";
import { CARD_BADGES } from "./game.constants";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { isCreature, isLethalDamage } from "./game.utils";
import { cn } from "@/lib/utils";
import type { CardRailState } from "@/components/game/cardRailState";
import { isVisibleBattlefieldKeyword } from "@/lib/battlefieldKeywords";

const MAX_PREVIEW_KEYWORDS = 8;

export function CardPreviewOverlay({
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

  const keywords = (card.keywords ?? []).filter(isVisibleBattlefieldKeyword);
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
  const showTopStrip =
    statusBadges.length > 0 || (card.choices?.length ?? 0) > 0 || keywords.length > 0;
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
      <CardChoiceColorRing card={card} />
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
          <CardChoiceIndicators card={card} expanded />
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
