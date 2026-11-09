// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../kcs.mjs';
import { nearestX87Precision } from '../ppi/floating-point.mjs';
import { nativeParticleNear } from '../ppi/native-projection-math.mjs';
import { projectionBounds } from '../ppi/numeric.mjs';

const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    entry: 0x65b190,
    dispatch: 0xb32e08,
    scalar: [0x4cfd00, 0x4cff86, 0x4d04ac],
  },
  'sdk-4.01-engine-2.6.1.74': {
    entry: 0x52b0d0,
    dispatch: 0xc3bba8,
    scalar: [0x413934, 0x413bba, 0x4140e0],
  },
};

export function nativeParticleBounds(engine, z, width, height, priority) {
  if (!engine) return projectionBounds(z, width, height, priority);
  const p = engine.process,
    layout = layouts[engine.profile];
  if (!layout) throw new Error('Unknown original PTCL screen bounds layout');
  const precision = nearestX87Precision(p);
  if (
    precision &&
    Number.isFinite(z) &&
    [2, 3, 19].every((slot, i) => p.load(layout.dispatch + slot * 4) === layout.scalar[i])
  ) {
    const bounds = projectionBounds(z, width, height, priority, precision);
    if (bounds.every(Number.isFinite)) return bounds;
  }
  if (p.asyncEnabled) throw new Error('Original PTCL screen bounds require a settled task tick');
  const task = p.allocate(0x400, true),
    view = task + 0x350,
    vm = view + 0x20,
    args = vm + 0x40,
    output = args + 20,
    registers = p.registers();
  try {
    // The raw slot reads the view size and the loaded task's two depth
    // fields. Its VM translator writes four words into a local data region.
    p.store(task + 104, view);
    p.store(task + 824, floatBits(priority));
    p.store(task + 828, floatBits(nativeParticleNear(priority)));
    p.store(view + 24, width);
    p.store(view + 28, height);
    p.store(vm + 20, output);
    p.store(vm + 36, 16);
    p.store(args, floatBits(z));
    for (let i = 0; i < 4; i++) p.store(args + 4 + i * 4, i * 4);
    if (p.call(layout.entry, [vm, task, args, 0]) !== 2)
      throw new Error('Original PTCL screen bounds did not return its void control');
    const bytes = p.read(output, 16);
    return [...new Float32Array(bytes.buffer, bytes.byteOffset, 4)];
  } finally {
    p.writeRegisters(registers);
    p.zero(task, 0x400);
    p.free(task);
  }
}
