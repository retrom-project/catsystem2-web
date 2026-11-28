// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { parseNativeXML } from '../src/native/xml.mjs';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeStringBank } from '../src/native/persistence.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-scene-checkpoints-golden.json', import.meta.url)),
  ),
  b64 = (b) => Buffer.from(b).toString('base64');
function frames(bytes) {
  if (!bytes?.length) return [];
  const b = Buffer.from(bytes),
    rows = [];
  for (let at = 0; ; ) {
    const next = b.readUInt32LE(at),
      length = b.readUInt32LE(at + 4),
      n = b.readUInt32LE(at + 8),
      s = b.readUInt32LE(at + 12),
      decoded = inflateSync(b.subarray(at + 20, at + length));
    assert.equal(decoded.length, n + s);
    const strings = decoded.subarray(n),
      entries = [];
    let pos = 4;
    for (let i = 0; i < strings.readUInt32LE(0); i++) {
      const end = strings.indexOf(0, pos + 4);
      assert(end >= 0);
      entries.push([strings.readUInt32LE(pos), strings.subarray(pos + 4, end).toString('base64')]);
      pos = end + 1;
    }
    assert.equal(strings.length - pos, 8);
    rows.push({
      position: b.readUInt32LE(at + 16),
      variables: decoded.subarray(0, n).toString('base64'),
      stringSize: s,
      strings: entries,
    });
    if (!next) break;
    assert.equal(next, length);
    at += next;
    assert(at < b.length);
  }
  return rows;
}
const historyState = (history) =>
  Object.fromEntries(
    ['seen', 'path'].map((side) => [
      side,
      history[side].map((entry) => {
        const name = entry.nameBytes ?? encodeCP932(entry.scene),
          end = name.indexOf(0);
        return {
          nameBytes: b64(name.subarray(0, end < 0 ? name.length : end)),
          value: entry.value,
          frames: frames(entry.extra),
        };
      }),
    ]),
  );
for (const build of golden.builds)
  test(`${build.version} own XML/mounted selector/Main checkpoint chain restores live caller banks and survives cold`, async () => {
    const files = {
      'startup.xml': new TextEncoder().encode(build.xml),
      'loose-config/selector.xml': new TextEncoder().encode(build.selection),
    };
    let world = await modernParticleMessageWorld(build.profile, files),
      caller = world.main,
      scene;
    const pointers = new Map();
    world.configuration.applyStartup(
      parseNativeXML(
        new TextEncoder().encode(build.xml),
        build.version === '74' ? 'Shift_JIS' : 'UTF-8',
      ),
    );
    const normalize = (input) => {
      const bytes = new Uint8Array(input),
        v = new DataView(bytes.buffer);
      for (let at = 4100; at < 4150; at += 4) {
        const word = v.getUint32(at, true);
        if (pointers.has(word)) v.setUint32(at, pointers.get(word), true);
      }
      return bytes;
    };
    const verify = (sample) => {
      const expected = sample.state;
      if (expected.history)
        assert.deepEqual(
          historyState(world.runtime.handles.get(scene, 'scene-data').history),
          expected.history,
          sample.label + ' history',
        );
      if (expected.variables) {
        const bank = world.runtime.variableBank(caller, false);
        assert.deepEqual(
          new Uint8Array(bank.words.buffer, bank.words.byteOffset, bank.words.byteLength),
          new Uint8Array(Buffer.from(expected.variables.words, 'base64')),
          sample.label + ' all64 variables',
        );
        assert.equal(bank.dirty, expected.variables.dirty, sample.label + ' variable dirty');
      }
      assert.deepEqual(
        serializeStringBank(world.runtime.stringBank(caller, false)),
        new Uint8Array(Buffer.from(expected.strings, 'base64')),
        sample.label + ' caller strings',
      );
    };
    try {
      for (let i = 0; i < build.rows.length; i++) {
        const row = build.rows[i];
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
        if (row.id === 323) {
          scene = machine.load(4100);
          pointers.set(row.result, scene);
        }
        assert.equal(reply.control, row.control, `Main${row.id} control`);
        assert.deepEqual(
          machine.memory,
          normalize(Buffer.from(row.local, 'base64')),
          `Main${row.id} full frame ${i}`,
        );
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], `Main${row.id} ${key}`);
        const sample = build.cases.find((s) => s.rowIndex === i);
        if (!sample) continue;
        verify(sample);
        if (
          [
            'second-checkpoint-at30',
            'restore-first-chain-at15',
            'branch-first-path-at0-keeps-oldest-extra',
          ].includes(sample.label)
        ) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
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
