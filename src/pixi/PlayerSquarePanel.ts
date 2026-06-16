import { Container, Graphics, Text, TextStyle, Sprite } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import type { PlayerPanelState, PlayerPanelCallbacks, PlayerPanel } from "./playerPanel.types";
import { applyIcon, rasterIcon, getIconColor, SVG } from "./panelIcons";
import { MANA_LETTERS } from "@/themes/gameTheme";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "./manaSymbolCache";

// ── Layout ────────────────────────────────────────────────────────────
const PAD = 8;
const AVATAR_R = 54; // circle radius
const ICON_SIZE = 14;
const STAT_GAP = 12;
const ROW_GAP = 4;
const FONT = "Inter, system-ui, -apple-system, sans-serif";
const MANA_SYM_SIZE = 11;

// ── Text styles — seeded from the current theme; kept in sync by setTheme()
const _initTheme = getTheme().gameTheme;
const statStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: "bold",
  fill: _initTheme.textOnTinted,
});
const manaCountStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: "800",
  fill: _initTheme.textOnTinted,
});

// ── Stat cell ─────────────────────────────────────────────────────────
interface StatCell {
  icon: Sprite;
  value: Text;
  iconKey: string;
}

function makeStatCell(iconKey: string): StatCell {
  const icon = new Sprite();
  icon.width = ICON_SIZE;
  icon.height = ICON_SIZE;
  const value = new Text({ text: "0", style: statStyle });
  value.anchor.set(0, 0.5);
  return { icon, value, iconKey };
}

// ═══════════════════════════════════════════════════════════════════════
export class PlayerSquarePanel implements PlayerPanel {
  readonly container: Container;
  private theme: Theme;
  private callbacks: PlayerPanelCallbacks = {};
  private lastState: PlayerPanelState | null = null;
  private canvasHeight = 0;

  private bgGfx: Graphics;
  private priorityGlow: Graphics;
  private avatarGfx: Graphics;
  private avatarInitial: Text;
  private targetGfx: Graphics;
  private glowActive = false;
  private glowColor = 0xffffff; // updated from theme in update()
  private glowCx = 0;
  private glowCy = 0;
  private highlightedCells: StatCell[] = [];

  // Stats row
  private lifeStat: StatCell;
  private handStat: StatCell;
  private deckStat: StatCell;
  private gyStat: StatCell;
  private exileStat: StatCell;
  private poisonStat: StatCell;
  private energyStat: StatCell;
  private cmdDmgStat: StatCell;
  private cmdZoneStat: StatCell;
  private allStats: StatCell[];
  private statsContainer: Container;

  // Mana
  private manaContainer: Container;
  private manaEntries: { sprite: Sprite; count: Text; key: string }[];

  /** When true, panel anchors to the top instead of the bottom. */
  private readonly anchorTop: boolean;

  constructor(theme: Theme, options?: { anchorTop?: boolean }) {
    this.anchorTop = options?.anchorTop ?? false;
    this.theme = theme;
    this.container = new Container();
    this.container.label = "playerSquarePanel";

    this.bgGfx = new Graphics();
    this.container.addChild(this.bgGfx);

    // Priority glow — behind everything else in the avatar stack
    this.priorityGlow = new Graphics();
    this.priorityGlow.alpha = 0;
    this.container.addChild(this.priorityGlow);

    // Avatar: circle bg + player initial
    this.avatarGfx = new Graphics();
    this.container.addChild(this.avatarGfx);

    this.avatarInitial = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: FONT,
        fontSize: AVATAR_R * 0.8,
        fontWeight: "bold",
        fill: "#ffffff",
      }),
    });
    this.avatarInitial.anchor.set(0.5);
    this.container.addChild(this.avatarInitial);

    this.targetGfx = new Graphics();
    this.targetGfx.eventMode = "static";
    this.targetGfx.cursor = "pointer";
    this.targetGfx.visible = false;
    this.targetGfx.on("pointerdown", () => this.callbacks.onTargetPlayer?.());
    this.container.addChild(this.targetGfx);

    // Stats
    this.statsContainer = new Container();
    this.container.addChild(this.statsContainer);
    this.lifeStat = makeStatCell("hearts");
    this.handStat = makeStatCell("hand");
    this.deckStat = makeStatCell("deck");
    this.gyStat = makeStatCell("graveyard");
    this.exileStat = makeStatCell("exile");
    this.poisonStat = makeStatCell("poison");
    this.energyStat = makeStatCell("energy");
    this.cmdDmgStat = makeStatCell("cmdsword");
    this.cmdZoneStat = makeStatCell("cmdsword");
    this.allStats = [
      this.lifeStat,
      this.handStat,
      this.deckStat,
      this.gyStat,
      this.exileStat,
      this.poisonStat,
      this.energyStat,
      this.cmdDmgStat,
      this.cmdZoneStat,
    ];
    for (const s of this.allStats) {
      this.statsContainer.addChild(s.icon);
      this.statsContainer.addChild(s.value);
    }

    // GY/Exile clickable
    this.gyStat.icon.eventMode = "static";
    this.gyStat.icon.cursor = "pointer";
    this.gyStat.icon.on("pointerdown", () => this.callbacks.onOpenGraveyard?.());
    this.exileStat.icon.eventMode = "static";
    this.exileStat.icon.cursor = "pointer";
    this.exileStat.icon.on("pointerdown", () => this.callbacks.onOpenExile?.());
    this.cmdZoneStat.icon.eventMode = "static";
    this.cmdZoneStat.icon.cursor = "pointer";
    this.cmdZoneStat.icon.on("pointerdown", () => this.callbacks.onOpenCommandZone?.());

    // Mana
    this.manaContainer = new Container();
    this.manaContainer.visible = false;
    this.container.addChild(this.manaContainer);
    this.manaEntries = [];
    for (const key of MANA_LETTERS) {
      const sprite = new Sprite();
      sprite.width = MANA_SYM_SIZE;
      sprite.height = MANA_SYM_SIZE;
      this.manaContainer.addChild(sprite);
      const tex = getManaSymbolTextureSync(key);
      if (tex) sprite.texture = tex;
      else
        loadManaSymbolTexture(key).then((t) => {
          sprite.texture = t;
        });
      const count = new Text({ text: "", style: manaCountStyle });
      this.manaContainer.addChild(count);
      this.manaEntries.push({ sprite, count, key });
    }

    // Pre-raster icons with current theme colours
    const initTheme = getTheme().gameTheme;
    for (const key of Object.keys(SVG)) {
      rasterIcon(key, getIconColor(key, initTheme), 64);
    }
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    statStyle.fill = theme.gameTheme.textOnTinted;
    manaCountStyle.fill = theme.gameTheme.textOnTinted;
    if (this.lastState) this.update(this.lastState);
  }

  setCallbacks(cb: PlayerPanelCallbacks): void {
    this.callbacks = cb;
  }

  setPosition(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  setHeight(h: number): void {
    this.canvasHeight = h;
    if (this.lastState) this.update(this.lastState);
  }

  update(state: PlayerPanelState): void {
    this.lastState = state;
    const t = this.theme.gameTheme;
    const h = this.canvasHeight > 0 ? this.canvasHeight : 400;

    // ── Background — tinted with the player's seat colour ──
    const panelH = AVATAR_R * 2 + PAD * 2;
    const panelY = this.anchorTop ? 0 : h - panelH;
    const seatColor = hexToNum(t.playerColors[state.playerSeat]);
    this.bgGfx.clear();

    // ── Avatar ──
    const cx = PAD + AVATAR_R;
    const cy = panelY + panelH / 2;
    this.avatarGfx.clear();
    this.avatarGfx.circle(cx, cy, AVATAR_R);
    this.avatarGfx.fill({ color: seatColor, alpha: 0.25 });
    this.avatarGfx.circle(cx, cy, AVATAR_R);
    this.avatarGfx.stroke({ color: seatColor, width: 2, alpha: 0.5 });

    // Player initial centered in the circle
    this.avatarInitial.text = state.playerName.charAt(0).toUpperCase();
    this.avatarInitial.x = cx;
    this.avatarInitial.y = cy;

    // Priority glow — set state for tick() animation
    this.glowActive = state.isPriorityPlayer;
    this.glowColor = seatColor;
    this.glowCx = cx;
    this.glowCy = cy;

    // Target
    this.targetGfx.clear();
    this.targetGfx.visible = state.isTargetable;
    if (state.isTargetable) {
      const attackColor = hexToNum(t.promptAction.attackAction);
      this.targetGfx.circle(cx, cy, AVATAR_R + 3);
      this.targetGfx.fill({ color: attackColor, alpha: 0.15 });
      this.targetGfx.stroke({ color: attackColor, width: 2, alignment: 0.5, alpha: 0.85 });
    }

    // ── Stats arranged radially around the avatar circle ──
    // Angles: 0 = right, PI/2 = bottom, PI = left, -PI/2 = top
    // Place icon at the circle edge, value text just outside it
    const RADIAL_ICON = 20;
    const RADIAL_OFFSET = AVATAR_R + 25; // distance from center to icon center
    this.highlightedCells = [];

    const placeRadial = (
      cell: StatCell,
      val: number,
      angle: number,
      iconSize: number,
      fontSize: number,
      highlight: boolean,
    ) => {
      cell.icon.visible = true;
      cell.value.visible = true;
      const hex = highlight ? t.cardRing : getIconColor(cell.iconKey, t);
      applyIcon(cell.icon, cell.iconKey, hex);
      cell.icon.alpha = 1;
      cell.value.alpha = 1;
      if (highlight) this.highlightedCells.push(cell);
      cell.icon.width = iconSize;
      cell.icon.height = iconSize;

      const ix = cx + Math.cos(angle) * RADIAL_OFFSET - iconSize / 2;
      const iy = cy + Math.sin(angle) * RADIAL_OFFSET - iconSize / 2;
      cell.icon.x = ix;
      cell.icon.y = iy;

      cell.value.text = String(val);
      cell.value.style.fontSize = fontSize;
      cell.value.style.fill = highlight ? t.activeAction.active : t.textOnTinted;
      // Place text outward from the icon
      const textOffset = RADIAL_OFFSET + iconSize / 2 + 2;
      cell.value.x = cx + Math.cos(angle) * textOffset;
      cell.value.y = cy + Math.sin(angle) * textOffset;
    };

    // ── Radial stats — tweak START/END to rotate them all at once ──
    // Opponent (top-anchored) shifts the arc down; HP always on top
    const START_ANGLE = this.anchorTop ? -Math.PI * 0.14 : -Math.PI * 0.34;
    const END_ANGLE = this.anchorTop ? Math.PI * 0.34 : Math.PI * 0.14;

    const radialStats: { cell: StatCell; val: number; sz: number; font: number; hl: boolean }[] = [
      { cell: this.lifeStat, val: state.life, sz: 24, font: 16, hl: false },
      { cell: this.handStat, val: state.handCount, sz: RADIAL_ICON, font: 13, hl: false },
      { cell: this.deckStat, val: state.libraryCount, sz: RADIAL_ICON, font: 13, hl: false },
      {
        cell: this.gyStat,
        val: state.graveyardCount,
        sz: RADIAL_ICON,
        font: 13,
        hl: state.hasPlayableInGraveyard,
      },
      {
        cell: this.exileStat,
        val: state.exileCount,
        sz: RADIAL_ICON,
        font: 13,
        hl: state.hasPlayableInExile,
      },
    ];
    for (let i = 0; i < radialStats.length; i++) {
      const frac = radialStats.length > 1 ? i / (radialStats.length - 1) : 0;
      const angle = START_ANGLE + (END_ANGLE - START_ANGLE) * frac;
      const s = radialStats[i]!;
      placeRadial(s.cell, s.val, angle, s.sz, s.font, s.hl);
    }

    const zoneBaseX = cx + AVATAR_R + 2;

    // Conditional stats (poison, energy, etc.) — below the avatar
    let condCursorX = zoneBaseX;
    const condY = cy + AVATAR_R + 4;

    const placeStat2 = (cell: StatCell, val: number, visible: boolean, highlight: boolean) => {
      cell.icon.visible = visible;
      cell.value.visible = visible;
      if (!visible) return;
      const hex = highlight ? t.activeAction.active : getIconColor(cell.iconKey, t);
      applyIcon(cell.icon, cell.iconKey, hex);
      cell.icon.x = condCursorX;
      cell.icon.y = condY;
      cell.value.text = String(val);
      cell.value.style.fill = highlight ? t.activeAction.active : t.textOnTinted;
      cell.value.x = condCursorX + ICON_SIZE + 2;
      cell.value.y = condY + ICON_SIZE / 2;
      condCursorX += ICON_SIZE + 2 + cell.value.width + STAT_GAP;
    };

    placeStat2(this.poisonStat, state.poison, state.poison > 0, false);
    placeStat2(this.energyStat, state.energyCounters, state.energyCounters > 0, false);
    placeStat2(this.cmdDmgStat, state.commanderDamage, state.commanderDamage > 0, false);

    // Command zone: fixed position — 11:30 for self, 6 o'clock for opponent
    if (state.commandZoneCount > 0) {
      const cmdAngle = this.anchorTop ? Math.PI * 0.5 : -Math.PI * 0.58;
      const CMD_ICON = 20;
      const cmdOffset = RADIAL_OFFSET;
      const cmdIx = cx + Math.cos(cmdAngle) * cmdOffset - CMD_ICON / 2;
      const cmdIy = cy + Math.sin(cmdAngle) * cmdOffset - CMD_ICON / 2;
      const cmdHex = getIconColor("cmdsword", t);
      this.cmdZoneStat.icon.visible = true;
      applyIcon(this.cmdZoneStat.icon, "cmdsword", cmdHex);
      this.cmdZoneStat.icon.width = CMD_ICON;
      this.cmdZoneStat.icon.height = CMD_ICON;
      this.cmdZoneStat.icon.x = cmdIx;
      this.cmdZoneStat.icon.y = cmdIy;
    } else {
      this.cmdZoneStat.icon.visible = false;
    }
    this.cmdZoneStat.value.visible = false;

    // ── Mana pool ──
    const hasMana = Object.values(state.manaPool).some((v) => v > 0);
    this.manaContainer.visible = hasMana;
    if (hasMana) {
      let mx = zoneBaseX;
      const my = condY + ICON_SIZE + ROW_GAP;
      for (const e of this.manaEntries) {
        const v = state.manaPool[e.key] ?? 0;
        e.sprite.visible = v > 0;
        e.count.visible = v > 0;
        if (v > 0) {
          e.sprite.x = mx;
          e.sprite.y = my;
          e.count.text = String(v);
          e.count.x = mx + MANA_SYM_SIZE + 1;
          e.count.y = my + 1;
          mx += MANA_SYM_SIZE + 16;
        }
      }
    }
  }

  tick(): void {
    this.priorityGlow.clear();
    if (!this.glowActive) {
      this.priorityGlow.alpha = 0;
      return;
    }

    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.2 * Math.sin(t * 2.5);
    const expandPulse = 1 + 0.05 * Math.sin(t * 2.5);
    const baseR = AVATAR_R * expandPulse;
    const maxSpread = 10;
    const steps = 20;

    // Draw many thin concentric rings for a smooth radial fade
    for (let i = steps; i >= 0; i--) {
      const frac = i / steps; // 1 = outermost, 0 = innermost
      const r = baseR + frac * maxSpread;
      // Alpha falls off quadratically from center outward
      const falloff = (1 - frac) * (1 - frac);
      const alpha = pulse * 0.3 * falloff;
      if (alpha < 0.003) continue;
      this.priorityGlow.circle(this.glowCx, this.glowCy, r);
      this.priorityGlow.fill({ color: this.glowColor, alpha });
    }
    this.priorityGlow.alpha = 1;

    // Pulse highlighted zone icons (GY/Exile with playable cards) — icon only, gentle
    if (this.highlightedCells.length > 0) {
      const pulse = 0.7 + 0.3 * Math.sin(t * 2.5);
      for (const cell of this.highlightedCells) {
        cell.icon.alpha = pulse;
      }
    }
  }

  destroy(): void {
    try {
      this.container.destroy();
    } catch {
      /* pixi teardown */
    }
  }
}
