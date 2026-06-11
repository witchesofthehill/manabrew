import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormatPicker } from "@/components/lobby/FormatPicker";
import { GAME_FORMATS } from "@/lib/formats";
import type { GameFormat, RoomInfo } from "@/types/server";

const SELECTABLE_FORMATS: GameFormat[] = [
  "Standard",
  "Pioneer",
  "Modern",
  "Legacy",
  "Vintage",
  "Pauper",
  "Commander",
  "Brawl",
  "Oathbreaker",
];

const PICKER_FORMATS = GAME_FORMATS.filter((f) =>
  SELECTABLE_FORMATS.some((s) => s.toLowerCase() === f.id),
);

interface ChooseFormatDialogProps {
  room: RoomInfo | null;
  onClose: () => void;
  onSelect: (room: RoomInfo, format: GameFormat) => void;
}

export function ChooseFormatDialog({ room, onClose, onSelect }: ChooseFormatDialogProps) {
  function handleSelect(formatId: string) {
    if (!room) return;
    const format = SELECTABLE_FORMATS.find((s) => s.toLowerCase() === formatId);
    if (!format) return;
    onClose();
    onSelect(room, format);
  }

  return (
    <Dialog open={room != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">Choose a format</DialogTitle>
        <div className="h-[min(42rem,85dvh)]">
          <FormatPicker formats={PICKER_FORMATS} onSelect={handleSelect} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
