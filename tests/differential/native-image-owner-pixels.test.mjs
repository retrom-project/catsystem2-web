// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { imageOwnerFixture } from '../fixtures/image-owner-fixture.mjs';
import { imageOwnerFiles } from '../fixtures/image-files.mjs';
const fields = [
  'width',
  'height',
  'canvasWidth',
  'canvasHeight',
  'offsetX',
  'offsetY',
  'baseX',
  'baseY',
  'bpp',
  'alphaHint',
  'mask',
];
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS image collection layer and pixel sequences equal original owners',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const files = await imageOwnerFiles(),
        world = await dataWorld(
          fixture.profile,
          Object.fromEntries(
            [...files].map(([key, bytes]) => [key.replace('@cat/image/', ''), bytes]),
          ),
        ),
        oracle = await imageOwnerFixture(fixture.bytes, fixture.profile);
      oracle.machine.memory.set(world.main.machine.memory);
      try {
        const bitmap = await world.graphics.images.load('probe.hg2'),
          b = world.graphics.images.get(bitmap),
          s = b.state;
        const h = world.imageOwners.add(bitmap, world.main.id, [
          s.width,
          s.height,
          s.canvasWidth,
          s.canvasHeight,
          s.offsetX,
          s.offsetY,
          s.baseX,
          s.baseY,
          s.bpp,
          0,
          0,
        ]);
        world.imageOwners.get(h).layers = [{ key: 0, bitmap, program: null }];
        oracle.machine.writeString('probe.hg2', 256);
        world.main.machine.writeString('probe.hg2', 256);
        const oh = (await oracle.images.apply(0x2c6, [256], oracle.machine, world.main)).value;
        async function run(id, args) {
          const actual = await world.runtime.native(
              'main',
              id,
              [h, ...args],
              world.main.machine,
              world.main,
            ),
            expected = await oracle.images.apply(id, [oh, ...args], oracle.machine, world.main);
          assert.deepEqual(actual, expected, id.toString(16) + ' reply');
          assert.deepEqual(
            world.main.machine.memory,
            oracle.machine.memory,
            id.toString(16) + ' VM',
          );
          const r = world.imageOwners.get(h),
            image = world.graphics.images.get(r.bitmap),
            op = oracle.images.pointer(oh),
            ptr = oracle.process.load(oracle.process.load(op + 12));
          assert.deepEqual(
            r.info.map((v) => v >>> 0),
            Array.from({ length: 11 }, (_, i) => oracle.process.load(op + 20 + i * 4)),
            id.toString(16) + ' collection info',
          );
          const f = fields.map((k) => image.state[k] ?? 0),
            offsets = [4, 8, 28, 32, 36, 40, 48, 52, 24, 44, 76];
          assert.deepEqual(
            f.map((v) => v >>> 0),
            offsets.map((at) => oracle.process.load(ptr + at)),
            id.toString(16) + ' bitmap fields',
          );
          const p = oracle.process,
            w = p.load(ptr + 4),
            height = p.load(ptr + 8),
            pitch = p.load(ptr + 20),
            data = p.load(ptr + 12),
            rgba = new Uint8ClampedArray(w * height * 4);
          for (let y = 0; y < height; y++) {
            const row = p.read(data + (height - y - 1) * pitch, w * 4);
            for (let x = 0; x < w; x++)
              rgba.set(
                [row[x * 4 + 2], row[x * 4 + 1], row[x * 4], row[x * 4 + 3]],
                (y * w + x) * 4,
              );
          }
          assert.deepEqual(await image.pixels(), rgba, id.toString(16) + ' all pixels');
        }
        for (const [id, args] of [
          [0x2c9, [50, 200, 100]],
          [0x2cc, [0x80808080]],
          [0x2e1, [1]],
          [0x2e1, [2]],
          [0x2e1, [3]],
          [0x2d9, [128]],
          [0x2d8, [17]],
          [0x2d7, [1]],
          [0x2d7, [0]],
          [0x2d3, [90]],
          [0x2da, [8, 6]],
          [0x2d6, [0, 0]],
        ])
          await run(id, args);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );

for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS owner transfers write argument five and preserve Draw packet words',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const world = await dataWorld(fixture.profile),
        oracle = await imageOwnerFixture(fixture.bytes, fixture.profile),
        m = world.main.machine,
        om = oracle.machine;
      om.memory.set(m.memory);
      const hs = [[], []],
        messages = [];
      world.sendNativeEngine = async (target, sender, message, w, l, context) =>
        messages.push({
          target,
          sender,
          message,
          w,
          flags: context.flags,
          bytes: context.payload.bytes(l, 60).slice(),
        });
      try {
        for (let side = 0; side < 2; side++)
          for (let i = 0; i < 2; i++)
            hs[side].push(
              (side
                ? await oracle.images.apply(0x2dd, [4, 3], om, world.main)
                : await world.runtime.native('main', 0x2dd, [4, 3], m, world.main)
              ).value,
            );
        const call = async (id, args) => {
          const replies = [];
          for (let side = 0; side < 2; side++) {
            const words = args.map((v) => (v === 'a' ? hs[side][0] : v === 'b' ? hs[side][1] : v));
            replies.push(
              side
                ? await oracle.images.apply(id, words, om, world.main)
                : await world.runtime.native('main', id, words, m, world.main),
            );
          }
          assert.deepEqual(replies[0], replies[1]);
        };
        await call(0x2e0, ['a', 0, 0, 4, 3, 0x80402010]);
        await call(0x2e0, ['b', 0, 0, 4, 3, 0xff102030]);
        for (const id of [0x2de, 0x2df]) {
          await call(id, ['a', 1, 1, 2, 1, 'b', 0, 0, 4, 3]);
          for (let i = 0; i < 2; i++) {
            const image = world.graphics.images.get(world.imageOwners.get(hs[0][i]).bitmap),
              p = oracle.process,
              ptr = p.load(p.load(oracle.images.pointer(hs[1][i]) + 12)),
              pitch = p.load(ptr + 20),
              data = p.load(ptr + 12),
              rgba = new Uint8ClampedArray(48);
            for (let y = 0; y < 3; y++) {
              const row = p.read(data + (2 - y) * pitch, 16);
              for (let x = 0; x < 4; x++)
                rgba.set(
                  [row[x * 4 + 2], row[x * 4 + 1], row[x * 4], row[x * 4 + 3]],
                  (y * 4 + x) * 4,
                );
            }
            assert.deepEqual(await image.pixels(), rgba, id.toString(16) + ' owner ' + i);
          }
        }
        for (const id of [0x2db, 0x2dc])
          await call(id, [17, 23, 'a', 0x3f800000, 0x40000000, 7, 8, 9, 10, 11, 0xffffffff, 1, 2]);
        assert.equal(messages.length, 2);
        for (let i = 0; i < 2; i++) {
          const actual = messages[i],
            expected = oracle.messages[i];
          new DataView(actual.bytes.buffer).setUint32(12, 0, true);
          expected.bytes = expected.bytes.slice();
          new DataView(expected.bytes.buffer, expected.bytes.byteOffset).setUint32(12, 0, true);
          assert.deepEqual(actual, expected);
        }
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );
