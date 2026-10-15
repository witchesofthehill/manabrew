// The line-breaking stage of TextViewer::prepareLines. Alignment, mask-driven
// bounds, paragraph redistribution and shrink-to-fit are separate stages.
export function wrapTextCharacters(chars, {
  width, height = Infinity, paddingBottom = 0, paragraphHeight = -1, multiLine = true, vertical = false, stopIfTooLong = false,
  paddingLeft = 0, paddingRight = 0, paddingTop = 0, topOffset = 0, rowBounds = null,
  lineHeightSoft = 1, lineHeightHard = 1, lineHeightLine = 1, emptyClause = {},
} = {}) {
  const lines = [];
  const first=chars[0]??emptyClause;
  let line = { start: 0, endOrSoft: 0, positions: [paddingLeft], top: paddingTop + topOffset+(first.marginTop||0), height: 0, break: 'no',alignment:first.alignment,
    marginLeftAfterBullet:first.marginLeft||0,marginLeftBeforeBullet:first.marginLeft||0,marginRight:first.marginRight||0 };
  let lineWidth = paddingLeft, lineHeight = 0;
  let wordWidth = 0, wordHeight = 0, wordPositions = [], wordEndOrSoft = 0, wordStart = 0;
  const fitLine = () => {
    const leftMargin=line.bullet?line.marginLeftBeforeBullet:line.marginLeftAfterBullet;
    line.top = Math.floor(line.top + 0.5);
    const bounds = () => {
      const row = rowBounds ? rowBounds(line.top) : { left: 0, right: width };
      return { left: row.left + paddingLeft, right: row.right - paddingRight };
    };
    let row = bounds();
    while (Number.isFinite(height) && line.top < height && (row.right <= row.left || row.left + leftMargin + 1 >= width - paddingRight-line.marginRight)) {
      line.top++; row = bounds();
    }
    line.maskLeft = row.left; line.maskRight = row.right;
    lineWidth = row.left+leftMargin; line.positions = [lineWidth];
  };
  fitLine();
  const push = () => {
    if (!(lineHeight < 0.01 && lines.length)) line.height = lineHeight;
    line.end = line.start + line.positions.length - 1;
    line.endOrSoft = Math.max(line.start, Math.min(line.endOrSoft, line.end));
    line.width = line.positions[line.endOrSoft - line.start] - line.positions[0];
    lines.push({ ...line, positions: [...line.positions] });
  };
  const accept = () => {
    for (const x of wordPositions) line.positions.push(lineWidth + x);
    if (wordEndOrSoft) line.endOrSoft = wordEndOrSoft;
    lineWidth += wordWidth;
    lineHeight = Math.max(lineHeight, wordHeight);
    wordWidth = 0; wordHeight = 0; wordPositions = []; wordEndOrSoft = 0;
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if(c.bulletMarginBefore||c.bulletMarginAfter){
      let prefix=0;for(let j=line.start;j<i;j++)prefix+=chars[j].width;
      if(c.bulletMarginBefore)line.marginLeftBeforeBullet+=prefix;
      if(c.bulletMarginAfter)line.marginLeftAfterBullet+=prefix;
    }
    let breakNow = false, acceptWord = false, hideBreaker = true, wordTooLong = false;
    if (['wrap', 'soft', 'hard', 'line'].includes(c.break)) {
      breakNow = true; acceptWord = true; line.break = c.break;
    } else if (c.break === 'space' && multiLine) acceptWord = true;
    else if (c.break === 'maybe' && vertical) {
      breakNow = true; acceptWord = true; hideBreaker = false; line.break = 'wrap';
    }
    if (c.break !== 'line') { wordWidth += c.width; wordHeight = Math.max(wordHeight, c.height); }
    wordPositions.push(wordWidth);
    if (!c.soft) wordEndOrSoft = i + 1;
    if (!breakNow && lineWidth + wordWidth > line.maskRight-line.marginRight) {
      if (!multiLine) {
        if (stopIfTooLong) return { fits: false, lines };
      } else if (wordStart === line.start) {
        if (stopIfTooLong) return { fits: false, lines };
        breakNow = true; acceptWord = true; hideBreaker = false; wordTooLong = true; line.break = 'wrap';
      } else { breakNow = true; line.break = 'wrap'; }
    }
    if (acceptWord) {
      accept(); wordStart = i + 1;
      if (wordTooLong && line.positions.length > 2) {
        line.positions.pop(); wordStart = i;
        wordWidth = c.width; wordHeight = c.height; wordPositions.push(wordWidth);
        if (!c.soft) wordEndOrSoft = i + 1;
      }
    }
    if (breakNow) {
      if (hideBreaker && line.positions.length > 1) line.positions.pop();
      push();
      const multiplier = line.break === 'hard' ? lineHeightHard : line.break === 'line' ? lineHeightLine : lineHeightSoft;
      const next=chars[wordStart]??emptyClause;
      if(['soft','hard','line'].includes(line.break)){
        line.top+=next.marginTop||0;
        line.marginRight=next.marginRight||0;
      }
      if(['hard','line'].includes(line.break))line.marginLeftAfterBullet=line.marginLeftBeforeBullet=next.marginLeft||0;
      line = { ...line, start: wordStart, top: line.top + line.height * multiplier, positions: [paddingLeft], height: line.break === 'line' ? 0 : line.height, break: 'no',alignment:chars[wordStart]?.alignment };
      line.bullet=false;
      for(let j=wordStart;j<chars.length;j++)if(!chars[j].soft){line.bullet=Boolean(chars[j].bullet);break;}
      lineWidth = paddingLeft; lineHeight = 0; fitLine();
    }
  }
  accept(); push();
  let fitBottom = lines.at(-1).top + lines.at(-1).height;
  if (paragraphHeight > 0) {
    let maxHeight = 0, start = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].break === 'hard' || lines[i].break === 'line' || i + 1 === lines.length) {
        maxHeight = Math.max(maxHeight, lines[i].top + lines[i].height - lines[start].top);
        start = i + 1;
      }
    }
    const count = Math.floor(0.5 + (height - paddingBottom) / paragraphHeight);
    fitBottom = maxHeight * count;
  }
  return { fits: fitBottom <= height - paddingBottom, lines, width: Math.max(0, ...lines.map(l => l.width)), height: fitBottom - paddingTop, fitBottom };
}
