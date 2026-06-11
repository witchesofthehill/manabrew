import { FormatBadge } from "@/components/game/FormatBadge";
import { GAME_FORMATS, type GameFormat } from "@/lib/formats";

interface FormatPickerProps {
  formats?: GameFormat[];
  onSelect: (formatId: string) => void;
}

export function FormatPicker({ formats = GAME_FORMATS, onSelect }: FormatPickerProps) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <header className="mb-10 text-center">
          <h2 className="font-serif text-4xl font-light tracking-wide">Choose a format</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Decide the rules of engagement before picking decks.
          </p>
          <div
            aria-hidden
            className="mx-auto mt-4 h-px w-24 bg-gradient-to-r from-transparent via-foreground/40 to-transparent"
          />
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {formats.map((format) => (
            <FormatTile key={format.id} format={format} onClick={() => onSelect(format.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FormatTile({ format, onClick }: { format: GameFormat; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 p-4 text-left transition-colors duration-75 hover:border-primary/60 hover:bg-card/80"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-tight">{format.name}</h3>
        <FormatBadge formatId={format.id} />
      </div>
      <p className="text-xs leading-snug text-muted-foreground">{format.description}</p>
    </button>
  );
}
