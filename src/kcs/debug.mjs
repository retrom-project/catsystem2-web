// SPDX-License-Identifier: MPL-2.0
// The debugger exposes 148-byte compiler symbol records plus a value word.
// These are independent of KCS operands and of task/VM pointer handles.
const dataView = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const wordTypes = new Set([0x29, 0x2e, 0x2f, 0x30]);

export function nativeDebugValue(machine, descriptor, { relative = false } = {}) {
  if (descriptor.length < 152) throw new RangeError('Native debug value requires 152 bytes');
  const view = dataView(descriptor),
    raw = view.getUint32(0, true),
    immediate = descriptor[9] !== 0,
    type = descriptor[8];
  let address = raw,
    literal = raw,
    valid = true,
    directBase = false;
  if (relative) {
    if (raw & 0x40000000) {
      literal = raw & 0xbfffffff;
      valid = literal < machine.shared.length;
      address = (literal | 0x80000000) >>> 0;
    } else {
      literal = raw & 0x7fffffff;
      directBase = literal < machine.memory.length;
      if (literal < machine.memory.length && descriptor.length >= 156 && view.getUint32(152, true))
        literal = (literal + machine.fp) >>> 0;
      address = literal;
    }
  }
  if (immediate || (type === 0x0a && !relative)) {
    view.setUint32(148, literal, true);
    return descriptor;
  }
  try {
    if (valid && !directBase) machine.region(address, 1);
  } catch {
    valid = false;
  }
  if (!valid || type === 0x0b) view.setUint32(148, 0, true);
  else if (type === 0x0a) view.setUint32(148, literal, true);
  else if (wordTypes.has(type)) view.setUint32(148, machine.load(address), true);
  else if (type >= 0x2a && type <= 0x2d)
    view.setUint32(
      148,
      machine.load(address, type <= 0x2b ? 1 : 2, type === 0x2a || type === 0x2c),
      true,
    );
  // Other types leave the caller's old value word untouched.
  return descriptor;
}

export function nativeDebugSymbol(
  machine,
  index,
  global = false,
  destination = new Uint8Array(152),
) {
  const { locals, scopes } = machine.debug;
  if (!scopes?.length) throw new Error('Native debug symbol query has no scope container');
  index |= 0;
  const first = global ? scopes[0] : scopes.at(-1),
    count = global && scopes.length >= 2 ? scopes[1] : locals.length - first;
  if (index >= (count | 0)) return false;
  if (index < 0 || first + index >= locals.length)
    throw new RangeError('Native debug symbol index crosses its mapped deque');
  const symbol = locals[first + index],
    offset = machine.script.debugOffset + 148 * symbol;
  if (!Number.isInteger(machine.script.debugOffset) || machine.script.debugOffset < 0)
    throw new Error('Native debugger has no compiler symbol table');
  destination.set(machine.script.body.range(offset, 148), 0);
  nativeDebugValue(machine, destination);
  return true;
}
