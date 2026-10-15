// Native alignment parsing uses substring checks in this fixed precedence,
// rather than token order. These bit values match util/alignment.hpp.
export const alignmentFlags = Object.freeze({ left: 1, center: 2, right: 4, stretch: 16, justify_words: 32, justify_all: 64, top: 256, middle: 512, bottom: 1024, if_overflow: 4096, if_softbreak: 8192 });
export function parseAlignment(source) {
  let flags = 257;
  for (const [word, value, mask] of [
    ['left', 1, 7], ['center', 2, 7], ['right', 4, 7],
    ['justify', 32, 112], ['justify-all', 64, 112], ['shrink', 16, 112], ['stretch', 16, 112],
    ['top', 256, 1792], ['middle', 512, 1792], ['bottom', 1024, 1792],
  ]) if (source.includes(word)) flags = value | (flags & ~mask);
  if (source.includes('overflow')) flags |= 4096;
  if (!source.includes('force')) flags |= 8192;
  return flags;
}
export function alignmentOffset(flags, boxWidth, boxHeight, width, height) {
  return {
    x: flags & 2 ? (boxWidth - width) / 2 : flags & 4 ? boxWidth - width : 0,
    y: flags & 512 ? (boxHeight - height) / 2 : flags & 1024 ? boxHeight - height : 0,
  };
}
