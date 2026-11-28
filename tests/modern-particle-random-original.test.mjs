// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeRandomCases } from './fixtures/random-cases.mjs';
import { fixtureRandom, randomStateBytes } from './fixtures/random-state.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const bridge = JSON.parse(
    await readFile(new URL('./fixtures/modern-particle-random-bridge.json', import.meta.url)),
  ),
  goldenBytes = await readFile(new URL('./fixtures/random-golden.json', import.meta.url)),
  golden = JSON.parse(goldenBytes),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(goldenBytes), bridge.originalGolden.sha256);

for (const build of bridge.records)
  for (const table of [1, 2])
    test(`${build.profile} Particle v${table} shares its own exact RNG callee and complete state`, async () => {
      for (const input of nativeRandomCases(build.profile).filter(
        (row) => row.table === 'generic',
      )) {
        const wrapper = build.rows.find((row) => row.genericId === input.id),
          expected = golden.profiles[build.profile].cases[input.name];
        assert(wrapper && expected);
        for (const tail of [[], [0xdeadbeef], [0xdeadbeef, 0x7f800001]]) {
          const instructions = [[37, 0x36eb67a5]];
          for (let i = 0; i < input.repeat; i++)
            instructions.push(
              ...tail.map((word) => [37, word]),
              [43, wrapper.particleId, tail.length * 4],
              [38, [0x13, 512]],
            );
          instructions.push([59]);
          const code = kcsProgram(instructions);
          new DataView(code.buffer, code.byteOffset).setUint16(8, table, true);
          const script = await readKCS(code),
            options = {
              profile: build.profile,
              count: 3,
              width: 64,
              height: 32,
              screenWidth: 1280,
              screenHeight: 720,
            },
            owner = new ParticleScriptInstance(script, {
              ...options,
              random: fixtureRandom(input.initial),
            }),
            before = owner.snapshot(),
            machine = owner.machine;
          const result = machine.run();
          assert.equal(result.status, 'halted', input.name);
          assert.equal(machine.load(512), expected.value, input.name);
          assert.equal(machine.sp, 4100, input.name);
          const local = new Uint8Array(machine.memory.length),
            view = new DataView(local.buffer);
          view.setUint32(512, expected.value, true);
          view.setUint32(4096, 0x36eb67a5, true);
          view.setUint32(4100, expected.value, true);
          if (tail.length === 2) view.setUint32(4104, tail[1], true);
          assert.deepEqual(machine.memory, local, input.name);
          for (const [name, state] of Object.entries(randomStateBytes(owner.random)))
            assert.equal(hash(state), expected.memory[name], input.name + '/' + name);
          const after = owner.snapshot();
          for (const key of Object.keys(before).filter(
            (key) => !['machine', 'random'].includes(key),
          ))
            assert.deepEqual(after[key], before[key], input.name + '/' + key);
          const state = await deserializeCheckpoint(await serializeCheckpoint(after)),
            clone = new ParticleScriptInstance(script, {
              ...options,
              random: fixtureRandom(input.initial),
            });
          clone.restore(state);
          assert.deepEqual(clone.snapshot(), owner.snapshot(), input.name);
          owner.machine.start();
          clone.machine.start();
          owner.machine.run();
          clone.machine.run();
          assert.deepEqual(clone.snapshot(), owner.snapshot(), input.name);
        }
      }
    });
