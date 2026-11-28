import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface SavedDeckPickerSectionProps {
  emptyMessage?: string;
  children: ReactNode;
}

export function SavedDeckPickerSection({ emptyMessage, children }: SavedDeckPickerSectionProps) {
  return (
    <div className="p-4 pt-2">
      <Label className="text-ui-label uppercase tracking-wider text-muted-foreground font-semibold">
        My decks
      </Label>
      <p className="text-ui-meta text-muted-foreground mt-0.5 mb-3">
        Decks you've built in the editor.
      </p>
      {emptyMessage ? (
        <p className="text-ui-meta text-muted-foreground italic">{emptyMessage}</p>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
          {children}
        </div>
      )}
    </div>
  );
}
