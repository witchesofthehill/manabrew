import { useId } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { CardCalibrationCoverage } from "@/components/editor/CardCalibrationCoverage";
import type { CardCustomizerEditor } from "@/components/editor/useCardCustomizerDraft";
import type { CardCustomizerCalibrationState } from "@/components/editor/useCardCustomizerCalibration";
import {
  CARD_CALIBRATION_CHOICES,
  type CardCalibrationOption,
} from "@/lib/cardPrintingCalibration";
import type { CardPrintingCalibration } from "@/protocol/deck";

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
    reason: calibration.pending
      ? "Checking face compatibility…"
      : "Face compatibility is unavailable.",
  }));
  const count = Math.max(resolution?.faces.length ?? 0, printing?.faces?.length ?? 0, 1);
  const controls: {
    label: string;
    value?: CardPrintingCalibration;
    index?: 0 | 1;
    options: readonly CardCalibrationOption[];
  }[] = [
    {
      label: "Card calibration",
      value: printing?.overrides?.calibration,
      options: resolution?.options ?? unavailable,
    },
    ...Array.from({ length: Math.min(count, 2) }, (_, index) => ({
      label: resolution?.faces[index]?.name ?? `Face ${index + 1}`,
      value: printing?.faces?.[index]?.overrides?.calibration,
      index: index as 0 | 1,
      options: resolution?.faces[index]?.options ?? unavailable,
    })),
  ];
  return (
    <section aria-label="Printing calibration" className="space-y-3 border-t pt-4">
      <h3 className="text-ui-label font-semibold">Printing calibration</h3>
      <p className="text-ui-body text-muted-foreground">
        Choose a color policy without changing the selected printing or its content. Face settings
        override the card setting; existing/default behavior keeps the renderer's original policy.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {controls.map((control, index) => (
          <div key={index} className="min-w-0 space-y-1.5">
            <label id={`${labelId}-${index}`} className="block text-ui-label font-medium">
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
                {control.index === undefined ? "Existing/default behavior" : "Inherit card setting"}
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
          </div>
        ))}
      </div>
      {calibration.pending && (
        <p role="status" className="text-ui-meta text-muted-foreground">
          Checking calibration compatibility and coverage…
        </p>
      )}
      {calibration.error && (
        <p role="status" className="text-ui-meta text-warning">
          Calibration could not be resolved: {calibration.error}{" "}
          {calibration.valid
            ? "Existing/default behavior is unchanged."
            : "Clear calibration overrides or choose another printing before saving."}
        </p>
      )}
      {resolution && !resolution.valid && (
        <div role="status" className="space-y-1 text-ui-meta text-warning">
          {resolution.errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
          <p>Choose a compatible calibration or clear the override before saving.</p>
        </div>
      )}
      {resolution?.faces.map((face) => (
        <CardCalibrationCoverage key={face.index} face={face} />
      ))}
      <p className="text-ui-meta text-muted-foreground">
        SDK coverage describes measured components, inherited defaults, and source/fallback paths.
        It does not certify physical color accuracy or your display.
      </p>
    </section>
  );
}
