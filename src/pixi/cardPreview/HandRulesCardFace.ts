import { Container, type DestroyOptions, type Rectangle, type Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { RulesCardPreviewLayer } from "./RulesCardPreviewLayer";
import type { CardLiveHighlight } from "@/pixi/effects/CardLiveHighlight";
import type { CardFoilRegion } from "@/lib/cardFinish";

export class HandRulesCardFace extends Container {
  private readonly preview: RulesCardPreviewLayer;
  private card: CardDto;
  private faceIndex: 0 | 1;
  private slotWidth: number;
  private slotHeight: number;
  private actions: HandActionOption[] = [];
  private onSelectAction: ((action: HandActionOption) => void) | null = null;
  private highlightedEffect = "";

  constructor(
    card: CardDto,
    faceIndex: 0 | 1,
    width: number,
    height: number,
    theme: Theme,
    parentScale: number,
  ) {
    super();
    this.card = card;
    this.faceIndex = faceIndex;
    this.slotWidth = width;
    this.slotHeight = height;
    this.eventMode = "passive";
    this.preview = new RulesCardPreviewLayer(theme, {
      onPointerEnter: () => undefined,
      onPointerLeave: () => undefined,
      onInteractionReady: () => undefined,
      onRenderRequested: () => this.onRenderRequested?.(),
      onDismiss: () => undefined,
      onToggleView: () => undefined,
      onFlip: () => undefined,
      onSelectAction: (action) => this.onSelectAction?.(action),
    });
    this.addChild(this.preview.container);
    this.preview.setParentScale(parentScale);
    this.sync();
  }
  get imageReady(): boolean {
    return this.preview.imageReady;
  }
  get presentationReady(): boolean {
    return this.preview.presentationReady;
  }
  get liveHighlights(): CardLiveHighlight {
    return this.preview.liveHighlights;
  }
  get foilTexture(): Texture | null {
    return this.preview.foilTexture;
  }
  get foilSource() {
    return this.preview.foilSource;
  }
  writeFoilTextureUvs(relativeTo: Container, surface: Rectangle, output: Float32Array): void {
    this.preview.writeFoilTextureUvs(relativeTo, surface, output);
  }
  get foilExclusions(): readonly CardFoilRegion[] {
    return this.preview.foilExclusions;
  }

  onRenderRequested?: () => void;

  setContent(card: CardDto, faceIndex: 0 | 1, width: number, height: number): void {
    if (
      this.card === card &&
      this.faceIndex === faceIndex &&
      this.slotWidth === width &&
      this.slotHeight === height
    )
      return;
    this.card = card;
    this.faceIndex = faceIndex;
    this.slotWidth = width;
    this.slotHeight = height;
    this.sync();
  }
  setRasterProjection(width: number, height: number, flipping: boolean): void {
    this.preview.setRasterProjection(width, height, flipping);
  }
  setParentScale(scale: number): void {
    this.preview.setParentScale(scale);
  }
  setTheme(theme: Theme): void {
    this.preview.setTheme(theme);
  }

  setActions(
    actions: HandActionOption[],
    onSelectAction: ((action: HandActionOption) => void) | null,
  ): void {
    this.onSelectAction = onSelectAction;
    if (
      this.actions.length === actions.length &&
      this.actions.every((action, index) => action === actions[index])
    )
      return;
    this.actions = actions;
    this.sync();
  }
  setHighlightedEffect(text: string): void {
    if (this.highlightedEffect === text) return;
    this.highlightedEffect = text;
    this.sync();
  }
  scrollBy(delta: number, mode: number, x: number, y: number): void {
    this.preview.scrollBy(delta, mode, x, y);
  }

  get keyboardTarget(): Pick<
    RulesCardPreviewLayer,
    "focusAction" | "activateFocusedAction" | "activateShortcut"
  > | null {
    return this.actions.length > 0 ? this.preview : null;
  }

  private sync(): void {
    this.preview.setViewport(this.slotWidth, this.slotHeight);
    this.preview.setSpec({
      card: this.card,
      phase: "open",
      sticky: false,
      showBackFace: this.faceIndex === 1,
      placement: "auto",
      suppressed: false,
      skipEnterAnimation: true,
      actions: this.actions,
      reserveSidePanel: false,
      anchor: null,
      pointer: { x: 0, y: 0 },
      slot: { x: 0, y: 0, width: this.slotWidth, height: this.slotHeight },
      embedded: true,
      highlightedEffect: this.highlightedEffect,
    });
  }
  override destroy(options?: DestroyOptions): void {
    this.removeChild(this.preview.container);
    this.preview.destroy();
    super.destroy(options);
  }
}
