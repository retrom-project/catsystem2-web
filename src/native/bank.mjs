// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { evaluateNativeExpression } from './expression.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export const NATIVE_BANK_IDS = Object.freeze([
  0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0x261, 0x262, 0x292, 0x293,
]);
function nameKey(name, index) {
  let bytes = encodeCP932(name);
  const nul = bytes.indexOf(0);
  if (nul !== -1) bytes = bytes.subarray(0, nul);
  if (bytes.length >= 32) throw new RangeError('Native variable name exceeds its 32-byte key');
  return (
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') + ':' + (index >>> 0)
  );
}

export class NativeVariableBank {
  constructor() {
    this.words = null;
    this.backupBytes = null;
    this.contextValue = 0;
    this.dirty = false;
    this.contexts = new Map();
    this.selectedContext = null;
  }
  get capacity() {
    return this.words?.length ?? 0;
  }
  initialize(capacity) {
    if (this.words) return;
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 0x1fffffff)
      throw new Error('Native variable allocation size overflow');
    this.words = new Uint32Array(capacity);
    this.backupBytes = new Uint8Array(capacity * 4);
  }
  get(index) {
    return this.words?.[index >>> 0] ?? 0;
  }
  set(index, value) {
    if (!this.words) return;
    if (index >>> 0 < this.capacity) this.words[index >>> 0] = value >>> 0;
    this.dirty = true;
  }
  registerContext(key) {
    if (!this.words || this.contexts.has(key)) return false;
    if (key === null || !['number', 'string'].includes(typeof key))
      throw new TypeError('Native variable context requires a stable task or FES identity');
    this.contexts.set(key, { words: new Uint32Array(512), names: new Map() });
    return this.selectContext(key);
  }
  selectContext(key) {
    if (!this.words || !this.contexts.has(key)) return false;
    this.selectedContext = key;
    return true;
  }
  unregisterContext(key) {
    if (!this.contexts.has(key)) return false;
    if (this.selectedContext === key) this.selectedContext = null;
    this.contexts.delete(key);
    return true;
  }
  context(key) {
    return this.contexts.get(key) ?? null;
  }
  copyContext(sourceKey, destinationKey) {
    const source = this.context(sourceKey),
      destination = this.context(destinationKey);
    if (!source || !destination) return false;
    // 729050 copies exactly the private 0x800-byte word allocation. Names,
    // selection and global-bank dirty state belong to separate fields.
    destination.words.set(source.words);
    return true;
  }
  get privateWords() {
    return this.contexts.get(this.selectedContext)?.words ?? null;
  }
  get privateNames() {
    return this.contexts.get(this.selectedContext)?.names ?? null;
  }
  getPrivate(index) {
    return this.privateWords?.[index >>> 0] ?? 0;
  }
  setPrivate(index, value) {
    if (index >>> 0 <= 511 && this.privateWords) this.privateWords[index >>> 0] = value >>> 0;
  }
  setName(name, index, value) {
    this.privateNames?.set(nameKey(name, index), value >>> 0);
  }
  getName(name, index = 0) {
    return this.privateNames?.get(nameKey(name, index)) ?? 0;
  }
  deleteName(name, index = 0) {
    return this.privateNames?.delete(nameKey(name, index)) ?? false;
  }
  backup() {
    if (!this.words) return;
    // The original copies capacity bytes, although allocation is capacity words.
    this.backupBytes.set(new Uint8Array(this.words.buffer, this.words.byteOffset, this.capacity));
  }
  restoreBackup() {
    if (!this.words) return;
    new Uint8Array(this.words.buffer, this.words.byteOffset, this.capacity).set(
      this.backupBytes.subarray(0, this.capacity),
    );
  }
  snapshot() {
    return {
      words: this.words?.slice() ?? null,
      backupBytes: this.backupBytes?.slice() ?? null,
      contextValue: this.contextValue,
      dirty: this.dirty,
      contexts: [...this.contexts].map(([key, context]) => [
        key,
        { words: context.words.slice(), names: [...context.names] },
      ]),
      selectedContext: this.selectedContext,
    };
  }
  restore(state) {
    if (
      (state.words === null) !== (state.backupBytes === null) ||
      (state.words !== null &&
        (!(state.words instanceof Uint32Array) ||
          !(state.backupBytes instanceof Uint8Array) ||
          state.words.byteLength !== state.backupBytes.byteLength))
    )
      throw new Error('Invalid native variable bank checkpoint');
    this.words = state.words?.slice() ?? null;
    this.backupBytes = state.backupBytes?.slice() ?? null;
    this.contextValue = state.contextValue >>> 0;
    this.dirty = Boolean(state.dirty);
    const contexts = new Map();
    for (const [key, context] of state.contexts) {
      if (
        contexts.has(key) ||
        !(context.words instanceof Uint32Array) ||
        context.words.length !== 512
      )
        throw new Error('Invalid native variable context checkpoint');
      contexts.set(key, { words: context.words.slice(), names: new Map(context.names) });
    }
    if (state.selectedContext !== null && !contexts.has(state.selectedContext))
      throw new Error('Selected native variable context is absent from its checkpoint');
    this.contexts = contexts;
    this.selectedContext = state.selectedContext;
  }
}

export function nativeBank(id, args, machine, services = {}) {
  const count = new Map([
    [0xd1, 1],
    [0xd2, 1],
    [0xd3, 2],
    [0xd4, 1],
    [0xd5, 1],
    [0x261, 0],
    [0x262, 0],
    [0x292, 1],
    [0x293, 2],
  ]).get(id);
  if (count === undefined) return undefined;
  if (args.length !== count)
    throw new Error(`KCS variable native 0x${id.toString(16)} expects ${count} arguments`);
  const bank = services.variables;
  if (bank === undefined) return undefined;
  if (bank === null) return [0xd2, 0xd5, 0x292].includes(id) ? nativeReply(1, 0) : nativeReply(2);
  if (id === 0xd5) {
    if (!bank.words) return nativeReply(1, 0);
    const address = args[0] >>> 0;
    try {
      machine.region(address, 1);
    } catch {
      // Both original wrappers return zero when their VM translator returns
      // NULL. A mapped source still goes through the expression parser.
      return nativeReply(1, 0);
    }
    let text = machine.string(address);
    if (text.endsWith('%')) text = text.slice(0, -1);
    return nativeReply(1, evaluateNativeExpression(text, bank, services.variableExpressionContext));
  }
  if (id === 0x292) return nativeReply(1, bank.getPrivate(args[0]));
  if (id === 0x293) {
    bank.setPrivate(args[0], args[1]);
    return nativeReply(2);
  }
  if (id === 0xd1) {
    if (services.allowVariableInitialization !== false) bank.initialize(args[0]);
  } else if (id === 0xd2) return nativeReply(1, bank.get(args[0]));
  else if (id === 0xd3) bank.set(args[0], args[1]);
  else if (id === 0xd4) {
    if (bank.words) bank.contextValue = args[0] >>> 0;
  } else if (id === 0x261) bank.backup();
  else bank.restoreBackup();
  return nativeReply(2);
}
