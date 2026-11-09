// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../kcs.mjs';
import { identity } from '../motion/matrix.mjs';
import { readPTCLQuad, writePTCLQuad } from '../ppi/abi.mjs';
import { particleDepthOrder } from '../ppi/geometry.mjs';
import { nativeParticleNear, projectNativeParticle } from '../ppi/native-projection-math.mjs';

const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    draw: 0x5f5280,
    calls: [0x5f5340, 0x5f5357, 0x5f5663],
    targets: [0x672f60, 0x671df0, 0x67c450],
    dispatch: 0xb32e08,
    baseline: [0x4cfd00, 0x4cff86, 0x4d091d, 0x4d09a1, 0x4d0a43, 0x4d0ae6, 0x4d0889],
  },
  'sdk-4.01-engine-2.6.1.74': {
    draw: 0x4cfb30,
    calls: [0x4cfbf0, 0x4cfc07, 0x4cff13],
    targets: [0x549d80, 0x548c10, 0x5530f0],
    dispatch: 0xc3bba8,
    baseline: [0x413934, 0x413bba, 0x414551, 0x4145d5, 0x414677, 0x41471a, 0x4144bd],
  },
};
const dispatchSlots = [2, 3, 27, 31, 32, 33, 34];
const trigEntry = 0x01100000;
// cdecl (float* angles, float* cosSin, unsigned count).
// Load EAX/EDX/ECX from the arguments, exit if count is zero, then repeat
// FLD [EAX]; FSINCOS; FSTP [EDX]; FSTP [EDX+4]; EAX += 4; EDX += 8; --ECX.
const trigCode = Uint8Array.from(
  [
    [0x8b, 0x44, 0x24, 4], // mov eax, [esp+4]
    [0x8b, 0x54, 0x24, 8], // mov edx, [esp+8]
    [0x8b, 0x4c, 0x24, 12], // mov ecx, [esp+12]
    [0x85, 0xc9], // test ecx, ecx
    [0x74, 0x12], // jz return
    [0xd9, 0], // loop: fld dword [eax]
    [0xd9, 0xfb], // fsincos
    [0xd9, 0x1a], // fstp dword [edx]
    [0xd9, 0x5a, 4], // fstp dword [edx+4]
    [0x83, 0xc0, 4], // add eax, 4
    [0x83, 0xc2, 8], // add edx, 8
    [0x49], // dec ecx
    [0x75, 0xee], // jnz loop
    [0xc3], // return
  ].flat(),
);

export class NativeParticleProjection {
  constructor(engine) {
    this.engine = engine;
    this.process = engine.process;
    this.layout = layouts[engine.profile];
    if (!this.layout) throw new Error('Unknown original particle projection layout');
    const p = this.process;
    p.map(trigEntry, 4096, 'particle-trigonometry', p.uc.PROT_READ | p.uc.PROT_EXEC);
    p.write(trigEntry, trigCode);
    this.detachers = [];
    for (const [i, address] of this.layout.calls.entries()) {
      const code = p.read(address, 5);
      if (
        code[0] !== 0xe8 ||
        address + 5 + new DataView(code.buffer, code.byteOffset, 5).getInt32(1, true) !==
          this.layout.targets[i]
      )
        throw new Error('Original particle projection call site differs');
      this.detachers.push(
        p.beforeInstruction(address, 'particle projection output ' + i, () => {
          if (!this.output || this.reg('EDI') !== this.output.task) return;
          const stack = this.reg('ESP');
          if (i === 2) {
            const { order, geometry } = this.output;
            const rank = this.reg('EBX');
            geometry.push({
              index: order[rank].index,
              vertices: readPTCLQuad(p.read(p.load(stack + 8), 112)),
            });
          }
          // Texture bind, render state and DrawUP are submitted by the
          // existing shared renderer. This call only produces vertices.
          this.reg('ESP', stack + [8, 12, 24][i]);
          this.reg('EIP', address + 5);
        }),
      );
    }
    engine.registerFeature('particle-projection', this);
  }
  reg(name, value) {
    const p = this.process,
      register = p.uc['X86_REG_' + name];
    if (value === undefined) return p.cpu.reg_read_i32(register) >>> 0;
    p.cpu.reg_write_i32(register, value);
  }
  precision() {
    const control = this.reg('FPCW');
    if (
      (control !== 0x7f && control !== 0x27f) ||
      (this.reg('MXCSR') & ~0x3f) !== 0x1f80 ||
      this.reg('FPTAG') !== 0xffff
    )
      return 0;
    const bytes = this.process.read(this.layout.dispatch, 35 * 4),
      dispatch = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      !dispatchSlots.every(
        (slot, i) => dispatch.getUint32(slot * 4, true) === this.layout.baseline[i],
      )
    )
      return 0;
    return control === 0x7f ? 24 : 53;
  }
  call(address, args) {
    const p = this.process;
    if (p.asyncEnabled) return this.engine.callFromHost(address, args);
    const registers = p.registers();
    try {
      return p.call(address, args);
    } finally {
      p.writeRegisters(registers);
    }
  }
  async trig(angles) {
    const table = new Map();
    if (!angles.size) return table;
    const p = this.process,
      length = angles.size * 4,
      pointer = p.allocate(length * 3);
    try {
      p.write(pointer, new Uint8Array(Float32Array.from(angles).buffer));
      await this.call(trigEntry, [pointer, pointer + length, angles.size]);
      const bytes = p.read(pointer + length, length * 2),
        results = new Float32Array(bytes.buffer, bytes.byteOffset, angles.size * 2);
      let i = 0;
      for (const angle of angles) {
        table.set(angle, [results[i], results[i + 1]]);
        i += 2;
      }
      return table;
    } finally {
      p.zero(pointer, length * 3);
      p.free(pointer);
    }
  }
  async geometry(particles, options) {
    const p = this.process;
    if (!p.asyncEnabled && this.engine.pendingCalls) await this.engine.queue;
    const normalized = {
      ...options,
      screenMatrix: options.screenMatrix ?? identity(),
      screenShift: options.screenShift ?? [0, 0],
    };
    const shifts = options.zShifts || [],
      order = particleDepthOrder(particles, shifts).flatMap(({ index }, rank) =>
        particles[index].disp
          ? [{ index, particle: particles[index], zShift: shifts[rank] || 0 }]
          : [],
      );
    if (!order.length || options.alpha === 0) return [];
    const precision = this.precision(),
      angles = new Set();
    if (!precision) return this.original(order, normalized);
    for (const { particle } of order) {
      for (const angle of particle.rot) {
        if (!Number.isFinite(angle) || Math.abs(angle) >= 2 ** 63)
          return this.original(order, normalized);
        if (angle) angles.add(angle);
      }
    }
    const table = await this.trig(angles),
      sincos = (angle) => table.get(angle),
      geometry = [];
    for (const { index, particle, zShift } of order) {
      const vertices = projectNativeParticle(
        particle,
        { ...normalized, zShift },
        sincos,
        precision,
      );
      if (!vertices || vertices.some(({ x, y, z, w }) => ![x, y, z, w].every(Number.isFinite)))
        return this.original(order, normalized);
      geometry.push({ index, vertices });
    }
    return geometry;
  }
  async original(order, options) {
    if (this.output) throw new Error('Original particle projection is already executing');
    const p = this.process,
      count = order.length,
      size = 0x700 + 196 * count,
      task = p.allocate(size, true);
    try {
      const view = task + 0x568,
        manager = task + 0x588,
        block = task + 0x700,
        bytes = p.view(block, size - 0x700),
        data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const vector = ['pos', 'base', 'rot', 'scale'];
      for (const [i, { particle, zShift }] of order.entries()) {
        writePTCLQuad(
          bytes,
          particle.vertices.map((v) => ({ ...v, w: v.w ?? 1 })),
          i * 112,
        );
        for (const [j, field] of vector.entries())
          for (let k = 0; k < 3; k++)
            data.setFloat32(count * (112 + 16 * j) + 16 * i + 4 * k, particle[field][k], true);
        data.setUint32(count * 176 + i * 4, 1, true);
        data.setUint32(count * 180 + i * 8 + 4, i, true);
        data.setUint32(count * 188 + i * 4, block + count * 180 + i * 8, true);
        data.setFloat32(count * 192 + i * 4, zShift, true);
      }
      p.store(task + 104, view);
      p.store(task + 108, manager);
      p.store(task + 388, count);
      for (const [field, stride] of [
        [784, 0],
        [792, 112],
        [796, 128],
        [800, 144],
        [804, 160],
        [808, 176],
        [868, 188],
        [1340, 192],
      ])
        p.store(task + field, block + count * stride);
      p.store(task + 824, floatBits(options.priority));
      p.store(task + 828, floatBits(nativeParticleNear(options.priority)));
      p.store(task + 852, options.alpha);
      p.store(view + 24, options.width);
      p.store(view + 28, options.height);
      p.write(manager + 96, new Uint8Array(Float32Array.from(options.screenMatrix).buffer));
      p.write(manager + 228, new Uint8Array(Float32Array.from(options.screenShift).buffer));
      const geometry = [];
      this.output = { task, order, geometry };
      const result = await this.call(this.layout.draw, [task, 1]);
      if (result !== 1 || geometry.length !== count)
        throw new Error('Original particle projection did not produce every visible quad');
      return geometry;
    } finally {
      this.output = null;
      p.zero(task, size);
      p.free(task);
    }
  }
  snapshot() {
    if (this.output) throw new Error('Cannot checkpoint in-flight original particle projection');
    return null;
  }
  restore() {
    this.process.write(trigEntry, trigCode);
  }
  close() {
    for (const detach of this.detachers) detach();
    this.process.unmap(trigEntry);
  }
}
