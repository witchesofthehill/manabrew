import {MseError} from './document.mjs';
import {loadMseTemplate,MseTemplateContext} from './template.mjs';
import {paintMseCard} from './card-painter.mjs';
import {engineCardToMse,engineDoubleFacesToMse} from './engine-card.mjs';
import {MseCardRegistry} from './card-links.mjs';
import {selectMseStyle} from './style-selection.mjs';
import {MseImageRenderer} from './image-renderer.mjs';
import {createMseImageLoader} from './browser-images.mjs';
import {createBrowserSymbolRenderer} from './browser-symbols.mjs';

// Resource providers are owned by the caller so multiple card surfaces can
// share registered fonts and decoded assets without disposing one another.
export class MseCardRenderer{
  constructor({store,fonts,imageRenderer,createCanvas=(w,h)=>new OffscreenCanvas(w,h),loadCardImage,fieldUpdateMode='lazy'}={}){
    this.fieldUpdateMode=fieldUpdateMode;
    this.store=store;this.fonts=fonts;this.createCanvas=createCanvas;this.loadCardImage=loadCardImage;
    this.images=imageRenderer??new MseImageRenderer({loadAsset:createMseImageLoader(store),loadArtwork:loadCardImage,renderSymbol:createBrowserSymbolRenderer({store})});
    this.templates=new Map();this.targets=new WeakMap();this.disposed=false;
    // Finished renders by request, so a card prepared in the background, or
    // inspected again, draws without rendering. Results are never mutated.
    this.results=new Map();this.resultLimit=24;
  }
  check(signal){
    if(this.disposed)throw new MseError('renderer-disposed','Card renderer has been disposed');
    if(signal?.aborted)throw new MseError('render-aborted','Card rendering was cancelled');
  }
  async template(style){
    this.check();
    if(!this.templates.has(style)){
      const pending=loadMseTemplate(this.store,style).catch(error=>{if(this.templates.get(style)===pending)this.templates.delete(style);throw error;});
      this.templates.set(style,pending);
    }
    const template=await this.templates.get(style);this.check();return template;
  }
  async prepareContext({style,context={},snapshot,adapter={}},{signal}={}){
    this.check(signal);
    const template=await this.template(style);this.check(signal);
    const regions=template.style.all('card region').map(region=>region.record().text('name'));
    const combinedFaces=regions.includes('front')&&regions.includes('back');
    const doubleFaces=combinedFaces||adapter.linkedFaces===false?null:engineDoubleFacesToMse(snapshot,adapter);
    if(doubleFaces){
      const registry=new MseCardRegistry();
      const templates=await Promise.all(doubleFaces.cards.map((_,index)=>index===doubleFaces.selected?template:this.template(selectMseStyle(snapshot,{faceIndex:index}))));
      this.check(signal);
      const contexts=doubleFaces.cards.map((values,index)=>new MseTemplateContext(templates[index],{
        fieldUpdateMode:this.fieldUpdateMode,...values,cardRegistry:registry,spellcheckEnabled:false,
      }));
      // Register both faces before scripts run: get_front_face/get_back_face
      // must work while defaults and automatic frame choices are evaluated.
      for(const card of contexts)card.initializeScripts();
      for(const card of contexts)card.initialize();
      return contexts[doubleFaces.selected];
    }
    const values=snapshot===undefined?context:engineCardToMse(snapshot,combinedFaces?{...adapter,faceIndex:null}:adapter);
    const card=new MseTemplateContext(template,{fieldUpdateMode:this.fieldUpdateMode,...values,spellcheckEnabled:false}).initialize();
    return card;
  }
  async render(request,options={}){
    const key=options.cache===false?null:JSON.stringify(request);
    const cached=key&&this.results.get(key);
    if(cached){
      this.check(options.signal);
      this.results.delete(key);this.results.set(key,cached);
      return cached;
    }
    const context=await this.prepareContext(request,options);
    const result=await this.renderContext(context,options);
    if(key){
      this.results.set(key,result);
      if(this.results.size>this.resultLimit)this.results.delete(this.results.keys().next().value);
    }
    return result;
  }
  has(request){return this.results.has(JSON.stringify(request));}
  async renderContext(context,{signal,onFieldDrawn}={}){
    this.check(signal);
    const width=Number(context.template.style.text('card width')),height=Number(context.template.style.text('card height'));
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>(this.images.maxPixels??16777216))throw new MseError('card-size','Invalid card canvas dimensions');
    const canvas=this.createCanvas(width,height);
    const result=await paintMseCard(canvas.getContext('2d'),context,this.fonts,this.images,{
      createCanvas:this.createCanvas,loadCardImage:this.loadCardImage,
      onFieldDrawn:async info=>{this.check(signal);if(onFieldDrawn)await onFieldDrawn(info);},
    });
    this.check(signal);
    return {...result,canvas,context,diagnostics:[...context.diagnostics]};
  }
  async renderTo(target,request,options={}){
    this.check(options.signal);
    const token={};this.targets.set(target,token);
    const result=await this.render(request,options);
    this.check(options.signal);
    if(this.targets.get(target)!==token)throw new MseError('render-superseded','A newer card render replaced this request');
    // Allocate and draw privately before touching the visible canvas. Failed,
    // cancelled, or superseded work leaves the current card intact.
    target.width=result.width;target.height=result.height;
    target.getContext('2d').drawImage(result.canvas,0,0);
    return result;
  }
  dispose(){this.disposed=true;this.templates.clear();this.results.clear();this.targets=new WeakMap();}
}
