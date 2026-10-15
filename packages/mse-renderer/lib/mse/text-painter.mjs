import { prepareFontDrawing } from './font-painter.mjs';
import { cssColor, prepareSymbolDrawing } from './symbol-painter.mjs';

// Drawing consumes the same source-indexed runs and positions as measurement.
// Unsupported effects fail before drawing so callers cannot mistake a partial
// frame for a complete renderer result.
export async function paintTextLayout(ctx, layout, fonts, { x = 0, y = 0, showSoft = false, createBitmap, fontSizeStep, height = Infinity } = {}) {
  // TextViewer::Line::visible tests vertical intersection; it does not clip
  // partially visible lines to the field rectangle.
  const lines=layout.lines.filter(line=>line.top+(line.height??0)>0&&line.top<height);
  const runs=layout.measurement.runs.filter(run=>(!run.soft||showSoft)&&lines.some(line=>Math.max(line.start,run.characterStart)<Math.min(line.end,run.characterStart+[...run.text].length)));
  const prepared = new Map();
  for (const run of runs) {
    if (run.symbol) {
      prepared.set(run, await prepareSymbolDrawing(run.measured, fonts, { createBitmap, fontSizeStep }));
      continue;
    }
    const font = run.font;
    prepared.set(run, await prepareFontDrawing(font, fonts, { fromTag: run.fromTag }));
  }
  ctx.save();
  try {
    ctx.translate(x, y);
    if(layout.stretch!==undefined&&layout.stretch!==1)ctx.scale(layout.stretch,1);
    for (const line of lines) for (const run of runs) {
      if (run.soft && !showSoft) continue;
      if (run.symbol) { prepared.get(run)(ctx, line, run.characterStart); continue; }
      const chars = [...run.text];
      const start = Math.max(line.start, run.characterStart), end = Math.min(line.end, run.characterStart + chars.length);
      if (start >= end) continue;
      ctx.fillStyle = cssColor(run.font.color);
      const draw = (a,b) => {
        const content = chars.slice(a-run.characterStart,b-run.characterStart).join('').replace(/\n$/, '');
        if (content) prepared.get(run).draw(ctx, content, line.positions[a-line.start], line.top, layout.scale);
      };
      if (line.justifying) for (let i=start;i<end;i++) draw(i,i+1);
      else draw(start,end);
    }
  } finally { ctx.restore(); }
}
