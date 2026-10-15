import {MseError} from './document.mjs';

// wxDateTime::Format follows strftime, with %l for milliseconds. Work in
// local calendar time, as native card timestamps do, rather than UTC strings.
export function formatMseDateTime(value,format,{locale='en-US'}={}){
  const d=new Date(value.milliseconds),year=d.getFullYear(),weekday=d.getDay();
  const pad=(n,width=2)=>String(n).padStart(width,'0');
  const day=new Date(0);day.setUTCFullYear(year,d.getMonth(),d.getDate());day.setUTCHours(0,0,0,0);
  const first=new Date(day);first.setUTCMonth(0,1);
  const ordinal=Math.round((day-first)/86400000)+1;
  const thursday=new Date(day);thursday.setUTCDate(day.getUTCDate()+4-(weekday||7));
  const isoYear=thursday.getUTCFullYear(),isoFirst=new Date(thursday);isoFirst.setUTCMonth(0,1);
  const isoWeek=Math.ceil(((thursday-isoFirst)/86400000+1)/7);
  const named=options=>new Intl.DateTimeFormat(locale,options).format(d);
  const time=()=>`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const offset=-d.getTimezoneOffset();
  const directives={
    '%':()=>'%','n':()=>'\n','t':()=>'\t',
    Y:()=>pad(year,4),y:()=>pad(year%100),C:()=>pad(Math.floor(year/100)),
    m:()=>pad(d.getMonth()+1),d:()=>pad(d.getDate()),e:()=>String(d.getDate()).padStart(2,' '),
    H:()=>pad(d.getHours()),I:()=>pad(d.getHours()%12||12),M:()=>pad(d.getMinutes()),S:()=>pad(d.getSeconds()),
    l:()=>pad(d.getMilliseconds(),3),p:()=>d.getHours()<12?'AM':'PM',
    j:()=>pad(ordinal,3),w:()=>String(weekday),u:()=>String(weekday||7),
    U:()=>pad(Math.floor((ordinal-1+7-weekday)/7)),W:()=>pad(Math.floor((ordinal-1+7-(weekday+6)%7)/7)),
    G:()=>pad(isoYear,4),g:()=>pad(isoYear%100),V:()=>pad(isoWeek),
    F:()=>`${pad(year,4)}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
    D:()=>`${pad(d.getMonth()+1)}/${pad(d.getDate())}/${pad(year%100)}`,
    R:()=>`${pad(d.getHours())}:${pad(d.getMinutes())}`,T:time,
    r:()=>`${pad(d.getHours()%12||12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours()<12?'AM':'PM'}`,
    a:()=>named({weekday:'short'}),A:()=>named({weekday:'long'}),
    b:()=>named({month:'short'}),h:()=>named({month:'short'}),B:()=>named({month:'long'}),
    x:()=>named({dateStyle:'short'}),X:()=>named({timeStyle:'medium'}),c:()=>named({dateStyle:'medium',timeStyle:'medium'}),
    z:()=>`${offset<0?'-':'+'}${pad(Math.floor(Math.abs(offset)/60))}${pad(Math.abs(offset)%60)}`,
    Z:()=>new Intl.DateTimeFormat(locale,{timeZoneName:'short'}).formatToParts(d).find(p=>p.type==='timeZoneName')?.value||'',
  };
  return format.replace(/%([\s\S]|$)/g,(_,specifier)=>{
    if(!directives[specifier])throw new MseError('script-format',`Unsupported date format %${specifier}`);
    return directives[specifier]();
  });
}
