// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nativeCommaFields,
  parseNativeResourceSelection,
} from '../src/native/resource-selection.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
test('native resource selections retain raw base bytes and signed leading selectors', () => {
  const result = parseNativeResourceSelection(
    Uint8Array.of(98, 44, 49, 50, 51, 44, 0xff, 44, 0x80, 44, 0x7f),
  );
  assert.deepEqual(result.base, Uint8Array.of(98));
  assert.deepEqual(result.selectors, Int32Array.of(49, -1, -128, 127));
  assert.equal(parseNativeResourceSelection(Uint8Array.of(44, 44)), null);
  assert.deepEqual(
    nativeCommaFields(encodeCP932(',a,, ,"b,c",(d,e),')),
    ['a', ' ', '"b', 'c"', '(d', 'e)'].map(encodeCP932),
  );
  assert.throws(() => parseNativeResourceSelection(new Uint8Array(255).fill(97)), /scratch/);
});
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(
    profile + ' comma field merge and selection use live VM bytes and survive a fresh World',
    async () => {
      function make() {
        const game = memoryGame({ 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) }),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        return new NativeWorld({
          game,
          profile,
          configuration,
          random,
          images: {},
          host: {},
          storage: { read: async () => null, write: async () => true },
          motionLibrary: new MotionLibrary(game, { profile, random }),
        });
      }
      const world = make(),
        fresh = make(),
        call = (w, id, args) =>
          w.runtime.native('main', id, args, w.main.machine, w.main, w.runtime.scheduler);
      let state;
      try {
        await world.initialize('main.kcs');
        const m = world.main.machine;
        m.writeString('a,,b,c', 256);
        m.writeString('@,new,@,@', 512);
        m.bytes(0x80000020, 100).fill(0xa5);
        m.writeString('a,,b,c', 0x80000020);
        assert.deepEqual(await call(world, 0x388, [0x80000020, 512]), { control: 2 });
        assert.equal(m.string(0x80000020), 'a,new,c,0');
        assert.equal(m.load(0x80000020 + 10, 1), 0xa5);
        m.writeString('@@,x', 256);
        assert.deepEqual(await call(world, 0x388, [256, 256]), { control: 2 });
        assert.equal(m.string(256), '@@,x');
        const raw = Uint8Array.of(0xe7, 0x8c, 0xab, 44, 0xff, 44, 49);
        m.writeStringBytes(raw, 512);
        m.bytes(768, 64).fill(0xa5);
        assert.deepEqual(await call(world, 0x256, [512, 768]), { control: 1, value: 1 });
        assert.deepEqual(m.bytes(768, 5), Uint8Array.of(0xe7, 0x8c, 0xab, 0, 0xa5));
        m.writeString(',,,', 512);
        m.bytes(768, 64).fill(0xa5);
        assert.deepEqual(await call(world, 0x256, [512, 768]), { control: 1, value: 0 });
        assert.deepEqual(m.bytes(768, 64), new Uint8Array(64).fill(0xa5));
        state = structuredClone(world.snapshot());
        await fresh.restore(state);
        const fm = fresh.main.machine;
        assert.equal(fm.string(0x80000020), 'a,new,c,0');
        fm.writeString('@,tail', 512);
        await call(fresh, 0x388, [0x80000020, 512]);
        assert.equal(fm.string(0x80000020), 'a,tail');
        assert.equal(m.string(0x80000020), 'a,new,c,0');
        fm.writeString('bg01a_19,1,2', 256);
        assert.equal((await call(fresh, 0x256, [256, 256])).value, 1);
        assert.equal(fm.string(256), 'bg01a_19');
      } finally {
        await fresh.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
}
