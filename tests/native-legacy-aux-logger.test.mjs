// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readKCS, encodeCP932 } from '../src/kcs.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-legacy-aux-logger-golden.json', import.meta.url)),
  ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  decoder = new TextDecoder('shift_jis');
function memory(machine) {
  return {
    local: machine.memory.slice(),
    shared: machine.shared.slice(),
    block: machine.blockBytes(0).slice(),
  };
}
function seed(machine, row) {
  machine.allocate(32768);
  machine.memory.fill(0x93, 0, 4096);
  machine.shared.fill(0xb5);
  machine.blockBytes(0).fill(0xa5);
  const source = encodeCP932(row.input.source);
  machine.bytes(128, source.length + 1).set([...source, 0]);
  machine.store(512, row.input.word);
  machine.store(4100, 128);
}
for (const build of golden.builds) {
  for (const table of ['generic', 'particle-v1', 'particle-v2']) {
    test(`${build.profile} ${table} zero reaches its own two-stage logger and preserves the current frame`, async () => {
      const contract = nativeABI(build.profile).tables[table].entries[0];
      assert.equal(contract.status, 'recovered');
      assert.equal(contract.signature.argumentWords, 1);
      assert.deepEqual(contract.signature.controlCodes, [2]);
      assert.equal(contract.signature.resultWritten, false);
      for (const row of build.cases.filter((c) => c.table === table)) {
        const code = await readKCS(
          kcsProgram([
            [37, 0x36eb67a5],
            ...row.declared.map((word) => [37, word]),
            [43, 0, row.declared.length * 4],
            [59],
          ]),
        );
        if (table !== 'generic') code.scriptVersion = table === 'particle-v2' ? 0x20000 : 0x10000;
        const messages = [],
          make = () =>
            table === 'generic'
              ? new MotionInstance(code, {
                  profile: build.profile,
                  onDebug: (text) => messages.push(text),
                })
              : new ParticleScriptInstance(code, {
                  profile: build.profile,
                  count: 1,
                  width: 32,
                  height: 24,
                  screenWidth: 800,
                  screenHeight: 600,
                  shared: new Uint8Array(1192),
                  onDebug: (text) => messages.push(text),
                }),
          owner = make();
        seed(owner.machine, row);
        const observe = (target) => {
          const native = target.native.bind(target);
          target.native = (id, args, machine) => {
            assert.equal(id, 0);
            assert.deepEqual(args, row.declared);
            assert.equal(machine.nativeArgumentBase, row.argvBase);
            assert.equal(machine.fp, row.fp);
            const before = memory(machine),
              state = target.snapshot();
            for (const [name, bytes] of Object.entries(before)) {
              assert.equal(bytes.length, row.guestBefore[name].bytes, name);
              assert.equal(hash(bytes), row.guestBefore[name].sha256, name);
            }
            const reply = native(id, args, machine),
              after = target.snapshot();
            assert.equal(reply.control, row.control);
            assert.equal(Object.hasOwn(reply, 'value'), false);
            assert.deepEqual(memory(machine), before);
            delete state.calls;
            delete after.calls;
            delete state.messages;
            delete after.messages;
            assert.deepEqual(after, state);
            return reply;
          };
        };
        observe(owner);
        let fresh;
        if (['float', 'zero-width-mapped-argv'].includes(row.input.name)) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(owner.snapshot()));
          fresh = make();
          fresh.restore(state);
          observe(fresh);
          fresh.machine.run();
          assert.equal(fresh.machine.pop(), row.continuationCanary);
          assert.equal(messages.pop(), decoder.decode(Buffer.from(row.logBytes, 'base64')));
        }
        owner.machine.run();
        assert.equal(owner.machine.halted, true);
        assert.equal(owner.machine.pop(), row.continuationCanary);
        assert.deepEqual(messages, [decoder.decode(Buffer.from(row.logBytes, 'base64'))]);
        if (fresh) assert.deepEqual(fresh.snapshot(), owner.snapshot());
      }
    });
    test(`${build.profile} ${table} zero retains the shared logger diagnostics`, async () => {
      for (const [source, diagnostic] of [
        ['%500d[G512]', /terminated 500-byte/],
        ['%%d', /unprovided variadic/],
        ['%n[G512]', /Unsupported native format/],
      ]) {
        const code = await readKCS(kcsProgram([[37, 128], [43, 0, 4], [59]]));
        if (table !== 'generic') code.scriptVersion = table === 'particle-v2' ? 0x20000 : 0x10000;
        const options = {
            profile: build.profile,
            count: 1,
            width: 32,
            height: 24,
            screenWidth: 800,
            screenHeight: 600,
            shared: new Uint8Array(1192),
          },
          owner =
            table === 'generic'
              ? new MotionInstance(code, options)
              : new ParticleScriptInstance(code, options);
        seed(owner.machine, { input: { source, word: 42 } });
        const native = owner.native.bind(owner);
        owner.native = (id, args, machine) => {
          const before = memory(machine);
          assert.throws(() => native(id, args, machine), diagnostic);
          assert.deepEqual(memory(machine), before);
          assert.deepEqual(owner.messages, []);
          throw new Error('Expected retained logger diagnostic');
        };
        assert.throws(() => owner.machine.run(), /Expected retained logger diagnostic/);
      }
    });
  }
}
