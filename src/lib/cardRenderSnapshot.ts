import type { CardSnapshot } from "@/lib/cardRenderTypes";
import type { CardDto } from "@/protocol/game";
import type { CardCosmetics, DeckCard } from "@/protocol/deck";
import { normalizeCardCosmetics } from "@/lib/cardCosmetics";
import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import type { ScryfallLanguage } from "@/i18n/locales";
import { cardTypeLine, replaceCardName } from "@/components/game/cardPresentation";
import { cardFaceImageUris } from "@/lib/cardImage";
import { resolveCardFaces } from "@/lib/cardFaces";
import { isTwoHalfLayout } from "@/lib/cardLayout";
import { CARD_ARTWORK_FACE_FRAGMENT } from "@/lib/cardRenderArtwork";
import { CardArtworkError, CardRenderError } from "@/lib/cardRenderDecision";
import { hasIntegratedArtwork } from "@/lib/cardArtworkPrinting";
import { previewDtoDeckCard } from "@/lib/scryfall.utils";
import { localizeRulesPreviewText } from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import {
  peekArchivedToken,
  prefetchTokenArchive,
  useScryfallStore,
  type ScryfallEntry,
} from "@/stores/useScryfallStore";

export interface CardRenderRequest {
  card?: CardDto;
  deckCard?: DeckCard;
  faceIndex?: 0 | 1;
}

interface LiveCard {
  name: string;
  setCode: string;
  cardNumber: string;
  tokenScript?: string;
  isToken: boolean;
  isCopy: boolean;
  isTransformed: boolean;
  isDoubleFaced: boolean;
  manaCost: string;
  typeLine: string;
  rulesText: string;
  colors: string[];
  keywords: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
}

export interface CardRenderInput {
  readonly card?: LiveCard;
  readonly deckCard?: DeckCard;
  readonly faceIndex?: 0 | 1;
  readonly locale: ScryfallLanguage;
  readonly cosmetics?: CardCosmetics;
}

export interface CardFaceSnapshot {
  name: string;
  layout?: string;
  type_line: string;
  type_line_display: string;
  oracle_text: string;
  mana_cost: string;
  colors?: string[];
  color_indicator?: string[];
  color_identity?: string[];
  produced_mana?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  flavor_text?: string;
  hand_modifier?: string;
  artist?: string;
  life_modifier?: string;
}

export interface PreparedCard {
  snapshot: CardSnapshot;
  artUrls: (string | undefined)[];
  faceIndex: 0 | 1;
  combined: boolean;
  locale: ScryfallLanguage;
  cosmetics?: CardCosmetics;
}

type CardEntry = NonNullable<ScryfallEntry["card"]>;
type PrintedFace = ScryfallCard | NonNullable<ScryfallCard["card_faces"]>[number];

function typeLine(card: DeckCard): string {
  const main = [...(card.supertypes ?? []), ...(card.types ?? [])].join(" ");
  return card.subtypes?.length ? `${main} — ${card.subtypes.join(" ")}` : main;
}

function colorCodes(value: string): string[] {
  const codes: string[] = value.toUpperCase().match(/[WUBRG]/g) ?? [];
  return codes.filter((code, index) => codes.indexOf(code) === index);
}

function normalizedManaCost(cost: string | undefined): string {
  const value = cost?.trim() ?? "";
  if (!value || value === "no cost") return "";
  return value.includes("{")
    ? value
    : value
        .split(/\s+/)
        .map((symbol) => `{${symbol}}`)
        .join("");
}

export function captureCardInput(request: CardRenderRequest): CardRenderInput {
  const { card, faceIndex } = request;
  if (card && (card.isFaceDown || ("visibility" in card && card.visibility === "hidden"))) {
    throw new Error("Hidden cards cannot be rendered as generated faces");
  }
  const previewDeck = card ? previewDtoDeckCard(card) : undefined;
  const deckCard = request.deckCard ?? previewDeck;
  if (!card?.identity?.name && !deckCard?.identity?.name) {
    throw new Error("Card rendering requires a visible card identity");
  }
  const emptyCounter = card && "zoneId" in card && card.zoneId === "battlefield" ? "0" : undefined;
  const live: LiveCard | undefined =
    card && !previewDeck
      ? {
          name: card.identity.name,
          setCode: card.identity.setCode,
          cardNumber: card.identity.cardNumber,
          tokenScript: card.identity.tokenScript,
          isToken: card.identity.isToken,
          isCopy: card.isCopy,
          isTransformed: card.isTransformed,
          isDoubleFaced: card.isDoubleFaced,
          manaCost: normalizedManaCost(card.effectiveManaCost ?? card.manaCost),
          typeLine: cardTypeLine(card),
          rulesText: replaceCardName(card.text, card.identity.name),
          colors: colorCodes(card.color),
          keywords: [...card.keywords],
          power: card.power ?? undefined,
          toughness: card.toughness ?? undefined,
          loyalty: card.counters.Loyalty == null ? emptyCounter : String(card.counters.Loyalty),
          defense: card.counters.Defense == null ? emptyCounter : String(card.counters.Defense),
        }
      : undefined;
  return Object.freeze({
    card: live && Object.freeze(live),
    deckCard: deckCard ? structuredClone(deckCard) : undefined,
    faceIndex,
    locale: useScryfallStore.getState().locale,
    cosmetics: normalizeCardCosmetics(card ? card.cosmetics : deckCard?.identity.cosmetics),
  });
}

async function printingFor(input: CardRenderInput): Promise<{
  entry?: CardEntry;
  deckCard?: DeckCard;
}> {
  let deckCard = input.deckCard;
  if (
    input.card?.isCopy &&
    deckCard &&
    !deckCard.identity.name.split(" // ").includes(input.card.name) &&
    deckCard.backFace?.name !== input.card.name
  ) {
    deckCard = undefined;
  }
  const identity = input.card ?? deckCard?.identity;
  if (!identity) return {};
  const token =
    input.card?.isToken || deckCard?.identity.tokenScript || deckCard?.layout?.includes("token");
  let copiedToken = false;
  if (token) {
    await prefetchTokenArchive().catch(() => undefined);
    const archived =
      (deckCard?.identity.id ? peekArchivedToken({ id: deckCard.identity.id }) : null) ??
      peekArchivedToken({
        tokenScript: input.card?.tokenScript ?? deckCard?.identity.tokenScript,
      }) ??
      (input.card?.isCopy
        ? null
        : peekArchivedToken({ setCode: identity.setCode, cardNumber: identity.cardNumber })) ??
      peekArchivedToken({ name: identity.name });
    if (archived) deckCard = archived;
    else if (!input.card?.isCopy) return { deckCard };
    else copiedToken = true;
  }
  const printing = copiedToken ? identity : (deckCard?.identity ?? identity);
  try {
    const id =
      !copiedToken && (token || !printing.setCode || !printing.cardNumber)
        ? deckCard?.identity.id
        : undefined;
    const entry = await useScryfallStore.getState().getCard(
      id
        ? { id }
        : {
            name: printing.name,
            setCode: copiedToken ? undefined : printing.setCode || undefined,
            collectorNumber: copiedToken ? undefined : printing.cardNumber || undefined,
          },
    );
    return { entry, deckCard };
  } catch {
    return { deckCard };
  }
}

function stringList(record: object | undefined, key: string): string[] | undefined {
  if (!record || !(key in record)) return undefined;
  const value: unknown = Reflect.get(record, key);
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function stringField(record: object | undefined, key: string): string | undefined {
  if (!record || !(key in record)) return undefined;
  const value: unknown = Reflect.get(record, key);
  return typeof value === "string" ? value : undefined;
}

function withoutReminder(text: string): string {
  let depth = 0;
  let result = "";
  for (const character of text) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) result += character;
  }
  return result;
}

function normalized(text: string): string {
  return withoutReminder(text).replace(/[—–]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

function liveRules(card: LiveCard, info: ScryfallCard | undefined, index: number): string {
  const canonical = info?.card_faces?.[index]?.oracle_text ?? info?.oracle_text ?? "";
  const lines = canonical.split("\n").map(normalized);
  const rules = card.rulesText
    .split("\n")
    .map((line) =>
      lines.includes(normalized(line)) ? localizeRulesPreviewText(line, info ?? null, index) : line,
    );
  const visible = withoutReminder(card.rulesText)
    .split(/[\n,;•]/)
    .map((line) => normalized(line).replace(/[.\s]+$/, ""));
  for (const keyword of card.keywords) {
    const label = normalized(keyword).replace(/[.\s]+$/, "");
    if (label && !visible.includes(label) && !rules.some((line) => normalized(line) === label)) {
      rules.push(keyword);
    }
  }
  return rules.join("\n");
}

function faceSnapshot(
  face: PrintedFace | undefined,
  deckCard: DeckCard | undefined,
  index: number,
): CardFaceSnapshot {
  const back = index === 1 ? deckCard?.backFace : undefined;
  const canonicalType = face?.type_line ?? back?.typeLine ?? (deckCard ? typeLine(deckCard) : "");
  return {
    name: face?.printed_name ?? face?.name ?? back?.name ?? deckCard?.identity.name ?? "",
    layout: stringField(face, "layout"),
    type_line: canonicalType,
    type_line_display: face?.printed_type_line ?? canonicalType,
    oracle_text:
      face?.printed_text ?? face?.oracle_text ?? back?.oracleText ?? deckCard?.text ?? "",
    mana_cost: normalizedManaCost(
      face?.mana_cost ?? back?.manaCost ?? (index === 0 ? deckCard?.manaCost : ""),
    ),
    colors:
      stringList(face, "colors") ??
      (index === 0 && deckCard ? colorCodes(deckCard.color ?? "") : undefined),
    color_indicator: stringList(face, "color_indicator"),
    color_identity:
      stringList(face, "color_identity") ??
      (index === 0 ? deckCard?.colorIdentity && [...deckCard.colorIdentity] : undefined),
    produced_mana: stringList(face, "produced_mana"),
    power: face?.power ?? back?.power ?? (index === 0 ? deckCard?.power : undefined),
    toughness:
      face?.toughness ?? back?.toughness ?? (index === 0 ? deckCard?.toughness : undefined),
    loyalty: face?.loyalty,
    defense: face?.defense,
    flavor_text: face?.flavor_text,
    artist: stringField(face, "artist"),
    hand_modifier: stringField(face, "hand_modifier"),
    life_modifier: stringField(face, "life_modifier"),
  };
}

function applyLiveFace(
  face: CardFaceSnapshot,
  card: LiveCard,
  info: ScryfallCard | undefined,
  index: number,
): CardFaceSnapshot {
  const printed = info?.card_faces?.[index] ?? info;
  return {
    ...face,
    name:
      normalized(card.name) === normalized(printed?.name ?? "") ||
      (Boolean(info?.card_faces?.length) &&
        normalized(card.name) === normalized(info?.name ?? "")) ||
      (card.isTransformed &&
        normalized(card.name) === normalized(info?.card_faces?.[0]?.name ?? ""))
        ? face.name
        : card.name,
    type_line: card.typeLine,
    type_line_display:
      normalized(card.typeLine) === normalized(printed?.type_line ?? "")
        ? face.type_line_display
        : card.typeLine,
    oracle_text: liveRules(card, info, index),
    mana_cost: card.manaCost,
    colors: [...card.colors],
    power: card.power,
    toughness: card.toughness,
    loyalty: /\bPlaneswalker\b/i.test(card.typeLine) ? (card.loyalty ?? face.loyalty) : undefined,
    defense: /\bBattle\b/i.test(card.typeLine) ? (card.defense ?? face.defense) : undefined,
  };
}

function artUris(
  entry: CardEntry | undefined,
  deckCard: DeckCard | undefined,
  index: number,
): ScryfallImageUris | undefined {
  const stored = index === 0 ? deckCard?.uris : deckCard?.backFace?.uris;
  if (index > 0 && !entry?.info.card_faces?.[index]) return stored;
  return entry
    ? cardFaceImageUris(entry.info, stored ?? entry.uris, index, entry.imageInfo)
    : stored;
}

export async function prepareCard(input: CardRenderInput): Promise<PreparedCard> {
  const { entry, deckCard } = await printingFor(input);
  const info = entry?.info;
  const printingLayout =
    info?.layout ??
    deckCard?.layout ??
    (input.card?.isDoubleFaced
      ? input.card.isToken
        ? "double_faced_token"
        : "transform"
      : input.card?.isToken
        ? "token"
        : "normal");
  const layout =
    printingLayout === "split" &&
    /\bRoom\b/.test(
      info?.type_line ?? (deckCard ? typeLine(deckCard) : (input.card?.typeLine ?? "")),
    )
      ? "room"
      : printingLayout;
  const meldResult =
    layout === "meld"
      ? info?.all_parts?.find((part) => part.component === "meld_result" && part.id !== info.id)
      : undefined;
  const reverse = meldResult
    ? await useScryfallStore
        .getState()
        .getCard({ id: meldResult.id })
        .catch(() => undefined)
    : undefined;
  if (meldResult && !reverse)
    throw new CardRenderError(
      { mode: "original", reason: "invalid-faces", layout, faceIndex: input.faceIndex ?? 0 },
      "The meld result metadata is unavailable",
    );
  const faceInfo = reverse && info ? { ...info, card_faces: [info, reverse.info] } : info;
  const resolved = resolveCardFaces(faceInfo);
  const combined =
    isTwoHalfLayout(layout) || layout === "adventure" || layout === "prepare" || layout === "flip";
  const flippable =
    resolved.isFlippable ||
    Boolean(deckCard?.backFace) ||
    input.card?.isDoubleFaced ||
    deckCard?.isDoubleFaced;
  const faceIndex = combined ? 0 : (input.faceIndex ?? (input.card?.isTransformed ? 1 : 0));
  if (faceIndex === 1 && !flippable)
    throw new CardRenderError(
      { mode: "original", reason: "invalid-faces", layout, faceIndex },
      "This card has no reverse face",
    );
  if (input.card?.isTransformed && faceIndex === 0 && !info && !deckCard) {
    throw new CardRenderError(
      { mode: "original", reason: "invalid-faces", layout, faceIndex },
      "The original face is unavailable",
    );
  }
  const faces = (
    faceInfo?.card_faces?.length
      ? faceInfo.card_faces
      : deckCard?.backFace
        ? [undefined, undefined]
        : [info]
  ).map((face, index) => faceSnapshot(face, deckCard, index));
  if (combined && faces.length < 2)
    throw new CardRenderError(
      { mode: "original", reason: "invalid-faces", layout, faceIndex },
      "Multipart card metadata is unavailable",
    );
  if (faces.length > 2 || (faces.length > 1 && !combined && !flippable)) {
    throw new CardRenderError(
      { mode: "original", reason: "invalid-faces", layout, faceIndex },
      `Generated rendering cannot represent all parts of the ${layout} layout`,
    );
  }
  const selectedLayout = faces[faceIndex]?.layout;
  if (
    layout === "reversible_card" &&
    (isTwoHalfLayout(selectedLayout) ||
      selectedLayout === "adventure" ||
      selectedLayout === "prepare" ||
      selectedLayout === "flip")
  ) {
    throw new CardRenderError(
      {
        mode: "original",
        reason: "unrepresentable-fields",
        layout: selectedLayout ?? layout,
        faceIndex,
      },
      "The reversible face is missing its multipart card metadata",
    );
  }
  if (faceIndex >= faces.length) {
    if (input.card?.isTransformed && faceIndex === 1)
      faces.push(faceSnapshot(undefined, undefined, 1));
    else
      throw new CardRenderError(
        { mode: "original", reason: "invalid-faces", layout, faceIndex },
        "The requested card face is unavailable",
      );
  }
  if (input.card) {
    const liveIndex = input.card.isTransformed ? 1 : 0;
    if (combined) {
      const selected =
        faceInfo?.card_faces?.findIndex(
          (face) => normalized(face.name) === normalized(input.card!.name),
        ) ?? -1;
      if (selected >= 0)
        faces[selected] = applyLiveFace(faces[selected]!, input.card, faceInfo, selected);
    } else if (faces[liveIndex]) {
      faces[liveIndex] = applyLiveFace(faces[liveIndex]!, input.card, faceInfo, liveIndex);
    }
  }
  for (const face of faces) {
    if (face.colors) Object.freeze(face.colors);
    if (face.color_indicator) Object.freeze(face.color_indicator);
    if (face.color_identity) Object.freeze(face.color_identity);
    if (face.produced_mana) Object.freeze(face.produced_mana);
    Object.freeze(face);
  }
  Object.freeze(faces);
  const snapshot: CardSnapshot = {
    ...faces[0]!,
    layout,
    card_faces: faces.length > 1 ? faces : undefined,
    color_identity: info?.color_identity
      ? [...info.color_identity]
      : deckCard?.colorIdentity
        ? [...deckCard.colorIdentity]
        : undefined,
    keywords: input.card
      ? [...input.card.keywords]
      : info?.keywords
        ? [...info.keywords]
        : deckCard?.keywords
          ? [...deckCard.keywords]
          : undefined,
    rarity: info?.rarity,
    set: info?.set ?? deckCard?.identity.setCode ?? input.card?.setCode,
    collector_number:
      info?.collector_number ?? deckCard?.identity.cardNumber ?? input.card?.cardNumber,
    frame: info?.frame,
    frame_effects: stringList(info, "frame_effects"),
    border_color: info?.border_color,
    security_stamp: stringField(info, "security_stamp"),
    full_art: info?.full_art,
    textless: info?.textless,
    promo_types: stringList(info, "promo_types"),
    lang: info?.lang ?? deckCard?.imageLanguage ?? input.locale,
    released_at: info?.released_at,
    artist: info?.artist,
  };
  for (const value of Object.values(snapshot)) if (Array.isArray(value)) Object.freeze(value);
  const scanBacked = layout === "art_series" || layout === "front_card";
  const artUrls = faces.map((_, index) => {
    const uris =
      index === 1 && reverse ? artUris(reverse, undefined, 0) : artUris(entry, deckCard, index);
    return (scanBacked ? (uris?.png ?? uris?.large ?? uris?.normal) : uris?.art_crop) || undefined;
  });
  if (info && hasIntegratedArtwork(info)) {
    throw new CardArtworkError(layout, faceIndex);
  }
  if (isTwoHalfLayout(layout) && artUrls[0] && artUrls[0] === artUrls[1]) {
    const source = artUrls[0];
    artUrls[0] = `${source}${CARD_ARTWORK_FACE_FRAGMENT}0`;
    artUrls[1] = `${source}${CARD_ARTWORK_FACE_FRAGMENT}1`;
  }
  return {
    snapshot: Object.freeze(snapshot),
    artUrls,
    faceIndex,
    combined,
    locale: input.locale,
    cosmetics: input.cosmetics,
  };
}
