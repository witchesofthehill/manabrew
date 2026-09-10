import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ALL_BATTLEFIELD_STYLES,
  ALL_CARDS_ESTIMATE,
  cancelCardArtDownload,
  cardArtCacheAvailable,
  cardArtCacheStats,
  clearCardArtCache,
  deckArtUrls,
  downloadAllCardArt,
  estimateBytes,
  preseedCardArt,
  variantsForStyles,
  type BulkProgress,
  type CardArtCacheStats,
} from "@/api/cardArtCache";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
  const [everyStyle, setEveryStyle] = useState(false);
  const [busy, setBusy] = useState<"decks" | "all" | "clearing" | null>(null);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [available, setAvailable] = useState(false);
  const variants = variantsForStyles(everyStyle ? ALL_BATTLEFIELD_STYLES : [style]);
  const refresh = useCallback(() => {
    cardArtCacheStats()
      .then(setStats)
      .catch(() => setStats(null));
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
  async function downloadDecks() {
    setBusy("decks");
    try {
      const urls = [...new Set(decks.flatMap((saved) => deckArtUrls(saved.deck, variants)))];
      if (urls.length === 0) {
        toast.info(i18n._(msg`No decks to download art for yet.`));
        return;
      }
      const result = await preseedCardArt(urls);
      const downloaded = result.fetched + result.alreadyCached;
      const summary =
        downloaded === 1
          ? i18n._(msg`Art ready for one image`)
          : i18n._(msg`Art ready for ${downloaded} images`);
      toast.success(
        result.failed > 0
          ? i18n._(msg`${summary}, ${result.failed} could not be fetched`)
          : summary,
      );
      refresh();
    } catch (error) {
      toast.error(i18n._(msg`Could not download art: ${String(error)}`));
    } finally {
      setBusy(null);
    }
  }
  async function downloadEverything() {
    setBusy("all");
    setProgress(null);
    try {
      const result = await downloadAllCardArt(variants);
      const summary = i18n._(
        msg`Downloaded ${result.fetched}, already had ${result.alreadyCached}`,
      );
      toast.success(result.failed > 0 ? i18n._(msg`${summary}, ${result.failed} failed`) : summary);
      refresh();
    } catch (error) {
      toast.error(i18n._(msg`Could not download every card: ${String(error)}`));
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
      toast.error(i18n._(msg`Could not clear the art cache: ${String(error)}`));
    } finally {
      setBusy(null);
    }
  }
  const deckCards = new Set(decks.flatMap((saved) => saved.deck.cards.map((c) => c.identity.name)));
  return (
    <div className="rounded-lg border bg-card/40 p-4 space-y-3 max-w-xl">
      <Label>
        <Trans>Card Art On This Machine</Trans>
      </Label>
      <p className="text-xs text-muted-foreground">
        <Trans>
          Art is kept on disk once drawn, so a board does not fetch it twice. Downloading ahead of
          time is what lets you play with no internet at all, and a deliberate download is never
          dropped when the cache is trimmed for space.
        </Trans>
      </p>
      <p className="text-xs text-muted-foreground">
        <Trans>
          Downloading for the <strong>{style}</strong> battlefield style. That style draws{" "}
          {variants.join(", ")}, so art downloaded for one style does not cover another.
        </Trans>
      </p>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Trans>
          <input
            type="checkbox"
            checked={everyStyle}
            onChange={(event) => setEveryStyle(event.target.checked)}
          />
          Cover every battlefield style (larger download)
        </Trans>
      </label>
      <p className="text-xs text-muted-foreground">
        {stats
          ? i18n._(
              msg`On disk: ${stats.files} image${stats.files === 1 ? "" : "s"}, ${formatBytes(stats.bytes)} — ${stats.pinnedFiles} of them downloaded on purpose (${formatBytes(stats.pinnedBytes)}).`,
            )
          : i18n._(msg`Reading the cache\u2026`)}
      </p>
      {progress && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            {progress.done} of {progress.total} — {formatBytes(progress.bytes)} downloaded.
          </Trans>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void downloadDecks()} disabled={busy !== null}>
          {busy === "decks"
            ? i18n._(msg`Downloading\u2026`)
            : i18n._(
                msg`My decks (${decks.length}) · ~${formatBytes(estimateBytes(variants, deckCards.size))}`,
              )}
        </Button>
        {busy === "all" ? (
          <Button variant="outline" onClick={() => void cancelCardArtDownload()}>
            <Trans>Stop</Trans>
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => void downloadEverything()}
            disabled={busy !== null}
          >
            {i18n._(msg`Every card · ~${formatBytes(estimateBytes(variants, ALL_CARDS_ESTIMATE))}`)}
          </Button>
        )}
        <Button variant="outline" onClick={() => void clear(false)} disabled={busy !== null}>
          <Trans>Trim unused</Trans>
        </Button>
        <Button variant="destructive" onClick={() => void clear(true)} disabled={busy !== null}>
          <Trans>Delete all</Trans>
        </Button>
      </div>
    </div>
  );
}
