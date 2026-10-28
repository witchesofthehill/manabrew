import type { CardDto } from "@/protocol/game";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { cardFrameTints, withAlpha } from "@/themes/gameTheme";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { ScryfallImg } from "@/components/ScryfallImg";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { CardChoiceIndicators } from "@/components/game/CardChoiceIndicators";
import { CardRail, CARD_RAIL_WIDTH } from "@/components/game/CardRail";
import { deriveCardRailState } from "@/components/game/cardRailState";
import { isCreature, isLethalDamage } from "@/components/game/game.utils";
import { cardTypeLine } from "@/components/game/cardPresentation";
import { battlefieldKeywords } from "@/lib/battlefieldKeywords";
import { CardFoilOverlay } from "@/components/game/CardFoilOverlay";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";
import { gameCardFaceIndex } from "@/lib/gameCard";
import { RoomDoorOverlay } from "@/components/game/RoomDoorOverlay";

export type BattlefieldCardFaceVariant = "frame" | "art";

interface BattlefieldCardFaceProps {
  card: CardDto;
  /** Color identity for the frame tint — `colorIdentity` from the card's deck/Scryfall repr. */
  colorIdentity?: string[];
  artCrop?: string;
  variant: BattlefieldCardFaceVariant;
  width?: number;
}

export function BattlefieldCardFace({
  card,
  colorIdentity,
  artCrop,
  variant,
  width = 70,
}: BattlefieldCardFaceProps) {
  const theme = useTheme().gameTheme;
  const { deckCard, imageUrl, info } = useResolvedGameCard(card);
  if (
    card.isFaceDown ||
    !card.identity.name ||
    ("visibility" in card && card.visibility === "hidden")
  ) {
    return (
      <div style={{ width, height: width * (98 / 70) }}>
        <GeneratedCardImage card={card} className="h-full w-full" />
      </div>
    );
  }
  const room =
    card.subtypes.includes("Room") ||
    deckCard.subtypes?.includes("Room") ||
    info?.layout === "room" ||
    /\bRoom\b/.test(info?.type_line ?? "");
  const artworkUrl = imageUrl(gameCardFaceIndex(card), "art_crop") || artCrop;
  const fallbackUrl = imageUrl(gameCardFaceIndex(card), "normal");
  const artwork = artworkUrl ? (
    <ScryfallImg
      src={artworkUrl}
      alt={card.identity.name}
      className="absolute inset-0 h-full w-full object-cover"
      draggable={false}
    />
  ) : undefined;
  const u = width / 70;
  const faceWidth = room ? width * (98 / 70) : width;
  const height = room ? width : width * (98 / 70);
  const rail = deriveCardRailState(card);

  const { primary: tint } = cardFrameTints(colorIdentity, theme.mana);

  const creature = isCreature(card);
  const summoned = creature && !!card.summoningSick;
  const lethal = isLethalDamage(card);
  const pt = creature && card.power != null && card.toughness != null;
  const loyalty = card.counters?.Loyalty;

  const curP = card.power != null ? parseInt(card.power, 10) : null;
  const curT = card.toughness != null ? parseInt(card.toughness, 10) : null;
  const buffed =
    card.basePower != null &&
    ((curP != null && curP > card.basePower) ||
      (curT != null && card.baseToughness != null && curT > card.baseToughness));
  const debuffed =
    card.basePower != null &&
    ((curP != null && curP < card.basePower) ||
      (curT != null && card.baseToughness != null && curT < card.baseToughness));
  const ptBg = lethal
    ? theme.pt.lethal
    : buffed
      ? theme.pt.buffed
      : debuffed
        ? theme.pt.debuffed
        : withAlpha(theme.pt.neutral, 0.85);
  const ptStyle = { backgroundColor: ptBg, color: theme.textOnTinted };

  const fontPt = Math.max(7, 9 * u);
  const radius = 5 * u;
  const pad = 3 * u;
  const railOffsetRight = rail
    ? `calc(${pad}px + var(--card-rail-width) + ${0.35 * u}px)`
    : `${pad}px`;

  const { shown: keywords, hidden: hiddenKeywords } = battlefieldKeywords(card.keywords);

  // P1P1 / M1M1 are dropped here: the net buff/debuff shows in the P/T color.
  const otherCounters = card.counters
    ? Object.fromEntries(
        Object.entries(card.counters).filter(
          ([k]) =>
            k !== "Loyalty" &&
            k !== "P1P1" &&
            k !== "M1M1" &&
            !(rail?.kind === "saga" && k === "Lore"),
        ),
      )
    : {};
  const counterBadges =
    Object.keys(otherCounters).length > 0 ? (
      <div className="flex items-center" style={{ gap: 1 * u }}>
        <CounterDisplay counters={otherCounters} size="sm" />
      </div>
    ) : null;

  const damage = card.damage ?? 0;
  const toughForDamage = parseInt(card.toughness ?? "0", 10);
  const borderW = Math.max(1, 1.5 * u);
  const damageEffect =
    damage > 0 ? (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius: radius,
          background: withAlpha(
            theme.pt.lethal,
            Math.min(0.5, (toughForDamage > 0 ? damage / toughForDamage : 1) * 0.5),
          ),
        }}
      />
    ) : null;

  const Overlays = (
    <>
      <CardChoiceIndicators
        card={card}
        className="absolute inset-x-1 z-10"
        style={{ top: 18 * u, transform: `scale(${u})`, transformOrigin: "top center" }}
      />
      {keywords.length > 0 && (
        <div
          className="absolute z-10 flex flex-col items-start"
          style={{ left: pad, top: (card.choices?.length ?? 0) > 0 ? "42%" : "30%", gap: 1 * u }}
        >
          {keywords.map((kw) => (
            <span
              key={kw}
              className="font-bold uppercase rounded leading-none max-w-full truncate"
              style={{
                fontSize: Math.max(4, 5.5 * u),
                padding: `${0.5 * u}px ${2 * u}px`,
                color: theme.textOnTinted,
                backgroundColor: withAlpha(theme.canvas.shadow, 0.7),
              }}
            >
              {kw}
            </span>
          ))}
          {hiddenKeywords > 0 && (
            <span
              className="font-bold rounded leading-none"
              style={{
                fontSize: Math.max(4, 5.5 * u),
                padding: `${0.5 * u}px ${2 * u}px`,
                color: theme.textOnTinted,
                backgroundColor: withAlpha(theme.canvas.shadow, 0.7),
              }}
            >
              +{hiddenKeywords}
            </span>
          )}
        </div>
      )}
      {summoned && (
        <div
          className="absolute inset-0 rounded-[inherit] pointer-events-none animate-pulse"
          style={{
            boxShadow: `inset 0 0 0 ${Math.max(1, u)}px ${withAlpha(theme.cardStatus.summoningSick, 0.85)}, inset 0 0 ${10 * u}px ${withAlpha(theme.cardStatus.summoningSick, 0.55)}, inset 0 0 ${5 * u}px ${withAlpha(theme.cardStatus.summoningSick, 0.65)}`,
            background: `radial-gradient(circle at 50% 50%, transparent 55%, ${withAlpha(theme.cardStatus.summoningSick, 0.18)} 100%)`,
          }}
        />
      )}
      {card.isAttacking && (
        <div
          className="absolute inset-0 rounded-[inherit] pointer-events-none"
          style={{ boxShadow: `inset 0 0 ${6 * u}px ${withAlpha(theme.pt.lethal, 0.9)}` }}
        />
      )}
    </>
  );

  return (
    <div
      className={cn(
        "relative @container shadow-sm",
        variant === "art" ? "overflow-hidden" : "overflow-visible",
        card.tapped && "rotate-90",
        card.phasedOut && "opacity-30 grayscale",
        summoned && "opacity-80 grayscale-[0.85]",
      )}
      style={
        {
          ["--card-rail-width" as string]: CARD_RAIL_WIDTH,
          width: faceWidth,
          height,
          borderRadius: radius,
          background: theme.cardPlaceholder.fill,
        } as CSSProperties
      }
    >
      {variant === "art" ? (
        artwork
      ) : (
        <div
          className="absolute rounded-[inherit]"
          style={
            room
              ? {
                  width: height,
                  height: faceWidth,
                  left: (faceWidth - height) / 2,
                  top: (height - faceWidth) / 2,
                  transform: "rotate(90deg)",
                }
              : { inset: 0 }
          }
        >
          <GeneratedCardImage
            card={card}
            className="absolute inset-0 h-full w-full"
            fallback={
              fallbackUrl ? (
                <ScryfallImg
                  src={fallbackUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full rounded-[inherit] object-contain"
                  draggable={false}
                />
              ) : undefined
            }
          />
        </div>
      )}
      <CardFoilOverlay
        enabled={variant === "art"}
        foil={!!card.foil}
        cosmetics={card.cosmetics}
        etched={isEtchedOnlyPrinting(info?.finishes)}
      />
      {variant === "frame" && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ boxShadow: `inset 0 0 0 ${borderW}px ${tint}` }}
        />
      )}
      <RoomDoorOverlay card={card} />
      {variant === "art" && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 leading-tight"
          style={{
            padding: `${2 * u}px ${pad}px`,
            color: theme.textOnTinted,
            backgroundColor: withAlpha(theme.canvas.shadow, 0.78),
          }}
        >
          <div className="truncate font-bold" style={{ fontSize: Math.max(5, 7 * u) }}>
            {card.identity.name}
          </div>
          <div className="truncate" style={{ fontSize: Math.max(4, 5 * u) }}>
            {cardTypeLine(card)}
          </div>
        </div>
      )}
      {damageEffect}
      {counterBadges && (
        <div className="absolute z-10" style={{ left: pad, bottom: pad }}>
          {counterBadges}
        </div>
      )}
      {pt && (
        <span
          className="absolute font-bold rounded leading-none"
          style={{
            ...ptStyle,
            right: railOffsetRight,
            bottom: pad,
            fontSize: fontPt,
            padding: `${1.5 * u}px ${3 * u}px`,
          }}
        >
          {card.power}/{card.toughness}
        </span>
      )}
      {loyalty != null && (
        <span
          className="absolute font-bold rounded leading-none"
          style={{
            backgroundColor: theme.counter.loyalty,
            color: theme.textOnTinted,
            right: railOffsetRight,
            bottom: pad,
            fontSize: fontPt,
            padding: `${1.5 * u}px ${3 * u}px`,
          }}
        >
          {loyalty}
        </span>
      )}
      {Overlays}
      {rail && <CardRail state={rail} />}
    </div>
  );
}
