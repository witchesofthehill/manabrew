import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KEYBINDINGS, formatCombo } from "@/lib/keybindings";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const overrides = useKeybindingsStore((s) => s.overrides);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return KEYBINDINGS;
    return KEYBINDINGS.filter(
      (binding) =>
        binding.label.toLowerCase().includes(term) || binding.category.toLowerCase().includes(term),
    );
  }, [query]);
  const categories = [...new Set(filtered.map((binding) => binding.category))];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="pl-9"
            placeholder="Search shortcuts…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto pr-1">
          {categories.map((category) => (
            <div key={category} className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </h3>
              <div className="space-y-1">
                {filtered
                  .filter((b) => b.category === category)
                  .map((b) => {
                    const combo = resolveCombo(b.id, overrides);
                    return (
                      <div key={b.id} className="flex items-center justify-between gap-3 text-sm">
                        <span>{b.label}</span>
                        <kbd
                          className="rounded border bg-muted px-1.5 py-0.5 text-xs"
                          style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
                        >
                          {combo ? formatCombo(combo) : "—"}
                        </kbd>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No shortcuts match “{query}”.
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Customize these in Preferences → Shortcuts.</p>
      </DialogContent>
    </Dialog>
  );
}
