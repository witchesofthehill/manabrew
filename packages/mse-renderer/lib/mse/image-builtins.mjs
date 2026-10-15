import { MseImage, MseFieldValue, force, number, text, boolean, conversion } from './script-values.mjs';
import { MseError } from './document.mjs';
import { combineChannel } from './image-combine.mjs';
import { color } from './color-values.mjs';
import { resolveMsePath } from './packages.mjs';

export function mseImage(value, owner) {
  value = force(value);
  if (value instanceof MseImage) return value;
  if (value === null || value === '') return new MseImage('blank');
  if (typeof value === 'string' && /^(?:https?:|blob:|data:image\/)/i.test(value)) return new MseImage('artwork', { source: value });
  if (typeof value === 'string') return new MseImage('asset', { path: resolveMsePath(value, owner) });
  return conversion(value, 'image');
}

export function imageBuiltins(owner) {
  const input = scope => mseImage(scope.get('input'), owner);
  const image = (scope, key) => mseImage(scope.get(key), owner);
  const builtins = {
    to_image: input,
    add_bleed_edge: scope=>new MseImage('bleed',{
      image:input(scope),
      horizontal:scope.has('horizontal_size')?number(scope.get('horizontal_size')):-1,
      vertical:scope.has('vertical_size')?number(scope.get('vertical_size')):-1,
      background:color(scope.has('background_color')?scope.get('background_color'):null).channels,
    }),
    nine_slice_image: scope => new MseImage('nine-slice', {
      image: input(scope), width: number(scope.get('width'),true), height: number(scope.get('height'),true),
      ...Object.fromEntries(['left','right','top','bottom'].map(key=>[key,scope.has(key)?number(scope.get(key),true):0])),
    }),
    symbol_variation: scope => {
      const value = scope.get('symbol'), reference = value instanceof MseFieldValue ? value.reference : null;
      if (reference && reference.cell.definition?.record.text('type') !== 'symbol') return conversion(value,'symbol');
      const filename = text(force(value) ?? '');
      let variation;
      if (reference && scope.has('variation') && force(scope.get('variation')) !== null) {
        const name = text(scope.get('variation'));
        variation = reference.context.template.symbolVariations.get(reference.name)?.get(name);
        if (!variation) throw new MseError('symbol-variation', `Variation of symbol not found ('${name}')`);
      } else {
        const type = scope.has('fill_type') ? text(scope.get('fill_type')) || 'solid' : 'solid';
        if (!['solid','linear gradient','radial gradient'].includes(type)) throw new MseError('symbol-fill', `Unknown fill type for symbol_variation: ${type}`);
        variation = { type, borderRadius: number(scope.get('border_radius')) };
        for (const key of type === 'solid' ? ['fill_color','border_color'] : ['fill_color_1','fill_color_2','border_color_1','border_color_2']) variation[key] = color(scope.get(key)).channels;
        if (type === 'linear gradient') for (const key of ['center_x','center_y','end_x','end_y']) variation[key] = number(scope.get(key));
      }
      return new MseImage('symbol', {
        filename, local: Boolean(reference), path: !reference && filename ? resolveMsePath(filename,owner) : null,
        field: reference ? `${reference.group}.${reference.name}` : null,
        age: reference?.cell.lastUpdate || 0, variation,
      });
    },
    enlarge: scope => new MseImage('enlarge', { image: input(scope), border: number(scope.get('border_size')) }),
    drop_shadow: scope => new MseImage('drop-shadow', {
      image: input(scope),
      ...Object.fromEntries([['offsetX','offset_x'],['offsetY','offset_y'],['alpha','alpha'],['blur','blur_radius']]
        .map(([key,name]) => [key, scope.has(name) && force(scope.get(name)) !== null ? number(scope.get(name)) : 0])),
      color: color(scope.has('color') ? scope.get('color') : null).channels,
    }),
    add_stroke_effect: scope => new MseImage('stroke', {
      image: input(scope), color: color(scope.get('color')).channels,
      radius: number(scope.get('radius'), true),
      blur: scope.has('blur') ? number(scope.get('blur'), true) : 0,
      includeImage: scope.has('include_image') ? boolean(scope.get('include_image')) : true,
    }),
    insert_image: scope => new MseImage('insert', {
      image: image(scope, 'base_image'), inserted: image(scope, 'inserted_image'),
      offsetX: number(scope.get('offset_x'), true), offsetY: number(scope.get('offset_y'), true),
      widen: scope.has('widen') ? boolean(scope.get('widen')) : true,
      background: color(scope.has('background_color') ? scope.get('background_color') : null).channels,
    }),
    set_combine: scope => {
      const mode=text(scope.get('combine'));
      if(mode!=='default')combineChannel(mode);
      return new MseImage('set-combine',{image:input(scope),mode});
    },
    combine_blend: scope => {
      const mode = text(scope.get('combine'));
      combineChannel(mode);
      return new MseImage('combine', { image1: image(scope, 'image1'), image2: image(scope, 'image2'), mode });
    },
    resize_image: scope => new MseImage('resize', { image: input(scope), width: number(scope.get('width'), true), height: number(scope.get('height'), true) }),
    crop: scope => new MseImage('crop', { image: input(scope), width: number(scope.get('width'), true), height: number(scope.get('height'), true), offsetX: number(scope.get('offset_x')), offsetY: number(scope.get('offset_y')), background: color(scope.has('background_color') ? scope.get('background_color') : null).channels }),
    recolor_image: scope => {
      const parameters = { image: input(scope) };
      if (scope.has('red')) {
        for (const name of ['red', 'green', 'blue']) parameters[name] = color(scope.get(name)).channels;
        parameters.white = color(scope.has('white') ? scope.get('white') : 'white').channels;
      } else parameters.color = color(scope.get('color')).channels;
      return new MseImage('recolor', parameters);
    },
    fill_image: scope => new MseImage('fill', { image: input(scope), color: color(scope.get('color')).channels }),
    brighten_image: scope => new MseImage('brighten', { image: input(scope), amount: number(scope.get('amount')) }),
    saturate: scope => new MseImage('saturate', { image: input(scope), amount: number(scope.get('amount')) }),
    invert_image: scope => new MseImage('invert', { image: input(scope) }),
    visibility_mask: scope => new MseImage('visibility-mask', { image: input(scope), threshold: scope.has('threshold') ? number(scope.get('threshold'),true) : 254, radius: scope.has('radius') ? number(scope.get('radius'),true) : 1 }),
    set_alpha: scope => new MseImage('alpha', { image: input(scope), alpha: number(scope.get('alpha')) }),
    set_mask: scope => new MseImage('mask', { image: image(scope, 'image'), mask: image(scope, 'mask') }),
    flip_horizontal: scope => new MseImage('flip-horizontal', { image: input(scope) }),
    flip_vertical: scope => new MseImage('flip-vertical', { image: input(scope) }),
    flip_image: scope => new MseImage(boolean(scope.get('horizontal')) ? 'flip-horizontal' : 'flip-vertical', { image: input(scope) }),
    masked_blend: scope => new MseImage('masked-blend', { light: image(scope, 'light'), dark: image(scope, 'dark'), mask: image(scope, 'mask') }),
    linear_blend: scope => new MseImage('linear-blend', { image1: image(scope, 'image1'), image2: image(scope, 'image2'), ...Object.fromEntries(['x1', 'y1', 'x2', 'y2'].map(key => [key, number(scope.get(key))])) }),
  };
  builtins.saturate_image = builtins.saturate;
  builtins.crop_image = builtins.crop;
  builtins.enlarge_image = builtins.enlarge;
  builtins.add_drop_shadow = builtins.drop_shadow;
  return builtins;
}
