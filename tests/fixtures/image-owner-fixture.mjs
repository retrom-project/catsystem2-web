// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeImageOwners, nativeImageOwnerCodec } from '../../oracle/image-owner.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { nativeRectangleDefinitions } from '../../src/native/windows-rectangles.mjs';
import { NativeRetainedDraw } from '../../src/native/retained-draw.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
import { imageOwnerFiles } from './image-files.mjs';
export { imageOwnerFiles } from './image-files.mjs';

export async function imageOwnerFixture(bytes, profile, files) {
  files ??= await imageOwnerFiles();
  const engine = await NativeEngineProcess.open({
      bytes,
      profile,
      configuration: new NativeConfiguration({ profile }),
      readFile: async (name) => files.get(name) ?? null,
    }),
    p = engine.process,
    handles = new NativeHandles(),
    messages = [],
    uploads = [],
    platform = {
      // Explicit device boundary: original decoding, ANM and CPU composition
      // run here; the authored view has no device or file-cache state.
      refs: { view: p.allocate(280, true) },
      ensureRenderer: async () => platform.refs.view,
    },
    world = {
      profile,
      runtime: { handles },
      objects: { machine: () => null },
      game: { read: async (name) => files.get(name) ?? null },
      nativeTaskID: (id) => id,
      async sendNativeEngine(target, sender, message, w, l, context) {
        messages.push({
          target,
          sender,
          message,
          w,
          flags: context.flags,
          bytes: p.read(l, 60),
        });
        context.nativeRouted = target !== 0xffffffff;
        return undefined;
      },
    };
  handles.registerType('image-owner', nativeImageOwnerCodec);
  world.getNativeFeature = async (name) => {
    const existing = engine.features.get(name);
    if (existing) return existing;
    if (name === 'graphics-platform') return platform;
    if (name === 'data-buffers') return new NativeDataBuffers(engine, { handles });
    throw new Error('Image owner fixture missing ' + name);
  };
  for (const [name, definition] of nativeRectangleDefinitions(p))
    engine.registerWindows('USER32.dll', name, definition);
  const sdk = profile.startsWith('sdk-');
  engine.patch(
    sdk ? 0x54e790 : 0x677690,
    'authored image-owner VRAM upload',
    7,
    (args) => {
      uploads.push({ args, descriptor: p.read(args[0], 92) });
      return 1;
    },
    { calleePops: true },
  );
  engine.patch(
    sdk ? 0x54b6a0 : 0x6745b0,
    'authored image-owner VRAM clear',
    4,
    (args) => {
      uploads.push({ clear: args });
      return 1;
    },
    { calleePops: true },
  );
  new NativeEngineFiles(engine, world);
  new NativeDataBuffers(engine, { handles });
  new NativeRetainedDraw(engine, world);
  const images = new NativeImageOwners(engine, world),
    machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024));
  return {
    engine,
    process: p,
    handles,
    world,
    platform,
    images,
    machine,
    files,
    messages,
    uploads,
  };
}
