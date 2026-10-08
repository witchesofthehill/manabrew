import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { LimitedDeckStats } from "@/components/limited/LimitedDeckStats";
import {
  useLimitedBuildStore,
  buildDeck,
  type BuildSession,
} from "@/components/limited/useLimitedBuildStore";
interface Props {
  sessionKey: string;
  session: BuildSession;
  onClose: () => void;
}
export function LimitedBuildConfigurations({ sessionKey, session, onClose }: Props) {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState(session.builds[0]?.id ?? "");
  const selected = session.builds.find((build) => build.id === selectedId);
  const current = useMemo(() => buildDeck(session).main, [session]);
  const other = useMemo(
    () => (selected ? buildDeck({ ...session, allocation: selected }).main : []),
    [session, selected],
  );
  const diff = useMemo(() => {
    const changes = new Map<string, { name: string; delta: number }>();
    for (const [cards, delta] of [
      [current, 1],
      [other, -1],
    ] as const)
      for (const card of cards) {
        const key = JSON.stringify([card.name, card.setCode, card.cardNumber, !!card.foil]);
        const entry = changes.get(key) ?? {
          name: `${card.name} · ${card.setCode.toUpperCase()} ${card.cardNumber}${card.foil ? " · Foil" : ""}`,
          delta: 0,
        };
        entry.delta += delta;
        changes.set(key, entry);
      }
    return [...changes.values()]
      .filter((entry) => entry.delta !== 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [current, other]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Build configurations</DialogTitle>
          <DialogDescription>
            Keep different builds of this pool, each with its own basics, printings and zone
            assignments. Loading a build can be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            const store = useLimitedBuildStore.getState();
            store.saveBuild(sessionKey, name.trim());
            setSelectedId(store.sessions[sessionKey].builds.at(-1)!.id);
            setName("");
          }}
        >
          <Input
            aria-label="Configuration name"
            placeholder="Name this build"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button variant="outline" type="submit" disabled={!name.trim()}>
            Keep build
          </Button>
        </form>
        {session.builds.length ? (
          <>
            <div className="flex flex-wrap gap-2">
              <AppSelect
                aria-label="Compare configuration"
                value={selectedId}
                onValueChange={setSelectedId}
                className="flex-1"
              >
                <AppSelectOption value="">Choose a build</AppSelectOption>
                {session.builds.map((build) => (
                  <AppSelectOption key={build.id} value={build.id}>
                    {build.name}
                  </AppSelectOption>
                ))}
              </AppSelect>
              <Button
                variant="secondary"
                disabled={!selected}
                onClick={() => useLimitedBuildStore.getState().loadBuild(sessionKey, selectedId)}
              >
                Load build
              </Button>
              <Button
                variant="destructive-quiet"
                disabled={!selected}
                onClick={() => {
                  useLimitedBuildStore.getState().deleteBuild(sessionKey, selectedId);
                  setSelectedId("");
                }}
              >
                Delete
              </Button>
            </div>
            {selected && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <section>
                    <h3 className="mb-2 font-serif text-lg">Current · {current.length} cards</h3>
                    <LimitedDeckStats cards={current} />
                  </section>
                  <section>
                    <h3 className="mb-2 font-serif text-lg">
                      {selected.name} · {other.length} cards
                    </h3>
                    <LimitedDeckStats cards={other} />
                  </section>
                </div>
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Changes from {selected.name}</h3>
                  {diff.length ? (
                    <ul className="max-h-48 overflow-y-auto text-xs">
                      {diff.map((entry) => (
                        <li
                          key={entry.name}
                          className="flex justify-between border-b border-border py-1"
                        >
                          <span>{entry.name}</span>
                          <span className="font-mono">
                            {entry.delta > 0 ? "+" : ""}
                            {entry.delta}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      The main decks contain the same printings and counts.
                    </p>
                  )}
                </section>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Name your current build to keep it here.</p>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
