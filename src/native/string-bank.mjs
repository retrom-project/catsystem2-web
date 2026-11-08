// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { parseNativeIntegerPrefix } from './standard.mjs';

const decoder = new TextDecoder('shift_jis');
function cstring(machine, address) {
  const bytes = [];
  for (let at = address; ; at++) {
    const byte = machine.load(at, 1);
    if (!byte) return Uint8Array.from(bytes);
    bytes.push(byte);
  }
}
function mapped(machine, address) {
  try {
    machine.region(address >>> 0, 1);
    return true;
  } catch {
    return false;
  }
}

export class NativeStringBank {
  constructor() {
    this.entries = new Map();
    this.dirty = false;
  }
  get(index) {
    const bytes = this.entries.get(index >>> 0);
    return bytes === undefined ? undefined : decoder.decode(bytes);
  }
  set(index, text) {
    this.setBytes(index, encodeCP932(text));
  }
  getBytes(index) {
    return this.entries.get(index >>> 0);
  }
  setBytes(index, bytes) {
    const end = bytes.indexOf(0);
    this.entries.set(index >>> 0, bytes.slice(0, end < 0 ? bytes.length : end));
    this.dirty = true;
  }
  expandBytes(source) {
    const out = [];
    for (let at = 0; at < source.length && source[at]; ) {
      if (
        source[at] === 36 &&
        source[at + 1] === 115 &&
        source[at + 2] === 116 &&
        source[at + 3] === 114
      ) {
        // Native parsing is signed decimal/hex with no whitespace skipping.
        let suffix = '';
        for (let i = at + 4; i < source.length && source[i] && source[i] < 128; i++)
          suffix += String.fromCharCode(source[i]);
        const number = parseNativeIntegerPrefix(suffix);
        if (number) {
          const replacement = this.entries.get(number.value >>> 0);
          if (replacement) for (const byte of replacement) out.push(byte);
          at += number.count + 4;
          continue;
        }
      }
      out.push(source[at++]);
    }
    return Uint8Array.from(out);
  }
  expand(text) {
    return decoder.decode(this.expandBytes(encodeCP932(text)));
  }
  snapshot() {
    return { entries: structuredClone(this.entries), dirty: this.dirty };
  }
  restore(state) {
    if (!(state.entries instanceof Map)) throw new Error('Invalid native string bank checkpoint');
    for (const [index, bytes] of state.entries)
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index > 0xffffffff ||
        !(bytes instanceof Uint8Array) ||
        bytes.includes(0)
      )
        throw new Error('Invalid native string bank entry');
    this.entries = structuredClone(state.entries);
    this.dirty = Boolean(state.dirty);
  }
}

export function nativeStringBank(id, args, machine, services = {}) {
  if (id < 0x114 || id > 0x116) return undefined;
  const count = id === 0x116 ? 1 : 2;
  if (args.length !== count)
    throw new Error(`KCS string bank native 0x${id.toString(16)} expects ${count} arguments`);
  const bank = services.strings;
  if (!bank) return undefined;
  if (id === 0x114) {
    bank.setBytes(args[0], mapped(machine, args[1]) ? cstring(machine, args[1]) : new Uint8Array());
    services.markStringsDirty?.();
  } else if (id === 0x115) {
    const bytes = bank.getBytes(args[0]);
    if (bytes !== undefined) {
      if (mapped(machine, args[1])) machine.writeStringBytes(bytes, args[1]);
      return nativeReply(1, 1);
    }
    machine.store(args[1], 0, 1);
    return nativeReply(1, 0);
  } else {
    const bytes = bank.expandBytes(cstring(machine, args[0]));
    machine.bytes(args[0], bytes.length + 2).set(bytes);
    machine.store(args[0] + bytes.length, 0, 2);
  }
  return nativeReply(2);
}
