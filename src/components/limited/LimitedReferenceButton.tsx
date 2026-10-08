import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LimitedSetReference } from "@/components/limited/LimitedSetReference";
import type { LimitedReferenceFormat } from "@/components/limited/LimitedSetReference";
import type { DraftCard } from "@/types/limited";

interface LimitedReferenceButtonProps {
  cards: DraftCard[];
  setCodes?: string[];
  format?: LimitedReferenceFormat;
}

export function LimitedReferenceButton({ cards, setCodes, format }: LimitedReferenceButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <BookOpen className="mr-1 size-4" aria-hidden="true" />
        Set reference
      </Button>
      {open && (
        <LimitedSetReference
          cards={cards}
          setCodes={setCodes}
          format={format}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
