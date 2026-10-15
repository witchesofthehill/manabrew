import { MseError } from './document.mjs';
import { MseFieldValue, boolean, text } from './script-values.mjs';
import {isChoiceFieldType} from './choice-fields.mjs';

function closeTag(source, start) {
  const openEnd = source.indexOf('>', start);
  if (openEnd < 0) return source.length;
  const family = source.slice(start + 1, openEnd).split('-')[0];
  let depth = 1;
  for (const match of source.slice(openEnd + 1).matchAll(/<\/?([^>]+)>/g)) {
    if (match[1].split('-')[0] !== family) continue;
    depth += match[0][1] === '/' ? -1 : 1;
    if (!depth) return openEnd + 1 + match.index + match[0].length;
  }
  return source.length;
}
function partsOf(source, count) {
  if (source.startsWith('<prefix')) source = source.slice(closeTag(source, 0));
  const suffix = source.lastIndexOf('<suffix');
  if (suffix >= 0 && closeTag(source, suffix) === source.length) source = source.slice(0, suffix);
  const parts = [];
  while (source.includes('<sep')) {
    const at = source.indexOf('<sep');
    parts.push(source.slice(0, at));
    source = source.slice(closeTag(source, at));
  }
  parts.push(source);
  return Array.from({ length: count }, (_, i) => parts[i] || '');
}
function argumentsOf(scope, prefix) {
  const values = [];
  if (scope.has(prefix)) values.push(scope.get(prefix));
  for (let i = 1; scope.has(prefix + i); i++) values.push(scope.get(prefix + i));
  return values;
}

export function editorBuiltins() {
  const combined = scope => {
    const fields = argumentsOf(scope, 'field');
    if (!fields.length) throw new MseError('editor-fields', 'No fields specified for combined_editor');
    for (const field of fields) {
      if (!(field instanceof MseFieldValue) || (field.reference && field.reference.cell.definition?.record.text('type') !== 'text')) throw new MseError('editor-field-type', 'combined_editor requires text fields');
    }
    const separators = argumentsOf(scope, 'separator').map(text);
    if (separators.length < fields.length - 1) throw new MseError('editor-separators', `Expected at least ${fields.length - 1} separators`);
    const value = scope.get('value');
    const parts = partsOf(text(value), fields.length);
    const age = value instanceof MseFieldValue ? value.reference?.cell.lastUpdate || 0 : 0;
    for (let i = 0; i < fields.length; i++) {
      const ref = fields[i].reference;
      if (ref && (ref.cell.lastUpdate || 0) < age) ref.context.setField(ref.group, ref.name, parts[i], { age });
    }
    for (const field of fields) if (field.reference) field.reference.context.field(field.reference.group, field.reference.name);
    const values = fields.map(text), empty = values.map(value => value.replace(/<[^>]*>/g, '').length === 0);
    const hide = scope.has('hide_when_empty') && boolean(scope.get('hide_when_empty'));
    const soft = scope.has('soft_before_empty') && boolean(scope.get('soft_before_empty'));
    const prefix = scope.has('prefix') ? text(scope.get('prefix')) : '';
    const suffix = scope.has('suffix') ? text(scope.get('suffix')) : '';
    let output = values[0], isEmpty = empty[0], lastStart = 0;
    for (let i = 1; i < fields.length; i++) {
      lastStart = output.length;
      if (!(empty[i] && isEmpty && hide)) {
        const tag = empty[i] && soft ? 'sep-soft' : 'sep';
        output += `<${tag}>${separators[i - 1]}</${tag}>`;
        isEmpty = false;
      }
      output += values[i];
    }
    if (!isEmpty || !hide) {
      if (suffix) {
        if (output.startsWith('<sep-soft>', lastStart) && fields.length >= 2) output = output.slice(0, lastStart) + `<sep>${suffix}<soft>${separators.at(fields.length - 2)}</soft></sep>` + output.slice(closeTag(output, lastStart));
        else output += `<suffix>${suffix}</suffix>`;
      }
      if (prefix) output = `<prefix>${prefix}</prefix>` + output;
    }
    return output;
  };
  return {
    combined_editor: combined,
    forward_editor: combined,
    primary_choice: scope => {
      const value = scope.get('input'), definition = value instanceof MseFieldValue ? value.reference?.cell.definition : null;
      if (!definition || !isChoiceFieldType(definition.record.text('type'))) throw new MseError('choice-field-type', 'primary_choice requires a choice field');
      // Pinned native primary_choice ends with SCRIPT_RETURN(_("")); the
      // string-literal pointer selects to_script(bool), producing true when
      // no choice matches. A matched unnamed group still returns a string.
      return definition.choices.find(choice => choice.name === text(value))?.primary ?? true;
    },
  };
}
