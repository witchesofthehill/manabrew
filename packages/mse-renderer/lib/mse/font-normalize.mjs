import { readFontMetadata } from './font-metadata.mjs';
import { MseError } from './document.mjs';

// Repair derived search accelerators and invalid terminal cmap pointers only.
// Printable mappings, outlines, hints and metrics remain intact, as do inputs.
export function normalizeFont(input) {
  const source=input instanceof Uint8Array?input:new Uint8Array(input);
  readFontMetadata(source); // Validate the SFNT directory before touching offsets.
  const bytes=new Uint8Array(source),v=new DataView(bytes.buffer),tables=[],repairs=[];
  for(let i=0;i<v.getUint16(4);i++){
    const at=12+i*16;tables.push({at,tag:String.fromCharCode(...bytes.subarray(at,at+4)),offset:v.getUint32(at+8),length:v.getUint32(at+12)});
  }
  const cmap=tables.find(t=>t.tag==='cmap');
  if(cmap){
    const end=cmap.offset+cmap.length;
    const check=(at,length)=>{if(at<cmap.offset || at+length>end)throw new MseError('font-format','Truncated character mapping table');};
    check(cmap.offset,4);const count=v.getUint16(cmap.offset+2);check(cmap.offset+4,count*8);
    const seen=new Set();
    for(let i=0;i<count;i++){
      const at=cmap.offset+v.getUint32(cmap.offset+8+i*8);check(at,2);
      if(seen.has(at))continue;seen.add(at);
      if(v.getUint16(at)!==4)continue;
      check(at,14);const length=v.getUint16(at+2),segments=v.getUint16(at+6)/2;
      check(at,length);
      if(!Number.isInteger(segments)||segments<1||length<16+8*segments)throw new MseError('font-format','Invalid format-4 character mapping');
      const last=segments-1,endCodes=at+14,startCodes=endCodes+2*segments+2;
      const deltas=startCodes+2*segments,ranges=deltas+2*segments;
      const terminalRange=ranges+2*last,offset=v.getUint16(terminalRange);
      // OpenType format-4 terminal segment: https://learn.microsoft.com/typography/opentype/spec/cmap
      // An isolated FFFF terminator is not a printable character mapping.
      // Some legacy fonts have garbage pointers here; map that invalid entry
      // to missingGlyph without touching any real segment or glyph array.
      if(v.getUint16(endCodes+2*last)===0xffff&&v.getUint16(startCodes+2*last)===0xffff&&offset
        &&(offset%2||terminalRange+offset<ranges+2*segments||terminalRange+offset+2>at+length)){
        v.setUint16(deltas+2*last,1);v.setUint16(terminalRange,0);
        repairs.push('cmap format 4 invalid terminal pointer');
      }
      const selector=Math.floor(Math.log2(segments)),range=2*(2**selector),shift=2*segments-range;
      for(const [offset,value,name] of [[8,range,'searchRange'],[10,selector,'entrySelector'],[12,shift,'rangeShift']]){
        if(v.getUint16(at+offset)!==value){repairs.push(`cmap format 4 ${name}`);v.setUint16(at+offset,value);}
      }
    }
  }
  if(repairs.length){
    const head=tables.find(t=>t.tag==='head');
    if(!head || head.length<12)throw new MseError('font-format','Missing font checksum adjustment');
    v.setUint32(head.offset+8,0);
    const checksum=(offset,length)=>{
      let sum=0;
      for(let i=0;i<length;i+=4){let word=0;for(let j=0;j<4;j++)word=word*256+(i+j<length?bytes[offset+i+j]:0);sum=(sum+word)>>>0;}
      return sum;
    };
    for(const table of tables)v.setUint32(table.at+4,checksum(table.offset,table.length));
    v.setUint32(head.offset+8,(0xb1b0afba-checksum(0,bytes.length))>>>0);
  }
  return {bytes,repairs};
}
