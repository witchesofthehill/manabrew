import compactLayout from "@/assets/phase-layout/compact.png";
import perPlayerLayout from "@/assets/phase-layout/per-player.png";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

const OPTIONS = [
  { value: "compact", label: "Compact", image: compactLayout },
  { value: "per-player", label: "Per player", image: perPlayerLayout },
] as const;

export function PhaseLayoutChoice() {
  const layout = usePreferencesStore((state) => state.phaseStopLayout);
  const setLayout = usePreferencesStore((state) => state.setPhaseStopLayout);
  return (
    <fieldset className="space-y-2">
      <legend className="text-ui-label font-medium">Phase bar</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={layout === option.value ? "selected" : "outline"}
            aria-pressed={layout === option.value}
            className="h-auto flex-col gap-1 p-2"
            onClick={() => setLayout(option.value)}
          >
            <img src={option.image} alt="" className="h-16 w-auto rounded-md" />
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
