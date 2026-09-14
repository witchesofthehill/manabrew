import { useEffect, useState } from "react";

const objectUrls = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function loadSvgObjectUrl(url: string): Promise<string> {
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const promise = fetch(url, { mode: "cors", credentials: "omit" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrls.set(url, objectUrl);
      return objectUrl;
    })
    .finally(() => pending.delete(url));
  pending.set(url, promise);
  return promise;
}

// A CSS `mask-image: url()` is a no-cors load, which COEP require-corp blocks
// for a cross-origin file; a blob fetched with CORS is same-origin.
export function useSvgMaskUrl(url: string | undefined): string | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url || objectUrls.has(url)) return;
    let active = true;
    loadSvgObjectUrl(url)
      .then(() => {
        if (active) bump((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [url]);
  return url ? objectUrls.get(url) : undefined;
}
