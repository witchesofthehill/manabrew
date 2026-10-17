import { Shuffle } from "lucide-react";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { ScryfallSet } from "@/types/scryfall";

interface LimitedSetupExtrasProps {
  section: "templates" | "chaos";
  sets: ScryfallSet[];
  podSize: number;
  busy: boolean;
  onStartChaos: (codes: string[]) => void;
}

export function LimitedSetupExtras({
  section,
  sets,
  podSize,
  busy,
  onStartChaos,
}: LimitedSetupExtrasProps) {
  const templates = useLimitedStore((state) => state.sealedTemplates);
  const themes = useLimitedStore((state) => state.chaosThemes);
  return (
    <section aria-label="More Limited options" className="space-y-3">
      {section === "templates" && (
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {templates.map((template) => (
            <li key={template.id} className="rounded border border-border/40 bg-card/30 px-3 py-2">
              <div className="font-medium">{template.label}</div>
              <div className="text-xs text-muted-foreground">{template.description}</div>
            </li>
          ))}
        </ul>
      )}
      {section === "chaos" && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => {
            const matched = matchSetsForTheme(theme.tag, sets);
            return (
              <li key={theme.tag}>
                <button
                  type="button"
                  disabled={busy || matched.length === 0}
                  onClick={() => onStartChaos(matched.map((set) => set.code))}
                  className="group flex w-full items-center justify-between gap-2 rounded border border-border/40 bg-card/30 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-card/60 disabled:cursor-not-allowed disabled:opacity-60"
                  title={
                    matched.length === 0
                      ? "No matching sets in the Scryfall list yet"
                      : `${matched.length} sets · ${matched
                          .slice(0, 6)
                          .map((set) => set.code.toUpperCase())
                          .join(", ")}${matched.length > 6 ? "…" : ""}`
                  }
                >
                  <div>
                    <div className="text-sm font-medium">{theme.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {matched.length} sets · {podSize} players
                    </div>
                  </div>
                  <Shuffle className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function matchSetsForTheme(tag: string, sets: ScryfallSet[]): ScryfallSet[] {
  const sorted = [...sets].sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""));
  switch (tag.toUpperCase()) {
    case "STANDARD": {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 3);
      const stamp = cutoff.toISOString().slice(0, 10);
      return sorted
        .filter((set) => set.set_type === "expansion" && (set.released_at ?? "") >= stamp)
        .slice(0, 8);
    }
    case "PIONEER":
      return sorted
        .filter((set) => set.set_type === "expansion" && (set.released_at ?? "") >= "2012-10-05")
        .slice(0, 8);
    case "MODERN":
      return sorted
        .filter((set) => set.set_type === "expansion" && (set.released_at ?? "") >= "2003-07-28")
        .slice(0, 8);
    default:
      return sorted.slice(0, 6);
  }
}
