import { color } from './color-values.mjs';
import { number } from './script-values.mjs';
import { MseError } from './document.mjs';

export function readSymbolVariation(record) {
  const type=record.text('fill type');
  if(!['solid','linear gradient','radial gradient'].includes(type))throw new MseError('symbol-fill',`Unknown symbol fill type ${type}`,record.location);
  const result={name:record.text('name'),borderRadius:number(record.text('border radius','0.05')),type};
  const colors=type==='solid'?['fill_color','border_color']:['fill_color_1','fill_color_2','border_color_1','border_color_2'];
  for(const key of colors)result[key]=color(record.text(key,'transparent')).channels;
  if(type==='linear gradient')for(const [key,fallback] of [['center_x','0.5'],['center_y','0.5'],['end_x','1'],['end_y','1']])result[key]=number(record.text(key,fallback));
  return result;
}

export function symbolVariationColor(variation,x,y,region) {
  if(region==='outside')return [0,0,0,0];
  const key=region==='inside'?'fill_color':'border_color';
  if(variation.type==='solid')return [...variation[key]];
  let t;
  if(variation.type==='radial gradient')t=Math.sqrt(((x-0.5)**2+(y-0.5)**2)*2);
  else {
    const dx=variation.end_x-variation.center_x,dy=variation.end_y-variation.center_y;
    t=Math.min(1,Math.max(0,Math.abs((x-variation.center_x)*dx+(y-variation.center_y)*dy)/(dx*dx+dy*dy||1)));
  }
  return variation[key+'_1'].map((a,i)=>Math.trunc(a+(variation[key+'_2'][i]-a)*t)&255);
}

export function filterSymbolRaster(source,variation) {
  const out={...source,data:source.data.slice(),hasAlpha:true};
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const i=(y*source.width+x)*4,d=source.data;
    if(d[i]!==d[i+2])continue; // Native yellow/blue editing hints.
    const region=d[i+1]?(d[i]?'border':'outside'):'inside';
    out.data.set(symbolVariationColor(variation,x/source.width,y/source.height,region),i);
  }
  return out;
}
