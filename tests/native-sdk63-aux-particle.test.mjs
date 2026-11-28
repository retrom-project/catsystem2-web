// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { kcsProgram, hg3 } from './helpers.mjs';
const f = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk63-aux-particle.json', import.meta.url)),
  ),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64')),
  fields = ['quads', 'backupQuads', 'positions', 'bases', 'rotations', 'scales', 'visibility'];
const open = async (initialize) => {
  const startup = bytes(f.inputs.startup),
    w = await modernParticleMessageWorld(
      f.profile,
      {
        'startup.xml': startup,
        ...Object.fromEntries(f.inputs.archives.map((r) => [r.name, bytes(r.bytes)])),
      },
      { initialize, startup: parseXML(new TextDecoder().decode(startup)) },
    );
  w.graphics.createLogicalDevice();
  return w;
};
for (const coldAt of [null, 0, 1, 2, 3, 4, 5, 6])
  test(`SDK63 v2 table/quad/atlas/owned register lifecycle${coldAt === null ? ' normal' : ' cold after ' + coldAt}`, async () => {
    let w = await open(true),
      caller = await w.spawnScript('aux-main', { initialExecute: false }),
      generation = 0;
    const trace = [],
      observed = new WeakSet();
    let phase = 0;
    const observe = () => {
      const task = w.particles.get(w.resolveTaskID(caller.machine.load(40), caller.id)),
        i = task?.bank?.instance;
      if (!i || observed.has(i)) return;
      observed.add(i);
      generation++;
      const native = i.native.bind(i);
      i.native = (id, args, m) => {
        const r = native(id, args, m),
          row = {
            phase,
            id,
            args: [...args],
            control: r.control,
            written: r.control === 1,
            ...(r.control === 1 ? { value: r.value } : {}),
            ...([22, 23, 24, 25, 26, 30].includes(id)
              ? { quad: Buffer.from(m.bytes(args[0], 112)).toString('base64') }
              : {}),
            ...([5, 28, 38].includes(id)
              ? { outputs: args.slice(id === 38 ? 1 : 0).map((at) => m.load(at)) }
              : {}),
            generation,
          };
        trace.push(row);
        return r;
      };
    };
    const compare = async (row) => {
      assert.deepEqual(
        [160, 164, 168, 172, 176, 180, 184].map((at) => caller.machine.load(at)),
        row.caller,
      );
      assert.deepEqual(
        [...caller.machine.bytes(1152, 128)],
        row.source,
        'register producer source is independently zeroed',
      );
      const task = w.particles.get(w.resolveTaskID(caller.machine.load(40), caller.id)),
        p = row.particle;
      assert.equal(Boolean(task), p.alive);
      if (!task) return;
      const bank = task.bank,
        i = bank.instance;
      assert.equal(i.table, 'particle-v2');
      assert.equal(Number(task.active), p.active);
      assert.equal(i.frame, p.frame);
      for (const [k, key] of fields.entries())
        assert.deepEqual(
          new Uint8Array(i[key].buffer, i[key].byteOffset, i[key].byteLength),
          bytes(p.buffers[k]),
          key,
        );
      if (p.executed) {
        assert.equal(i.before, p.before, 'shared native idle completion stamp');
        assert.equal(i.now, p.now);
        for (const [at, value] of Object.entries(p.results))
          assert.equal(i.machine.load(+at), value, 'real table result ' + at);
        assert.deepEqual(i.machine.bytes(128, 128), bytes(p.registers));
      }
      if (row.drawCount !== undefined) {
        const draws = [];
        for (const item of w.particles.drawItems())
          await item.drawGPU({
            drawGeometry(geometry, image) {
              for (const q of geometry) {
                const v = q.vertices;
                draws.push({
                  triangles: [
                    [v[0], v[1], v[2]],
                    [v[2], v[1], v[3]],
                  ],
                  atlas: {
                    width: image.width,
                    height: image.height,
                    rgba: Buffer.from(image.rgba).toString('base64'),
                  },
                });
              }
            },
          });
        assert.deepEqual(
          draws,
          f.draws
            .filter((r) => r.phase === row.phase)
            .map(({ triangles, atlas }) => ({ triangles, atlas })),
          'actual native COM-memory triangle/atlas consumer',
        );
      }
    };
    try {
      for (const row of f.rows) {
        phase = row.phase;
        if (phase)
          assert.equal(
            (
              await w.runtime.native(
                'main',
                70,
                [w.nativeTaskID(caller.id), 0x51a, phase, 0],
                w.main.machine,
                w.main,
              )
            ).value,
            1,
          );
        await w.objects.update(w.root, 700 + phase);
        await compare(row);
        observe();
        if (phase === coldAt) {
          const id = caller.id,
            state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
          await w.close({ flushFiles: false });
          w = await open(false);
          await w.restore(state);
          caller = w.runtime.scheduler.tasks.get(id);
          await compare(row);
          if (row.particle.alive) generation--;
          observe();
        }
      }
      assert.deepEqual(
        trace,
        f.calls,
        'actual table namespace/parameters/control/writeback/generation',
      );
      assert.equal(w.particles.host.banks.size, 0);
      assert.equal(w.particles.textures.owned.size, 0);
      assert.equal(w.nativeEngine, undefined);
    } finally {
      await w.close({ flushFiles: false });
    }
  });
for (const [version, name] of [
  ['23', 'grisaia-jp'],
  ['63', 'rebellions-jp'],
  ['67', 'bokutomo'],
  ['74', 'sdk-4.01'],
  ['76', 'nekopara-vol3'],
])
  test(`own${version} common native idle commits before stamp after its actual VM consumers`, async () => {
    const profile = name + '-engine-2.6.1.' + version,
      code = kcsProgram([[43, 1, 0], [38, 64], [43, 2, 0], [38, 68], [59]]);
    new DataView(code.buffer, code.byteOffset).setUint16(8, 2, true);
    const image = hg3(1, 1, new Uint8Array([17, 91, 203, 255])),
      w = await modernParticleMessageWorld(profile, { 'body.kcs': code, 'atlas.hg3': image });
    w.graphics.createLogicalDevice();
    try {
      const m = w.main.machine;
      m.writeString('body.kcs', 256);
      m.writeString('atlas.hg3', 320);
      m.bytes(512, 128).fill(0);
      const id = (
        await w.runtime.native('main', 66, [16, w.nativeTaskID(w.main.id), 256], m, w.main)
      ).value;
      await w.runtime.native('main', 271, [id, 256, 320, 1, 0, 512], m, w.main);
      await w.runtime.native('main', 272, [id], m, w.main);
      await w.objects.update(w.root, 700);
      const task = w.particles.get(w.resolveTaskID(id, w.main.id));
      const i = task.bank.instance;
      assert.equal(i.machine.load(68), 0xffffffff, 'first VM query sees pre-idle sentinel');
      assert.equal(i.before, i.frame, 'idle commits only after the VM');
      const previous = i.frame;
      await w.objects.update(w.root, 701);
      assert.equal(i.machine.load(68), previous, 'next VM consumes previous completion');
      assert.equal(i.before, i.frame);
      assert.equal(
        nativeABI(profile).particle.beforeFrameUpdatedByIdle,
        undefined,
        'no unproved SDK capability split',
      );
    } finally {
      await w.close({ flushFiles: false });
    }
  });
