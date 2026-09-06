import type { ArenaCard, ArenaColors } from "@/three/arena.types";

export function drawFrame(ctx: CanvasRenderingContext2D, card: ArenaCard, colors: ArenaColors) {
  const finish = card.frame ?? "C";
  const bevel = ctx.createLinearGradient(0, 0, 384, 330);
  bevel.addColorStop(0, colors.foreground);
  bevel.addColorStop(0.12, card.color);
  bevel.addColorStop(0.45, colors.background);
  bevel.addColorStop(0.72, card.color);
  bevel.addColorStop(1, colors.background);
  ctx.strokeStyle = bevel;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.roundRect(10, 10, 364, 310, 13);
  ctx.stroke();
  const enamel = ctx.createLinearGradient(0, 8, 0, 43);
  enamel.addColorStop(0, colors.foreground);
  enamel.addColorStop(0.15, card.color);
  enamel.addColorStop(0.8, card.color);
  enamel.addColorStop(1, colors.background);
  ctx.fillStyle = enamel;
  ctx.beginPath();
  ctx.roundRect(13, 10, 358, 33, [9, 9, 3, 3]);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(14, 12, 356, 306, 10);
  ctx.rect(22, 45, 340, 257);
  ctx.clip("evenodd");
  ctx.strokeStyle = colors.foreground;
  ctx.lineWidth = 0.65;
  ctx.globalAlpha = 0.22;
  for (let y = 0; y < 340; y += 13) {
    for (let x = 0; x < 390; x += 22) {
      ctx.beginPath();
      if (finish === "U") {
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 6, y - 5, x + 14, y + 5, x + 22, y);
      } else if (finish === "G") {
        ctx.ellipse(x, y, 3, 9, -0.6, 0, Math.PI * 2);
      } else if (finish === "R") {
        ctx.moveTo(x, y + 8);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x + 3, y - 5);
        ctx.lineTo(x + 13, y - 9);
      } else if (finish === "B") {
        ctx.moveTo(x, y + 9);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x + 2, y - 6);
        ctx.lineTo(x + 10, y - 3);
      } else if (finish === "W") {
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
      } else {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 6, y);
        ctx.closePath();
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = colors.foreground;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(16, 15, 352, 300, 8);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = finish === "B" ? colors.foreground : colors.background;
  ctx.font = "bold 22px Georgia";
  ctx.fillText(card.name, 23, 33, 338);
}
