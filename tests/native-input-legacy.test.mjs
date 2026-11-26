// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-input-legacy-golden.json', import.meta.url), 'utf8'),
);
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const marker = 0xc3315489;
function program(rows) {
  return kcsProgram([
    [37, marker],
    ...rows.flatMap((row) => [
      ...row.args.map((arg, index) => [
        37,
        [144, 146, 147, 148].includes(row.id) && index === 0 && arg === 3 ? [0x13, 128] : arg,
      ]),
      [43, row.id, row.args.length * 4],
      ...(row.control === 1 ? [[45]] : []),
    ]),
    [59],
  ]);
}
async function replay(t, own, family, { before, after, setup } = {}) {
  const rows = own.groups[family],
    world = await dataWorld(own.profile, { 'input.kcs': program(rows) });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('input.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    machine = task.machine;
  machine.store(128, world.nativeTaskID(task.id));
  await setup?.(world, task);
  const dispatch = world.runtime.scheduler.dispatch;
  let index = 0;
  world.runtime.scheduler.dispatch = async (table, id, args, m, caller, ...rest) => {
    if (caller !== task) return dispatch(table, id, args, m, caller, ...rest);
    const row = rows[index++];
    assert.equal(id, row.id);
    await before?.(row, world, task);
    const reply = await dispatch(table, id, args, m, caller, ...rest);
    assert.equal(reply.control, row.control, row.label);
    if (row.control === 1) assert.equal(reply.value, row.result, row.label);
    await after?.(row, world, task);
    return reply;
  };
  await world.runtime.scheduler.execute(task);
  assert.equal(index, rows.length);
  assert.equal(task.machine.halted, true);
  assert.equal(machine.sp, machine.data.length + 4);
  assert.equal(machine.pop(), marker);
  return { world, task };
}
for (const own of golden.versions) {
  test(`${own.version} own Input registration GCALLs preserve order, fields and independent cold ownership`, async (t) => {
    const { world } = await replay(t, own, 'register', {
      setup: (world, task) => {
        [-2, 3, 30, 40, 12, 14, 22, 24].forEach((w, i) => task.machine.store(256 + i * 4, w));
      },
      after: async (row, world, task) => {
        assert(world.input.regions.every((record) => record.owner === task.id));
        const records = world.input
          .ordered()
          .map((r) => [
            3,
            r.priority,
            r.mask,
            ...r.bounds.map((w) => w >>> 0),
            r.active,
            r.enabled,
            r.hoverEnabled,
            r.dragEnabled,
          ]);
        assert.deepEqual(records, row.records, row.label);
      },
    });
    assert.equal(world.input.regions.length, 0);
    const retainedOwn = {
        ...own,
        groups: { ...own.groups, register: own.groups.register.slice(0, 5) },
      },
      retained = await replay(t, retainedOwn, 'register', {
        setup: (_world, task) => {
          [-2, 3, 30, 40, 12, 14, 22, 24].forEach((w, i) => task.machine.store(256 + i * 4, w));
        },
      }),
      task = retained.task,
      saved = structuredClone(retained.world.snapshot()),
      fresh = await dataWorld(
        own.profile,
        { 'input.kcs': program(retainedOwn.groups.register) },
        { initialize: false },
      );
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(saved);
    const restored = fresh.input.get(task.id);
    assert(restored);
    assert.equal(restored.mask, 0x80000000);
    assert.equal(fresh.input.regions.length, 2);
    const ft = fresh.runtime.scheduler.tasks.get(task.id),
      owner = fresh.nativeTaskID(task.id);
    ft.machine.store(256, 99);
    await fresh.runtime.native('main', 147, [owner, 256], ft.machine, ft);
    assert.equal(restored.bounds[0], 99);
    assert.equal(world.input.regions.length, 0);
    assert.throws(() => fresh.runtime.native('main', 688, [], ft.machine, ft), /Unsupported/);
    assert.equal(nativeABI(own.profile).tables.main.entries[688].status, 'unknown');
  });
  test(`${own.version} own Input text request, pending read, cancel and confirm use exact CP932 bytes`, async (t) => {
    let resolveText,
      requests = 0;
    await replay(t, own, 'text', {
      setup: (world, task) => {
        task.machine.bytes(256, 6).set([0x82, 0xa0, 0x82, 0xa2, 0x41, 0]);
        task.machine.bytes(512, 260).fill(0xcc);
        world.host.inputText = (text, options) => {
          assert.equal(options.maxLength, 16);
          assert.equal(text, requests++ ? 'B' : 'あいA');
          return new Promise((resolve) => {
            resolveText = resolve;
          });
        };
      },
      before: async (row, world, task) => {
        if (row.label === 'second request') task.machine.bytes(256, 2).set([0x42, 0]);
        if (row.label === 'cancel status') {
          resolveText(null);
          await Promise.resolve();
        }
        if (row.label === 'confirm status') {
          resolveText('テスト\\');
          await Promise.resolve();
        }
      },
      after: (row, world, task) => {
        assert.equal(world.input.textStatus, row.status, row.label);
        assert.equal(hex(world.input.textBytes), row.text, row.label);
        assert.equal(hex(task.machine.bytes(512, 260)), row.output, row.label);
        if (row.label === 'pending status') assert.throws(() => world.snapshot(), /settle/);
      },
    });
    assert.equal(requests, 2);
  });
  test(`${own.version} own Input cursor wrappers preserve native halves, words, notifications and key gates`, async (t) => {
    const services = [],
      calls = [];
    let start = 0;
    await replay(t, own, 'cursor', {
      setup: (world, task) => {
        const block = new DataView(
          world.configuration.blocks[2].buffer,
          world.configuration.blocks[2].byteOffset,
        );
        block.setUint32(16, 0, true);
        block.setUint32(20, 0, true);
        world.input.configureCursor();
        world.input.idleFrames = 0;
        task.machine.writeString('カーソル', 256);
        world.host.nativeCursorImageChanged = (name, x, y) => {
          services.push({ name, x, y });
          calls.push({ service: 'image', x, y });
          return 0;
        };
        world.host.nativeCursorChanged = () =>
          calls.push({ service: 'visible', word: world.graphics.cursor.state.visibleWord });
      },
      before: () => {
        start = calls.length;
      },
      after: (row, world) => {
        const input = world.input;
        assert.deepEqual(
          [
            input.cursorEnabled,
            Number(input.cursorVisible),
            input.cursorAutoHide,
            input.cursorHideFrames,
            input.idleFrames,
          ],
          row.input.slice(0, 5),
          row.label,
        );
        assert.deepEqual([...input.enabled], row.gates, row.label);
        assert.deepEqual(
          calls.slice(start),
          row.services.map(({ service, x, y, word }) =>
            service === 'image' ? { service, x, y } : { service, word },
          ),
          row.label,
        );
      },
    });
    assert.deepEqual(services, [{ name: 'カーソル', x: 32769, y: 22136 }]);
    assert.equal(
      hex(encodeCP932(services[0].name)),
      own.groups.cursor[0].services[0].bytes.slice(0, 16),
    );
  });
}

for (const own of golden.versions) {
  test(`${own.version} actual Input frames dispatch finite edges and stop after unregister`, async (t) => {
    const world = await dataWorld(own.profile, {
      'input.kcs': program([{ ...own.groups.register[0], args: [3, 5, 256, 0xffffffff] }]),
    });
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('input.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      m = task.machine;
    m.store(128, world.nativeTaskID(task.id));
    [-2, -2, 8, 8].forEach((word, i) => m.store(256 + i * 4, word));
    await world.runtime.scheduler.execute(task);
    const events = [],
      record = world.objects.objects.get(task.id),
      input = world.inputFor(task.id);
    record.implementation.message = async (words) => {
      events.push([...words, 0]);
      return 0;
    };
    for (const step of own.frames) {
      if (step.afterUnregister) await world.runtime.native('main', 145, [], m, task);
      else input.key(step.key, !!step.source, step.source, step.slot);
      const at = events.length;
      assert.equal(await input.tick(step.frame), 1);
      const normalized = events.slice(at).map(([sender, ...words]) => [sender, ...words]);
      assert.deepEqual(normalized, step.events, `frame ${step.frame}`);
    }
  });
  test(`${own.version} Main66 creates a distinct Input owner and Main67 retires before actual collection`, async (t) => {
    const files = {
        'new-input.kcs': kcsProgram([[37, 11], [37, 0], [37, 256], [43, 66, 12], [38, 64], [59]]),
      },
      world = await dataWorld(own.profile, files);
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('new-input.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    task.machine.writeString('Second Input owner', 256);
    await world.runtime.scheduler.execute(task);
    const nativeID = task.machine.load(64),
      id = world.resolveTaskID(nativeID, task.id),
      record = world.objects.objects.get(id),
      input = record.implementation.inputState;
    assert.equal(record.kind, 11);
    assert.notEqual(input, world.input);
    assert.equal(input.keyCount, own.version === '23' ? 64 : 80);
    assert.equal(input.configuration, world.configuration);
    await world.runtime.native('main', 67, [nativeID], task.machine, task);
    assert.equal(record.destroyRequested, true);
    assert.equal(world.objects.objects.has(id), own.lifecycle.stillRetained);
    const saved = structuredClone(world.snapshot()),
      fresh = await dataWorld(own.profile, files, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(saved);
    assert.equal(fresh.objects.objects.get(id).destroyRequested, true);
    await world.objects.tick(1);
    assert.equal(world.objects.objects.has(id), own.lifecycle.retained);
    assert(fresh.objects.objects.has(id));
    await fresh.objects.tick(1);
    assert.equal(fresh.objects.objects.has(id), false);
    assert(world.objects.objects.has(world.primaryInputTaskID));
  });
  test(`${own.version} Input cursor uses owned decoded images through fresh restore and release`, async (t) => {
    const world = await dataWorld(own.profile),
      fresh = await dataWorld(own.profile, {}, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    t.after(() => world.close({ flushFiles: false }));
    const frames = {
      カーソル: { width: 32, height: 32 },
      second: { width: 32, height: 32 },
      large: { width: 33, height: 32 },
    };
    const resolve = world.game.resolveCategory?.bind(world.game);
    world.game.resolveCategory = (name, ...args) =>
      frames[name] ? name : (resolve?.(name, ...args) ?? null);
    world.graphics.images.images.load = async (name) => ({
      frame: () => frames[name] && { ...frames[name], bpp: 32 },
      decode: async (frame) => {
        frame.rgba = new Uint8ClampedArray(frame.width * frame.height * 4).fill(171);
      },
    });
    world.host.nativeCursorImageChanged = (...args) =>
      world.graphics.cursor.setImage(...args.slice(0, 3));
    const task = world.main,
      m = task.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, task);
    m.writeString('カーソル', 256);
    await call(395, [256, 3, 4]);
    const cursor = world.graphics.cursor,
      image = cursor.state.image,
      backup = cursor.state.backup;
    assert(image && backup);
    assert.notEqual(image, backup);
    assert.equal(world.graphics.images.get(image).owner, null);
    const saved = structuredClone(world.snapshot());
    await fresh.restore(saved);
    m.writeString('large', 256);
    await call(395, [256, 10, 12]);
    assert.equal(cursor.state.image, image);
    assert.deepEqual(cursor.state.hotspot, [3, 4]);
    m.writeString('second', 256);
    await call(395, [256, 5, 6]);
    assert.notEqual(cursor.state.image, image);
    assert.equal(cursor.state.backup, backup);
    assert.throws(() => world.graphics.images.get(image), /released/);
    assert.equal(fresh.graphics.cursor.state.image, image);
    const pixels = await fresh.graphics.images.get(image).pixels();
    assert(pixels.every((byte) => byte === 171));
    pixels[0] = 17;
    assert.equal((await fresh.graphics.images.get(backup).pixels())[0], 171);
    assert.equal((await world.graphics.images.get(backup).pixels())[0], 171);
    await cursor.close();
    assert.throws(() => world.graphics.images.get(backup), /released/);
    assert.equal(fresh.graphics.images.get(backup).width, 32);
  });
}
