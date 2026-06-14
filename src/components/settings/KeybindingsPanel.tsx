import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KEYBINDINGS, comboFromEvent, formatCombo } from "@/lib/keybindings";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";

export function KeybindingsPanel() {
  const overrides = useKeybindingsStore((s) => s.overrides);
  const setBinding = useKeybindingsStore((s) => s.setBinding);
  const resetBinding = useKeybindingsStore((s) => s.resetBinding);
  const resetAll = useKeybindingsStore((s) => s.resetAll);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!capturingId) return;
    const id = capturingId;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturingId(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      setBinding(id, combo);
      setCapturingId(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturingId, setBinding]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return KEYBINDINGS;
    return KEYBINDINGS.filter((b) => {
      const combo = resolveCombo(b.id, overrides);
      const comboText = combo ? formatCombo(combo).toLowerCase() : "";
      return (
        b.label.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q) ||
        comboText.includes(q)
      );
    });
  }, [filter, overrides]);

  const categories = [...new Set(filtered.map((b) => b.category))];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <p className="text-xs text-muted-foreground">
            Click a shortcut, then press the key combination you want.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={resetAll}>
          Reset all
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter shortcuts…"
          className="pl-8"
        />
      </div>

      {categories.length === 0 && (
        <p className="text-sm text-muted-foreground">No shortcuts match “{filter}”.</p>
      )}

      {categories.map((category) => (
        <div key={category} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {category}
          </h3>
          <div className="divide-y rounded-md border">
            {filtered
              .filter((b) => b.category === category)
              .map((b) => {
                const combo = resolveCombo(b.id, overrides);
                const isCapturing = capturingId === b.id;
                const isCustom = !!overrides[b.id];
                return (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm">{b.label}</span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={isCapturing ? "secondary" : "outline"}
                        className={cn("h-7 min-w-24 text-xs", isCapturing && "animate-pulse")}
                        style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
                        onClick={() => setCapturingId(isCapturing ? null : b.id)}
                      >
                        {isCapturing ? "Press keys…" : combo ? formatCombo(combo) : "Unbound"}
                      </Button>
                      {isCustom && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Reset to default"
                          onClick={() => resetBinding(b.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}
