// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { NativeKCSMemory } from '../../src/native/kcs-memory.mjs';
import { NATIVE_EXE_PROFILES } from '../../src/native/catalog.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { dataWorld } from './data-world.mjs';

export async function observeDataSequence(
  profile,
  steps,
  { engine, files = {}, setup, random = false, storage, observe, rawRanges = [] } = {},
) {
  const world = await dataWorld(profile, files, { storage }),
    m = world.main.machine,
    values = new Map(),
    live = new Map(),
    observations = [];
  let buffers, caller, list, head, cleanup;
  if (engine) {
    buffers =
      engine.features.get('data-buffers') ??
      new NativeDataBuffers(engine, { handles: new NativeHandles() });
    const readers = engine.features.get('engine-files') ?? new NativeEngineFiles(engine, world);
    readers.world = world;
    const p = engine.process;
    caller = p.allocate(160, true);
    list = p.allocate(8, true);
    head = p.allocate(12, true);
    p.store(caller + 152, list);
    p.store(list, head);
    p.store(head, head);
    p.store(head + 4, head);
  }
  if (setup) cleanup = await setup(world, engine, values);
  async function original(id, args) {
    const p = engine.process,
      bridge = new NativeKCSMemory(p, m),
      argv = p.allocate(Math.max(4, args.length * 4), true),
      out = p.allocate(12, true);
    try {
      args.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      const control = await engine.call(
        p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4),
        [bridge.pointer, caller, argv, out + 4],
      );
      assert.equal(p.load(out), 0xcccccccc);
      assert.equal(p.load(out + 8), 0xcccccccc);
      if (control === 2) assert.equal(p.load(out + 4), 0xcccccccc);
      return { control, ...(control === 1 ? { value: p.load(out + 4) } : {}) };
    } finally {
      bridge.close();
      p.free(argv);
      p.free(out);
    }
  }
  try {
    for (const step of steps) {
      for (const [address, bytes] of step.write ?? []) m.bytes(address, bytes.length).set(bytes);
      const raw = engine ? engine.process : world.runtime.imageDataBuffers.process;
      for (const [name, offset, bytes] of step.writeRaw ?? [])
        raw.write(values.get(name) + offset, Uint8Array.from(bytes));
      const args = step.args.map((word) => (typeof word === 'string' ? values.get(word) : word));
      assert.ok(
        args.every((word) => Number.isInteger(word)),
        'resolved sequence inputs',
      );
      const reply = engine
        ? await original(step.id, args)
        : await world.runtime.native('main', step.id, args, m, world.main);
      if (step.capture) values.set(step.capture, reply.value);
      let value = reply.value;
      if (step.create) {
        values.set(step.create, value);
        if (value) live.set(step.create, step.type);
        value = value ? { handle: step.create, type: step.type } : 0;
      }
      if (step.pointer) {
        values.set(step.pointer, reply.value);
        value = reply.value ? { pointer: step.pointer } : 0;
      }
      if (step.release) live.delete(step.release);
      let bitmap;
      if (step.bitmap && reply.value) {
        if (engine) {
          const p = engine.process,
            at = p.load(reply.value),
            width = p.load(at + 4),
            height = p.load(at + 8),
            data = p.load(at + 12),
            stride = p.load(at + 20),
            bpp = p.load(at + 24),
            rgba = new Uint8Array(width * height * 4);
          for (let y = 0; y < height; y++) {
            const row = p.read(data + (height - y - 1) * stride, width * bpp);
            for (let x = 0; x < width; x++)
              rgba.set(
                [
                  row[x * bpp + 2],
                  row[x * bpp + 1],
                  row[x * bpp],
                  bpp === 4 ? row[x * bpp + 3] : 255,
                ],
                (y * width + x) * 4,
              );
          }
          bitmap = { width, height, rgba: [...rgba] };
          await buffers.releaseBitmapPointer(reply.value);
        } else {
          const image = world.graphics.images.get(reply.value);
          bitmap = { width: image.width, height: image.height, rgba: [...(await image.pixels())] };
        }
      }
      observations.push({
        id: step.id,
        control: reply.control,
        ...(Object.hasOwn(reply, 'value') ? { value } : {}),
        ...(bitmap ? { bitmap } : {}),
        memory: m.memory.slice(),
        shared: m.shared.slice(),
        blocks: m.blockIDs.map((_, i) => m.blockBytes(i).slice()),
        handles: [...live],
        ...(observe ? { external: await observe(world, engine, values) } : {}),
        ...(random ? { random: world.random.snapshot() } : {}),
        raw: (step.rawRanges ?? rawRanges).map(({ name, offset = 0, size }) => [
          ...raw.read(values.get(name) + offset, size),
        ]),
        task: { pc: m.pc, sp: m.sp, waiting: structuredClone(m.waiting), frame: world.frame },
      });
    }
    assert.ok(!world.nativeEngine, 'JS sequence World has no EXE');
    return observations;
  } finally {
    await cleanup?.();
    if (engine) for (const pointer of [caller, list, head]) engine.process.free(pointer);
    await world.close();
  }
}
