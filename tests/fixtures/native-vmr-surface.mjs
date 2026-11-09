// SPDX-License-Identifier: MPL-2.0
import { EmoteD3D9 } from '../../src/emote/native-d3d.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { nativeRectangleDefinitions } from '../../src/native/windows-rectangles.mjs';

export const profiles = [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x686010, 0x6867d0, 0xb90778],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x55caf0, 0x55d2b0, 0xc95180],
];

export const com = (process, object, slot, ...args) =>
  process.call(process.load(process.load(object) + slot * 4), [object, ...args]);

export function expectedVMRFrame(format) {
  const frame = [];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const column = x >> 1,
        row = y >> 1;
      frame.push(
        0x30 + column * 21,
        0x50 + row * 45,
        0x20 + column * 15 + row * 31,
        format === 21 ? 0x41 + row * 70 : 255,
      );
    }
  return frame;
}

export async function probeVMRSurface(
  [profile, , ctor, present, coreGlobal],
  bytes,
  gpu,
  freshGPU,
) {
  const create = async (gpu) => {
    const engine = await NativeEngineProcess.open({ profile, bytes }),
      p = engine.process,
      d = new EmoteD3D9(p, { width: 4, height: 4 });
    for (const [name, definition] of nativeRectangleDefinitions(p))
      engine.registerWindows('USER32.dll', name, definition);
    if (gpu) d.attachGPU(gpu);
    engine.registerFeature('authored-vmr-d3d', d);
    return { engine, p, d, gpu };
  };
  const original = await create(gpu);
  let fresh;
  try {
    const { engine, p, d } = original,
      output = p.allocate(16, true),
      target = p.allocate(32, true),
      core = p.allocate(0x670, true),
      allocation = p.allocate(0xb0, true),
      info = p.allocate(56, true);
    const makeTexture = (width, height, usage, format) => {
      const status = com(p, d.device, 23, width, height, 1, usage, format, 0, output, 0);
      if (status) throw new Error(`Authored CreateTexture failed: ${status.toString(16)}`);
      const texture = p.load(output);
      if (com(p, texture, 18, 0, output)) throw new Error('Authored GetSurfaceLevel failed');
      return [texture, p.load(output)];
    };
    const [destination, destinationSurface] = makeTexture(4, 4, 1, 21),
      [decoder, decoderSurface] = makeTexture(2, 2, 0, 21);
    if (com(p, d.device, 36, 2, 2, 22, 0, output, 0))
      throw new Error('Authored CreateOffscreenPlainSurface failed');
    const decoderPlain = p.load(output);
    for (const [surface, format] of [
      [decoderSurface, 21],
      [decoderPlain, 22],
    ]) {
      if (com(p, surface, 13, output, 0, 0)) throw new Error('Authored LockRect failed');
      const pixels = p.load(output + 4);
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++)
          p.write(pixels + y * p.load(output) + x * 4, [
            0x20 + x * 15 + y * 31,
            0x50 + y * 45,
            0x30 + x * 21,
            format === 21 ? 0x41 + y * 70 : 0x13,
          ]);
      if (com(p, surface, 14)) throw new Error('Authored UnlockRect failed');
    }
    p.store(coreGlobal, core);
    p.store(core + 0x134, d.device);
    p.store(target + 20, destination);
    const ctorResult = await engine.call(ctor, [], allocation),
      // The image presenter is a secondary stdcall COM interface.
      presenter = allocation + 4,
      slot = p.load(p.load(presenter) + 20);
    p.store(presenter + 12, target);
    p.store(presenter + 0x48, 0);
    const addresses = [decoder, decoderSurface, decoderPlain, destination, destinationSurface];
    const refs = (device) => addresses.map((pointer) => device.objects.get(pointer)?.references);
    const before = refs(d);
    const frame = async ({ engine, p, d, gpu }, source) => {
      p.store(info + 4, source);
      p.store(presenter + 0x4c, 0);
      p.store(presenter + 0x98, 0);
      const status = await engine.call(slot, [presenter, 0, info]);
      return {
        status,
        bytes: [...d.frame(destination).rgba],
        gpu: gpu ? [...gpu.pixels(d.gpuTarget(destinationSurface))] : null,
        flags: [p.load(presenter + 0x4c), p.load(presenter + 0x98)],
        refs: refs(d),
      };
    };
    const texture = await frame(original, decoderSurface),
      saved = engine.snapshot();
    fresh = await create(freshGPU);
    fresh.engine.restore(saved);
    const restored = {
      bytes: [...fresh.d.frame(destination).rgba],
      gpu: freshGPU ? [...freshGPU.pixels(fresh.d.gpuTarget(destinationSurface))] : null,
      refs: refs(fresh.d),
    };
    const plain = await frame(original, decoderPlain),
      freshPlain = await frame(fresh, decoderPlain);
    for (const context of [original, fresh]) {
      const { p } = context;
      for (const pointer of [
        decoderSurface,
        decoder,
        decoderPlain,
        destinationSurface,
        destination,
      ])
        com(p, pointer, 2);
    }
    return {
      constructed: ctorResult === allocation,
      originalSlot: slot === present,
      before,
      texture,
      restored,
      plain,
      freshPlain,
      destroyed: [original, fresh].every(({ d }) =>
        addresses.every((pointer) => !d.objects.has(pointer)),
      ),
      calls: [
        d.calls.get('Surface9.GetContainer'),
        d.calls.get('Device9.StretchRect'),
        fresh.d.calls.get('Surface9.GetContainer'),
        fresh.d.calls.get('Device9.StretchRect'),
      ],
    };
  } finally {
    await fresh?.engine.close();
    await original.engine.close();
  }
}
