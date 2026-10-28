import {
  canvasAssetUrls,
  canvasFontAssets,
  decodeCanvasImage,
  PLAIN_SECURITY_STAMP,
  type RenderedCardInput,
} from "card-glint/magic/presentation";
import { isSemanticLayout, semanticCardAssetUrls } from "@/lib/cardSemanticLayout";
import { semanticFrame, VANGUARD_FONT_ASSET } from "@/lib/cardSemanticFrames";
import type { ScryfallImageUris } from "@/types/scryfall";
import { MANA_CODES } from "@/types/scryfall";
import { manaSymbolUrl } from "@/api/scryfall";
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import type { Deck, DeckCard } from "@/protocol/deck";
import {
  peekArchivedToken,
  prefetchTokenArchive,
  useScryfallStore,
} from "@/stores/useScryfallStore";
import { captureCardInput, prepareCard } from "@/lib/cardRenderSnapshot";
import { cardGlintFace } from "@/lib/cardRenderFace";
import { CardRenderError } from "@/lib/cardRenderDecision";
import { resolveCardGlintAsset } from "@/lib/cardGlintAssets";
import {
  CARD_GLINT_CACHE,
  CARD_GLINT_MANIFEST_CACHE,
  CARD_GLINT_RECORD_CACHE,
  offlineCacheAvailable,
  offlineCacheKey,
  storeOfflineCardRecord,
} from "@/lib/cardGlintAssetCache";
const RENDERER_FONT_ASSETS = [...canvasFontAssets, VANGUARD_FONT_ASSET];

interface OfflineManifest {
  fingerprint: string;
  urls: string[];
  records: string[];
  bytes: number;
  scanOnly: number;
  installedAt: number;
}

export interface CardGlintOfflineStatus {
  ready: boolean;
  missing: number;
  manifest?: OfflineManifest;
}

export interface OfflineInstallState {
  phase: "idle" | "preparing" | "downloading" | "complete" | "cancelled" | "failed" | "clearing";
  done: number;
  total: number;
  bytes: number;
  message?: string;
}

let state: OfflineInstallState = { phase: "idle", done: 0, total: 0, bytes: 0 };
const listeners = new Set<() => void>();
let controller: AbortController | undefined;
let running: Promise<void> | undefined;

export const getCardGlintInstallState = () => state;
export function subscribeCardGlintInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function update(value: OfflineInstallState) {
  state = value;
  for (const listener of listeners) listener();
}

function deckCards(deck: Deck): DeckCard[] {
  return [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.commanders ?? []),
    ...(deck.companion ? [deck.companion] : []),
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...(deck.tokens ?? []),
    ...(deck.maybeboard ?? []),
  ];
}

async function fingerprint(deck: Deck): Promise<string> {
  const input = JSON.stringify([
    CARD_GLINT_CACHE,
    useScryfallStore.getState().locale,
    deckCards(deck),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function cardGlintOfflineStatus(deck: Deck): Promise<CardGlintOfflineStatus> {
  if (!offlineCacheAvailable()) return { ready: false, missing: 0 };
  const key = await fingerprint(deck);
  const response = await (
    await caches.open(CARD_GLINT_MANIFEST_CACHE)
  ).match(offlineCacheKey("manifest", key));
  if (!response) return { ready: false, missing: 0 };
  const manifest = (await response.json()) as OfflineManifest;
  const assets = await caches.open(CARD_GLINT_CACHE);
  const records = await caches.open(CARD_GLINT_RECORD_CACHE);
  let missing = 0;
  for (const url of manifest.urls) if (!(await assets.match(url))) missing += 1;
  for (const url of manifest.records) if (!(await records.match(url))) missing += 1;
  return { ready: missing === 0 && manifest.fingerprint === key, missing, manifest };
}

export function cancelCardGlintInstall(): void {
  controller?.abort(new DOMException("Download cancelled", "AbortError"));
}

export function installCardGlintDeck(deck: Deck): Promise<void> {
  if (running || state.phase === "clearing")
    return Promise.reject(new Error("Another renderer cache operation is running"));
  controller = new AbortController();
  const signal = controller.signal;
  running = install(deck, signal)
    .catch((error: unknown) => {
      update({ ...state, phase: signal.aborted ? "cancelled" : "failed", message: String(error) });
    })
    .finally(() => {
      controller = undefined;
      running = undefined;
    });
  return running;
}

function waitForInstall<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function magicAssetUrls(face: RenderedCardInput): string[] {
  const common = (value: RenderedCardInput): RenderedCardInput => ({
    ...value,
    rarity: "common",
    faces: value.faces?.map(common),
  });
  return [
    ...new Set(
      [...canvasAssetUrls(face), ...canvasAssetUrls(common(face)), PLAIN_SECURITY_STAMP].filter(
        (url): url is string => Boolean(url),
      ),
    ),
  ];
}

async function install(deck: Deck, signal: AbortSignal): Promise<void> {
  if (!offlineCacheAvailable())
    throw new Error("Persistent storage requires a secure browser context");
  const snapshot = structuredClone(deck);
  const locale = useScryfallStore.getState().locale;
  const key = await fingerprint(snapshot);
  const manifests = await caches.open(CARD_GLINT_MANIFEST_CACHE);
  await manifests.delete(offlineCacheKey("manifest", key));
  update({ phase: "preparing", done: 0, total: 0, bytes: 0 });
  const urls = new Set<string>(canvasFontAssets.map((font) => font.url));
  for (const code of MANA_CODES) urls.add(manaSymbolUrl(code));
  urls.add(CARD_BACK_IMAGE_URL);
  const records = new Set<string>();
  const unique = new Map(deckCards(snapshot).map((card) => [JSON.stringify(card), card]));
  let scanOnly = 0;
  const addUrl = (url: string | undefined) => {
    if (url) urls.add(url);
  };
  const addImages = (uris: ScryfallImageUris | undefined) => {
    if (uris) for (const url of Object.values(uris)) addUrl(url);
  };
  for (const card of unique.values()) {
    signal.throwIfAborted();
    update({ ...state, message: card.identity.name });
    let printing = card.identity;
    if (card.identity.tokenScript || card.layout?.includes("token")) {
      await waitForInstall(
        prefetchTokenArchive().catch(() => undefined),
        signal,
      );
      const archived =
        peekArchivedToken({ id: card.identity.id }) ??
        peekArchivedToken({ tokenScript: card.identity.tokenScript }) ??
        peekArchivedToken({
          setCode: card.identity.setCode,
          cardNumber: card.identity.cardNumber,
        }) ??
        peekArchivedToken({ name: card.identity.name });
      printing = archived?.identity ?? printing;
    }
    const lookup = {
      name: printing.name,
      setCode: printing.setCode || undefined,
      collectorNumber: printing.cardNumber || undefined,
    };
    const entry = await waitForInstall(useScryfallStore.getState().getCard(lookup), signal);
    signal.throwIfAborted();
    if (useScryfallStore.getState().locale !== locale)
      throw new Error("Language changed during installation. Download again.");
    for (const recordUrl of await storeOfflineCardRecord(lookup, locale, entry))
      records.add(recordUrl);
    addImages(card.uris);
    addImages(card.backFace?.uris);
    for (const info of [entry.info, entry.imageInfo]) {
      addImages(info?.image_uris);
      for (const face of info?.card_faces ?? []) addImages(face.image_uris);
    }
    const first = captureCardInput({ deckCard: card });
    try {
      const prepared = await waitForInstall(prepareCard(first), signal);
      const faces = [prepared];
      if (!prepared.combined && (prepared.snapshot.card_faces?.length ?? 0) > 1) {
        faces.push(
          await waitForInstall(
            prepareCard(captureCardInput({ deckCard: card, faceIndex: 1 })),
            signal,
          ),
        );
      }
      for (const preparedFace of faces) {
        const { face } = cardGlintFace(preparedFace, true);
        if (face.layout === "vanguard" && semanticFrame(face).vanguard === "paper")
          addUrl(VANGUARD_FONT_ASSET.url);
        const required = isSemanticLayout(face)
          ? semanticCardAssetUrls(face)
          : magicAssetUrls(face);
        for (const url of required) if (url) addUrl(url);
      }
    } catch (error) {
      if (!(error instanceof CardRenderError) || error.decision.mode !== "original") throw error;
      scanOnly += 1;
    }
  }
  if (useScryfallStore.getState().locale !== locale)
    throw new Error("Language changed during installation. Download again.");
  for (const entry of Object.values(useScryfallStore.getState().cards)) {
    if (!entry.card) continue;
    signal.throwIfAborted();
    for (const recordUrl of await storeOfflineCardRecord(
      { id: entry.card.info.id },
      locale,
      entry.card,
    ))
      records.add(recordUrl);
  }
  const assets = await caches.open(CARD_GLINT_CACHE);
  let bytes = 0;
  let done = 0;
  update({ phase: "downloading", done, total: urls.size, bytes });
  for (const url of urls) {
    signal.throwIfAborted();
    const response = await resolveCardGlintAsset(url, { signal });
    const blob = await response.blob();
    if (blob.size === 0 || blob.type.includes("text/html"))
      throw new Error(`Invalid renderer asset: ${url}`);
    const font = RENDERER_FONT_ASSETS.find((candidate) => candidate.url === url);
    if (font) {
      await new FontFace(font.family, await blob.arrayBuffer(), {
        weight: font.weight,
        style: font.style,
      }).load();
    } else {
      const image = await decodeCanvasImage(blob, signal);
      image.close();
    }
    signal.throwIfAborted();
    await assets.put(url, new Response(blob));
    bytes += blob.size;
    done += 1;
    update({ phase: "downloading", done, total: urls.size, bytes });
  }
  signal.throwIfAborted();
  if (useScryfallStore.getState().locale !== locale)
    throw new Error("Language changed during installation. Download again.");
  const manifest: OfflineManifest = {
    fingerprint: key,
    urls: [...urls],
    records: [...records],
    bytes,
    scanOnly,
    installedAt: Date.now(),
  };
  await manifests.put(offlineCacheKey("manifest", key), Response.json(manifest));
  if (signal.aborted) {
    await manifests.delete(offlineCacheKey("manifest", key));
    signal.throwIfAborted();
  }
  update({ phase: "complete", done, total: urls.size, bytes });
}

export async function clearCardGlintOffline(): Promise<void> {
  cancelCardGlintInstall();
  await running;
  update({ phase: "clearing", done: 0, total: 0, bytes: 0 });
  try {
    await Promise.all(
      [CARD_GLINT_CACHE, CARD_GLINT_RECORD_CACHE, CARD_GLINT_MANIFEST_CACHE].map((name) =>
        caches.delete(name),
      ),
    );
    update({ phase: "idle", done: 0, total: 0, bytes: 0 });
  } catch (error) {
    update({ ...state, phase: "failed", message: String(error) });
  }
}
