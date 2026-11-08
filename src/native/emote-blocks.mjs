// SPDX-License-Identifier: MPL-2.0
// Exact loop accelerators for the reviewed executable. Function setup,
// argument conversion, texture locks and all surrounding code remain native.
const arithmeticFlags = 0x8d5;
const overlaps = (a, size, b, length) => a < b + length && b < a + size;

export class NativeM2Blocks {
  constructor(process) {
    this.process = process;
    this.enabled = true;
    this.detachers = [];
    for (const [address, name, bytes, execute] of [
      [
        0x787840,
        'M2 x86 narrow string scan',
        [0x8a, 0x01, 0x41, 0x84, 0xc0, 0x75, 0xf9],
        () => this.scan(),
      ],
      [
        0x59c720,
        'M2 x86 integer crossfade row',
        [0x0f, 0xb6, 0x0e, 0x8d, 0x52, 0x04, 0x0f, 0xaf, 0xc8],
        () => this.blend(),
      ],
      [
        0x59c888,
        'M2 x86 integer alpha row',
        [0x0f, 0xb6, 0x01, 0x8d, 0x49, 0x04, 0x88, 0x02],
        () => this.alpha(),
      ],
      [
        0x59c974,
        'M2 x86 transparent color row',
        [0x8a, 0x48, 0x03, 0x0a, 0xd9, 0x80, 0x7a, 0x03, 0x00],
        () => this.transparent(),
      ],
      ...[0x7877b0, 0x787a64, 0x787b97].map((address) => [
        address,
        `M2 x86 vector index 0x${address.toString(16)}`,
        [0x3b, 0xca, 0x7d, 0x08, 0x83, 0xc6, 0x08, 0x41, 0x3b, 0xf0, 0x75, 0xf4],
        () => this.index(address, 'ECX', 'EAX'),
      ]),
      [
        0x787640,
        'M2 x86 vector erase index',
        [0x3b, 0xc2, 0x7d, 0x08, 0x83, 0xc6, 0x08, 0x40, 0x3b, 0xf1, 0x75, 0xf4],
        () => this.index(0x787640, 'EAX', 'ECX'),
      ],
      ...[0x7876a8, 0x787751].map((address) => [
        address,
        `M2 x86 vector shift 0x${address.toString(16)}`,
        [0x8b, 0x06, 0x8d, 0x49, 0x08, 0x89, 0x41, 0xf8],
        () => this.shift(address),
      ]),
    ]) {
      if (!process.read(address, bytes.length).every((byte, i) => byte === bytes[i]))
        throw new Error(`Native M2 loop identity differs at 0x${address.toString(16)}`);
      this.detachers.push(
        process.beforeInstruction(address, name, () => {
          if (!this.enabled) return;
          // Mapping and protection changes invalidate this PE32 cache key.
          const layout = process.executableRanges;
          if (!layout || layout !== this.memoryLayoutKey) {
            this.memoryLayoutKey = layout;
            this.memoryRanges = null;
          }
          execute();
        }),
      );
    }
  }
  reg(name, value) {
    const p = this.process,
      id = p.uc['X86_REG_' + name];
    if (value === undefined) return p.cpu.reg_read_i32(id) >>> 0;
    p.cpu.reg_write_i32(id, value >>> 0);
  }
  mappedRange(address, size, write = false) {
    const { cpu, uc } = this.process;
    this.memoryRanges ??= cpu.mem_regions().map(({ begin, end, perms }) => ({
      begin: Number(begin),
      end: Number(end) + 1,
      perms,
    }));
    // Host transfers bypass guest permissions. Let the original instruction
    // fault on protected memory and handle writes into executable mappings.
    const required = uc.PROT_READ | (write ? uc.PROT_WRITE : 0);
    return this.memoryRanges.find(
      (region) =>
        address >= region.begin &&
        address + size <= region.end &&
        (region.perms & required) === required &&
        (!write || !(region.perms & uc.PROT_EXEC)),
    );
  }
  availableInstructions() {
    const { active, limit, counter } = this.process.instructionBudget();
    // A code hook has already counted the instruction at its entry PC.
    if (!active) return 0;
    return limit === 0n ? Infinity : Number(limit - counter) + 1;
  }
  scan() {
    const p = this.process,
      start = this.reg('ECX'),
      limit = Math.min(0x100000000, start + Math.floor(this.availableInstructions() / 4));
    for (let address = start; address < limit; ) {
      const region = this.mappedRange(address, 1);
      if (!region) return;
      const bytes = p.read(address, Math.min(4096, region.end - address, limit - address)),
        end = bytes.indexOf(0);
      if (end >= 0) {
        const next = address + end + 1;
        // MOV, INC, TEST, JNE for every byte, including the terminator.
        if (!p.consumeInstructions((next - start) * 4 - 1)) return;
        this.reg('ECX', next);
        this.reg('EAX', this.reg('EAX') & 0xffffff00);
        this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
        this.reg('EIP', 0x787847);
        return;
      }
      address += bytes.length;
    }
  }
  blend() {
    const p = this.process,
      frame = this.reg('EBP');
    if (!this.mappedRange(frame - 44, 44) || !this.mappedRange(frame - 12, 8, true)) return;
    const owner = p.load(frame - 20);
    if (!this.mappedRange(owner + 216, 4)) return;
    const width = p.load(owner + 216),
      before = p.load(frame - 8);
    if (before >= width) return;
    const count = width - before,
      instructions = count * 40,
      size = count * 4,
      a = this.reg('EDX'),
      b = this.reg('ESI'),
      destination = this.reg('EDI');
    if (
      instructions > this.availableInstructions() ||
      !this.mappedRange(a, size) ||
      !this.mappedRange(b, size) ||
      !this.mappedRange(destination, size, true)
    )
      return;
    // Shifted aliases can read bytes just written by an earlier iteration.
    // Leave those cases to the original forward loop.
    if (
      [a, b].some(
        (source) =>
          (source !== destination && overlaps(source, size, destination, size)) ||
          overlaps(source, size, frame - 12, 8),
      ) ||
      overlaps(owner + 216, 4, frame - 12, 8) ||
      overlaps(destination, size, frame - 44, 44) ||
      overlaps(destination, size, owner + 216, 4)
    )
      return;
    const first = p.read(a, size),
      second = p.read(b, size),
      output = new Uint8Array(size),
      alpha = p.load(frame - 4),
      initialAlpha = this.reg('EAX'),
      inverse = this.reg('EBX');
    for (let i = 0; i < size; i++)
      output[i] =
        (Math.imul(first[i], inverse) + Math.imul(second[i], i ? alpha : initialAlpha)) >>> 8;
    if (!p.consumeInstructions(instructions - 1)) return;
    p.write(destination, output);
    p.store(frame - 8, width);
    p.store(frame - 12, width);
    this.reg('EDX', a + size);
    this.reg('ESI', b + size);
    this.reg('EDI', destination + size);
    this.reg('EAX', alpha);
    this.reg('ECX', width);
    this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
    this.reg('EIP', 0x59c79d);
  }
  alpha() {
    const p = this.process,
      frame = this.reg('EBP'),
      owner = this.reg('EDI');
    if (!this.mappedRange(frame - 4, 4) || !this.mappedRange(owner + 216, 4)) return;
    const width = p.load(owner + 216),
      before = this.reg('ESI');
    if (before >= width) return;
    const count = width - before,
      instructions = count * 16,
      size = count * 4,
      source = this.reg('ECX'),
      destination = this.reg('EDX');
    if (
      instructions > this.availableInstructions() ||
      !this.mappedRange(source, size) ||
      !this.mappedRange(destination, size, true)
    )
      return;
    if (
      (source !== destination && overlaps(source, size, destination, size)) ||
      overlaps(destination, size, frame - 4, 4) ||
      overlaps(destination, size, owner + 216, 4)
    )
      return;
    const output = p.read(source, size),
      inverse = p.load(frame - 4);
    for (let i = 3; i < size; i += 4) output[i] = Math.imul(output[i], inverse) >>> 8;
    if (!p.consumeInstructions(instructions - 1)) return;
    p.write(destination, output);
    this.reg('ECX', source + size);
    this.reg('EDX', destination + size);
    this.reg('ESI', width);
    this.reg('EAX', width);
    this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
    this.reg('EIP', 0x59c8ba);
  }
  transparent() {
    const p = this.process,
      owner = this.reg('EDI'),
      frame = this.reg('EBP');
    if (!this.mappedRange(owner + 216, 4)) return;
    const width = p.load(owner + 216),
      before = this.reg('ESI');
    if (before >= width) return;
    const count = width - before,
      size = count * 4,
      a = this.reg('EDX'),
      b = this.reg('EAX');
    if (
      count * 11 > this.availableInstructions() ||
      !this.mappedRange(a, size, true) ||
      !this.mappedRange(b, size, true)
    )
      return;
    if (
      (a !== b && overlaps(a, size, b, size)) ||
      [a, b].some(
        (address) =>
          overlaps(address, size, owner + 216, 4) || overlaps(address, size, frame - 4, 4),
      )
    )
      return;
    const first = p.read(a, size),
      second = p.read(b, size),
      firstRuns = [],
      secondRuns = [],
      color = (bytes, i) =>
        (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
    let ecx = this.reg('ECX'),
      ebx = this.reg('EBX'),
      instructions = 0,
      firstStart = -1,
      secondStart = -1;
    for (let i = 0; i < size; i += 4) {
      const aa = first[i + 3],
        ba = second[i + 3],
        writeFirst = aa === 0 && ba !== 0,
        writeSecond = aa !== 0 && ba === 0;
      // A transparent first pixel executes an extra test and branch.
      // Copying either color adds one load and two stores.
      instructions += aa === 0 ? 13 : 11;
      ecx = (ecx & 0xffffff00) | ba;
      ebx |= ba;
      if (writeFirst) {
        instructions += 3;
        ecx = color(second, i);
        first.set(second.subarray(i, i + 3), i);
      } else if (writeSecond) {
        instructions += 3;
        ecx = color(first, i);
        second.set(first.subarray(i, i + 3), i);
      }
      if (writeFirst && firstStart < 0) firstStart = i;
      else if (!writeFirst && firstStart >= 0) {
        firstRuns.push([firstStart, i]);
        firstStart = -1;
      }
      if (writeSecond && secondStart < 0) secondStart = i;
      else if (!writeSecond && secondStart >= 0) {
        secondRuns.push([secondStart, i]);
        secondStart = -1;
      }
    }
    if (firstStart >= 0) firstRuns.push([firstStart, size]);
    if (secondStart >= 0) secondRuns.push([secondStart, size]);
    if (!p.consumeInstructions(instructions - 1)) return;
    for (const [address, bytes, runs] of [
      [a, first, firstRuns],
      [b, second, secondRuns],
    ])
      for (const [start, end] of runs) p.write(address + start, bytes.subarray(start, end));
    this.reg('EAX', b + size);
    this.reg('EDX', a + size);
    this.reg('ESI', width);
    this.reg('ECX', ecx);
    this.reg('EBX', ebx);
    this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
    this.reg('EIP', 0x59c9ae);
  }
  index(address, counterRegister, endRegister) {
    const counter = this.reg(counterRegister) | 0,
      target = this.reg('EDX') | 0,
      pointer = this.reg('ESI'),
      end = this.reg(endRegister);
    if (counter >= target || end <= pointer || (end - pointer) % 8) return;
    const steps = Math.min((end - pointer) / 8, target - counter),
      next = pointer + steps * 8,
      // If the counter wins, the next CMP/JGE leaves before advancing ESI.
      instructions = steps * 6 + (next === end ? 0 : 2);
    if (!this.process.consumeInstructions(instructions - 1)) return;
    this.reg(counterRegister, counter + steps);
    this.reg('ESI', next);
    this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
    this.reg('EIP', address + 12);
  }
  shift(address) {
    const p = this.process,
      source = this.reg('ESI'),
      destination = this.reg('ECX'),
      end = this.reg('EDX'),
      size = end - source;
    // Each eight-byte entry executes eight instructions.
    if (
      size <= 0 ||
      size % 8 ||
      size > this.availableInstructions() ||
      !this.mappedRange(source, size) ||
      !this.mappedRange(destination, size, true) ||
      (destination > source && overlaps(source, size, destination, size))
    )
      return;
    const last = p.load(end - 4),
      output = p.read(source, size);
    if (!p.consumeInstructions(size - 1)) return;
    p.write(destination, output);
    this.reg('ESI', end);
    this.reg('ECX', destination + size);
    this.reg('EAX', last);
    this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
    this.reg('EIP', address + 21);
  }
  close() {
    for (const detach of this.detachers) detach();
    this.detachers = [];
  }
}
