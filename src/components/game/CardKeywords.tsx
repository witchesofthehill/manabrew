import { ManaSymbols } from "@/components/game/ManaSymbols";
import { cn } from "@/lib/utils";

const CHIP_BASE =
  "text-[8px] font-bold uppercase bg-black/60 text-white px-1 py-px rounded leading-none max-w-full truncate";

/**
 * Forge ships some keyword scripts as full prose (e.g. Xenosquirrels'
 * "After you roll a die, you may remove a +1/+1 counter…"). The chip
 * strip is for short keyword names; trim long labels so they can't
 * blow out of the card silhouette.
 */
const KEYWORD_LABEL_MAX_LEN = 14;

function truncateChipLabel(text: string): string {
  if (text.length <= KEYWORD_LABEL_MAX_LEN) return text;
  return `${text.slice(0, KEYWORD_LABEL_MAX_LEN - 1)}…`;
}

export function KeywordChip({ kw }: { kw: string }) {
  const colonIdx = kw.indexOf(":");
  if (colonIdx === -1) {
    return <span className={CHIP_BASE}>{truncateChipLabel(kw)}</span>;
  }
  const label = kw.slice(0, colonIdx);
  const cost = kw.slice(colonIdx + 1);
  return (
    <span className={cn("inline-flex items-center gap-0.5", CHIP_BASE)}>
      {truncateChipLabel(label)}
      <ManaSymbols cost={cost} size="sm" />
    </span>
  );
}

export function KeywordChips({ keywords, className }: { keywords: string[]; className?: string }) {
  if (!keywords || keywords.length === 0) return null;
  const visible = keywords.slice(0, 4);
  const hidden = keywords.length - visible.length;
  // Anchor the chip strip just below the MTG title line (same 13% band
  // the status badges use) so the card name + mana cost stay legible.
  // `overflow-hidden` is the second line of defence against a stray
  // long chip; the per-chip `max-w-full truncate` handles the common case.
  return (
    <div
      className={cn(
        "absolute top-[10%] left-1 right-1 flex flex-wrap gap-0.5 z-10 overflow-hidden",
        className,
      )}
    >
      {visible.map((kw) => (
        <KeywordChip key={kw} kw={kw} />
      ))}
      {hidden > 0 && <span className={CHIP_BASE}>+{hidden}</span>}
    </div>
  );
}
