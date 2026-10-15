import { resizeRaster } from './image-sampling.mjs';
import { MseError } from './document.mjs';

// Native conform_image sizing at unit zoom; used after the complete image
// graph has generated, rather than resizing each intermediate filter result.
export function conformRaster(image, { width = 0, height = 0, stretch = false } = {}, maxPixels = 16777216) {
  width = Math.trunc(width); height = Math.trunc(height);
  if (![width,height].every(v=>Number.isSafeInteger(v)&&v>=0)) throw new MseError('image-size','Image bounds must be finite and nonnegative');
  if ((!width && !height) || (width===image.width && height===image.height)) return image;
  if (!height) height=Math.trunc(width*image.height/image.width);
  else if (!width) width=Math.trunc(height*image.width/image.height);
  else if (!stretch) {
    if (image.width*height>image.height*width) height=Math.trunc(width*image.height/image.width);
    else width=Math.trunc(height*image.width/image.height);
  }
  return resizeRaster(image,width,height,maxPixels);
}
