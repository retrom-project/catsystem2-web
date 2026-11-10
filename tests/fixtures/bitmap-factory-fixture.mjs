// SPDX-License-Identifier: MPL-2.0
import { bitmapMemoryFixture } from './bitmap-memory-fixture.mjs';
import { NativeBitmapFactories } from '../../oracle/bitmap-factory.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { imageOwnerFiles } from './image-owner-fixture.mjs';
export async function bitmapFactoryFixture(bytes, profile) {
  const fixture = await bitmapMemoryFixture(bytes, profile, { uploadBoundary: true }),
    files = await imageOwnerFiles(),
    clears = [],
    p = fixture.process;
  fixture.world.game = {
    read: async (name) => files.get(name) ?? null,
    readCategory: async (name, category) => files.get(`@cat/${category}/${name}`) ?? null,
  };
  const read = fixture.world.getNativeFeature;
  fixture.world.getNativeFeature = async (name) =>
    name === 'bitmap-factories' ? fixture.engine.features.get(name) : read(name);
  fixture.engine.patch(
    profile.startsWith('sdk-') ? 0x54b6a0 : 0x6745b0,
    'authored bitmap screen clear',
    4,
    (args) => {
      if (p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0 !== fixture.view)
        throw new Error('Bitmap screen clear requires the original view');
      clears.push(args);
      return 1;
    },
    { calleePops: true },
  );
  new NativeEngineFiles(fixture.engine, fixture.world);
  const factories = new NativeBitmapFactories(fixture.engine, fixture.world);
  return { ...fixture, factories, files, clears };
}
