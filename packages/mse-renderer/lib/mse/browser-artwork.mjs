import {MseError} from './document.mjs';

// Artwork is shared across card surfaces, but belongs to one renderer session.
// Keep decoded pixels within a byte budget and coalesce concurrent requests.
export function createBrowserArtworkLoader({fetcher=globalThis.fetch,signal,
  createBitmap=blob=>createImageBitmap(blob),createCanvas=(w,h)=>new OffscreenCanvas(w,h),
  maxPixels=16777216,maxCacheBytes=67108864}={}){
  const controller=new AbortController(),pending=new Map(),cache=new Map();
  let bytes=0,disposed=false;
  const check=()=>{if(disposed||signal?.aborted)throw new MseError('render-aborted','Artwork loading was cancelled');};
  const dispose=()=>{disposed=true;controller.abort();cache.clear();pending.clear();bytes=0;signal?.removeEventListener('abort',dispose);};
  signal?.addEventListener('abort',dispose,{once:true});
  async function decode(url){
    const response=await fetcher(url,{signal:controller.signal});check();
    if(!response.ok)throw new MseError('artwork-fetch',`Card artwork returned HTTP ${response.status}`);
    const blob=await response.blob();check();
    const bitmap=await createBitmap(blob);
    try{
      check();
      if(!Number.isSafeInteger(bitmap.width)||!Number.isSafeInteger(bitmap.height)||bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>maxPixels)throw new MseError('image-size','Card artwork exceeds pixel budget');
      const canvas=createCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
      ctx.drawImage(bitmap,0,0);
      const result={width:bitmap.width,height:bitmap.height,data:ctx.getImageData(0,0,bitmap.width,bitmap.height).data,hasAlpha:true};
      const size=result.data.byteLength;
      if(size<=maxCacheBytes){
        while(bytes+size>maxCacheBytes&&cache.size){const oldest=cache.keys().next().value;bytes-=cache.get(oldest).data.byteLength;cache.delete(oldest);}
        cache.set(url,result);bytes+=size;
      }
      return result;
    }finally{bitmap.close();}
  }
  async function load(url){
    check();
    if(cache.has(url)){const result=cache.get(url);cache.delete(url);cache.set(url,result);return result;}
    if(!pending.has(url)){
      const request=decode(url).finally(()=>{if(pending.get(url)===request)pending.delete(url);});
      pending.set(url,request);
    }
    return pending.get(url);
  }
  return {load,dispose};
}
