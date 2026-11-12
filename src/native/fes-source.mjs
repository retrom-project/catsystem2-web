// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../kcs/strings.mjs';
import { fesSourceBytes, fesByteView, fesViewBytes } from '../fes/tokens.mjs';

// FES native handlers can observe addresses of preprocessed command strings.
// This world-owned segment is separate from the PE32 heap and VM handles.
export class NativeFESSourceArena {
  constructor({ base = 0x30000000, limit = 64 * 1024 * 1024 } = {}) {
    if (
      !Number.isSafeInteger(base) ||
      base < 0x30000000 ||
      base % 4096 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      base + limit > 0x40000000
    )
      throw new RangeError('Invalid FES source arena address range');
    Object.assign(this, { base, limit, used: 0, blocks: [], programs: new Map() });
  }
  allocate(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('FES source allocation requires bytes');
    const size = Math.ceil(Math.max(bytes.length, 1) / 16) * 16;
    if (this.used + size > this.limit) throw new RangeError('FES source arena exhausted');
    const address = this.base + this.used,
      data = new Uint8Array(size);
    data.set(bytes);
    this.blocks.push({ address, data });
    this.used += size;
    return address;
  }
  allocateString(source) {
    const bytes = fesSourceBytes(source),
      terminated = new Uint8Array(bytes.length + 1);
    terminated.set(bytes);
    return this.allocate(terminated);
  }
  range(address, size) {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(size) || size < 0)
      throw new RangeError('Invalid FES source memory range');
    const block = this.blocks.find(
      ({ address: start, data }) => address >= start && address + size <= start + data.length,
    );
    if (!block)
      throw new RangeError(
        `FES source address 0x${address.toString(16)} +${size} is not allocated`,
      );
    return block.data.subarray(address - block.address, address - block.address + size);
  }
  read(address, size) {
    return this.range(address, size).slice();
  }
  write(address, bytes) {
    this.range(address, bytes.length).set(bytes);
  }
  string(address) {
    const block = this.blocks.find(
      ({ address: start, data }) => address >= start && address < start + data.length,
    );
    if (!block) throw new RangeError('FES string address is not allocated');
    const bytes = block.data.subarray(address - block.address),
      end = bytes.indexOf(0);
    if (end < 0) throw new Error('Unterminated FES source string');
    return new TextDecoder('shift_jis').decode(bytes.subarray(0, end));
  }
  register(owner, name, program) {
    const key = `${owner ?? 'local'}:${name}`;
    const existing = this.programs.get(key);
    if (existing) {
      this.validateProgram(key, program);
      return key;
    }
    const blocks = Object.create(null);
    for (const [label, lines] of Object.entries(program.blocks))
      blocks[label] = lines.map((line) => ({
        bytes: fesSourceBytes(line).slice(),
        copies: new Map([[fesByteView(line), this.allocateString(line)]]),
        names: new Map(),
      }));
    this.programs.set(key, { signature: JSON.stringify(program.blocks), blocks });
    return key;
  }
  validateProgram(key, program) {
    if (this.programs.get(key)?.signature !== JSON.stringify(program.blocks))
      throw new Error(`FES source program changed during its lifetime: ${key}`);
  }
  context(key, label, index, { bytes, offset = 0, name }) {
    const record = this.programs.get(key)?.blocks[label]?.[index];
    if (!record) throw new Error(`FES source command ${key}#${label}:${index + 1} is unavailable`);
    if (
      !(bytes instanceof Uint8Array) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > bytes.length ||
      typeof name !== 'string'
    )
      throw new Error('Invalid FES executing source copy');
    const identity = fesByteView(bytes);
    if (!record.copies.has(identity)) record.copies.set(identity, this.allocateString(bytes));
    // Object names retain their independent native narrow-string ABI.
    if (!record.names.has(name)) record.names.set(name, this.allocate(encodeCP932(`${name}\0`)));
    return {
      commandPointer: record.copies.get(identity) + offset,
      objectNameAddress: record.names.get(name),
    };
  }
  snapshot() {
    return structuredClone({
      base: this.base,
      limit: this.limit,
      used: this.used,
      blocks: this.blocks,
      programs: [...this.programs],
    });
  }
  restore(state) {
    const restored = new NativeFESSourceArena(state);
    if (!Number.isSafeInteger(state.used) || state.used < 0 || state.used > state.limit)
      throw new Error('Invalid FES source arena checkpoint size');
    let end = state.base;
    for (const block of state.blocks) {
      if (
        block.address !== end ||
        !(block.data instanceof Uint8Array) ||
        !block.data.length ||
        block.data.length % 16
      )
        throw new Error('Invalid FES source arena checkpoint block');
      end += block.data.length;
    }
    if (end !== state.base + state.used)
      throw new Error('FES source arena checkpoint extent mismatch');
    restored.used = state.used;
    restored.blocks = structuredClone(state.blocks);
    restored.programs = new Map(structuredClone(state.programs));
    const validateCopy = (address, bytes) => {
      const actual = restored.read(address, bytes.length + 1);
      if (actual[bytes.length] || bytes.some((byte, index) => actual[index] !== byte))
        throw new Error('FES source arena checkpoint copy mismatch');
    };
    for (const [key, program] of restored.programs) {
      if (typeof key !== 'string' || !program?.blocks || typeof program.signature !== 'string')
        throw new Error('Invalid FES source arena checkpoint program');
      const blocks = Object.create(null);
      for (const [label, records] of Object.entries(program.blocks)) {
        if (!Array.isArray(records)) throw new Error('Invalid FES source arena checkpoint lines');
        blocks[label] = records.map((record) => {
          if (
            !(record.bytes instanceof Uint8Array) ||
            record.bytes.includes(0) ||
            !(record.copies instanceof Map) ||
            !(record.names instanceof Map) ||
            !record.copies.has(fesByteView(record.bytes))
          )
            throw new Error('Invalid FES source arena checkpoint record');
          for (const [identity, address] of record.copies) {
            if (typeof identity !== 'string') throw new Error('Invalid FES source copy identity');
            validateCopy(address, fesViewBytes(identity));
          }
          for (const [name, address] of record.names) {
            if (typeof name !== 'string') throw new Error('Invalid FES object-name identity');
            validateCopy(address, encodeCP932(name));
          }
          return record.bytes;
        });
      }
      restored.validateProgram(key, { blocks });
    }
    Object.assign(this, restored);
  }
}
