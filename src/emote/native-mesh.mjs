// SPDX-License-Identifier: MPL-2.0
// Pack the reviewed driver's strip vertices without changing its texture
// coordinates, positions, colors, vector allocator, or final loop iteration.
const identity = '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce';
const overlap = (a, n, b, m) => a < b + m && b < a + n;

export class NativeEmoteMeshBlocks {
  constructor(device, { enabled = () => true } = {}) {
    this.process = device.process;
    this.services = device.services;
    this.base = device.module.base;
    this.enabled = true;
    this.hits = 0;
    this.vertices = 0;
    if (device.identity !== identity) return;
    this.reviewed = true;
    const prefix = [0x8b, 0x44, 0x24, 0x30, 0xc7, 0x84, 0x24, 0xa8, 0, 0, 0, 0, 0, 0, 0];
    if (!this.process.read(this.base + 0x58b44, prefix.length).every((v, i) => v === prefix[i]))
      throw new Error('The reviewed E-mote strip packing loop has changed');
    this.detach = this.process.beforeInstruction(
      this.base + 0x58b44,
      'E-mote exact strip packing loop',
      () => {
        if (this.enabled && enabled() && this.execute()) this.hits++;
      },
    );
  }
  mapped(address, size, write = false) {
    const p = this.process;
    if (
      !Number.isSafeInteger(address) ||
      address < 0 ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      address + size > 0x100000000 ||
      !p.regions.some((r) => address >= r.address && address + size <= r.address + r.size)
    )
      return false;
    if (this.services.protectionAt)
      for (let page = Math.floor(address / 4096) * 4096; page < address + size; page += 4096) {
        const permissions = this.services.memoryPermissions(this.services.protectionAt(page));
        if (!(permissions & 1) || (write && !(permissions & 2))) return false;
      }
    return true;
  }
  execute() {
    if (!this.reviewed) return false;
    const p = this.process,
      cpu = p.cpu,
      uc = p.uc,
      reg = (name) => cpu.reg_read_i32(uc['X86_REG_' + name]) >>> 0,
      esp = reg('ESP');
    if (!this.mapped(esp, 0xb8)) return false;
    const stack = p.read(esp, 0xb8),
      s = new DataView(stack.buffer, stack.byteOffset, stack.byteLength),
      load = (offset) => s.getUint32(offset, true),
      index = reg('ESI'),
      count = load(0x2c),
      skipped = count - index - 1;
    // Run the last pair in the original code. Its SIMD, scalar, flag and
    // scratch-stack state is then produced by the actual instructions.
    if (count > 0x10000 || index >= count || skipped < 1) return false;
    const owner = load(0x1c),
      vector = load(0x38),
      positionsRef = load(0x44);
    if (
      !this.mapped(owner + 0x39c, 4) ||
      !this.mapped(vector, 12, true) ||
      overlap(vector, 12, esp - 16, 0xc8) ||
      reg('ECX') !== vector ||
      reg('EDX') !== load(0x14) ||
      !this.mapped(positionsRef, 4)
    )
      return false;
    const begin = p.load(vector),
      destination = p.load(vector + 4),
      source = esp + 0xa0,
      outputSize = skipped * 48,
      capacity = p.load(vector + 8);
    if (
      !destination ||
      destination + outputSize + 48 > capacity ||
      (source >= begin && source < destination) ||
      overlap(destination, outputSize + 48, esp - 16, 0xc8)
    )
      return false;
    // push_back executes 20 instructions for a source beyond end, or 23 for
    // one below begin. Its alias/reallocation paths remain original code.
    const instructionsPerPair = source >= destination ? 90 : 96,
      additional = skipped * instructionsPerPair - 2,
      budget = p.instructionBudget();
    // The lead MOV and the hook instruction are already counted. The final
    // native pair produces scratch registers/flags; it must finish before a
    // budget stop can observe them. The query and consume cannot yield.
    if (
      !budget.active ||
      (budget.limit !== 0n &&
        budget.limit - budget.counter < BigInt(additional + instructionsPerPair))
    )
      return false;
    const row = load(0x14),
      positions = p.load(positionsRef),
      colors = p.load(owner + 0x39c),
      aOffset = reg('EBX'),
      bOffset = reg('EDI'),
      positionA = positions + aOffset,
      positionB = positions + bOffset,
      colorA = colors + load(0x3c),
      colorB = colors + load(0x40),
      u = load(0x30) + index * 4,
      v = load(0x34) + row * 4,
      inputs = [
        [positionA, skipped * 8],
        [positionB, skipped * 8],
        [colorA, skipped * 4],
        [colorB, skipped * 4],
        [u, skipped * 4],
        [v, 8],
        [owner + 0x39c, 4],
        [positionsRef, 4],
        [vector, 12],
        [esp - 16, 0xc8],
      ];
    if (
      !this.mapped(destination, outputSize, true) ||
      !this.mapped(esp - 16, 0xc8, true) ||
      inputs.some(
        ([address, size]) =>
          !this.mapped(address, size) || overlap(destination, outputSize, address, size),
      ) ||
      inputs.slice(0, 8).some(([address, size]) => overlap(address, size, esp - 16, 0xc8)) ||
      inputs.slice(0, 8).some(([address, size]) => overlap(address, size, vector, 12)) ||
      [...p.writeObservers].some((w) =>
        overlap(destination, outputSize, w.address, w.end - w.address),
      )
    )
      return false;
    // Byte copies retain every NaN payload and signed zero. No numerical
    // operation takes place in this loop; UV arithmetic already ran natively.
    const views = inputs.slice(0, 6).map(([address, size]) => {
        const bytes = p.read(address, size);
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }),
      output = new Uint8Array(outputSize),
      out = new DataView(output.buffer),
      va = views[5].getUint32(0, true),
      vb = views[5].getUint32(4, true);
    for (let i = 0; i < skipped; i++) {
      const offset = i * 48,
        uv = views[4].getUint32(i * 4, true);
      for (let pair = 0; pair < 2; pair++) {
        const at = offset + pair * 24;
        out.setUint32(at, views[pair].getUint32(i * 8, true), true);
        out.setUint32(at + 4, views[pair].getUint32(i * 8 + 4, true), true);
        out.setUint32(at + 12, views[2 + pair].getUint32(i * 4, true), true);
        out.setUint32(at + 16, uv, true);
        out.setUint32(at + 20, pair ? vb : va, true);
      }
    }
    if (!p.consumeInstructions(additional)) return false;
    p.write(destination, output);
    p.store(vector + 4, destination + outputSize);
    p.store(esp + 0x3c, load(0x3c) + skipped * 4);
    p.store(esp + 0x40, load(0x40) + skipped * 4);
    for (const [name, value] of Object.entries({
      ESI: index + skipped,
      EBX: aOffset + skipped * 8,
      EDI: bOffset + skipped * 8,
      EDX: row,
      EIP: this.base + 0x58b40,
    }))
      cpu.reg_write_i32(uc['X86_REG_' + name], value);
    this.vertices += skipped * 2;
    return true;
  }
  close() {
    this.detach?.();
  }
}
