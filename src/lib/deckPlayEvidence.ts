import { fetchDeckHubEntry, HubRequestError, recordDeckPlay } from "@/api/hub";
import { isFeatureEnabled } from "@/featureFlags";
import { getDeckEvidenceFingerprint } from "@/lib/deckFingerprint";
import { STORAGE_KEYS } from "@/lib/constants";
import type { Deck } from "@/protocol/deck";

interface PendingDeckPlayReport {
  reportId: string;
  entryRef: string;
  deckFingerprint: string;
  format?: Deck["format"];
  queuedAt: number;
}

const MAX_PENDING_REPORTS = 500;
const MAX_REPORT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REPORTS_PER_FLUSH = 20;
let flushPromise: Promise<void> | null = null;

function loadPendingReports(): PendingDeckPlayReport[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEYS.DECK_PLAY_REPORTS) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingDeckPlayReport =>
        typeof item === "object" &&
        item !== null &&
        typeof item.reportId === "string" &&
        typeof item.entryRef === "string" &&
        typeof item.deckFingerprint === "string" &&
        typeof item.queuedAt === "number",
    );
  } catch {
    return [];
  }
}

function savePendingReports(reports: PendingDeckPlayReport[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.DECK_PLAY_REPORTS, JSON.stringify(reports));
  } catch {
    return;
  }
}

function removeReport(reports: PendingDeckPlayReport[], reportId: string): PendingDeckPlayReport[] {
  return reports.filter((report) => report.reportId !== reportId);
}

async function flushPendingReports(): Promise<void> {
  const cutoff = Date.now() - MAX_REPORT_AGE_MS;
  let reports = loadPendingReports().filter((report) => report.queuedAt >= cutoff);
  savePendingReports(reports);
  for (const report of reports.slice(0, MAX_REPORTS_PER_FLUSH)) {
    try {
      const entry = await fetchDeckHubEntry(report.entryRef);
      if ((await getDeckEvidenceFingerprint(entry.deck)) !== report.deckFingerprint) {
        reports = removeReport(reports, report.reportId);
        savePendingReports(reports);
        continue;
      }
      await recordDeckPlay({
        reportId: report.reportId,
        deckhubEntryId: entry.id,
        deckFingerprint: report.deckFingerprint,
        format: report.format,
      });
      reports = removeReport(reports, report.reportId);
      savePendingReports(reports);
    } catch (error) {
      if (error instanceof HubRequestError && (error.status === 404 || error.status === 422)) {
        reports = removeReport(reports, report.reportId);
        savePendingReports(reports);
        continue;
      }
      break;
    }
  }
}

export function flushPublishedDeckPlayReports(): Promise<void> {
  if (!isFeatureEnabled("deckHub")) return Promise.resolve();
  if (flushPromise) return flushPromise;
  flushPromise = flushPendingReports().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export async function reportPublishedDeckPlay(entryRef: string, deck: Deck): Promise<void> {
  if (!isFeatureEnabled("deckHub")) return;
  try {
    const deckFingerprint = await getDeckEvidenceFingerprint(deck);
    const reports = loadPendingReports();
    reports.push({
      reportId: crypto.randomUUID(),
      entryRef,
      deckFingerprint,
      format: deck.format,
      queuedAt: Date.now(),
    });
    savePendingReports(reports.slice(-MAX_PENDING_REPORTS));
    await flushPublishedDeckPlayReports();
  } catch {
    return;
  }
}
