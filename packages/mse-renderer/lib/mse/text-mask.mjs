// AlphaMask uses the red channel, with a different threshold for row bounds
// (128) than hit testing (20). Right bounds intentionally use the last pixel's
// coordinate, not the coordinate after it, matching native MSE.
export function createTextMask(raster, width, height) {
  const lefts = new Int32Array(raster.height).fill(raster.width);
  const rights = new Int32Array(raster.height);
  for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
    if (raster.data[(y * raster.width + x) * 4] >= 128) {
      lefts[y] = Math.min(lefts[y], x); rights[y] = x;
    }
  }
  return y => {
    if (y < 0 || y >= height) return { left: 0, right: width };
    const row = Math.trunc(y * raster.height / height);
    return { left: lefts[row] * width / raster.width, right: rights[row] * width / raster.width };
  };
}
