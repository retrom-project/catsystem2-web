// SPDX-License-Identifier: MPL-2.0
// One row is expanded/evaluated once, then dispatched to its actual typed
// targets. Missing columns preserve state; recognized inapplicable columns
// retain their established per-type no-op behavior.
import { encodeCP932 } from '../kcs/strings.mjs';
import { parseNativeIntegerPrefix } from './standard.mjs';
import {
  fesObjectFamily,
  markFESObjectDirty,
  setFESEnabled,
  setFESRawGraphicalDisplay,
  setFESGraphicalPriority,
  setFESGraphicalPosition,
  setFESGraphicalSize,
  setFESImagePlane,
} from './fes-common-model.mjs';
import { setFESImageID, setFESImageTable } from './fes-image-model.mjs';
import {
  setFESControlFile,
  setFESControlOrigin,
  setFESControlPriority,
  setFESControlPlanePriority,
  setFESControlDisplay,
  setFESControlVRAM,
  setFESControlType,
} from './fes-control-model.mjs';

const decoder = new TextDecoder('shift_jis'),
  columns = new Map([
    ['FILE', 0],
    ['IDN', 1],
    ['ID', 2],
    ['POS', 34],
    ['PL', 35],
    ['BLEND', 36],
    ['PARENT', 37],
    ['BASE', 38],
    ['SIZE', 39],
    ['VRAM', 40],
    ['PRI', 41],
    ['PRI_P', 42],
    ['DISP', 43],
    ['ENABLE', 44],
    ['DEFAULT', 45],
    ['COLOR', 46],
    ['STYPE', 47],
    ['CHANNEL', 48],
    ['KEY_U', 49],
    ['KEY_D', 50],
    ['KEY_L', 51],
    ['KEY_R', 52],
    ['POS2', 53],
    ['SIZE2', 54],
    ['TYPE', 55],
    ['KEYBLOCK', 56],
    ['TABLE', 57],
    ['GROUP', 58],
    ['SYSKEY', 59],
    ['MASK', 60],
    ['COUNT', 61],
    ['BTYPE', 62],
    ['DIV', 63],
    ['EXPOS', 64],
    ['PATHMODE', 65],
  ]),
  fieldNames = new Map(
    [...columns].filter(([name]) => name !== 'ID').map(([name, code]) => [code, name]),
  );
function bytes(value) {
  const source = value instanceof Uint8Array ? value : encodeCP932(String(value)),
    end = source.indexOf(0);
  return end < 0 ? source : source.subarray(0, end);
}
const string = (value) => decoder.decode(bytes(value));
function expand(value, operation) {
  return bytes(operation ? operation(value) : value);
}
function diagnostic(report, message) {
  if (typeof report !== 'function') throw new Error(message);
  report(message);
}
export function compileFESDefinitionColumns(source, { expandToken, report } = {}) {
  const result = [];
  for (const token of source) {
    if (result.length === 66) {
      diagnostic(report, 'FES definition has more than66 columns');
      break;
    }
    const name = string(expand(token, expandToken)),
      dot = name.indexOf('.'),
      base = dot < 0 ? name : name.slice(0, dot),
      suffix = dot < 0 ? '' : name.slice(dot + 1);
    let offset = 0;
    if (/^[0-9]/.test(suffix)) offset = parseNativeIntegerPrefix(suffix)?.value ?? 0;
    else if (['N', 'D', 'F', 'P'].includes(suffix)) offset = ['N', 'D', 'F', 'P'].indexOf(suffix);
    if (!columns.has(base)) {
      diagnostic(report, `Unknown FES definition column ${name}`);
      continue;
    }
    result.push((columns.get(base) + offset) | 0);
  }
  return result;
}
export function fesDefinitionTuple(value, index, evaluate) {
  if (typeof evaluate !== 'function') throw new Error('FES definition numeric context is missing');
  const source = bytes(value);
  let start = 0;
  for (let at = 0; at < index; at++) {
    const comma = source.indexOf(44, start);
    if (comma < 0) return undefined;
    start = comma + 1;
  }
  const comma = source.indexOf(44, start),
    component = source.subarray(start, comma < 0 ? source.length : comma);
  if (component.length >= 512)
    throw new RangeError('FES definition numeric component exceeds its512-byte destination');
  return evaluate(decoder.decode(component)) | 0;
}

// This deliberately follows the original byte scanner: space or '[' ends the
// name; space or ']' ends the index expression. It is not a Unicode regexp.
export function parseFESObjectReference(token, { evaluate, count, expandName } = {}) {
  if (typeof evaluate !== 'function' || typeof count !== 'function')
    throw new Error('FES object reference requires expression and collection services');
  const source = bytes(token);
  let end = 0;
  while (end < source.length && source[end] !== 32 && source[end] !== 91) end++;
  let expression = '-1';
  if (source[end] === 91) {
    let close = end + 1;
    while (close < source.length && source[close] !== 32 && source[close] !== 93) close++;
    if (source[close] !== 93) throw new Error('FES object reference has no closing bracket');
    if (close === end + 1) throw new Error('FES empty object index has no defined original value');
    if (close - end > 511) throw new RangeError('FES object index exceeds its512-byte destination');
    expression = decoder.decode(source.subarray(end + 1, close));
  }
  const nameBytes = expand(source.subarray(0, end), expandName);
  if (!nameBytes.length) throw new Error('FES object reference name is empty');
  let index = evaluate(expression) | 0;
  if (index === -1 && count(nameBytes) <= 1) index = 0;
  return { name: decoder.decode(nameBytes), nameBytes: nameBytes.slice(), index };
}

// POS2/SIZE2 definitions first pass through the object-reference reader. The
// resulting bracket index is discarded by the resource setter, which parses
// the first colon and an integer prefix instead of evaluating that suffix.
export function fesDefinitionResourceReference(reference) {
  const source = bytes(reference.nameBytes ?? reference.name),
    colon = source.indexOf(58),
    nameBytes = source.subarray(0, colon < 0 ? source.length : colon).slice(),
    index =
      colon < 0
        ? 0
        : (parseNativeIntegerPrefix(decoder.decode(source.subarray(colon + 1)))?.value ?? 0);
  return { name: decoder.decode(nameBytes), nameBytes, index };
}

export function readFESDefinitionRecord(
  compiled,
  values,
  { evaluate, reference, expandToken, targetIndex = 0 } = {},
) {
  if (typeof evaluate !== 'function' || typeof reference !== 'function')
    throw new Error('FES definition row requires expression and reference services');
  const record = { fields: new Map(), ids: new Map(), relativePriority: false },
    { fields, ids } = record;
  for (let at = 0; at < compiled.length; at++) {
    if (values[at] === undefined) break;
    const code = compiled[at],
      source = expand(values[at], expandToken),
      number = (component = 0) => fesDefinitionTuple(source, component, evaluate);
    if (code >= 2 && code <= 33) {
      ids.set(code - 2, number());
      continue;
    }
    const field = fieldNames.get(code);
    if (field === undefined) continue; // Explicit header-code default branch.
    if (['FILE', 'DEFAULT', 'TABLE', 'GROUP'].includes(field)) {
      fields.set(field, string(source));
      if (field === 'FILE') record.fileBytes = new Uint8Array(source);
    } else if (
      ['PL', 'PARENT', 'KEY_U', 'KEY_D', 'KEY_L', 'KEY_R', 'POS2', 'SIZE2'].includes(field)
    ) {
      let value = reference(source);
      if (field.startsWith('KEY_') && value.name === '0')
        value = { name: '', nameBytes: new Uint8Array(), index: 0 };
      fields.set(field, value);
    } else if (['POS', 'BASE', 'SIZE', 'VRAM', 'KEYBLOCK'].includes(field)) {
      const length = ['POS', 'BASE', 'KEYBLOCK'].includes(field) ? 3 : 2,
        result = [];
      for (let index = 0; index < length; index++) {
        const value = number(index);
        if (value === undefined) break;
        result.push(value);
      }
      if (result.length) fields.set(field, result);
    } else {
      fields.set(field, number());
      if (field === 'PRI' && targetIndex === -1) record.relativePriority = true;
    }
  }
  return record;
}
function vector(instance, object, keys, values) {
  if (keys.every((key, index) => object[key] === values[index])) return;
  for (let index = 0; index < keys.length; index++) object[keys[index]] = values[index];
  markFESObjectDirty(instance, object);
}
function resource(instance, object, field, reference, dirty) {
  object[field] = fesDefinitionResourceReference(reference);
  object[dirty] = true;
  if (dirty === 'positionPending') markFESObjectDirty(instance, object);
}
const noSpecificDefinition = new Set([0, 7, 8, 23, 26, 27, 30, 31, 32, 35]);
export class FESDefinitionModel {
  constructor(
    instance,
    {
      collection,
      expandToken,
      expandName,
      report,
      setImageFile,
      loadImageTable,
      applySpecial,
    } = {},
  ) {
    if (!instance?.value || !collection?.lookup || !collection?.count || !collection?.graph)
      throw new TypeError('FES definitions require their instance and JavaScript collection');
    Object.assign(this, {
      instance,
      collection,
      expandToken,
      expandName,
      report,
      setImageFile,
      loadImageTable,
      applySpecial,
    });
  }
  reference(token) {
    return parseFESObjectReference(token, {
      evaluate: (source) => this.instance.value(source),
      count: (name) => this.collection.count(name),
      expandName: this.expandName,
    });
  }
  compile(columns) {
    return compileFESDefinitionColumns(columns, this);
  }
  readCompiled(compiled, values, targetIndex = 0) {
    return readFESDefinitionRecord(compiled, values, {
      evaluate: (source) => this.instance.value(source),
      reference: (source) => this.reference(source),
      expandToken: this.expandToken,
      targetIndex,
    });
  }
  read(columns, values, targetIndex = 0) {
    return this.readCompiled(this.compile(columns), values, targetIndex);
  }
  row(columns, target, values) {
    return this.rowCompiled(this.compile(columns), target, values);
  }
  async rowCompiled(compiled, target, values) {
    const selection = this.reference(expand(target, this.expandToken)),
      record = this.readCompiled(compiled, values, selection.index),
      start = selection.index === -1 ? 0 : selection.index,
      end = selection.index === -1 ? this.collection.count(selection.nameBytes) : start + 1;
    let applied = false;
    for (let index = start; index < end; index++) {
      const object = this.collection.lookup(selection.nameBytes, index);
      if (!object) {
        diagnostic(this.report, `FES definition target ${selection.name}[${index}] is missing`);
        continue;
      }
      if (record.fields.size || record.ids.size) {
        await this.apply(object, record, index);
        applied = true;
      }
    }
    return applied;
  }
  async apply(object, record, index = object.index ?? 0) {
    const { fields: f, ids } = record,
      { instance, collection } = this,
      has = (field) => f.has(field),
      get = (field) => f.get(field),
      priority = () => ((get('PRI') | 0) + (record.relativePriority ? index : 0)) | 0,
      type = object.nativeType;
    if (has('PARENT')) {
      const ref = get('PARENT');
      collection.graph.bind(object, collection.lookup(ref.nameBytes ?? ref.name, ref.index));
    }
    if (noSpecificDefinition.has(type)) return;
    if (fesObjectFamily(object) === 'image') {
      if (type >= 16 && type <= 20 && has('TABLE')) {
        object.tableFile = get('TABLE');
        object.tablePending = true;
        if (typeof this.loadImageTable !== 'function')
          throw new Error('FES definition TABLE requires its immediate JavaScript table loader');
        // The owner performs the real load before FILE, including before a
        // following START command can query max or select an image.
        await this.loadImageTable(instance, object, get('TABLE'));
      }
      if (type !== 1 && has('FILE')) {
        if (typeof this.setImageFile !== 'function')
          throw new Error('FES definition FILE requires its pure image setter');
        this.setImageFile(object, get('FILE'), record.fileBytes);
      }
      if (has('POS') && (get('POS')[0] !== undefined || get('POS')[1] !== undefined))
        setFESGraphicalPosition(instance, object, get('POS'));
      if (has('POS2'))
        resource(instance, object, 'positionReference', get('POS2'), 'positionPending');
      if (has('SIZE2')) resource(instance, object, 'sizeReference', get('SIZE2'), 'sizePending');
      if (has('PL')) {
        const ref = get('PL');
        setFESImagePlane(instance, object, ref.name, ref.index);
        object.planeReference.nameBytes = ref.nameBytes?.slice();
      }
      if (type === 1 && has('COLOR')) {
        object.color = get('COLOR') >>> 0;
        object.sizeDirty = true;
      }
      if (has('BLEND') && object.alpha !== get('BLEND') >>> 0) {
        object.alpha = get('BLEND') >>> 0;
        markFESObjectDirty(instance, object);
      }
      if (type !== 1 && type !== 25 && has('IDN')) setFESImageID(object, get('IDN'));
      if (has('PRI')) setFESGraphicalPriority(instance, object, priority(), true);
      if (has('DISP')) setFESRawGraphicalDisplay(instance, object, get('DISP'));
      if (has('MASK')) object.mask = get('MASK') >>> 0;
      if (type !== 1 && type !== 25 && ids.size)
        for (const [slot, value] of ids) setFESImageTable(object, slot, value);
      if (type !== 25 && has('BTYPE')) object.baseHandlingMode = get('BTYPE') | 0;
      if (type !== 1 && type !== 25 && has('PATHMODE')) object.pathMode = get('PATHMODE') | 0;
      if ((type === 1 || type === 6) && has('SIZE')) {
        const size = get('SIZE');
        setFESGraphicalSize(object, size[0], size[1] ?? 0);
      }
      if (type === 6) {
        if (has('ENABLE')) setFESEnabled(object, get('ENABLE'));
        if (has('DEFAULT')) object.defaultHandler = get('DEFAULT');
        for (let slot = 0; slot < 4; slot++)
          if (has(['KEY_U', 'KEY_D', 'KEY_L', 'KEY_R'][slot])) {
            object.keyReferences ??= [null, null, null, null];
            object.keyReferences[slot] = structuredClone(
              get(['KEY_U', 'KEY_D', 'KEY_L', 'KEY_R'][slot]),
            );
          }
        if (has('TYPE')) object.buttonType = get('TYPE') | 0;
        if (has('KEYBLOCK')) {
          const value = get('KEYBLOCK');
          object.keyblock = { block: value[0], x: value[1] ?? 0, y: value[2] ?? 0 };
        }
        if (has('SYSKEY')) object.systemKey = get('SYSKEY') | 0;
      }
      return;
    }
    if (type === 33 && (await this.applySpecial?.(object, record, index)) !== true)
      throw new Error('FES M2 definition requires its JavaScript family applier');
    if (type === 3 || type === 4 || type === 33) {
      if (has('POS') && (get('POS')[0] !== undefined || get('POS')[1] !== undefined)) {
        const value = get('POS');
        vector(
          instance,
          object,
          ['x', 'y', 'z', 'positionW'],
          [
            value[0] === undefined ? object.x : Math.fround(value[0]),
            value[1] === undefined ? object.y : Math.fround(value[1]),
            value[2] === undefined ? object.z : Math.fround(value[2]),
            object.positionW,
          ],
        );
      }
      if (has('BASE')) {
        const value = get('BASE');
        vector(
          instance,
          object,
          ['baseX', 'baseY', 'baseZ', 'baseW'],
          [Math.fround(value[0]), Math.fround(value[1] ?? 0), Math.fround(value[2] ?? 0), 0],
        );
      }
      if (has('SIZE')) {
        const value = get('SIZE');
        if (type === 33) {
          object.width = value[0] | 0;
          object.height = (value[1] ?? 0) | 0;
          object.sizeDirty = true;
        } else setFESGraphicalSize(object, value[0], value[1] ?? 0);
      }
      if (has('POS2'))
        resource(instance, object, 'positionReference', get('POS2'), 'positionPending');
      if (has('SIZE2')) {
        resource(instance, object, 'sizeReference', get('SIZE2'), 'sizePending');
        object.sizeDirty = true;
      }
      if (type === 4 && has('VRAM')) {
        const value = get('VRAM');
        vector(
          instance,
          object,
          ['vramX', 'vramY', 'vramZ', 'vramW'],
          [Math.fround(value[0]), Math.fround(value[1] ?? 0), 0, 0],
        );
      }
      if (has('PRI')) setFESGraphicalPriority(instance, object, priority());
      if (has('DISP')) setFESRawGraphicalDisplay(instance, object, get('DISP'));
      if (has('COLOR')) {
        object.color = get('COLOR') >>> 0;
        object.alpha = object.color >>> 24;
        markFESObjectDirty(instance, object);
      }
      if (has('BLEND')) {
        object.color = ((get('BLEND') << 24) | (object.color & 0xffffff)) >>> 0;
        object.alpha = object.color >>> 24;
        markFESObjectDirty(instance, object);
      }
      if (has('TYPE')) object.planeType = get('TYPE') === 2 ? 2 : 1;
      if (has('EXPOS')) object.planeProperty = get('EXPOS') | 0;
      return;
    }
    if (type >= 13 && type <= 15) {
      if (has('FILE')) setFESControlFile(object, get('FILE'));
      if (type === 13 && has('POS')) {
        const value = get('POS');
        setFESControlOrigin(instance, object, value[0] ?? object.x, value[1] ?? object.y);
      }
      if (type !== 13 && has('PL')) object.planeReference = structuredClone(get('PL'));
      if (has('POS2')) {
        object.positionReference = fesDefinitionResourceReference(get('POS2'));
        object.positionPending = true;
      }
      if (has('PRI'))
        setFESControlPriority(
          object,
          type === 13 ? priority() : ((get('PRI') | 0) + (record.relativePriority ? 0 : index)) | 0,
        );
      if (type === 13 && has('PRI_P'))
        setFESControlPlanePriority(
          object,
          ((get('PRI_P') | 0) + (record.relativePriority ? index : 0)) | 0,
        );
      if (has('DISP')) setFESControlDisplay(instance, object, get('DISP'));
      if (type === 13 && has('VRAM')) {
        const value = get('VRAM');
        setFESControlVRAM(instance, object, value[0], value[1] ?? 0);
      }
      if (type === 13 && has('TYPE')) setFESControlType(object, get('TYPE'));
      if (has('ENABLE')) setFESEnabled(object, get('ENABLE'));
      return;
    }
    if (
      typeof this.applySpecial !== 'function' ||
      (await this.applySpecial(object, record, index)) !== true
    )
      throw new Error(`FES raw${type} definition requires its JavaScript family applier`);
  }
}
