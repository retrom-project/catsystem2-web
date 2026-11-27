// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/sdk23-host-output-golden.json', import.meta.url)),
);
const bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const coldAt of [null, ...golden.coldAt])
  test(`SDK23 loaded host output and queued menu/exit ${coldAt === null ? 'normal lifetime' : `cold ${coldAt}`}`, async () => {
    const storage = new SaveSlotFiles(),
      changes = [],
      logs = [],
      open = async (initialize) => {
        const world = await modernParticleMessageWorld(
          golden.profile,
          Object.fromEntries(golden.inputs.archives.map((r) => [r.name, bytes(r.data)])),
          {
            initialize,
            storage,
            startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))),
          },
        );
        world.host.nativeMenuChanged = (id, enabled) => changes.push([id, enabled]);
        world.host.nativeLog = (text) => logs.push(text);
        return world;
      };
    let world = await open(true),
      caller = await world.spawnScript(golden.script, { initialExecute: false });
    try {
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      const floor = caller.machine.sp;
      for (const row of golden.rows) {
        await world.objects.update(caller.id, 700 + row.phase);
        const compare = async () => {
          assert.equal(caller.machine.sp, floor + 4);
          assert.equal(caller.machine.load(floor), golden.marker);
          assert.deepEqual(
            Array.from({ length: 3 }, (_, i) => caller.machine.load(128 + i * 4)),
            row.outputs,
          );
          assert.deepEqual([...caller.machine.bytes(512, 32)], row.source);
          assert.deepEqual([...caller.machine.bytes(896, 64)], row.reader);
          assert.deepEqual(await storage.read('host%u[G144].txt'), bytes(row.file));
          assert.equal(world.configuration.screen.multiWindowPosition, 17);
        };
        await compare();
        if (row.phase < 2) {
          assert.deepEqual(world.windowMessages, [
            { message: 0x464, wParam: 0, lParam: row.phase },
          ]);
          assert.equal(changes.length, row.phase, 'native menu request does not publish early');
        }
        if (row.phase === coldAt) {
          const id = caller.id,
            state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(state);
          caller = world.runtime.scheduler.tasks.get(id);
          await compare();
        }
        if (row.phase < 2) {
          await world.processWindowMessages();
          assert.equal(world.menu.get(0x77), Boolean(row.phase));
          assert.deepEqual(changes.at(-1), [0x77, Boolean(row.phase)]);
        } else
          assert.deepEqual(
            world.windowMessages.map((r) => r.message),
            [0x10, 0x433],
          );
      }
      assert.deepEqual(logs, ['First 7', 'Second 23']);
      assert.deepEqual(changes, [
        [0x77, false],
        [0x77, true],
      ]);
    } finally {
      await world.close({ flushFiles: false });
    }
    assert.deepEqual(
      await storage.read('host%u[G144].txt'),
      bytes(golden.rows.at(-1).file),
      'stored bytes outlive their VM and World',
    );
  });

for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(`${profile} menu publication follows Window delivery and retains FIFO order`, async () => {
    const { dataWorld } = await import('./fixtures/data-world.mjs');
    const { kcsProgram } = await import('./helpers.mjs');
    const changes = [];
    const world = await dataWorld(profile, {
      'queued-menu.kcs': kcsProgram([
        [37, 0],
        [43, 393, 4],
        [37, 1],
        [43, 393, 4],
        [37, 240],
        [43, 71, 4],
        [59],
      ]),
    });
    try {
      world.host.nativeMenuChanged = (id, enabled) => changes.push([id, enabled]);
      await world.spawnScript('queued-menu.kcs', { initialExecute: true });
      assert.equal(world.menu.has(119), false);
      assert.deepEqual(changes, []);
      assert.deepEqual(
        world.windowMessages.map((r) => [r.message, r.wParam, r.lParam]),
        [
          [0x464, 0, 0],
          [0x464, 0, 1],
        ],
      );
      assert.equal(world.window.handlesBrowserMessage(0x464, 0), true);
      await world.processWindowMessages();
      assert.deepEqual(changes, [
        [119, false],
        [119, true],
      ]);
      assert.equal(world.menu.get(119), true);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

test('SDK23 direct-close VM request survives cold before normal Window shutdown', async () => {
  const { dataWorld } = await import('./fixtures/data-world.mjs');
  const { kcsProgram } = await import('./helpers.mjs');
  const files = {
    'direct-close.kcs': kcsProgram([[37, 0], [43, 9, 4], [37, 240], [43, 71, 4], [59]]),
  };
  const actions = [];
  let world = await dataWorld(golden.profile, files);
  try {
    await world.spawnScript('direct-close.kcs', { initialExecute: true });
    assert.deepEqual(world.windowMessages, [{ message: 0x433, wParam: 0, lParam: 0 }]);
    assert.equal(world.quitRequested, undefined);
    const saved = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
    await world.close({ flushFiles: false });
    world = await dataWorld(golden.profile, files, { initialize: false });
    await world.restore(saved);
    world.host.nativeWindowAction = async ({ type }) => actions.push(type);
    await world.processWindowMessages();
    assert.deepEqual(actions, ['hide', 'close']);
    assert.equal(world.quitRequested, true);
    assert.equal(world.windowMessages.length, 0);
    assert.throws(() => world.snapshot(), /closing/);
  } finally {
    await world.close({ flushFiles: false });
  }
});
