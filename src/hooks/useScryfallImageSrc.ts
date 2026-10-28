import { useEffect, useState } from "react";
import { getPlatformType } from "@/platform";
import {
  isScryfallImageUrl,
  loadScryfallImage,
  peekScryfallImage,
} from "@/lib/scryfallImageSource";
import { cachedCardGlintAsset, offlineCacheAvailable } from "@/lib/cardGlintAssetCache";

export function useScryfallImageSrc(url: string | undefined): string | undefined {
  const native = !!url && getPlatformType() === "tauri" && isScryfallImageUrl(url);
  const eligible =
    !!url && (native || (offlineCacheAvailable() && (/^https?:/.test(url) || url.startsWith("/"))));
  const [resolved, setResolved] = useState<{ url: string; source: string }>();
  useEffect(() => {
    if (!eligible || !url) return;
    let active = true;
    void (async () => {
      const installed = native || (await cachedCardGlintAsset(url).catch(() => undefined));
      const source = installed ? await loadScryfallImage(url) : url;
      if (active) setResolved({ url, source });
    })().catch(() => {
      if (active) setResolved({ url, source: url });
    });
    return () => {
      active = false;
    };
  }, [url, eligible, native]);
  if (!eligible || !url) return url;
  return peekScryfallImage(url) ?? (resolved?.url === url ? resolved.source : undefined);
}
