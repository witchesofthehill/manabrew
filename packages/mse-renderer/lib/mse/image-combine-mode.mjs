import {MseError} from './document.mjs';
const filters=new Set(['mask','visibility-mask','alpha','fill','saturate','brighten','invert','recolor','flip-horizontal','flip-vertical','enlarge','resize','nine-slice','crop','drop-shadow','insert']);
// combine() is metadata on the generator graph, not a pixel transformation.
// Native SimpleFilterImage forwards it; StrokeImage deliberately does not.
export function imageCombineMode(image){
  const visited=new Set();
  while(image){
    if(visited.has(image))throw new MseError('image-cycle','Circular image graph');
    visited.add(image);
    const p=image.parameters;
    if(image.operation==='set-combine')return p.mode;
    if(filters.has(image.operation))image=p.image;
    else if(image.operation==='linear-blend'||image.operation==='combine')image=p.image1;
    else if(image.operation==='masked-blend')image=p.light;
    else return 'default';
  }
  return 'default';
}
