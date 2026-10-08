import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LimitedDraftReview } from "@/components/limited/LimitedDraftReview";
import { listLimitedSaves, subscribeLimitedSaves, updateLimitedSave } from "@/game/limitedStorage";
import { resumeLimitedSession } from "@/game/limitedRecovery";
import { exportLimitedReview, importLimitedReview } from "@/game/limitedReview";
import type { LimitedSavedSession } from "@/game/limitedPersistence.types";

interface LimitedSavedSessionsProps {
  onResume?: (saved: LimitedSavedSession) => void | Promise<void>;
}

export function LimitedSavedSessions({ onResume }: LimitedSavedSessionsProps) {
  const [sessions, setSessions] = useState<LimitedSavedSession[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void listLimitedSaves()
        .then((records) => {
          if (!cancelled) setSessions(records);
        })
        .catch((cause) => {
          if (!cancelled) setError(String(cause));
        });
    };
    refresh();
    const off = subscribeLimitedSaves(refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  const run = async (id: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  };
  const visible = sessions.filter((session) => showArchived || !session.archived);
  return (
    <details className="rounded-lg border bg-card text-card-foreground">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Saved Limited sessions{sessions.length > 0 ? ` · ${sessions.length}` : ""}
      </summary>
      <div className="grid gap-3 px-4 pb-4">
        <p className="text-xs text-muted-foreground">
          Saved on this device. Session recovery stays local; exported reviews contain only your
          visible cards, decisions and named builds.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => input.current?.click()}
          >
            Import review JSON
          </Button>
          <Button
            variant={showArchived ? "selected" : "outline"}
            size="sm"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void run("import", async () => {
                const imported = await importLimitedReview(await file.text());
                setShowArchived(true);
                setReviewId(imported.sessionId);
              });
            }}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {sessions.length
              ? "All sessions are archived."
              : "Start Draft, Winston or Sealed to save a resumable session here."}
          </p>
        )}
        <ul className="grid max-h-96 gap-2 overflow-y-auto">
          {visible.map((session) => (
            <li
              key={session.sessionId}
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.title}</p>
                <p className="text-xs text-muted-foreground">
                  {session.role === "review"
                    ? "Imported review"
                    : session.role === "solo"
                      ? "Solo"
                      : `Multiplayer ${session.role}`}{" "}
                  · {session.complete ? "Finished" : "In progress"}
                  {session.archived ? " · Archived" : ""} ·{" "}
                  {new Date(session.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {session.role !== "review" && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      void run(session.sessionId, async () => {
                        const restored = await resumeLimitedSession(session.sessionId);
                        await onResume?.(restored);
                      });
                    }}
                  >
                    {busy === session.sessionId ? "Resuming..." : "Resume"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setReviewId(session.sourceSessionId ?? session.sessionId)}
                >
                  Review
                </Button>
                {session.kind !== "gauntlet" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      try {
                        exportLimitedReview(session);
                        setError(null);
                      } catch (cause) {
                        setError(String(cause));
                      }
                    }}
                  >
                    Export
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    void run(session.sessionId, async () => {
                      await updateLimitedSave(
                        session.sessionId,
                        (saved) => saved && { ...saved, archived: !saved.archived },
                      );
                    });
                  }}
                >
                  {session.archived ? "Unarchive" : "Archive"}
                </Button>
                <Button
                  variant="destructive-quiet"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setDeleteId(session.sessionId)}
                >
                  Delete
                </Button>
              </div>
              {deleteId === session.sessionId && (
                <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
                  <p>
                    Delete this recovery checkpoint and local review? Decks in My Decks are kept.
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      void run(session.sessionId, async () => {
                        await updateLimitedSave(session.sessionId, () => null);
                        setDeleteId(null);
                      });
                    }}
                  >
                    Delete saved session
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {reviewId && (
        <LimitedDraftReview
          sessionId={reviewId}
          open
          onOpenChange={(open) => {
            if (!open) setReviewId(null);
          }}
        />
      )}
    </details>
  );
}
