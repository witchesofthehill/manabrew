import {MseError} from './document.mjs';
const vowel=c=>/[aeiou]/i.test(c||'');
const afterTag=(source,start)=>{const end=source.indexOf('>',start);return end<0?source.length:end+1;};
function closeTag(source,start,name){
  let depth=1;
  for(let i=afterTag(source,start);i<source.length;){
    const next=source.indexOf('<',i);if(next<0)break;
    const after=afterTag(source,next),tag=source.slice(next,after);
    if(tag===`<${name}>`)depth++;
    else if(tag===`</${name}>`&&!--depth)return next;
    i=after;
  }
  throw new MseError('script-english',`<${name}> tag found without matching closing tag.`);
}

// Native MSE hints apply to the next suffix or singular/plural alternative.
// Preserve other markup: reminder expansion passes tagged parameters through.
export function processEnglishHints(source){
  let output='',hint=0,singular=0,plural=0;
  for(let i=0;i<source.length;){
    if(source.startsWith('<hint-',i)){
      const code=source[i+6];if(code==='1'||code==='2')hint=Number(code);
      i=afterTag(source,i);
    }else if(source.startsWith('<param-',i)){
      const after=afterTag(source,i);
      if(hint===1&&source.startsWith('a</param-',after)){
        const end=source.indexOf('>',after+1);
        if(end<0)throw new MseError('script-english','Incomplete </param> tag');
        if(/\s/u.test(source[end+1]||'')&&vowel(source[end+2])){
          output+=source.slice(i,after)+'an';i=after+1;continue;
        }
      }else if(vowel(source[after])&&output.length>=2){
        if((output.length===2||!/[\p{L}]/u.test(output.at(-3)))&&/[aA] $/.test(output))output=output.slice(0,-1)+'n ';
      }else if(source.startsWith('</param-',after)&&output.endsWith(' '))output=output.slice(0,-1);
      output+=source.slice(i,after);i=after;
    }else if(source.startsWith('<singular>',i)||source.startsWith('<plural>',i)){
      const name=source.startsWith('<singular>',i)?'singular':'plural';
      if(name==='singular')singular++;else plural++;
      const start=afterTag(source,i),end=closeTag(source,i,name);
      if(hint===(name==='singular'?1:2)){output+=source.slice(start,end);hint=0;}
      i=afterTag(source,end);
    }else if(source[i]==='('&&hint){
      const end=source.indexOf(')',i);
      if(end>=0){if(hint===2)output+=source.slice(i+1,end);i=end+1;}
      else output+=source[i++];
      hint=0;
    }else if(source[i]==='<'){
      const after=afterTag(source,i);output+=source.slice(i,after);i=after;
    }else output+=source[i++];
  }
  if(singular!==plural){const name=singular>plural?'singular':'plural',other=name==='singular'?'plural':'singular';
    throw new MseError('script-english',`<${name}> tag found without matching <${other}> tag.`);
  }
  return output;
}
