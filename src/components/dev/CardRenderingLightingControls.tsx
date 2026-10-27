import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { DEFAULT_CARD_POSE, MAX_CARD_TILT } from "@/lib/cardLighting";
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";

export function CardRenderingLightingControls({
  lighting,
  pose,
  onLightingChange,
  onPoseChange,
}: {
  lighting: CardLightingMode;
  pose: CardPose;
  onLightingChange: (lighting: CardLightingMode) => void;
  onPoseChange: (pose: CardPose) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-ui-label font-medium">Renderer lighting and pose</legend>
      <AppSelect
        value={lighting}
        onValueChange={(value) => onLightingChange(value as CardLightingMode)}
        aria-label="Card lighting mode"
      >
        <AppSelectOption value="pointer">Compatibility</AppSelectOption>
        <AppSelectOption value="studio">Studio</AppSelectOption>
      </AppSelect>
      {(["yaw", "pitch"] as const).map((axis) => (
        <label key={axis} className="grid gap-1 text-ui-label text-muted-foreground">
          {axis === "yaw" ? "Yaw" : "Pitch"} ({Math.round((pose[axis] * 180) / Math.PI)}°)
          <input
            type="range"
            aria-label={`Card ${axis}`}
            min={-MAX_CARD_TILT}
            max={MAX_CARD_TILT}
            step={0.01}
            value={pose[axis]}
            className="h-9 w-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11"
            onChange={(event) =>
              onPoseChange({ ...pose, [axis]: event.currentTarget.valueAsNumber })
            }
          />
        </label>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onPoseChange(DEFAULT_CARD_POSE)}>
        Reset shared pose
      </Button>
      <p className="text-ui-body text-muted-foreground">
        Native and Interactive Pixi share this material pose. Pointer hits still move water.
        Lighting and pose are local renderer settings, not saved card cosmetics.
      </p>
    </fieldset>
  );
}
