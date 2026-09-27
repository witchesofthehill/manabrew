import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SetPicker } from "@/components/limited/SetPicker";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { useScryfallStore } from "@/stores/useScryfallStore";

export function SetStudyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sets = useScryfallStore((state) => state.sets);
  const selected = sets?.find((set) => set.code === value);
  const draftableSets = (sets ?? []).filter(
    (set) => DRAFTABLE_SET_TYPES.has(set.set_type) && !set.digital,
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-between sm:w-72">
          <span className="truncate">
            {selected?.name ?? (value ? value.toUpperCase() : "Choose a set…")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose a set to study</DialogTitle>
          <DialogDescription>
            Explore the cards before your next draft or prerelease.
          </DialogDescription>
        </DialogHeader>
        <SetPicker
          sets={draftableSets}
          selectedCode=""
          prefetching={null}
          onSelect={(code) => {
            onChange(code);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
