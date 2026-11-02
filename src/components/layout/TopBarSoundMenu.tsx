import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { SoundControls } from "@/components/SoundControls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function TopBarSoundMenu() {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const soundMuted = usePreferencesStore((state) => state.soundMuted);
  const open = hoverOpen || pinnedOpen;

  useEffect(() => {
    if (!open) return;

    function close() {
      setHoverOpen(false);
      setPinnedOpen(false);
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }

    function handlePointerOver(event: PointerEvent) {
      if (event.pointerType === "mouse" && !rootRef.current?.contains(event.target as Node)) {
        setHoverOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="group/sound relative shrink-0"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHoverOpen(true);
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant={soundMuted || open ? "secondary" : "ghost"}
        className="h-8 w-8"
        onClick={() => setPinnedOpen((current) => !current)}
        title="Sound controls"
        aria-label="Sound controls"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="top-bar-sound-controls"
      >
        {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>
      <div
        id="top-bar-sound-controls"
        role="dialog"
        aria-label="Sound controls"
        className={cn(
          "absolute right-0 top-full z-50 hidden w-64 pt-2 group-hover/sound:block",
          open && "block",
        )}
      >
        <div className="rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
          <p className="mb-3 text-sm font-semibold">Sounds</p>
          <SoundControls className="gap-2" />
        </div>
      </div>
    </div>
  );
}
