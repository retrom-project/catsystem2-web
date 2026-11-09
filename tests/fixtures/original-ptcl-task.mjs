// SPDX-License-Identifier: MPL-2.0
// Run the fixed PE's original particle receiver and frame callback.
import { encodeCP932, floatBits } from '../../src/kcs.mjs';

const profiles = {
  'sdk-4.01-engine-2.6.1.74': {
    construct: 0x4cf400,
    frame: 0x4cff50,
    receive: 0x4d06f0,
    offset: 5,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    construct: 0x5f4b50,
    frame: 0x5f56a0,
    receive: 0x5f5eb0,
    offset: 0,
  },
};

export const particleFields = [
  ['quads', 784, 112],
  ['backupQuads', 788, 112],
  ['positions', 792, 16],
  ['bases', 796, 16],
  ['rotations', 800, 16],
  ['scales', 804, 16],
  ['visibility', 808, 4],
];

export async function originalPTCLTask(engine, view, spec) {
  const profile = profiles[engine.profile],
    p = engine.process,
    task = p.allocate(0x600, true),
    packet = p.allocate(0x290, true),
    name = p.allocate(32, true),
    out = p.allocate(4, true);
  let constructed = false;
  const send = async (message, l = 0) => {
      if (
        (await engine.call(profile.receive, [0, message - profile.offset, 0, l, 0, out], task)) !==
        0
      )
        throw new Error('Original PTCL receiver did not handle the message');
    },
    close = async () => {
      try {
        if (constructed) await engine.call(p.load(p.load(task)), [1], task);
        else p.free(task);
      } finally {
        for (const pointer of [out, name, packet]) p.free(pointer);
      }
    };
  try {
    spec.bind?.(task);
    p.write(name, encodeCP932('Particle oracle\0'));
    if ((await engine.call(profile.construct, [spec.id ?? 713, name, 60, view], task)) !== task)
      throw new Error('Original PTCL construction did not return its task');
    constructed = true;
    p.write(packet + 4, encodeCP932(spec.program + '\0'));
    p.write(packet + 132, encodeCP932((spec.texture ?? '') + '\0'));
    p.store(packet + 260, spec.count);
    p.store(packet + 264, floatBits(spec.priority));
    spec.registers.forEach((value, i) => p.store(packet + 268 + i * 4, floatBits(value)));
    p.store(packet + 396, Number(spec.externalDraw ?? false));
    await send(314, packet);
    const vm = p.load(task + 116);
    if (!vm || !p.load(task + 784)) throw new Error('Original PTCL load did not initialize its VM');
    return {
      task,
      vm,
      send,
      step: (frame) => engine.call(profile.frame, [frame, 0], task),
      field: (offset, stride) => p.read(p.load(task + offset), spec.count * stride),
      data: (size) => p.read(p.load(vm + 20), size),
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      error.cleanup = cleanup;
    }
    throw error;
  }
}
