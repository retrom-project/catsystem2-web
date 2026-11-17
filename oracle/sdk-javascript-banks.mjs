// SPDX-License-Identifier: MPL-2.0
// Native V8 callbacks and KCS call packets share the calling Script's banks.
const PREFIX = 'SDK JavaScript linked KCS ',
  STRING_GET = 0x5e1360,
  STRING_SET = 0x5e1660,
  WORD_GET = 0x5d90d0,
  WORD_SET = 0x5d90f0,
  CALCULATE = 0x5d9230,
  INTERPRETER_CONSTRUCT = 0x5d8bc0,
  INTERPRETER_DESTROY = 0x5d8ce0,
  INTERPRETER_ADD_CONTEXT = 0x5d8e30,
  INTERPRETER_SET_NAME = 0x5d92d0,
  VARIABLE_OFFSET = 4,
  LINK_SIZE = 8;

const wordBytes = (words) => new Uint8Array(words.buffer, words.byteOffset, words.byteLength);

export class NativeSDKJavaScriptBanks {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.records = new Map();
    this.links = new Map();
    this.definitions = new Map();
    const p = this.process;
    this.traps = new Map();
    this.detachers = [
      [STRING_GET, 'string read', 0, 2, (args) => this.readString(...args)],
      [STRING_SET, 'string write', 0, 2, (args) => this.writeString(...args)],
      [WORD_GET, 'word read', VARIABLE_OFFSET, 1, ([index]) => this.variableBank().get(index)],
      [WORD_SET, 'word write', VARIABLE_OFFSET, 2, (args) => this.writeWord(...args)],
      [CALCULATE, 'expression', VARIABLE_OFFSET, 1, ([text]) => this.calculate(text)],
    ].map(([entry, label, offset, args, handler]) => {
      const name = PREFIX + label;
      this.definitions.set(name, { args, real: false, handler });
      this.traps.set(name, p.trap(name, args, handler));
      return p.beforeInstruction(entry, name, () => {
        const record = this.records.get(this.current() - offset);
        if (record && (!offset || record.variables))
          p.cpu.reg_write_i32(p.uc.X86_REG_EIP, this.traps.get(name));
      });
    });
  }
  current() {
    const p = this.process;
    return p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
  }
  create(task) {
    this.world.runtime.stringBank(task);
    const token = this.process.allocate(LINK_SIZE, true);
    this.records.set(token, {
      task: task.id,
      strings: task.context.stringBank,
      variables: task.context.variableBank || 0,
      entries: new Map(),
    });
    return token;
  }
  interpreter(token) {
    return this.records.get(token)?.variables ? token + VARIABLE_OFFSET : 0;
  }
  record(offset = 0) {
    const record = this.records.get(this.current() - offset);
    if (!record) throw new Error('The original JavaScript bank link is absent');
    return record;
  }
  stringBank(record) {
    return this.world.runtime.handles.get(record.strings, 'string-bank');
  }
  variableBank(record = this.record(VARIABLE_OFFSET)) {
    return this.world.runtime.handles.get(record.variables, 'variable-bank');
  }
  readString(index, out) {
    const record = this.record(),
      bytes = this.stringBank(record).getBytes(index);
    if (bytes === undefined) return 0;
    const p = this.process;
    let address = record.entries.get(index);
    if (
      address &&
      (p.allocations.get(address) !== bytes.length + 1 ||
        !p.read(address, bytes.length).every((byte, offset) => byte === bytes[offset]))
    ) {
      p.free(address);
      address = 0;
    }
    if (!address) {
      address = p.allocate(bytes.length + 1, true);
      p.write(address, bytes);
      record.entries.set(index, address);
    }
    if (out) p.write(out, p.read(address, bytes.length + 1));
    return address;
  }
  writeString(index, value) {
    const record = this.record(),
      p = this.process;
    this.stringBank(record).setBytes(index, value ? p.stringBytes(value) : new Uint8Array());
    const caller = this.world.objects.objects.get(record.task);
    if (caller) caller.scriptStringDirty = 1;
    return 1;
  }
  writeWord(index, value) {
    const bank = this.variableBank();
    bank.set(index, value);
    bank.dirty = true;
    return Number(index < bank.capacity);
  }
  async calculate(text) {
    const bank = this.variableBank();
    if (!bank.words) return 0;
    const p = this.process,
      interpreter = p.allocate(40, true),
      call = (address, args) => this.engine.callFromHost(address, args, interpreter),
      global = wordBytes(bank.words),
      privateWords = bank.privateWords,
      local = privateWords && wordBytes(privateWords);
    let name = 0,
      constructed = false;
    try {
      if ((await call(INTERPRETER_CONSTRUCT, [bank.capacity])) !== interpreter)
        throw new Error('Original SDK variable interpreter changed its identity');
      constructed = true;
      const words = p.load(interpreter);
      p.write(words, global);
      p.store(interpreter + 20, bank.contextValue);
      p.store(interpreter + 24, Number(bank.dirty));
      let localAddress = 0;
      if (local) {
        if (!(await call(INTERPRETER_ADD_CONTEXT, [0])))
          throw new Error('Original SDK variable interpreter rejected its local context');
        localAddress = p.load(interpreter + 36);
        p.write(localAddress, local);
        if (bank.privateNames.size) name = p.allocate(32, true);
        for (const [key, value] of bank.privateNames) {
          const [encoded, index] = key.split(':'),
            bytes = (encoded.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
          p.write(name, Uint8Array.from([...bytes, 0]));
          await call(INTERPRETER_SET_NAME, [name, Number(index), value]);
        }
      }
      try {
        return await call(CALCULATE, [text]);
      } finally {
        global.set(p.read(words, global.length));
        if (local) local.set(p.read(localAddress, local.length));
        bank.dirty = Boolean(p.load(interpreter + 24));
      }
    } finally {
      try {
        if (constructed) await call(INTERPRETER_DESTROY, []);
      } finally {
        p.free(name);
        p.free(interpreter);
      }
    }
  }
  attach(id, token) {
    this.detach(id);
    this.links.set(id, token);
  }
  detach(id) {
    const token = this.links.get(id);
    if (!token) return;
    this.links.delete(id);
    this.release(token);
  }
  release(token) {
    const record = this.records.get(token);
    if (!record) return;
    for (const address of record.entries.values()) this.process.free(address);
    this.process.free(token);
    this.records.delete(token);
  }
  recoverTrap(trap) {
    return this.definitions.get(trap.name) ?? null;
  }
  snapshot() {
    return structuredClone({ records: this.records, links: this.links, traps: this.traps });
  }
  restore({ records, links, traps }) {
    const p = this.process;
    if (
      !(traps instanceof Map) ||
      traps.size !== this.definitions.size ||
      [...this.definitions.keys()].some((name) => p.traps.get(traps.get(name))?.name !== name) ||
      !(records instanceof Map) ||
      !(links instanceof Map) ||
      records.size !== links.size ||
      new Set(links.values()).size !== links.size ||
      [...links.values()].some((token) => !records.has(token)) ||
      [...records].some(
        ([token, record]) =>
          p.allocations.get(token) !== LINK_SIZE ||
          !(record.entries instanceof Map) ||
          [...record.entries.values()].some((address) => !p.allocations.has(address)),
      )
    )
      throw new Error('Invalid SDK JavaScript bank checkpoint');
    for (const record of records.values()) {
      this.stringBank(record);
      if (record.variables) this.variableBank(record);
    }
    Object.assign(this, structuredClone({ records, links, traps }));
  }
  close() {
    for (const token of this.records.keys()) this.release(token);
    this.links.clear();
    for (const detach of this.detachers) detach();
  }
}
