// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-particle-texture-golden.json', import.meta.url)),
  ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  arrayFields = ['quads', 'backupQuads', 'positions', 'bases', 'rotations', 'scales', 'visibility'];
function packet(input) {
  const p = new NativeGraphicsPacket(new Array(0x290 / 4).fill(0));
  p.bytes(4, 128).set(encodeCP932(input.programName + '\0'));
  p.bytes(132, 128).set(encodeCP932(input.textureName + '\0'));
  p.store(260, input.count);
  p.store(264, input.priorityWord);
  for (let i = 0; i < 32; i++) p.store(268 + i * 4, 0x3f800000 + i);
  return p;
}
for (const build of golden.versions) {
  test(`${build.version} Particle resources match own initialized renderer, file, texture and release state through cold restore`, async () => {
    for (const row of build.cases) {
      const input = row.input,
        files = {
          [input.programName]: Buffer.from(input.script, 'base64'),
          [input.textureName]: Buffer.from(input.texture, 'base64'),
        },
        world = await modernParticleMessageWorld(build.profile, files);
      try {
        world.graphics.createLogicalDevice();
        const id = await world.objects.create({ kind: 16, parent: world.root }),
          task = world.particles.get(id),
          p = packet(input),
          target = world.nativeTaskID(id),
          send = (op) =>
            world.sendNativeEngine(
              target,
              world.main.id,
              (build.version === '74' ? 309 : 314) + op,
              0,
              0,
              op === 0 ? { payload: p } : {},
            );
        for (const e of row.expected) {
          if (e.label === 'missing-script') {
            p.bytes(4, 128).fill(0);
            p.bytes(4, 128).set(encodeCP932('missing.kcs\0'));
          }
          if (e.label.startsWith('external-')) {
            p.store(396, 1);
            p.store(264, input.reloadPriorityWord);
          }
          if (e.label.startsWith('empty-')) {
            p.bytes(4, 128).fill(0);
            p.bytes(4, 128).set(encodeCP932(input.programName + '\0'));
            p.bytes(132, 128).fill(0);
            p.store(264, input.reloadPriorityWord);
          }
          const op = {
            loaded: 0,
            started: 1,
            released: 3,
            reloaded: 0,
            'missing-script': 0,
            'empty-reloaded': 0,
            'empty-started': 1,
            'external-reloaded': 0,
            'external-started': 1,
          }[e.label];
          assert.equal(await send(op), NATIVE_UNWRITTEN_WORD);
          assert.equal(task.active, e.active, row.name + ' ' + e.label);
          assert.equal(task.state.alpha, e.alpha);
          assert.equal(task.state.attachment, e.attachment);
          assert.equal(!!task.bank, !!e.vm);
          const state = task.bank?.nativeAtlas ?? task.state.atlas;
          for (const field of ['width', 'height', 'priority', 'near'])
            assert.equal(state[field], e[field], row.name + ' ' + e.label + ' ' + field);
          const registers = task.bank?.instance.registers ?? task.state.registers;
          assert.equal(
            hash(new Uint8Array(registers.buffer, registers.byteOffset, registers.byteLength)),
            e.registers,
          );
          if (task.bank) {
            assert.equal(task.state.atlas, null, 'loaded bank owns its metadata');
            const instance = task.bank.instance;
            for (let i = 0; i < arrayFields.length; i++) {
              const a = instance[arrayFields[i]];
              assert.equal(
                hash(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)),
                e.buffers[i],
                row.name + ' ' + e.label + ' ' + arrayFields[i],
              );
            }
            assert.equal(hash(instance.machine.memory), e.vm.local);
            assert.equal(instance.machine.pc, e.vm.pc);
            assert.equal(instance.machine.sp, e.vm.sp);
            assert.equal(instance.machine.fp, e.vm.fp);
            if (e.texture) {
              const frame = world.stageRenderer.surfaceFrame(task.bank.nativeAtlas.pointer);
              assert.equal(frame.width, e.texture.width);
              assert.equal(frame.height, e.texture.height);
              assert.deepEqual(frame.rgba, new Uint8Array(Buffer.from(e.texture.rgba, 'base64')));
            } else assert.equal(task.bank.nativeAtlas.pointer, 0);
          } else {
            const snapshot = task.snapshot();
            assert.notEqual(snapshot.atlas, task.state.atlas);
            assert.deepEqual(snapshot.atlas, task.state.atlas);
            task.restore(snapshot);
            assert.notEqual(task.state.atlas, snapshot.atlas);
            assert.notEqual(task.state.registers, snapshot.registers);
          }
          const fresh = await modernParticleMessageWorld(build.profile, files, {
            initialize: false,
          });
          try {
            fresh.graphics.createLogicalDevice();
            await fresh.restore(
              await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
            );
            const copy = fresh.particles.get(id);
            assert.deepEqual(copy.snapshot(), task.snapshot());
            assert.deepEqual(copy.bank?.instance.snapshot(), task.bank?.instance.snapshot());
            if (task.bank?.nativeAtlas.pointer)
              assert.deepEqual(
                fresh.stageRenderer.surfaceFrame(copy.bank.nativeAtlas.pointer).rgba,
                world.stageRenderer.surfaceFrame(task.bank.nativeAtlas.pointer).rgba,
              );
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
        await world.objects.release(id);
        assert.equal(world.particles.host.banks.size, 0);
        assert.equal(world.particles.textures.owned.size, 0);
        assert.deepEqual(
          row.ownership.retainedNativeRecords,
          row.name === 'external' ? [{ bytes: 60 }] : [{ bytes: 60 }, { bytes: 60 }],
        );
        assert.equal(row.ownership.newDeviceObjectsAfterTaskDestroy, 0);
        assert.equal(row.ownership.openFilesAfterTaskDestroy, 0);
        assert.equal(row.ownership.rendererSingletonAfterDestroy, 0);
      } finally {
        await world.close({ flushFiles: false });
      }
    }
  });
  test(`${build.version} actual Main KCS loads a decoded texture through GameFiles and preserves its bank through cold restore`, async () => {
    const row = build.cases.find((c) => c.name === 'rgba3x2'),
      input = row.input,
      call = (id, args, output) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        ...(output === undefined ? [] : [[38, output]]),
      ],
      files = {
        'config/startup.xml': new TextEncoder().encode(
          '<?xml version="1.0" encoding="UTF-8"?><document><INT>' +
            '<int00><name>ptcl</name><int>script-box.int</int><ext>kcs</ext><dir>program-files</dir></int00>' +
            '<int01><name>image</name><int>image-box.int</int><ext>hg3</ext><dir>texture-files</dir></int01>' +
            '<int02><name>kcs</name><ext>kcs</ext></int02>' +
            '</INT></document>',
        ),
        'program-files/authored.kcs': Buffer.from(input.script, 'base64'),
        'texture-files/authored.hg3': Buffer.from(input.texture, 'base64'),
        'source.kcs': kcsProgram(
          [
            ...call(271, [0x700, 1024, 1056, input.count, input.priorityWord, 1280], 64),
            ...call(272, [0x700]),
            ...call(274, [0x700], 68),
            [59],
          ],
          [
            [1024, 'authored'],
            [1056, 'authored'],
          ],
        ),
      },
      world = await modernParticleMessageWorld(build.profile, files);
    let fresh;
    try {
      world.graphics.createLogicalDevice();
      const id = await world.objects.create({ kind: 16, parent: world.root, nativeID: 0x700 }),
        task = world.particles.get(id),
        source = await world.spawnScript('source.kcs'),
        e = row.expected.find((phase) => phase.label === 'started');
      for (let i = 0; i < 32; i++) source.machine.store(1280 + i * 4, 0x3f800000 + i);
      await world.runtime.scheduler.execute(source);
      assert.equal(source.status, 'finished');
      assert.equal(source.machine.load(64), 1);
      assert.equal(source.machine.load(68), 1);
      assert.equal(task.active, true);
      assert.equal(task.bank.program, 'script-box.int/authored.kcs');
      for (const field of ['width', 'height', 'priority', 'near'])
        assert.equal(task.bank.nativeAtlas[field], e[field]);
      const instance = task.bank.instance;
      for (let i = 0; i < arrayFields.length; i++) {
        const a = instance[arrayFields[i]];
        assert.equal(hash(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)), e.buffers[i]);
      }
      assert.deepEqual(
        world.stageRenderer.surfaceFrame(task.bank.nativeAtlas.pointer).rgba,
        new Uint8Array(Buffer.from(e.texture.rgba, 'base64')),
      );
      fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      fresh.graphics.createLogicalDevice();
      await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())));
      const copy = fresh.particles.get(id);
      assert.deepEqual(copy.snapshot(), task.snapshot());
      assert.deepEqual(copy.bank.instance.snapshot(), instance.snapshot());
      await fresh.objects.release(id);
      assert.equal(fresh.particles.textures.owned.size, 0);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
  test(`${build.version} first empty or external texture state is diagnosed; a defined image can subsequently initialize it`, async () => {
    const row = build.cases.find((c) => c.name === 'rgba3x2'),
      input = row.input,
      files = {
        [input.programName]: Buffer.from(input.script, 'base64'),
        [input.textureName]: Buffer.from(input.texture, 'base64'),
      };
    assert.equal(
      build.initialUndefined.classification,
      'capture-only-original-uninitialized-fields',
    );
    assert.equal(build.initialUndefined.allocation.flags, 0);
    for (const external of [false, true]) {
      const world = await modernParticleMessageWorld(build.profile, files);
      try {
        world.graphics.createLogicalDevice();
        const id = await world.objects.create({ kind: 16, parent: world.root }),
          task = world.particles.get(id),
          p = packet(input);
        if (external) p.store(396, 1);
        else p.bytes(132, 128).fill(0);
        await assert.rejects(
          world.sendEngine(id, world.main.id, 314, 0, 0, { payload: p }),
          /texture fields are uninitialized/,
        );
        assert.equal(task.bank, null);
        assert.equal(task.state.atlas, null);
        assert.equal(world.particles.textures.owned.size, 0);
        const saved = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
          fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
        try {
          fresh.graphics.createLogicalDevice();
          await fresh.restore(saved);
          const copy = fresh.particles.get(id);
          assert.equal(copy.state.atlas, null);
          assert.equal(copy.bank, null);
          await fresh.sendEngine(id, fresh.main.id, 314, 0, 0, { payload: packet(input) });
          assert.equal(copy.bank.nativeAtlas.width, input.width);
          assert.equal(copy.bank.nativeAtlas.height, input.height);
        } finally {
          await fresh.close({ flushFiles: false });
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    }
  });
}
