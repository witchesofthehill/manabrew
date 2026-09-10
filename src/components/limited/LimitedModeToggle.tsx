import { Button } from "@/components/ui/button";
import { Trans } from "@lingui/react/macro";
export type LimitedDraftMode = "drafting" | "building";
interface Props {
  mode: LimitedDraftMode;
  onChange: (m: LimitedDraftMode) => void;
  disableDrafting: boolean;
}
export function LimitedModeToggle({ mode, onChange, disableDrafting }: Props) {
  return (
    <div className="inline-flex rounded-md border border-border/70 bg-card/40 p-0.5 text-xs">
      <Button
        size="sm"
        variant={mode === "drafting" ? "secondary" : "ghost"}
        onClick={() => onChange("drafting")}
        disabled={disableDrafting}
        className="h-7 px-3"
      >
        <Trans>Drafting</Trans>
      </Button>
      <Button
        size="sm"
        variant={mode === "building" ? "secondary" : "ghost"}
        onClick={() => onChange("building")}
        className="h-7 px-3"
      >
        <Trans>Build Deck</Trans>
      </Button>
    </div>
  );
}
