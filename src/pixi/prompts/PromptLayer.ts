import {
  Application,
  Container,
  type FederatedWheelEvent,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type Texture,
  type Ticker,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { CardSprite } from "@/pixi/CardSprite";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { loadManaSymbolTexture } from "@/pixi/manaSymbolCache";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import type {
  CardDto,
  ChooseCombatDamageAssignmentInput,
  PromptPresentation,
  ReorderItem,
  ScryDestination,
  SelectionOption,
  TargetRef,
} from "@/protocol";
import { PromptButton } from "./PromptButton";
import { LongPressGesture } from "@/pixi/LongPressGesture";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import type { PromptLayerCallbacks, PromptOverlaySpec } from "./prompt.types";

const MODAL_TYPES = new Set([
  "chooseBoolean",
  "chooseFromSelection",
  "revealCards",
  "scry",
  "chooseColor",
  "chooseNumber",
  "chooseCombatDamageAssignment",
  "chooseDamageAssignmentOrder",
  "chooseCards",
  "reorder",
  "diceRolled",
]);

const FONT = "Inter, system-ui, sans-serif";
const PANEL_PADDING = 20;
const ROW_GAP = 10;
const CARD_WIDTH = 100;
const CARD_HEIGHT = 140;
const DICE_ROLL_MS = 1200;
const DICE_FINISH_MS = 1450;

interface DragState {
  item: Container;
  offsetX: number;
  offsetY: number;
  onDrop: (x: number, y: number) => void;
}

interface DiceVisual {
  die: Graphics;
  value: Text;
  finalValue: number;
  index: number;
  sides: number;
}
interface DropZone {
  id: string;
  rect: Rectangle;
  visual: Graphics;
}

function promptText(
  value: string,
  size: number,
  color: string,
  options: {
    weight?: "400" | "500" | "600" | "700";
    width?: number;
    align?: "left" | "center";
  } = {},
): Text {
  const text = new Text({
    text: value,
    style: new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: options.weight ?? "400",
      fill: hexToNum(color),
      align: options.align ?? "left",
      wordWrap: options.width != null,
      wordWrapWidth: options.width,
      lineHeight: Math.ceil(size * 1.35),
    }),
  });
  text.eventMode = "none";
  return text;
}

function parseCombatNumber(value?: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class PromptLayer {
  readonly container = new Container();
  private readonly app: Application;
  private theme: Theme;
  private readonly callbacks: PromptLayerCallbacks;
  private spec: PromptOverlaySpec | null = null;
  private promptKey: unknown = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private modalOpen = false;
  private selectedIds = new Set<string>();
  private counts = new Map<number | string, number>();
  private numberValue = 0;
  private numberBuffer = "";
  private order: string[] = [];
  private scryItems: Record<string, string[]> = {};
  private scrySelectedId: string | null = null;
  private damageAssigned: Record<string, number> = {};
  private dropZones: DropZone[] = [];
  private drag: DragState | null = null;
  private diceElapsedMs = 0;
  private diceVisuals: DiceVisual[] = [];
  private diceWinnerText: Text | null = null;
  private diceConfirm: PromptButton | null = null;
  private diceSettled = false;
  private selectionFilter = "";
  private modalScrollOffset = 0;
  private modalScrollMax = 0;
  private modalBody: { body: Container; bodyTop: number; height: number } | null = null;
  private keyListener: (event: KeyboardEvent) => void;
  private longPress = new LongPressGesture();
  private stickyPreviewCardId: string | null = null;
  private onStageMove = (event: FederatedPointerEvent): void => this.moveDrag(event);
  private onStageUp = (event: FederatedPointerEvent): void => this.finishDrag(event);

  constructor(app: Application, callbacks: PromptLayerCallbacks = {}) {
    this.app = app;
    this.callbacks = callbacks;
    this.theme = getTheme();
    this.container.sortableChildren = true;
    this.container.zIndex = 10000;
    this.container.eventMode = "passive";
    this.app.stage.addChild(this.container);
    this.app.stage.on("pointermove", this.onStageMove);
    this.app.stage.on("pointerup", this.onStageUp);
    this.app.stage.on("pointerupoutside", this.onStageUp);
    this.app.ticker.add(this.tick, this);
    this.keyListener = (event) => this.handleKey(event);
    window.addEventListener("keydown", this.keyListener);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.rebuild();
  }

  setViewport(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.rebuild();
  }

  setSpec(spec: PromptOverlaySpec | null): void {
    const nextKey = spec?.currentPrompt ?? spec?.gameOver ?? null;
    if (nextKey !== this.promptKey) {
      this.promptKey = nextKey;
      this.resetLocalState(spec);
      if (spec?.currentPrompt && MODAL_TYPES.has(spec.currentPrompt.input.type)) {
        spec.onShowModal();
      }
    }
    this.spec = spec;
    this.rebuild();
  }

  get blocksBoard(): boolean {
    return this.modalOpen;
  }

  hitTest(_x: number, _y: number): boolean {
    return this.container.visible && this.modalOpen;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.keyListener);
    this.app.stage.off("pointermove", this.onStageMove);
    this.app.stage.off("pointerup", this.onStageUp);
    this.app.stage.off("pointerupoutside", this.onStageUp);
    this.app.ticker.remove(this.tick, this);
    this.longPress.reset();
    this.callbacks.onReferenceChange?.(null);
    this.callbacks.onPreviewCard?.(null);
    this.container.destroy({ children: true });
  }

  private resetLocalState(spec: PromptOverlaySpec | null): void {
    this.selectedIds.clear();
    this.counts.clear();
    this.selectionFilter = "";
    this.order = [];
    this.scryItems = {};
    this.scrySelectedId = null;
    this.damageAssigned = {};
    this.dropZones = [];
    this.drag = null;
    this.stickyPreviewCardId = null;
    this.diceVisuals = [];
    this.diceWinnerText = null;
    this.diceConfirm = null;
    this.diceSettled = false;
    this.diceElapsedMs = 0;
    this.modalScrollOffset = 0;
    this.modalScrollMax = 0;
    const input = spec?.currentPrompt?.input;
    if (!input) return;
    if (input.type === "chooseNumber") {
      this.numberValue = input.min;
      this.numberBuffer = String(input.min);
    }
    if (input.type === "reorder") this.order = input.items.map((item) => item.id);
    if (input.type === "scry") {
      this.scryItems = {
        pool: input.cards.map((card) => card.id),
        ...Object.fromEntries(input.zones.map((_, index) => [`zone-${index}`, []])),
      };
    }
  }

  private rebuild(): void {
    this.callbacks.onReferenceChange?.(null);
    this.drag = null;
    this.modalOpen = false;
    this.modalBody = null;
    this.dropZones = [];
    this.container.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!this.spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    if (this.spec.gameOver) {
      this.modalOpen = true;
      this.renderGameOver();
      return;
    }
    const input = this.spec.currentPrompt?.input;
    if (
      input &&
      MODAL_TYPES.has(input.type) &&
      !this.spec.modalHidden &&
      !this.spec.isWaitingForResponse
    ) {
      this.modalOpen = true;
      this.renderModal();
      return;
    }
    this.container.visible = false;
  }

  private panel(width: number, height: number, x: number, y: number, radius = 12): Container {
    const panel = new Container();
    panel.position.set(x, y);
    const background = new Graphics()
      .roundRect(0, 0, width, height, radius)
      .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.97 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.9 });
    background.eventMode = "none";
    panel.addChild(background);
    return panel;
  }

  private addButtonRow(
    parent: Container,
    buttons: PromptButton[],
    y: number,
    availableWidth: number,
    align: "left" | "center" | "right" = "center",
  ): number {
    if (buttons.length === 0) return 0;
    const rawTotal =
      buttons.reduce((sum, button) => sum + button.buttonWidth, 0) + ROW_GAP * (buttons.length - 1);
    const scale = Math.min(1, availableWidth / rawTotal);
    const total = rawTotal * scale;
    let x =
      align === "left"
        ? 0
        : align === "right"
          ? availableWidth - total
          : (availableWidth - total) / 2;
    for (const button of buttons) {
      button.scale.set(scale);
      button.position.set(x, y);
      parent.addChild(button);
      x += (button.buttonWidth + ROW_GAP) * scale;
    }
    return buttons.reduce((height, button) => Math.max(height, button.buttonHeight * scale), 0);
  }

  private makeButton(
    label: string,
    onPress: (() => void) | undefined,
    options: {
      color?: string;
      foreground?: string;
      outline?: boolean;
      disabled?: boolean;
      width?: number;
      compact?: boolean;
      height?: number;
      title?: string;
      icon?: string;
      iconTexture?: Promise<Texture>;
      iconTint?: boolean;
      iconSize?: number;
    } = {},
  ): PromptButton {
    return new PromptButton(this.theme, {
      label,
      onPress,
      color: options.color,
      foreground: options.foreground,
      outline: options.outline,
      disabled: options.disabled,
      width: options.width,
      compact: options.compact,
      title: options.title,
      height: options.height,
      icon: options.icon,
      iconTexture: options.iconTexture,
      iconTint: options.iconTint,
      iconSize: options.iconSize,
    });
  }

  private makeIcon(name: string, size: number, color: string): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    sprite.tint = hexToNum(color);
    void gameIconTexture(name)
      .then((texture) => {
        if (sprite.destroyed) return;
        sprite.texture = texture;
        sprite.width = size;
        sprite.height = size;
      })
      .catch(() => {});
    return sprite;
  }

  private manaSymbol(color: string): string {
    switch (color) {
      case "White":
      case "W":
        return "W";
      case "Blue":
      case "U":
        return "U";
      case "Black":
      case "B":
        return "B";
      case "Red":
      case "R":
        return "R";
      case "Green":
      case "G":
        return "G";
      case "Colorless":
      case "C":
        return "C";
      default:
        return "C";
    }
  }

  private makeManaIcon(symbol: string, size: number): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    void loadManaSymbolTexture(symbol)
      .then((texture) => {
        if (sprite.destroyed) return;
        sprite.texture = texture;
        sprite.width = size;
        sprite.height = size;
      })
      .catch(() => {});
    return sprite;
  }

  private renderModal(): void {
    const input = this.spec!.currentPrompt!.input;
    const boardContext =
      input.type === "chooseCombatDamageAssignment" ||
      input.type === "chooseDamageAssignmentOrder" ||
      (input.type === "chooseBoolean" && input.presentation.targets.length > 0);
    const backdrop = new Graphics().rect(0, 0, this.viewportWidth, this.viewportHeight).fill({
      color: hexToNum(this.theme.appTheme.overlay),
      alpha: boardContext ? 0.38 : 0.76,
    });
    backdrop.eventMode = "static";
    backdrop.hitArea = new Rectangle(0, 0, this.viewportWidth, this.viewportHeight);
    this.container.addChild(backdrop);
    switch (input.type) {
      case "chooseBoolean":
        this.renderBoolean(input.presentation, input.denyLabel, input.confirmLabel);
        break;
      case "chooseFromSelection":
        this.renderSelection(input.presentation, input.options, input.minTotal, input.maxTotal);
        break;
      case "revealCards":
        this.renderCards(input.presentation, input.cards, 0, 0, true);
        break;
      case "chooseCards":
        this.renderCards(input.presentation, input.cards, input.min, input.max, false);
        break;
      case "chooseColor":
        this.renderColors(input.presentation, input.validColors, input.amount, input.repeatAllowed);
        break;
      case "chooseNumber":
        this.renderNumber(input.presentation, input.min, input.max);
        break;
      case "reorder":
        this.renderReorder(input.presentation, input.items);
        break;
      case "scry":
        this.renderScry(input.presentation, input.cards, input.zones);
        break;
      case "chooseCombatDamageAssignment":
        this.renderCombatDamage(input);
        break;
      case "chooseDamageAssignmentOrder":
        this.renderDamageOrder();
        break;
      case "diceRolled":
        this.renderDice(input.presentation, input.sides, input.rolls);
        break;
    }
    this.finalizeModalScroll();
  }

  private createModalShell(
    width: number,
    height: number,
    presentation: PromptPresentation,
    minimizable = true,
    boardContext = false,
  ): {
    panel: Container;
    body: Container;
    bodyTop: number;
  } {
    const compact = this.viewportWidth < 760 || this.viewportHeight < 520;
    let x = (this.viewportWidth - width) / 2;
    if (boardContext && !compact && this.viewportWidth >= width + 160) {
      const anchors = presentation.targets
        .map((target) => this.callbacks.getReferenceAnchor?.(target))
        .filter((anchor): anchor is { x: number; y: number } => anchor != null);
      const meanX =
        anchors.length > 0
          ? anchors.reduce((sum, anchor) => sum + anchor.x, 0) / anchors.length
          : this.viewportWidth;
      x = meanX < this.viewportWidth / 2 ? this.viewportWidth - width - 16 : 16;
    }
    const y =
      compact && boardContext
        ? this.viewportHeight - height - 12
        : (this.viewportHeight - height) / 2;
    const panel = this.panel(width, height, x, y, 12);
    panel.eventMode = "static";
    panel.hitArea = new Rectangle(0, 0, width, height);
    panel.accessible = true;
    panel.accessibleTitle = presentation.title;
    panel.tabIndex = -1;
    const sourceCard = this.spec?.sourceDeckCard;
    const sourceSprite = sourceCard
      ? new CardSprite(deckCardToPreviewDto(sourceCard), "zone")
      : null;
    const externalSource = !!sourceSprite && this.viewportWidth - width >= 444;
    if (sourceSprite) {
      const targetWidth = externalSource ? 200 : 76;
      const left = externalSource ? width + 22 : PANEL_PADDING;
      const top = externalSource ? 0 : 16;
      const placeSourceSprite = () => {
        sourceSprite.scale.set(1);
        const scale = targetWidth / sourceSprite.width;
        sourceSprite.scale.set(scale);
        sourceSprite.position.set(
          left + sourceSprite.pivot.x * scale,
          top + sourceSprite.pivot.y * scale,
        );
      };
      sourceSprite.onReorient = placeSourceSprite;
      placeSourceSprite();
      sourceSprite.eventMode = "none";
      panel.addChild(sourceSprite);
    }
    const titleX = sourceSprite && !externalSource ? PANEL_PADDING + 92 : PANEL_PADDING;
    const title = promptText(
      presentation.title,
      this.viewportWidth < 760 ? 18 : 22,
      this.theme.appTheme.foreground,
      {
        weight: "700",
        width: width - titleX - 50,
      },
    );
    title.position.set(titleX, 16);
    panel.addChild(title);
    let bodyTop = 16 + title.height + 8;
    if (sourceSprite && !externalSource) bodyTop = Math.max(bodyTop, 16 + sourceSprite.height + 8);
    if (presentation.description) {
      const description = promptText(presentation.description, 14, this.theme.appTheme.foreground, {
        width: width - PANEL_PADDING * 2,
      });
      description.alpha = 0.9;
      description.position.set(PANEL_PADDING, bodyTop);
      panel.addChild(description);
      bodyTop += description.height + 6;
    }
    if (presentation.text) {
      const rules = promptText(presentation.text, 12, this.theme.appTheme["muted-foreground"], {
        width: width - PANEL_PADDING * 2,
      });
      rules.position.set(PANEL_PADDING, bodyTop);
      panel.addChild(rules);
      bodyTop += rules.height + 8;
    }
    if (minimizable) {
      const minimize = this.makeButton("", this.spec!.onHideModal, {
        title: "Minimize prompt",
        icon: "lucide-minus",
        outline: true,
        compact: true,
        width: 32,
      });
      minimize.position.set(width - 18, -14);
      panel.addChild(minimize);
    }
    const mask = new Graphics()
      .rect(PANEL_PADDING, bodyTop, width - PANEL_PADDING * 2, height - bodyTop - 8)
      .fill({ color: hexToNum(this.theme.appTheme.foreground) });
    panel.addChild(mask);
    const body = new Container();
    body.position.set(PANEL_PADDING, bodyTop);
    body.mask = mask;
    panel.addChild(body);
    panel.on("wheel", (event: FederatedWheelEvent) => {
      if (this.modalScrollMax <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.modalScrollOffset = Math.max(
        0,
        Math.min(this.modalScrollMax, this.modalScrollOffset + Math.sign(event.deltaY) * 48),
      );
      body.y = bodyTop - this.modalScrollOffset;
    });
    this.modalBody = { body, bodyTop, height };
    this.container.addChild(panel);
    return { panel, body, bodyTop };
  }

  private finalizeModalScroll(): void {
    const state = this.modalBody;
    if (!state) return;
    const bounds = state.body.getLocalBounds();
    const viewportHeight = state.height - state.bodyTop - 8;
    this.modalScrollMax = Math.max(0, bounds.y + bounds.height - viewportHeight);
    this.modalScrollOffset = Math.min(this.modalScrollOffset, this.modalScrollMax);
    state.body.y = state.bodyTop - this.modalScrollOffset;
  }

  private renderBoolean(
    presentation: PromptPresentation,
    denyLabel: string,
    confirmLabel: string,
  ): void {
    const width = Math.min(520, this.viewportWidth - 24);
    const height = Math.min(280, this.viewportHeight - 24);
    const { body } = this.createModalShell(
      width,
      height,
      presentation,
      true,
      presentation.targets.length > 0,
    );
    const buttons = [
      this.makeButton(denyLabel, () => this.spec!.respond({ type: "decision", value: false }), {
        outline: true,
        width: 150,
        height: 58,
      }),
      this.makeButton(confirmLabel, () => this.spec!.respond({ type: "decision", value: true }), {
        width: 150,
        height: 58,
      }),
    ];
    this.addButtonRow(body, buttons, Math.max(12, height - body.y - 76), width - PANEL_PADDING * 2);
  }

  private renderSelection(
    presentation: PromptPresentation,
    options: SelectionOption[],
    minTotal: number,
    maxTotal: number,
  ): void {
    const showFilter = options.length > 5;
    const indexedOptions = options.map((option, index) => ({ option, index }));
    const visibleOptions = showFilter
      ? indexedOptions.filter(({ option }) =>
          option.label.toLocaleLowerCase().includes(this.selectionFilter.toLocaleLowerCase()),
        )
      : indexedOptions;
    const width = Math.min(560, this.viewportWidth - 24);
    const height = Math.min(Math.max(300, 170 + options.length * 48), this.viewportHeight - 24);
    const { body } = this.createModalShell(width, height, presentation);
    const autoConfirm = minTotal === 1 && maxTotal === 1;
    const availableWidth = width - PANEL_PADDING * 2;
    const total = this.selectionTotal(options);
    let y = 4;
    if (!autoConfirm) {
      const requirement =
        minTotal === maxTotal
          ? `${total}/${maxTotal} selected`
          : `${total} selected · choose ${minTotal}–${maxTotal}`;
      const status = promptText(requirement, 12, this.theme.appTheme.primary, {
        weight: "700",
      });
      status.position.set(2, y);
      body.addChild(status);
      y += 28;
    }
    if (showFilter) {
      const filterBg = new Graphics()
        .roundRect(0, y, availableWidth, 32, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.55 })
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.8 });
      const filter = promptText(
        `⌕  ${this.selectionFilter || "Type to filter choices"}`,
        12,
        this.selectionFilter
          ? this.theme.appTheme.foreground
          : this.theme.appTheme["muted-foreground"],
        { width: availableWidth - 18 },
      );
      filter.position.set(10, y + 8);
      body.addChild(filterBg, filter);
      y += 42;
    }
    if (visibleOptions.length === 0) {
      const empty = promptText("No choices match this filter", 12, this.theme.appTheme.muted, {
        width: availableWidth,
        align: "center",
      });
      empty.position.set(0, y + 18);
      body.addChild(empty);
      y += 58;
    }
    for (const { option, index } of visibleOptions) {
      const count = this.counts.get(index) ?? 0;
      const currentTotal = this.selectionTotal(options);
      const selected = count > 0;
      const disabled =
        option.weight > maxTotal || (!selected && currentTotal + option.weight > maxTotal);
      const repeatedWidth = option.canRepeat ? availableWidth - 76 : availableWidth;
      const weightLabel = option.weight > 1 ? ` · ${option.weight} points` : "";
      const label = option.canRepeat
        ? `${option.label}${weightLabel}  × ${count}`
        : `${option.label}${weightLabel}`;
      const increment = () => {
        if (autoConfirm) {
          this.spec!.respond({ type: "selectionDecision", chosenIndices: [index] });
          return;
        }
        if (option.canRepeat) {
          this.counts.set(index, count + 1);
        } else if (selected) {
          this.counts.delete(index);
        } else {
          if (maxTotal === 1) this.counts.clear();
          this.counts.set(index, 1);
        }
        this.rebuild();
      };
      const button = this.makeButton(label, increment, {
        outline: !selected,
        disabled,
        width: repeatedWidth,
        icon: !option.canRepeat && selected && !autoConfirm ? "lucide-check" : undefined,
      });
      button.position.set(0, y);
      body.addChild(button);
      if (option.canRepeat) {
        const minus = this.makeButton(
          "",
          () => {
            if (count <= 1) this.counts.delete(index);
            else this.counts.set(index, count - 1);
            this.rebuild();
          },
          {
            title: "Remove one",
            icon: "lucide-minus",
            outline: true,
            compact: true,
            disabled: count === 0,
            width: 32,
          },
        );
        minus.position.set(availableWidth - 72, y + 3);
        body.addChild(minus);
        const plus = this.makeButton("", increment, {
          title: "Add one",
          icon: "lucide-plus",
          outline: true,
          compact: true,
          disabled,
          width: 32,
        });
        plus.position.set(availableWidth - 34, y + 3);
        body.addChild(plus);
      }
      y += 44;
    }
    if (!autoConfirm) {
      const selectedTotal = this.selectionTotal(options);
      const canConfirm = selectedTotal >= minTotal && selectedTotal <= maxTotal;
      const label =
        minTotal === 0 && selectedTotal === 0
          ? "SKIP"
          : `CONFIRM${selectedTotal ? ` (${selectedTotal})` : ""}`;
      const confirm = this.makeButton(
        label,
        () => {
          const chosenIndices = [...this.counts.entries()]
            .sort(([left], [right]) => Number(left) - Number(right))
            .flatMap(([index, count]) => Array.from({ length: count }, () => Number(index)));
          this.spec!.respond({ type: "selectionDecision", chosenIndices });
        },
        { disabled: !canConfirm, width: 130 },
      );
      confirm.position.set(availableWidth - confirm.buttonWidth, y + 8);
      body.addChild(confirm);
    }
  }

  private selectionTotal(options: SelectionOption[]): number {
    let total = 0;
    for (const [index, count] of this.counts) {
      if (typeof index === "number") total += count * (options[index]?.weight ?? 0);
    }
    return total;
  }

  private renderCards(
    presentation: PromptPresentation,
    cards: CardDto[],
    min: number,
    max: number,
    reveal: boolean,
  ): void {
    const width = Math.min(760, this.viewportWidth - 24);
    const columns = Math.max(
      1,
      Math.min(cards.length, Math.floor((width - PANEL_PADDING * 2) / (CARD_WIDTH + 10))),
    );
    const rows = Math.ceil(cards.length / columns);
    const height = Math.min(this.viewportHeight - 24, 220 + rows * (CARD_HEIGHT + 12));
    const { body } = this.createModalShell(
      width,
      height,
      reveal
        ? {
            ...presentation,
            title: "Cards Revealed",
            description: `${cards.length} card${cards.length === 1 ? "" : "s"} shown`,
          }
        : presentation,
    );
    const status = promptText(
      reveal
        ? "Inspect any card before continuing"
        : `${this.selectedIds.size}/${max} selected · minimum ${min}`,
      12,
      reveal ? this.theme.appTheme["muted-foreground"] : this.theme.appTheme.primary,
      { weight: reveal ? "500" : "700" },
    );
    status.position.set(0, 3);
    body.addChild(status);
    const startY = 32;
    cards.forEach((card, index) => {
      const selected = this.selectedIds.has(card.id);
      const disabled = !reveal && this.selectedIds.size >= max && !selected;
      const tile = this.createCardTile(card, selected, disabled, () => {
        if (reveal || disabled) return;
        if (selected) this.selectedIds.delete(card.id);
        else this.selectedIds.add(card.id);
        this.rebuild();
      });
      const row = Math.floor(index / columns);
      const column = index % columns;
      tile.position.set(column * (CARD_WIDTH + 10), startY + row * (CARD_HEIGHT + 12));
      body.addChild(tile);
    });
    const footerY = startY + rows * (CARD_HEIGHT + 12) + 6;
    const chosen = [...this.selectedIds];
    const canConfirm = reveal || (chosen.length >= min && chosen.length <= max);
    const label = reveal
      ? "CONTINUE"
      : chosen.length === 0 && min === 0
        ? "SKIP"
        : `CONFIRM ${chosen.length}/${max}`;
    const confirm = this.makeButton(
      label,
      () => {
        if (reveal) this.spec!.respond({ type: "revealCardsAcknowledged" });
        else this.spec!.respond({ type: "chooseCardsDecision", chosenCardIds: chosen });
      },
      { disabled: !canConfirm, width: 148 },
    );
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, footerY);
    body.addChild(confirm);
  }

  private createCardTile(
    card: CardDto,
    selected: boolean,
    disabled: boolean,
    onPress?: () => void,
    intent: TargetRef["intent"] = "friendly",
  ): Container {
    const tile = new Container();
    tile.eventMode = "static";
    tile.cursor = disabled ? "default" : onPress ? "pointer" : "grab";
    tile.hitArea = new Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT);
    tile.accessible = true;
    tile.accessibleTitle = `${card.identity.name}${selected ? ", selected" : ""}${
      disabled ? ", unavailable" : ""
    }`;
    tile.accessibleHint = "Focus or hover to preview and locate this card";
    tile.tabIndex = 0;
    const sprite = new CardSprite(card, "zone");
    const placeSprite = () => {
      sprite.scale.set(1);
      const scale = Math.min(CARD_WIDTH / sprite.width, CARD_HEIGHT / sprite.height);
      sprite.scale.set(scale);
      sprite.position.set(sprite.pivot.x * scale, sprite.pivot.y * scale);
    };
    sprite.onReorient = placeSprite;
    placeSprite();
    sprite.eventMode = "none";
    tile.addChild(sprite);
    if (selected) {
      const ring = new Graphics()
        .roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 6)
        .stroke({ color: hexToNum(this.theme.appTheme.primary), width: 3 });
      ring.eventMode = "none";
      tile.addChild(ring);
    }
    tile.alpha = disabled ? 0.42 : 1;
    const target: TargetRef = { kind: "card", id: card.id, intent };
    const showPreview = (sticky: boolean) => {
      const bounds = tile.getBounds();
      sprite.setElevation(1);
      sprite.setPromptReference(hexToNum(this.theme.gameTheme.cardRing));
      this.callbacks.onReferenceChange?.(target);
      this.callbacks.onPreviewCard?.(
        card,
        { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        sticky,
      );
      if (sticky) this.stickyPreviewCardId = card.id;
    };
    const hidePreview = () => {
      sprite.setElevation(0);
      sprite.setPromptReference(null);
      this.callbacks.onReferenceChange?.(null);
      if (this.stickyPreviewCardId !== card.id) this.callbacks.onPreviewCard?.(null);
    };
    tile.on("pointerover", (event: FederatedPointerEvent) => {
      if (event.pointerType !== "touch") showPreview(false);
    });
    tile.on("pointerout", hidePreview);
    tile.on("focusin", () => showPreview(false));
    tile.on("focusout", hidePreview);
    tile.on("pointerdown", (event: FederatedPointerEvent) => {
      this.longPress.start(event, card.id, () => showPreview(true));
    });
    tile.on("globalpointermove", (event: FederatedPointerEvent) => {
      this.longPress.move(event.global.x, event.global.y);
    });
    const endTouch = () => {
      this.longPress.cancel();
      this.longPress.releaseFired();
    };
    tile.on("pointerup", endTouch);
    tile.on("pointerupoutside", endTouch);
    tile.on("pointertap", () => {
      if (this.longPress.consumeTap(card.id) || disabled) return;
      onPress?.();
    });
    return tile;
  }

  private renderColors(
    presentation: PromptPresentation,
    validColors: string[],
    amount: number,
    repeatAllowed: boolean,
  ): void {
    const width = Math.min(amount <= 1 ? 680 : 430, this.viewportWidth - 24);
    const height = Math.min(
      this.viewportHeight - 24,
      210 + validColors.length * (amount > 1 ? 42 : 0),
    );
    const shellPresentation = {
      ...presentation,
      title: amount <= 1 ? "Choose a Color" : "Choose Colors",
    };
    const { body } = this.createModalShell(width, height, shellPresentation);
    const colors: Record<string, string> = {
      White: this.theme.gameTheme.mana.W,
      Blue: this.theme.gameTheme.mana.U,
      Black: this.theme.gameTheme.mana.B,
      Red: this.theme.gameTheme.mana.R,
      Green: this.theme.gameTheme.mana.G,
      Colorless: this.theme.gameTheme.mana.C,
      W: this.theme.gameTheme.mana.W,
      U: this.theme.gameTheme.mana.U,
      B: this.theme.gameTheme.mana.B,
      R: this.theme.gameTheme.mana.R,
      G: this.theme.gameTheme.mana.G,
      C: this.theme.gameTheme.mana.C,
    };
    if (amount <= 1) {
      const buttons = validColors.map((color) =>
        this.makeButton(
          color,
          () => this.spec!.respond({ type: "colorDecision", chosenColors: { [color]: 1 } }),
          {
            color: colors[color] ?? this.theme.appTheme.muted,
            foreground: this.theme.gameTheme.textOnTinted,
            width: 112,
            height: 64,
            iconTexture: loadManaSymbolTexture(this.manaSymbol(color)),
            iconTint: false,
            iconSize: 28,
          },
        ),
      );
      this.addButtonRow(body, buttons, 18, width - PANEL_PADDING * 2);
      return;
    }
    let y = 4;
    const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0);
    for (const color of validColors) {
      const count = this.counts.get(color) ?? 0;
      const manaIcon = this.makeManaIcon(this.manaSymbol(color), 28);
      manaIcon.position.set(14, y + 18);
      const colorText = promptText(color, 13, this.theme.appTheme.foreground, { weight: "600" });
      colorText.position.set(38, y + 9);
      body.addChild(manaIcon, colorText);
      const minus = this.makeButton(
        "",
        () => {
          if (count <= 1) this.counts.delete(color);
          else this.counts.set(color, count - 1);
          this.rebuild();
        },
        {
          title: "Remove one",
          icon: "lucide-minus",
          color: colors[color],
          outline: true,
          disabled: count <= 0,
          compact: true,
          width: 34,
        },
      );
      const countText = promptText(String(count), 14, this.theme.appTheme.foreground, {
        weight: "700",
      });
      const plus = this.makeButton(
        "",
        () => {
          this.counts.set(color, count + 1);
          this.rebuild();
        },
        {
          title: "Add one",
          icon: "lucide-plus",
          color: colors[color],
          outline: true,
          disabled: total >= amount || (!repeatAllowed && count >= 1),
          compact: true,
          width: 34,
        },
      );
      minus.position.set(width - PANEL_PADDING * 2 - 104, y);
      countText.position.set(width - PANEL_PADDING * 2 - 58, y + 9);
      plus.position.set(width - PANEL_PADDING * 2 - 34, y);
      body.addChild(minus, countText, plus);
      y += 42;
    }
    const ready = total === amount;
    let previewX = 14;
    for (const [color, count] of this.counts) {
      if (typeof color !== "string") continue;
      for (let index = 0; index < count; index += 1) {
        const icon = this.makeManaIcon(this.manaSymbol(color), 26);
        icon.position.set(previewX, y + 18);
        body.addChild(icon);
        previewX += 30;
      }
    }
    const status = promptText(
      ready ? "Ready" : `${amount - total} left`,
      12,
      ready ? this.theme.gameTheme.success : this.theme.appTheme["muted-foreground"],
      { weight: "600" },
    );
    status.position.set(total > 0 ? previewX + 2 : 0, y + 10);
    body.addChild(status);
    const confirm = this.makeButton(
      "CONFIRM",
      () => {
        const chosenColors: Record<string, number> = {};
        for (const [color, count] of this.counts) {
          if (typeof color === "string" && count > 0) chosenColors[color] = count;
        }
        this.spec!.respond({ type: "colorDecision", chosenColors });
      },
      { disabled: !ready, width: 120 },
    );
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, y);
    body.addChild(confirm);
  }

  private renderNumber(presentation: PromptPresentation, min: number, max: number): void {
    const range = max - min + 1;
    const width = Math.min(520, this.viewportWidth - 24);
    const height = Math.min(300, this.viewportHeight - 24);
    const { body } = this.createModalShell(width, height, presentation);
    if (range <= 10) {
      const buttons = Array.from({ length: range }, (_, index) => {
        const value = min + index;
        return this.makeButton(
          String(value),
          () => this.spec!.respond({ type: "numberDecision", chosenNumber: value }),
          {
            outline: true,
            compact: true,
            width: 48,
            height: 52,
          },
        );
      });
      this.addButtonRow(body, buttons, 20, width - PANEL_PADDING * 2);
      return;
    }
    const parsedValue = Number(this.numberBuffer);
    const isValid =
      this.numberBuffer !== "" &&
      this.numberBuffer !== "-" &&
      Number.isInteger(parsedValue) &&
      parsedValue >= min &&
      parsedValue <= max;
    const valueText = promptText(this.numberBuffer || "—", 34, this.theme.appTheme.foreground, {
      weight: "700",
    });
    valueText.anchor.set(0.5);
    valueText.position.set((width - PANEL_PADDING * 2) / 2, 42);
    body.addChild(valueText);
    const setValue = (value: number) => {
      this.numberValue = Math.max(min, Math.min(max, value));
      this.numberBuffer = String(this.numberValue);
      this.rebuild();
    };
    const buttons = [
      this.makeButton("MIN", () => setValue(min), {
        title: `Set to minimum ${min}`,
        outline: true,
        width: 62,
        height: 52,
      }),
      this.makeButton("", () => setValue((isValid ? parsedValue : min) - 1), {
        title: "Decrease",
        icon: "lucide-minus",
        iconSize: 22,
        outline: true,
        disabled: isValid && parsedValue <= min,
        width: 58,
        height: 52,
      }),
      this.makeButton(
        "",
        () => this.spec!.respond({ type: "numberDecision", chosenNumber: parsedValue }),
        {
          title: "Confirm",
          icon: "lucide-check",
          iconSize: 24,
          disabled: !isValid,
          width: 70,
          height: 52,
        },
      ),
      this.makeButton("", () => setValue((isValid ? parsedValue : min) + 1), {
        title: "Increase",
        icon: "lucide-plus",
        iconSize: 22,
        outline: true,
        disabled: isValid && parsedValue >= max,
        width: 58,
        height: 52,
      }),
      this.makeButton("MAX", () => setValue(max), {
        title: `Set to maximum ${max}`,
        outline: true,
        width: 62,
        height: 52,
      }),
    ];
    this.addButtonRow(body, buttons, 82, width - PANEL_PADDING * 2);
    const rangeText = promptText(
      `Type a value or use the stepper · ${min} to ${max}`,
      12,
      this.theme.appTheme["muted-foreground"],
      { align: "center" },
    );
    rangeText.anchor.set(0.5, 0);
    rangeText.position.set((width - PANEL_PADDING * 2) / 2, 142);
    body.addChild(rangeText);
  }

  private renderReorder(presentation: PromptPresentation, items: ReorderItem[]): void {
    const width = Math.min(800, this.viewportWidth - 24);
    const columns = Math.max(
      1,
      Math.min(items.length, Math.floor((width - PANEL_PADDING * 2) / (CARD_WIDTH + 18))),
    );
    const height = Math.min(
      this.viewportHeight - 24,
      230 + Math.ceil(items.length / columns) * (CARD_HEIGHT + 30),
    );
    const { body } = this.createModalShell(width, height, presentation);
    body.sortableChildren = true;
    const instruction = promptText(
      "Drag cards into order, or use arrow controls · 1 resolves first",
      12,
      this.theme.gameTheme.promptAction.defenseAction,
      { weight: "600" },
    );
    instruction.position.set(0, 2);
    body.addChild(instruction);
    const byId = new Map(items.map((item) => [item.id, item]));
    this.order.forEach((id, index) => {
      const item = byId.get(id);
      if (!item) return;
      const card = this.createCardTile(item.card, false, false);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * (CARD_WIDTH + 18);
      const y = 30 + row * (CARD_HEIGHT + 30);
      const slot = new Graphics()
        .roundRect(x - 4, y - 4, CARD_WIDTH + 8, CARD_HEIGHT + 8, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.35 })
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.75 });
      slot.eventMode = "none";
      body.addChild(slot);
      card.position.set(x, y);
      this.makeDraggable(card, (dropX, dropY) => {
        const localX = dropX - (this.viewportWidth - width) / 2 - PANEL_PADDING;
        const localY = dropY - (this.viewportHeight - height) / 2 - body.y;
        const targetColumn = Math.max(
          0,
          Math.min(columns - 1, Math.floor(localX / (CARD_WIDTH + 18))),
        );
        const targetRow = Math.max(0, Math.floor((localY - 30) / (CARD_HEIGHT + 30)));
        const targetIndex = Math.max(
          0,
          Math.min(this.order.length - 1, targetRow * columns + targetColumn),
        );
        const from = this.order.indexOf(id);
        this.order.splice(from, 1);
        this.order.splice(targetIndex, 0, id);
        this.rebuild();
      });
      const rank = new Graphics()
        .circle(0, 0, 13)
        .fill(hexToNum(index === 0 ? this.theme.appTheme.primary : this.theme.appTheme.muted));
      const rankText = promptText(
        String(index + 1),
        11,
        index === 0 ? this.theme.appTheme["primary-foreground"] : this.theme.appTheme.foreground,
        { weight: "700" },
      );
      rankText.anchor.set(0.5);
      rankText.position.set(0, 0);
      card.addChild(rank, rankText);
      const move = (offset: number) => {
        const target = Math.max(0, Math.min(this.order.length - 1, index + offset));
        if (target === index) return;
        this.order.splice(index, 1);
        this.order.splice(target, 0, id);
        this.rebuild();
      };
      const previous = this.makeButton("", () => move(-1), {
        title: "Move earlier",
        icon: "lucide-chevron-left",
        outline: true,
        compact: true,
        disabled: index === 0,
        width: 32,
      });
      const next = this.makeButton("", () => move(1), {
        title: "Move later",
        icon: "lucide-chevron-right",
        outline: true,
        compact: true,
        disabled: index === this.order.length - 1,
        width: 32,
      });
      previous.scale.set(0.76);
      next.scale.set(0.76);
      previous.position.set(14, CARD_HEIGHT + 4);
      next.position.set(58, CARD_HEIGHT + 4);
      card.addChild(previous, next);
      body.addChild(card);
    });
    const confirm = this.makeButton(
      "CONFIRM ORDER",
      () => this.spec!.respond({ type: "reorderDecision", orderedIds: [...this.order] }),
      { width: 150 },
    );
    confirm.position.set(
      width - PANEL_PADDING * 2 - confirm.buttonWidth,
      40 + Math.ceil(items.length / columns) * (CARD_HEIGHT + 30),
    );
    body.addChild(confirm);
  }

  private renderScry(
    presentation: PromptPresentation,
    cards: CardDto[],
    zones: ScryDestination[],
  ): void {
    const width = Math.min(900, this.viewportWidth - 24);
    const height = Math.min(620, this.viewportHeight - 24);
    const { body } = this.createModalShell(width, height, presentation);
    const byId = new Map(cards.map((card) => [card.id, card]));
    const poolHeight = CARD_HEIGHT + 28;
    const poolWidth = width - PANEL_PADDING * 2;
    const pool = new Rectangle(0, 24, poolWidth, poolHeight);
    const poolBg = new Graphics()
      .roundRect(pool.x, pool.y, pool.width, pool.height, 8)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.6 })
      .stroke({ color: hexToNum(this.theme.appTheme["muted-foreground"]), width: 2, alpha: 0.45 });
    body.addChild(poolBg);
    this.dropZones.push({ id: "pool", rect: this.localRectToGlobal(body, pool), visual: poolBg });
    const poolIds = this.scryItems.pool ?? [];
    poolIds.forEach((id, index) => {
      const card = byId.get(id);
      if (!card) return;
      const tile = this.createCardTile(card, this.scrySelectedId === id, false, () => {
        this.scrySelectedId = this.scrySelectedId === id ? null : id;
        this.rebuild();
      });
      tile.position.set(
        10 +
          index *
            Math.min(
              CARD_WIDTH + 8,
              (poolWidth - CARD_WIDTH - 20) / Math.max(1, poolIds.length - 1),
            ),
        pool.y + 10,
      );
      this.makeDraggable(tile, (x, y) => this.dropScryCard(id, x, y));
      body.addChild(tile);
    });
    const zoneGap = 12;
    const zoneY = pool.y + pool.height + 34;
    const zoneWidth = (poolWidth - zoneGap * (zones.length - 1)) / Math.max(1, zones.length);
    const zoneHeight = Math.max(130, height - body.y - zoneY - 70);
    zones.forEach((destination, index) => {
      const key = `zone-${index}`;
      const rect = new Rectangle(index * (zoneWidth + zoneGap), zoneY, zoneWidth, zoneHeight);
      const zoneBg = new Graphics()
        .roundRect(rect.x, rect.y, rect.width, rect.height, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.45 })
        .stroke({
          color: hexToNum(this.theme.appTheme["muted-foreground"]),
          width: 2,
          alpha: 0.45,
        });
      zoneBg.eventMode = "static";
      zoneBg.cursor = this.scrySelectedId ? "pointer" : "default";
      zoneBg.accessible = true;
      zoneBg.accessibleTitle = `Move selected card to ${this.scryDestinationLabel(destination)}`;
      zoneBg.tabIndex = this.scrySelectedId ? 0 : -1;
      zoneBg.on("pointertap", () => {
        if (this.scrySelectedId) this.moveScryCard(this.scrySelectedId, key);
      });
      body.addChild(zoneBg);
      const label = promptText(
        this.scryDestinationLabel(destination),
        11,
        this.theme.appTheme["muted-foreground"],
        { weight: "700" },
      );
      label.position.set(rect.x + 8, rect.y - 22);
      body.addChild(label);
      this.dropZones.push({
        id: key,
        rect: this.localRectToGlobal(body, rect),
        visual: zoneBg,
      });
      const ids = this.scryItems[key] ?? [];
      ids.forEach((id, cardIndex) => {
        const card = byId.get(id);
        if (!card) return;
        const tile = this.createCardTile(
          card,
          this.scrySelectedId === id,
          cardIndex !== ids.length - 1,
          cardIndex === ids.length - 1
            ? () => {
                this.scrySelectedId = this.scrySelectedId === id ? null : id;
                this.rebuild();
              }
            : undefined,
        );
        tile.position.set(rect.x + (rect.width - CARD_WIDTH) / 2, rect.y + 10 + cardIndex * 18);
        if (cardIndex === ids.length - 1)
          this.makeDraggable(tile, (x, y) => this.dropScryCard(id, x, y));
        body.addChild(tile);
      });
      if (ids.length === 0) this.addScryDestinationHint(body, destination, rect);
    });
    const allPlaced = poolIds.length === 0;
    const status = promptText(
      `${cards.length - poolIds.length}/${cards.length} placed`,
      12,
      this.theme.appTheme["muted-foreground"],
    );
    status.position.set(0, height - body.y - 42);
    body.addChild(status);
    const confirm = this.makeButton(
      "CONFIRM",
      () => {
        this.spec!.respond({
          type: "scryDecision",
          zoneCardIds: zones.map((_, index) =>
            [...(this.scryItems[`zone-${index}`] ?? [])].reverse(),
          ),
        });
      },
      { disabled: !allPlaced, width: 120 },
    );
    confirm.position.set(poolWidth - confirm.buttonWidth, height - body.y - 50);
    body.addChild(confirm);
  }

  private dropScryCard(cardId: string, x: number, y: number): void {
    const target = this.dropZones.find((zone) => zone.rect.contains(x, y));
    if (!target) {
      this.rebuild();
      return;
    }
    this.moveScryCard(cardId, target.id);
  }

  private moveScryCard(cardId: string, targetId: string): void {
    let source: string | undefined;
    for (const [key, ids] of Object.entries(this.scryItems)) {
      if (ids.includes(cardId)) {
        source = key;
        break;
      }
    }
    if (!source || source === targetId) {
      this.rebuild();
      return;
    }
    this.scryItems[source] = this.scryItems[source]!.filter((id) => id !== cardId);
    this.scryItems[targetId] = [...(this.scryItems[targetId] ?? []), cardId];
    this.scrySelectedId = null;
    this.rebuild();
  }

  private scryDestinationLabel(destination: ScryDestination): string {
    switch (destination) {
      case "libraryTop":
        return "TOP OF LIBRARY";
      case "libraryBottom":
        return "BOTTOM OF LIBRARY";
      case "graveyard":
        return "GRAVEYARD";
      case "exile":
        return "EXILE";
      case "hand":
        return "HAND";
    }
  }

  private addScryDestinationHint(
    body: Container,
    destination: ScryDestination,
    rect: Rectangle,
  ): void {
    const color = this.theme.appTheme["muted-foreground"];
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2 - 8;
    if (destination === "libraryTop" || destination === "libraryBottom") {
      if (destination === "libraryTop") {
        const deck = this.makeIcon("deck", 42, color);
        deck.position.set(centerX + 4, centerY);
        body.addChild(deck);
      } else {
        const card = new Graphics();
        for (let x = -24; x < 24; x += 10) {
          card.moveTo(x, -18).lineTo(Math.min(x + 6, 24), -18);
          card.moveTo(x, 18).lineTo(Math.min(x + 6, 24), 18);
        }
        for (let y = -18; y < 18; y += 10) {
          card.moveTo(-24, y).lineTo(-24, Math.min(y + 6, 18));
          card.moveTo(24, y).lineTo(24, Math.min(y + 6, 18));
        }
        card.stroke({ color: hexToNum(color), width: 2, alpha: 0.7 });
        card.position.set(centerX + 4, centerY);
        body.addChild(card);
      }
      const arrow = this.makeIcon("arrow-dunk", 26, color);
      arrow.position.set(centerX - 17, centerY - 24);
      body.addChild(arrow);
    } else {
      const icon = this.makeIcon(destination, 44, color);
      icon.position.set(centerX, centerY);
      body.addChild(icon);
    }
    const hint = promptText(this.scryDestinationHint(destination), 11, color, {
      weight: "600",
      align: "center",
    });
    hint.anchor.set(0.5, 0);
    hint.position.set(centerX, centerY + 32);
    body.addChild(hint);
  }

  private scryDestinationHint(destination: ScryDestination): string {
    switch (destination) {
      case "libraryTop":
        return "Put on top";
      case "libraryBottom":
        return "Send to bottom";
      case "graveyard":
        return "To graveyard";
      case "exile":
        return "Exile";
      case "hand":
        return "To hand";
    }
  }
  private renderDamageOrder(): void {
    const damageOrder = this.spec!.damageOrder;
    if (!damageOrder) return;
    const width = Math.min(500, this.viewportWidth - 24);
    const height = Math.min(this.viewportHeight - 24, 260 + damageOrder.blockerCards.length * 64);
    const input = this.spec!.currentPrompt?.input;
    const targets: TargetRef[] =
      input?.type === "chooseDamageAssignmentOrder"
        ? [
            { kind: "card", id: input.attackerId, intent: "damage" },
            ...damageOrder.blockerCards.map((card) => ({
              kind: "card" as const,
              id: card.id,
              intent: "damage" as const,
            })),
          ]
        : damageOrder.blockerCards.map((card) => ({
            kind: "card" as const,
            id: card.id,
            intent: "damage" as const,
          }));
    const presentation: PromptPresentation = {
      title: "Order Combat Damage",
      description: `${damageOrder.attackerName} is blocked by ${damageOrder.blockerCards.length} creatures — choose the order it assigns damage.`,
      targets,
    };
    const { body } = this.createModalShell(width, height, presentation, false, true);
    const complete =
      damageOrder.order.length >= damageOrder.blockerCards.length &&
      damageOrder.blockerCards.length > 0;
    const instruction = promptText(
      damageOrder.order.length === 0
        ? "Choose blockers in the order damage is dealt."
        : complete
          ? "Order set — confirm to deal damage."
          : `Choose the next blocker (${damageOrder.order.length}/${damageOrder.blockerCards.length}).`,
      12,
      this.theme.appTheme["muted-foreground"],
      { width: width - PANEL_PADDING * 2 },
    );
    instruction.position.set(0, 4);
    body.addChild(instruction);
    let y = instruction.height + 16;
    for (const card of damageOrder.blockerCards) {
      const index = damageOrder.order.indexOf(card.id);
      const row = new Container();
      row.position.set(0, y);
      row.eventMode = "static";
      row.cursor = "pointer";
      row.hitArea = new Rectangle(0, 0, width - PANEL_PADDING * 2, 52);
      row.accessible = true;
      row.accessibleTitle =
        index >= 0 ? `${card.identity.name}, damage order ${index + 1}` : card.identity.name;
      row.tabIndex = 0;
      const background = new Graphics()
        .roundRect(0, 0, width - PANEL_PADDING * 2, 52, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.62 })
        .stroke({
          color: hexToNum(index >= 0 ? this.theme.appTheme.primary : this.theme.appTheme.border),
          width: index >= 0 ? 2 : 1,
        });
      const rank = promptText(
        index >= 0 ? String(index + 1) : "—",
        16,
        this.theme.appTheme.foreground,
        {
          weight: "700",
        },
      );
      rank.anchor.set(0.5);
      rank.position.set(24, 26);
      const label = promptText(card.identity.name, 13, this.theme.appTheme.foreground, {
        weight: "600",
        width: width - PANEL_PADDING * 2 - 76,
      });
      label.position.set(48, 16);
      row.addChild(background, rank, label);
      const target: TargetRef = { kind: "card", id: card.id, intent: "damage" };
      row.on("pointerover", () => this.callbacks.onReferenceChange?.(target));
      row.on("pointerout", () => this.callbacks.onReferenceChange?.(null));
      row.on("focusin", () => this.callbacks.onReferenceChange?.(target));
      row.on("focusout", () => this.callbacks.onReferenceChange?.(null));
      row.on("pointertap", () => damageOrder.onToggle(card.id));
      body.addChild(row);
      y += 62;
    }
    const buttons = [
      this.makeButton("AUTO", damageOrder.onAuto, {
        outline: true,
        disabled: this.spec!.isWaitingForResponse,
      }),
    ];
    if (damageOrder.order.length > 0) {
      buttons.push(
        this.makeButton("UNDO", damageOrder.onUndo, {
          outline: true,
          disabled: this.spec!.isWaitingForResponse,
        }),
      );
    }
    buttons.push(
      this.makeButton("CONFIRM", damageOrder.onConfirm, {
        disabled: this.spec!.isWaitingForResponse || !complete,
        icon: "lucide-swords",
      }),
    );
    this.addButtonRow(body, buttons, y + 14, width - PANEL_PADDING * 2, "right");
  }

  private renderCombatDamage(input: ChooseCombatDamageAssignmentInput): void {
    const width = Math.min(500, this.viewportWidth - 24);
    const assignees = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
    const height = Math.min(this.viewportHeight - 24, 250 + assignees.length * 64);
    const attacker = this.spec!.gameView.battlefield.find((card) => card.id === input.attackerId);
    const targets: TargetRef[] = [
      { kind: "card", id: input.attackerId, intent: "damage" },
      ...input.blockerIds.map((id) => ({
        kind: "card" as const,
        id,
        intent: "damage" as const,
      })),
      ...(input.defenderId
        ? [{ kind: "player" as const, id: input.defenderId, intent: "damage" as const }]
        : []),
    ];
    const presentation: PromptPresentation = {
      title: "Assign Combat Damage",
      description: attacker
        ? `${attacker.identity.name} must assign ${input.totalDamage} damage.`
        : undefined,
      targets,
    };
    const { body } = this.createModalShell(width, height, presentation, true, true);
    const remaining =
      input.totalDamage -
      Object.values(this.damageAssigned).reduce((sum, damage) => sum + damage, 0);
    let y = 4;
    assignees.forEach((id, index) => {
      const damage = this.damageAssigned[id] ?? 0;
      const lethal =
        id === input.defenderId ? null : this.combatLethal(id, input.attackerHasDeathtouch);
      const blocked = assignees
        .slice(0, index)
        .some(
          (earlier) =>
            earlier !== input.defenderId &&
            (this.damageAssigned[earlier] ?? 0) <
              this.combatLethal(earlier, input.attackerHasDeathtouch),
        );
      const label = this.combatLabel(id);
      const rowBg = new Graphics()
        .roundRect(0, y, width - PANEL_PADDING * 2, 48, 6)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.55 })
        .stroke({
          color: hexToNum(
            lethal != null && damage >= lethal
              ? this.theme.appTheme.destructive
              : this.theme.appTheme.border,
          ),
          width: 1,
        });
      rowBg.eventMode = "static";
      rowBg.cursor = "default";
      rowBg.accessible = true;
      rowBg.accessibleTitle = `Damage assigned to ${label}: ${damage}${
        lethal == null ? "" : `, lethal damage ${lethal}`
      }`;
      rowBg.tabIndex = 0;
      const target: TargetRef =
        id === input.defenderId
          ? { kind: "player", id, intent: "damage" }
          : { kind: "card", id, intent: "damage" };
      rowBg.on("pointerover", () => this.callbacks.onReferenceChange?.(target));
      rowBg.on("pointerout", () => this.callbacks.onReferenceChange?.(null));
      rowBg.on("focusin", () => this.callbacks.onReferenceChange?.(target));
      rowBg.on("focusout", () => this.callbacks.onReferenceChange?.(null));
      body.addChild(rowBg);
      const defender = this.spec!.gameView.players.find((player) => player.id === id);
      const projectedLife =
        defender && damage > 0 ? `  ·  ${defender.life} → ${defender.life - damage} life` : "";
      const text = promptText(
        `${label}${lethal != null ? `  ·  Lethal ${lethal}` : ""}${projectedLife}`,
        12,
        this.theme.appTheme.foreground,
        { weight: "600", width: width - 250 },
      );
      text.position.set(10, y + 15);
      body.addChild(text);
      if (lethal != null && lethal > 0 && damage >= lethal) {
        const skull = this.makeIcon("lucide-skull", 14, this.theme.appTheme.destructive);
        skull.position.set(width - PANEL_PADDING * 2 - 122, y + 24);
        body.addChild(skull);
      }
      if (lethal != null) {
        const lethalButton = this.makeButton(
          "LETHAL",
          () => {
            this.damageAssigned[id] = Math.min(
              input.totalDamage,
              damage + Math.max(0, lethal - damage),
            );
            this.normalizeDamage(input, assignees);
            this.rebuild();
          },
          {
            title: `Assign lethal damage to ${label}`,
            outline: true,
            disabled: blocked || damage >= lethal || remaining <= 0,
            compact: true,
            width: 54,
          },
        );
        lethalButton.position.set(width - PANEL_PADDING * 2 - 164, y + 5);
        body.addChild(lethalButton);
      }
      const minus = this.makeButton(
        "−",
        () => {
          this.damageAssigned[id] = Math.max(0, damage - 1);
          this.normalizeDamage(input, assignees);
          this.rebuild();
        },
        { outline: true, disabled: damage <= 0, compact: true, width: 34 },
      );
      const amount = promptText(String(damage), 14, this.theme.appTheme.foreground, {
        weight: "700",
      });
      const plus = this.makeButton(
        "+",
        () => {
          this.damageAssigned[id] = damage + 1;
          this.normalizeDamage(input, assignees);
          this.rebuild();
        },
        { outline: true, disabled: blocked || remaining <= 0, compact: true, width: 34 },
      );
      minus.position.set(width - PANEL_PADDING * 2 - 104, y + 5);
      amount.position.set(width - PANEL_PADDING * 2 - 60, y + 14);
      plus.position.set(width - PANEL_PADDING * 2 - 34, y + 5);
      body.addChild(minus, amount, plus);
      y += 56;
    });
    const remainingText = promptText(
      `Remaining damage: ${remaining}`,
      12,
      this.theme.appTheme["muted-foreground"],
    );
    remainingText.position.set(0, y + 8);
    body.addChild(remainingText);
    const legal = remaining === 0 && this.damageLegallyOrdered(input, assignees);
    const buttons = [
      this.makeButton(
        "RESET",
        () => {
          this.damageAssigned = {};
          this.rebuild();
        },
        { outline: true },
      ),
      this.makeButton(
        "AUTO",
        () => {
          this.autoAssignDamage(input, assignees);
          this.rebuild();
        },
        { outline: true },
      ),
      this.makeButton(
        "CONFIRM",
        () =>
          this.spec!.respond({
            type: "combatDamageAssignmentDecision",
            assignments: assignees.map((assigneeId) => ({
              assigneeId,
              damage: this.damageAssigned[assigneeId] ?? 0,
            })),
          }),
        { disabled: !legal },
      ),
    ];
    this.addButtonRow(body, buttons, y + 32, width - PANEL_PADDING * 2, "right");
  }

  private combatLabel(id: string): string {
    return (
      this.spec!.gameView.battlefield.find((card) => card.id === id)?.identity.name ??
      this.spec!.gameView.players.find((player) => player.id === id)?.name ??
      id
    );
  }

  private combatLethal(id: string, deathtouch: boolean): number {
    const card = this.spec!.gameView.battlefield.find((candidate) => candidate.id === id);
    if (!card) return 0;
    if (card.types?.includes("Planeswalker")) {
      return Math.max(0, card.counters?.LOYALTY ?? card.counters?.Loyalty ?? 0);
    }
    if (deathtouch) return 1;
    return Math.max(0, parseCombatNumber(card.toughness) - (card.damage ?? 0));
  }

  private normalizeDamage(input: ChooseCombatDamageAssignmentInput, assignees: string[]): void {
    let blocked = false;
    for (const id of assignees) {
      if (id === input.defenderId) {
        if (blocked) this.damageAssigned[id] = 0;
        continue;
      }
      if (blocked) this.damageAssigned[id] = 0;
      if ((this.damageAssigned[id] ?? 0) < this.combatLethal(id, input.attackerHasDeathtouch))
        blocked = true;
    }
    let assigned = Object.values(this.damageAssigned).reduce((sum, damage) => sum + damage, 0);
    if (assigned <= input.totalDamage) return;
    for (let index = assignees.length - 1; index >= 0 && assigned > input.totalDamage; index -= 1) {
      const id = assignees[index]!;
      const remove = Math.min(this.damageAssigned[id] ?? 0, assigned - input.totalDamage);
      this.damageAssigned[id] = (this.damageAssigned[id] ?? 0) - remove;
      assigned -= remove;
    }
  }

  private damageLegallyOrdered(
    input: ChooseCombatDamageAssignmentInput,
    assignees: string[],
  ): boolean {
    let blocked = false;
    for (const id of assignees) {
      const damage = this.damageAssigned[id] ?? 0;
      if (blocked && damage > 0) return false;
      if (id !== input.defenderId && damage < this.combatLethal(id, input.attackerHasDeathtouch))
        blocked = true;
    }
    return true;
  }

  private autoAssignDamage(input: ChooseCombatDamageAssignmentInput, assignees: string[]): void {
    this.damageAssigned = {};
    let remaining = input.totalDamage;
    for (const id of assignees) {
      if (remaining <= 0 || id === input.defenderId) continue;
      const damage = Math.min(remaining, this.combatLethal(id, input.attackerHasDeathtouch));
      this.damageAssigned[id] = damage;
      remaining -= damage;
    }
    if (remaining > 0) {
      const target = input.defenderId ?? assignees.at(-1);
      if (target) this.damageAssigned[target] = (this.damageAssigned[target] ?? 0) + remaining;
    }
    this.normalizeDamage(input, assignees);
  }

  private createDieFace(sides: number, size: number, color: string): Graphics {
    const half = size / 2;
    const die = new Graphics();
    switch (sides) {
      case 4:
        die.poly([0, -half, half, half, -half, half]);
        break;
      case 6:
        die.roundRect(-half, -half, size, size, size * 0.16);
        break;
      case 8:
        die.poly([0, -half, half, 0, 0, half, -half, 0]);
        break;
      case 10:
        die.poly([
          0,
          -half,
          half * 0.82,
          -half * 0.18,
          half * 0.48,
          half,
          -half * 0.48,
          half,
          -half * 0.82,
          -half * 0.18,
        ]);
        break;
      case 12:
        die.poly([
          -half * 0.55,
          -half,
          half * 0.55,
          -half,
          half,
          -half * 0.25,
          half * 0.8,
          half * 0.72,
          0,
          half,
          -half * 0.8,
          half * 0.72,
          -half,
          -half * 0.25,
        ]);
        break;
      case 20:
        die.poly([
          -half * 0.42,
          -half,
          half * 0.42,
          -half,
          half,
          -half * 0.42,
          half,
          half * 0.42,
          half * 0.42,
          half,
          -half * 0.42,
          half,
          -half,
          half * 0.42,
          -half,
          -half * 0.42,
        ]);
        break;
      default:
        die.circle(0, 0, half);
        break;
    }
    die
      .fill({ color: hexToNum(color), alpha: 0.95 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), width: 2 });
    return die;
  }

  private renderDice(
    presentation: PromptPresentation,
    sides: number,
    rolls: Array<{
      label?: string;
      finalResults: number[];
      ignoredRolls: number[];
      highlighted: boolean;
    }>,
  ): void {
    this.diceVisuals = [];
    this.diceWinnerText = null;
    this.diceConfirm = null;
    this.diceSettled = !animationsEnabled() || this.diceElapsedMs >= DICE_ROLL_MS;
    const entries = rolls.flatMap((roll, rollIndex) =>
      roll.finalResults.map((value, resultIndex) => ({
        value,
        label:
          roll.finalResults.length > 1
            ? `${roll.label ?? `Roll ${rollIndex + 1}`} ${resultIndex + 1}`
            : roll.label,
        highlighted: roll.highlighted,
      })),
    );
    const width = Math.min(520, this.viewportWidth - 24);
    const columns = Math.max(1, Math.min(5, entries.length));
    const rows = Math.max(1, Math.ceil(entries.length / columns));
    const dieSize = Math.min(64, (width - PANEL_PADDING * 2 - ROW_GAP * (columns - 1)) / columns);
    const rowPitch = dieSize + 34;
    const height = Math.min(Math.max(330, 190 + rows * rowPitch), this.viewportHeight - 24);
    const title =
      rolls.length === 1 && !rolls[0]?.label
        ? `Rolled ${(rolls[0]?.finalResults ?? []).join(", ")} (d${sides})`
        : presentation.title || "Dice roll";
    const { body } = this.createModalShell(width, height, { ...presentation, title });
    const settled = this.diceSettled;
    entries.forEach((entry, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, entries.length - row * columns);
      const rowWidth = rowCount * dieSize + (rowCount - 1) * ROW_GAP;
      const rowStart = (width - PANEL_PADDING * 2 - rowWidth) / 2;
      const x = rowStart + column * (dieSize + ROW_GAP) + dieSize / 2;
      const y = 18 + row * rowPitch + dieSize / 2;
      const shownValue = settled
        ? entry.value
        : ((Math.floor(this.diceElapsedMs / 75) + index * 7) % Math.max(1, sides)) + 1;
      const die = this.createDieFace(
        sides,
        dieSize,
        entry.highlighted ? this.theme.gameTheme.success : this.theme.appTheme.muted,
      );
      die.position.set(x, y);
      die.rotation =
        Math.sin(this.diceElapsedMs / 90 + index) *
        Math.max(0, 1 - this.diceElapsedMs / DICE_ROLL_MS) *
        0.35;
      body.addChild(die);
      const valueText = promptText(String(shownValue), 26, this.theme.appTheme.foreground, {
        weight: "700",
      });
      valueText.anchor.set(0.5);
      valueText.position.set(x, y);
      body.addChild(valueText);
      this.diceVisuals.push({
        die,
        value: valueText,
        finalValue: entry.value,
        index,
        sides,
      });
      if (entry.label) {
        const label = promptText(entry.label, 10, this.theme.appTheme["muted-foreground"], {
          weight: "600",
          width: dieSize + ROW_GAP,
          align: "center",
        });
        label.anchor.set(0.5, 0);
        label.position.set(x, y + dieSize / 2 + 5);
        body.addChild(label);
      }
    });
    const resultBottom = 18 + rows * rowPitch;
    const winner = rolls.find((roll) => roll.highlighted);
    if (winner) {
      const winnerText = promptText(
        `First player: ${winner.label ?? winner.finalResults.join(", ")}`,
        13,
        this.theme.gameTheme.success,
        { weight: "700" },
      );
      winnerText.anchor.set(0.5);
      winnerText.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 4);
      winnerText.visible = settled;
      this.diceWinnerText = winnerText;
      body.addChild(winnerText);
    }
    const ignored = rolls.flatMap((roll) => roll.ignoredRolls);
    if (ignored.length) {
      const ignoredText = promptText(
        `Ignored rolls: ${ignored.map((value) => `×${value}`).join("  ")}`,
        11,
        this.theme.appTheme["muted-foreground"],
      );
      ignoredText.anchor.set(0.5);
      ignoredText.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 28);
      body.addChild(ignoredText);
    }
    const confirm = this.makeButton(
      "CONTINUE",
      () => this.spec!.respond({ type: "diceRolledAcknowledged" }),
      { disabled: !settled, width: 120 },
    );
    this.diceConfirm = confirm;
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, height - body.y - 48);
    body.addChild(confirm);
    this.syncDiceVisuals();
  }

  private renderGameOver(): void {
    const gameOver = this.spec!.gameOver!;
    const anyConceded =
      gameOver.me.status === "conceded" ||
      gameOver.opponents.some((player) => player.status === "conceded");
    let heading = "Draw";
    let color = this.theme.appTheme["muted-foreground"];
    if (gameOver.me.status === "conceded") {
      heading = "You Conceded";
      color = this.theme.appTheme.destructive;
    } else if (gameOver.winnerId === gameOver.me.id) {
      heading = "Victory";
      color = this.theme.gameTheme.success;
    } else if (gameOver.winnerId != null) {
      heading = "Defeat";
      color = this.theme.appTheme.destructive;
    } else if (anyConceded) {
      const names = gameOver.opponents
        .filter((player) => player.status === "conceded")
        .map((player) => player.name);
      if (names.length) heading = `${names.join(" and ")} Conceded`;
    }
    const backdrop = new Graphics()
      .rect(0, 0, this.viewportWidth, this.viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.72 });
    backdrop.eventMode = "static";
    this.container.addChild(backdrop);
    const panelWidth = Math.min(520, this.viewportWidth - 24);
    const panelHeight = 250;
    const group = this.panel(panelWidth, panelHeight, 0, 0, 12);
    group.accessible = true;
    group.accessibleTitle = `Game over: ${heading}`;
    group.tabIndex = 0;
    const accent = new Graphics()
      .roundRect(0, 0, panelWidth, 4, 12)
      .fill({ color: hexToNum(color) });
    group.addChild(accent);
    const title = promptText(heading, 36, color, { weight: "700" });
    title.anchor.set(0.5);
    title.position.set(panelWidth / 2, 56);
    group.addChild(title);
    const life = promptText(
      `You ${gameOver.me.life} life  ·  ${gameOver.opponents
        .map((player) => `${player.name} ${player.life}`)
        .join("  ·  ")}`,
      14,
      this.theme.appTheme.foreground,
      { align: "center", width: panelWidth - 40, weight: "600" },
    );
    life.anchor.set(0.5, 0);
    life.position.set(panelWidth / 2, 94);
    group.addChild(life);
    const turn = promptText(
      `Game ended on turn ${gameOver.turn}`,
      12,
      this.theme.appTheme["muted-foreground"],
    );
    turn.anchor.set(0.5);
    turn.position.set(panelWidth / 2, 140);
    group.addChild(turn);
    const button = this.makeButton("RETURN TO MENU", gameOver.onEndGame, {
      color,
      width: 170,
      height: 48,
      icon: "lucide-log-out",
    });
    button.position.set((panelWidth - button.buttonWidth) / 2, 176);
    group.addChild(button);
    group.position.set(
      (this.viewportWidth - panelWidth) / 2,
      (this.viewportHeight - panelHeight) / 2,
    );
    this.container.addChild(group);
    if (animationsEnabled()) {
      gsap.from(group.scale, {
        x: 0.96,
        y: 0.96,
        duration: 0.35,
        ease: "back.out(1.4)",
      });
    }
  }

  private makeDraggable(item: Container, onDrop: (x: number, y: number) => void): void {
    item.eventMode = "static";
    item.cursor = "grab";
    item.on("pointerdown", (event: FederatedPointerEvent) => {
      const parent = item.parent;
      if (!parent) return;
      const point = parent.toLocal(event.global);
      this.drag = {
        item,
        offsetX: point.x - item.x,
        offsetY: point.y - item.y,
        onDrop,
      };
      item.cursor = "grabbing";
      item.alpha = 0.96;
      item.zIndex = 1000;
      event.stopPropagation();
    });
  }

  private moveDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    const parent = drag?.item.parent;
    if (!drag || !parent) return;
    const parentPoint = parent.toLocal(event.global);
    drag.item.position.set(parentPoint.x - drag.offsetX, parentPoint.y - drag.offsetY);
    for (const zone of this.dropZones) {
      const active = zone.rect.contains(event.global.x, event.global.y);
      zone.visual.alpha = active ? 1 : 0.58;
    }
  }

  private finishDrag(event: FederatedPointerEvent): void {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    for (const zone of this.dropZones) zone.visual.alpha = 1;
    drag.onDrop(event.global.x, event.global.y);
  }

  private localRectToGlobal(container: Container, rect: Rectangle): Rectangle {
    const topLeft = container.toGlobal({ x: rect.x, y: rect.y });
    return new Rectangle(topLeft.x, topLeft.y, rect.width, rect.height);
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.spec || !this.modalOpen) return;
    if (this.spec.gameOver && event.key === "Enter") {
      event.preventDefault();
      this.spec.gameOver.onEndGame();
      return;
    }
    const input = this.spec.currentPrompt?.input;
    if (
      input?.type === "chooseFromSelection" &&
      input.options.length > 5 &&
      (event.key === "Backspace" ||
        (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey))
    ) {
      event.preventDefault();
      this.selectionFilter =
        event.key === "Backspace"
          ? this.selectionFilter.slice(0, -1)
          : `${this.selectionFilter}${event.key}`;
      this.rebuild();
      return;
    }
    if (event.key === "Escape" && this.selectionFilter) {
      event.preventDefault();
      this.selectionFilter = "";
      this.rebuild();
      return;
    }
    if (
      event.key === "Escape" &&
      input?.type !== "chooseDamageAssignmentOrder" &&
      !this.spec.gameOver
    ) {
      event.preventDefault();
      this.spec.onHideModal();
      return;
    }
    if (!input) return;
    if (input.type === "chooseNumber" && input.max - input.min + 1 > 10) {
      const parsed = Number(this.numberBuffer);
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        this.numberValue = Math.max(input.min, (Number.isInteger(parsed) ? parsed : input.min) - 1);
        this.numberBuffer = String(this.numberValue);
        this.rebuild();
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        this.numberValue = Math.min(input.max, (Number.isInteger(parsed) ? parsed : input.min) + 1);
        this.numberBuffer = String(this.numberValue);
        this.rebuild();
      } else if (/^\d$/.test(event.key) || (event.key === "-" && input.min < 0)) {
        event.preventDefault();
        this.numberBuffer =
          event.key === "-"
            ? this.numberBuffer.startsWith("-")
              ? this.numberBuffer
              : `-${this.numberBuffer}`
            : this.numberBuffer === "0"
              ? event.key
              : `${this.numberBuffer}${event.key}`;
        this.rebuild();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        this.numberBuffer = this.numberBuffer.slice(0, -1);
        this.rebuild();
      } else if (
        event.key === "Enter" &&
        this.numberBuffer !== "" &&
        this.numberBuffer !== "-" &&
        Number.isInteger(parsed) &&
        parsed >= input.min &&
        parsed <= input.max
      ) {
        event.preventDefault();
        this.spec.respond({ type: "numberDecision", chosenNumber: parsed });
      }
      return;
    }
    if (event.code !== "Space" && event.key !== "Enter") return;
    if (input.type === "chooseBoolean" && event.code === "Space") {
      event.preventDefault();
      this.spec.respond({ type: "decision", value: true });
    } else if (input.type === "revealCards" && event.key === "Enter") {
      event.preventDefault();
      this.spec.respond({ type: "revealCardsAcknowledged" });
    } else if (input.type === "chooseCards" && event.key === "Enter") {
      const chosen = [...this.selectedIds];
      if (chosen.length >= input.min && chosen.length <= input.max) {
        event.preventDefault();
        this.spec.respond({ type: "chooseCardsDecision", chosenCardIds: chosen });
      }
    } else if (input.type === "chooseColor" && event.key === "Enter") {
      const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0);
      if (total === input.amount) {
        const chosenColors: Record<string, number> = {};
        for (const [color, count] of this.counts) {
          if (typeof color === "string" && count > 0) chosenColors[color] = count;
        }
        event.preventDefault();
        this.spec.respond({ type: "colorDecision", chosenColors });
      }
    } else if (input.type === "chooseFromSelection" && event.key === "Enter") {
      const total = this.selectionTotal(input.options);
      if (total >= input.minTotal && total <= input.maxTotal) {
        event.preventDefault();
        const chosenIndices = [...this.counts.entries()]
          .sort(([left], [right]) => Number(left) - Number(right))
          .flatMap(([index, count]) => Array.from({ length: count }, () => Number(index)));
        this.spec.respond({ type: "selectionDecision", chosenIndices });
      }
    } else if (input.type === "reorder" && event.key === "Enter") {
      event.preventDefault();
      this.spec.respond({ type: "reorderDecision", orderedIds: [...this.order] });
    } else if (input.type === "scry" && event.key === "Enter") {
      if ((this.scryItems.pool ?? []).length === 0) {
        event.preventDefault();
        this.spec.respond({
          type: "scryDecision",
          zoneCardIds: input.zones.map((_, index) =>
            [...(this.scryItems[`zone-${index}`] ?? [])].reverse(),
          ),
        });
      }
    } else if (input.type === "chooseDamageAssignmentOrder" && event.key === "Enter") {
      if (
        this.spec.damageOrder &&
        this.spec.damageOrder.order.length >= this.spec.damageOrder.blockerCards.length
      ) {
        event.preventDefault();
        this.spec.damageOrder.onConfirm();
      }
    } else if (
      input.type === "diceRolled" &&
      event.key === "Enter" &&
      this.diceElapsedMs >= DICE_ROLL_MS
    ) {
      event.preventDefault();
      this.spec.respond({ type: "diceRolledAcknowledged" });
    } else if (input.type === "chooseCombatDamageAssignment" && event.key === "Enter") {
      const assignees = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
      const remaining =
        input.totalDamage -
        Object.values(this.damageAssigned).reduce((sum, value) => sum + value, 0);
      if (remaining === 0 && this.damageLegallyOrdered(input, assignees)) {
        event.preventDefault();
        this.spec.respond({
          type: "combatDamageAssignmentDecision",
          assignments: assignees.map((assigneeId) => ({
            assigneeId,
            damage: this.damageAssigned[assigneeId] ?? 0,
          })),
        });
      }
    }
  }

  private syncDiceVisuals(): void {
    const settled = !animationsEnabled() || this.diceElapsedMs >= DICE_ROLL_MS;
    for (const visual of this.diceVisuals) {
      visual.value.text = String(
        settled
          ? visual.finalValue
          : ((Math.floor(this.diceElapsedMs / 70) + visual.index * 7) % Math.max(1, visual.sides)) +
              1,
      );
      visual.die.rotation = settled
        ? 0
        : Math.sin(this.diceElapsedMs / 80 + visual.index) *
          Math.max(0, 1 - this.diceElapsedMs / DICE_ROLL_MS) *
          0.35;
    }
    if (!settled || this.diceSettled) return;
    this.diceSettled = true;
    if (this.diceWinnerText) this.diceWinnerText.visible = true;
    this.diceConfirm?.setDisabled(false);
    if (!animationsEnabled()) return;
    for (const visual of this.diceVisuals) {
      gsap.fromTo(
        visual.die.scale,
        { x: 0.86, y: 0.86 },
        { x: 1, y: 1, duration: 0.28, ease: "back.out(2)" },
      );
    }
  }

  private tick(ticker: Ticker): void {
    const input = this.spec?.currentPrompt?.input;
    if (!this.modalOpen || input?.type !== "diceRolled" || this.diceElapsedMs >= DICE_FINISH_MS)
      return;
    this.diceElapsedMs = animationsEnabled()
      ? Math.min(DICE_FINISH_MS, this.diceElapsedMs + ticker.deltaMS)
      : DICE_FINISH_MS;
    this.syncDiceVisuals();
  }
}
