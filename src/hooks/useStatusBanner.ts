import { useEffect } from "react";
import { platformFetch } from "@/lib/platformFetch";
import { getStatusBannerUrl } from "@/config/webRuntimeConfig";
import { useStatusBannerStore, type StatusNotification } from "@/stores/useStatusBannerStore";

const POLL_INTERVAL_MS = 60 * 1000;

function parseNotification(data: unknown): StatusNotification | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  if (raw.active === false) return null;
  if (typeof raw.id !== "string" || typeof raw.message !== "string") return null;
  if (raw.severity !== "info" && raw.severity !== "warning" && raw.severity !== "critical") {
    return null;
  }

  const link = raw.link as Record<string, unknown> | undefined;
  const hasLink = link && typeof link.label === "string" && typeof link.url === "string";

  return {
    id: raw.id,
    severity: raw.severity,
    message: raw.message,
    link: hasLink ? { label: link.label as string, url: link.url as string } : undefined,
  };
}

export function useStatusBanner() {
  const setCurrent = useStatusBannerStore((s) => s.setCurrent);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await platformFetch(getStatusBannerUrl(), { cache: "no-store" });
        if (cancelled) return;
        setCurrent(res.ok ? parseNotification(await res.json()) : null);
      } catch {
        // Network failure: keep the last known banner rather than flickering it off.
      }
    }

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [setCurrent]);
}
