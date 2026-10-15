import {MseError} from './document.mjs';
import {resizeRaster} from './image-sampling.mjs';
import {strokeRaster} from './image-stroke.mjs';
import {composePixel} from './image-insert.mjs';

const active=value=>Math.abs(value||0)>=1e-8;
const round=value=>Math.sign(value)*Math.floor(Math.abs(value)+0.5);
const canvas=(w,h)=>{
  const c=globalThis.OffscreenCanvas?new OffscreenCanvas(w,h):globalThis.document?.createElement('canvas');
  if(!c)throw new MseError('text-drawing','A bitmap canvas provider is required');
  c.width=w;c.height=h;return c;
};
// The mask is opaque-white glyph coverage. Keep native stroke/blur arithmetic
// independent of the host's glyph rasterizer so it can be checked separately.
export function decorateTextRaster(mask,color,strokeColor,radius,blur,maxPixels=16777216){
  if(!color[3])return null;
  const fill={...mask,data:mask.data.slice(),hasAlpha:true};
  for(let i=0;i<fill.data.length;i+=4){fill.data.set(color.slice(0,3),i);fill.data[i+3]=Math.trunc(mask.data[i+3]*color[3]/255);}
  if(!radius)return blur?{raster:strokeRaster(mask,color,0,blur,maxPixels),margin:blur}:{raster:fill,margin:0};
  const raster=strokeRaster(mask,strokeColor,radius,blur,maxPixels),margin=radius+blur;
  if(color.some((v,i)=>v!==strokeColor[i]))for(let y=0;y<fill.height;y++)for(let x=0;x<fill.width;x++){
    const dx=x+margin,dy=y+margin;
    if(dx>=0&&dx<raster.width&&dy>=0&&dy<raster.height)composePixel(raster.data,(dy*raster.width+dx)*4,fill.data,(y*fill.width+x)*4,true);
  }
  return {raster,margin};
}
export async function prepareFontDrawing(font,fonts,{createCanvas=canvas,maxPixels=16777216,effectScaleMultiplier=1,...flags}={}){
  const provider=await fonts.prepare(font,flags);
  const hasStroke=(active(font.stroke_radius)||active(font.stroke_blur))&&font.stroke_color?.channels[3];
  const hasShadow=!hasStroke&&(active(font.shadow_displacement_x)||active(font.shadow_displacement_y)||active(font.shadow_blur))&&font.shadow_color?.channels[3];
  const resample=provider.rasterScale===4;
  if(!resample&&!hasShadow&&!active(font.stroke_radius)&&!active(font.stroke_blur))return provider;
  const bitmaps=new Map();
  const bitmap=raster=>{const c=createCanvas(raster.width,raster.height),ctx=c.getContext('2d'),pixels=ctx.createImageData(raster.width,raster.height);pixels.data.set(raster.data);ctx.putImageData(pixels,0,0);return c;};
  return {...provider,draw(target,text,x,y,scale){
    if(!text)return;
    const originX=resample?Math.trunc(x):x,originY=resample?Math.trunc(y):y;
    const subX=resample?Math.trunc(4*(x-originX)):0,subY=resample?Math.trunc(4*(y-originY)):0;
    const key=JSON.stringify([text,scale,subX,subY]);let layers=bitmaps.get(key);
    if(!layers){
      const extent=provider.measure(text,font,scale),width=Math.trunc(extent.width)+4,height=Math.trunc(extent.height)+2;
      if(width<1||height<1||width*height*16>maxPixels)throw new MseError('image-budget','Text effect mask exceeds pixel budget');
      const surface=createCanvas(width*4,height*4),ctx=surface.getContext('2d');ctx.fillStyle='white';
      if(resample&&provider.drawRaster)provider.drawRaster(ctx,text,subX,subY,scale);
      else provider.draw(ctx,text,subX,subY,scale*4);
      const data=ctx.getImageData(0,0,surface.width,surface.height).data;
      const mask=resizeRaster({width:surface.width,height:surface.height,data,hasAlpha:true},width,height,maxPixels);
      const effectScale=effectScaleMultiplier*(provider.pointSize?.(scale)??font.size*scale)/15;layers=[];
      const add=(color,radius,blur,dx=0,dy=0)=>{const result=decorateTextRaster(mask,color,radius?font.stroke_color.channels:color,radius,blur,maxPixels);if(result)layers.push({bitmap:bitmap(result.raster),x:dx-result.margin,y:dy-result.margin});};
      if(hasShadow)add(font.shadow_color.channels,0,round((font.shadow_blur||0)*effectScale),(font.shadow_displacement_x||0)*effectScale,(font.shadow_displacement_y||0)*effectScale);
      add(font.color.channels,round((font.stroke_radius||0)*effectScale),round((font.stroke_blur||0)*effectScale));
      bitmaps.set(key,layers);
    }
    for(const layer of layers)target.drawImage(layer.bitmap,originX+layer.x,originY+layer.y);
  }};
}
