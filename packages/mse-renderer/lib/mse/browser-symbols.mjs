import { symbolDrawOrder } from './symbol-draw-order.mjs';
import { combineSymbolMasks } from './symbol-mask.mjs';
import { MseError } from './document.mjs';
import { parseVectorSymbol } from './vector-symbol.mjs';
import { prepareVectorSymbol, symbolBounds, symbolAspectRatio, symbolShapePolygon } from './symbol-geometry.mjs';
import { filterSymbolRaster } from './symbol-variation.mjs';
import { allocateRaster } from './image-sampling.mjs';

// A set symbol may also be an SVG URL (Scryfall's set icons). Its alpha is the
// symbol's inside, dilated by the variation's border radius for the border,
// then encoded in MSE's region colors so variations color it like a vector.
const svgSymbols=new Map();
function loadSvgSymbol(url,fetcher){
  if(!svgSymbols.has(url))svgSymbols.set(url,(async()=>{
    const response=await fetcher(url);
    if(!response.ok)throw new MseError('symbol-fetch',`Set symbol returned HTTP ${response.status}`);
    const source=await response.text();
    const box=/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(source);
    const aspect=box?Number(box[1])/Number(box[2]):1;
    return {source,aspect:Number.isFinite(aspect)&&aspect>0?aspect:1};
  })().catch(error=>{svgSymbols.delete(url);throw error;}));
  return svgSymbols.get(url);
}
async function rasterizeSvg(source,width,height){
  // Size the SVG explicitly so it rasterizes crisply at the requested size.
  const sized=source.replace(/<svg\b([^>]*)>/i,(tag,attributes)=>`<svg${attributes.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi,'')} width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">`);
  const url=URL.createObjectURL(new Blob([sized],{type:'image/svg+xml'}));
  try{
    const image=new Image();image.src=url;await image.decode();
    return image;
  }finally{URL.revokeObjectURL(url);}
}
async function renderSvgSymbol(request,{width,height,maxPixels,createCanvas,fetcher}){
  const {source,aspect}=await loadSvgSymbol(request.filename,fetcher);
  const size=Math.max(100,3*Math.max(width,height)),smaller=width>1&&height>1;
  let w=smaller?Math.trunc(size*width/Math.max(width,height)):size;
  let h=smaller?Math.trunc(size*height/Math.max(width,height)):size;
  if(w/h>aspect)w=Math.max(1,Math.trunc(h*aspect));else h=Math.max(1,Math.trunc(w/aspect));
  const border=Math.trunc(request.variation.borderRadius*Math.min(w,h));
  // Inset the icon so its border stays inside the bitmap.
  const iw=Math.max(1,w-2*border),ih=Math.max(1,h-2*border);
  const image=await rasterizeSvg(source,iw,ih);
  const canvas=createCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,border,border,iw,ih);
  const inside=ctx.getImageData(0,0,w,h).data;
  if(border>0){
    // Dilate by stamping the icon around circles up to the border radius.
    for(let radius=1;radius<=border;radius++){
      const steps=Math.max(8,Math.ceil(2*Math.PI*radius));
      for(let i=0;i<steps;i++){
        const angle=2*Math.PI*i/steps;
        ctx.drawImage(image,border+radius*Math.cos(angle),border+radius*Math.sin(angle),iw,ih);
      }
    }
  }
  const outline=ctx.getImageData(0,0,w,h).data;
  const out=allocateRaster(w,h,true,maxPixels);
  for(let i=0;i<w*h;i++){
    const region=inside[i*4+3]>=128?[0,0,0,255]:outline[i*4+3]>=128?[255,255,255,255]:[0,128,0,255];
    out.data.set(region,i*4);
  }
  return filterSymbolRaster(out,request.variation);
}
export const isSvgSymbolUrl=value=>/^(?:https?:\/\/|\/)[^\s]+\.svg(?:\?[^\s]*)?$/i.test(String(value||''));

// Shape rasterization uses browser polygon masks. Native pixel parity must be
// checked separately because wx and Canvas can disagree at polygon edges.
export function createBrowserSymbolRenderer({store,loadLocalSymbol,createCanvas=(w,h)=>new OffscreenCanvas(w,h),fetcher=(...args)=>globalThis.fetch(...args)}={}) {
  return async (request,{width=0,height=0,maxPixels=16777216}={})=>{
    if(request.local&&isSvgSymbolUrl(request.filename))return renderSvgSymbol(request,{width,height,maxPixels,createCanvas,fetcher});
    let symbol;
    if(!request.filename)return allocateRaster(Math.max(1,Math.ceil(width)),Math.max(1,Math.ceil(height)),true,maxPixels);
    if(request.local){
      if(!loadLocalSymbol)throw new MseError('symbol-local','A local set-symbol source provider is required');
      symbol=parseVectorSymbol(await loadLocalSymbol(request.filename),{file:request.filename});
    }else symbol=parseVectorSymbol(await store.readText(request.path),{file:request.path.key});
    symbol=prepareVectorSymbol(symbol);
    const size=Math.max(100,3*Math.max(width,height)),smaller=width>1&&height>1;
    let w=smaller?Math.trunc(size*width/Math.max(width,height)):size;
    let h=smaller?Math.trunc(size*height/Math.max(width,height)):size;
    const aspect=symbolAspectRatio(symbolBounds(symbol)),ratio=w/h;
    if(ratio>aspect&&(aspect>1||(smaller&&h<w)))w=Math.trunc(h*aspect);
    else if(ratio<aspect&&(aspect<1||(smaller&&w<h)))h=Math.trunc(w/aspect);
    const out=allocateRaster(w,h,true,maxPixels),zoom=Math.max(w,h),ox=-(zoom-w)/2,oy=-(zoom-h)/2;
    const borderWidth=Math.trunc(request.variation.borderRadius*Math.min(w,h));
    const shapes=symbolDrawOrder(symbol);
    const canvas=createCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const mask=(points,stroke,fill=true)=>{
      ctx.clearRect(0,0,w,h);ctx.beginPath();
      points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
      ctx.fillStyle='white';if(fill)ctx.fill('evenodd');
      if(stroke&&borderWidth>0){ctx.lineWidth=borderWidth;ctx.lineJoin='round';ctx.strokeStyle='white';ctx.stroke();}
      return ctx.getImageData(0,0,w,h).data;
    };
    const border=new Uint8Array(w*h),inside=new Uint8Array(w*h);
    for(let i=0;i<w*h;i++)out.data.set([0,128,0,255],i*4);
    const flush=()=>{for(let i=0;i<w*h;i++){if(border[i])out.data.set([255,255,255,255],i*4);if(inside[i])out.data.set([0,0,0,255],i*4);}border.fill(0);inside.fill(0);};
    const round=v=>Math.trunc(v+(v>0?0.4999995:-0.4999995));
    for(const {shape,transform,allowOverlap} of shapes){
      if(shape.combine==='overlap'&&allowOverlap)flush();
      const points=symbolShapePolygon(shape,{transform:p=>{const [x,y]=transform(p);return [round(ox+x*zoom),round(oy+y*zoom)];}});
      if(points.length<3)continue;
      const fill=mask(points,false),outline=borderWidth>0?mask(points,true):null;
      const stroke=shape.combine==='subtract'&&borderWidth>0?mask(points,true,false):null;
      combineSymbolMasks(border,inside,fill,outline,stroke,shape.combine);
    }
    flush();return filterSymbolRaster(out,request.variation);
  };
}
