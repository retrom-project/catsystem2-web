// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KCSMachine, readKCS, formatNativeAt, nativeLogBytes } from '../src/kcs.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-logger-golden.json', import.meta.url)),
  ),
  decoder = new TextDecoder('shift_jis');
function program(input, id) {
  const fixed = id === 14 ? [input.destination ?? 8256, 128] : [128],
    declared =
      input.frame === 'mapped'
        ? []
        : input.frame === 'short'
          ? fixed.slice(0, -1)
          : input.frame === 'tail'
            ? [...fixed, 0xdeadbeef, 0x7f800001]
            : fixed;
  return kcsProgram([
    [37, 0x36eb67a5],
    ...declared.map((word) => [37, word]),
    [43, id, declared.length * 4],
    [59],
  ]);
}
function seed(m, input, blockSize) {
  m.allocate(blockSize);
  m.memory.fill(0x93, 0, 4096);
  m.blockBytes(0).fill(0xa5);
  const source = Buffer.from(input.source, 'base64');
  m.bytes(128, source.length + 1).set([...source, 0]);
  m.store(512, input.word);
  for (const store of input.stores) {
    const bytes = Buffer.from(store.bytes, 'base64');
    m.bytes(store.address, bytes.length).set(bytes);
  }
  const fixed = input.family === 'main14' ? [input.destination ?? 8256, 128] : [128];
  fixed.forEach((word, i) => m.store(4100 + i * 4, word));
}
function memory(m) {
  return [m.memory.slice(), m.shared.slice(), ...m.blocks.map((_, i) => m.blockBytes(i).slice())];
}
function observe(owner, input) {
  const original = owner.native.bind(owner);
  owner.native = (id, args, m) => {
    const before = memory(m),
      state = owner.snapshot(),
      reply = original(id, args, m),
      after = owner.snapshot();
    assert.deepEqual(memory(m), before, input.name);
    if (owner instanceof MotionInstance) {
      delete state.calls;
      delete state.messages;
      delete after.calls;
      delete after.messages;
    }
    assert.deepEqual(after, state, input.name);
    assert.equal(reply.control, 2, input.name);
    return reply;
  };
}
for (const build of golden.builds) {
  test(`${build.profile} default count-output diagnostic leaves a real owned target and copy destination unchanged`, async () => {
    const files = Object.fromEntries(
        [1, 14].map((id) => [
          'count' + id + '.kcs',
          kcsProgram([
            [37, 16],
            [43, 833, 4],
            [38, [0x13, 512]],
            ...(id === 14 ? [[37, 8256]] : []),
            [37, 128],
            [43, id, id === 14 ? 8 : 4],
            [59],
          ]),
        ]),
      ),
      world = await dataWorld(build.profile, files),
      actual = world.runtime.native.bind(world.runtime);
    try {
      for (const id of [1, 14]) {
        const task = await world.spawnScript('count' + id + '.kcs', {
            parent: world.main.id,
            initialExecute: false,
          }),
          vm = task.machine;
        vm.allocate(32768);
        vm.blockBytes(0).fill(0xa5);
        vm.writeString('%n[G512]', 128);
        let pointer, before, heapBefore;
        world.runtime.native = (...args) => {
          if (args[1] === id) {
            pointer = args[3].load(512);
            world.runtime.imageDataBuffers.process.write(pointer, new Uint8Array(16).fill(0x5a));
            before = memory(args[3]);
            heapBefore = world.runtime.imageDataBuffers.snapshot();
          }
          return actual(...args);
        };
        await assert.rejects(world.runtime.scheduler.execute(task), /Unsupported native format/);
        assert.deepEqual(memory(vm), before);
        assert.deepEqual(world.runtime.imageDataBuffers.snapshot(), heapBefore);
        assert.deepEqual(
          world.runtime.imageDataBuffers.process.read(pointer, 16),
          new Uint8Array(16).fill(0x5a),
        );
        await world.objects.release(task.id);
      }
    } finally {
      world.runtime.native = actual;
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.profile} Main debug/copy reject an actually unmapped fixed argv word`, async () => {
    const files = {
        'log.kcs': kcsProgram([[43, 1, 0], [59]]),
        'copy.kcs': kcsProgram([[43, 14, 0], [59]]),
      },
      world = await dataWorld(build.profile, files);
    try {
      for (const name of ['log.kcs', 'copy.kcs']) {
        const task = await world.spawnScript(name, {
          parent: world.main.id,
          initialExecute: false,
        });
        task.machine.sp = task.machine.memory.length;
        await assert.rejects(world.runtime.scheduler.execute(task), /KCS memory/);
        await world.objects.release(task.id);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.profile} real Main1/Main14 wrappers retain byte logs, fixed argv and full VM writes`, async () => {
    const inputs = build.cases.filter((c) => c.family === 'main1' || c.family === 'main14'),
      files = Object.fromEntries(
        inputs.map((input, i) => [
          'log' + i + '.kcs',
          program(input, input.family === 'main1' ? 1 : 14),
        ]),
      ),
      world = await dataWorld(build.profile, files);
    let coldCount = 0;
    try {
      for (const [i, input] of inputs.entries()) {
        const task = await world.spawnScript('log' + i + '.kcs', {
            parent: world.main.id,
            initialExecute: false,
          }),
          m = task.machine;
        seed(m, input, 32768);
        const expectedBytes = Uint8Array.from(Buffer.from(input.expected, 'base64')),
          check = async (target, current) => {
            const messages = [],
              actual = target.runtime.native.bind(target.runtime);
            target.runtime.services.log = (text) => messages.push(text);
            target.runtime.native = (...args) => {
              const vm = args[3],
                before = memory(vm),
                reply = actual(...args);
              assert.equal(reply.control, input.family === 'main1' ? 2 : 1, input.name);
              if (input.family === 'main14') {
                const destination = input.destination ?? 8256,
                  expected = before.map((b) => b.slice()),
                  [region, offset] = vm.region(destination),
                  index = region === vm.memory ? 0 : region === vm.shared ? 1 : 2;
                expected[index].set([...expectedBytes, 0, 0], offset);
                assert.deepEqual(memory(vm), expected, input.name);
                assert.equal(reply.value, destination, input.name);
              } else assert.deepEqual(memory(vm), before, input.name);
              return reply;
            };
            try {
              await target.runtime.scheduler.execute(current);
              assert.equal(current.machine.halted, true, input.name);
              if (input.family === 'main14')
                assert.equal(current.machine.pop(), input.destination ?? 8256, input.name);
              assert.equal(current.machine.pop(), 0x36eb67a5, input.name);
              assert.deepEqual(
                messages,
                input.family === 'main1' ? [decoder.decode(expectedBytes)] : [],
                input.name,
              );
            } finally {
              target.runtime.native = actual;
            }
          };
        if (
          ['log-byte-cut', 'copy-short-argv', 'copy-deep60', 'percent-4-b'].includes(input.name)
        ) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
            fresh = await dataWorld(build.profile, files, { initialize: false });
          try {
            await fresh.restore(state);
            await check(fresh, fresh.runtime.scheduler.tasks.get(task.id));
            coldCount++;
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
        await check(world, task);
        await world.objects.release(task.id);
      }
      assert.equal(coldCount, 4);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  if (build.cases.some((c) => c.family === 'particle'))
    test(`${build.profile} Generic debug executes its own first formatter and actual logger bytes`, async () => {
      for (const input of build.cases.filter((c) => c.family === 'generic')) {
        const code = await readKCS(program(input, 0)),
          messages = [],
          owner = new MotionInstance(code, {
            profile: build.profile,
            onDebug: (text) => messages.push(text),
          });
        seed(owner.machine, input, 1024);
        observe(owner, input);
        let clone;
        if (
          ['literal-percent-twice', 'string-byte-cut', 'argument-frame-mapped'].includes(input.name)
        ) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(owner.snapshot()));
          clone = new MotionInstance(code, { profile: build.profile });
          clone.restore(state);
          observe(clone, input);
          clone.machine.run();
        }
        owner.machine.run();
        assert.equal(owner.machine.halted, true, input.name);
        assert.equal(owner.machine.pop(), 0x36eb67a5, input.name);
        assert.deepEqual(
          messages,
          [decoder.decode(Buffer.from(input.expected, 'base64'))],
          input.name,
        );
        if (clone) {
          assert.equal(clone.machine.pop(), 0x36eb67a5, input.name);
          assert.deepEqual(clone.snapshot(), owner.snapshot(), input.name);
        }
      }
      const owner = new MotionInstance(await readKCS(kcsProgram([[43, 0, 0], [59]])), {
        profile: build.profile,
      });
      owner.machine.sp = owner.machine.memory.length;
      assert.throws(() => owner.machine.run(), /KCS memory/);
    });
  if (build.cases.some((c) => c.family === 'particle'))
    for (const version of [0x10000, 0x20000]) {
      test(`${build.profile} PTCL ${version.toString(16)} logger uses its proved receiver/callee bridge`, async () => {
        for (const input of build.cases.filter(
          (c) => c.family === 'generic' || c.family === 'particle',
        )) {
          const code = await readKCS(program(input, 0));
          code.scriptVersion = version;
          const messages = [],
            make = () =>
              new ParticleScriptInstance(code, {
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
          seed(owner.machine, input, 1024);
          observe(owner, input);
          if (['particle-log-mapped', 'particle-log-string-percent'].includes(input.name)) {
            const state = await deserializeCheckpoint(await serializeCheckpoint(owner.snapshot())),
              clone = make();
            clone.restore(state);
            observe(clone, input);
            clone.machine.run();
            assert.equal(clone.machine.pop(), 0x36eb67a5, input.name);
            assert.equal(
              messages.pop(),
              decoder.decode(Buffer.from(input.expected, 'base64')),
              input.name,
            );
          }
          owner.machine.run();
          assert.equal(owner.machine.pop(), 0x36eb67a5, input.name);
          assert.deepEqual(
            messages,
            [decoder.decode(Buffer.from(input.expected, 'base64'))],
            input.name,
          );
        }
        const code = await readKCS(kcsProgram([[43, 0, 0], [59]]));
        code.scriptVersion = version;
        const owner = new ParticleScriptInstance(code, {
          profile: build.profile,
          count: 1,
          width: 1,
          height: 1,
          screenWidth: 800,
          screenHeight: 600,
        });
        owner.machine.sp = owner.machine.memory.length;
        assert.throws(() => owner.machine.run(), /KCS memory/);
      });
    }
}

test('logger diagnostics preserve the original terminated buffer and missing variadic boundary', async () => {
  assert.equal(nativeLogBytes(new Uint8Array(499).fill(65)).length, 499);
  assert.throws(() => nativeLogBytes(new Uint8Array(500).fill(65)), /terminated 500-byte/);
  assert.throws(() => nativeLogBytes(Uint8Array.of(37, 100)), /unprovided variadic/);
  const m = new KCSMachine(await readKCS(kcsProgram([[59]])));
  m.writeString('%n[G512]', 128);
  m.store(512, 0x12345678);
  assert.throws(() => formatNativeAt(128, m), /Unsupported native format/);
  assert.equal(m.load(512), 0x12345678);
});

const integerGolden = JSON.parse(
  await readFile(new URL('./fixtures/native-format-integer-golden.json', import.meta.url)),
);
for (const build of integerGolden.builds) {
  test(`${build.profile} corrected integer fields reach real Main1 and preserve logger boundaries`, async () => {
    const files = { 'integer-log.kcs': program({}, 1) },
      world = await dataWorld(build.profile, files);
    try {
      for (const input of integerGolden.cases) {
        const task = await world.spawnScript('integer-log.kcs', {
            parent: world.main.id,
            initialExecute: false,
          }),
          messages = [],
          expected = Buffer.from(input.expected, 'base64');
        world.runtime.services.log = (text) => messages.push(text);
        seed(task.machine, input, 1024);
        if (expected.length >= 500) {
          await assert.rejects(world.runtime.scheduler.execute(task), /terminated 500-byte/);
          assert.deepEqual(messages, []);
        } else {
          await world.runtime.scheduler.execute(task);
          assert.equal(task.machine.pop(), 0x36eb67a5, input.name);
          assert.deepEqual(messages, [decoder.decode(expected)], input.name);
        }
        await world.objects.release(task.id);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  if (['74', '76'].includes(build.version)) {
    test(`${build.profile} corrected integer fields pass real Generic and both Particle loggers`, async () => {
      for (const family of ['generic', 'particle-v1', 'particle-v2'])
        for (const input of integerGolden.cases) {
          const code = await readKCS(program({}, 0)),
            messages = [];
          code.scriptVersion = family === 'particle-v2' ? 0x20000 : 0x10000;
          const owner =
            family === 'generic'
              ? new MotionInstance(code, {
                  profile: build.profile,
                  onDebug: (text) => messages.push(text),
                })
              : new ParticleScriptInstance(code, {
                  profile: build.profile,
                  count: 1,
                  width: 1,
                  height: 1,
                  screenWidth: 800,
                  screenHeight: 600,
                  onDebug: (text) => messages.push(text),
                });
          seed(owner.machine, input, 1024);
          const expected = Buffer.from(input.expected, 'base64');
          if (expected.length >= 500) {
            assert.throws(() => owner.machine.run(), /terminated 500-byte/);
            assert.deepEqual(messages, []);
          } else {
            observe(owner, input);
            owner.machine.run();
            assert.equal(owner.machine.pop(), 0x36eb67a5, input.name);
            assert.deepEqual(messages, [decoder.decode(expected)], input.name);
          }
        }
    });
  }
}
