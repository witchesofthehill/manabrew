import { MseFieldUpdateQueue } from './field-update-queue.mjs';
import { imageCombineMode } from './image-combine-mode.mjs';
import { createTextMask } from './text-mask.mjs';
import { conformRaster } from './image-conform.mjs';
import { readSymbolVariation } from './symbol-variation.mjs';
import { textLayoutInfo, dummyTextLayout } from './text-layout-info.mjs';
import { layoutTaggedText } from './tagged-layout.mjs';
import { parseTaggedText, measureTaggedText } from './tagged-text.mjs';
import { selectTextScale } from './text-scale.mjs';
import { alignTextLines, textContentHeight } from './text-alignment.mjs';
import { parseAlignment } from './alignment.mjs';
import { wrapTextCharacters } from './text-wrap.mjs';
import { measureTextRun } from './text-metrics.mjs';
import { measureSymbolRun } from './symbol-layout.mjs';
import { loadSymbolFont, evaluateSymbolFont, splitSymbols } from './symbol-font.mjs';
import { compileFontDefinition, evaluateFontDefinition } from './font-definition.mjs';
import { geometryNames, geometryDefaults, geometryModes, geometryValue } from './style-geometry.mjs';
import { canonicalName, MseError, MseRecord } from './document.mjs';
import { MseScriptLoader } from './script-loader.mjs';
import { MseRuntime, MseScope } from './script-runtime.mjs';
import { coreBuiltins } from './script-builtins.mjs';
import { MseObject, MseSet, MseFieldValue, fromHost, force, boolean, number, text, equal, missingMember } from './script-values.mjs';
import { color } from './color-values.mjs';
import { loadMseKeywords, keywordBuiltins } from './keywords.mjs';
import { imageBuiltins, mseImage } from './image-builtins.mjs';
import { MseCardRegistry, cardLinkBuiltins } from './card-links.mjs';
import { choiceDefinitions, normalizeMultipleChoice, isChoiceFieldType, choiceRenderFlags } from './choice-fields.mjs';
import {infoCaption} from './info-painter.mjs';

const numericStyleProperties = new Set('left right top bottom width height angle z_index tab_index padding_left padding_right padding_top padding_bottom padding_left_min padding_right_min padding_top_min padding_bottom_min line_height_soft line_height_hard line_height_line line_height_soft_max line_height_hard_max line_height_line_max paragraph_height'.split(' '));

function storedFieldValue(definition,value) {
  const type=definition?.record.text('type');
  if(type==='color')return color(value);
  return type==='text'||type==='info'||isChoiceFieldType(type)?text(value):value;
}

function initialValue(record, choices) {
  const value = record.text('initial');
  switch (record.text('type')) {
    // TextField does not reflect an `initial` property. TextValue starts
    // empty; the field's default script supplies any initial content.
    case 'text': case 'info': return '';
    case 'boolean': return value || 'yes';
    case 'choice': case 'slider': return value || choices[0]?.name || '';
    case 'color': {
      if(value)return color(value);
      const first=record.all('choice')[0];
      if(!first)return color(null);
      if(!first.inline)return color(first.record().text('color')||null);
      // ColorField::Choice leaves its default transparent color when a
      // shorthand choice name does not parse as a color.
      try{return color(first.inline);}catch(error){
        if(error.code!=='script-conversion')throw error;
        return color(null);
      }
    }
    case 'image': case 'symbol': return null;
    default: return value;
  }
}

// A definition retains every field/property record. Only the schema consumer
// decides whether a nested block is a script, a font, or a repeated choice.
export async function loadMseTemplate(store, name, { setKeywords = [] } = {}) {
  const pkg = await store.package(name);
  const style = await store.expandRecord(pkg.document);
  const gamePackage = await store.package(style.text('game') + '.mse-game');
  const game = await store.expandRecord(gamePackage.document);
  const loader = new MseScriptLoader(store);
  const compile = entry => entry ? loader.compile(entry.text(), { ...entry.location, line: entry.location.line + (entry.inline ? 0 : 1) }) : null;
  const definitions = { card: new Map(), set: new Map(), styling: new Map(), extra_card: new Map() };
  for (const [group, records, key] of [
    ['card', [game, style], 'card field'], ['set', [game], 'set field'], ['styling', [style], 'styling field'],
    ['extra_card', [style], 'extra card field'],
  ]) for (const source of records) for (const entry of source.all(key)) {
    const record = await store.expandRecord(entry.record());
    const fieldName = canonicalName(record.text('name'));
    if (!fieldName) continue;
    const choices = isChoiceFieldType(record.text('type')) ? choiceDefinitions(record) : [];
    definitions[group].set(fieldName, {
      name: fieldName, record, choices, initial: initialValue(record, choices),
      defaultScript: record.text('type')==='info'?null:await compile(record.last('default')),
      script: await compile(record.last('script')),
    });
  }
  const layouts = new Map(), extraLayouts = new Map();
  for (const [recordName, target] of [['card style', layouts], ['extra card style', extraLayouts]]) for (const entry of style.all(recordName)) {
    const record = await store.expandRecord(entry.record());
    for (const field of record.entries) {
      const properties = await store.expandRecord(field.record());
      const programs = new Map(), choiceImages = new Map();
      for (const choice of properties.last('choice images')?.record().entries || []) {
        choiceImages.set(choice.key, await loader.compileScriptable(choice.text(), choice.location));
      }
      for (const property of properties.entries) {
        // These properties are structured records, not scalar expressions.
        if (['font', 'symbol_font', 'choice_images'].includes(property.key)) continue;
        programs.set(property.key, await loader.compileScriptable(property.text(), property.location));
      }
      target.set(field.key, { record: properties, programs, choiceImages, geometry: geometryModes(properties), font: await compileFontDefinition(properties.last('font')?.record(), loader), symbolFont: await compileFontDefinition(properties.last('symbol font')?.record(), loader, { symbol: true }) });
    }
  }
  // Native stylesheet loading initializes styles for every game/extra field,
  // even when no card-style record positions it. Such fields are off-canvas.
  for (const [group,target] of [['card',layouts],['extra_card',extraLayouts]]) {
    for (const name of definitions[group].keys()) if (!target.has(name)) {
      const record=new MseRecord([],style.location);
      target.set(name,{record,programs:new Map(),choiceImages:new Map(),geometry:geometryModes(record),
        font:await compileFontDefinition(null,loader),symbolFont:await compileFontDefinition(null,loader,{symbol:true})});
    }
  }
  const init = [];
  const symbolVariations = new Map();
  for (const [source,key] of [[game,'default set style'],[style,'set info style']]) {
    for (const block of source.all(key)) for (const field of (await store.expandRecord(block.record())).entries) {
      const record = await store.expandRecord(field.record());
      for (const entry of record.all('variation')) {
        const variation = readSymbolVariation(await store.expandRecord(entry.record()));
        if (!symbolVariations.has(field.key)) symbolVariations.set(field.key,new Map());
        symbolVariations.get(field.key).set(variation.name,variation);
      }
    }
  }
  for (const source of [game, style]) for (const entry of source.all('init script')) init.push(await compile(entry));
  const keywords = await loadMseKeywords(game, loader, setKeywords);
  const faceScripts = { front: await compile(game.last('get front face script')), back: await compile(game.last('get back face script')) };
  const linkAliases = new Map();
  for (const entry of game.all('card link')) {
    const record = entry.record();
    for (const side of ['selected', 'linked']) for (const alias of record.last(`localized ${side}`)?.record().entries || []) linkAliases.set(alias.text(), record.text(side));
  }
  return { name, store, game, style, definitions, layouts, extraLayouts, init, keywords, faceScripts, linkAliases, symbolVariations };
}

export class MseTemplateContext {
  constructor(template, { card = {}, set = {}, styling = {}, extraCard = {}, builtins = {}, spellcheck, spellcheckEnabled, uid = card.uid, cardRegistry = new MseCardRegistry(), fieldUpdateMode = 'lazy' } = {}) {
    if(!['lazy','ordered'].includes(fieldUpdateMode))throw new MseError('field-update','Unknown field update mode');
    this.fieldUpdateMode=fieldUpdateMode;
    this.template = template;
    this.active = false;
    this.reading = [];
    this.diagnostics = [];
    this.cells = {};
    this.layoutValues = new Map();
    this.textMeasurements = null;
    this.layoutRevision = 0;
    this.fieldValueRevision = 0;
    this.observedLayoutProperties = new Map();
    this.keywordUsage = new Map();
    this.cardRegistry = cardRegistry;
    this.runtime = new MseRuntime({ builtins: { ...coreBuiltins({ spellcheck, spellcheckEnabled }), ...keywordBuiltins(template.keywords, this.keywordUsage, () => this.reading.at(-1) || 'input'), ...imageBuiltins(template.name), ...cardLinkBuiltins(cardRegistry), exists_in_package: scope => template.store.exists(text(scope.get('input'))), ...builtins } });
    for (const [group, input] of Object.entries({ card, set, styling, extra_card: extraCard })) {
      // A native Set owns one set-data map, shared by every card context.
      if(group==='set'&&cardRegistry.setContext){
        this.cells.set=cardRegistry.setContext.cells.set;
        this.runtime.scope.set(group,new MseObject(name=>this.field(group,name)));
        continue;
      }
      const cells = new Map(); this.cells[group] = cells;
      const supplied = Object.fromEntries(Object.entries(input).map(([key, value]) => [canonicalName(key), fromHost(value)]));
      for (const [name, definition] of template.definitions[group]) {
        let value = Object.hasOwn(supplied, name) ? supplied[name] : definition.initial;
        value=storedFieldValue(definition,value);
        cells.set(name, { definition, value, sourceValue: value, isDefault: !Object.hasOwn(supplied, name), resolved: group==='styling' });
      }
      for (const [name, value] of Object.entries(supplied)) if (!cells.has(name)) cells.set(name, { value, isDefault: false, resolved: true });
      this.runtime.scope.set(group, new MseObject(name => this.field(group, name)));
      if(group==='set')cardRegistry.setContext=this;
    }
    this.runtime.scope.set('game', fromHost({ name: template.style.text('game') }));
    this.stylesheet=fromHost({ name: template.name, short_name: template.style.text('short name'), full_name: template.style.text('full name'), card_width: Number(template.style.text('card width','100')), card_height: Number(template.style.text('card height','100')), card_dpi: Number(template.style.text('card dpi','96')) });
    this.runtime.scope.set('stylesheet',this.stylesheet);
    this.runtime.scope.set('card_style', new MseObject(name => template.layouts.has(name) ? new MseObject(property => this.property(name, property)) : missingMember(name)));
    this.runtime.scope.set('extra_card_style', new MseObject(name => template.extraLayouts.has(name) ? new MseObject(property => this.property(name, property, 'extra_card')) : missingMember(name)));
    this.card = cardRegistry.register(this, card, uid);
    this.runtime.scope.set('card', this.card);
    this.setInfo=new MseObject(name=>this.field('set',name));
    this.runtime.scope.set('set', new MseSet(cardRegistry, name => name==='set_info'?this.setInfo:name==='stylesheet'?this.stylesheet:this.field('set', name)));
    if(!this.cells.set.has('cards'))this.cells.set.set('cards', { value: cardRegistry.cards, resolved: true, isDefault: false });
    if(fieldUpdateMode==='ordered'){
      this.fieldUpdates=cardRegistry.fieldUpdates ||= new MseFieldUpdateQueue();
      for(const cell of Object.values(cardRegistry.resolve(this.card).metadata))this.fieldUpdates.register(cell,()=>false);
      this.fieldUpdates.register(cardRegistry.resolve(this.card).linkDependency,()=>false);
      this.fieldOrder=[];
      for(const group of ['set','styling','card','extra_card'])for(const [name,cell] of this.cells[group]){
        if(group==='set'&&cardRegistry.setContext!==this)continue;
        // Native updateAll initializes set/card data; styling values retain
        // initial or loaded values until a user edit invokes their scripts.
        if(group!=='styling')this.fieldOrder.push(cell);
        this.fieldUpdates.register(cell,()=>{
          if(!cell.definition)return false;
          const before=cell.value;
          this.layoutValues.clear();
          this.evaluateField(group,name,cell);
          const changed=!equal(before,cell.value);
          if(changed)this.fieldValueRevision++;
          return changed;
        },{trackDependencies:group!=='styling'});
      }
    }

  }
  initializeScripts() {
    if (this.active || this.initializing) return this;
    this.initializing = true;
    try {
      for (const program of this.template.init) this.runtime.run(program);
      this.active = true;

    } catch(error){this.active=false;throw error;}
    finally { this.initializing = false; }
    return this;
  }
  initialize() {
    this.initializeScripts();
    if(this.active&&!this.fieldsInitialized){
      this.fieldsInitialized=true;
      try{if(this.fieldUpdates)this.fieldUpdates.initialize(this.fieldOrder);}
      catch(error){this.fieldsInitialized=false;throw error;}
    }
    return this;
  }
  invalidate({ keepMeasurements = false } = {}) {
    this.layoutRevision++;
    if (!keepMeasurements) this.textMeasurements = null;
    this.layoutValues.clear(); this.keywordUsage.clear();
    for (const [group, cells] of Object.entries(this.cells)) for (const [name, cell] of cells) {
      if (this.fieldUpdateMode==='lazy' && group!=='styling' && cell.definition && !this.reading.includes(`${group}.${name}`)) { cell.value = cell.sourceValue; cell.resolved = false; }
    }
  }
  setField(group, name, value, { age = ++this.cardRegistry.age, isDefault = false, lastChange = '' } = {}) {
    name = canonicalName(name);
    const cell = this.cells[group]?.get(name);
    if (!cell) throw new MseError('field-name', `No field ${group}.${name}`);
    value = fromHost(value);
    value=storedFieldValue(cell.definition,value);
    this.cardRegistry.age = Math.max(this.cardRegistry.age, age);
    Object.assign(cell, { value, sourceValue: value, isDefault, lastUpdate: age, lastChange, resolved: false });
    const modified=group==='set'?null:this.cardRegistry.touch(this.card);
    this.cardRegistry.changed();
    if(this.fieldUpdates)this.fieldUpdates.changeMany(modified?[cell,modified]:[cell]);
    else if(group==='styling'&&cell.definition)this.evaluateField(group,name,cell);
  }
  fieldValue(group, name, cell) {
    return new MseFieldValue(cell.value, cell.definition?.record.text('type')==='info'||cell.isDefault, { cell, context: this, group, name });
  }
  evaluateField(group,name,cell){
    this.reading.push(`${group}.${name}`);
    try {
        if(cell.definition.record.text('type')==='info'&&!cell.value)cell.value=infoCaption(cell.definition.record);
        const scope = new MseScope(this.runtime.scope);
        scope.set('value', this.fieldValue(group, name, cell));
        scope.set('input', cell.value);
        const multipleChoice = cell.definition.record.text('type') === 'multiple choice';
        const evaluate=program=>{
          const value=force(this.runtime.evaluate(program,scope));
          // Native invokeOn converts before assigning: a failed conversion
          // must retain the previous valid field value.
          return storedFieldValue(cell.definition,value);
        };
        if (multipleChoice) scope.set('last_change', cell.lastChange || '');
        if (cell.isDefault && cell.definition.defaultScript) cell.value = evaluate(cell.definition.defaultScript);
        scope.set('input', cell.value);
        if (cell.definition.script) cell.value = evaluate(cell.definition.script);
        if (multipleChoice) cell.value = normalizeMultipleChoice(text(cell.value), cell.definition.choices, cell.definition.record.text('empty choice'));
        cell.resolved = true;
    }catch(error){
      // SetScriptManager catches ScriptError at each field update, reports it,
      // and keeps the last value successfully assigned. Resource/host failures
      // must still stop execution; they are not template value errors.
      if(!(error instanceof MseError)||!['script-variable','script-member','script-conversion'].includes(error.code))throw error;
      this.diagnostics.push({severity:'error',phase:'field-update',field:`${group}.${name}`,code:error.code,message:error.message,location:error.location});
      cell.resolved=true;
    }finally{this.reading.pop();}
  }
  field(group, name) {
    if(group==='set'&&this.cardRegistry.setContext!==this)return this.cardRegistry.setContext.field(group,name);
    const cell = this.cells[group].get(name);
    if (!cell) return missingMember(`${group}.${name}`);
    if(this.fieldUpdates){
      this.fieldUpdates.read(cell);
      return this.fieldValue(group,name,cell);
    }
    const key = `${group}.${name}`;
    if (this.reading.includes(key) && this.reading.at(-1) !== key) throw new MseError('field-cycle', `Circular field dependency ${[...this.reading, key].join(' -> ')}`);
    if (this.active && !cell.resolved && !this.reading.includes(key)) this.evaluateField(group,name,cell);
    return this.fieldValue(group, name, cell);
  }
  async prepareTextLayouts(fonts, renderer) {
    const generation = this.textPreparationGeneration = (this.textPreparationGeneration || 0) + 1;
    const fields = [];
    for (const [group, layouts] of [['card', this.template.layouts], ['extra_card', this.template.extraLayouts]]) {
      for (const name of new Set([...this.template.definitions[group].keys(),...layouts.keys()])) {
        const layout=layouts.get(name);
        if(!layout)continue;
        const type = this.cells[group].get(name)?.definition?.record.text('type');
        fields.push({ group, name, layout, type, key: `${group}.${name}` });
      }
    }
    const measuredFields=fields.filter(field=>field.type==='text'||isChoiceFieldType(field.type));
    this.textMeasurements = new Map(measuredFields.map(field => [field.key, { info: dummyTextLayout(), result: null }]));
    this.invalidate({ keepMeasurements: true });
    // Native DataViewer updates styles before preparing any viewers. Freeze
    // these evaluated properties so later fields cannot accidentally see a
    // partially updated stylesheet as earlier fields publish their metrics.
    const styles=(refresh=false)=>new Map(fields.map(({group,name,layout,key,type})=>{
      if(refresh)for(const cached of this.layoutValues.keys()){
        if([`${group}_style.${name}.`,`${group}_geometry.${name}.`].some(prefix=>cached.startsWith(prefix))||cached===`${group}_font.${name}`||cached===`${group}_symbol_font.${name}`)this.layoutValues.delete(cached);
      }
      if(!this.fieldVisible(name,group))return [key,null];
      const properties={};
      for(const property of new Set([...layout.programs.keys(),...geometryNames]))properties[property]=this.property(name,property,group);
      if(type==='text'||type==='info'||isChoiceFieldType(type))properties.font=this.font(name,group);
      if(layout.symbolFont)properties.symbolFont=this.font(name,group,true);
      if(isChoiceFieldType(type)&&layout.choiceImages.size)properties.image=this.property(name,'image',group);
      return [key,JSON.stringify([type==='text'||isChoiceFieldType(type)?text(this.field(group,name)):null,properties])];
    }));
    try {
      const initial=styles();
      for(const field of fields)field.z=field.layout.programs.has('z_index')?this.property(field.name,'z_index',field.group):0;
      measuredFields.sort((a,b)=>a.z-b.z);
      let revision=this.layoutRevision;
      const measure=async field=>{
        const previous=this.textMeasurements.get(field.key);
        const result=field.type==='text'
          ? await this.layoutTaggedText(field.name,this.field(field.group,field.name),fonts,renderer,{group:field.group,previousScale:previous.result?.scale||1})
          : await this.measureChoiceImage(field.name,renderer,field.group);
        if(generation!==this.textPreparationGeneration||revision!==this.layoutRevision)throw new MseError('layout-stale','Card changed or text layout preparation was superseded');
        this.textMeasurements.set(field.key,{info:field.type==='text'?textLayoutInfo(result.lines):{width:result.width,height:result.height,lines:[]},result});
      };
      // Fields measure one at a time; download every choice image's and text
      // mask's assets together first so a cold frame is not a chain of round
      // trips. styles() above already evaluated these properties.
      if(renderer?.prefetch)for(const field of measuredFields){
        if(initial.get(field.key)===null)continue;
        const image=isChoiceFieldType(field.type)&&(field.layout.programs.has('image')||field.layout.choiceImages.size);
        for(const key of [image?'image':null,field.layout.programs.has('mask')?'mask':null])if(key){
          try{renderer.prefetch(mseImage(this.property(field.name,key,field.group),this.template.name));}catch{/* measured below */}
        }
      }
      for(const field of measuredFields){
        if(initial.get(field.key)===null)continue;
        try{await measure(field);}catch(error){
          // Native draw retries an unprepared viewer after the content-style
          // refresh. Generated image dimensions may be valid only then.
          if(field.type==='text'||error.code!=='image-size')throw error;
        }
      }
      // Preparing text can itself update scripted alignment/direction. Native
      // style updates compare against these current values, not initial ones.
      const beforeRefresh=styles();
      const preparedStyles=new Map(this.layoutValues);
      this.invalidate({keepMeasurements:true});
      this.refreshLayoutDependencies();
      // Styles update in game-field order. References to a later style see
      // its previous values until that style itself has been updated.
      this.layoutValues=preparedStyles;
      const updated=styles(true);
      revision=this.layoutRevision;
      // A style change resets its viewer. Drawing lazily prepares it again,
      // retaining its previous shrink factor. Native MSE does not perform a
      // third style update or seek a fixed point after this preparation.
      const reprepared=[];
      for(const field of measuredFields){
        if(updated.get(field.key)===null)continue;
        if(updated.get(field.key)!==beforeRefresh.get(field.key)||!this.textMeasurements.get(field.key).result){
          await measure(field);reprepared.push(field.key);
        }
      }
      return {passes:2,fields:measuredFields.length,measurements:this.textMeasurements,reprepared,renderingVerified:false};
    } catch (error) {
      // A superseded request must not clear a newer request's measurements.
      if (generation === this.textPreparationGeneration) this.invalidate();
      throw error;
    }
  }
  fieldVisible(field,group='card') {
    const layout=(group==='card'?this.template.layouts:this.template.extraLayouts).get(field);
    if(layout.programs.has('visible')&&!boolean(this.property(field,'visible',group)))return false;
    return this.property(field,'width',group)>0 && this.property(field,'height',group)>0
      && Math.abs(this.property(field,'left',group))<100000 && Math.abs(this.property(field,'top',group))<100000;
  }
  async measureChoiceImage(field, renderer, group = 'card') {
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    const get = (key, fallback) => layout.programs.has(key) ? this.property(field,key,group) : fallback;
    const renderStyle = choiceRenderFlags(text(get('render_style','text')));
    const empty = { width: 0, height: 0, lines: [], scale: 1, image: null };
    if (!renderStyle.image || (!layout.programs.has('image') && !layout.choiceImages.size)) return empty;
    const graph = mseImage(this.property(field,'image',group),this.template.name);
    if (graph.operation === 'blank') return empty;
    const bounds = renderStyle.text ? {width:0,height:0} : {
      width:Math.trunc(this.property(field,'width',group)),height:Math.trunc(this.property(field,'height',group)),
    };
    const raster = await renderer.render(graph,bounds);
    const image = conformRaster(raster,{...bounds,stretch:Boolean(parseAlignment(text(get('alignment','stretch')))&16)},renderer.maxPixels);
    return {width:image.width,height:image.height,lines:[],scale:1,image,combine:imageCombineMode(graph)};
  }
  async layoutTaggedText(field, content, fonts, renderer, { group = 'card', previousScale = 1 } = {}) {
    const generation=this.textPreparationGeneration,revision=this.layoutRevision;
    const check=()=>{if(generation!==this.textPreparationGeneration||revision!==this.layoutRevision)throw new MseError('layout-stale','Card changed while preparing text');};
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    const get = (key, fallback) => layout.programs.has(key) ? this.property(field, key, group) : fallback;
    const parsed = parseTaggedText(text(content), this.font(field, group));
    const symbols = await this.symbols(field, '', group);
    const width = this.property(field, 'width', group), height = this.property(field, 'height', group);
    const mask = get('mask', null);
    let rowBounds = null;
    if (mask !== null && mask !== '') {
      const image = mseImage(mask, this.template.name);
      if (image.operation !== 'blank') rowBounds = createTextMask(await renderer.render(image, { width: Math.ceil(width), height: Math.ceil(height) }), width, height);
    }
    const scripted=['alignment','direction'].filter(key=>layout.programs.has(key)&&layout.programs.get(key).type!=='literal');
    const publish=(lines,result)=>{
      check();this.textMeasurements ||= new Map();
      const key=`${group}.${field}`,previous=this.textMeasurements.get(key);
      this.textMeasurements.set(key,{info:textLayoutInfo(lines),result:result??previous?.result??null});
    };
    // Native TextViewer publishes the current lines before refreshing these
    // two scripts on each vertical-offset pass; other styles stay frozen.
    const refreshLayoutStyle=scripted.length?lines=>{
      publish(lines);
      for(const key of scripted)this.layoutValues.delete(`${group}_style.${field}.${key}`);
      return {alignment:parseAlignment(text(get('alignment','left top'))),vertical:['top to bottom','vertical'].includes(get('direction',''))};
    }:undefined;
    const result=await layoutTaggedText(parsed, fonts, symbols, renderer, {
      refreshLayoutStyle,
      rowBounds,
      width: this.property(field, 'width', group), height: this.property(field, 'height', group), previousScale,
      multiLine: boolean(this.cells[group].get(field)?.definition?.record.text('multi line') || false),
      alwaysSymbol: boolean(get('always_symbol', false)), alignment: parseAlignment(text(get('alignment', 'left top'))),
      vertical: ['top to bottom', 'vertical'].includes(get('direction', '')),
      paragraphHeight: get('paragraph_height', -1),
      ...Object.fromEntries(['paddingLeft','paddingRight','paddingTop','paddingBottom','lineHeightSoft','lineHeightHard','lineHeightLine','lineHeightSoftMax','lineHeightHardMax','lineHeightLineMax'].map(name => [name, get(name.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), name.startsWith('lineHeight') && !name.endsWith('Max') ? 1 : 0)])),
    });
    publish(result.lines,result);
    return result;
  }
  async measureTaggedText(field, content, fonts, renderer, { group = 'card', scale = 1 } = {}) {
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    const parsed = parseTaggedText(text(content), this.font(field, group));
    const symbols = await this.symbols(field, '', group);
    const alwaysSymbol = layout.programs.has('always_symbol') && boolean(this.property(field, 'always_symbol', group));
    return measureTaggedText(parsed, fonts, symbols, renderer, { scale, alwaysSymbol });
  }
  fitTextRun(field, content, metrics, { group = 'card', previousScale = 1, ...options } = {}) {
    const font = this.font(field, group);
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    const result = selectTextScale(scale => this.wrapTextRun(field, content, metrics, { ...options, group, scale }), {
      minScale: Math.min(font.size, font.scale_down_to) / Math.max(0.01, font.size),
      scaleStep: 1 / Math.max(font.size * 4, 1), previousScale,
      height: this.property(field, 'height', group),
      paddingBottom: layout.programs.has('padding_bottom') ? this.property(field, 'padding_bottom', group) : 0,
    });
    return { ...this.alignTextRun(field, content, metrics, { ...options, group, scale: result.scale }), scale: result.scale };
  }
  alignTextRun(field, content, metrics, { group = 'card', ...options } = {}) {
    const measured = this.measureTextRun(field, content, metrics, { group, ...options });
    const wrapped = this.wrapTextRun(field, content, metrics, { group, ...options });
    if (!wrapped.lines.length) return wrapped;
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    const get = (key, fallback) => layout.programs.has(key) ? this.property(field, key, group) : fallback;
    const left = get('padding_left', 0), right = get('padding_right', 0);
    const width = this.property(field, 'width', group);
    const multiLine = options.multiLine ?? boolean(this.cells[group].get(field)?.definition?.record.text('multi line') || false);
    const lines = alignTextLines(wrapped.lines, measured.characters, {
      alignment: parseAlignment(text(get('alignment', 'left top'))), multiLine,
      width: width - left - right, maskLeft: left, maskRight: width - right,
      height: this.property(field, 'height', group) - get('padding_top', 0) - get('padding_bottom', 0),
      y: get('padding_top', 0), paragraphHeight: get('paragraph_height', -1),
      lineHeightSoft: get('line_height_soft', 1), lineHeightHard: get('line_height_hard', 1), lineHeightLine: get('line_height_line', 1),
      lineHeightSoftMax: get('line_height_soft_max', 0), lineHeightHardMax: get('line_height_hard_max', 0), lineHeightLineMax: get('line_height_line_max', 0),
    });
    return { ...wrapped, lines, height: textContentHeight(lines), width: Math.max(0, ...lines.map(line => line.width)) };
  }
  wrapTextRun(field, content, metrics, { group = 'card', ...options } = {}) {
    const measured = this.measureTextRun(field, content, metrics, { group, ...options });
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    const property = (name, fallback) => layout?.programs.has(name) ? this.property(field, name, group) : fallback;
    const definition = this.cells[group].get(field)?.definition?.record;
    return wrapTextCharacters(measured.characters, {
      width: this.property(field, 'width', group), height: this.property(field, 'height', group),
      paddingBottom: property('padding_bottom', 0), paragraphHeight: property('paragraph_height', -1),
      multiLine: boolean(definition?.text('multi line') || false),
      vertical: property('direction', '') === 'top to bottom' || property('direction', '') === 'vertical',
      paddingLeft: property('padding_left', 0), paddingRight: property('padding_right', 0), paddingTop: property('padding_top', 0),
      lineHeightSoft: property('line_height_soft', 1), lineHeightHard: property('line_height_hard', 1), lineHeightLine: property('line_height_line', 1),
      ...options,
    });
  }
  measureTextRun(field, content, metrics, { group = 'card', ...options } = {}) {
    return measureTextRun(text(content), this.font(field, group), metrics, options);
  }
  async measureSymbols(field, source, renderer, { group = 'card', scale = 1 } = {}) {
    return measureSymbolRun(await this.symbols(field, source, group), renderer, { scale });
  }
  async symbols(field, source, group = 'card') {
    const settings = this.font(field, group, true);
    const definition = await loadSymbolFont(this.template.store, settings.name);
    const scope = new MseScope(this.runtime.scope);
    scope.set('value', this.field(group, field));
    const font = evaluateSymbolFont(definition, this.runtime, scope);
    return { settings, font, symbols: splitSymbols(font, text(source)) };
  }
  font(field, group = 'card', symbol = false) {
    const key = `${group}_${symbol ? 'symbol_font' : 'font'}.${field}`;
    if (this.layoutValues.has(key)) return this.layoutValues.get(key);
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    if (!layout) return missingMember(key);
    if (this.reading.includes(key)) throw new MseError('layout-cycle', `Circular font definition ${key}`);
    this.reading.push(key);
    try {
      const scope = new MseScope(this.runtime.scope);
      scope.set('value', this.field(group, field));
      const font = evaluateFontDefinition(symbol ? layout.symbolFont : layout.font, program => force(this.runtime.evaluate(program, scope)));
      this.layoutValues.set(key, font);
      return font;
    } finally { this.reading.pop(); }
  }
  refreshLayoutDependencies(){
    if(!this.fieldUpdates||!this.observedLayoutProperties.size)return;
    const changed=[];
    for(const observed of this.observedLayoutProperties.values()){
      const snapshot=JSON.stringify(this.propertyValue(observed.field,observed.name,observed.group));
      if(snapshot!==observed.snapshot){observed.snapshot=snapshot;changed.push(observed);}
    }
    if(changed.length)this.fieldUpdates.changeMany(changed);
  }
  property(field,name,group='card'){
    const value=this.propertyValue(field,name,group);
    if(this.fieldUpdates?.active){
      const key=`${group}.${field}.${name}`;
      let observed=this.observedLayoutProperties.get(key);
      if(!observed){
        observed={field,name,group,snapshot:JSON.stringify(value)};
        this.observedLayoutProperties.set(key,observed);
        this.fieldUpdates.register(observed,()=>false);
      }
      this.fieldUpdates.read(observed);
    }
    return value;
  }
  propertyValue(field, name, group = 'card') {
    if (['content_width','content_height','content_lines','layout'].includes(name)) {
      const measured = this.textMeasurements?.get(`${group}.${field}`);
      if (measured) return name === 'layout' ? fromHost(measured.info) : name === 'content_lines' ? measured.info.lines.length : measured.info[name.slice(8)];
      const layouts=group==='card'?this.template.layouts:this.template.extraLayouts;
      if(layouts.has(field))return name==='layout'?fromHost(dummyTextLayout()):0;
    }
    if (!geometryNames.has(name)) return this.rawProperty(field, name, group);
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    if (!layout) return missingMember(`${group}_style.${field}.${name}`);
    const key = `${group}_geometry.${field}.${name}`;
    if (this.layoutValues.has(key)) return this.layoutValues.get(key);
    if (this.reading.includes(key)) throw new MseError('layout-cycle', `Circular geometry property ${key}`);
    this.reading.push(key);
    try {
      const result = geometryValue(name, key => layout.programs.has(key) ? this.rawProperty(field, key, group) : geometryDefaults[key], layout.geometry);
      this.layoutValues.set(key, result);
      return result;
    } finally { this.reading.pop(); }
  }
  rawProperty(field, name, group = 'card') {
    const key = `${group}_style.${field}.${name}`;
    if (this.layoutValues.has(key)) return this.layoutValues.get(key);
    const layout = (group === 'card' ? this.template.layouts : this.template.extraLayouts).get(field);
    let program = layout?.programs.get(name);
    if (!program && name === 'image' && layout?.choiceImages.size) {
      program = layout.choiceImages.get(canonicalName(text(this.field(group, field))));
      if (!program) return null;
    }
    if (!program) return missingMember(key);
    if (this.reading.includes(key)) throw new MseError('layout-cycle', `Circular layout property ${key}`);
    this.reading.push(key);
    try {
      const scope = new MseScope(this.runtime.scope);
      scope.set('value', this.field(group, field));
      if (name === 'image' && isChoiceFieldType(this.cells[group].get(field)?.definition?.record.text('type'))) scope.set('input', force(this.field(group, field)));
      let result = force(this.runtime.evaluate(program, scope));
      if (numericStyleProperties.has(name)) result = number(result);
      this.layoutValues.set(key, result);
      return result;
    } finally { this.reading.pop(); }
  }
  layout({ visibleOnly = false } = {}) {
    const fields = [];
    for (const [group, layouts] of [['card', this.template.layouts], ['extra_card', this.template.extraLayouts]]) for (const [name, layout] of layouts) {
      // Rendering must not evaluate images/fonts belonging to inactive styles.
      // The full layout remains available for explicit diagnostic audits.
      if (visibleOnly && !this.fieldVisible(name, group)) continue;
      const properties = Object.create(null);
      for (const key of new Set([...layout.programs.keys(), ...geometryNames])) properties[key] = this.property(name, key, group);
      if (layout.record.last('font')) properties.font = this.font(name, group);
      if (layout.record.last('symbol font')) properties.symbol_font = this.font(name, group, true);
      fields.push({ name, group, value: this.field(group, name), properties, record: layout.record });
    }
    return {
      width: Number(this.template.style.text('card width')),
      height: Number(this.template.style.text('card height')),
      fields: fields.sort((a, b) => number(a.properties.z_index ?? 0) - number(b.properties.z_index ?? 0)),
    };
  }
}

// Construct every card before initialization so UID lookups and set.cards see
// the complete set, including cards using another stylesheet of the same game.
export class MseTemplateSet {
  constructor(template, { cards = [], set = {}, styling = {}, builtins = {}, spellcheck, fieldUpdateMode = 'lazy' } = {}) {
    this.registry = new MseCardRegistry();
    this.contexts = cards.map(entry => new MseTemplateContext(entry.template || template, { card: entry.card || {}, extraCard: entry.extraCard || {}, uid: entry.uid, set, styling: entry.styling || styling, builtins, spellcheck, fieldUpdateMode, cardRegistry: this.registry }));
  }
  initialize() {
    for(const context of this.contexts)context.initializeScripts();
    for(const context of this.contexts)context.initialize();
    return this;
  }
}
