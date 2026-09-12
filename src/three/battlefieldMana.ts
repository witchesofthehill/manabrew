import sprite from "@/three/assets/mana-sprite.svg";
import { manaCells } from "@/three/manaCells";

let spritePromise: Promise<HTMLImageElement | null> | undefined;

export function loadManaSprite() {
  return (spritePromise ??= new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = sprite;
  }));
}

export function drawBattlefieldMana(
  ctx: CanvasRenderingContext2D,
  cost: string,
  image: HTMLImageElement | null,
) {
  const symbols = Array.from(cost.matchAll(/\{([^{}]+)\}/g), (match) => match[1].toUpperCase());
  const size = Math.min(23, 160 / Math.max(1, symbols.length));
  const width = symbols.length * (size + 2);
  symbols.forEach((symbol, index) => {
    const x = 361 - width + index * (size + 2);
    const cell = manaCells[symbol];
    if (image && cell) {
      ctx.drawImage(image, cell[0] * 105, cell[1] * 105, 100, 100, x, 26 - size / 2, size, size);
    } else {
      ctx.save();
      ctx.font = `bold ${Math.min(17, size)}px Georgia`;
      ctx.textAlign = "center";
      ctx.fillText(symbol, x + size / 2, 32, size);
      ctx.restore();
    }
  });
  return width ? width + 7 : 0;
}
