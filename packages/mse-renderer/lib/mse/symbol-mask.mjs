import {MseError} from './document.mjs';
// Binary mask counterpart of SymbolViewer::combineSymbolShape. Polygon edge
// rasterization is deliberately separate from these native Boolean operations.
export function combineSymbolMasks(border,inside,fill,outline,stroke,mode){
  if(!['overlap','merge','subtract','intersection','difference','border'].includes(mode))throw new MseError('symbol-combine',`Unknown symbol combine mode ${mode}`);
  for(let i=0;i<border.length;i++){
    const f=fill[i*4+3]>=128,o=outline?.[i*4+3]>=128,s=stroke?.[i*4+3]>=128;
    switch(mode){
      case 'overlap':case 'merge':if(f)inside[i]=1;if(o)border[i]=1;break;
      case 'border':if(f)border[i]=1;break;
      case 'subtract':if(f)inside[i]=0;if(outline&&f&&!s)border[i]=0;break;
      case 'intersection':if(!f)inside[i]=0;if(!o)border[i]=0;break;
      case 'difference':if(f)inside[i]^=1;if(outline&&(o||f))border[i]=o&&!f?1:0;break;
    }
  }
}
