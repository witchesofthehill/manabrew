// SliderStyle and SliderValue inherit the native choice implementation.
export const isChoiceFieldType = type => ['choice','boolean','multiple choice','slider'].includes(type);
export function choiceRenderFlags(style='text') {
  const modes={text:1,image:2,both:3,hidden:4,'image hidden':6,checklist:1,'image checklist':2,'both checklist':3,'text list':1,'image list':2,'both list':3};
  const flags=Object.hasOwn(modes,style)?modes[style]:1;
  return {text:Boolean(flags&1),image:Boolean(flags&2),hidden:Boolean(flags&4)};
}

// IDs follow MSE's depth-first choice order. A group with a default name has
// its own selectable value before its children; unnamed groups omit a prefix.
export function choiceDefinitions(record) {
  if (record.text('type') === 'boolean') return ['yes', 'no'].map(name => ({ name, primary: name }));
  const result = [];
  const visit = (entry, prefix = '', primary = null) => {
    const data = entry.record(), name = entry.inline || data.text('name');
    const children = data.all('choice');
    const full = prefix && name ? `${prefix} ${name}` : prefix || name;
    if (!children.length || data.text('default name')) result.push({ name: full, primary: primary ?? name });
    for (const child of children) visit(child, full, primary ?? name);
  };
  if(record.text('type')==='slider'){
    const integer=(key,fallback)=>{const value=Number(record.text(key,String(fallback)));return Number.isFinite(value)?Math.trunc(value):fallback;};
    let minimum=integer('minimum',0),maximum=integer('maximum',100);
    if(maximum<minimum)[minimum,maximum]=[maximum,minimum];
    const increment=Math.max(1,integer('increment',1));
    // SliderField appends its numeric choices, then moves custom numeric
    // choices >= maximum to the end (std::stoi accepts numeric prefixes).
    const tail=[];
    for(const entry of record.all('choice')){
      const name=entry.inline||entry.record().text('name');
      const prefix=String(name).match(/^\s*[+-]?\d+/)?.[0];
      const parsed=prefix===undefined?NaN:Number(prefix);
      if(parsed>=maximum&&parsed<=2147483647&&parsed>=-2147483648)tail.push(entry);
      else visit(entry);
    }
    if((maximum-minimum)/increment>100000)throw new RangeError('MSE slider choice range exceeds resource limit');
    for(let value=minimum;value<maximum;value+=increment)result.push({name:String(value),primary:String(value)});
    result.push({name:String(maximum),primary:String(maximum)});
    for(const entry of tail)visit(entry);
    return result;
  }
  for (const entry of record.all('choice')) visit(entry);
  if (!record.all('choice').length) result.push({ name: record.text('name'), primary: record.text('name') });
  return result;
}

export function normalizeMultipleChoice(value, choices, empty = '') {
  const selected = new Set();
  for (const part of value.split(',')) {
    const token = part.replace(/^ +/, '');
    if (!token) continue;
    // Native MultipleChoiceValue::normalForm matches a prefix, including when
    // one choice name is a prefix of another. Keep definition order here.
    const index = choices.findIndex(choice => token.startsWith(choice.name));
    if (index >= 0) selected.add(index);
  }
  return choices.filter((_, index) => selected.has(index)).map(choice => choice.name).join(', ') || empty;
}
