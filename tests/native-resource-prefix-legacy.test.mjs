// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { nativeNarrowCategoryPath } from '../src/native/resource-file.mjs';
import { kcsProgram, kif } from './helpers.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-resource-prefix-legacy-golden.json', import.meta.url)),
);
for (const row of golden.versions) {
  const profile = {
    23: 'grisaia-jp-engine-2.6.1.23',
    63: 'rebellions-jp-engine-2.6.1.63',
    67: 'bokutomo-engine-2.6.1.67',
  }[row.version];
  test(`${profile} own XML category namespace reaches the real mounted loose candidate before its INT archive`, async () => {
    const source = Uint8Array.of(0, 0, 1, 0xba, 0x21, 0, 1),
      archive = Uint8Array.of(91, 92),
      files = new Map(
        Object.entries({
          'main.kcs': kcsProgram([[37, 240], [43, 71, 4], [59]]),
          'startup.xml': encodeCP932(row.xml),
          'loose-dir/clip.mpg': source,
          'loose-dir/猫.mpg': source,
          'container.int': kif([['clip.mpg', archive]]),
        }).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
      ),
      game = new GameFiles(files);
    await game.open();
    const random = new ParticleRandom(1, 2),
      packets = [],
      opens = [],
      world = new NativeWorld({
        profile,
        game,
        images: {},
        host: {
          nativeMovie(filename, owner) {
            return {
              open(name, input) {
                assert.equal(name, filename);
                assert.deepEqual(
                  input.bytes,
                  source,
                  'mode3 reads actual loose bytes before same-named archive',
                );
                opens.push({ filename, owner });
                return true;
              },
              close() {},
              configure() {},
              position: () => 0n,
              metadata: () => ({ width: 2, height: 1, duration: 200n, alpha: false }),
              frameStamp: () => 0,
              decodedFrame: () => ({ width: 2, height: 1, rgba: new Uint8ClampedArray(8) }),
            };
          },
        },
        configuration: new NativeConfiguration({ profile }),
        random,
        motionLibrary: new MotionLibrary(game, { profile, random }),
        storage: { read: async () => null, write: async () => true },
        prepareSceneWorkers: false,
      });
    world.ensureNativeEngine = () => {
      throw Error('Category test attempted original CPU');
    };
    try {
      await world.initialize('main.kcs');
      world.graphics.createLogicalDevice();
      const plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: 21 }),
        entry = game.nativeResources.entries[5];
      assert.deepEqual(
        {
          archive: entry.archive,
          extension: entry.extension,
          directory: entry.directory,
          name: entry.name,
        },
        row.fields,
      );
      const candidates = game.nativeCandidates('container.int/clip.mpg', 3);
      assert.equal(candidates[0].path, 'loose-dir/clip.mpg');
      assert.equal(candidates[1].kind, 'archive');
      assert.deepEqual(await game.readNative('container.int/clip.mpg', 3), source);
      const send = world.sendNativeEngine;
      world.sendNativeEngine = async function (to, from, message, w, l, context) {
        if (message === 43) {
          assert.equal(from, world.main.id, 'own native sender81 projects to this World caller');
          const bytes = [];
          for (let at = 12; ; at++) {
            const n = context.payload.bytes(at, 1)[0];
            if (!n) break;
            bytes.push(n);
          }
          packets.push({
            from: 81,
            to,
            raw: mapABIMessage(profile, 'planeMovie', 'raw', message),
            position: [0, 4, 8].map((at) => context.payload.load(at)),
            filename: new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)),
          });
        }
        return send.call(this, to, from, message, w, l, context);
      };
      for (const path of row.paths) {
        const task = world.main;
        task.status = 'ready';
        task.io = null;
        const machine = (task.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, 701, 8], [59]], [[192, path.input]])),
          { native: (id, args, vm) => world.runtime.scheduler.native(task, id, args, vm) },
        ));
        machine.floor = machine.fp = 3584;
        machine.sp = 3596;
        machine.store(3584, 0x93deff25);
        machine.store(3588, 21);
        machine.store(3592, 192);
        assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
        assert.equal(machine.sp, 3588);
        assert.equal(machine.load(3584), 0x93deff25);
        assert.deepEqual(packets.at(-1), path.packet);
      }
      assert.equal(opens.length, 3);
      assert(opens.every((open) => open.owner === plane));
      assert.equal(world.graphics.get(plane).graph.type, 3);
      assert.equal(world.movies.renderGate, 0);
      await world.objects.release(plane);
      assert.equal(world.movies.sessions.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('narrow category path keeps empty INT and explicit paths independent from the loose directory', () => {
  const game = {
    nativeResources: {
      entries: [{ name: 'movie', archive: '', directory: 'unrelated', extension: 'mpg' }],
    },
  };
  assert.deepEqual(
    nativeNarrowCategoryPath(game, encodeCP932('clip'), 'movie', 64),
    encodeCP932('clip.mpg\0'),
  );
  assert.deepEqual(
    nativeNarrowCategoryPath(game, encodeCP932('other.int/clip'), 'movie', 64),
    encodeCP932('other.int/clip\0'),
  );
});
