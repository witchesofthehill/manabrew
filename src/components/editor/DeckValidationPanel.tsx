import { AlertTriangle } from "lucide-react";
import { useDeckStore } from "@/stores/useDeckStore";
import { getFormat, validateDeckSections } from "@/lib/formats";

export function DeckValidationPanel({ unsupportedNames }: { unsupportedNames?: Set<string> }) {
  const { currentDeck } = useDeckStore();

  const format = getFormat(currentDeck.format ?? "standard");
  if (!format) return null;

  const validation = validateDeckSections(
    {
      deck: currentDeck,
      commanderName: currentDeck.commanders?.[0]?.identity.name,
    },
    format,
  );

  const unsupportedList = unsupportedNames ? [...unsupportedNames].sort() : [];
  const hasUnsupported = unsupportedList.length > 0;
  const errors = validation.errors;
  const count = errors.length;

  if (count === 0 && !hasUnsupported) return null;

  return (
    <>
      {count > 0 && (
        <div className="mx-4 mt-4 rounded-xl border border-destructive/40 bg-destructive/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-sm font-semibold text-destructive">
              {count} {count === 1 ? "issue" : "issues"}
            </span>
            <span className="text-xs text-destructive/60">for {format.name}</span>
          </div>
          <ul className="mt-1.5 space-y-0.5 pl-6">
            {errors.map((err, i) => (
              <li key={i} className="text-xs text-destructive/80 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">&#x2022;</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasUnsupported && (
        <div className="mx-4 mt-4 rounded-xl border border-warning/40 bg-warning/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <span className="text-sm font-semibold text-warning">
              {unsupportedList.length} Manabrew engine warning
              {unsupportedList.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-warning/80">
            These cards may be unsupported by Manabrew's built-in engine, but the deck can still be
            saved as playable for engines that can load them, including Ironsmith trusted rooms:{" "}
            {unsupportedList.join(", ")}
          </p>
        </div>
      )}
    </>
  );
}
