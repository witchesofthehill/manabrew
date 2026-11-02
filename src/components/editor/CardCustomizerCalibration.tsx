import { useId } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import type { CardCustomizerEditor } from "@/components/editor/useCardCustomizerDraft";
import type { CardCustomizerCalibrationState } from "@/components/editor/useCardCustomizerCalibration";
import {
  CARD_CALIBRATION_CHOICES,
  type CardCalibrationOption,
} from "@/lib/cardPrintingCalibration";
import type { CardPrintingCalibration } from "@/protocol/deck";

const FACE_LABELS = ["Front", "Back"] as const;

export function CardCustomizerCalibration({
  editor,
  calibration,
  disabled,
}: {
  editor: CardCustomizerEditor;
  calibration: CardCustomizerCalibrationState;
  disabled: boolean;
}) {
  const labelId = useId();
  const printing = editor.preview.identity.cosmetics?.printing;
  const resolution = calibration.resolution;
  const unavailable = CARD_CALIBRATION_CHOICES.map((choice) => ({
    ...choice,
    supported: false,
    reason: calibration.pending ? "Checking this card…" : "Unavailable for this card.",
  }));
  const count = Math.max(resolution?.faces.length ?? 0, printing?.faces?.length ?? 0, 1);
  const faces = ([0, 1] as const)
    .slice(0, count)
    .filter((index) => count > 1 || printing?.faces?.[index]?.overrides?.calibration !== undefined);
  const controls: {
    label: string;
    value?: CardPrintingCalibration;
    index?: 0 | 1;
    options: readonly CardCalibrationOption[];
  }[] = [
    {
      label: "Frame colors",
      value: printing?.overrides?.calibration,
      options: resolution?.options ?? unavailable,
    },
    ...faces.map((index) => ({
      label: `${FACE_LABELS[index]} · ${resolution?.faces[index]?.name ?? `Face ${index + 1}`}`,
      value: printing?.faces?.[index]?.overrides?.calibration,
      index,
      options: resolution?.faces[index]?.options ?? unavailable,
    })),
  ];
  return (
    <section aria-label="Frame colors" className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {controls.map((control, index) => {
          const selected = control.options.find((option) => option.value === control.value);
          return (
            <div key={index} className="min-w-0 space-y-1.5">
              <label
                id={`${labelId}-${index}`}
                className="touch:min-h-11 block text-ui-label font-medium"
              >
                {control.label}
              </label>
              <AppSelect
                value={control.value ?? "default"}
                aria-labelledby={`${labelId}-${index}`}
                disabled={disabled}
                className="w-full"
                onValueChange={(value) => {
                  if (disabled) return;
                  if (value === "default") editor.editCalibration(undefined, control.index);
                  else {
                    const choice = control.options.find((option) => option.value === value);
                    if (choice?.supported) editor.editCalibration(choice.value, control.index);
                  }
                }}
              >
                <AppSelectOption value="default">
                  {control.index === undefined ? "Default" : "Same as card"}
                </AppSelectOption>
                {control.options.map((option) => (
                  <AppSelectOption
                    key={option.value}
                    value={option.value}
                    disabled={!option.supported}
                  >
                    <span>
                      {option.label}
                      {!option.supported && option.reason && (
                        <span className="block text-ui-meta text-muted-foreground">
                          {option.reason}
                        </span>
                      )}
                    </span>
                  </AppSelectOption>
                ))}
              </AppSelect>
              {selected && (
                <p className="text-ui-meta text-muted-foreground">{selected.description}</p>
              )}
            </div>
          );
        })}
      </div>
      {calibration.error && (
        <p role="status" className="text-ui-meta text-warning">
          Frame colors could not be checked: {calibration.error}
          {!calibration.valid && " Choose Default before saving."}
        </p>
      )}
      {resolution && !resolution.valid && (
        <div role="status" className="space-y-1 text-ui-meta text-warning">
          {resolution.errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
          <p>Choose another option or Default before saving.</p>
        </div>
      )}
    </section>
  );
}
