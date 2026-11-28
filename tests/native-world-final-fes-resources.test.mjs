// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const V = (at) => [0x13, at],
  call = (id, args, out) => [
    ...args.map((v) => [37, v]),
    [43, id, args.length * 4],
    ...(out === undefined ? [] : [[38, out]]),
  ];
function labels(rows) {
  const positions = new Map();
  let pc = 0;
  for (const row of rows)
    if (typeof row === 'string') positions.set(row, pc);
    else pc += 1 + 5 * (row.length - 1);
  return rows
    .filter(Array.isArray)
    .map((row) => row.map((v) => (typeof v === 'string' ? positions.get(v) : v)));
}
const child = (lateCreate) =>
  kcsProgram(
    labels([
      'wait',
      ...call(71, [240]),
      [39, 'wait'],
      [19, V(244), 0xffff0006],
      [39, 'wait'],
      ...call(210, [807]),
      ...(lateCreate ? [...call(68, [], 64), ...call(66, [2, V(64), 384], 68)] : []),
      ...call(645, [V(0x80000024), 0, 0]),
      ...call(630, [V(0x80000024), 256, 320, 0]),
      [41, 'wait'],
    ]),
    [
      [256, 'MES_SHOW'],
      [320, ''],
      [384, 'new callback child'],
    ],
  );
const parent = kcsProgram(
  labels([
    ...call(209, [2048]),
    ...call(68, [], 64),
    ...call(66, [15, V(64), 1024], 68),
    ...call(256, [V(68), 2, 2]),
    ...call(260, [V(68), 0, 0]),
    ...call(261, [V(68)], 88),
    ...call(117, [V(88), 0, 0, 2, 2, 0xff203040]),
    ...call(66, [15, V(64), 1024], 92),
    ...call(256, [V(92), 2, 2]),
    ...call(260, [V(92), 0, 0]),
    ...call(66, [34, V(64), 1088], 72),
    ...call(447, [V(72), 1152]),
    ...call(66, [12, V(72), 1216], 76),
    ...call(143, [V(76), 1280, 0]),
    ...call(66, [34, V(76), 1344], 80),
    ...call(447, [V(80), 1408]),
    ...call(449, [V(80), V(68)]),
    ...call(448, [V(80)]),
    ...call(66, [12, V(76), 1472], 84),
    ...call(143, [V(84), 1536, 0]),
    [37, V(80)],
    [38, 0x80000024],
    'wait',
    ...call(71, [240]),
    [39, 'wait'],
    [19, V(244), 0xffff0006],
    [39, 'wait'],
    ...call(247, [1600], 96),
    ...call(469, [V(96), 1024]),
    ...call(469, [V(96), 16384]),
    ...call(240, [V(96), 1024, V(64), 512, 512]),
    ...call(277, [800, 1680]),
    ...call(244, [V(96), 16384, 16, 1680]),
    ...call(245, [V(96), 1600]),
    ...call(246, [V(96)]),
    [41, 'wait'],
  ]),
  [
    [1024, 'owned surface'],
    [1088, 'parent FES'],
    [1152, 'empty.fes'],
    [1216, 'retirement Script'],
    [1280, 'child.kcs'],
    [1344, 'dependent FES'],
    [1408, 'hide.fes'],
    [1472, 'place waiter'],
    [1536, 'place.kcs'],
    [1600, 'savegen.dat'],
    [1680, 'owned finalizer'],
  ],
);
// Finite typed consumers of the observed MES_SHOW hide path. No glyph, GPU,
// mounted-file or audio generation is substituted by these CPU resources.
const hide = Buffer.from(`#DEFINE
BUTTON btn
BUTTON drag
PLANE pl
STRING8 text
CIMAGE bg
#OBJECT SIZE COLOR
pl 2,2 0xff203040
#OBJECT SIZE DISP ENABLE
btn 2,2 1 1
drag 2,2 1 1
#OBJECT SIZE
text 2,2
bg 2,2
#START
next WAIT
#WAIT
#MES_SHOW
btn enable 0
drag enable 0
pl stop
pl disp 0
text disp 0
bg disp 0
force_redraw
break
`);
const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const leaves = (e) => e.errors?.flatMap(leaves) ?? [e.message];
async function open(
  profile,
  { checkpoint, failNotify = false, lateCreate = false, failSave = false } = {},
) {
  const seed = new NativeGlobalFile();
  seed.write(1024, Uint8Array.of(1));
  seed.write(16384, Uint8Array.of(2));
  const saved = new Map([['savegen.dat', await seed.file()]]),
    storageEvents = [];
  const w = await modernParticleMessageWorld(
    profile,
    {
      'main.kcs': parent,
      'child.kcs': child(lateCreate),
      'place.kcs': kcsProgram([
        [37, 240],
        [43, 71, 4],
        [41, 0],
      ]),
      'empty.fes': Buffer.from('#START\nnext WAIT\n#WAIT\n'),
      'hide.fes': !profile.includes('2.6.1.76')
        ? Buffer.from(hide.toString().replace('STRING8 text', 'STRING text'))
        : hide,
    },
    {
      initialize: false,
      storage: {
        read: async (name) => {
          storageEvents.push(['read', name]);
          return saved.get(name)?.slice() ?? null;
        },
        write: async (name, bytes) => {
          storageEvents.push(['write', name]);
          if (failSave) throw new Error('authored local save failure');
          saved.set(name, bytes.slice());
          return true;
        },
      },
    },
  );
  w.graphics.createLogicalDevice();
  if (checkpoint) await w.restore(checkpoint);
  else {
    await w.initialize('main.kcs');
    await w.objects.tick(2);
  }
  const resolve = (at) => w.resolveTaskID(w.main.machine.load(at), w.main.id),
    roles = {
      draw: resolve(68),
      spare: resolve(92),
      parent: resolve(72),
      script: resolve(76),
      fes: resolve(80),
      waiter: resolve(84),
    },
    draw = w.graphics.drawTasks.get(roles.draw),
    fes = w.objects.objects.get(roles.fes).implementation,
    player = fes.player,
    events = [],
    redraws = [],
    native = w.runtime.native,
    flush = w.graphics.flushFESRedraw;
  assert(w.runtime.scheduler.tasks.get(roles.script).machine.waiting);
  assert(w.runtime.scheduler.tasks.get(roles.waiter).machine.waiting);
  assert.equal(w.objects.objects.get(roles.fes).parent, roles.script);
  w.runtime.native = async function (table, id, args, machine, task, ...rest) {
    const row = { id, task: task.id };
    if (w.disposalRequested) events.push(row);
    const result = await Reflect.apply(native, this, [table, id, args, machine, task, ...rest]);
    row.reply = result;
    if (w.disposalRequested && id === 66)
      row.createdWorldID = w.resolveTaskID(result.value, task.id);
    if (w.disposalRequested && id === 630 && failNotify)
      throw new Error('authored failure after completed final redraw');
    return result;
  };
  w.graphics.flushFESRedraw = async function (instance, ...args) {
    if (w.disposalRequested && instance === player.root && instance.forceRedrawPending) {
      const surfaceID = [...this.fesSurfaces].find(
          ([, owners]) => owners.get(instance.runtimeID) === instance.player,
        )?.[0],
        current = this.drawTasks.get(surfaceID);
      redraws.push({
        drawID: surfaceID,
        recordLive: w.objects.objects.has(surfaceID),
        drawLive: !!current,
        renderer: current?.state.renderer,
        input: !!w.inputFor(roles.fes),
        player: instance.player,
      });
    }
    return Reflect.apply(flush, this, [instance, ...args]);
  };
  storageEvents.length = 0;
  return { w, roles, draw, fes, player, events, redraws, saved, storageEvents };
}
function released(h) {
  assert(h.w.closed);
  assert.equal(h.w.objects.objects.size, 0);
  assert.equal(h.w.runtime.handles.records.size, 0);
  assert.equal(h.w.graphics.drawTasks.size, 0);
  assert.equal(h.w.graphics.fesSurfaces.size, 0);
  assert.equal(h.w.input.regions.length, 0);
  assert.equal(h.draw.state.renderer, null);
}
for (const profile of profiles) {
  test(
    profile +
      ' final Root completes local save, parsed waiters and FES hide/redraw before releasing the original surface',
    async () => {
      const h = await open(profile);
      await h.w.close({ flushFiles: false });
      assert.deepEqual(
        h.events.filter((e) => e.task === h.w.main.id).map((e) => e.id),
        [247, 469, 469, 240, 277, 244, 245, 246, 71],
      );
      assert.deepEqual(
        h.events.filter((e) => e.task === h.roles.script).map((e) => e.id),
        [210, 645, 630, 71],
      );
      assert.deepEqual(
        h.events.filter((e) => e.task === h.roles.waiter).map((e) => e.id),
        [71],
      );
      assert.equal(h.redraws.length, 1);
      assert.equal(h.redraws[0].recordLive, false);
      assert(h.redraws[0].drawLive && h.redraws[0].renderer && h.redraws[0].input);
      assert.equal(h.redraws[0].player, h.player);
      assert.deepEqual(h.storageEvents, [
        ['read', 'savegen.dat'],
        ['write', 'savegen.dat'],
      ]);
      const file = await NativeGlobalFile.fromFile(h.saved.get('savegen.dat'));
      assert.equal(file.read(1024).length, 2048);
      assert.equal(file.read(16384).length, 16);
      released(h);
      await h.w.close({ flushFiles: false });
      assert.equal(h.redraws.length, 1);
    },
  );
  test(
    profile +
      ' fresh cold restores owned surfaces and waiters, final callbacks are not checkpoint caches',
    async () => {
      const first = await open(profile),
        snapshot = await deserializeCheckpoint(await serializeCheckpoint(first.w.snapshot()));
      await first.w.close({ flushFiles: false });
      const h = await open(profile, { checkpoint: snapshot });
      assert.notEqual(h.draw, first.draw);
      await h.w.close({ flushFiles: false });
      assert.equal(h.redraws.length, 1);
      released(h);
    },
  );
  test(
    profile +
      ' failed callback and concurrent close still release retained surface resources exactly once',
    async () => {
      const h = await open(profile, { failNotify: true });
      const results = await Promise.allSettled([
        h.w.close({ flushFiles: false }),
        h.w.close({ flushFiles: false }),
      ]);
      assert(results.every((r) => r.status === 'rejected'));
      assert.equal(results[0].reason, results[1].reason);
      assert.deepEqual(leaves(results[0].reason), [
        'authored failure after completed final redraw',
      ]);
      assert.equal(h.redraws.length, 1);
      assert(h.events.some((e) => e.task === h.roles.waiter));
      released(h);
    },
  );
  test(
    profile +
      ' final surface identity survives ordinary callback allocation without resurrecting its task route',
    async () => {
      const h = await open(profile, { lateCreate: true });
      await h.w.close({ flushFiles: false });
      const created = h.events.find((row) => row.id === 66);
      assert(created);
      assert.notEqual(created.createdWorldID, h.roles.draw);
      assert.equal(h.redraws.length, 1);
      assert.equal(h.redraws[0].recordLive, false);
      released(h);
    },
  );
  test(
    profile + ' latest normal surface rebind is retained and the replaced surface closes normally',
    async () => {
      const h = await open(profile),
        spare = h.w.graphics.drawTasks.get(h.roles.spare);
      await h.w.runtime.native(
        'main',
        449,
        [h.w.nativeTaskID(h.roles.fes), h.w.nativeTaskID(h.roles.spare)],
        h.w.main.machine,
        h.w.main,
      );
      await h.w.close({ flushFiles: false });
      assert.equal(h.redraws.length, 1);
      assert.equal(h.redraws[0].drawID, h.roles.spare);
      assert.equal(h.draw.state.renderer, null);
      assert.equal(spare.state.renderer, null);
      released(h);
    },
  );
  test(
    profile + ' a surface already released before final cleanup retains its missing-resource guard',
    async () => {
      const h = await open(profile);
      await h.w.objects.release(h.roles.draw);
      assert.equal(h.draw.state.renderer, null);
      await assert.rejects(h.w.close({ flushFiles: false }), (error) => {
        assert(leaves(error).includes('FES hide force_redraw requires its native drawing surface'));
        return true;
      });
      released(h);
    },
  );
}

for (const profile of profiles) {
  test(
    profile + ' ordinary native Draw destruction still releases its surface before final shutdown',
    async () => {
      const h = await open(profile);
      await h.w.runtime.native(
        'main',
        67,
        [h.w.nativeTaskID(h.roles.draw)],
        h.w.main.machine,
        h.w.main,
      );
      assert.equal(h.draw.state.renderer, null);
      assert.equal(h.w.objects.objects.get(h.roles.draw).destroyRequested, true);
      await assert.rejects(
        h.w.runtime.native(
          'main',
          630,
          [h.w.nativeTaskID(h.roles.fes), 256, 320, 0],
          h.w.runtime.scheduler.tasks.get(h.roles.script).machine,
          h.w.runtime.scheduler.tasks.get(h.roles.script),
        ),
        /FES hide force_redraw requires its native drawing surface/,
      );
      await assert.rejects(h.w.close({ flushFiles: false }));
      released(h);
    },
  );
  test(
    profile +
      ' a local save callback failure does not skip the remaining parsed FES redraw and final resource release',
    async () => {
      const h = await open(profile, { failSave: true });
      await assert.rejects(h.w.close({ flushFiles: false }), (error) => {
        assert.deepEqual(leaves(error), ['authored local save failure']);
        return true;
      });
      assert.equal(h.redraws.length, 1);
      assert(h.events.some((row) => row.task === h.roles.waiter));
      released(h);
    },
  );
}
for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
])
  test(
    profile + ' existing legacy Draw retirement also completes the shared final dependency chain',
    async () => {
      const h = await open(profile);
      await h.w.close({ flushFiles: false });
      assert.equal(h.redraws.length, 1);
      released(h);
    },
  );

test('retained resource identities are exact, nested and finally reusable without retaining task routes', async () => {
  const objects = new NativeObjects();
  objects.register(0, () => ({ message: () => 0 }));
  const id = await objects.create({ kind: 0 }),
    record = objects.objects.get(id),
    release = objects.retainResourceIdentity(record),
    second = objects.retainResourceIdentity(record);
  assert.throws(() => objects.retainResourceIdentity({ ...record }), /actual live task/);
  await objects.release(id);
  assert.equal(objects.objects.has(id), false);
  const another = await objects.create({ kind: 0 });
  assert.equal(another, 1);
  release();
  release();
  await objects.release(another);
  const third = await objects.create({ kind: 0 });
  assert.equal(third, 1);
  second();
  const reused = await objects.create({ kind: 0 });
  assert.equal(reused, 0);
  await objects.release(third);
  await objects.release(reused);
});
