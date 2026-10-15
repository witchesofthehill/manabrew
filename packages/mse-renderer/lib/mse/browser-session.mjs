import {MseError} from './document.mjs';
import {createFetchMseStore} from './packages.mjs';
import {MseBrowserFonts} from './browser-fonts.mjs';
import {MseImageRenderer} from './image-renderer.mjs';
import {createMseImageLoader} from './browser-images.mjs';
import {createBrowserSymbolRenderer} from './browser-symbols.mjs';
import {MseCardRenderer} from './card-renderer.mjs';
import upstream from './upstream.mjs';
import {createBrowserArtworkLoader} from './browser-artwork.mjs';
import {loadBrowserCorpusIndex,configureIndexedCorpus} from './browser-corpus-index.mjs';
import {mseResourceFontPaths} from './font-resources.mjs';

// A session owns shared resources for all card surfaces using one corpus.
// The corpus has the same data/, Magic - Fonts/, and upstream-tree.json layout
// produced by mse-sync. It may be served locally or from an asset host.
export async function createBrowserMseSession({corpusUrl,fetcher=globalThis.fetch,signal,
  expectedRevision=upstream.revision,allowSystemFonts=true,createFonts=()=>new MseBrowserFonts({allowSystemFonts}),
  createCanvas=(w,h)=>new OffscreenCanvas(w,h),loadCardImage,loadLocalSymbol,
  fieldUpdateMode='ordered',maxPixels=16777216}={}){
  const base=new URL(corpusUrl,globalThis.location?.href);
  if(!base.pathname.endsWith('/'))throw new MseError('invalid-base-url','MSE corpus URL must end in /');
  const controller=new AbortController();let fonts,renderer,artwork,disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;controller.abort();artwork?.dispose();renderer?.dispose();fonts?.dispose();signal?.removeEventListener('abort',dispose);};
  const check=()=>{if(disposed||signal?.aborted)throw new MseError('render-aborted','MSE session loading was cancelled');};
  signal?.addEventListener('abort',dispose,{once:true});
  const fetchResource=url=>{check();return fetcher(url,{signal:controller.signal});};
  try{
    check();
    const response=await fetchResource(new URL('upstream-tree.json',base).href);
    if(!response.ok)throw new MseError('corpus-fetch',`MSE corpus index returned HTTP ${response.status}`);
    const manifest=await response.json();check();
    if(manifest.truncated||manifest.sha!==expectedRevision||!Array.isArray(manifest.tree))throw new MseError('corpus-index','Expected a complete MSE corpus index at the configured revision');
    const paths=manifest.tree.filter(e=>e.type==='blob').map(e=>e.path);
    for(const path of paths)if(typeof path!=='string'||path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\0]/.test(path))throw new MseError('corpus-index','Invalid path in MSE corpus index');
    const files=paths.filter(p=>p.startsWith('data/')).map(p=>p.slice(5));
    const styles=files.filter(p=>/^[^/]+\.mse-style\/style$/.test(p)).map(p=>p.split('/')[0]).sort();
    const store=createFetchMseStore(new URL('data/',base),fetchResource,{files});
    fonts=createFonts();
    const index=await loadBrowserCorpusIndex(base,fetchResource,expectedRevision,paths);check();
    const fontPaths=mseResourceFontPaths(paths);
    const fontFailures=[];let cursor=0;
    if(index)configureIndexedCorpus({index,store,fonts,base,fetchResource,check,fontFailures});
    else await Promise.all(Array.from({length:Math.min(4,fontPaths.length)},async()=>{
      while(cursor<fontPaths.length){
        check();const path=fontPaths[cursor++];
        try{
          const response=await fetchResource(new URL(path.split('/').map(encodeURIComponent).join('/'),base).href);
          if(!response.ok)throw new MseError('font-fetch',`HTTP ${response.status}`);
          const bytes=await response.arrayBuffer();check();await fonts.registerFile(bytes);
        }catch(error){check();fontFailures.push({path,message:error.message});}
      }
    }));
    check();
    if(!loadCardImage)artwork=createBrowserArtworkLoader({fetcher,signal:controller.signal,createCanvas,maxPixels});
    const images=new MseImageRenderer({maxPixels,loadArtwork:loadCardImage??artwork.load,
      loadAsset:createMseImageLoader(store,{fetcher:fetchResource,maxPixels,createCanvas}),
      renderSymbol:createBrowserSymbolRenderer({store,loadLocalSymbol,createCanvas,fetcher:fetchResource})});
    renderer=new MseCardRenderer({store,fonts,imageRenderer:images,createCanvas,loadCardImage:loadCardImage??artwork.load,fieldUpdateMode});
    return {renderer,store,fonts,styles,fontFailures,revision:manifest.sha,dispose};
  }catch(error){dispose();throw error;}
}
