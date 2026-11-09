// SPDX-License-Identifier: MPL-2.0
// Native V8 callbacks and KCS call packets use the calling Script's string
// bank. Keep one bank in the World and expose its entries at the x86 boundary.
const GET = 'SDK JavaScript linked KCS string read',
  SET = 'SDK JavaScript linked KCS string write';

export class NativeSDKJavaScriptStrings {
  constructor(engine, world) {
    Object.assign(this, { world, process: engine.process });
    this.records = new Map();
    this.links = new Map();
    this.definitions = new Map([
      [GET, (args) => this.read(...args)],
      [SET, (args) => this.write(...args)],
    ]);
    const p = this.process;
    this.traps = new Map();
    this.detachers = [
      [0x5e1360, GET],
      [0x5e1660, SET],
    ].map(([entry, name]) => {
      this.traps.set(name, p.trap(name, 2, this.definitions.get(name)));
      return p.beforeInstruction(entry, name, () => {
        if (this.records.has(this.current()))
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
    const token = this.process.allocate(4, true);
    this.records.set(token, { task: task.id, bank: task.context.stringBank, entries: new Map() });
    return token;
  }
  record() {
    const record = this.records.get(this.current());
    if (!record) throw new Error('The original JavaScript string bank link is absent');
    return record;
  }
  bank(record) {
    return this.world.runtime.handles.get(record.bank, 'string-bank');
  }
  read(index, out) {
    const record = this.record(),
      bytes = this.bank(record).getBytes(index);
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
  write(index, value) {
    const record = this.record(),
      p = this.process;
    this.bank(record).setBytes(index, value ? p.stringBytes(value) : new Uint8Array());
    const caller = this.world.objects.objects.get(record.task);
    if (caller) caller.scriptStringDirty = 1;
    return 1;
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
    const handler = this.definitions.get(trap.name);
    return handler ? { args: 2, real: false, handler } : null;
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
          p.allocations.get(token) !== 4 ||
          !(record.entries instanceof Map) ||
          [...record.entries.values()].some((address) => !p.allocations.has(address)),
      )
    )
      throw new Error('Invalid SDK JavaScript string bank checkpoint');
    for (const record of records.values()) this.bank(record);
    Object.assign(this, structuredClone({ records, links, traps }));
  }
  close() {
    for (const token of this.records.keys()) this.release(token);
    this.links.clear();
    for (const detach of this.detachers) detach();
  }
}
