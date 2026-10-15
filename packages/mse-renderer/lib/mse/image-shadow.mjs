import { MseError } from './document.mjs';

// DropShadowImage uses separable integer Gaussian weights, clips the shadow to
// the existing image, and preserves native uint32 arithmetic (including wrap).
export function dropShadowRaster(source, { offsetX, offsetY, alpha, blur, color }) {
  const out = { ...source, data: source.data.slice() };
  if (!source.hasAlpha) return out;
  if (![offsetX,offsetY,alpha,blur].every(Number.isFinite)) throw new MseError('image-shadow', 'Shadow parameters must be finite');
  if (blur <= 0) throw new MseError('image-shadow', 'Drop shadow blur radius must be positive');
  const w=source.width,h=source.height;
  const horizontal=new Uint32Array(w*h), shadow=new Uint32Array(w*h);
  const kernel = length => {
    const sigma=blur*length, mult=256/(Math.sqrt(2*Math.PI)*sigma), inverse=1/(2*sigma*sigma);
    const range=Math.min(length,Math.trunc(3*sigma)), weights=[];
    let total=0;
    for(let d=-range;d<=range;d++) {
      const factor=Math.trunc(mult*Math.exp(-d*d*inverse));
      if (!Number.isSafeInteger(factor) || factor>0x7fffffff) throw new MseError('image-shadow', 'Shadow kernel exceeds native integer range');
      weights.push([d,factor]); total=(total+factor)>>>0;
    }
    return {weights,total};
  };
  const kx=kernel(w),ky=kernel(h);
  for(const [d,factor] of kx.weights) if(factor) {
    for(let y=0;y<h;y++) for(let x=Math.max(0,-d);x<Math.min(w,w-d);x++) {
      horizontal[x+y*w]+=source.data[(x+d+y*w)*4+3]*factor;
    }
  }
  for(const [d,factor] of ky.weights) if(factor) {
    for(let y=Math.max(0,-d);y<Math.min(h,h-d);y++) for(let x=0;x<w;x++) {
      shadow[x+y*w]+=Math.imul(horizontal[x+(d+y)*w],factor)>>>0;
    }
  }
  const total=Math.imul(255,Math.imul(kx.total,ky.total))>>>0;
  if (!total) throw new MseError('image-shadow', 'Shadow kernel has zero normalization');
  const dx=Math.trunc(w*offsetX),dy=Math.trunc(h*offsetY),delta=dx+w*dy,sa=Math.trunc(alpha*65536);
  if (![dx,dy,sa].every(v=>v>=-2147483648 && v<=2147483647)) throw new MseError('image-shadow','Shadow parameters exceed native integer range');
  for(let y=Math.max(0,dy);y<Math.min(h,h+dy);y++) for(let x=Math.max(0,dx);x<Math.min(w,w+dx);x++) {
    const p=x+y*w,a=source.data[p*4+3];
    const amount=Math.trunc((Math.imul(Math.imul(255-a,sa)>>16,shadow[p-delta])>>>0)/total);
    const divisor=Math.max(1,a+amount);
    for(let c=0;c<3;c++) out.data[p*4+c]=Math.trunc((a*source.data[p*4+c]+amount*color[c])/divisor)&255;
    out.data[p*4+3]=(a+amount)&255;
  }
  return out;
}
