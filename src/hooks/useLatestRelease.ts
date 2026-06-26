import { useCallback, useEffect, useState } from "react";
import { APP_VERSION, GITHUB_LATEST_RELEASE_API } from "@/lib/constants";
import { isNewerVersion, normalizeVersion } from "@/lib/version";
import { platformFetch } from "@/lib/platformFetch";

interface GithubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

export interface LatestRelease {
  version: string;
  htmlUrl: string;
  isNewer: boolean;
}

export type ReleaseStatus = "checking" | "current" | "outdated" | "error";

export interface UseLatestReleaseResult {
  status: ReleaseStatus;
  latest: LatestRelease | null;
  check: () => void;
}

function fetchLatest(): Promise<LatestRelease> {
  return platformFetch(GITHUB_LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const data = (await res.json()) as GithubRelease;
    const version = normalizeVersion(data.tag_name);
    return { version, htmlUrl: data.html_url, isNewer: isNewerVersion(version, APP_VERSION) };
  });
}

export function useLatestRelease(): UseLatestReleaseResult {
  const [status, setStatus] = useState<ReleaseStatus>("checking");
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [nonce, setNonce] = useState(0);

  const check = useCallback(() => {
    setStatus("checking");
    setLatest(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLatest()
      .then((release) => {
        if (cancelled) return;
        setLatest(release);
        setStatus(release.isNewer ? "outdated" : "current");
      })
      .catch(() => {
        if (cancelled) return;
        setLatest(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { status, latest, check };
}
