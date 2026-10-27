import type { CardCalibrationFace } from "@/lib/cardPrintingCalibration";

const COMPONENT_LABELS = {
  frame: "Frame",
  textBox: "Text box",
  border: "Border",
  interiorInk: "Interior ink",
  manaSymbols: "Mana symbols",
} as const;

export function CardCalibrationCoverage({ face }: { face: CardCalibrationFace }) {
  const report = face.report;
  if (!report)
    return <p className="text-ui-meta text-muted-foreground">{face.restriction ?? face.error}</p>;
  const mode = typeof report.mode === "string" ? report.mode : report.mode.profile;
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-ui-label font-medium">
        {face.name} · SDK coverage
      </summary>
      <div className="mt-2 space-y-2 text-ui-meta">
        <p className="text-muted-foreground">Resolved policy: {mode}</p>
        <dl className="space-y-1">
          {Object.entries(COMPONENT_LABELS).map(([key, label]) => {
            const component = report.components[key as keyof typeof COMPONENT_LABELS];
            return (
              <div key={key} className="flex flex-wrap justify-between gap-x-3">
                <dt>{label}</dt>
                <dd className="text-muted-foreground">
                  {component.status}
                  {component.profile && ` · ${component.profile}`}
                  {component.revision !== undefined && ` · revision ${component.revision}`}
                </dd>
              </div>
            );
          })}
        </dl>
        {report.defaults && (
          <p className="text-muted-foreground">
            Inherited defaults: {report.defaults.profile} · revision {report.defaults.revision}.
            {" These are not measurements of the selected printing."}
          </p>
        )}
        {report.notices.length > 0 && (
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {report.notices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
