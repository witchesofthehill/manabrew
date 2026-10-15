import { MseFunction, text, number } from './script-values.mjs';

function untag(source,decode=false){
  let inside=false,result='';
  for(const c of source){
    if(c==='<')inside=true;
    else if(!inside)result+=decode?(c==='\u0001'?'<':c==='\ueb00'?' ':c):c;
    else if(c==='>')inside=false;
  }
  return result;
}
function hideSoftSeparators(source){
  let start=0,pos=source.indexOf('<sep-soft'),result='';
  while(pos>=0){
    // Native match_close_tag groups all sep-* variants under the sep family.
    let depth=1,end=-1;
    for(let i=pos+5;i<source.length;i++){
      if(source[i]!=='<')continue;
      if(source.startsWith('sep',i+1)){depth++;i+=4;}
      else if(source.startsWith('/sep',i+1)){
        if(--depth===0){end=i;break;}
        i+=5;
      }
    }
    // Native remove_tag_contents returns the already completed prefix when
    // a close tag is missing, dropping this segment even before the opening.
    if(end<0)return result;
    result+=source.slice(start,pos);
    const close=source.indexOf('>',end);
    if(close<0)return result;
    start=close+1;pos=source.indexOf('<sep-soft',start);
  }
  return result+source.slice(start);
}

function stripTags(source, prefix = null) {
  let output = '', offset = 0;
  const closing = prefix ? '</' + prefix.slice(1) : null;
  for (const match of source.matchAll(/<[^>]*(?:>|$)/g)) {
    output += source.slice(offset, match.index);
    if (prefix && !match[0].startsWith(prefix) && !match[0].startsWith(closing)) output += match[0];
    offset = match.index + match[0].length;
  }
  return output + source.slice(offset);
}

export function tagBuiltins() {
  const builtins = {
    tag_contents: (scope, runtime, node) => {
      const source = text(scope.get('input')), prefix = text(scope.get('tag'));
      if (!prefix) return source;
      let result = '', offset = 0, position = source.indexOf(prefix);
      while (position >= 0) {
        runtime.tick(node);
        const after = source.indexOf('>', position) + 1;
        if (!after) break;
        const opening = source.slice(position + 1, after - 1);
        const type = opening.startsWith('soft-line') ? 'soft-line' : opening.split('-')[0];
        let depth = 1, closing = null;
        for (const match of source.slice(after).matchAll(/<[^>]*>/g)) {
          if (match[0].startsWith('<' + type)) depth++;
          else if (match[0].startsWith('</' + type)) depth--;
          if (depth === 0) { closing = { start: after + match.index, end: after + match.index + match[0].length }; break; }
        }
        if (!closing) break;
        const inside = source.slice(after, closing.start);
        const replacement = text(runtime.invoke(scope.get('contents'), [['input', inside]], scope, node));
        result += source.slice(offset, after) + replacement + source.slice(closing.start, closing.end);
        offset = closing.end;
        position = source.indexOf(prefix, offset);
      }
      return result + source.slice(offset);
    },
    to_text: scope => untag(hideSoftSeparators(text(scope.get('input'))),true),
    remove_tags: scope => untag(text(scope.get('input'))),
    remove_tag: scope => { const prefix = text(scope.get('tag')); return prefix ? stripTags(text(scope.get('input')), prefix) : text(scope.get('input')); },
    curly_quotes: scope => {
      let open = true, inside = false, result = '';
      for (let char of text(scope.get('input'))) {
        if ("'‘’".includes(char)) char = open ? '‘' : '’';
        else if ('"“”'.includes(char)) char = open ? '“' : '”';
        else if (char === '<') inside = true;
        else if (char === '>') inside = false;
        else if (!inside) open = /\s|[([{–—]/.test(char);
        result += char;
      }
      return result;
    },
    substring: scope => {
      const source = [...text(scope.get('input'))];
      const begin = Math.max(0, scope.has('begin') ? number(scope.get('begin'), true) : 0);
      const end = Math.max(0, scope.has('end') ? number(scope.get('end'), true) : source.length);
      return source.slice(begin, Math.max(begin, end)).join('');
    },
    regex_escape: scope => text(scope.get('input')).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'),
  };
  for (const [name, target, parameters] of [
    ['tag_remove_rule', 'remove_tag', ['tag']],
    ['tag_contents_rule', 'tag_contents', ['tag', 'contents']],
  ]) builtins[name] = scope => new MseFunction('bound', new MseFunction('native', builtins[target]), parameters.filter(name => scope.has(name)).map(name => [name, scope.get(name)]));
  return builtins;
}
