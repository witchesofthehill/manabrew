// Script-visible hierarchy produced by TextViewer::extractLayoutInfo.
const node = (width = 0, top = 0, height = 0) => ({ width, top, height });
const size = (target, line) => { target.width = Math.max(target.width, line.width); target.height = Math.max(target.height, line.top + line.height - target.top); };
export function textLayoutInfo(lines) {
  const layout = { ...node(), lines: [], clauses: [], paragraphs: [], blocks: [], separators: [] };
  let clause, paragraph, block;
  for (const source of lines) {
    const line = node(source.width, source.top, source.height);
    if (!block) { block = { ...line, lines: [], clauses: [], paragraphs: [] }; layout.blocks.push(block); }
    if (!paragraph) { paragraph = { ...line, lines: [], clauses: [] }; block.paragraphs.push(paragraph); layout.paragraphs.push(paragraph); }
    if (!clause) { clause = { ...line, lines: [] }; paragraph.clauses.push(clause); block.clauses.push(clause); layout.clauses.push(clause); }
    for (const parent of [clause, paragraph, block, layout]) { parent.lines.push(line); if (line.height > 0) size(parent, line); }
    if (source.break === 'line') clause = paragraph = block = null;
    else if (source.break === 'hard') clause = paragraph = null;
    else if (source.break === 'soft') clause = null;
  }
  for (let i = 0; i + 1 < layout.blocks.length; i++) layout.separators.push((layout.blocks[i].top + layout.blocks[i].height + layout.blocks[i+1].top) / 2);
  const seen = new Set();
  for (const item of [layout, ...layout.lines, ...layout.clauses, ...layout.paragraphs, ...layout.blocks]) {
    if (seen.has(item)) continue;
    seen.add(item); item.bottom = item.top + item.height; item.middle = item.top + item.height / 2;
  }
  return layout;
}
export const dummyTextLayout = () => textLayoutInfo([{width:0,top:0,height:0,break:'no'}]);
