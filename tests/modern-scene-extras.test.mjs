// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-scene-extras-golden.json', import.meta.url)),
);
const b64 = (bytes) => Buffer.from(bytes).toString('base64'),
  prefix = (bytes) => bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0));
const historyState = (history) =>
  Object.fromEntries(
    ['seen', 'path'].map((side) => [
      side,
      history[side].map((entry) => ({
        nameBytes: b64(prefix(entry.nameBytes ?? encodeCP932(entry.scene))),
        value: entry.value,
        strings: entry.strings?.length
          ? entry.strings.map(([key, value]) => [key, b64(prefix(value))])
          : null,
        extra: entry.extra?.length ? b64(entry.extra) : null,
      })),
    ]),
  );
for (const build of golden.builds)
  test(`${build.version} Scene aliases and owned CTS extras copy, clone and release through real Main frames and cold`, async () => {
    let world = await modernParticleMessageWorld(build.profile),
      caller = world.main;
    const pointers = new Map(),
      scenes = new Map();
    function normalize(input) {
      const bytes = new Uint8Array(input),
        v = new DataView(bytes.buffer);
      for (let at = 4100; at < 4150; at += 4) {
        const word = v.getUint32(at, true);
        if (pointers.has(word)) v.setUint32(at, pointers.get(word), true);
      }
      return bytes;
    }
    function portable(history) {
      const copy = structuredClone(history);
      for (const entries of Object.values(copy))
        for (const entry of entries)
          if (entry.extra) {
            const bytes = Buffer.from(entry.extra, 'base64');
            assert.equal(bytes.readUInt32LE(8), bytes.length - 16);
            assert.equal(bytes.readUInt32LE(12), 0x1234abcd);
            bytes.fill(0, 0, 4);
            entry.extra = bytes.toString('base64');
          }
      return copy;
    }
    function verify(sample) {
      for (const [name, expected] of Object.entries(sample.history))
        assert.deepEqual(
          portable(historyState(world.runtime.handles.get(scenes.get(name), 'scene-data').history)),
          portable(expected),
          sample.label + ' ' + name,
        );
    }
    try {
      for (let i = 0; i < build.rows.length; i++) {
        const row = build.rows[i],
          sample = build.cases[i];
        let reply;
        const machine = (caller.machine = new KCSMachine(
          await readKCS(
            kcsProgram([
              [43, row.id, row.declaredCount * 4],
              ...Array.from({ length: 22 }, () => [59]),
            ]),
          ),
          {
            native: (id, args, vm) => {
              const value = world.runtime.scheduler.native(caller, id, args, vm);
              return value && typeof value.then === 'function'
                ? value.then((result) => (reply = result))
                : (reply = value);
            },
          },
          world.runtime.scheduler.shared,
        ));
        machine.memory.set(normalize(Buffer.from(row.beforeLocal, 'base64')));
        machine.store(4096, 0xa17a29c5);
        row.args.forEach((word, n) => machine.store(4100 + n * 4, pointers.get(word) ?? word));
        machine.sp = 4100 + row.declaredCount * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        if ([323, 238, 979].includes(row.id) && row.result) {
          const handle = machine.load(4100);
          pointers.set(row.result, handle);
          if (row.id === 323)
            scenes.set(sample.label === 'create-source' ? 'source' : 'target', handle);
        }
        assert.equal(reply.control, row.control, sample.label + ' control');
        assert.deepEqual(
          machine.memory,
          normalize(Buffer.from(row.local, 'base64')),
          sample.label + ' full local',
        );
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], sample.label + ' ' + key);
        verify(sample);
        if (
          [
            'null-extra-keeps-existing',
            'target-string-retained-by-extra-copy',
            'replacement-drops-extra',
          ].includes(sample.label)
        ) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, {}, { initialize: false });
          await world.restore(state);
          caller = world.main;
          verify(sample);
        }
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
