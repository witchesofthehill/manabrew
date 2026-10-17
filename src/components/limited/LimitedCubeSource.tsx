import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CubeImportResult } from "@/types/limited";

interface LimitedCubeSourceProps {
  input: string;
  onInputChange: (s: string) => void;
  onImport: () => void | Promise<void>;
  onLoadFile: (file: File) => void | Promise<void>;
  cube: CubeImportResult | null;
  busy: boolean;
}

export function LimitedCubeSource({
  input,
  onInputChange,
  onImport,
  onLoadFile,
  cube,
  busy,
}: LimitedCubeSourceProps) {
  const id = useId();

  return (
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <legend className="sr-only">Cube or saved pool</legend>
      <div className="space-y-2">
        <label htmlFor={`${id}-cube`} className="block text-sm font-medium text-foreground">
          CubeCobra URL or cube ID
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${id}-cube`}
            value={input}
            onChange={(event) => onInputChange(event.currentTarget.value)}
            placeholder="https://cubecobra.com/cube/list/my-cube"
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !input.trim()}
            onClick={() => void onImport()}
            className="shrink-0"
          >
            {busy ? "Importing…" : "Import Cube"}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-file`} className="block text-sm font-medium text-foreground">
          Load pool · .json / .draft
        </label>
        <Input
          id={`${id}-file`}
          type="file"
          accept=".json,.draft"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void onLoadFile(file);
          }}
          className="h-auto min-h-10 max-w-full py-2"
        />
      </div>
      {cube && (
        <div role="status" className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <h3 className="break-words text-sm font-semibold text-foreground">{cube.name}</h3>
          <p className="text-sm text-muted-foreground">
            {cube.cardCount} cards · {cube.singleton ? "Singleton" : "Non-singleton"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {cube.playableCardCount} locally recognized · {cube.rejectedCardCount} name-only
          </p>
        </div>
      )}
    </fieldset>
  );
}
