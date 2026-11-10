// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeBitmapMemory } from '../../src/native/bitmap-memory.mjs';
import { NativeImages } from '../../src/native/image.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { nativeRectangleDefinitions } from '../../src/native/windows-rectangles.mjs';
import { NativeBitmapOperations } from '../../src/native/bitmap-operations.mjs';
import { KCSMachine } from '../../src/kcs/vm.mjs';
import { Binary } from '../../src/binary.mjs';
export async function bitmapMemoryFixture(bytes, profile, { uploadBoundary = false } = {}) {
  const engine = await NativeEngineProcess.open({ bytes, profile }),
    world = {
      nativeEngine: engine,
      runtime: { handles: new NativeHandles() },
      graphics: {},
      images: {},
      objects: { machine: () => null },
    };
  const images = (world.graphics.images = new NativeImages(world));
  const uploads = [],
    view = uploadBoundary ? engine.process.allocate(0x118, true) : 0;
  if (uploadBoundary)
    engine.patch(
      profile.startsWith('sdk-') ? 0x54e790 : 0x677690,
      'authored bitmap operation VRAM upload',
      7,
      (args) => {
        const thisPointer = engine.process.cpu.reg_read_i32(engine.process.uc.X86_REG_ECX) >>> 0;
        if (thisPointer !== view) throw new Error('Bitmap upload requires its calling view');
        uploads.push({ args, thisPointer, metadata: engine.process.read(args[0], 92) });
        return 1;
      },
      { calleePops: true },
    );
  for (const [name, definition] of nativeRectangleDefinitions(engine.process))
    engine.registerWindows('USER32.dll', name, definition);
  const buffers = new NativeDataBuffers(engine, { handles: world.runtime.handles });
  world.getNativeFeature = async (name) => {
    if (uploadBoundary && name === 'graphics-platform')
      return { refs: { view }, ensureRenderer: async () => {} };
    const f = engine.features.get(name);
    if (!f) throw new Error('Bitmap memory fixture lacks ' + name);
    return f;
  };
  const memory = new NativeBitmapMemory(engine, world);
  const operations = new NativeBitmapOperations(engine, world),
    machine = new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(4096),
        stackSize: 4096,
      },
      {},
      new Uint8Array(1024),
    );
  return {
    engine,
    process: engine.process,
    world,
    images,
    memory,
    buffers,
    handles: world.runtime.handles,
    operations,
    machine,
    uploads,
    view,
  };
}
