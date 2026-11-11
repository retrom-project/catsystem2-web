// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { screenOracleWorld } from '../fixtures/screen-effects-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { NativeParticleTextures as OriginalTextures } from '../../oracle/particle-textures-original.mjs';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
const pixels = ({ width, height, rgba }) => ({ width, height, rgba });
const files = {
  'image/atlas.hg2': await encodeHG2(
    { width: 5, height: 3, rgba: Uint8Array.from({ length: 60 }, (_, i) => (i * 37 + 19) & 255) },
    { crop: false, clearTransparent: false },
  ),
};
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS particle atlas pixels, reload metadata and ownership match oracle',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async () => {
      const { world } = await screenOracleWorld(fixture, files),
        js = await dataWorld(fixture.profile, files),
        old = new OriginalTextures(world.nativeEngine, world),
        textures = js.particles.textures;
      let original, current, fresh;
      try {
        for (const spec of [
          { texture: '', priority: 5000 },
          { texture: 'image/atlas.hg2', priority: 5000 },
          { texture: '', priority: 3000 },
          { texture: 'image/missing.hg3', priority: 4000 },
          { texture: 'image/atlas.hg2', priority: 1000, externalDraw: true },
          { texture: 'image/atlas.hg2', priority: 6000 },
        ]) {
          const priorOld = original,
            prior = current;
          original = await old.load(spec, original);
          current = await textures.load(spec, current);
          if (priorOld?.pointer) old.release(priorOld.pointer);
          if (prior?.pointer) textures.release(prior.pointer);
          const fields = ({ pointer, ...rest }) => ({ live: Boolean(pointer), ...rest });
          assert.deepEqual(fields(current), fields(original));
          if (original.pointer)
            assert.deepEqual(
              pixels(textures.frame(current.pointer)),
              pixels(old.frame(original.pointer)),
            );
        }
        fresh = await dataWorld(fixture.profile, files);
        fresh.particles.textures.restore(structuredClone(textures.snapshot()));
        assert.deepEqual(
          fresh.particles.textures.frame(current.pointer),
          textures.frame(current.pointer),
        );
        textures.release(current.pointer);
        assert.throws(() => textures.frame(current.pointer), /no live JS owner/);
        assert.equal(fresh.particles.textures.owned.size, 1);
      } finally {
        if (original?.pointer) old.release(original.pointer);
        old.close();
        for (const owner of [js, fresh].filter(Boolean)) {
          for (const pointer of [...owner.particles.textures.owned])
            owner.particles.textures.release(pointer);
          await owner.close();
        }
        await world.close({ flushFiles: false });
      }
    },
  );
