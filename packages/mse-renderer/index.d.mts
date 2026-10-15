export type MseCanvas = HTMLCanvasElement | OffscreenCanvas;
export type MseFields = Record<string, string | number | boolean>;

export interface MsePrinting {
  set?: string;
  collector_number?: string;
  frame?: string;
  frame_effects?: string[];
  border_color?: string;
  full_art?: boolean;
  textless?: boolean;
  security_stamp?: string;
  promo_types?: string[];
  lang?: string;
  released_at?: string;
  artist?: string;
  rarity?: string;
  layout?: string;
}

export interface MseCardSnapshot extends MsePrinting {
  id?: string | number;
  stable_id?: string | number;
  name?: string;
  mana_cost?: string;
  type_line?: string;
  type_line_display?: string;
  oracle_text?: string;
  effect_text?: string;
  ability_text?: string;
  flavor_text?: string;
  colors?: string[] | string;
  color_indicator?: string[] | string;
  color_identity?: string[] | string;
  colorIdentity?: string[] | string;
  intrinsic_mana?: string[] | string;
  produced_mana?: string[] | string;
  characteristic_signature?: string;
  power?: string | number;
  toughness?: string | number;
  power_toughness?: string;
  loyalty?: string | number;
  defense?: string | number;
  hand_modifier?: string;
  life_modifier?: string;
  keywords?: string[];
  card_faces?: MseCardSnapshot[];
  printing?: MsePrinting;
}

export interface MseCardAdapter {
  faceIndex?: 0 | 1 | null;
  rulesText?: string;
  nativeCard?: MseFields;
  set?: MseFields;
  styling?: MseFields;
  linkedFaces?: boolean;
}

export interface MseCardValues {
  card: MseFields;
  set: MseFields;
  styling: MseFields;
  uid?: string | number;
}

export interface MseRecord {
  text(key: string, fallback?: string): string;
}

export interface MseTemplateContext {
  template: {
    layouts: Map<string, unknown>;
    style: MseRecord;
  };
  cells: {
    card: Map<string, { definition?: { record: MseRecord } }>;
  };
  property(name: string, key: string, group?: string): unknown;
  fieldVisible(name: string, group?: string): boolean;
  diagnostics: unknown[];
}

export interface MseRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
  hasAlpha?: boolean;
}

export interface MseRenderRequest {
  style: string;
  snapshot?: MseCardSnapshot;
  adapter?: MseCardAdapter;
  context?: MseCardValues;
}

export interface MseRenderResult {
  canvas: MseCanvas;
  width: number;
  height: number;
  rulesFields: {
    name: string;
    fontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    inkColor: string;
  }[];
  context: MseTemplateContext;
  diagnostics: unknown[];
}

export interface MseRenderOptions {
  signal?: AbortSignal;
  cache?: boolean;
  rulesText?: boolean;
}

export interface MseSession {
  renderer: {
    render(request: MseRenderRequest, options?: MseRenderOptions): Promise<MseRenderResult>;
    dispose(): void;
  };
  styles: string[];
  fontFailures: { path: string; message: string }[];
  revision: string;
  dispose(): void;
}

export interface MseSessionOptions {
  corpusUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  allowSystemFonts?: boolean;
  createCanvas?: (width: number, height: number) => MseCanvas;
  loadCardImage?: (url: string) => Promise<MseRaster>;
  fieldUpdateMode?: "ordered" | "lazy";
  maxPixels?: number;
}

export interface MsePresentationOptions {
  style?: string;
  defaultStyle?: string;
  faceIndex?: 0 | 1;
  printing?: MsePrinting;
  availableStyles?: Iterable<string>;
}

export interface MsePresentation {
  style: string | null;
  styling: MseFields;
  nativeCard?: MseFields;
  source: "explicit" | "printing" | "general";
}

export function createBrowserMseSession(options?: MseSessionOptions): Promise<MseSession>;
export function selectMsePresentation(
  snapshot: MseCardSnapshot,
  options?: MsePresentationOptions,
): MsePresentation;
export function selectMseStyle(
  snapshot: MseCardSnapshot,
  options?: MsePresentationOptions,
): string | null;
export function engineRulesToMse(value: string): string;
export function engineCardToMse(snapshot: MseCardSnapshot, options?: MseCardAdapter): MseCardValues;
export function engineDoubleFacesToMse(
  snapshot: MseCardSnapshot,
  options?: MseCardAdapter,
): { cards: MseCardValues[]; selected: number } | null;
export function printingMseCardFields(snapshot: MseCardSnapshot, printing?: MsePrinting): MseFields;
export function printingMseFooterFields(
  snapshot: MseCardSnapshot,
  printing?: MsePrinting,
): MseFields;
export function printingMseSetFields(snapshot: MseCardSnapshot, printing?: MsePrinting): MseFields;
export const MSE_CORPUS_REVISION: string;
export const MSE_DEFAULT_CORPUS_URL: string;
