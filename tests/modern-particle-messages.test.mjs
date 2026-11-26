// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-particle-message-golden.json', import.meta.url)),
  ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  script = Buffer.from(golden.script, 'base64'),
  config = golden.config,
  arrays = (o) =>
    Buffer.concat(
      ['quads', 'backupQuads', 'positions', 'bases', 'rotations', 'scales', 'visibility'].map((k) =>
        Buffer.from(o[k].buffer, o[k].byteOffset, o[k].byteLength),
      ),
    );
const setup = (world) => {
  world.graphics.stage.width = world.game.width = config[2];
  world.graphics.stage.height = world.game.height = config[3];
  world.graphics.createLogicalDevice();
};
function packet(missing = false) {
  const p = new NativeGraphicsPacket(new Array(0x290 / 4).fill(0));
  p.bytes(4, 128).set(new TextEncoder().encode((missing ? 'missing.kcs' : 'authored.kcs') + '\0'));
  p.bytes(132, 128).set(new TextEncoder().encode('missing.hg3\0'));
  p.store(260, config[0]);
  p.store(264, config[12]);
  for (let i = 0; i < 32; i++) p.store(268 + i * 4, config[16 + i]);
  return p;
}
for (const build of golden.versions) {
  test(`${build.version} raw and normalized Particle messages preserve owned data before load, after load, active and after release`, async () => {
    // Every receiver operation and phase, boundary scalars and mapped raw float words;
    // the full external receipt additionally replays both transports for all cases.
    const cases = build.rows.filter(
      (r) =>
        r.type === 'message' &&
        (r.registerWords ||
          r.protected ||
          r.nullLoad ||
          r.missingProgram ||
          r.word === 0 ||
          r.word === 255 ||
          r.word === 7),
    );
    for (const row of cases)
      for (const raw of [true, false]) {
        const files = { 'authored.kcs': script, 'ptcl/authored.kcs': script },
          world = await modernParticleMessageWorld(build.profile, files);
        let fresh;
        try {
          setup(world);
          const id = await world.objects.create({ kind: 16, parent: world.root }),
            target = world.nativeTaskID(id),
            task = world.particles.get(id),
            m = world.main.machine;
          const send = (op, payload, l = 0) =>
            raw
              ? world.sendNativeEngine(
                  target,
                  world.main.id,
                  build.rawStart + op,
                  0,
                  l,
                  payload ? { payload } : {},
                )
              : world.sendEngine(id, world.main.id, 314 + op, 0, l, payload ? { payload } : {});
          if (row.phase) {
            await send(0, packet());
            if (row.phase === 2) await send(3);
            if (row.phase === 3) await send(1);
          }
          if (row.protected) {
            await assert.rejects(send(1), /requires its initialized family/);
            continue;
          }
          m.bytes(128, 128).set(Buffer.from(golden.registerInput, 'base64'));
          if (row.registerWords)
            for (let i = 0; i < 32; i++)
              m.store(128 + i * 4, golden.rawRegisterInput[i % golden.rawRegisterInput.length]);
          const reply =
            row.op === 0
              ? await send(0, row.nullLoad ? undefined : packet(row.missingProgram))
              : row.op === 5
                ? await send(5, m, 128)
                : await send(row.op, undefined, row.word);
          assert.equal(reply, row.op === 4 ? row.expected.reply : NATIVE_UNWRITTEN_WORD, row.name);
          const e = row.expected,
            registers = task.bank?.instance.registers ?? task.state.registers;
          assert.equal(task.active, e.active, row.name);
          assert.equal(task.state.alpha, e.alpha);
          assert.equal(task.state.attachment, e.attachment);
          assert.equal(!!task.bank?.instance.machine, e.vm);
          assert.equal(
            registers === null
              ? null
              : hash(Buffer.from(registers.buffer, registers.byteOffset, registers.byteLength)),
            e.registers,
          );
          if (task.bank) {
            assert.equal(hash(arrays(task.bank.instance)), e.buffers);
            assert.equal(hash(task.bank.instance.machine.memory), e.local);
            assert.equal(
              task.state.registers,
              null,
              'loaded instance is the single register owner',
            );
          }
          fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
          setup(fresh);
          await fresh.restore(
            await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
          );
          assert.deepEqual(fresh.particles.get(id).snapshot(), task.snapshot());
          assert.deepEqual(
            fresh.particles.get(id).bank?.instance.snapshot(),
            task.bank?.instance.snapshot(),
          );
        } finally {
          await fresh?.close({ flushFiles: false });
          await world.close({ flushFiles: false });
        }
      }
  });
  test(`${build.version} actual Main KCS reaches Particle through real GameFiles and preserves fixed mapped frames and cold state`, async () => {
    for (const row of build.rows.filter((r) => r.type === 'main')) {
      const files = {
          'authored.kcs': script,
          'ptcl/authored.kcs': script,
          'source.kcs': Buffer.from(row.program, 'base64'),
        },
        world = await modernParticleMessageWorld(build.profile, files);
      let fresh;
      try {
        setup(world);
        const id = await world.objects.create({ kind: 16, parent: world.root, nativeID: 0x700 }),
          task = world.particles.get(id);
        if (row.phase) {
          await world.sendEngine(id, world.main.id, 314, 0, 0, { payload: packet() });
          if (row.phase === 2) await world.sendEngine(id, world.main.id, 317);
          if (row.phase === 3) await world.sendEngine(id, world.main.id, 315);
        }
        const source = await world.spawnScript('source.kcs');
        for (let i = 0; i < 32; i++) source.machine.store(512 + i * 4, config[16 + i]);
        source.machine.store(64, 0x35eb67a5);
        await world.runtime.scheduler.execute(source);
        assert.equal(source.status, 'finished');
        assert.equal(hash(source.machine.memory), row.source.local, row.name);
        assert.equal(source.machine.pc, row.source.pc);
        assert.equal(source.machine.sp, row.source.sp);
        assert.equal(source.machine.fp, row.source.fp);
        const e = row.expected,
          regs = task.bank?.instance.registers ?? task.state.registers;
        assert.equal(task.active, e.active);
        assert.equal(task.state.alpha, e.alpha);
        assert.equal(task.state.attachment, e.attachment);
        assert.equal(!!task.bank?.instance.machine, e.vm);
        assert.equal(
          regs === null ? null : hash(Buffer.from(regs.buffer, regs.byteOffset, regs.byteLength)),
          e.registers,
        );
        if (task.bank) {
          assert.equal(hash(arrays(task.bank.instance)), e.buffers);
          assert.equal(hash(task.bank.instance.machine.memory), e.local);
        }
        fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
        setup(fresh);
        await fresh.restore(
          await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
        );
        assert.deepEqual(fresh.particles.get(id).snapshot(), task.snapshot());
        assert.deepEqual(
          fresh.particles.get(id).bank?.instance.snapshot(),
          task.bank?.instance.snapshot(),
        );
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    }
  });
  test(`${build.version} missing scripts alone take the unwritten branch; corrupt scripts preserve a diagnostic before texture work`, async () => {
    const world = await modernParticleMessageWorld(build.profile, {
      'authored.kcs': Uint8Array.of(1, 2, 3),
    });
    try {
      setup(world);
      const id = await world.objects.create({ kind: 16, parent: world.root }),
        task = world.particles.get(id);
      let textures = 0;
      const load = world.particles.textures.load;
      world.particles.textures.load = function (...args) {
        textures++;
        return Reflect.apply(load, this, args);
      };
      await assert.rejects(world.sendEngine(id, world.main.id, 314, 0, 0, { payload: packet() }));
      assert.equal(task.bank, null);
      assert.equal(textures, 0);
      assert.equal(task.state.family, 'script');
      assert.equal(
        await world.sendEngine(id, world.main.id, 314, 0, 0, { payload: packet(true) }),
        NATIVE_UNWRITTEN_WORD,
      );
      assert.equal(task.bank, null);
      assert.equal(textures, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.version} loaded registers have one instance owner through self copy, cold restore and release`, async () => {
    const files = { 'authored.kcs': script },
      world = await modernParticleMessageWorld(build.profile, files);
    let fresh;
    try {
      setup(world);
      const id = await world.objects.create({ kind: 16, parent: world.root }),
        task = world.particles.get(id);
      await world.sendEngine(id, world.main.id, 314, 0, 0, { payload: packet() });
      const words = new Uint32Array(task.bank.instance.registers.buffer);
      for (let i = 0; i < 32; i++)
        words[i] = golden.rawRegisterInput[i % golden.rawRegisterInput.length];
      const expected = words.slice();
      assert.equal(task.bank.registers, task.bank.instance.registers);
      world.particles.host.set(task.key, task.bank.registers);
      assert.deepEqual(words, expected, 'self-copy retains all raw words');
      assert.equal(task.snapshot().registers, null);
      assert.equal(Object.hasOwn(world.particles.snapshot().banks[0], 'registers'), false);
      fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      setup(fresh);
      await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())));
      const copy = fresh.particles.get(id);
      assert.equal(copy.bank.registers, copy.bank.instance.registers);
      await fresh.sendEngine(id, fresh.main.id, 317);
      assert.equal(copy.bank, null);
      assert.deepEqual(new Uint32Array(copy.state.registers.buffer), expected);
      const released = copy.snapshot();
      assert.notEqual(released.registers, copy.state.registers);
      copy.restore(released);
      assert.notEqual(released.registers, copy.state.registers);
      assert.deepEqual(new Uint32Array(copy.state.registers.buffer), expected);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
}
