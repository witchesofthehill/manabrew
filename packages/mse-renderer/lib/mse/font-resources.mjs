// FontRef::PreloadResourceFonts discovers top-level directories containing
// "fonts" in their name and recursively loads TTF/OTF files inside them.
// Package-local copies can be different revisions of an installed face; loading
// them as well would silently change which font the browser selects.
export function mseResourceFontPaths(paths) {
  return [...paths].filter(path=>path.includes('/')
    && path.slice(0,path.indexOf('/')).toLowerCase().includes('fonts')
    && /\.(ttf|otf)$/i.test(path));
}
