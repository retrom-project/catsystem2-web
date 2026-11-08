// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../kcs/strings.mjs';

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
  allocateString(text) {
    return this.allocate(encodeCP932(`${text}\0`));
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
      if (existing.signature !== JSON.stringify(program.blocks))
        throw new Error(`FES source program changed during its lifetime: ${name}`);
      return key;
    }
    const blocks = {};
    for (const [label, lines] of Object.entries(program.blocks))
      blocks[label] = lines.map((text) => ({
        text,
        address: this.allocateString(text),
        names: {},
      }));
    this.programs.set(key, { signature: JSON.stringify(program.blocks), blocks });
    return key;
  }
  context(key, label, index, line, objectName) {
    const record = this.programs.get(key)?.blocks[label]?.[index];
    if (!record) throw new Error(`FES source command ${key}#${label}:${index + 1} is unavailable`);
    const offset = record.text.indexOf(line);
    if (offset < 0) throw new Error('FES executing command does not belong to its source record');
    if (!Object.hasOwn(record.names, objectName))
      record.names[objectName] = this.allocateString(objectName);
    return {
      commandPointer: record.address + encodeCP932(record.text.slice(0, offset)).length,
      objectNameAddress: record.names[objectName],
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
    Object.assign(this, restored);
  }
}
