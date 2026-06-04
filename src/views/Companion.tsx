import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CompanionBar } from "@/components/companion/CompanionBar";
import { CompanionBoard } from "@/components/companion/CompanionBoard";
import { FocusExitButton } from "@/components/companion/FocusExitButton";
import { GameIcon } from "@/components/companion/GameIcon";
import { GameSummaryDialog } from "@/components/companion/GameSummaryDialog";
import { NewSessionDialog } from "@/components/companion/NewSessionDialog";
import { PhaseStrip } from "@/components/companion/PhaseStrip";
import { StatsDialog } from "@/components/companion/StatsDialog";
import { WinBanner } from "@/components/companion/WinBanner";
import { useCompanionStore } from "@/stores/useCompanionStore";

export default function Companion() {
  const session = useCompanionStore((s) => s.session);
  const newSession = useCompanionStore((s) => s.newSession);
  const archive = useCompanionStore((s) => s.archive);
  const restoreFromArchive = useCompanionStore((s) => s.restoreFromArchive);
  const [newOpen, setNewOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [chromeInFocus, setChromeInFocus] = useState(false);

  // Wrap the focus setter so leaving focus mode also clears the peek flag,
  // without needing an effect that calls setState (which the React-hooks
  // lint rules don't allow).
  const setFocusMode = (next: boolean) => {
    setFocus(next);
    if (!next) setChromeInFocus(false);
  };

  // Keep focus state in sync with the browser's fullscreen state so Esc /
  // the system gesture drops us back into the chrome'd view automatically.
  useEffect(() => {
    if (!focus) return;
    const onChange = () => {
      if (!document.fullscreenElement) setFocusMode(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [focus]);

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <GameIcon icon="healing" className="size-14 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Life tracker</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Track life, counters, commander damage and table layout for paper play. One device
            passes around the table.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setNewOpen(true)}>Start a game</Button>
          <StatsDialog />
        </div>
        {archive.length > 0 && (
          <div className="mt-4 w-full max-w-sm space-y-1 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent games
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {archive.slice(0, 5).map((archived) => (
                <li key={archived.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{archived.tag || "Untitled game"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(archived.createdAt).toLocaleString()} · {archived.players.length}p
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => restoreFromArchive(archived.id)}
                  >
                    Resume
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <NewSessionDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          hasExistingSession={false}
          onCreate={(input) => {
            newSession(input);
            setNewOpen(false);
          }}
        />
        <GameSummaryDialog />
      </div>
    );
  }

  const showChrome = !focus || chromeInFocus;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        focus
          ? "fixed inset-0 z-50 h-[100dvh] w-screen bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]"
          : "pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
      )}
    >
      {showChrome && (
        <div
          className={cn(
            focus && "absolute inset-x-0 top-[env(safe-area-inset-top)] z-40 shadow-xl",
          )}
        >
          <CompanionBar
            session={session}
            onOpenNewSession={() => setNewOpen(true)}
            focus={focus}
            onToggleFocus={setFocusMode}
            onHidePeek={focus && chromeInFocus ? () => setChromeInFocus(false) : undefined}
          />
          <PhaseStrip />
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <CompanionBoard session={session} />
        <WinBanner session={session} />
        {focus && !chromeInFocus && (
          <FocusExitButton
            onExit={() => setFocusMode(false)}
            onShowChrome={() => setChromeInFocus(true)}
          />
        )}
      </div>
      <NewSessionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        hasExistingSession
        onCreate={(input) => {
          newSession(input);
          setNewOpen(false);
        }}
      />
      <GameSummaryDialog />
    </div>
  );
}
