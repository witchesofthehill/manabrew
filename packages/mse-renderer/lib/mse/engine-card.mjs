import {MseError} from './document.mjs';

// Engine/printing snapshots are plain text. Escape literal markup before adding
// MSE symbol tags so a card description cannot inject template formatting.
const plain=value=>String(value??'').replaceAll('<','\u0001');
// The engine writes symbols the way Scryfall does; the MSE mana fonts spell a
// few differently: Phyrexian {B/P} is H/B ({G/U/P} is H/G/U; generic {H} is
// shared), half mana {HW} is |W, {½} is .5, the pawprint {P} is "pawprint"
// and {CHAOS} is "chaos". Everything else is shared.
export function engineSymbolToMse(symbol){
  const value=String(symbol).toUpperCase();
  const phyrexian=/^((?:[WUBRGC]\/)*[WUBRGC])\/P$/.exec(value)||/^P\/((?:[WUBRGC]\/)*[WUBRGC])$/.exec(value);
  if(phyrexian)return `H/${phyrexian[1]}`;
  if(value==='P')return 'pawprint';
  if(value==='CHAOS')return 'chaos';
  const half=/^H([WUBRGC])$/.exec(value);
  if(half)return `|${half[1]}`;
  if(value==='½'||value==='1/2')return '.5';
  return symbol;
}
export function engineRulesToMse(value){
  return plain(value).replace(/\{([^{}\n]+)\}/g,(_,symbol)=>`<sym>${engineSymbolToMse(symbol)}</sym>`);
}
export function engineManaToMse(value){
  return plain(value).replace(/\{([^{}\n]+)\}/g,(_,symbol)=>engineSymbolToMse(symbol));
}
const colorNames={W:'white',U:'blue',B:'black',R:'red',G:'green'};
function printableColors(value){
  if(value===undefined||value===null)return null;
  const values=Array.isArray(value)?value:String(value).split(/[,\s]+/);
  const found=new Set();
  for(const entry of values){
    const name=String(entry).toLowerCase();
    if(!name||name==='-'||name==='colorless'||name==='c')continue;
    const code=Object.keys(colorNames).find(code=>code.toLowerCase()===name||colorNames[code]===name);
    if(!code)throw new MseError('engine-colors',`Unknown printable color ${entry}`);
    found.add(code);
  }
  return Object.keys(colorNames).filter(code=>found.has(code));
}
// The colored mana symbols in rules text, reminder text excluded.
function textManaColors(text){
  let rules=String(text??'');
  while(/\([^()]*\)/.test(rules))rules=rules.replace(/\([^()]*\)/g,'');
  const found=new Set([...rules.matchAll(/\{([^{}]+)\}/g)].flatMap(match=>match[1].toUpperCase().split('/')));
  return Object.keys(colorNames).filter(code=>found.has(code));
}
function frameColor(colors,type){
  const choices=colors.map(code=>colorNames[code]);
  if(/\bArtifact\b/.test(type))choices.push('artifact');
  if(/\bLand\b/.test(type))choices.push('land');
  if(colors.length>1)choices.push('multicolor');
  return choices.join(', ')||'colorless';
}

function sagaChapters(rules){
  const roman=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
  const chapters=[],preamble=[],abilities=[];
  for(const line of rules.replace(/\r\n?/g,'\n').split('\n')){
    const match=/^\s*([IVXLCDM]+(?:\s*,\s*[IVXLCDM]+)*)\s+[—–-]\s+(.*)$/.exec(line);
    if(match){
      const labels=match[1].split(/\s*,\s*/).map(label=>roman.indexOf(label)+1);
      if(labels.some(label=>label===0))throw new MseError('engine-saga','Unsupported Saga chapter numeral');
      chapters.push({labels,lines:[match[2]]});
    // Only modal bullets continue a chapter. Any other line is an ability of
    // the permanent itself, such as one granted by another card.
    }else if(chapters.length&&/^\s*•/.test(line))chapters.at(-1).lines.push(line);
    else if(chapters.length)abilities.push(line);
    else preamble.push(line);
  }
  if(!chapters.length)return null;
  if(chapters.length>8)throw new MseError('engine-saga','More than eight Saga ability boxes require a different template schema');
  const snaps=[];
  chapters.forEach((chapter,i)=>{for(const label of chapter.labels){
    if(snaps[label-1]!==undefined)throw new MseError('engine-saga','Duplicate Saga chapter label');
    snaps[label-1]=i+1;
  }});
  if(Array.from(snaps).some(value=>value===undefined))throw new MseError('engine-saga','Saga chapter labels must form a complete sequence');
  return {chapters,preamble:preamble.join('\n'),abilities,snaps:snaps.join(',')};
}

// m15 Saga geometry: the reminder box spans y 60-155 above the chapter
// column, which ends at 437. Its boxes split that space evenly, which suits
// printed Sagas but crushes a reminder box that also holds gained abilities.
// Size every box to an estimate of its wrapped lines instead.
const SAGA_TOP=60,SAGA_COLUMN=155,SAGA_BOTTOM=437,SAGA_MIN_CHAPTER=42;
function estimatedLines(text,charsPerLine){
  return text.split('\n').reduce((total,paragraph)=>{
    const length=paragraph.replace(/\{[^{}]+\}/g,'xx').length;
    return total+Math.max(1,Math.ceil(length/charsPerLine));
  },0);
}
function sagaBoxStyling(top,chapters){
  const weight=(text,chars)=>estimatedLines(text,chars)*16+12;
  const chapterWeights=chapters.map(text=>weight(text,22)),cells=chapters.length;
  const total=weight(top,24)+chapterWeights.reduce((a,b)=>a+b,0);
  const column=Math.min(SAGA_BOTTOM-cells*SAGA_MIN_CHAPTER,Math.round(SAGA_TOP+weight(top,24)*(SAGA_BOTTOM-SAGA_TOP)/total));
  // The template truncates its even share, so chapters fill cells*base.
  const base=Math.trunc((SAGA_BOTTOM-column)/cells),available=cells*base;
  const chapterTotal=chapterWeights.reduce((a,b)=>a+b,0);
  const heights=chapterWeights.map(value=>value*available/chapterTotal);
  // Keep room for each chapter's numeral badge, taken from the largest box.
  for(let i=0;i<cells;i++)if(heights[i]<SAGA_MIN_CHAPTER){
    const largest=heights.indexOf(Math.max(...heights));
    heights[largest]-=SAGA_MIN_CHAPTER-heights[i];heights[i]=SAGA_MIN_CHAPTER;
  }
  const offsets=[];
  let bottom=0;
  for(let x=1;x<cells;x++){bottom+=heights[x-1];offsets.push(Math.round(bottom)-x*base);}
  return {reminder_text_offset:String(column-SAGA_COLUMN),chapter_divider_offsets:offsets.map(offset=>offset+',').join('')};
}

// Template choice and native style overrides belong to the caller. This layer
// maps the engine's common printable fields; it does not pick a frame by name.
export function engineCardToMse(snapshot,{faceIndex=null,rulesText,nativeCard={},set={},styling={}}={}){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new MseError('engine-card','Expected a card snapshot');
  const faces=Array.isArray(snapshot.card_faces)&&snapshot.card_faces.length?snapshot.card_faces:[snapshot];
  if(faceIndex!==null&&(!Number.isInteger(faceIndex)||faceIndex<0||faceIndex>=faces.length))throw new MseError('engine-face','Card face index is out of range');
  const selected=faceIndex===null?faces:[faces[faceIndex]];
  if(selected.length>4)throw new MseError('engine-face','More than four faces require an explicit face selection');
  const card={},inferredStyling={};
  for(let i=0;i<selected.length;i++){
    const face=selected[i],suffix=i?`_${i+1}`:'';
    const put=(name,value)=>{if(value!==undefined&&value!==null)card[name+suffix]=value;};
    put('name',plain(face.name??snapshot.name));
    put('casting_cost',engineManaToMse(face.mana_cost));
    const typeLine=String(face.type_line_display??face.type_line??'');
    const parts=typeLine.split(/\s+[—–]\s+/,2);
    put('super_type',plain(parts[0]));put('sub_type',plain(parts[1]??''));
    const canonicalType=String(face.type_line??typeLine);
    const indicator=printableColors(face.color_indicator);
    if(indicator!==null)put('indicator',frameColor(indicator,''));
    const signature=String(face.characteristic_signature??'').match(/^colors:([^\n]*)/m);
    let colors=printableColors(signature?signature[1]:face.colors)??indicator;
    // A nonbasic land with no colors of its own (Dryad Arbor when the
    // snapshot drops its indicator) takes its frame from its color identity
    // plus the intrinsic mana of its current basic land types (Yavimaya makes
    // itself a Forest); the template already infers basics. Identity is a
    // whole-card value, so only single-faced snapshots use it. Without one
    // (custom cards, older snapshots), intrinsic mana joins the symbols in the
    // rules text instead (Fiery Islet stays U/R). The template does not infer
    // colors from rules text, so a land without basic land types (Spirebluff
    // Canal) needs them too.
    const listed=value=>value==null?[]:Array.isArray(value)?value:String(value).split(/[,\s]+/);
    const intrinsic=face===snapshot?listed(snapshot.intrinsic_mana):[];
    const printedIdentity=face===snapshot?snapshot.color_identity??snapshot.colorIdentity:null;
    const identity=printableColors([...(printedIdentity==null?textManaColors(face.oracle_text):listed(printedIdentity)),...intrinsic]);
    if(/\bLand\b/.test(canonicalType)&&!/\bBasic\b/.test(canonicalType)&&!colors?.length&&identity?.length)colors=identity;
    const costColors=Object.keys(colorNames).filter(code=>String(face.mana_cost??'').includes(code));
    // Preserve template-specific hybrid/land/artifact inference when its mana
    // colors agree. Explicit live colors and indicators can override that
    // inference (e.g. devoid or a colored face without a mana cost).
    if(colors!==null&&colors.join('')!==costColors.join('')&&(!/\bLand\b/.test(canonicalType)||colors.length))
      put('card_color',frameColor(colors,canonicalType));
    const rules=i===0&&rulesText!==undefined?rulesText:face.oracle_text??face.effect_text??face.ability_text??'';
    if(typeof rules!=='string')throw new MseError('engine-rules','Printable rules text must be a string');
    let renderedRules=rules;
    if(/\bPlaneswalker\b/i.test(String(face.type_line??parts[0]))){
      // The Magic game numbers eight loyalty slots per face. Static abilities
      // still occupy a paragraph/slot, but have an empty cost box.
      const paragraphs=rules.replace(/\r\n?/g,'\n').split('\n');
      renderedRules=paragraphs.map((paragraph,index)=>{
        const match=/^\s*([+\-−–]?(?:\d+|X)):\s*(.*)$/i.exec(paragraph);
        if(index>=8)throw new MseError('engine-loyalty','The Magic template schema supports eight planeswalker paragraphs per face');
        const slot=i*8+index+1,ability=match?match[2]:paragraph;
        if(match)card[`loyalty_cost_${slot}`]=match[1].replace(/[−–]/g,'-').toUpperCase();
        // Mainframe templates use independent ability boxes, while older
        // planeswalker styles read the combined rule_text field below.
        card[`level_${slot}_text`]=engineRulesToMse(ability);
        return ability;
      }).join('\n');
    }
    if(/\bSaga\b/.test(String(face.type_line??typeLine))){
      const saga=sagaChapters(rules);
      if(saga){
        saga.chapters.forEach((chapter,index)=>{card[`level_${i*8+index+1}_text`]=engineRulesToMse(chapter.lines.join('\n'));});
        const top=[saga.preamble,...saga.abilities].filter(Boolean).join('\n');
        if(top)put('chapter_text',engineRulesToMse(top));
        inferredStyling[`chapter_textboxes${suffix}`]=['one','two','three','four','five','six','seven','eight'][saga.chapters.length-1];
        inferredStyling[`snap_chapter_to_box${suffix}`]=saga.snaps;
        // Saga creatures use a different column layout.
        if(saga.abilities.length&&!/\bCreature\b/.test(String(face.type_line??typeLine)))
          for(const [key,value] of Object.entries(sagaBoxStyling(top,saga.chapters.map(chapter=>chapter.lines.join('\n')))))inferredStyling[key+suffix]=value;
      }
    }
    put('rule_text',engineRulesToMse(renderedRules));
    put('flavor_text',plain(face.flavor_text));
    const pt=String(face.power_toughness??'').split('/');
    put('power',face.power??(pt.length===2?pt[0]:undefined));
    put('toughness',face.toughness??(pt.length===2?pt[1]:undefined));
    put('loyalty',face.defense??face.loyalty);
    if(face.rarity??snapshot.rarity)put('rarity',String(face.rarity??snapshot.rarity).replace(/^mythic$/,'mythic rare'));
  }
  Object.assign(card,nativeCard);
  return {card,set:{...set},styling:{...inferredStyling,...styling},uid:snapshot.stable_id??snapshot.id};
}

// Modern MSE styles render DFC faces as separate linked cards. Split/adventure
// layouts still use the numbered fields in engineCardToMse.
export function engineDoubleFacesToMse(snapshot,options={}){
  if(!['transform','modal_dfc','double_faced_token','battle','meld'].includes(snapshot?.layout))return null;
  if(snapshot.layout==='meld'&&!snapshot.card_faces?.length)return null;
  if(!Array.isArray(snapshot.card_faces)||snapshot.card_faces.length!==2)
    throw new MseError('engine-face','A double-faced layout requires two card faces');
  const selected=options.faceIndex??0;
  if(!Number.isInteger(selected)||selected<0||selected>1)throw new MseError('engine-face','Card face index is out of range');
  const uid=String(snapshot.stable_id??snapshot.id??'engine-dfc');
  const cards=snapshot.card_faces.map((face,index)=>{
    const values=engineCardToMse(snapshot,index===selected?{...options,faceIndex:index}:{faceIndex:index,set:options.set});
    values.uid=`${uid}:face:${index}`;
    values.card.linked_card_1=`${uid}:face:${1-index}`;
    values.card.linked_relation_1=snapshot.layout==='meld'
      ?(index===0?'Meld Result':'Meld Base')
      :(index===0?'Back Face':'Front Face');
    if(snapshot.layout==='meld'&&index===1)values.styling.back_face='yes';
    if(snapshot.layout==='modal_dfc'&&values.card.transformation===undefined)
      values.card.transformation=index===0?'modal front':'modal back';
    return values;
  });
  return {cards,selected};
}
