import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { offlineCacheAvailable } from "@/lib/cardGlintAssetCache";
import {
  cancelCardGlintInstall,
  cardGlintOfflineStatus,
  clearCardGlintOffline,
  getCardGlintInstallState,
  installCardGlintDeck,
  subscribeCardGlintInstall,
} from "@/lib/cardGlintOffline";
import type { CardGlintOfflineStatus } from "@/lib/cardGlintOffline";

export function CardGlintOfflineSection() {
  const decks = useOwnedDecks();
  const locale = useScryfallStore((store) => store.locale);
  const [selectedId, setSelectedId] = useState("");
  const [permission, setPermission] = useState(false);
  const [status, setStatus] = useState<CardGlintOfflineStatus | null>(null);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const state = useSyncExternalStore(subscribeCardGlintInstall, getCardGlintInstallState);
  const selected = decks.find((deck) => deck.id === selectedId) ?? decks[0];
  const busy =
    state.phase === "preparing" || state.phase === "downloading" || state.phase === "clearing";
  const available = offlineCacheAvailable();
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setStatus(null);
      if (selected && available) {
        try {
          const value = await cardGlintOfflineStatus(selected.deck);
          if (active) setStatus(value);
        } catch (cause: unknown) {
          if (active) setError(String(cause));
        }
      }
    });
    return () => {
      active = false;
    };
  }, [selected, available, locale, state.phase, refresh]);
  return (
    <section
      className="max-w-xl space-y-3 rounded-lg border bg-card/40 p-4"
      aria-labelledby="glint-offline-heading"
    >
      <h3 id="glint-offline-heading" className="text-sm font-medium">
        Generated cards offline
      </h3>
      <p className="text-xs text-muted-foreground">
        Download the selected deck's frames, all renderer fonts, symbols, card records and artwork
        into this browser's storage. Both faces and saved customizations are included. Finish maps
        are generated locally and need no separate download.
      </p>
      <AppSelect
        aria-label="Deck to keep offline"
        value={selected?.id ?? ""}
        onValueChange={setSelectedId}
        disabled={busy || decks.length === 0}
        className="w-full"
      >
        {decks.map((deck) => (
          <AppSelectOption key={deck.id} value={deck.id}>
            {deck.deck.name}
          </AppSelectOption>
        ))}
      </AppSelect>
      {decks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Save a deck before downloading its renderer assets.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Frames and proprietary fonts are not bundled with Manabrew. Card Conjurer's service terms
        are personal and noncommercial, not a blanket asset redistribution license. Some source
        collections provide no asset license. Only download materials you have permission to use.{" "}
        <a
          className="underline"
          href="https://github.com/joshbirnholz/cardconjurer/blob/33f2547137fe366b40e9e8dba4eb591af190fddf/legal/index.html"
          target="_blank"
          rel="noreferrer"
        >
          Source terms
        </a>
        {" · "}
        <a
          className="underline"
          href="/card-glint-licenses/games-magic-NOTICE.md"
          target="_blank"
          rel="noreferrer"
        >
          Asset notices
        </a>
      </p>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={permission}
          onChange={(event) => setPermission(event.target.checked)}
          disabled={busy}
        />
        I have permission to download these source assets for my personal use.
      </label>
      <div role="status" aria-live="polite" className="space-y-1 text-xs text-muted-foreground">
        {!available ? (
          <p>Persistent asset storage is unavailable. Use HTTPS or the desktop app.</p>
        ) : status?.ready ? (
          <p>
            Installed for this deck and language: {status.manifest?.urls.length} resources,{" "}
            {((status.manifest?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB.
            {status.manifest?.scanOnly
              ? ` ${status.manifest.scanOnly} cards retain their original scans.`
              : ""}
          </p>
        ) : (
          <p>
            {status?.missing
              ? `${status.missing} installed resources are missing. Download again.`
              : "This deck's current assets have not been fully installed."}
          </p>
        )}
        {state.phase === "preparing" && <p>Collecting resources: {state.message}</p>}
        {state.phase === "downloading" && (
          <p>
            {state.done} / {state.total} resources, {(state.bytes / 1024 / 1024).toFixed(1)} MB.
          </p>
        )}
        {state.phase === "cancelled" && (
          <p>Download cancelled. Partial files are kept for the next attempt, not marked ready.</p>
        )}
        {state.phase === "failed" && <p>Download failed: {state.message}</p>}
        {error && <p>{error}</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        Install while connected. A first-time offline launch cannot fetch missing assets. Readiness
        applies only to this saved deck, printing choices and language, not every card or the app
        itself. Changing them requires another download. Browser storage can be evicted. This cache
        is separate from desktop card-art downloads; clearing it leaves those intact.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!available || !selected || !permission || busy}
          onClick={() => {
            setError(undefined);
            if (selected)
              void installCardGlintDeck(selected.deck).catch((cause: unknown) =>
                setError(String(cause)),
              );
          }}
        >
          Download deck assets
        </Button>
        {(state.phase === "preparing" || state.phase === "downloading") && (
          <Button variant="outline" onClick={cancelCardGlintInstall}>
            Cancel download
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!available || busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Check storage
        </Button>
        <Button
          variant="destructive-quiet"
          disabled={!available || busy}
          onClick={() => {
            setError(undefined);
            void clearCardGlintOffline();
          }}
        >
          Clear renderer cache
        </Button>
      </div>
    </section>
  );
}
