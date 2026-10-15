import {printingMseTreatment} from './printing-style.mjs';

// Automatic defaults are a presentation policy, not a list of supported styles.
// A requested package always wins, including packages outside the bundled pack.
export function selectMsePresentation(snapshot,{style,defaultStyle='auto',faceIndex=0,printing,availableStyles}={}){
  if(style&&style!=='auto')return {style,styling:{},source:'explicit'};
  if(defaultStyle&&defaultStyle!=='auto')return {style:defaultStyle,styling:{},source:'explicit'};
  const available=availableStyles==null?null:new Set(availableStyles);
  const treatment=printingMseTreatment(snapshot,{printing,faceIndex});
  if(treatment&&(!available||available.has(treatment.style)))return {...treatment,source:'printing'};
  const general=generalMseStyle(snapshot,{faceIndex});
  return {style:!available||available.has(general)?general:null,styling:{},source:'general'};
}

export function selectMseStyle(snapshot,options){
  return selectMsePresentation(snapshot,options).style;
}

function generalMseStyle(snapshot,{faceIndex=0}={}){
  const faces=snapshot?.card_faces;
  const front=Array.isArray(faces)&&faces.length?faces[faceIndex]??faces[0]:snapshot;
  const type=String(front?.type_line??front?.type_line_display??'');
  if(snapshot?.layout==='adventure')return 'magic-m15-adventure.mse-style';
  if(snapshot?.layout==='split'){
    const aftermath=snapshot?.keywords?.includes('Aftermath')||faces?.some(face=>/\bAftermath\b/.test(face.oracle_text??''));
    return aftermath?'magic-m15-aftermath.mse-style':'magic-m15-split-fusable.mse-style';
  }
  if(/\bBattle\b/.test(type))return 'magic-m15-mainframe-battles.mse-style';
  if(/\bPlaneswalker\b/.test(type))return ['transform','modal_dfc','double_faced_token','reversible_card'].includes(snapshot?.layout)
    ?'magic-m15-mainframe-planeswalker.mse-style':'magic-m15-planeswalker.mse-style';
  if(/\bSaga\b/.test(type))return 'magic-m15-saga.mse-style';
  return 'magic-m15-altered.mse-style';
}
