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
          if (this.enabled) execute();
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
  mapped(address, size) {
    return this.process.regions.some(
      (region) => address >= region.address && address + size <= region.address + region.size,
    );
  }
  scan() {
    const p = this.process;
    let address = this.reg('ECX');
    for (;;) {
      const region = p.regions.find(
        (region) => address >= region.address && address < region.address + region.size,
      );
      // Preserve the original instruction's fault behavior for unmapped input.
      if (!region) return;
      const bytes = p.read(address, Math.min(4096, region.address + region.size - address)),
        end = bytes.indexOf(0);
      if (end >= 0) {
        this.reg('ECX', address + end + 1);
        this.reg('EAX', this.reg('EAX') & 0xffffff00);
        this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
        this.reg('EIP', 0x787847);
        return;
      }
      address += bytes.length;
      if (address > 0xffffffff) return;
    }
  }
  blend() {
    const p = this.process,
      frame = this.reg('EBP');
    if (!this.mapped(frame - 44, 44)) return;
    const owner = p.load(frame - 20);
    if (!this.mapped(owner + 216, 4)) return;
    const width = p.load(owner + 216),
      before = p.load(frame - 8);
    if (before >= width) return;
    const count = width - before,
      size = count * 4,
      a = this.reg('EDX'),
      b = this.reg('ESI'),
      destination = this.reg('EDI');
    if (![a, b, destination].every((address) => this.mapped(address, size))) return;
    // Shifted aliases can read bytes just written by an earlier iteration.
    // Leave those cases to the original forward loop.
    if (
      [a, b].some(
        (source) => source !== destination && overlaps(source, size, destination, size),
      ) ||
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
    if (!this.mapped(frame - 4, 4) || !this.mapped(owner + 216, 4)) return;
    const width = p.load(owner + 216),
      before = this.reg('ESI');
    if (before >= width) return;
    const size = (width - before) * 4,
      source = this.reg('ECX'),
      destination = this.reg('EDX');
    if (![source, destination].every((address) => this.mapped(address, size))) return;
    if (
      (source !== destination && overlaps(source, size, destination, size)) ||
      overlaps(destination, size, frame - 4, 4) ||
      overlaps(destination, size, owner + 216, 4)
    )
      return;
    const output = p.read(source, size),
      inverse = p.load(frame - 4);
    for (let i = 3; i < size; i += 4) output[i] = Math.imul(output[i], inverse) >>> 8;
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
    if (!this.mapped(owner + 216, 4)) return;
    const width = p.load(owner + 216),
      before = this.reg('ESI');
    if (before >= width) return;
    const size = (width - before) * 4,
      a = this.reg('EDX'),
      b = this.reg('EAX');
    if (![a, b].every((address) => this.mapped(address, size))) return;
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
      firstStart = -1,
      secondStart = -1;
    for (let i = 0; i < size; i += 4) {
      const aa = first[i + 3],
        ba = second[i + 3],
        writeFirst = aa === 0 && ba !== 0,
        writeSecond = aa !== 0 && ba === 0;
      ecx = (ecx & 0xffffff00) | ba;
      ebx |= ba;
      if (writeFirst) {
        ecx = color(second, i);
        first.set(second.subarray(i, i + 3), i);
      } else if (writeSecond) {
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
    const steps = Math.min((end - pointer) / 8, target - counter);
    this.reg(counterRegister, counter + steps);
    this.reg('ESI', pointer + steps * 8);
    this.reg('EFLAGS', (this.reg('EFLAGS') & ~arithmeticFlags) | 0x44);
    this.reg('EIP', address + 12);
  }
  shift(address) {
    const p = this.process,
      source = this.reg('ESI'),
      destination = this.reg('ECX'),
      end = this.reg('EDX'),
      size = end - source;
    if (size <= 0 || size % 8 || ![source, destination].every((a) => this.mapped(a, size))) return;
    if (destination > source && overlaps(source, size, destination, size)) return;
    const last = p.load(end - 4);
    p.write(destination, p.read(source, size));
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
