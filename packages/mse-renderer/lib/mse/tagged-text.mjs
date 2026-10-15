import { color } from './color-values.mjs';
import { MseError } from './document.mjs';
import { measureTextRun } from './text-metrics.mjs';
import { measureSymbolRun } from './symbol-layout.mjs';
import { splitSymbols } from './symbol-font.mjs';
import {parseAlignment} from './alignment.mjs';
const parameterColors=['rgb(0,170,0)','rgb(0,0,200)','rgb(200,0,100)','rgb(200,200,0)','rgb(0,170,170)','rgb(200,0,0)'];

export function parseTaggedText(source, baseFont) {
  const decorations = [], activeDecorations = [];
  const runs = [], unsupported = new Set(), warnings = [];
  const paragraphs=[{start:0}],alignments=[],clauses=[{start:0}],margins=[];
  const counts = Object.fromEntries(['b','i','u','strike','sym','line','soft-line','soft','sep-soft','atom-kwpph','atom-param','ref-param','li','code','code-kw','code-str'].map(k => [k, 0]));
  let parameterIndex=0;
  const stacks = { color: [], size: [], font: [] };
  const append = (content, start, end) => {
    if (!content) return;
    for(let i=start;i<end;i++)if(source[i]==='\n'){
      clauses.at(-1).end=i+1;
      clauses.push({start:i+1,...margins.at(-1)});
      if(counts.line<=0&&counts['soft-line']>0)continue;
      paragraphs.at(-1).end=i+1;
      paragraphs.push({start:i+1,alignment:alignments.at(-1)});
    }
    const soft = counts.soft > 0 || counts['sep-soft'] > 0;
    const font = { ...baseFont, bold: baseFont.bold || counts.b > 0, italic: baseFont.italic || counts.i > 0,
      underline: baseFont.underline || counts.u > 0, strikethrough: baseFont.strikethrough || counts.strike > 0 };
    if(counts['code-str']>0)font.color=color('rgb(0,0,100)');
    if(counts.code>0){font.code=true;font.color=color('rgb(128,0,0)');}
    if(counts['code-kw']>0){font.bold=true;font.color=color('rgb(158,100,0)');}
    if (soft || counts['atom-kwpph'] > 0) { font.color = font.separator_color; font.shadow_displacement_x = 0; font.shadow_displacement_y = 0; }
    if (stacks.color.length) font.color = stacks.color.at(-1);
    if((counts['atom-param']>0||counts['ref-param']>0)&&counts.sym<=0)font.color=color(parameterColors[parameterIndex++%parameterColors.length]);
    if (stacks.size.length) font.size = stacks.size.at(-1);
    if (stacks.font.length && stacks.font.at(-1)) font.name = stacks.font.at(-1);
    // Native placeholders occupy the adjacent markup characters with visible
    // angle brackets; they use separator color but remain normal drawn text.
    if ((counts['atom-kwpph'] > 0||counts['atom-param']>0) && counts.sym <= 0) { content='‹'+content+'›';start--;end++; }
    runs.push({ text: content.replaceAll('\u0001','<'), start, end, font, fromTag: stacks.font.length > 0,
      decorationIds: activeDecorations.map(d => d.id), symbol: counts.sym > 0, soft, breakStyle: counts.line > 0 ? 'line' : counts['soft-line'] > 0 ? 'soft' : 'hard' });
  };
  let pos = 0;
  for (const match of source.matchAll(/<[^>]*(?:>|$)/g)) {
    append(source.slice(pos, match.index), pos, match.index);
    pos = match.index + match[0].length;
    const tag = match[0].slice(1).replace(/>$/, ''), closing = tag.startsWith('/'), body = closing ? tag.slice(1) : tag;
    if(/^ref-param(?:$|[-: ])/.test(body)){
      if(!closing){
        // Native ToLong requires the whole suffix to parse. A space-separated
        // number works; a colon suffix does not reset the running color index.
        const suffix=body.slice('ref-param'.length);
        if(/^\s*[+-]?\d+$/.test(suffix)){
          const value=BigInt(suffix.trim());
          if(value>=-(1n<<63n)&&value<(1n<<63n))parameterIndex=Number(BigInt.asUintN(64,value-1n)%6n)+6;
        }
      }
      counts['ref-param']+=closing?-1:1;
      continue;
    }
    if(/^bullet(?:$|[-: ])/.test(body)){
      const key=closing?'bulletEnd':'bulletStart';
      if(paragraphs.at(-1)[key]===undefined)paragraphs.at(-1)[key]=closing?pos:match.index;
      if(counts.li<=0)warnings.push('<bullet> outside <li> tag');
      continue;
    }
    if(/^margin(?:$|[-: ])/.test(body)){
      if(closing)margins.pop();
      else if(body.includes(':')){
        // Preserve native substring boundaries, including the trailing space
        // expected before the first two separators. wx ToDouble keeps prefixes.
        const separator=start=>{const offset=source.slice(start).search(/[>:]/);return offset<0?source.length:start+offset;};
        const a=separator(match.index),b=separator(a+1),c=b<pos-1?separator(b+1):b;
        const number=(start,count)=>{const value=Number.parseFloat(source.slice(start,count<0?undefined:start+count));return Number.isFinite(value)?value:0;};
        const prior=margins.at(-1)||{};
        const margin={marginLeft:number(a+1,b-a-2)+(prior.marginLeft||0),marginRight:number(b+1,c-b-2)+(prior.marginRight||0),marginTop:number(c+1,pos-c-2)+(prior.marginTop||0)};
        margins.push(margin);Object.assign(clauses.at(-1),margin);
      }
      continue;
    }
    if(/^align(?:$|[-: ])/.test(body)){
      if(closing)alignments.pop();
      else if(body.includes(':')){
        const alignment=parseAlignment(body.slice(body.indexOf(':')+1));
        alignments.push(alignment);paragraphs.at(-1).alignment=alignment;
      }
      continue;
    }
    const counter = Object.keys(counts).sort((a,b) => b.length-a.length).find(k => body === k || body.startsWith(k+':') || body.startsWith(k+'-') || body.startsWith(k+' '));
    if (counter) { counts[counter] += closing ? -1 : 1; continue; }
    const stackName = Object.keys(stacks).find(k => body === k || body.startsWith(k+':') || body.startsWith(k+'-') || body.startsWith(k+' '));
    if (stackName) {
      if (closing) stacks[stackName].pop();
      else if (body.includes(':')) {
        let value = body.slice(body.indexOf(':') + 1);
        if (stackName === 'color') {
          try { value = color(value); } catch { warnings.push(`Invalid color: ${value}`); value = baseFont.color; }
        } else if (stackName === 'size') { value = Number(value); if (!Number.isFinite(value)) value = baseFont.size; }
        stacks[stackName].push(value);
      }
      continue;
    }
    const wrapper = /^(atom|error)(?:$|[-: ])/.exec(body)?.[1];
    if (wrapper && !/^atom-(param|kwpph)(?:$|[-: ])/.test(body)) {
      if (closing) {
        const index = activeDecorations.findLastIndex(d => d.type === wrapper);
        if (index >= 0) {
          activeDecorations[index].end = match.index;
          activeDecorations.splice(index, 1);
        }
      } else {
        const dark = baseFont.color.channels.slice(0,3).reduce((a,b) => a+b,0) < 510;
        const decoration = { id: decorations.length, type: wrapper, start: pos, end: source.length,
          ...(wrapper === 'atom' ? { background: color(dark ? 'rgb(210,210,210)' : 'rgb(60,60,60)') } : {}) };
        decorations.push(decoration); activeDecorations.push(decoration);
      }
      continue;
    }
    // These native tags need structural layout or editor decorations. Do not
    // report a successful measurement while silently discarding their effect.
    if (/^(?:atom|error|li|bullet|margin|align|code|ref-param)(?:$|[-: ])/.test(body)) unsupported.add(body.split(/[: ]/)[0]);
  }
  append(source.slice(pos), pos, source.length);
  paragraphs.at(-1).end=source.length;
  clauses.at(-1).end=source.length;
  const indices = new Map();
  let utf16 = 0, character = 0;
  for (const c of source) { indices.set(utf16, character++); utf16 += c.length; }
  indices.set(source.length, character);
  for (const item of [...runs, ...decorations,...paragraphs,...clauses]) { item.sourceStart = indices.get(item.start); item.sourceEnd = indices.get(item.end); }
  for(const paragraph of paragraphs){paragraph.bulletStart=indices.get(paragraph.bulletStart);paragraph.bulletEnd=indices.get(paragraph.bulletEnd);}
  return { runs, decorations,paragraphs,clauses, sourceLength: character, unsupported: [...unsupported], warnings };
}

export async function measureTaggedText(parsed, fonts, symbolRun, renderer, { scale = 1, alwaysSymbol = false } = {}) {
  if (parsed.unsupported.length) throw new MseError('text-tags', `Unsupported structural text tags: ${parsed.unsupported.join(', ')}`);
  const runs = [], characters = Array.from({ length: parsed.sourceLength }, () => ({ width: 0, height: 0, break: 'no', soft: true, bullet: false, tag: true }));
  for (const run of parsed.runs) {
    const segments = [];
    if (symbolRun?.font && (run.symbol || alwaysSymbol)) {
      const matches = splitSymbols(symbolRun.font, run.text);
      if (run.symbol) segments.push({ ...run, matches, symbol: true });
      else {
        let offset = 0;
        for (const match of matches) {
          if (match.offset > offset) segments.push({ ...run, text: run.text.slice(offset, match.offset), sourceStart: run.sourceStart + [...run.text.slice(0, offset)].length, symbol: false });
          segments.push({ ...run, text: match.text, sourceStart: run.sourceStart + [...run.text.slice(0, match.offset)].length, matches: [match], symbol: true });
          offset = match.offset + match.text.length;
        }
        if (offset < run.text.length) segments.push({ ...run, text: run.text.slice(offset), sourceStart: run.sourceStart + [...run.text.slice(0, offset)].length, symbol: false });
      }
    } else segments.push({ ...run, symbol: false });
    for (const segment of segments) {
      const measured = segment.symbol
        ? await measureSymbolRun({ ...symbolRun, symbols: segment.matches }, renderer, { scale })
        : measureTextRun(segment.text, segment.font, await fonts.prepare(segment.font, { fromTag: segment.fromTag }), { scale, soft: segment.soft, breakStyle: segment.breakStyle });
      runs.push({ ...segment, characterStart: segment.sourceStart, measured });
      measured.characters.forEach((c, i) => { characters[segment.sourceStart + i] = c; });
    }
  }
  for(const paragraph of parsed.paragraphs||[])if(paragraph.alignment!==undefined)
    for(let i=paragraph.sourceStart;i<paragraph.sourceEnd;i++)characters[i].alignment=paragraph.alignment;
  for(const clause of parsed.clauses||[])for(let i=clause.sourceStart;i<clause.sourceEnd;i++)
    Object.assign(characters[i],{marginLeft:clause.marginLeft||0,marginRight:clause.marginRight||0,marginTop:clause.marginTop||0});
  for(const paragraph of parsed.paragraphs||[]){
    if(characters[paragraph.bulletStart])characters[paragraph.bulletStart].bulletMarginBefore=true;
    if(characters[paragraph.bulletEnd])characters[paragraph.bulletEnd].bulletMarginAfter=true;
  }
  return { runs, characters, decorations: parsed.decorations, warnings: parsed.warnings,
    minScale: Math.max(0.0001, ...runs.map(r => r.measured.minScale)),
    scaleStep: Math.min(1, ...runs.map(r => r.measured.scaleStep)),
  };
}
