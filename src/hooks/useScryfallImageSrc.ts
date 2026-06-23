import { useEffect, useState } from "react";
import { getPlatformType } from "@/platform";
import {
  isScryfallImageUrl,
  loadScryfallImage,
  peekScryfallImage,
} from "@/lib/scryfallImageSource";

export function useScryfallImageSrc(url: string | undefined): string | undefined {
  const eligible = !!url && getPlatformType() === "tauri" && isScryfallImageUrl(url);
  const [, bumpOnLoad] = useState(0);
  useEffect(() => {
    if (!eligible || peekScryfallImage(url!)) return;
    let active = true;
    loadScryfallImage(url!)
      .then(() => {
        if (active) bumpOnLoad((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [url, eligible]);
  return eligible ? peekScryfallImage(url!) : url;
}
