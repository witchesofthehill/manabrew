import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ALL_BATTLEFIELD_STYLES,
  ALL_CARDS_ESTIMATE,
  cacheCardRecords,
  cancelCardArtDownload,
  cardArtCacheAvailable,
  cardArtCacheStats,
  cardDataCached,
  clearCardArtCache,
  deckArtUrls,
  deckCardNames,
  downloadAllCardArt,
  estimateBytes,
  preseedCardArt,
  variantsForStyles,
  type BulkProgress,
  type CardArtCacheStats,
} from "@/api/cardArtCache";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
export function CardArtDownloadSection() {
  const decks = useOwnedDecks();
  const style = usePreferencesStore((state) => state.battlefieldCardStyle);
  const [stats, setStats] = useState<CardArtCacheStats | null>(null);
  const [cards, setCards] = useState(0);
  const [everyStyle, setEveryStyle] = useState(false);
  const [busy, setBusy] = useState<"decks" | "all" | "clearing" | null>(null);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [available, setAvailable] = useState(false);
  const variants = variantsForStyles(everyStyle ? ALL_BATTLEFIELD_STYLES : [style]);
  const refresh = useCallback(() => {
    cardArtCacheStats()
      .then(setStats)
      .catch(() => setStats(null));
    cardDataCached()
      .then(setCards)
      .catch(() => setCards(0));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    const unlisten = listen<BulkProgress>("card-art:progress", (event) =>
      setProgress(event.payload),
    );
    return () => void unlisten.then((off) => off());
  }, []);
  useEffect(() => {
    void cardArtCacheAvailable().then(setAvailable);
  }, []);
  if (!available) return null;
  /** The picture alone cannot be drawn: a board offline reads the card's url
   *  out of its record. Failing to keep them does not fail the download. */
  async function keepRecordsFor(names: string[]) {
    try {
      const found = await useScryfallStore
        .getState()
        .fetchCardCollection(names.map((name) => ({ name })));
      await cacheCardRecords([...new Set(found.values())]);
    } catch (error) {
      console.warn("[card-art] could not keep the card records", error);
    }
  }
  async function downloadDecks() {
    setBusy("decks");
    try {
      const urls = [...new Set(decks.flatMap((saved) => deckArtUrls(saved.deck, variants)))];
      if (urls.length === 0) {
        toast.info(`No decks to download art for yet.`);
        return;
      }
      const result = await preseedCardArt(urls);
      await keepRecordsFor([...new Set(decks.flatMap((saved) => deckCardNames(saved.deck)))]);
      const downloaded = result.fetched + result.alreadyCached;
      const summary =
        downloaded === 1 ? `Art ready for one image` : `Art ready for ${downloaded} images`;
      toast.success(
        result.failed > 0 ? `${summary}, ${result.failed} could not be fetched` : summary,
      );
      refresh();
    } catch (error) {
      toast.error(`Could not download art: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }
  async function downloadEverything() {
    setBusy("all");
    setProgress(null);
    try {
      const result = await downloadAllCardArt(variants);
      const summary = `Downloaded ${result.fetched}, already had ${result.alreadyCached}`;
      toast.success(result.failed > 0 ? `${summary}, ${result.failed} failed` : summary);
      refresh();
    } catch (error) {
      toast.error(`Could not download every card: ${String(error)}`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }
  async function clear(includeDownloaded: boolean) {
    setBusy("clearing");
    try {
      await clearCardArtCache(includeDownloaded);
      refresh();
    } catch (error) {
      toast.error(`Could not clear the art cache: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }
  const deckCards = new Set(decks.flatMap((saved) => saved.deck.cards.map((c) => c.identity.name)));
  return (
    <div className="rounded-lg border bg-card/40 p-4 space-y-3 max-w-xl">
      <Label>Card Art On This Machine</Label>
      <p className="text-xs text-muted-foreground">
        Art is kept on disk once drawn, so a board does not fetch it twice, and a deliberate
        download is never dropped when the cache is trimmed for space. Either download also keeps
        what each card <em>is</em>, which is what a board with no internet needs to know which
        picture to draw — pictures alone are not enough. Every card additionally keeps every card
        name, the set list and every ruling, so searching and pasting a decklist work offline too.
      </p>
      <p className="text-xs text-muted-foreground">
        Downloading for the <strong>{style}</strong> battlefield style. That style draws{" "}
        {variants.join(", ")}, so art downloaded for one style does not cover another.
      </p>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={everyStyle}
          onChange={(event) => setEveryStyle(event.target.checked)}
        />
        Cover every battlefield style (larger download)
      </label>
      <p className="text-xs text-muted-foreground">
        {stats
          ? `On disk: ${stats.files} image${stats.files === 1 ? "" : "s"}, ${formatBytes(stats.bytes)} — ${stats.pinnedFiles} of them downloaded on purpose (${formatBytes(stats.pinnedBytes)}).`
          : `Reading the cache\u2026`}
      </p>
      <p className="text-xs text-muted-foreground">
        {cards > 0
          ? `Card data: ${cards.toLocaleString()} cards, so this machine can play and host those offline.`
          : `No card data yet — without it a board with no internet stays blank however much art is cached.`}
      </p>
      {progress && (
        <p className="text-xs text-muted-foreground">
          {progress.done} of {progress.total} — {formatBytes(progress.bytes)} downloaded.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void downloadDecks()} disabled={busy !== null}>
          {busy === "decks"
            ? `Downloading\u2026`
            : `My decks (${decks.length}) · ~${formatBytes(estimateBytes(variants, deckCards.size))}`}
        </Button>
        {busy === "all" ? (
          <Button variant="outline" onClick={() => void cancelCardArtDownload()}>
            Stop
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => void downloadEverything()}
            disabled={busy !== null}
          >
            {`Every card · ~${formatBytes(estimateBytes(variants, ALL_CARDS_ESTIMATE))}`}
          </Button>
        )}
        <Button variant="outline" onClick={() => void clear(false)} disabled={busy !== null}>
          Trim unused
        </Button>
        <Button
          variant="destructive-quiet"
          onClick={() => void clear(true)}
          disabled={busy !== null}
        >
          Delete all
        </Button>
      </div>
    </div>
  );
}
