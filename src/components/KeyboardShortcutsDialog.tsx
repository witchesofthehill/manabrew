import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const categories = [...new Set(KEYBINDINGS.map((b) => b.category))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto pr-1">
          {categories.map((category) => (
            <div key={category} className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </h3>
              <div className="space-y-1">
                {KEYBINDINGS.filter((b) => b.category === category).map((b) => {
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
        </div>
        <p className="text-xs text-muted-foreground">Customize these in Preferences → Shortcuts.</p>
      </DialogContent>
    </Dialog>
  );
}
