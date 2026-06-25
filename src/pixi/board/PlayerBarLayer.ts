import {
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
  type TextStyle,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { darken } from "@/themes/gameTheme";
import { hexToNum } from "../colorUtils";
import { gameIconTexture } from "../gameIconCache";
import { TABLE_RADIUS } from "../constants";

/** Game-icon shown inside the avatar circle for bot players. */
const BOT_ICON_NAME = "robot-antennas";

/** Height, in px, of the opponent horizontal player bar. */
export const PLAYER_BAR_HEIGHT_PX = 44;
/** The self bar is taller (more space at the bottom) → a bigger avatar. */
export const SELF_PLAYER_BAR_HEIGHT_PX = 60;
/** Gap above the opponent bar so it doesn't touch the screen edge. */
export const PLAYER_BAR_TOP_MARGIN_PX = 8;
/** Gap left and right of the bar within its field band. */
export const PLAYER_BAR_SIDE_MARGIN_PX = 10;
/** A bar never grows past this — a focused field is much wider than its bar. */
export const PLAYER_BAR_MAX_WIDTH_PX = 360;
/** Height of the collapsed column ("sphere") form. */
export const PLAYER_BAR_COLUMN_HEIGHT_PX = 124;
const BAR_PAD_PX = 4;
const GAP_PX = 6;
const CHIP_RADIUS = 6;

/** Glyph per zone tile, keyed by `PlayerZoneSpec.key`. */
const ZONE_ICONS: Record<string, string> = { cmd: "♛", gy: "✝", ex: "☼", lib: "▤" };

/** A zone tile (graveyard / exile / command) shown on the expanded bar. */
export interface PlayerZoneSpec {
  key: string;
  label: string;
  count: number;
  /** Set when the tile should pulse/outline (playable or targetable); the colour
   *  is the highlight. Undefined = no highlight. */
  highlightColor?: string;
  onOpen?: () => void;
}

export interface PlayerBarSpec {
  playerId: string;
  name: string;
  life: number;
  /** Seat colour (hex) used for the accent border. */
  color: string;
  avatarUrl?: string;
  isBot: boolean;
  zones: PlayerZoneSpec[];
  isActiveTurn: boolean;
  isTargetable: boolean;
}

interface ZoneChip {
  container: Container;
  bg: Graphics;
  text: Text;
  spec: PlayerZoneSpec;
  hovered: boolean;
}

interface Bar {
  container: Container;
  bg: Graphics;
  avatar: Sprite;
  bot: Sprite;
  avatarHit: Graphics;
  avatarMask: Graphics;
  initial: Text;
  avatarUrl: string | null;
  /** Frozen at first sight — a player's bot-ness is immutable, so we don't let a
   *  wobbling `isHuman` in later updates flip the avatar. */
  isBot: boolean;
  heart: Text;
  life: Text;
  chipRow: Container;
  chips: ZoneChip[];
  spec: PlayerBarSpec;
  width: number;
  height: number;
  column: boolean;
}

/** A player "bar" per player, rendered in Pixi. Expanded fields show a
 *  horizontal bar (avatar + name + life + zone tiles); collapsed fields show a
 *  round avatar "sphere" + life. Tapping the avatar targets the player; tapping
 *  a zone tile opens that zone. `BoardScene` positions each one. */
export class PlayerBarLayer {
  readonly container: Container;
  private theme: Theme;
  private onTarget: (playerId: string) => void;
  private bars = new Map<string, Bar>();

  constructor(theme: Theme, onTarget: (playerId: string) => void) {
    this.theme = theme;
    this.onTarget = onTarget;
    this.container = new Container();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const bar of this.bars.values()) this.redraw(bar);
  }

  setBars(specs: PlayerBarSpec[]): void {
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.playerId);
      const bar = this.bars.get(spec.playerId) ?? this.createBar(spec);
      bar.spec = spec;
      this.updateAvatar(bar, spec.avatarUrl);
      this.rebuildChips(bar);
      this.redraw(bar);
    }
    for (const [id, bar] of [...this.bars]) {
      if (seen.has(id)) continue;
      this.container.removeChild(bar.container);
      bar.container.destroy({ children: true });
      this.bars.delete(id);
    }
  }

  setRect(
    playerId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    column: boolean,
  ): void {
    const bar = this.bars.get(playerId);
    if (!bar) return;
    bar.container.position.set(x, y);
    if (bar.width !== width || bar.height !== height || bar.column !== column) {
      bar.width = width;
      bar.height = height;
      bar.column = column;
      this.redraw(bar);
    }
  }

  private textStyle(size = 15): Partial<TextStyle> {
    return {
      fontFamily: "system-ui, sans-serif",
      fontSize: size,
      fontWeight: "700",
      fill: hexToNum(this.theme.gameTheme.textOnTinted),
    };
  }

  private heartStyle(size = 17): Partial<TextStyle> {
    return {
      fontFamily: "system-ui, sans-serif",
      fontSize: size,
      fontWeight: "900",
      fill: hexToNum(this.theme.gameTheme.pt.lethal),
    };
  }

  private updateAvatar(bar: Bar, url: string | undefined): void {
    // Ignore transient clears (a missing avatar in one update shouldn't drop a
    // loaded image and flip to the bot/initial); only react to a real new URL.
    if (!url || url === bar.avatarUrl) return;
    bar.avatarUrl = url;
    Assets.load<Texture>(url)
      .then((tex) => {
        if (bar.avatarUrl !== url) return;
        bar.avatar.texture = tex;
        this.redraw(bar);
      })
      .catch(() => {});
  }

  private rebuildChips(bar: Bar): void {
    const want = bar.spec.zones;
    // Only rebuild the chip set when the zone identities change; otherwise keep
    // the sprites (cheap) and just refresh content in redraw.
    const sameSet =
      bar.chips.length === want.length && bar.chips.every((c, i) => c.spec.key === want[i]!.key);
    if (!sameSet) {
      for (const chip of bar.chips) {
        bar.chipRow.removeChild(chip.container);
        chip.container.destroy({ children: true });
      }
      bar.chips = want.map((spec) => this.createChip(bar, spec));
      for (const chip of bar.chips) bar.chipRow.addChild(chip.container);
    }
    bar.chips.forEach((chip, i) => (chip.spec = want[i]!));
  }

  private createChip(bar: Bar, spec: PlayerZoneSpec): ZoneChip {
    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      chip.spec.onOpen?.();
    });
    container.on("pointerover", () => {
      chip.hovered = true;
      this.redraw(bar);
    });
    container.on("pointerout", () => {
      chip.hovered = false;
      this.redraw(bar);
    });
    const bg = new Graphics();
    const text = new Text({ text: "", style: this.textStyle(12) });
    text.anchor.set(0.5);
    container.addChild(bg, text);
    const chip: ZoneChip = { container, bg, text, spec, hovered: false };
    return chip;
  }

  private createBar(spec: PlayerBarSpec): Bar {
    const container = new Container();

    const bg = new Graphics();
    const avatarMask = new Graphics();
    const avatar = new Sprite();
    avatar.anchor.set(0.5);
    avatar.visible = false;
    const bot = new Sprite();
    bot.anchor.set(0.5);
    bot.visible = false;
    const avatarHit = new Graphics();
    avatarHit.eventMode = "static";
    avatarHit.cursor = "pointer";
    avatarHit.on("pointertap", () => this.onTarget(spec.playerId));
    const initial = new Text({ text: "", style: this.textStyle() });
    initial.anchor.set(0.5);
    const heart = new Text({ text: "♥", style: this.heartStyle() });
    const life = new Text({ text: String(spec.life), style: this.textStyle() });
    const chipRow = new Container();
    container.addChild(bg, avatar, bot, initial, avatarHit, heart, life, chipRow);
    this.container.addChild(container);

    const bar: Bar = {
      container,
      bg,
      avatar,
      bot,
      avatarHit,
      avatarMask,
      initial,
      avatarUrl: null,
      isBot: spec.isBot,
      heart,
      life,
      chipRow,
      chips: [],
      spec,
      width: 0,
      height: 0,
      column: false,
    };
    container.addChild(avatarMask);
    this.bars.set(spec.playerId, bar);
    return bar;
  }

  private drawAvatar(bar: Bar, cx: number, cy: number, diameter: number, accent: number): void {
    const { bg, avatar, bot, avatarHit, avatarMask, initial, spec } = bar;
    const gt = this.theme.gameTheme;
    const r = diameter / 2;
    bg.circle(cx, cy, r);
    bg.fill({ color: hexToNum(darken(gt.canvas.background, 0.35)), alpha: 1 });
    // The avatar ring is the only border kept — it doubles as the active-turn cue.
    bg.stroke({
      color: accent,
      width: spec.isActiveTurn ? 2.5 : 1,
      alpha: spec.isActiveTurn ? 0.95 : 0.5,
    });

    // Inside the circle, in priority: the avatar photo → a bot icon → the first
    // letter of the name. All centred on (cx, cy).
    const hasImage = !!bar.avatarUrl && avatar.texture !== Texture.EMPTY;
    const showBot = !hasImage && bar.isBot;
    const showInitial = !hasImage && !bar.isBot;

    avatar.visible = hasImage;
    if (hasImage) {
      avatar.position.set(cx, cy);
      // Uniform "cover" scale — preserve the image's aspect ratio and let the
      // circular mask crop the overflow, rather than stretching to a square.
      const tw = avatar.texture.width || diameter;
      const th = avatar.texture.height || diameter;
      avatar.scale.set(diameter / Math.min(tw, th));
      avatarMask.clear();
      avatarMask.circle(cx, cy, r);
      avatarMask.fill({ color: 0xffffff });
      avatar.mask = avatarMask;
    } else {
      avatar.mask = null;
    }

    bot.visible = showBot;
    if (showBot) {
      if (bot.texture === Texture.EMPTY) {
        gameIconTexture(BOT_ICON_NAME)
          .then((tex) => {
            bot.texture = tex;
            this.redraw(bar);
          })
          .catch(() => {});
      }
      bot.tint = hexToNum(gt.textOnTinted);
      bot.width = diameter * 0.62;
      bot.height = diameter * 0.62;
      bot.position.set(cx, cy);
    }

    initial.visible = showInitial;
    if (showInitial) {
      initial.text = spec.name.trim()[0]?.toUpperCase() ?? "?";
      initial.style = { ...this.textStyle(Math.round(diameter * 0.5)), fontWeight: "800" };
      initial.position.set(cx, cy);
    }

    avatarHit.clear();
    avatarHit.circle(cx, cy, r);
    avatarHit.fill({ color: 0xffffff, alpha: 0.001 });
  }

  private redraw(bar: Bar): void {
    const { bg, heart, life, chipRow, spec, width, height, column } = bar;
    if (width <= 0 || height <= 0) return;
    const gt = this.theme.gameTheme;
    const accent = spec.isActiveTurn ? hexToNum(gt.activeAction.active) : hexToNum(spec.color);
    bg.clear();
    heart.text = "♥";
    heart.style = this.heartStyle(column ? 15 : 17);
    life.text = String(spec.life);
    life.style = this.textStyle(column ? 14 : 16);

    if (column) {
      // Collapsed field → avatar "sphere" + ♥life below; no chips.
      chipRow.visible = false;
      const diameter = Math.max(8, Math.min(width - BAR_PAD_PX * 2, height - 28));
      const cx = width / 2;
      const cy = BAR_PAD_PX + 2 + diameter / 2;
      this.drawAvatar(bar, cx, cy, diameter, accent);
      heart.anchor.set(0, 0.5);
      life.anchor.set(0, 0.5);
      const total = heart.width + 3 + life.width;
      const ly = cy + diameter / 2 + 3 + Math.max(heart.height, life.height) / 2;
      heart.position.set(cx - total / 2, ly);
      life.position.set(cx - total / 2 + heart.width + 3, ly);
      return;
    }

    // Expanded field → solid bar (no border) with the avatar as a circular cap
    // at the left edge: the panel bg begins at the circle's centre, so the
    // circle's left half overhangs the bar.
    chipRow.visible = true;
    const avatarD = height;
    const avatarCx = avatarD / 2;
    bg.roundRect(avatarCx, 0, Math.max(0, width - avatarCx), height, TABLE_RADIUS);
    bg.fill({ color: hexToNum(darken(gt.canvas.background, 0.45)), alpha: 1 });
    this.drawAvatar(bar, avatarCx, height / 2, avatarD, accent);

    heart.anchor.set(0, 0.5);
    life.anchor.set(0, 0.5);
    heart.position.set(avatarCx + avatarD / 2 + GAP_PX, height / 2);
    life.position.set(heart.x + heart.width + 3, height / 2);

    // Zone chips: icon + count, laid right to left from the right edge.
    let cursor = width - BAR_PAD_PX - GAP_PX;
    const chipH = height - BAR_PAD_PX * 2 - 6;
    for (let i = bar.chips.length - 1; i >= 0; i--) {
      const chip = bar.chips[i]!;
      const icon = ZONE_ICONS[chip.spec.key] ?? chip.spec.label;
      const hl = chip.spec.highlightColor;
      chip.text.text = `${icon} ${chip.spec.count}`;
      // No chip border — highlight is shown by tinting the text; the rounded
      // rect only appears on hover.
      chip.text.style = {
        ...this.textStyle(12),
        fill: hl ? hexToNum(hl) : hexToNum(gt.textOnTinted),
      };
      const chipW = Math.ceil(chip.text.width) + 12;
      cursor -= chipW;
      chip.container.position.set(cursor, BAR_PAD_PX + 3);
      chip.bg.clear();
      if (chip.hovered) {
        chip.bg.roundRect(0, 0, chipW, chipH, CHIP_RADIUS);
        chip.bg.fill({ color: hexToNum(gt.canvas.neutral), alpha: 0.28 });
      }
      chip.container.hitArea = new Rectangle(0, 0, chipW, chipH);
      chip.text.position.set(chipW / 2, chipH / 2);
      cursor -= GAP_PX;
    }
  }

  destroy(): void {
    for (const bar of this.bars.values()) bar.container.destroy({ children: true });
    this.bars.clear();
    this.container.destroy({ children: true });
  }
}
