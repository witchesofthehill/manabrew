// Native TextViewer::prepareLinesTryScales search, including its previous-scale
// fast path and height-based bounds. The evaluator must remeasure at each scale.
function* scaleSearch({ minScale, scaleStep, previousScale = 1, height, paddingBottom = 0 }) {
  let scale = previousScale, min = minScale;
  const step = Math.max(0.01, scaleStep);
  if (min >= 1) return { ...(yield 1), scale: 1 };
  const bottom = layout => layout.fitBottom === undefined ? (layout.lines.length ? layout.lines.at(-1).top + layout.lines.at(-1).height + paddingBottom : 0) : layout.fitBottom + paddingBottom;
  const upper = (layout, scale) => {
    const used = Math.min(height + 1, bottom(layout));
    return used < 1 ? 1 : scale * (height + 1) / used;
  };
  const lower = (layout, scale) => bottom(layout) < 1 ? 0 : scale * height / bottom(layout);
  let max = 1 + step, best, layout = (yield scale);
  if (layout.fits) {
    min = scale;
    max = Math.min(max, upper(layout, scale));
    if (scale + step >= max) return { ...layout, scale };
    scale += step;
    const next = (yield scale);
    if (next.fits) {
      layout = next; best = min = scale;
      max = Math.min(max, upper(layout, scale));
    } else return { ...layout, scale: min };
  } else {
    max = scale;
    min = Math.max(min, lower(layout, scale));
    best = scale = min;
    layout = (yield scale);
    max = Math.min(max, upper(layout, scale));
  }
  while (min + step < max) {
    scale = (min + max) / 2;
    const next = (yield scale);
    if (next.fits) {
      min = scale; max = Math.min(max, upper(next, scale)); best = scale; layout = next;
    } else {
      max = scale; min = Math.max(min, lower(next, scale));
    }
  }
  if (best !== min) layout = (yield min);
  return { ...layout, scale: min };
}

export function selectTextScale(evaluate, options) {
  const search = scaleSearch(options);
  let step = search.next();
  while (!step.done) step = search.next(evaluate(step.value));
  return step.value;
}
export async function selectTextScaleAsync(evaluate, options) {
  const search = scaleSearch(options);
  let step = search.next();
  while (!step.done) step = search.next(await evaluate(step.value));
  return step.value;
}
