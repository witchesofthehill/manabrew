export type CollectionImportSource = "manabox" | "moxfield" | "archidekt" | "generic";

export interface CollectionImportMapping {
  nameColumn: number | null;
  quantityColumn: number | null;
  setColumn: number | null;
  collectorNumberColumn: number | null;
  foilColumn: number | null;
}

export interface ParsedCollectionFile {
  delimiter: string;
  headers: string[];
  rows: string[][];
  source: CollectionImportSource;
  mapping: CollectionImportMapping;
}

export interface CollectionImportPreviewRow {
  rowNumber: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  foil?: boolean;
  quantity: number;
  valid: boolean;
  reason?: string;
}

const NAME_ALIASES = ["card name", "name", "card", "cardname"];
const QUANTITY_ALIASES = ["quantity", "qty", "count", "amount", "regular", "copies"];
const SET_ALIASES = ["set code", "set", "edition code", "edition"];
const COLLECTOR_NUMBER_ALIASES = ["collector number", "collector #", "card number", "number"];
const FOIL_ALIASES = ["foil", "finish", "printing finish"];

function parseFoil(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1", "foil", "etched"].includes(normalized)) return true;
  if (["false", "no", "0", "nonfoil", "non-foil", "normal", "regular"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function delimiterScore(text: string, delimiter: string): number {
  const rows = parseDelimited(text, delimiter).slice(0, 12);
  if (rows.length === 0) return 0;
  const widths = rows.map((row) => row.length);
  const width = Math.max(...widths);
  return width > 1 ? widths.filter((value) => value === width).length * width : 0;
}

function detectDelimiter(text: string): string {
  return [",", "\t", ";"].sort(
    (left, right) => delimiterScore(text, right) - delimiterScore(text, left),
  )[0];
}

function findColumn(headers: string[], aliases: string[]): number | null {
  const index = headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
  return index >= 0 ? index : null;
}

function detectSource(headers: string[]): CollectionImportSource {
  const normalized = new Set(headers.map(normalizeHeader));
  if (normalized.has("binder name") || normalized.has("purchase price")) return "manabox";
  if (normalized.has("moxfield id") || normalized.has("tradelist count")) return "moxfield";
  if (
    normalized.has("collection status") ||
    normalized.has("archidekt id") ||
    normalized.has("edition code")
  ) {
    return "archidekt";
  }
  return "generic";
}

export function parseCollectionFile(text: string): ParsedCollectionFile {
  const delimiter = detectDelimiter(text);
  const parsed = parseDelimited(text.replace(/^\uFEFF/, ""), delimiter);
  const headers = parsed[0] ?? [];
  const nameColumn = findColumn(headers, NAME_ALIASES);
  const quantityColumn = findColumn(headers, QUANTITY_ALIASES);
  const setColumn = findColumn(headers, SET_ALIASES);
  const collectorNumberColumn = findColumn(headers, COLLECTOR_NUMBER_ALIASES);
  const foilColumn = findColumn(headers, FOIL_ALIASES);
  const hasHeader = nameColumn !== null || quantityColumn !== null;

  if (!hasHeader) {
    const width = Math.max(...parsed.map((row) => row.length), 0);
    return {
      delimiter,
      headers: Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
      rows: parsed,
      source: "generic",
      mapping: {
        nameColumn: width > 1 ? 1 : 0,
        quantityColumn: width > 1 ? 0 : null,
        setColumn: null,
        collectorNumberColumn: null,
        foilColumn: null,
      },
    };
  }

  return {
    delimiter,
    headers,
    rows: parsed.slice(1),
    source: detectSource(headers),
    mapping: { nameColumn, quantityColumn, setColumn, collectorNumberColumn, foilColumn },
  };
}

export function previewCollectionImport(
  file: ParsedCollectionFile,
  mapping: CollectionImportMapping,
): CollectionImportPreviewRow[] {
  return file.rows.map((row, index) => {
    const name = mapping.nameColumn === null ? "" : (row[mapping.nameColumn]?.trim() ?? "");
    const setCode = mapping.setColumn === null ? "" : (row[mapping.setColumn]?.trim() ?? "");
    const collectorNumber =
      mapping.collectorNumberColumn === null
        ? ""
        : (row[mapping.collectorNumberColumn]?.trim() ?? "");
    const foil = mapping.foilColumn === null ? undefined : parseFoil(row[mapping.foilColumn] ?? "");
    const rawQuantity =
      mapping.quantityColumn === null ? "1" : (row[mapping.quantityColumn]?.trim() ?? "");
    const quantity = Number(rawQuantity);
    if (!name) return { rowNumber: index + 2, name, quantity: 0, valid: false, reason: "No name" };
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { rowNumber: index + 2, name, quantity: 0, valid: false, reason: "Invalid quantity" };
    }
    return {
      rowNumber: index + 2,
      name,
      setCode: setCode || undefined,
      collectorNumber: collectorNumber || undefined,
      foil,
      quantity: Math.floor(quantity),
      valid: true,
    };
  });
}

export function collectionQuantitiesFromPreview(
  rows: CollectionImportPreviewRow[],
): Record<string, number> {
  const quantities: Record<string, number> = {};
  for (const row of rows) {
    if (!row.valid) continue;
    const key = collectionCardKey(row.name, row.setCode, row.collectorNumber, row.foil);
    quantities[key] = (quantities[key] ?? 0) + row.quantity;
  }
  return quantities;
}
import { collectionCardKey } from "@/lib/collection";
