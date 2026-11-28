// SPDX-License-Identifier: MPL-2.0
import { initializeFESImage, setFESImageFile } from './fes-image-driver.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

function panel(object) {
  if (![11, 12].includes(object.nativeType) || !object.panel)
    throw new TypeError('PANEL operation requires its initialized typed state');
  return object.panel;
}
export function initializeFESPanelTail(object, directory = null) {
  if (![11, 12].includes(object.nativeType))
    throw new TypeError('PANEL initializer requires raw11/12');
  object.panel = {
    displayIDs: [],
    parts: new Map(),
    ownedBitmaps: new Set(),
    userFontChanged: false,
  };
  if (object.nativeType === 12)
    object.panel.save = {
      definitions: new Map(),
      flags: new Uint32Array(1024),
      directory,
      filename: '',
      entry: 0,
      file: null,
      date: [0, 0, 0, 0, 0, 0],
    };
  return object;
}
export function initializeFESPanel(object, directory = null) {
  initializeFESImage(object);
  return initializeFESPanelTail(object, directory);
}
export function setFESPanelFile(object, name) {
  panel(object);
  setFESImageFile(object, name);
  object.sizeDirty = true;
}
export function setFESPanelDisplayID(object, id, display = true) {
  const state = panel(object),
    value = id | 0,
    at = state.displayIDs.indexOf(value);
  if (display) {
    if (at < 0) {
      state.displayIDs.push(value);
      state.displayIDs.sort((a, b) => a - b);
    }
  } else if (at >= 0) state.displayIDs.splice(at, 1);
  object.imageChanged = true;
}
export function fesPanelPart(object, id, create = false) {
  const state = panel(object),
    key = id | 0;
  let part = state.parts.get(key);
  if (!part && create) {
    part = {
      kind: 0,
      reference: null,
      bitmap: 0,
      ownBitmap: false,
      text: null,
      fontSize: 0,
      color: 0,
      columns: 0,
      number: 0,
      divisor: 0,
      directSelector: 0,
      styles: [0, 0],
      outlineColor: 0,
      userFonts: [],
      maxLines: 0,
      lineSpacing: 0,
      font: '',
      scaledWidth: 0,
      scaledHeight: 0,
      crop: [0, 0, 0, 0],
    };
    state.parts.set(key, part);
  }
  return part ?? null;
}
export function setFESPanelNumber(object, id, value) {
  const state = panel(object),
    key = id | 0;
  if (object.nativeType === 12) {
    const definition = state.save.definitions.get(key);
    if (!definition) return false;
    definition.constant = value | 0;
    object.imageChanged = true;
  }
  const part = fesPanelPart(object, key);
  if (!part) return object.nativeType === 12;
  part.number = value | 0;
  return true;
}
export function fesSavePanelFlag(object, index) {
  const save = panel(object).save;
  if (!save) throw new TypeError('Private flags require a SAVEPANEL');
  return index >>> 0 < 1024 ? save.flags[index >>> 0] >>> 0 : 0;
}
export function setFESPanelUserFont(object, id, specification) {
  const part = fesPanelPart(object, id, true);
  part.userFonts.push(structuredClone(specification));
  // The original user-font list has its own consumed flag, independent of
  // the FILE/part image-change flag. The current composer reads it on reload.
  panel(object).userFontChanged = true;
}

export function readFESPanelSelector(source, evaluate) {
  source = String(source);
  const first = source.search(/[.:]/),
    head = first < 0 ? source : source.slice(0, first);
  const checked = (value) => {
    if (encodeCP932(value).length >= 32)
      throw new RangeError('PANEL selector expression exceeds its original fixed buffer');
    return evaluate(value) | 0;
  };
  if (encodeCP932(head).length >= 32)
    throw new RangeError('PANEL selector prefix exceeds its original fixed buffer');
  let at = first < 0 ? source.length : first,
    index = 0,
    digits = 0,
    dateDigits = -1;
  if (source[at] === '.') {
    const end = source.indexOf(':', ++at),
      token = source.slice(at, end < 0 ? undefined : end);
    index = checked(token);
    at = end < 0 ? source.length : end;
  }
  if (source[at] === ':') digits = dateDigits = checked(source.slice(at + 1));
  const dates = ['DATE_Y', 'DATE_M', 'DATE_D', 'DATE_H', 'DATE_N', 'DATE_S'];
  if (head === 'FLAG') return { selector: 'flag', flag: index, digits, constant: 0 };
  if (dates.includes(head))
    return { selector: dates.indexOf(head), flag: 0, digits: dateDigits, constant: 0 };
  return { selector: 'constant', flag: 0, digits: 0, constant: checked(head) };
}

// Tokens have already crossed the owning FES CP932 expansion boundary. This
// reader reproduces the actual ptype token presence/order before any target is
// changed, including the frozen unused IMAGE/NUM_S/NUM_I arguments.
export function readFESPanelType(tokens, { evaluate, reference }) {
  const [name, id, ...args] = tokens;
  if (typeof evaluate !== 'function' || typeof reference !== 'function')
    throw new TypeError('ptype requires the owning FES evaluator and reference reader');
  const kinds = {
    NORM: 0,
    IMAGE: 1,
    SIMAGE: 1,
    IMAGEOBJ: 2,
    STR: 3,
    SSTR: 3,
    NUM_S: 4,
    NUM_O: 5,
    NUM_O2: 5,
    NUM_I: 6,
  };
  if (!Object.hasOwn(kinds, name) || id === undefined) return null;
  const partID = evaluate(String(id)) | 0;
  const definition = {
    kind: kinds[name],
    selector: 'flag',
    flag: 0,
    digits: 0,
    constant: 0,
    entry: 0,
    reference: null,
    bitmap: 0,
    fontSize: 0,
    color: 0,
    columns: 0,
    styles: [0, 0],
    outlineColor: 0,
    directSelector: Number(name === 'NUM_O2'),
    maxLines: 0,
    lineSpacing: 0,
    font: '',
    scaledWidth: 0,
    scaledHeight: 0,
    crop: [0, 0, 0, 0],
  };
  const number = (index) => evaluate(String(args[index])) | 0;
  if (name === 'SIMAGE') {
    if (args[0] === undefined) return null;
    definition.entry = number(0);
    definition.selector = 'image-entry';
    if (args[1] !== undefined) {
      definition.kind = 7;
      definition.selector = 'scaled-image-entry';
      definition.scaledWidth = number(1);
      definition.scaledHeight = args[2] === undefined ? 0 : number(2);
      for (let at = 0; at < 4; at++)
        if (args[at + 3] !== undefined) definition.crop[at] = number(at + 3);
      if (!definition.crop[2] || !definition.crop[3])
        definition.crop = [
          0,
          0,
          (definition.scaledWidth - 1) | 0,
          (definition.scaledHeight - 1) | 0,
        ];
    }
  } else if (name === 'IMAGEOBJ') {
    if (args[0] === undefined) return null;
    definition.reference = reference(args[0]);
    if (!definition.reference) return null;
  } else if (name === 'STR' || name === 'SSTR') {
    if (args[0] === undefined) return null;
    Object.assign(definition, readFESPanelSelector(args[0], evaluate));
    if (definition.selector === 'constant') {
      definition.selector = 'string-entry';
      definition.entry = definition.constant;
    } else definition.entry = -1;
    if (args[1] === undefined) return null;
    definition.fontSize = number(1);
    if (args[2] === undefined) return null;
    definition.columns = number(2);
    if (args[3] === undefined) return null;
    definition.color = number(3) >>> 0;
    if (args[4] !== undefined) {
      const style = number(4);
      definition.styles = [style & 1, (style >> 1) & 1];
    }
    if (args[5] !== undefined) definition.outlineColor = number(5) >>> 0;
    definition.maxLines = args[6] === undefined ? 1 : number(6);
    if (args[7] !== undefined) definition.lineSpacing = number(7);
    if (args[8] !== undefined) definition.font = String(args[8]);
  } else if (name === 'NUM_O' || name === 'NUM_O2') {
    if (args[0] === undefined) return null;
    definition.reference = reference(args[0]);
    if (!definition.reference) return null;
    if (args[1] === undefined) return null;
    Object.assign(definition, readFESPanelSelector(args[1], evaluate));
  }
  return { id: partID, definition };
}
export function setFESSavePanelType(object, specification) {
  panel(object);
  if (object.nativeType !== 12 || specification === null) return false;
  object.panel.save.definitions.set(
    specification.id | 0,
    structuredClone(specification.definition),
  );
  return true;
}
export function readFESPanelUserFont(tokens, evaluate) {
  if (typeof evaluate !== 'function')
    throw new TypeError('PANEL userfont requires its FES evaluator');
  if (tokens[0] === undefined) return null;
  const id = evaluate(String(tokens[0])) & 65535;
  if (tokens[1] === undefined) return null;
  const file = String(tokens[1]);
  if (encodeCP932(file).length >= 64)
    throw new RangeError('PANEL image-font name exceeds its original fixed buffer');
  if (tokens[2] === undefined) return null;
  const code = evaluate(String(tokens[2])) & 65535;
  if (tokens[3] === undefined) return null;
  const first = evaluate(String(tokens[3])) | 0;
  const specification = { file, code, x: 0, y: 0, width: 0, height: 0, frame: first };
  if (tokens[4] !== undefined) {
    specification.y = evaluate(String(tokens[4])) | 0;
    if (tokens[5] === undefined) return null;
    specification.width = evaluate(String(tokens[5])) | 0;
    if (tokens[6] === undefined) return null;
    specification.height = evaluate(String(tokens[6])) | 0;
    specification.x = first;
    specification.frame = -1;
  }
  return { id, specification };
}
