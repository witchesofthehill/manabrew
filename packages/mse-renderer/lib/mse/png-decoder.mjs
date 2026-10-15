import { MseError } from './document.mjs';
import { allocateRaster } from './image-sampling.mjs';
const fail = message => { throw new MseError('image-png', message); };
const crcTable = Uint32Array.from({length:256}, (_,n) => { for(let i=0;i<8;i++) n = n&1 ? 0xedb88320^(n>>>1) : n>>>1; return n>>>0; });
function crc(bytes) { let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
const passes = [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c); return x<=y&&x<=z?a:y<=z?b:c; };

// Decode raw PNG samples rather than round-tripping through a premultiplied
// canvas, which loses RGB values under transparent pixels used by MSE filters.
export async function decodePng(input, { maxPixels = 16777216 } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<8 || ![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))fail('Invalid PNG signature');
  let header, palette, transparency, ended=false;
  const compressed=[];
  for(let pos=8;pos+12<=bytes.length;) {
    const length=view.getUint32(pos), end=pos+12+length;
    if(end>bytes.length)fail('Truncated PNG chunk');
    const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8)), data=bytes.subarray(pos+8,pos+8+length);
    if(crc(bytes.subarray(pos+4,pos+8+length))!==view.getUint32(pos+8+length))fail(`Invalid ${type} checksum`);
    if(type==='IHDR') { if(header||pos!==8||length!==13)fail('Invalid PNG header'); header=data; }
    else if(type==='PLTE')palette=data;
    else if(type==='tRNS')transparency=data;
    else if(type==='IDAT')compressed.push(data);
    else if(type==='IEND'){ended=true;break;}
    else if(type[0]===type[0].toUpperCase())fail(`Unknown critical PNG chunk ${type}`);
    pos=end;
  }
  if(!header||!ended||!compressed.length)fail('Incomplete PNG');
  const hv=new DataView(header.buffer,header.byteOffset,13), width=hv.getUint32(0),height=hv.getUint32(4),depth=header[8],type=header[9];
  const channels={0:1,2:3,3:1,4:2,6:4}[type];
  if(!channels || !(type===0?[1,2,4,8,16]:type===3?[1,2,4,8]:[8,16]).includes(depth) || header[10]!==0 || header[11]!==0 || header[12]>1)fail('Unsupported PNG header');
  if(type===3&&(!palette||palette.length%3||palette.length>768))fail('Invalid PNG palette');
  const raster=allocateRaster(width,height,type===4||type===6||Boolean(transparency),maxPixels);
  const layouts=(header[12]?passes:[[0,0,1,1]]).map(([x,y,dx,dy])=>({x,y,dx,dy,w:Math.max(0,Math.ceil((width-x)/dx)),h:Math.max(0,Math.ceil((height-y)/dy))}));
  const expected=layouts.reduce((n,p)=>n+(p.w&&p.h?p.h*(1+Math.ceil(p.w*channels*depth/8)):0),0);
  const raw=new Uint8Array(expected);
  const reader=new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let used=0;
  try { while(true){const {value,done}=await reader.read();if(done)break;if(used+value.length>expected)fail('PNG scanlines exceed declared dimensions');raw.set(value,used);used+=value.length;} }
  finally { await reader.cancel(); }
  if(used!==expected)fail('Truncated PNG scanlines');
  let offset=0;
  const bpp=Math.max(1,Math.ceil(channels*depth/8));
  const transparentSample=i=>transparency&&transparency.length>=2*i+2?(transparency[2*i]*256+transparency[2*i+1]):-1;
  for(const p of layouts) {
    if(!p.w||!p.h)continue;
    const length=Math.ceil(p.w*channels*depth/8);
    let previous=new Uint8Array(length);
    for(let y=0;y<p.h;y++) {
      const filter=raw[offset++],row=raw.slice(offset,offset+length);offset+=length;
      if(filter>4)fail('Invalid PNG filter');
      for(let i=0;i<length;i++) {
        const a=i>=bpp?row[i-bpp]:0,b=previous[i],c=i>=bpp?previous[i-bpp]:0;
        row[i]=(row[i]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
      }
      const sample=i=>depth===16?row[i*2]*256+row[i*2+1]:depth===8?row[i]:(row[Math.floor(i*depth/8)]>>(8-depth-(i*depth)%8))&((1<<depth)-1);
      const byte=v=>depth===16?v>>>8:depth===8?v:Math.round(v*255/((1<<depth)-1));
      for(let x=0;x<p.w;x++) {
        const values=Array.from({length:channels},(_,c)=>sample(x*channels+c));
        let r,g,b,a=255;
        if(type===3){const index=values[0];if(index*3+2>=palette.length)fail('PNG palette index out of range');[r,g,b]=palette.subarray(index*3,index*3+3);a=transparency?.[index]??255;}
        else if(type===0||type===4){r=g=b=byte(values[0]);a=type===4?byte(values[1]):values[0]===transparentSample(0)?0:255;}
        else {[r,g,b]=values.slice(0,3).map(byte);a=type===6?byte(values[3]):values.every((v,i)=>v===transparentSample(i))?0:255;}
        raster.data.set([r,g,b,a],((p.y+y*p.dy)*width+p.x+x*p.dx)*4);
      }
      previous=row;
    }
  }
  return raster;
}
