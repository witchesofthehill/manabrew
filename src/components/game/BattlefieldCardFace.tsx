import type { GameCard } from "@/types/manabrew";
import type { ManaLetter } from "@/themes/gameTheme";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { frameTint, readableTextColor, withAlpha } from "@/themes/gameTheme";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { isCreature, isLethalDamage } from "@/components/game/game.utils";
import { battlefieldKeywords } from "@/lib/battlefieldKeywords";

export type BattlefieldCardFaceVariant = "frame" | "art";

interface BattlefieldCardFaceProps {
  card: GameCard;
  artCrop?: string;
  variant: BattlefieldCardFaceVariant;
  /** Tile width in px; height derives from the 5:7 ratio. */
  width?: number;
}

const WUBRG: ManaLetter[] = ["W", "U", "B", "R", "G"];

function cardColors(card: GameCard): ManaLetter[] {
  const ids = (card.colorIdentity ?? []).filter((c): c is ManaLetter =>
    WUBRG.includes(c as ManaLetter),
  );
  return ids;
}

export function BattlefieldCardFace({
  card,
  artCrop,
  variant,
  width = 70,
}: BattlefieldCardFaceProps) {
  const theme = useTheme().gameTheme;
  const u = width / 70;
  const height = width * (98 / 70);

  const colors = cardColors(card);
  const rawTint = colors.length === 0 ? theme.mana.C : theme.mana[colors[0]];
  const rawTintB = colors.length > 1 ? theme.mana[colors[1]] : rawTint;
  const tint = frameTint(rawTint);
  const tintB = frameTint(rawTintB);
  const barText = readableTextColor(tint, theme.canvas.shadow, theme.textOnTinted);
  const barBg =
    colors.length > 1
      ? `linear-gradient(105deg, ${tint} 0%, ${tint} 42%, ${tintB} 58%, ${tintB} 100%)`
      : tint;

  const creature = isCreature(card);
  const lethal = isLethalDamage(card);
  const pt = creature && card.power != null && card.toughness != null;
  const loyalty = card.counters?.Loyalty;

  const ptStyle = lethal
    ? { backgroundColor: theme.pt.lethal, color: theme.textOnTinted }
    : card.basePower != null && card.power != null && parseInt(card.power, 10) > card.basePower
      ? { backgroundColor: theme.pt.buffed, color: theme.textOnTinted }
      : { backgroundColor: withAlpha(theme.pt.neutral, 0.85), color: theme.textOnTinted };

  const fontName = Math.max(5, 7 * u);
  const fontType = Math.max(4, 5.5 * u);
  const fontPt = Math.max(7, 9 * u);
  const radius = 5 * u;
  const pad = 3 * u;
  // Bottom inset that clears the mini-frame's type bar (font + its vertical
  // padding) so bottom-anchored overlays don't sit on the type line.
  const typeBarH = fontType + 3 * u;
  const bottomOverlayInset = variant === "frame" ? typeBarH + 2 * u : pad;

  const typeLine =
    [...card.supertypes, ...card.types].join(" ") +
    (card.subtypes.length > 0 ? ` - ${card.subtypes.join(" ")}` : "");
  const { shown: keywords, hidden: hiddenKeywords } = battlefieldKeywords(card.keywords);

  const Overlays = (
    <>
      {keywords.length > 0 && (
        <div
          className="absolute z-10 flex flex-col items-start"
          style={{ left: pad, top: "30%", gap: 1 * u }}
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
      {card.summoningSick && creature && (
        <div
          className="absolute inset-0 rounded-[inherit] pointer-events-none"
          style={{
            outline: `${Math.max(1, 1.5 * u)}px dashed ${theme.promptAction.cancel}`,
            outlineOffset: -2 * u,
          }}
        />
      )}
      {card.isAttacking && (
        <div
          className="absolute inset-0 rounded-[inherit] pointer-events-none"
          style={{ boxShadow: `inset 0 0 ${6 * u}px ${withAlpha(theme.pt.lethal, 0.9)}` }}
        />
      )}
      {card.damage != null && card.damage > 0 && (
        <span
          className="absolute font-bold rounded leading-none z-10"
          style={{
            left: pad,
            top: pad,
            fontSize: Math.max(6, 8 * u),
            padding: `${1 * u}px ${2.5 * u}px`,
            color: theme.textOnTinted,
            backgroundColor: withAlpha(theme.pt.lethal, 0.85),
          }}
        >
          ⚔{card.damage}
        </span>
      )}
      {card.counters && (
        <div className="absolute z-10" style={{ left: pad, bottom: bottomOverlayInset }}>
          <CounterDisplay
            counters={Object.fromEntries(
              Object.entries(card.counters).filter(([k]) => k !== "Loyalty"),
            )}
            size="sm"
          />
        </div>
      )}
    </>
  );

  if (variant === "art") {
    return (
      <div
        className={cn(
          "relative overflow-hidden shadow-sm",
          card.tapped && "rotate-90",
          card.phasedOut && "opacity-30 grayscale",
        )}
        style={{
          width,
          height,
          borderRadius: radius,
          border: `${Math.max(1, 1.5 * u)}px solid ${tint}`,
          background: theme.cardPlaceholder.fill,
        }}
      >
        {artCrop && (
          <img
            src={artCrop}
            alt={card.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div
          className="absolute top-0 right-0 flex items-center"
          style={{ transform: `scale(${0.6 * u})`, transformOrigin: "top right", padding: pad }}
        >
          <ManaSymbols cost={card.manaCost} size="sm" />
        </div>
        <div
          className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1"
          style={{
            padding: pad,
            paddingTop: 10 * u,
            background: `linear-gradient(to top, ${withAlpha(theme.canvas.shadow, 0.94)} 0%, ${withAlpha(theme.canvas.shadow, 0.6)} 60%, transparent 100%)`,
          }}
        >
          <div className="min-w-0 flex flex-col" style={{ gap: 1 * u }}>
            <span
              className="font-semibold leading-tight break-words"
              style={{ fontSize: fontName, color: theme.textOnTinted }}
            >
              {card.name}
            </span>
            {typeLine && (
              <span
                className="leading-tight break-words"
                style={{ fontSize: fontType, color: withAlpha(theme.textOnTinted, 0.75) }}
              >
                {typeLine}
              </span>
            )}
          </div>
          {pt && (
            <span
              className="font-bold rounded leading-none shrink-0 self-end"
              style={{ ...ptStyle, fontSize: fontPt, padding: `${1.5 * u}px ${3 * u}px` }}
            >
              {card.power}/{card.toughness}
            </span>
          )}
          {loyalty != null && (
            <span
              className="font-bold rounded leading-none shrink-0 self-end"
              style={{
                backgroundColor: theme.counter.loyalty,
                color: theme.textOnTinted,
                fontSize: fontPt,
                padding: `${1.5 * u}px ${3 * u}px`,
              }}
            >
              {loyalty}
            </span>
          )}
        </div>
        {Overlays}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden flex flex-col",
        card.tapped && "rotate-90",
        card.phasedOut && "opacity-30 grayscale",
      )}
      style={{
        width,
        height,
        borderRadius: radius,
        border: `${Math.max(1, 1.5 * u)}px solid ${tint}`,
        background: theme.cardPlaceholder.fill,
        boxShadow: `0 ${1.5 * u}px ${3 * u}px ${withAlpha(theme.canvas.shadow, 0.5)}, inset 0 0 0 ${Math.max(0.5, 0.75 * u)}px ${withAlpha(theme.canvas.shadow, 0.4)}`,
      }}
    >
      <div
        className="flex items-center justify-between gap-1 shrink-0"
        style={{ background: barBg, padding: `${2 * u}px ${pad}px` }}
      >
        <span
          className="font-semibold leading-tight truncate"
          style={{ fontSize: fontName, color: barText }}
        >
          {card.name}
        </span>
        <span
          className="shrink-0 flex items-center"
          style={{ transform: `scale(${Math.min(1, u)})`, transformOrigin: "right center" }}
        >
          <ManaSymbols cost={card.manaCost} size="sm" />
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden" style={{ background: theme.canvas.shadow }}>
        {artCrop && (
          <img
            src={artCrop}
            alt={card.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {pt && (
          <span
            className="absolute font-bold rounded leading-none"
            style={{
              ...ptStyle,
              right: pad,
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
              right: pad,
              bottom: pad,
              fontSize: fontPt,
              padding: `${1.5 * u}px ${3 * u}px`,
            }}
          >
            {loyalty}
          </span>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-1 shrink-0"
        style={{ background: withAlpha(tint, 0.9), padding: `${1.5 * u}px ${pad}px` }}
      >
        <span className="leading-none truncate" style={{ fontSize: fontType, color: barText }}>
          {typeLine}
        </span>
      </div>

      {Overlays}
    </div>
  );
}
