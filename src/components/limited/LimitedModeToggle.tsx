import { Button } from "@/components/ui/button";
export type LimitedDraftMode = "drafting" | "building";
interface Props {
  mode: LimitedDraftMode;
  onChange: (m: LimitedDraftMode) => void;
  disableDrafting: boolean;
}
export function LimitedModeToggle({ mode, onChange, disableDrafting }: Props) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-border/70 bg-card/40 p-0.5 text-ui-label">
      <Button
        size="sm"
        variant={mode === "drafting" ? "secondary" : "ghost"}
        onClick={() => onChange("drafting")}
        disabled={disableDrafting}
        className="h-auto min-h-8 px-3 touch:min-h-11"
      >
        Drafting
      </Button>
      <Button
        size="sm"
        variant={mode === "building" ? "secondary" : "ghost"}
        onClick={() => onChange("building")}
        className="h-auto min-h-8 px-3 touch:min-h-11"
      >
        Build Deck
      </Button>
    </div>
  );
}
