import {isChoiceFieldType,choiceRenderFlags} from './choice-fields.mjs';
import { paintChoiceLabel } from './choice-painter.mjs';
import {paintInfoField,infoCaption} from './info-painter.mjs';
import { MseError } from './document.mjs';
import { text, force } from './script-values.mjs';
import { paintTextLayout } from './text-painter.mjs';
import { parseAlignment, alignmentOffset } from './alignment.mjs';
import { cssColor } from './symbol-painter.mjs';
import { color } from './color-values.mjs';
import { mseImage } from './image-builtins.mjs';
import { resizeRaster, allocateRaster } from './image-sampling.mjs';
import { resizeArtwork } from './artwork-sampling.mjs';
import { combineChannel } from './image-combine.mjs';
import { drawCombinedLayer } from './field-blend.mjs';

// magic-modules corners fields: "corners", then "corners 2"/"corners 3" per face.
const CORNER_FIELD=/^corners(?:[ _]\d+)?$/;

// Draw into a private surface so a failed field never commits a partial card.
// Unsupported drawing paths remain explicit until their native behavior exists.
export async function paintMseCard(target,context,fonts,renderer,{createCanvas=(w,h)=>new OffscreenCanvas(w,h),loadCardImage,onFieldDrawn}={}) {
  const preparation=await context.prepareTextLayouts(fonts,renderer);
  const revision=context.layoutRevision;
  const width=Number(context.template.style.text('card width')),height=Number(context.template.style.text('card height'));
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>(renderer.maxPixels||16777216))throw new MseError('card-size','Invalid card canvas dimensions');
  const surface=createCanvas(width,height),base=surface.getContext('2d');
  // MSE paints an unset card background white, which shows as a white rim
  // around the frame's rounded corners. Outside the frame stays transparent
  // unless a template asks for a background itself.
  const background=context.template.style.text('card background','');
  if(background){base.fillStyle=cssColor(color(background));base.fillRect(0,0,width,height);}
  const fields=[];
  for(const [group,layouts] of [['card',context.template.layouts],['extra_card',context.template.extraLayouts]])for(const name of new Set([...(context.template.definitions?.[group]?.keys()||[]),...layouts.keys()])){
    const layout=layouts.get(name);if(!layout)continue;
    if(context.fieldVisible(name,group))fields.push({group,name,layout,z:layout.programs.has('z_index')?context.property(name,'z_index',group):0});
  }
  fields.sort((a,b)=>a.z-b.z);
  // Start the mask and default-image downloads of every field before drawing.
  if(renderer?.prefetch)for(const {group,name,layout} of fields)for(const key of ['mask','default']){
    if(!layout.programs.has(key))continue;
    try{const value=context.property(name,key,group);if(value!==null&&value!=='')renderer.prefetch(mseImage(value,context.template.name));}catch{/* drawn below */}
  }
  for(const {group,name,layout} of fields){
    try{
      const get=(key,fallback)=>layout.programs.has(key)?context.property(name,key,group):fallback;
      const type=context.cells[group].get(name)?.definition?.record.text('type');
      const left=context.property(name,'left',group),top=context.property(name,'top',group);
      const w=context.property(name,'width',group),h=context.property(name,'height',group);
      const angle=Number(context.property(name,'angle',group));
      if(!Number.isFinite(angle))throw new MseError('card-rotation','Field angle must be finite');
      // Native text/art viewers do not have a combine property. A color
      // field's combine mode applies only to its mask-generated bitmap.
      const supportsCombine=isChoiceFieldType(type)||(type==='color'&&get('mask',null));
      let combine=supportsCombine?text(get('combine','normal')):'normal';
      if(isChoiceFieldType(type)){
        const imageMode=context.textMeasurements.get(`${group}.${name}`)?.result?.combine;
        if(imageMode&&imageMode!=='default')combine=imageMode;
      }
      if(combine===''||combine==='default')combine='normal';
      combineChannel(combine);
      const layer=combine==='normal'?null:createCanvas(width,height);
      const ctx=layer?layer.getContext('2d'):base;
      let label=null;
      ctx.save();
      try{
        ctx.translate(left,top);
        // MSE's Rotation::tr uses (cos*x + sin*y, -sin*x + cos*y).
        // Canvas angles have the opposite sign in the same downward Y axis.
        if(angle%360)ctx.rotate(-(angle%360)*Math.PI/180);
        if(type==='text'){
          const result=context.textMeasurements.get(`${group}.${name}`)?.result;
          if(result)await paintTextLayout(ctx,result,fonts,{height:h});
        }else if(type==='info'){
          await paintInfoField(ctx,text(context.field(group,name)),context.font(name,group),fonts,{
            width:w,height:h,caption:infoCaption(context.cells[group].get(name).definition.record),
            alignment:text(get('alignment','top left')),background:get('background_color','white'),
            ...Object.fromEntries(['Left','Right','Top','Bottom'].map(side=>['padding'+side,Number(get('padding_'+side.toLowerCase(),2))])),
          });
        }else{
          let image,cutAway=false;
          if(isChoiceFieldType(type)){
            const style=choiceRenderFlags(text(get('render_style','text')));
            const value=text(context.field(group,name));
            // The magic-modules corners paint white "paper" outside the rounded
            // corners (only "none" uses the border color). Off paper, that
            // white shows as nicks on every corner, so cut them away instead.
            cutAway=CORNER_FIELD.test(name)&&group==='card'&&value!=='none'&&value!=='invisible';
            if(value&&!style.hidden){
              image=style.image?context.textMeasurements.get(`${group}.${name}`)?.result?.image:null;
              if(style.text)label={value,font:context.font(name,group),options:{width:w,height:h,alignment:text(get('alignment','stretch')),withImage:style.image,imageWidth:image?.width??null}};
            }
            const maskValue=get('mask',null);
            if(image && maskValue!==null && maskValue!==''){
              const mask=resizeRaster(await renderer.render(mseImage(maskValue,context.template.name),{width:image.width,height:image.height}),image.width,image.height,renderer.maxPixels);
              image={...image,data:image.data.slice(),hasAlpha:true};
              for(let i=3;i<image.data.length;i+=4)image.data[i]=Math.trunc(image.data[i]*mask.data[i-3]/255);
            }
          }else if(type==='color'){
            const value=color(context.field(group,name)),maskValue=get('mask',null);
            if(maskValue!==null && maskValue!==''){
              const iw=Math.max(1,Math.trunc(w)),ih=Math.max(1,Math.trunc(h));
              const mask=resizeRaster(await renderer.render(mseImage(maskValue,context.template.name),{width:iw,height:ih}),iw,ih,renderer.maxPixels);
              image=allocateRaster(iw,ih,true,renderer.maxPixels);
              for(let i=0;i<image.data.length;i+=4){
                image.data.set(value.channels,i);
                // Native colorImage fills RGB without an alpha plane, then
                // installs the mask alpha (the color's alpha is ignored).
                image.data[i+3]=mask.data[i];
              }
            }else{
              const l=Number(get('left_width',100000)),r=Number(get('right_width',100000));
              const t=Number(get('top_width',100000)),b=Number(get('bottom_width',100000));
              if(l<w && r<w && t<h && b<h){
                ctx.beginPath();ctx.rect(0,0,w,h);
                if(w-l-r>0 && h-t-b>0)ctx.rect(l,t,w-l-r,h-t-b);
                ctx.clip('evenodd');
              }
              const radius=Number(get('radius',0));
              ctx.fillStyle=cssColor(value);ctx.beginPath();
              ctx.roundRect(0,0,w,h,radius<0?-radius*Math.min(w,h):radius);ctx.fill();
            }
          }else if(type==='image'){
            const value=force(context.field(group,name));
            const iw=Math.max(1,Math.trunc(w)),ih=Math.max(1,Math.trunc(h));
            if(value!==null&&value!==''){
              if(!loadCardImage)throw new MseError('card-art','A card artwork provider is required');
              image=await loadCardImage(value,{width:iw,height:ih,field:name,group});
              if(image)image=resizeArtwork(image,iw,ih,renderer.maxPixels);
            }
            const defaultValue=get('default',null);
            if(!image&&defaultValue!==null&&defaultValue!==''){
              const graph=mseImage(defaultValue,context.template.name);
              if(graph.operation!=='blank')image=resizeRaster(await renderer.render(graph,{width:iw,height:ih}),iw,ih,renderer.maxPixels);
            }
            // ImageValueViewer uses this placeholder even for non-editing
            // exports. Its 10-pixel checks are local to the image field and
            // pass through the same mask/rotation as actual artwork.
            if(!image&&w>40){
              image=allocateRaster(iw,ih,false,renderer.maxPixels);
              for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){
                const shade=(Math.floor(x/10)+Math.floor(y/10))%2?255:235;
                image.data.set([shade,shade,shade,255],(y*iw+x)*4);
              }
            }
            const maskValue=get('mask',null);
            if(image&&maskValue!==null&&maskValue!==''){
              const mask=resizeRaster(await renderer.render(mseImage(maskValue,context.template.name),{width:iw,height:ih}),iw,ih,renderer.maxPixels);
              image={...image,data:image.data.slice(),hasAlpha:true};
              for(let i=3;i<image.data.length;i+=4)image.data[i]=Math.trunc(image.data[i]*mask.data[i-3]/255);
            }
          }else throw new MseError('card-field',`Drawing is not implemented for field type ${type}`);
          if(image){
            const bitmap=createCanvas(image.width,image.height),dc=bitmap.getContext('2d'),pixels=dc.createImageData(image.width,image.height);
            pixels.data.set(image.data);dc.putImageData(pixels,0,0);
            const offset=alignmentOffset(parseAlignment(text(get('alignment',type==='color'?'left top':'stretch'))),w,h,image.width,image.height);
            if(cutAway)ctx.globalCompositeOperation='destination-out';
            ctx.drawImage(bitmap,offset.x,offset.y);
          }
        }
      }finally{ctx.restore();}
      if(layer)drawCombinedLayer(base,layer,combine,createCanvas);
      // Native combine modes affect the choice image, not its label.
      if(label){
        base.save();
        try{base.translate(left,top);if(angle%360)base.rotate(-(angle%360)*Math.PI/180);
          await paintChoiceLabel(base,label.value,label.font,fonts,label.options);
        }finally{base.restore();}
      }
      if(onFieldDrawn)await onFieldDrawn({group,name,surface});
    }catch(error){error.field=`${group}.${name}`;throw error;}
  }
  if(revision!==context.layoutRevision)throw new MseError('layout-stale','Card changed while it was being drawn');
  target.drawImage(surface,0,0);
  return {width,height,fields:fields.length,preparation:preparation?{passes:preparation.passes,fields:preparation.fields,reprepared:preparation.reprepared}:null,nativeParityVerified:false};
}
