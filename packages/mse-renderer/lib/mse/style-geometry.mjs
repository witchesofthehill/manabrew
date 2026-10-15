// Style::update derives one coordinate per axis. Declared scripts count as
// set even when they currently evaluate to zero; literal zero sizes do not.
export const geometryNames = new Set(['left', 'right', 'width', 'top', 'bottom', 'height', 'angle']);
export const geometryDefaults = { left: 1000000, right: 1000000, top: 1000000, bottom: 1000000, width: 0, height: 0, angle: 0 };
export function geometryModes(record) {
  const isSet = name => {
    const entry = record.last(name);
    if (!entry) return false;
    const source = entry.text();
    if (source.startsWith('script:')) return true;
    if (/(^|[^\\])\{/.test(source)) return true;
    return name === 'width' || name === 'height' ? Math.abs(Number(source)) > 0.001 : Number(source) < 100000;
  };
  const axis = (start, end, size) => !isSet(end) ? end : !isSet(size) ? size : !isSet(start) ? start : 'center';
  return { horizontal: axis('left', 'right', 'width'), vertical: axis('top', 'bottom', 'height') };
}
export function geometryValue(name, read, modes) {
  const axis = (name, start, end, size, mode) => {
    if (mode === 'center') {
      if (name === size) return read(size);
      const sum = Math.trunc(read(start) + read(end));
      return (sum + (name === start ? -read(size) : read(size))) / 2;
    }
    if (name !== mode) return read(name);
    if (name === start) return read(end) - read(size);
    if (name === end) return read(start) + read(size);
    return read(end) - read(start);
  };
  const base = key => ['left', 'right', 'width'].includes(key)
    ? axis(key, 'left', 'right', 'width', modes.horizontal)
    : axis(key, 'top', 'bottom', 'height', modes.vertical);
  if (name === 'angle') return read(name);
  if (name === 'width' || name === 'height') return Math.abs(base(name));
  let value = base(name);
  if ((name === 'left' || name === 'top') && (modes.horizontal === 'left' || modes.vertical === 'top')) {
    const angle = read('angle');
    if (Math.abs(angle) >= 1e-8) {
      const sin = Math.sin(angle * Math.PI / 180), cos = Math.cos(angle * Math.PI / 180);
      if (modes.horizontal === 'left') value += base('width') * (name === 'left' ? 1 - cos : sin);
      if (modes.vertical === 'top') value += base('height') * (name === 'left' ? -sin : 1 - cos);
    }
  }
  return value;
}
