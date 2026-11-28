// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, hg3 } from './helpers.mjs';
import { particleRenderState } from '../src/render/particles-gl.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const f = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk63-particle-attachment.json', import.meta.url)),
  ),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64')),
  fields = ['quads', 'backupQuads', 'positions', 'bases', 'rotations', 'scales', 'visibility'];
async function open(c, initialize = true) {
  const startup = bytes(c.inputs.startup),
    w = await modernParticleMessageWorld(
      f.profile,
      {
        'startup.xml': startup,
        ...Object.fromEntries(c.inputs.archives.map((r) => [r.name, bytes(r.bytes)])),
      },
      { initialize, startup: parseXML(new TextDecoder().decode(startup)) },
    );
  w.graphics.createLogicalDevice();
  return w;
}
for (const c of f.cases)
  for (const coldAt of [null, ...c.cold])
    test(`SDK63 Particle ${c.name} actual Plane/atlas ownership${coldAt === null ? ' normal' : ' cold ' + coldAt}`, async () => {
      let w = await open(c),
        caller = await w.spawnScript('attachment-main', { initialExecute: false }),
        phase = 0;
      const trace = [],
        observed = new WeakSet();
      const role = (value) => {
        for (const [at, name] of [
          [52, 'plane2'],
          [44, 'plane1'],
        ])
          if (caller.machine.load(at) && caller.machine.load(at) === value) return name;
        return value;
      };
      const task = () => w.particles.get(w.resolveTaskID(caller.machine.load(48), caller.id));
      function observe() {
        const i = task()?.bank?.instance;
        if (!i || observed.has(i)) return;
        observed.add(i);
        const native = i.native.bind(i);
        i.native = (id, args, m) => {
          const r = native(id, args, m),
            q = {
              phase,
              table: i.table,
              id,
              args: [...args],
              control: r.control,
              written: r.control === 1,
            };
          if (q.written) q.value = id === 46 ? role(r.value) : r.value;
          if (id === 48 || id === 49) q.outputs = args.map((at) => m.load(at));
          if (id === 30) q.quad = Buffer.from(m.bytes(args[0], 112)).toString('base64');
          trace.push(q);
          return r;
        };
      }
      async function compare(row) {
        assert.deepEqual(
          [160, 164, 168, 172, 176, 180, 184, 188, 192].map((at) => caller.machine.load(at)),
          row.caller,
        );
        if (row.zeroedRegisterSource)
          assert.deepEqual([...caller.machine.bytes(1152, 128)], row.zeroedRegisterSource);
        for (const [index, p] of row.planes.entries()) {
          const id = caller.machine.load(index ? 52 : 44),
            record = w.objects.objects.get(w.resolveTaskID(id, caller.id));
          assert.equal(Boolean(record), p.alive, p.role + ' independently retires');
        }
        const t = task(),
          p = row.particle;
        assert.equal(Boolean(t), p.alive);
        if (t) {
          const i = t.bank.instance;
          assert.equal(i.table, p.table);
          assert.equal(Number(t.active), p.active);
          assert.equal(t.state.alpha, p.alpha);
          if (p.blendMode !== undefined)
            assert.equal(i.blendMode, p.blendMode, 'task-owned blend survives source reload');
          assert.equal(role(t.state.attachment >>> 0), p.attachment);
          if (p.executed) {
            assert.equal(i.frame, p.frame);
            assert.equal(i.before, p.before);
            assert.equal(i.now, p.now);
            for (const [at, value] of Object.entries(p.results))
              assert.equal(
                +at === 64 ? role(i.machine.load(+at)) : i.machine.load(+at),
                value,
                'actual attached query ' + at,
              );
            for (const [k, key] of fields.entries())
              assert.deepEqual(
                new Uint8Array(i[key].buffer, i[key].byteOffset, i[key].byteLength),
                bytes(p.buffers[k]),
                key,
              );
          }
        }
        if (row.drawCount !== undefined) {
          const draws = [];
          for (const item of w.particles.drawItems())
            await item.drawGPU({
              drawGeometry(geometry, image, options) {
                for (const q of geometry) {
                  const v = q.vertices;
                  draws.push({
                    blendFactors: [19, 20].map((id) =>
                      particleRenderState(options.blendMode).states.get(id),
                    ),
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
            c.draws
              .filter((r) => r.phase === row.phase)
              .map(({ triangles, atlas, blendFactors }) => ({ triangles, atlas, blendFactors })),
            'actual Root/View native quad and decoded atlas',
          );
        }
      }
      try {
        for (const row of c.rows) {
          phase = row.phase;
          observe();
          if (phase)
            assert.equal(
              (
                await w.runtime.native(
                  'main',
                  70,
                  [w.nativeTaskID(caller.id), f.tag, phase, 0],
                  w.main.machine,
                  w.main,
                )
              ).value,
              1,
            );
          await w.objects.update(w.root, 700 + phase);
          observe();
          if (row.drawCount !== undefined) await w.objects.drawTick(700 + phase);
          await compare(row);
          if (phase === coldAt) {
            const id = caller.id,
              state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
            await w.close({ flushFiles: false });
            w = await open(c, false);
            await w.restore(state);
            caller = w.runtime.scheduler.tasks.get(id);
            observe();
            await compare(row);
          }
        }
        assert.deepEqual(
          trace,
          c.calls,
          'actual v1/v2 dispatch/control/writeback through old and new instances',
        );
        if (c.name === 'attachment') {
          assert.equal(w.particles.host.banks.size, 0);
          assert.equal(w.particles.textures.owned.size, 0);
        }
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
  test(`own${version} native graph enable and callback binding remain independent through source replacement`, async () => {
    const profile = name + '-engine-2.6.1.' + version,
      code = kcsProgram([[37, 512], [43, 30, 4], [37, 1], [43, 50, 4], [59]]);
    new DataView(code.buffer, code.byteOffset).setUint16(8, 2, true);
    const image = hg3(1, 1, new Uint8Array([17, 91, 203, 255])),
      w = await modernParticleMessageWorld(profile, { 'body.kcs': code, 'atlas.hg3': image });
    w.graphics.createLogicalDevice();
    const m = w.main.machine;
    try {
      m.writeString('body.kcs', 256);
      m.writeString('atlas.hg3', 320);
      m.bytes(512, 128).fill(0);
      const id = (
          await w.runtime.native('main', 66, [16, w.nativeTaskID(w.main.id), 256], m, w.main)
        ).value,
        call = (op, args = []) => w.runtime.native('main', op, [id, ...args], m, w.main),
        task = () => w.particles.get(w.resolveTaskID(id, w.main.id));
      await call(271, [256, 320, 1, 0, 512]);
      await call(272);
      await w.objects.update(w.root, 700);
      assert.equal(w.particles.drawItems().length, 1);
      await call(271, [256, 320, 1, 0, 512]);
      const b = task().bank;
      assert.equal(Number(task().active), 1, 'load retains active independently of graph callback');
      assert.equal(b.instance.blendMode, 1, 'same task owns mode across load');
      assert.equal(b.nativeDrawBound, false);
      assert.equal(b.nativeDrawEnabled, false);
      await w.objects.update(w.root, 701);
      assert.equal(b.nativeDrawEnabled, true, 'idle enables the newly registered graph');
      assert.equal(b.nativeDrawBound, false, 'idle never invents a Start callback');
      assert.deepEqual(w.particles.drawItems(), []);
      const snapshot = w.particles.snapshot();
      delete snapshot.banks[0].nativeDrawBound;
      assert.throws(
        () => w.particles.host.validateNativeDrawPortState(snapshot),
        /callback binding/,
      );
      await call(272);
      assert.equal(b.nativeDrawBound, true);
      assert.equal(w.particles.drawItems().length, 1);
      const stale = w.particles.drawItems()[0];
      await call(273);
      await stale.drawGPU({
        drawGeometry() {
          assert.fail('stopped native port must not draw');
        },
      });
      await w.sendEngine(task().record.id, w.main.id, 317);
      assert.equal(task().snapshot().blendMode, 1, 'explicit bank release retains task mode');
      const missingMode = task().snapshot();
      delete missingMode.blendMode;
      assert.throws(() => task().restore(missingMode), /initialized blend mode/);
      await call(271, [256, 320, 1, 0, 512]);
      assert.equal(task().bank.instance.blendMode, 1, 'new bank uses its surviving task owner');
      assert.equal(nativeABI(profile).particle.drawPortRequiresStart, undefined);
      assert.equal(nativeABI(profile).particle.drawPortEnabledByIdle, undefined);
    } finally {
      await w.close({ flushFiles: false });
    }
  });
