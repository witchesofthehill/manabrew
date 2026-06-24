export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(/[.+-]/);
  const pb = normalizeVersion(b).split(/[.+-]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const sa = pa[i] ?? "";
      const sb = pb[i] ?? "";
      if (sa === sb) continue;
      return sa < sb ? -1 : 1;
    }
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
