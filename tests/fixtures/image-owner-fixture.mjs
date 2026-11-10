// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeImageOwners, nativeImageOwnerCodec } from '../../src/native/image-owner.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { nativeRectangleDefinitions } from '../../src/native/windows-rectangles.mjs';
import { NativeRetainedDraw } from '../../src/native/retained-draw.mjs';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { authoredHG3 } from './hg3.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';

export async function imageOwnerFiles() {
  const rgba = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) => (i * 37 + 19) & 255),
    image = await encodeHG2(
      { width: 4, height: 3, rgba },
      { crop: false, clearTransparent: false, baseX: 2, baseY: -1 },
    );
  const animation = new Uint8Array(32 + 68 * 2),
    av = new DataView(animation.buffer);
  av.setUint32(0, 0x4d4e41, true);
  av.setUint32(8, 2, true);
  av.setUint32(32, 12, true);
  av.setUint32(40, 128, true);
  [0, 0, 2, 2].forEach((word, i) => av.setUint32(32 + 68 + (i ? 8 + (i - 1) * 8 : 0), word, true));
  const hg3 = authoredHG3([{ id: 0, width: 4, height: 3, rgba }]),
    attribute = new Uint8Array(hg3.length + 36),
    view = new DataView(attribute.buffer);
  attribute.set(hg3);
  let tag = 20;
  while (view.getUint32(tag + 8, true)) tag += view.getUint32(tag + 8, true);
  view.setUint32(tag + 8, hg3.length - tag, true);
  attribute.set(new TextEncoder().encode('ats0007\0'), hg3.length);
  view.setUint32(hg3.length + 12, 20, true);
  [10, -20, 30, -40, 0xff800123].forEach((word, i) =>
    view.setUint32(hg3.length + 16 + i * 4, word, true),
  );
  return new Map([
    ['@cat/image/probe.hg2', image],
    ['@cat/image/second.hg2', image],
    ['@cat/image/broken.hg2', Uint8Array.of(12, 34, 56, 78)],
    ['@cat/image/empty.hg2', new Uint8Array()],
    ['@cat/image/attr.hg3', attribute],
    ['@cat/image/anim.hg2', image],
    ['@cat/image/anim.anm', animation],
    ['@cat/image/composite_1.hg2', image],
    ['@cat/image/composite_1.anm', animation],
    ['@cat/image/composite_02.hg2', image],
    ['@cat/image/composite_02.anm', animation],
  ]);
}
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
