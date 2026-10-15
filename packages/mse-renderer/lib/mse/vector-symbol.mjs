import { parseMseDocument, MseError } from './document.mjs';

function vector(record,key) {
  const value=record.text(key,'(0,0)'),match=/^\(\s*([^,]+),\s*([^\)]+)\)$/.exec(value);
  const result=match?.slice(1).map(Number);
  if(!result || !result.every(Number.isFinite))throw new MseError('symbol-vector',`Invalid ${key}: ${value}`,record.location);
  return result;
}
function choice(record,key,fallback,allowed) {
  const value=record.text(key,fallback);
  if(!allowed.includes(value))throw new MseError('symbol-format',`Unknown ${key}: ${value}`,record.location);
  return value;
}
function part(record,depth) {
  if(depth>128)throw new MseError('symbol-depth','Symbol nesting exceeds 128 levels',record.location);
  const type=choice(record,'type','shape',['shape','group','symmetry']);
  const result={type,name:record.text('name')};
  if(type==='shape') {
    result.combine=choice(record,'combine','overlap',['overlap','merge','subtract','intersection','difference','border']);
    result.points=record.all('point').map(entry=>{
      const r=entry.record();
      return {position:vector(r,'position'),before:vector(r,'handle before'),after:vector(r,'handle after'),
        segment:choice(r,'line after','line',['line','curve']),lock:choice(r,'lock','free',['free','direction','size'])};
    });
  } else {
    result.parts=record.all('part').map(entry=>part(entry.record(),depth+1));
    if(type==='symmetry'){
      result.kind=choice(record,'kind','rotation',['rotation','reflection']);
      result.copies=Number(record.text('copies','2'));
      if(!Number.isSafeInteger(result.copies)||result.copies<1)throw new MseError('symbol-copies','Invalid symmetry copy count',record.location);
      result.center=vector(record,'center');result.handle=vector(record,'handle');
    }
  }
  return result;
}
// Parsing preserves control-point locks and legacy coordinates. Constraint
// enforcement and legacy normalization belong to geometry preparation.
export function parseVectorSymbol(source,location={}) {
  const record=parseMseDocument(source,location);
  return {version:record.text('mse version'),parts:record.all('part').map(entry=>part(entry.record(),0))};
}
export function defaultVectorSymbol() {
  return {version:'2.6.4',parts:[{type:'shape',name:'Square',combine:'overlap',points:[[0.2,0.2],[0.2,0.8],[0.8,0.8],[0.8,0.2]].map(position=>({position,before:[0,0],after:[0,0],segment:'line',lock:'free'}))}]};
}
