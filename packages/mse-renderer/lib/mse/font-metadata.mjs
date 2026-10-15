import { MseError } from './document.mjs';

// OpenType name-table records are independent of filenames. Keep legacy and
// typographic family names so templates can use either native naming scheme.
export function readFontMetadata(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (offset,length) => {
    if (!Number.isSafeInteger(offset) || offset<0 || length<0 || offset+length>bytes.length) throw new MseError('font-format','Truncated OpenType table');
  };
  check(0,12);
  const signature=view.getUint32(0);
  if (![0x00010000,0x4f54544f,0x74727565].includes(signature)) throw new MseError('font-format','Expected an OpenType or TrueType font');
  const count=view.getUint16(4),tables=new Map();check(12,count*16);
  for(let i=0;i<count;i++) {
    const at=12+i*16,tag=String.fromCharCode(...bytes.subarray(at,at+4));
    const offset=view.getUint32(at+8),length=view.getUint32(at+12);check(offset,length);
    tables.set(tag,{offset,length});
  }
  const names=tables.get('name');
  if(!names || names.length<6)throw new MseError('font-format','Missing font naming table');
  const base=names.offset,version=view.getUint16(base),records=view.getUint16(base+2),storage=view.getUint16(base+4);
  if(version>1 || 6+records*12>names.length || storage>names.length)throw new MseError('font-format','Invalid font naming table');
  const values=new Map();
  for(let i=0;i<records;i++) {
    const at=base+6+i*12,platform=view.getUint16(at),encoding=view.getUint16(at+2),language=view.getUint16(at+4),id=view.getUint16(at+6);
    if(![1,2,4,6,16,17].includes(id))continue;
    const length=view.getUint16(at+8),offset=storage+view.getUint16(at+10);
    if(offset+length>names.length)throw new MseError('font-format','Font name exceeds table bounds');
    let decoder,rank;
    if(platform===0 || (platform===3 && [0,1,10].includes(encoding))) {
      if(length%2)throw new MseError('font-format','Odd UTF-16 font name length');
      decoder=new TextDecoder('utf-16be',{fatal:true});rank=platform===3&&language===0x409?3:2;
    } else if(platform===1 && encoding===0) {decoder=new TextDecoder('macintosh');rank=language===0?1:0;}
    else continue;
    let value;
    try {value=decoder.decode(bytes.subarray(base+offset,base+offset+length)).replace(/\0/g,'').trim();}
    catch {throw new MseError('font-format','Invalid font name encoding');}
    if(value && (!values.has(id)||values.get(id).rank<rank))values.set(id,{value,rank});
  }
  const name=id=>values.get(id)?.value || '';
  const families=[...new Set([name(1),name(16)].filter(Boolean))];
  if(!families.length)throw new MseError('font-format','Font has no supported family name');
  const os2=tables.get('OS/2'),head=tables.get('head');
  let weight=400,italic=false;
  if(os2 && os2.length>=64) {weight=view.getUint16(os2.offset+4)||400;italic=Boolean(view.getUint16(os2.offset+62)&1);}
  else if(head && head.length>=46) {const style=view.getUint16(head.offset+44);weight=style&1?700:400;italic=Boolean(style&2);}
  const post=tables.get('post'),decoration={};
  if(head&&head.length>=20)decoration.unitsPerEm=view.getUint16(head.offset+18);
  if(post&&post.length>=12){decoration.underlinePosition=view.getInt16(post.offset+8);decoration.underlineThickness=view.getInt16(post.offset+10);}
  if(os2&&os2.length>=30){decoration.strikeThickness=view.getInt16(os2.offset+26);decoration.strikePosition=view.getInt16(os2.offset+28);}
  const hhea=tables.get('hhea');
  const verticalMetrics=hhea&&hhea.length>=10&&decoration.unitsPerEm>0?{
    unitsPerEm:decoration.unitsPerEm,ascent:view.getInt16(hhea.offset+4),
    descent:view.getInt16(hhea.offset+6),lineGap:view.getInt16(hhea.offset+8),
  }:null;
  return {verticalMetrics,families,family:name(1)||name(16),subfamily:name(2),typographicFamily:name(16),typographicSubfamily:name(17),fullName:name(4),postscriptName:name(6),weight,style:italic?'italic':'normal',decoration};
}
