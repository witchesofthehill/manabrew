import { Container, type DestroyOptions } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { RulesCardPreviewLayer } from "./RulesCardPreviewLayer";

export class HandRulesCardFace extends Container {
  private readonly preview: RulesCardPreviewLayer;
  private card: CardDto;
  private faceIndex: 0 | 1;
  private slotWidth: number;
  private slotHeight: number;
  private actions: HandActionOption[] = [];
  private onSelectAction: ((action: HandActionOption) => void) | null = null;
  private highlightedEffect = "";

  constructor(card: CardDto, faceIndex: 0 | 1, width: number, height: number, theme: Theme) {
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
    this.sync();
  }

  get artworkTop(): number {
    return this.preview.artworkTop;
  }

  onRenderRequested?: () => void;

  setContent(card: CardDto, faceIndex: 0 | 1, width: number, height: number): void {
    this.card = card;
    this.faceIndex = faceIndex;
    this.slotWidth = width;
    this.slotHeight = height;
    this.sync();
  }

  setTheme(theme: Theme): void {
    this.preview.setTheme(theme);
  }

  setActions(
    actions: HandActionOption[],
    onSelectAction: ((action: HandActionOption) => void) | null,
  ): void {
    this.actions = actions;
    this.onSelectAction = onSelectAction;
    this.sync();
  }

  setHighlightedEffect(text: string): void {
    if (this.highlightedEffect === text) return;
    this.highlightedEffect = text;
    this.sync();
  }
  scrollBy(delta: number, mode: number): void {
    this.preview.scrollBy(delta, mode, 0, 0);
  }

  private sync(): void {
    this.preview.setViewport(this.slotWidth, this.slotHeight);
    this.preview.setSpec({
      card: this.card,
      phase: "open",
      sticky: false,
      showBackFace: this.faceIndex === 1,
      suppressed: false,
      skipEnterAnimation: true,
      actions: this.actions,
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
