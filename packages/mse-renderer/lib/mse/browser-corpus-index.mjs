import {resolveFontFace} from './font-definition.mjs';
import {MseError} from './document.mjs';
import {mseResourceFontPaths} from './font-resources.mjs';

// Optional deployment index: old development corpora retain the original path.
export async function loadBrowserCorpusIndex(base,fetchResource,revision,paths) {
  const response=await fetchResource(new URL('runtime-index.json',base).href);
  if(response.status===404)return null;
  if(!response.ok)throw new MseError('corpus-fetch',`MSE runtime index returned HTTP ${response.status}`);
  const index=await response.json();
  if(index.revision!==revision||!Array.isArray(index.fonts)||!Array.isArray(index.textPackages))throw new MseError('corpus-index','Invalid MSE runtime index');
  const known=new Set(paths);
  for(const font of index.fonts)if(!known.has(font.path)||!mseResourceFontPaths([font.path]).length||!Array.isArray(font.names)||font.names.some(name=>typeof name!=='string'))throw new MseError('corpus-index','Invalid indexed font');
  for(const pkg of index.textPackages)if(!pkg||/[\\/\0]/.test(pkg)||pkg==='.'||pkg==='..')throw new MseError('corpus-index','Invalid indexed package');
  return index;
}

export function configureIndexedCorpus({index,store,fonts,base,fetchResource,check,fontFailures}) {
  const packages=new Set(index.textPackages),pendingPackages=new Map(),readText=store.readText;
  store.readText=async path=>{
    if(!packages.has(path.package))return readText(path);
    if(!pendingPackages.has(path.package)){
      const pending=(async()=>{
        const response=await fetchResource(new URL(`packages/${encodeURIComponent(path.package)}.json`,base).href);
        if(!response.ok)throw new MseError('package-fetch',`HTTP ${response.status} loading ${path.package}`);
        return response.json();
      })().catch(error=>{pendingPackages.delete(path.package);throw error;});
      pendingPackages.set(path.package,pending);
    }
    const files=await pendingPackages.get(path.package);check();
    return typeof files[path.file]==='string'?files[path.file]:readText(path);
  };
  const pendingFonts=new Map(),prepare=fonts.prepare.bind(fonts);
  fonts.prepare=async(font,flags={})=>{
    check();const name=resolveFontFace(font,flags).name.toLowerCase();
    // Preserve corpus order for families with duplicate faces, as eager loading
    // did. A single shared promise also coalesces simultaneous card requests.
    for(const entry of index.fonts.filter(entry=>entry.names.some(n=>n.toLowerCase()===name))){
      if(!pendingFonts.has(entry.path))pendingFonts.set(entry.path,(async()=>{
        try{
          const response=await fetchResource(new URL(entry.path.split('/').map(encodeURIComponent).join('/'),base).href);
          if(!response.ok)throw new MseError('font-fetch',`HTTP ${response.status}`);
          const bytes=await response.arrayBuffer();check();await fonts.registerFile(bytes);
        }catch(error){pendingFonts.delete(entry.path);check();fontFailures.push({path:entry.path,message:error.message});throw error;}
      })());
      await pendingFonts.get(entry.path);
    }
    check();return prepare(font,flags);
  };
}
