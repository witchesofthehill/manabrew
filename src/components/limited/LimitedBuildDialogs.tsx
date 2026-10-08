import { LimitedBasicLandsDialog } from "@/components/limited/LimitedBasicLandsDialog";
import { LimitedBuildConfigurations } from "@/components/limited/LimitedBuildConfigurations";
import { LimitedCompareDialog } from "@/components/limited/LimitedCompareDialog";
import { LimitedDraftReview } from "@/components/limited/LimitedDraftReview";
import { LimitedHandTester } from "@/components/limited/LimitedHandTester";
import { LimitedManaDialog } from "@/components/limited/LimitedManaDialog";
import { LimitedSetReference } from "@/components/limited/LimitedSetReference";
import type { LimitedReferenceFormat } from "@/components/limited/LimitedSetReference";
import type { BuildSession } from "@/components/limited/useLimitedBuildStore";
import type { DraftCard } from "@/types/limited";

export type LimitedBuildDialog =
  | "basics"
  | "mana"
  | "builds"
  | "compare"
  | "hand"
  | "reference"
  | "review";

interface LimitedBuildDialogsProps {
  dialog: LimitedBuildDialog | null;
  onClose: () => void;
  sessionKey: string;
  session: BuildSession;
  deck: { main: DraftCard[]; sideboard: DraftCard[] };
  targetMainSize: number;
  reviewSessionId: string;
  referenceFormat?: LimitedReferenceFormat;
}

export function LimitedBuildDialogs({
  dialog,
  onClose,
  sessionKey,
  session,
  deck,
  targetMainSize,
  reviewSessionId,
  referenceFormat,
}: LimitedBuildDialogsProps) {
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  switch (dialog) {
    case "basics":
      return <LimitedBasicLandsDialog sessionKey={sessionKey} onClose={onClose} />;
    case "mana":
      return (
        <LimitedManaDialog
          sessionKey={sessionKey}
          session={session}
          main={deck.main}
          targetMainSize={targetMainSize}
          onClose={onClose}
        />
      );
    case "builds":
      return (
        <LimitedBuildConfigurations sessionKey={sessionKey} session={session} onClose={onClose} />
      );
    case "compare":
      return (
        <LimitedCompareDialog
          sessionKey={sessionKey}
          current={deck.main}
          open
          onOpenChange={onOpenChange}
        />
      );
    case "hand":
      return (
        <LimitedHandTester
          sessionKey={sessionKey}
          session={session}
          deck={deck}
          open
          onOpenChange={onOpenChange}
        />
      );
    case "reference":
      return (
        <LimitedSetReference
          cards={session.pool}
          format={referenceFormat}
          open
          onOpenChange={onOpenChange}
        />
      );
    case "review":
      return <LimitedDraftReview sessionId={reviewSessionId} open onOpenChange={onOpenChange} />;
    case null:
      return null;
  }
}
