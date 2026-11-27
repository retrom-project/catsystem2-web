// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk63-67-motion-fes-consumer-golden.json', import.meta.url)),
  ),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const addresses = { caller: 80, top: 64, fes: 68 };
// Native Top publication is a reused prerequisite. This World already owns its
// constructed kind1 Root; nested Top/native-ID routing is outside this fixture.
function program(b) {
  const initial = [];
  for (const [at, s] of [
    [256, 'MOT consumer'],
    [320, 'mot-consumer'],
    [384, 'READ'],
    [448, ''],
    [512, 'CHANGE'],
  ]) {
    const a = Buffer.alloc(Math.ceil((s.length + 1) / 4) * 4);
    a.write(s);
    for (let i = 0; i < a.length; i += 4) initial.push([37, a.readUInt32LE(i)], [38, at + i]);
  }
  return kcsProgram([
    [37, 512],
    [43, 209, 4],
    ...initial,
    ...b.cases
      .filter((r) => r.id && !r.dependency && !r.openReload)
      .flatMap((r) => [
        ...r.args.map((n) => [37, typeof n === 'string' ? [0x13, addresses[n]] : n]),
        [43, r.id, r.args.length * 4],
        ...(r.save ? [[38, addresses[r.save]]] : []),
        ...(r.id === 630
          ? [
              ...[61, 62].flatMap((n, i) => [
                [37, n],
                [43, 210, 4],
                [38, 96 + i * 4],
              ]),
            ]
          : []),
        [37, 240],
        [43, 71, 4],
      ]),
    [59],
  ]);
}
async function open(b, initialize = true) {
  return modernParticleMessageWorld(
    b.profile,
    {
      'startup.xml': bytes(b.inputs.xml),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['consumer.kcs', program(b)],
      ]),
      'tables.int': kif([['mot-consumer.fes', Buffer.from(b.inputs.source)]]),
      'motion.int': kif([['consumer.kcs', bytes(b.inputs.motionProgram)]]),
      'images.int': kif([['unused.dat', new Uint8Array(16)]]),
      'scene.int': kif([['unused.dat', new Uint8Array(16)]]),
    },
    { initialize },
  );
}
async function compare(w, t, r) {
  assert.deepEqual(
    [t.machine.load(96), t.machine.load(100)],
    r.globalXY,
    r.label + ' actual callback/variables',
  );
  if (r.fesAlive === false) {
    assert(![...w.objects.objects.values()].some((x) => x.kind === 34), 'normal Root retires FES');
  }
  if (r.clock !== undefined) {
    const id = w.resolveTaskID(t.machine.load(68), t.id),
      record = w.objects.objects.get(id);
    assert.equal(record.kind, 34);
    assert.equal(record.effectiveFrame, r.clock, r.label + ' actual task clock');
    assert.equal(record.pausedFrames, r.paused, r.label + ' paused clock');
    // The native constructor/Main448 write pair independently establishes this
    // gate. Frame0 still initializes the Base clock before any FES decoding.
    if (r.frame === 0) assert.equal(record.implementation.runEnabled, false);
    if (r.id === 448) assert.equal(record.implementation.runEnabled, true);
  }
  assert.equal(w.motionLibrary.scripts.size, r.sourceCount, r.label + ' source cache');
}
for (const b of golden.builds)
  for (const coldAt of [null, 3, 9, 10, 14])
    test(
      'SDK' +
        b.version +
        ' true FES MOT ' +
        'clock/notification/Root lifetime' +
        (coldAt === null ? '' : ' cold' + coldAt),
      async () => {
        let w = await open(b),
          t = await w.spawnScript('consumer.kcs', { initialExecute: false });
        t.machine.store(80, w.nativeTaskID(t.id));
        t.machine.store(64, w.nativeTaskID(w.root));
        await w.sendEngine(t.id, t.id, 162, 0, 0);
        await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
        try {
          for (let k = 0; k < b.cases.length; k++) {
            const r = b.cases[k];
            // Raw319 replacement ownership and the reused Root are not paired rows.
            if (r.openReload || r.dependency) continue;
            if (r.frame !== undefined) await w.objects.tick(r.frame);
            else if (t.machine.waiting?.kind === 'message')
              await w.runtime.scheduler.send(t.id, [240, 0, 0, 0]);
            else await w.runtime.scheduler.execute(t);
            await compare(w, t, r);
            if (k === coldAt) {
              const id = t.id,
                s = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
              await w.close({ flushFiles: false });
              w = await open(b, false);
              await w.restore(s);
              t = w.runtime.scheduler.tasks.get(id);
              await compare(w, t, r);
            }
          }
        } finally {
          await w.close({ flushFiles: false });
        }
      },
    );
