import { CircleHelp, Sparkles, Sword } from "lucide-react";
import { attachmentKind, type AttachmentReference } from "@/components/game/attachmentPanel";

const KINDS = [
  { key: "equipment", label: "Equipment", Icon: Sword },
  { key: "aura", label: "Auras", Icon: Sparkles },
  { key: "other", label: "Other / unknown attachments", Icon: CircleHelp },
] as const;

export function AttachmentCounts({ cards }: { cards: readonly AttachmentReference[] }) {
  const counts = { equipment: 0, aura: 0, other: 0 };
  for (const { card } of cards) counts[attachmentKind(card)]++;
  return (
    <span className="inline-flex items-center gap-2 text-ui-meta text-muted-foreground tabular-nums">
      {KINDS.map(({ key, label, Icon }) => (
        <span
          key={key}
          role="img"
          aria-label={`${label}: ${counts[key]}`}
          title={`${label}: ${counts[key]}`}
          className="inline-flex items-center gap-1"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          <span aria-hidden="true">{counts[key]}</span>
        </span>
      ))}
    </span>
  );
}
