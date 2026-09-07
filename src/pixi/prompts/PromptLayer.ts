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
import { AUTOPASS_DELAY_MAX_MS, AUTOPASS_DELAY_MIN_MS } from "@/components/game/game.constants";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import type {
  CardDto,
  ChooseCombatDamageAssignmentInput,
  PromptPresentation,
  ReorderItem,
  ScryDestination,
  SelectionOption,
} from "@/protocol";
import { PromptButton } from "./PromptButton";
import type { PromptOverlaySpec } from "./prompt.types";

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
const CARD_WIDTH = 86;
const CARD_HEIGHT = 120;

interface DragState {
  item: Container;
  offsetX: number;
  offsetY: number;
  onDrop: (x: number, y: number) => void;
}

interface DropZone {
  id: string;
  rect: Rectangle;
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
  private spec: PromptOverlaySpec | null = null;
  private promptKey: unknown = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private actionBounds: Rectangle | null = null;
  private modalOpen = false;
  private selectedIds = new Set<string>();
  private counts = new Map<number | string, number>();
  private numberValue = 0;
  private numberBuffer = "";
  private order: string[] = [];
  private scryItems: Record<string, string[]> = {};
  private damageAssigned: Record<string, number> = {};
  private dropZones: DropZone[] = [];
  private drag: DragState | null = null;
  private diceElapsedMs = 0;
  private autopassRemainingMs: number | null = null;
  private autopassTotalMs = 0;
  private autopassFill: Graphics | null = null;
  private selectionFilter = "";
  private modalScrollOffset = 0;
  private modalScrollMax = 0;
  private modalBody: { body: Container; bodyTop: number; height: number } | null = null;
  private keyListener: (event: KeyboardEvent) => void;
  private onStageMove = (event: FederatedPointerEvent): void => this.moveDrag(event);
  private onStageUp = (event: FederatedPointerEvent): void => this.finishDrag(event);

  constructor(app: Application) {
    this.app = app;
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

  hitTest(x: number, y: number): boolean {
    if (!this.container.visible) return false;
    if (this.modalOpen) return true;
    return this.actionBounds?.contains(x, y) ?? false;
  }

  getActionBounds(): Rectangle | null {
    return this.actionBounds?.clone() ?? null;
  }

  get compactAction(): boolean {
    return this.viewportWidth < 760 || this.viewportHeight < 520;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.keyListener);
    this.app.stage.off("pointermove", this.onStageMove);
    this.app.stage.off("pointerup", this.onStageUp);
    this.app.stage.off("pointerupoutside", this.onStageUp);
    this.app.ticker.remove(this.tick, this);
    this.container.destroy({ children: true });
  }

  private resetLocalState(spec: PromptOverlaySpec | null): void {
    this.selectedIds.clear();
    this.counts.clear();
    this.selectionFilter = "";
    this.order = [];
    this.autopassRemainingMs = null;
    this.autopassTotalMs = 0;
    this.scryItems = {};
    this.damageAssigned = {};
    this.dropZones = [];
    this.drag = null;
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
    if (
      input.type === "chooseAction" &&
      spec.gameView.stack.length === 0 &&
      !usePromptPreferencesStore.getState().fullControl &&
      input.actions.every((action) => action.type === "activateAbility" && action.isManaAbility)
    ) {
      this.autopassTotalMs =
        AUTOPASS_DELAY_MIN_MS + Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS);
      this.autopassRemainingMs = this.autopassTotalMs;
    }
  }

  private rebuild(): void {
    this.drag = null;
    this.actionBounds = null;
    this.autopassFill = null;
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
      !this.spec.action.isWaitingForResponse
    ) {
      this.modalOpen = true;
      this.renderModal();
      return;
    }
    this.renderActionPanel();
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
  private renderActionPanel(): void {
    const spec = this.spec!;
    const action = spec.action;
    const compact = this.viewportWidth < 760 || this.viewportHeight < 520;
    if (compact && action.dimmed) return;
    const width = compact ? Math.min(280, this.viewportWidth - 12) : 300;
    const content = new Container();
    const buttons: PromptButton[] = [];
    let title = "Waiting";
    let hint = "Waiting for priority";
    let hintIcon: string | null = null;
    const waiting = action.isWaitingForResponse;
    const waitingOthers = action.isWaitingForOthers;
    const promptView =
      action.promptActionOverride ?? (waitingOthers ? undefined : action.promptType);
    const passColor = this.theme.gameTheme.promptAction.passAction;
    const attackColor = this.theme.gameTheme.promptAction.attackAction;
    const defenseColor = this.theme.gameTheme.promptAction.defenseAction;
    const cancelColor = this.theme.gameTheme.promptAction.cancel;

    switch (promptView) {
      case "chooseAction": {
        title = "Priority";
        hint = action.isMyTurn ? "You have priority" : `${action.activePlayerName}'s turn`;
        buttons.push(
          this.makeButton(
            this.autopassRemainingMs == null ? "PASS" : "PASSING",
            action.onPassPriority,
            { color: passColor, disabled: waiting, width: 112 },
          ),
          this.makeButton("END TURN", action.onPassEndTurn, {
            color: this.theme.appTheme.secondary,
            disabled: waiting,
            width: 126,
          }),
        );
        break;
      }
      case "promptRequired": {
        title = "Action Required";
        hint = "A modal prompt is waiting";
        buttons.push(
          this.makeButton("OPEN PROMPT", spec.onShowModal, {
            color: defenseColor,
            width: 148,
            icon: "lucide-alert-circle",
          }),
        );
        break;
      }
      case "chooseAttackers": {
        title = "Declare Attackers";
        const attackCount = action.attackAssignmentCount + action.pendingAttackers.length;
        hint = action.pendingAttackers.length
          ? "Pick a target — click an opponent or planeswalker"
          : action.mustAttackHint || "Drag creatures to defenders or select attackers";
        if (action.pendingAttackers.length) hintIcon = "lucide-crosshair";
        const attackAll = action.multipleAttackDefenders
          ? () => action.onBeginAttackTargetPick(action.availableAttackerIds)
          : () =>
              action.onDeclareAttackers(
                action.availableAttackerIds,
                action.selectedAttackDefenderId ?? undefined,
              );
        buttons.push(
          this.makeButton("ATTACK ALL", attackAll, {
            color: attackColor,
            disabled: waiting,
            icon: "lucide-swords",
          }),
          this.makeButton(
            attackCount ? `ATTACK (${attackCount})` : "ATTACK",
            action.onSubmitAttack,
            {
              color: attackColor,
              disabled: waiting || attackCount === 0,
              icon: "lucide-sword",
            },
          ),
          this.makeButton("PASS", action.onPassPriority, {
            color: passColor,
            outline: true,
            disabled: waiting,
            icon: "lucide-ban",
          }),
        );
        break;
      }
      case "chooseBlockers": {
        title = "Declare Blockers";
        hint =
          action.blockError ||
          action.blockRequirementError ||
          (action.pendingAttacker
            ? "Attacker selected — click your blocker"
            : action.pendingBlocker
              ? "Blocker selected — click the attacker"
              : action.blockRestrictionHint || "Assign blockers, then confirm");
        if (action.blockAssignments.length) {
          buttons.push(
            this.makeButton(
              `BLOCK ${action.blockAssignments.length}`,
              () => action.onDeclareBlockers(action.blockAssignments),
              {
                color: defenseColor,
                disabled: waiting || !!action.blockRequirementError,
                icon: "lucide-shield",
              },
            ),
          );
        }
        buttons.push(
          this.makeButton("NO BLOCKS", action.onPassPriority, {
            color: cancelColor,
            outline: true,
            disabled: waiting,
            icon: "lucide-ban",
          }),
        );
        break;
      }
      case "chooseTargetSpell":
      case "promptLabel":
      case "chooseBoardTargets": {
        title = "Choose Targets";
        const input = spec.currentPrompt?.input;
        const hasSpellTargets =
          promptView === "chooseTargetSpell" ||
          (input?.type === "chooseBoardTargets" &&
            input.candidates.some((target) => target.kind === "spell"));
        hint = hasSpellTargets
          ? "Click a glowing spell on the stack to target it"
          : input?.type === "chooseBoardTargets"
            ? input.presentation.title
            : "Choose a valid target";
        if (action.targetCompletionLabel && action.onCompleteTargets) {
          buttons.push(
            this.makeButton(action.targetCompletionLabel.toUpperCase(), action.onCompleteTargets, {
              color: action.targetCompletionKind === "cancel" ? cancelColor : defenseColor,
              outline: action.targetCompletionKind === "cancel",
              disabled: waiting,
              icon: action.targetCompletionKind === "cancel" ? "lucide-ban" : "lucide-check",
            }),
          );
        }
        if (hasSpellTargets) {
          buttons.unshift(
            this.makeButton("OPEN STACK", action.onOpenStack, {
              color: defenseColor,
              outline: true,
              icon: "lucide-layers",
            }),
          );
        }
        break;
      }
      case "chooseDamageOrder":
      case "chooseDamageAssignmentOrder": {
        title = "Damage Order";
        hint = `${action.damageOrderCount}/${action.damageOrderTotal} blockers ordered`;
        buttons.push(
          this.makeButton("AUTO", action.onDefaultDamageOrder, {
            outline: true,
            disabled: waiting,
          }),
        );
        if (action.damageOrderCount > 0) {
          buttons.push(
            this.makeButton("UNDO", action.onUndoDamageOrder, { outline: true, disabled: waiting }),
          );
        }
        buttons.push(
          this.makeButton("CONFIRM", action.onConfirmDamageOrder, {
            color: attackColor,
            disabled: waiting || action.damageOrderCount < action.damageOrderTotal,
            icon: "lucide-swords",
          }),
        );
        break;
      }
      case "payManaCost": {
        title = "Pay Mana";
        const info = action.payManaCostInfo;
        hint =
          info?.description ||
          (info ? `Cast ${info.cardName} for ${info.manaCost}` : "Pay mana cost");
        buttons.push(
          this.makeButton(
            info?.canConfirmFromPool ? "CONFIRM" : "AUTO",
            info?.canConfirmFromPool ? action.onPayManaCost : action.onAutoManaCost,
            {
              color: passColor,
              disabled: waiting,
              icon: info?.canConfirmFromPool ? "lucide-check" : "lucide-wand-sparkles",
            },
          ),
        );
        if (info?.delveAvailable && info.onOpenDelve) {
          buttons.push(
            this.makeButton("DELVE", info.onOpenDelve, {
              color: defenseColor,
              outline: true,
              icon: "exile",
            }),
          );
        }
        if (info?.lifeToPay != null && info.onPayLife) {
          buttons.push(
            this.makeButton(`${info.lifeToPay} LIFE`, info.onPayLife, {
              color: attackColor,
              outline: true,
              icon: "lucide-heart-crack",
            }),
          );
        }
        buttons.push(
          this.makeButton("CANCEL", action.onCancelManaCost, {
            color: cancelColor,
            outline: true,
            disabled: waiting,
            icon: "lucide-ban",
          }),
        );
        break;
      }
      case "mulligan": {
        title = "Mulligan";
        hint = action.mulliganCount
          ? `Mulligan ${action.mulliganCount}: your next hand will contain one fewer card`
          : "Keep this opening hand or draw a new one";
        buttons.push(
          this.makeButton("KEEP", action.onMulliganKeep, {
            color: passColor,
            disabled: waiting,
            icon: "lucide-check",
            width: 118,
          }),
          this.makeButton("MULLIGAN", action.onMulliganDraw, {
            color: this.theme.appTheme.secondary,
            disabled: waiting,
            icon: "lucide-rotate-cw",
            width: 126,
          }),
        );
        break;
      }
      case "mulliganPutBack": {
        title = "Mulligan";
        const selected = action.mulliganSelectedCount ?? 0;
        const count = action.mulliganPutBackCount ?? 0;
        hint = `${selected}/${count} to library bottom`;
        buttons.push(
          this.makeButton("CONFIRM", action.onMulliganPutBackConfirm, {
            color: this.theme.appTheme.primary,
            icon: "lucide-check",
            disabled: waiting || selected !== count,
            width: 126,
          }),
        );
        break;
      }
      case "noAction":
        break;
      default: {
        if (
          spec.currentPrompt &&
          MODAL_TYPES.has(spec.currentPrompt.input.type) &&
          spec.modalHidden
        ) {
          title = "Action Required";
          hint = "The prompt is minimized";
          buttons.push(
            this.makeButton("OPEN PROMPT", spec.onShowModal, {
              color: defenseColor,
              width: 148,
              icon: "lucide-alert-circle",
            }),
          );
        } else if (waitingOthers) {
          hint = "Waiting for another player";
        }
      }
    }

    const headerHeight = compact ? 0 : 34;
    const hintText = promptText(hint, compact ? 10 : 11, this.theme.appTheme["muted-foreground"], {
      width: width - PANEL_PADDING * 2,
      align: "center",
      weight: "500",
    });
    hintText.anchor.set(0.5, 0);
    hintText.position.set(width / 2 - PANEL_PADDING, 0);
    content.addChild(hintText);
    if (hintIcon) {
      const icon = this.makeIcon(
        hintIcon,
        compact ? 12 : 14,
        this.theme.appTheme["muted-foreground"],
      );
      icon.position.set(width / 2 - PANEL_PADDING - hintText.width / 2 - 10, 7);
      content.addChild(icon);
    }
    const buttonY = Math.max(24, hintText.height + 8);
    const buttonHeight = this.addButtonRow(content, buttons, buttonY, width - PANEL_PADDING * 2);
    const bodyHeight = Math.max(42, buttonY + buttonHeight);
    const panelHeight = headerHeight + PANEL_PADDING + bodyHeight + 10;
    const x = this.viewportWidth - width - (compact ? 6 : 12);
    const y = compact
      ? Math.max(
          6,
          Math.min(
            this.viewportHeight - panelHeight - 6,
            (action.dividerY ?? this.viewportHeight / 2) - panelHeight / 2,
          ),
        )
      : this.viewportHeight - panelHeight;
    const panel = this.panel(width, panelHeight, x, y, compact ? 16 : 9);
    if (!compact) {
      const titleText = promptText(title.toUpperCase(), 11, this.theme.appTheme.foreground, {
        weight: "700",
        width: width - 130,
      });
      titleText.position.set(10, 10);
      panel.addChild(titleText);
      const fullControl = usePromptPreferencesStore.getState().fullControl;
      const modeButton = this.makeButton(
        fullControl ? "FULL CTRL" : "AUTOPASS",
        () => {
          const nextFullControl = !usePromptPreferencesStore.getState().fullControl;
          usePromptPreferencesStore.getState().setFullControl(nextFullControl);
          if (!nextFullControl) {
            const input = this.spec?.currentPrompt?.input;
            if (
              input?.type === "chooseAction" &&
              this.spec?.gameView.stack.length === 0 &&
              input.actions.every(
                (candidate) => candidate.type === "activateAbility" && candidate.isManaAbility,
              )
            ) {
              this.autopassTotalMs =
                AUTOPASS_DELAY_MIN_MS +
                Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS);
              this.autopassRemainingMs = this.autopassTotalMs;
            }
          } else {
            this.autopassRemainingMs = null;
          }
          this.rebuild();
        },
        {
          outline: true,
          compact: true,
          width: 88,
          icon: fullControl ? "lucide-hand" : "lucide-zap",
          iconSize: 13,
        },
      );
      modeButton.scale.set(0.72);
      modeButton.position.set(width - 104, 4);
      panel.addChild(modeButton);
      const menuButton = this.makeButton("", action.onToggleBoardMenu, {
        title: "Game menu",
        icon: "lucide-settings",
        iconSize: 16,
        outline: true,
        compact: true,
        width: 30,
      });
      menuButton.scale.set(0.72);
      menuButton.position.set(width - 32, 4);
      panel.addChild(menuButton);
      const divider = new Graphics()
        .rect(0, headerHeight - 1, width, 1)
        .fill({ color: hexToNum(this.theme.appTheme.border), alpha: 0.8 });
      panel.addChild(divider);
    }
    content.position.set(PANEL_PADDING, headerHeight + 10);
    panel.addChild(content);
    panel.alpha = waiting ? 0.7 : 1;
    if (this.autopassRemainingMs != null && this.autopassTotalMs > 0) {
      const progress = 1 - this.autopassRemainingMs / this.autopassTotalMs;
      this.autopassFill = new Graphics()
        .roundRect(0, panelHeight - 3, width * progress, 3, 2)
        .fill({ color: hexToNum(passColor) });
      this.autopassFill.eventMode = "none";
      panel.addChild(this.autopassFill);
    }
    this.container.addChild(panel);
    this.actionBounds = new Rectangle(x, y, width, panelHeight);
  }

  private renderModal(): void {
    const backdrop = new Graphics()
      .rect(0, 0, this.viewportWidth, this.viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.overlay), alpha: 0.76 });
    backdrop.eventMode = "static";
    backdrop.hitArea = new Rectangle(0, 0, this.viewportWidth, this.viewportHeight);
    this.container.addChild(backdrop);
    const input = this.spec!.currentPrompt!.input;
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
  ): {
    panel: Container;
    body: Container;
    bodyTop: number;
  } {
    const x = (this.viewportWidth - width) / 2;
    const y = (this.viewportHeight - height) / 2;
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
      this.rebuild();
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
    const { body } = this.createModalShell(width, height, presentation);
    const buttons = [
      this.makeButton(denyLabel, () => this.spec!.respond({ type: "decision", value: false }), {
        outline: true,
        width: 150,
      }),
      this.makeButton(confirmLabel, () => this.spec!.respond({ type: "decision", value: true }), {
        width: 150,
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
    let y = 4;
    if (showFilter) {
      const filter = promptText(
        `Filter: ${this.selectionFilter || "type to search"}`,
        12,
        this.selectionFilter
          ? this.theme.appTheme.foreground
          : this.theme.appTheme["muted-foreground"],
        { width: availableWidth },
      );
      filter.position.set(2, y);
      body.addChild(filter);
      y += 30;
    }
    for (const { option, index } of visibleOptions) {
      const count = this.counts.get(index) ?? 0;
      const total = this.selectionTotal(options);
      const selected = count > 0;
      const disabled = option.weight > maxTotal || (!selected && total + option.weight > maxTotal);
      const repeatedWidth = option.canRepeat ? availableWidth - 76 : availableWidth;
      const label = option.canRepeat ? `${option.label}  × ${count}` : option.label;
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
      if (y > height - body.y - 66) break;
    }
    if (!autoConfirm) {
      const total = this.selectionTotal(options);
      const canConfirm = total >= minTotal && total <= maxTotal;
      const label = minTotal === 0 && total === 0 ? "SKIP" : `CONFIRM${total ? ` (${total})` : ""}`;
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
      confirm.position.set(availableWidth - confirm.buttonWidth, height - body.y - 54);
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
    const height = Math.min(this.viewportHeight - 24, 190 + rows * (CARD_HEIGHT + 12));
    const { body } = this.createModalShell(
      width,
      height,
      reveal
        ? { ...presentation, title: "Revealed cards", description: presentation.title }
        : presentation,
    );
    const startY = 4;
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
    const footerY = height - body.y - 48;
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
  ): Container {
    const tile = new Container();
    tile.eventMode = disabled ? "none" : "static";
    tile.cursor = disabled ? "default" : onPress ? "pointer" : "grab";
    tile.hitArea = new Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT);
    tile.accessible = true;
    tile.accessibleTitle = card.identity.name;
    tile.tabIndex = disabled ? -1 : 0;
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
    tile.alpha = disabled ? 0.3 : 1;
    if (onPress) tile.on("pointertap", onPress);
    return tile;
  }

  private renderColors(
    presentation: PromptPresentation,
    validColors: string[],
    amount: number,
    repeatAllowed: boolean,
  ): void {
    const width = Math.min(430, this.viewportWidth - 24);
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
            width: 106,
            iconTexture: loadManaSymbolTexture(this.manaSymbol(color)),
            iconTint: false,
            iconSize: 24,
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
            width: 42,
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
      this.makeButton("", () => setValue((isValid ? parsedValue : min) - 1), {
        title: "Decrease",
        icon: "lucide-minus",
        iconSize: 22,
        outline: true,
        disabled: isValid && parsedValue <= min,
        width: 58,
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
        },
      ),
      this.makeButton("", () => setValue((isValid ? parsedValue : min) + 1), {
        title: "Increase",
        icon: "lucide-plus",
        iconSize: 22,
        outline: true,
        disabled: isValid && parsedValue >= max,
        width: 58,
      }),
    ];
    this.addButtonRow(body, buttons, 78, width - PANEL_PADDING * 2);
    const rangeText = promptText(
      `Enter a number between ${min} and ${max}.`,
      12,
      this.theme.appTheme["muted-foreground"],
      { align: "center" },
    );
    rangeText.anchor.set(0.5, 0);
    rangeText.position.set((width - PANEL_PADDING * 2) / 2, 124);
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
    const instruction = promptText(
      "Drag to arrange — number 1 goes first",
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
      body.addChild(card);
    });
    const confirm = this.makeButton(
      "CONFIRM ORDER",
      () => this.spec!.respond({ type: "reorderDecision", orderedIds: [...this.order] }),
      { width: 150 },
    );
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, height - body.y - 48);
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
    this.dropZones.push({ id: "pool", rect: this.localRectToGlobal(body, pool) });
    const poolIds = this.scryItems.pool ?? [];
    poolIds.forEach((id, index) => {
      const card = byId.get(id);
      if (!card) return;
      const tile = this.createCardTile(card, false, false);
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
      body.addChild(zoneBg);
      const label = promptText(
        this.scryDestinationLabel(destination),
        11,
        this.theme.appTheme["muted-foreground"],
        { weight: "700" },
      );
      label.position.set(rect.x + 8, rect.y - 22);
      body.addChild(label);
      this.dropZones.push({ id: key, rect: this.localRectToGlobal(body, rect) });
      const ids = this.scryItems[key] ?? [];
      ids.forEach((id, cardIndex) => {
        const card = byId.get(id);
        if (!card) return;
        const tile = this.createCardTile(card, false, cardIndex !== ids.length - 1);
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
    let source: string | undefined;
    for (const [key, ids] of Object.entries(this.scryItems)) {
      if (ids.includes(cardId)) {
        source = key;
        break;
      }
    }
    if (!source || source === target.id) {
      this.rebuild();
      return;
    }
    this.scryItems[source] = this.scryItems[source]!.filter((id) => id !== cardId);
    this.scryItems[target.id] = [...(this.scryItems[target.id] ?? []), cardId];
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
    const height = Math.min(this.viewportHeight - 24, 230 + damageOrder.blockerCards.length * 48);
    const presentation: PromptPresentation = {
      title: "Order Combat Damage",
      description: `${damageOrder.attackerName} is blocked by ${damageOrder.blockerCards.length} creatures — choose the order it assigns damage.`,
      targets: [],
    };
    const { body } = this.createModalShell(width, height, presentation, false);
    const complete =
      damageOrder.order.length >= damageOrder.blockerCards.length &&
      damageOrder.blockerCards.length > 0;
    const instruction = promptText(
      damageOrder.order.length === 0
        ? "Click blockers in the order damage is dealt."
        : complete
          ? "Order set — confirm to deal damage."
          : `Click the next blocker (${damageOrder.order.length}/${damageOrder.blockerCards.length}).`,
      12,
      this.theme.appTheme["muted-foreground"],
      { width: width - PANEL_PADDING * 2 },
    );
    instruction.position.set(0, 4);
    body.addChild(instruction);
    let y = instruction.height + 16;
    for (const card of damageOrder.blockerCards) {
      const index = damageOrder.order.indexOf(card.id);
      const button = this.makeButton(
        index >= 0 ? `${index + 1}. ${card.identity.name}` : card.identity.name,
        () => damageOrder.onToggle(card.id),
        {
          color: this.theme.appTheme.primary,
          outline: index < 0,
          disabled: this.spec!.action.isWaitingForResponse,
          width: width - PANEL_PADDING * 2,
        },
      );
      button.position.set(0, y);
      body.addChild(button);
      y += 42;
    }
    const buttons = [
      this.makeButton("AUTO", damageOrder.onAuto, {
        outline: true,
        disabled: this.spec!.action.isWaitingForResponse,
      }),
    ];
    if (damageOrder.order.length > 0) {
      buttons.push(
        this.makeButton("UNDO", damageOrder.onUndo, {
          outline: true,
          disabled: this.spec!.action.isWaitingForResponse,
        }),
      );
    }
    buttons.push(
      this.makeButton("CONFIRM", damageOrder.onConfirm, {
        disabled: this.spec!.action.isWaitingForResponse || !complete,
        icon: "lucide-swords",
      }),
    );
    this.addButtonRow(body, buttons, height - body.y - 48, width - PANEL_PADDING * 2, "right");
  }

  private renderCombatDamage(input: ChooseCombatDamageAssignmentInput): void {
    const width = Math.min(500, this.viewportWidth - 24);
    const assignees = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
    const height = Math.min(this.viewportHeight - 24, 230 + assignees.length * 56);
    const attacker = this.spec!.gameView.battlefield.find((card) => card.id === input.attackerId);
    const presentation: PromptPresentation = {
      title: "Assign Combat Damage",
      description: attacker
        ? `${attacker.identity.name} must assign ${input.totalDamage} damage.`
        : undefined,
      targets: [],
    };
    const { body } = this.createModalShell(width, height, presentation);
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
      body.addChild(rowBg);
      const text = promptText(
        `${label}${lethal != null ? `  ·  Lethal ${lethal}` : ""}`,
        12,
        this.theme.appTheme.foreground,
        { weight: "600", width: width - 190 },
      );
      text.position.set(10, y + 15);
      body.addChild(text);
      if (lethal != null && lethal > 0 && damage >= lethal) {
        const skull = this.makeIcon("lucide-skull", 14, this.theme.appTheme.destructive);
        skull.position.set(width - PANEL_PADDING * 2 - 122, y + 24);
        body.addChild(skull);
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
    const settled = this.diceElapsedMs >= 1800;
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
        Math.max(0, 1 - this.diceElapsedMs / 1800) *
        0.35;
      body.addChild(die);
      const valueText = promptText(String(shownValue), 26, this.theme.appTheme.foreground, {
        weight: "700",
      });
      valueText.anchor.set(0.5);
      valueText.position.set(x, y);
      body.addChild(valueText);
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
    if (winner && settled) {
      const winnerText = promptText(
        `First player: ${winner.label ?? winner.finalResults.join(", ")}`,
        13,
        this.theme.gameTheme.success,
        { weight: "700" },
      );
      winnerText.anchor.set(0.5);
      winnerText.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 4);
      body.addChild(winnerText);
    }
    const ignored = rolls.flatMap((roll) => roll.ignoredRolls);
    if (ignored.length) {
      const ignoredText = promptText(
        `Ignored: ${ignored.join(", ")}`,
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
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, height - body.y - 48);
    body.addChild(confirm);
  }

  private renderGameOver(): void {
    const gameOver = this.spec!.gameOver!;
    const anyConceded =
      gameOver.me.status === "conceded" ||
      gameOver.opponents.some((player) => player.status === "conceded");
    let heading = "Draw!";
    let color = this.theme.appTheme["muted-foreground"];
    if (gameOver.me.status === "conceded") {
      heading = "You conceded";
      color = this.theme.appTheme.destructive;
    } else if (gameOver.winnerId === gameOver.me.id) {
      heading = "You Win!";
      color = this.theme.gameTheme.success;
    } else if (gameOver.winnerId != null) {
      heading = "You Lose!";
      color = this.theme.appTheme.destructive;
    } else if (anyConceded) {
      const names = gameOver.opponents
        .filter((player) => player.status === "conceded")
        .map((player) => player.name);
      if (names.length) heading = `${names.join(" and ")} conceded`;
    }
    const backdrop = new Graphics()
      .rect(0, 0, this.viewportWidth, this.viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 1 });
    backdrop.eventMode = "static";
    this.container.addChild(backdrop);
    const group = new Container();
    const title = promptText(heading, 34, color, { weight: "700" });
    title.anchor.set(0.5);
    title.position.set(0, 0);
    group.addChild(title);
    const life = promptText(
      `Final life: You ${gameOver.me.life} — ${gameOver.opponents.map((player) => `${player.name} ${player.life}`).join(" · ")}`,
      14,
      this.theme.appTheme["muted-foreground"],
      { align: "center", width: Math.min(600, this.viewportWidth - 40) },
    );
    life.anchor.set(0.5, 0);
    life.position.set(0, 34);
    group.addChild(life);
    const turn = promptText(`Turn ${gameOver.turn}`, 12, this.theme.appTheme["muted-foreground"]);
    turn.anchor.set(0.5);
    turn.position.set(0, 78);
    group.addChild(turn);
    const returning = promptText("Returning to menu…", 11, this.theme.appTheme["muted-foreground"]);
    returning.anchor.set(0.5);
    returning.position.set(0, 104);
    group.addChild(returning);
    const button = this.makeButton("RETURN TO MENU", gameOver.onEndGame, {
      outline: true,
      width: 160,
    });
    button.position.set(-button.buttonWidth / 2, 132);
    group.addChild(button);
    group.position.set(this.viewportWidth / 2, this.viewportHeight / 2 - 70);
    this.container.addChild(group);
  }

  private makeDraggable(item: Container, onDrop: (x: number, y: number) => void): void {
    item.eventMode = "static";
    item.cursor = "grab";
    item.on("pointerdown", (event: FederatedPointerEvent) => {
      const point = event.global;
      const bounds = item.getBounds();
      this.drag = {
        item,
        offsetX: point.x - bounds.x,
        offsetY: point.y - bounds.y,
        onDrop,
      };
      item.cursor = "grabbing";
      item.alpha = 0.9;
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
  }

  private finishDrag(event: FederatedPointerEvent): void {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
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
    } else if (input.type === "diceRolled" && event.key === "Enter" && this.diceElapsedMs >= 1800) {
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

  private tick(ticker: Ticker): void {
    if (this.autopassRemainingMs != null) {
      const input = this.spec?.currentPrompt?.input;
      const canAutopass =
        input?.type === "chooseAction" &&
        this.spec?.gameView.stack.length === 0 &&
        input.actions.every(
          (action) => action.type === "activateAbility" && action.isManaAbility,
        ) &&
        !this.spec.action.isWaitingForResponse;
      if (!canAutopass) {
        this.autopassRemainingMs = null;
        this.autopassTotalMs = 0;
        this.rebuild();
      } else {
        this.autopassRemainingMs -= ticker.deltaMS;
        if (this.autopassRemainingMs <= 0) {
          this.autopassRemainingMs = null;
          this.spec!.action.onPassPriority();
        } else if (this.autopassFill && this.actionBounds && this.autopassTotalMs > 0) {
          const progress = 1 - this.autopassRemainingMs / this.autopassTotalMs;
          this.autopassFill
            .clear()
            .roundRect(0, this.actionBounds.height - 3, this.actionBounds.width * progress, 3, 2)
            .fill({ color: hexToNum(this.theme.gameTheme.promptAction.passAction) });
        }
      }
    }
    const input = this.spec?.currentPrompt?.input;
    if (!this.modalOpen || input?.type !== "diceRolled" || this.diceElapsedMs >= 2100) return;
    const before = this.diceElapsedMs;
    this.diceElapsedMs = Math.min(2100, this.diceElapsedMs + ticker.deltaMS);
    if (
      Math.floor(before / 80) !== Math.floor(this.diceElapsedMs / 80) ||
      this.diceElapsedMs === 2100
    ) {
      this.rebuild();
    }
  }
}
