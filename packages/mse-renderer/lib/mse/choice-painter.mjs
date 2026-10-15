import {prepareFontDrawing} from './font-painter.mjs';
import {parseAlignment,alignmentOffset} from './alignment.mjs';
import {cssColor} from './symbol-painter.mjs';

// Choice labels are plain, unwrapped strings. Native translation defaults to
// capitalizing the first character; image+text always uses middle-left alignment.
export async function paintChoiceLabel(ctx,value,font,fonts,{width,height,alignment='stretch',withImage=false,imageWidth=null,translate}={}) {
  if (!value) return;
  const label=translate?translate(value):value.charAt(0).toUpperCase()+value.slice(1);
  const provider=await prepareFontDrawing(font,fonts),extent=provider.measure(label,font,1);
  const position=alignmentOffset(parseAlignment(withImage?'middle left':alignment),width,height,extent.width,extent.height);
  const margin=withImage&&imageWidth!==null?imageWidth+2:0;
  ctx.save();
  try{ctx.fillStyle=cssColor(font.color);provider.draw(ctx,label,position.x+margin,position.y,1);}
  finally{ctx.restore();}
}
