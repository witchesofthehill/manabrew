import {parseAlignment,alignmentOffset} from './alignment.mjs';
import {color} from './color-values.mjs';
import {cssColor} from './symbol-painter.mjs';
import {prepareFontDrawing} from './font-painter.mjs';

export function infoCaption(record){
  if(record.text('caption'))return record.text('caption');
  // Native name_to_caption preserves leading separators, then replaces
  // internal underscores with spaces and capitalizes the first letter.
  return record.text('name').replace(/^([_ ]*)(.)(.*)$/s,(_,prefix,first,rest)=>prefix+first.toUpperCase()+rest.replaceAll('_',' '));
}

export async function paintInfoField(ctx,value,font,fonts,{width,height,caption='',alignment='top left',paddingLeft=2,paddingRight=2,paddingTop=2,paddingBottom=2,background='white'}={}){
  // InfoValueViewer uses DrawText, so shadow/stroke settings do not apply.
  const plain={...font,shadow_displacement_x:0,shadow_displacement_y:0,shadow_blur:0,stroke_radius:0,stroke_blur:0};
  const provider=await prepareFontDrawing(plain,fonts),label=value||caption;
  const extent=provider.measure(label,plain,1);
  const pos=alignmentOffset(parseAlignment(alignment),width-paddingLeft-paddingRight,height-paddingTop-paddingBottom,extent.width,extent.height);
  ctx.save();
  try{
    ctx.fillStyle=cssColor(color(background));ctx.fillRect(-2,-2,width+4,height+4);
    ctx.fillStyle=cssColor(font.color);provider.draw(ctx,label,paddingLeft+pos.x,paddingTop+pos.y,1);
  }finally{ctx.restore();}
}
