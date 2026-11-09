// SPDX-License-Identifier: MPL-2.0
import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    profile + ' D0 uses the original wrapper and restores its versioned task tree',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-');
      test.skip(!process.env[variable] || (!sdk && !process.env.CATSYSTEM2_EMOTE_DLL));
      test.setTimeout(180000);
      const wait = [
          [37, 1800],
          [43, 0x47, 4],
        ],
        script = kcsProgram(
          [
            [37, 256],
            [43, 0xd0, 4],
            [38, 400],
            ...wait,
            [45],
            [37, 256],
            [43, 0xd0, 4],
            [38, 404],
            ...wait,
            [59],
          ],
          [[256, '木-%d[G512].css']],
        ),
        header = new DataView(script.buffer),
        files = new Map([
          ['engine.exe', await readFile(process.env[variable])],
          ['main.kcs', kcsProgram([...wait, [59]])],
          ['dump.kcs', script],
        ]);
      header.setUint16(8, 0x83ff, true);
      header.setUint16(10, 0x1234, true);
      if (!sdk) files.set('emotedriver.dll', await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
      const helper = await readFile(
        new URL('../fixtures/browser-native-world.mjs', import.meta.url),
      );
      await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
        route.fulfill({ body: helper, contentType: 'text/javascript' }),
      );
      await page.route('**/task-dump-fixture/*', (route) => {
        const body = files.get(new URL(route.request().url()).pathname.split('/').at(-1));
        return route.fulfill(body ? { body: Buffer.from(body) } : { status: 404, body: '' });
      });
      await page.goto('/');
      await page.evaluate(
        async ({ profile, names, sdk }) => {
          const { browserNativeWorld, browserAssert: assert } = await import(
              '/tests/fixtures/browser-native-world.mjs'
            ),
            { NativeFileStorage } = await import('/src/native/storage.mjs'),
            files = new Map(
              await Promise.all(
                names.map(async (name) => {
                  const response = await fetch('/task-dump-fixture/' + name);
                  if (!response.ok) throw new Error('Missing task dump fixture ' + name);
                  return [name, new Uint8Array(await response.arrayBuffer())];
                }),
              ),
            ),
            database = 'task-dump-' + crypto.randomUUID(),
            make = async () => {
              const storage = new NativeFileStorage(
                { read: async () => null, lookup: () => null },
                'authored-dump',
                database,
              );
              await storage.open();
              return browserNativeWorld({ profile, files, storage });
            },
            world = await make(),
            shared = Uint8Array.of(11, 22, 33, 44, 55),
            first = '木-73.css',
            second = '木-99.css',
            checkDump = (owner, task, file, pc, resultAt, value, leaf) => {
              assert.ok(file instanceof Uint8Array, 'The original SDK writer creates a CSS file');
              const view = new DataView(file.buffer, file.byteOffset, file.byteLength),
                word = (at) => view.getUint32(at, true),
                name = (at) => {
                  const field = file.subarray(at + 16, at + 48);
                  return new TextDecoder('shift_jis').decode(field.subarray(0, field.indexOf(0)));
                },
                main = owner.main.machine,
                p = owner.nativeEngine.process,
                m = task.machine;
              assert.deepEqual([0, 4, 8, 12, 16].map(word), [
                0x535343,
                file.length - 20,
                0x83ff1234,
                0,
                0,
              ]);
              assert.equal(name(20), 'BASE TASK');
              assert.deepEqual(
                [48, 52, 56].map((at) => word(20 + at)),
                [0, 3, shared.length],
              );
              assert.deepEqual(file.slice(80, 80 + shared.length), shared);
              let at = 80 + shared.length;
              assert.equal(name(at), 'INPUT TASK');
              at += 60;
              // The original sound task with no device reports zero bytes for
              // both queries. Top still counts that child in its tree header.
              assert.equal(name(at), 'main.kcs');
              assert.deepEqual(
                [48, 52, 64].map((n) => word(at + n)),
                [owner.nativeTaskID(owner.main.id), 2, main.memory.length],
              );
              at += 88 + main.memory.length;
              assert.equal(name(at), 'Leaf');
              assert.equal(word(at + 48), owner.nativeTaskID(leaf));
              at += 60;
              assert.equal(name(at), 'dump.kcs');
              assert.deepEqual(
                [48, 52, 60, 64, 68, 72, 76, 80].map((n) => word(at + n)),
                [
                  owner.nativeTaskID(task.id),
                  0,
                  pc,
                  m.memory.length,
                  p.addressOf(m.memory),
                  m.data.length,
                  m.floor,
                  m.fp,
                ],
              );
              assert.equal(word(at + 88 + 512), value);
              assert.equal(word(at + 88 + resultAt), 0xa5a5a5a5, 'dump precedes the result push');
              assert.equal(at + 88 + m.memory.length, file.length);
            };
          let fresh;
          try {
            await world.initialize('main.kcs');
            world.main.machine.bytes(64, shared.length).set(shared);
            await world.sendEngine(world.root, world.main.id, sdk ? 30 : 32, shared.length, 64, {
              payload: world.main.machine,
            });
            const leaf = await world.objects.create({
                kind: 0,
                parent: world.main.id,
                name: 'Leaf',
              }),
              task = await world.spawnScript('dump.kcs', { parent: world.main.id }),
              memory = await world.getNativeFeature('task-memory'),
              p = world.nativeEngine.process,
              vm = memory.vmPointer(task.id),
              header = p.load(vm + 8);
            assert.deepEqual(p.read(header, 52), files.get('dump.kcs').slice(0, 52));
            task.machine.store(512, 73);
            task.machine.store(400, 0xa5a5a5a5);
            task.machine.store(404, 0xa5a5a5a5);
            let wrappers = 0,
              writers = 0;
            const detach = p.beforeInstruction(sdk ? 0x52a1a0 : 0x643a30, 'D0 wrapper', () => {
                wrappers++;
              }),
              stopWriter = sdk
                ? p.beforeInstruction(0x4baba0, 'original SDK Top dump writer', () => {
                    writers++;
                  })
                : null,
              stopPadding = sdk
                ? p.beforeInstruction(0x4bacdd, 'authored SDK dump heap contents', () => {
                    const address = p.cpu.reg_read_i32(p.uc.X86_REG_EAX) >>> 0,
                      size = p.allocations.get(address - 4) - 4;
                    assert.ok(size > 20, 'original writer owns a heap payload');
                    p.write(address, new Uint8Array(size).fill(0x6d));
                  })
                : null;
            try {
              await world.runtime.scheduler.execute(task);
            } finally {
              stopPadding?.();
              stopWriter?.();
              detach();
            }
            assert.equal(wrappers, 1);
            assert.equal(writers, Number(sdk));
            assert.equal(task.machine.load(400), 0);
            const saved = await world.storage.readSaved(first);
            if (sdk) {
              checkDump(world, task, saved, 17, 400, 73, leaf);
              assert.equal(saved[21], 0x6d, 'Top preserves untouched type padding');
              assert.equal(saved[46], 0x6d, 'Top preserves untouched name padding');
            } else assert.equal(saved, null);

            fresh = await make();
            await fresh.restore(structuredClone(world.snapshot()));
            assert.deepEqual(await fresh.storage.readSaved(first), saved);
            const restored = fresh.runtime.scheduler.tasks.get(task.id),
              restoredMemory = await fresh.getNativeFeature('task-memory'),
              rp = fresh.nativeEngine.process,
              restoredVM = restoredMemory.vmPointer(restored.id);
            assert.equal(rp.load(restoredVM + 8), header, 'restored header has its guest identity');
            assert.deepEqual(rp.read(header, 52), files.get('dump.kcs').slice(0, 52));
            restored.machine.store(512, 99);
            assert.equal(
              (await fresh.runtime.scheduler.send(restored.id, [7, 8, 9, 10])).accepted,
              true,
            );
            assert.equal(restored.machine.load(404), 0);
            const updated = await fresh.storage.readSaved(second);
            if (sdk) {
              checkDump(fresh, restored, updated, 58, 404, 99, leaf);
              assert.equal(await fresh.storage.setAttributes(second, 1), true);
              assert.deepEqual(
                await fresh.runtime.native('main', 0xd0, [256], restored.machine, restored),
                { control: 1, value: 0 },
              );
              assert.deepEqual(await fresh.storage.readSaved(second), updated);
            } else {
              assert.equal(updated, null);
              assert.deepEqual(await fresh.storage.list(), []);
            }
            assert.deepEqual(await fresh.storage.readSaved(first), saved);
            assert.equal(task.machine.load(404), 0xa5a5a5a5);
            await fresh.objects.release(restored.id);
            assert.equal(rp.allocations.has(header), false, 'the VM releases its owned header');
          } finally {
            try {
              await fresh?.close({ flushFiles: false });
              await world.close({ flushFiles: false });
            } finally {
              fresh?.storage.close();
              world.storage.close();
            }
          }
        },
        { profile, names: [...files.keys()], sdk },
      );
    },
  );
}
