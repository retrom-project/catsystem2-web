// SPDX-License-Identifier: MPL-2.0
import { BICUBIC_OPERATIONS } from './bicubic-operations.mjs';
import { BicubicKernel } from './bicubic-kernel.mjs';
import { NativeEmoteMeshBlocks } from './native-mesh.mjs';
// Numerical execution shortcuts for a reviewed driver. Every scalar/packed
// operation retains the original SSE order and its individual float32 round.
const driverIdentity = '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce';
const minimumNormal = 2 ** -126;
const overlap = (a, n, b, m) => a < b + m && b < a + n;

export class NativeEmoteBlocks {
  constructor(device) {
    this.process = device.process;
    this.services = device.services;
    this.base = device.module.base;
    this.enabled = true;
    this.hits = 0;
    this.points = 0;
    if (device.identity !== driverIdentity) return;
    this.reviewed = true;
    this.kernel = new BicubicKernel();
    const p = this.process,
      prefix = [0xf3, 0x0f, 0x10, 0x74, 0x24, 0x1c, 0x0f, 0x28, 0xea];
    if (!p.read(this.base + 0x3f2f0, prefix.length).every((v, i) => v === prefix[i]))
      throw new Error('The reviewed E-mote bicubic loop has changed');
    this.detach = p.beforeInstruction(this.base + 0x3f2f0, 'E-mote exact SSE bicubic loop', () => {
      if (this.enabled && this.execute()) this.hits++;
    });
    this.mesh = new NativeEmoteMeshBlocks(device, { enabled: () => this.enabled });
  }
  execute() {
    if (!this.reviewed) return false;
    const p = this.process,
      cpu = p.cpu,
      uc = p.uc,
      reg = (name) => cpu.reg_read_i32(uc['X86_REG_' + name]) >>> 0,
      mxcsr = reg('MXCSR');
    // Non-default rounding, DAZ/FTZ and unmasked exceptions remain on the CPU.
    if ((mxcsr & 0xffc0) !== 0x1f80) return false;
    const esp = reg('ESP'),
      edi = reg('EDI'),
      esi = reg('ESI'),
      edx = reg('EDX'),
      index = reg('ECX'),
      mapped = (a, n, write = false) => {
        if (
          !p.regions.some((region) => a >= region.address && a + n <= region.address + region.size)
        )
          return false;
        if (this.services.protectionAt)
          for (let page = Math.floor(a / 4096) * 4096; page < a + n; page += 4096) {
            const permissions = this.services.memoryPermissions(this.services.protectionAt(page));
            if (!(permissions & 1) || (write && !(permissions & 2))) return false;
          }
        return true;
      };
    // MOVAPS must retain its alignment fault, even on otherwise mapped bytes.
    if (esp % 16 || !mapped(esi, 8)) return false;
    const count = (p.load(esi + 4) - edx) >> 3,
      size = (count - index) * 8,
      start = edx + index * 8;
    if (
      count <= index ||
      count > 0x100000 ||
      !mapped(start, size, true) ||
      !mapped(esp + 24, 168) ||
      !mapped(edi + 68, 16) ||
      overlap(start, size, esp + 24, 168) ||
      overlap(start, size, edi + 68, 16) ||
      overlap(start, size, esi, 8)
    )
      return false;
    const stack = p.read(esp + 24, 168),
      sv = new DataView(stack.buffer, stack.byteOffset, stack.byteLength),
      control = p.read(edi + 68, 16),
      cv = new DataView(control.buffer, control.byteOffset, control.byteLength),
      bytes = p.read(start, size),
      data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      stackFloat = (offset) => sv.getFloat32(offset - 24, true),
      tables = Float64Array.from({ length: 36 }, (_, i) => stackFloat(48 + i * 4)),
      r = new Float64Array(36);
    for (let i = 0; i < 8; i++)
      r.set(new Float32Array(cpu.reg_read(uc['X86_REG_XMM' + i], 16).buffer), i * 4);
    r.set(tables.subarray(0, 4), 32);
    let status = mxcsr & 63;
    const invalid = Symbol(),
      finite = (value) => {
        if (!Number.isFinite(value)) throw invalid;
        return value;
      },
      denormal = (value) => value !== 0 && Math.abs(value) < minimumNormal,
      round = (exact, residual = 0) => {
        const value = finite(Math.fround(exact));
        if (value !== exact || residual !== 0) {
          status |= 32;
          if (
            Math.abs(exact) < minimumNormal ||
            (Math.abs(exact) === minimumNormal && Math.sign(exact) * residual < 0)
          )
            status |= 16;
        }
        return value;
      },
      add = (a, b) => {
        if ((status & 0x32) === 0x32) return finite(Math.fround(a + b));
        if (denormal(a) || denormal(b)) status |= 2;
        const sum = a + b;
        if (status & 32 && Math.abs(sum) > minimumNormal) return finite(Math.fround(sum));
        // TwoSum retains an addend too small for a float64 sum. SSE still
        // raises precision, and tininess is detected before float32 rounding.
        const difference = sum - a;
        return round(sum, a - (sum - difference) + (b - difference));
      },
      multiply = (a, b) => {
        if ((status & 0x32) === 0x32) return finite(Math.fround(a * b));
        if (denormal(a) || denormal(b)) status |= 2;
        // A product of finite float32 inputs is exact in float64.
        return round(a * b);
      },
      move = (d, s) => r.copyWithin(d * 4, s * 4, s * 4 + 4),
      load = (d, value) => {
        r[d * 4] = finite(value);
        r.fill(0, d * 4 + 1, d * 4 + 4);
      },
      table = (d, offset) => {
        const begin = (offset - 48) / 4;
        for (let i = 0; i < 4; i++) r[d * 4 + i] = tables[begin + i];
      },
      scalar = (d, value, operation) => (r[d * 4] = operation(r[d * 4], finite(value))),
      packed = (d, s, operation) => {
        for (let i = 0; i < 4; i++) r[d * 4 + i] = operation(r[d * 4 + i], r[s * 4 + i]);
      },
      shuffle = (d, s, mask) => {
        const a = r[d * 4 + (mask & 3)],
          b = r[d * 4 + ((mask >>> 2) & 3)],
          c = r[s * 4 + ((mask >>> 4) & 3)],
          e = r[s * 4 + ((mask >>> 6) & 3)];
        r[d * 4] = a;
        r[d * 4 + 1] = b;
        r[d * 4 + 2] = c;
        r[d * 4 + 3] = e;
      },
      unpack = (d, s) => {
        const a = r[d * 4],
          b = r[s * 4],
          c = r[d * 4 + 1],
          e = r[s * 4 + 1];
        r[d * 4] = a;
        r[d * 4 + 1] = b;
        r[d * 4 + 2] = c;
        r[d * 4 + 3] = e;
      };
    try {
      for (const value of tables) finite(value);
      for (const offset of [8, 28]) for (let i = 0; i < 4; i++) finite(r[offset + i]);
      const c = Array.from({ length: 4 }, (_, i) => finite(cv.getFloat32(i * 4, true))),
        one = finite(new DataView(p.read(this.base + 0x7dfac, 4).buffer).getFloat32(0, true));
      const accelerated = this.kernel.execute({
        mxcsr,
        count: count - index,
        stack,
        control,
        registerValues: r,
        one,
        bytes,
      });
      if (accelerated) {
        bytes.set(accelerated.bytes);
        r.set(accelerated.registers);
      } else
        for (let i = 0; i < count - index; i++) {
          for (const [operation, d, a, b] of BICUBIC_OPERATIONS) {
            switch (operation) {
              case 'stack':
                load(d, stackFloat(a));
                break;
              case 'control':
                load(d, c[a]);
                break;
              case 'coordAdd':
                scalar(d, data.getFloat32(i * 8 + a * 4, true), add);
                break;
              case 'controlMul':
                scalar(d, c[a], multiply);
                break;
              case 'scalarAdd':
                scalar(d, r[a * 4], add);
                break;
              case 'scalarSub':
                scalar(d, -r[a * 4], add);
                break;
              case 'scalarMul':
                scalar(d, r[a * 4], multiply);
                break;
              case 'move':
                move(d, a);
                break;
              case 'unpack':
                unpack(d, a);
                break;
              case 'table':
                table(d, a);
                break;
              case 'add':
                packed(d, a, add);
                break;
              case 'multiply':
                packed(d, a, multiply);
                break;
              case 'shuffle':
                shuffle(d, a, b);
                break;
              case 'one':
                load(d, one);
                break;
              case 'store':
                data.setFloat32(i * 8 + d * 4, r[a * 4], true);
                break;
              default:
                throw new Error('Unknown bicubic operation ' + operation);
            }
          }
        }
    } catch (error) {
      // No guest state has changed; exceptional inputs execute original SSE.
      if (error === invalid) return false;
      throw error;
    }
    p.write(start, bytes);
    for (let i = 0; i < 8; i++)
      cpu.reg_write(
        uc['X86_REG_XMM' + i],
        new Uint8Array(Float32Array.from(r.subarray(i * 4, i * 4 + 4)).buffer),
      );
    for (const name of ['EAX', 'ECX']) cpu.reg_write_i32(uc['X86_REG_' + name], count);
    cpu.reg_write_i32(uc.X86_REG_MXCSR, (mxcsr & ~63) | status);
    cpu.reg_write_i32(uc.X86_REG_EFLAGS, (reg('EFLAGS') & ~0x8d5) | 0x44);
    cpu.reg_write_i32(uc.X86_REG_EIP, this.base + 0x3f46f);
    this.points += count - index;
    return true;
  }
  close() {
    this.mesh?.close();
    this.detach?.();
  }
}
