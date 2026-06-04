import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useDeckStore } from "@/stores/useDeckStore";
import { getFormat, validateDeckSections } from "@/lib/formats";

export function DeckValidationPanel({ unsupportedNames }: { unsupportedNames?: Set<string> }) {
  const [collapsed, setCollapsed] = useState(false);
  const { currentDeck } = useDeckStore();

  const format = getFormat(currentDeck.format ?? "standard");
  if (!format) return null;

  const validation = validateDeckSections(
    {
      deck: currentDeck,
      commanderName: currentDeck.commanders?.[0]?.name,
    },
    format,
  );

  const unsupportedList = unsupportedNames ? [...unsupportedNames].sort() : [];
  const hasUnsupported = unsupportedList.length > 0;

  if (validation.legal && !hasUnsupported) return null;

  const unsupportedErrors = hasUnsupported
    ? [
        `${unsupportedList.length} card${unsupportedList.length === 1 ? "" : "s"} not implemented by the engine — playable build blocked, save as draft only: ${unsupportedList.join(", ")}`,
      ]
    : [];
  const errors = [...unsupportedErrors, ...validation.errors];
  const count = errors.length;

  return (
    <div className="border-t border-destructive/30 bg-destructive/5 shrink-0">
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-1.5 w-full px-3 py-2 hover:bg-destructive/10 transition-colors text-left cursor-pointer"
        onClick={() => setCollapsed((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((v) => !v);
          }
        }}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-destructive/60 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 text-destructive/60 shrink-0" />
        )}
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="text-xs font-semibold text-destructive uppercase tracking-wide">
          {count} {count === 1 ? "issue" : "issues"}
        </span>
        <span className="text-xs text-destructive/60">for {format.name}</span>
      </div>
      {!collapsed && (
        <ul className="px-3 pb-2 space-y-0.5 ml-5">
          {errors.map((err, i) => (
            <li key={i} className="text-xs text-destructive/80 flex items-start gap-1.5">
              <span className="shrink-0 mt-0.5">&#x2022;</span>
              <span>{err}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
