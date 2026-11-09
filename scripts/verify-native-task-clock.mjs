// SPDX-License-Identifier: MPL-2.0
// Original main 5/7 in both fixed profiles; game base-frame bookkeeping with
// an empty native child map. No task-clock handler is replaced.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Binary } from '../src/binary.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { nativeTask } from '../src/native/task.mjs';
import { nativeFES } from '../src/native/fes.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

const [exe, output] = process.argv.slice(2);
if (!exe || !output)
  throw new Error('Usage: node scripts/verify-native-task-clock.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(exe)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_EXE_PROFILES).find(([, p]) => p.sha256 === sha256);
if (!profile) throw new Error('Task-clock oracle requires a fixed executable');
const b = new Binary(bytes),
  pe = b.u32(60),
  optional = pe + 24,
  image = new Uint8Array(b.u32(optional + 56));
image.set(b.range(0, b.u32(optional + 60)));
for (let n = 0; n < b.u16(pe + 6); n++) {
  const at = optional + b.u16(pe + 20) + n * 40;
  image.set(b.range(b.u32(at + 20), b.u32(at + 16)), b.u32(at + 12));
}
const u = await loadUnicorn(),
  p = new PE32Process(u);
p.map(0x400000, image.length);
p.write(0x400000, image);
const task = p.allocate(104, true),
  vm = p.allocate(1400, true),
  args = p.allocate(4, true),
  result = p.allocate(4, true),
  table = profile[1].tables.main.va;
let passed = 0;
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
try {
  for (const rate of [1, 15, 30, 60, 120, 240, 0xffffffff])
    for (const clock of [0, 1, 37, 511, 0xfffffff0, 0xffffffff])
      for (const paused of [0, 1, 38, 0xffffffff]) {
        p.store(task + 72, rate);
        p.store(task + 100, clock);
        p.store(task + 88, paused);
        compare(p.call(p.load(table + 28), [vm, task, args, result]), 1, 'main7-control');
        compare(p.load(result), rate >>> 0, 'main7-frame-rate');
        compare(p.call(p.load(table + 20), [vm, task, args, result]), 1, 'main5-control');
        compare(p.load(result), (clock - paused) >>> 0, 'main5-clock');
      }
  if (profile[0] === 'nekopara-vol3-engine-2.6.1.76') {
    const tree = p.allocate(4, true),
      nil = p.allocate(28, true);
    p.store(tree, nil);
    p.store(nil, nil);
    p.store(task + 8, tree);
    const objects = new NativeObjects();
    objects.register(0, () => ({ message: () => 0, snapshot: () => ({}), restore() {} }));
    const id = await objects.create({ kind: 0 }),
      record = objects.objects.get(id);
    for (const initial of [0, 179, 0xffffff00]) {
      p.store(task + 88, 0);
      p.store(task + 96, 0);
      p.store(task + 100, initial);
      Object.assign(record, { effectiveFrame: initial, lastFrame: 0, pausedFrames: 0 });
      for (let n = 0; n < 40; n++) {
        const clock = (initial + n * 7) >>> 0,
          paused = n % 9 >= 3 && n % 9 <= 6;
        p.store(task + 92, Number(paused));
        record.userValue = Number(paused);
        compare(p.call(0x5dcc80, [clock, result], task), 1, 'base-frame-result');
        await objects.tick(clock);
        compare(
          [p.load(task + 88), p.load(task + 96), p.load(task + 100)],
          [record.pausedFrames, record.lastFrame, record.effectiveFrame],
          `pause-resume/${initial}/${n}`,
        );
        compare(p.call(0x5dcbe0, [clock], task), 1, 'base draw phase result');
        await objects.drawTick(clock);
        compare(
          [p.load(task + 88), p.load(task + 96), p.load(task + 100)],
          [record.pausedFrames, record.lastFrame, record.effectiveFrame],
          `draw-phase/${initial}/${n}`,
        );
      }
    }
  }
  const descriptors = [
      { id: 0, kind: 1, parent: null },
      { id: 1, kind: 11, parent: 0 },
      { id: 2, kind: 13, parent: 0 },
      { id: 3, kind: 12, parent: 0 },
      { id: 4, kind: 2, parent: 3 },
      { id: 8, kind: 34, parent: 3 },
      { id: 9, kind: 6, parent: 8 },
      { id: 11, kind: 12, parent: 0 },
    ],
    pointers = new Map(descriptors.map((record) => [record.id, p.allocate(104, true)])),
    tree = p.allocate(4, true),
    nil = p.allocate(28, true),
    nodes = descriptors.map(() => p.allocate(28, true)),
    vft = p.allocate(32, true),
    argumentWords = p.allocate(16, true),
    records = new Map(descriptors.map((record) => [record.id, { ...record, flags: record.kind }]));
  p.store(tree, nil);
  p.store(nil, nodes[0]);
  p.store(nil + 4, nodes[0]);
  p.store(nil + 8, nodes.at(-1));
  p.write(nil + 13, [1]);
  // The actual ordered-tree iteration executes in the original main4B.
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i],
      record = descriptors[i],
      pointer = pointers.get(record.id);
    p.store(node, nil);
    p.store(node + 4, i ? nodes[i - 1] : nil);
    p.store(node + 8, nodes[i + 1] ?? nil);
    p.store(node + 16, record.id);
    p.store(node + 20, pointer);
    p.store(pointer, vft);
    p.store(pointer + 4, record.id);
    p.store(pointer + 8, tree);
    p.store(pointer + 12, pointers.get(record.parent) ?? 0);
    p.store(pointer + 64, record.kind);
  }
  p.store(
    vft + 16,
    p.trap(
      'task type/existence engine-message boundary',
      7,
      ([, target, message, query, , , out]) => {
        if (message === 13) {
          if (!records.has(target)) return 0;
          p.store(out, records.get(target).kind);
        } else {
          assert.equal(message, profile[0] === 'sdk-4.01-engine-2.6.1.74' ? 31 : 33);
          const record = records.get(query);
          p.store(out, Number(!!record && !(record.kind === 1 && record.parent === null)));
        }
        return 1;
      },
    ),
  );
  for (const own of [3, 8, 11]) {
    for (const [id, inputs] of [
      [0x4a, [1]],
      [0x4a, [3]],
      [0x4a, [8]],
      [0x4a, [99]],
      ...[0, 1, 2, 3, 4, 0xffffffff].map((index) => [0x4b, [index]]),
      [0x4c, []],
      ...[0, 1, 3, 8, 9, 99].map((index) => [0x4d, [index]]),
    ]) {
      inputs.forEach((value, i) => p.store(argumentWords + i * 4, value));
      compare(
        p.call(p.load(table + id * 4), [vm, pointers.get(own), argumentWords, result]),
        1,
        'task-query-control',
      );
      const reply = nativeTask(id, inputs, {}, { id: own }, { objects: { objects: records } });
      compare(reply.value, p.load(result), `task-query/${id}/${own}/${inputs}`);
    }
  }
  const sourceMemory = p.allocate(4096, true),
    isSDK = profile[0].startsWith('sdk');
  const redirect = (address, name, count, fn, pops = false) => {
    const target = p.trap(
        name,
        pops ? count : 0,
        pops
          ? fn
          : () => {
              const sp = p.cpu.reg_read_i32(u.X86_REG_ESP) >>> 0;
              return fn(Array.from({ length: count }, (_, i) => p.load(sp + 4 + 4 * i)));
            },
      ),
      jump = new Uint8Array(5);
    jump[0] = 0xe9;
    new DataView(jump.buffer).setInt32(1, target - address - 5, true);
    p.write(address, jump);
  };
  redirect(
    isSDK ? 0x8a6510 : 0x876ea0,
    'FES KCS formatting boundary',
    2,
    ([offset, out]) => {
      p.write(out, p.stringBytes(sourceMemory + offset, false, true));
      return 1;
    },
    true,
  );
  redirect(isSDK ? 0x5775c0 : 0x6a7e60, 'FES stack packet zero', 2, ([out, size]) => {
    p.zero(out, size);
    return out;
  });
  let captured;
  p.store(
    vft + 16,
    p.trap('FES engine message boundary', 7, ([sender, target, message, w, l, queued, out]) => {
      message += isSDK ? 5 : 0;
      captured = { sender, target, message, w, l, queued };
      if (message === 337)
        captured = {
          sender,
          target,
          message,
          event: p.string(l),
          object: w ? p.string(w) : null,
          index: w ? p.load(w + 32) : 0,
          queued,
        };
      if (message === 351 || message === 352) {
        captured = {
          sender,
          target,
          message,
          name: p.string(w),
          value: message === 352 ? l : null,
          queued,
        };
        if (message === 351) p.store(l, 0x89abcdef);
      }
      p.store(out, 0xdeadbeef);
      return 1;
    }),
  );
  const sender = pointers.get(3),
    own = { id: 3, context: {} },
    record = { id: 8, kind: 34 },
    machine = { string: (at) => p.string(sourceMemory + at) },
    world = {
      runtime: { services: { format: (at) => machine.string(at) } },
      objects: {
        objects: new Map([
          [3, own],
          [8, record],
        ]),
      },
      resolveTaskID(id) {
        return id;
      },
      sendNativeEngine(target, sender, message, w, l, context = {}) {
        const memory = context.payload;
        this.captured =
          message === 337
            ? {
                sender,
                target,
                message,
                event: memory.string(l),
                object: w ? memory.string(w) : null,
                index: w ? memory.load(w + 32) : 0,
                queued: 0,
              }
            : message === 351 || message === 352
              ? {
                  sender,
                  target,
                  message,
                  name: memory.string(w),
                  value: message === 352 ? l : null,
                  queued: 0,
                }
              : { sender, target, message, w, l, queued: 0 };
        if (message === 351) memory.store(l, 0x89abcdef);
        return 0xdeadbeef;
      },
    };
  for (const index of [0, 1, 511, 512, 0xffffffff])
    for (const value of [0, 71, 0x80000000, 0xffffffff])
      for (const [id, inputs] of [
        [0x285, [8, index, value]],
        [0x286, [8, index]],
        [0x287, [8, value]],
      ]) {
        inputs.forEach((v, i) => p.store(argumentWords + i * 4, v));
        const control = p.call(p.load(table + id * 4), [vm, sender, argumentWords, result]),
          reply = await nativeFES(id, inputs, machine, own, world);
        compare(reply.control, control, `FES wrapper control/${id}`);
        compare(world.captured, captured, `FES wrapper message/${id}`);
        if (id === 0x286) compare(reply.value, p.load(result), 'FES local result word');
      }
  for (const event of ['UPDATE', '_FES_WAKE_', '通知'])
    for (const name of ['', 'button', '猫'])
      for (const index of [0, 1, 0xffffffff]) {
        for (const [at, text] of [
          [32, event],
          [128, name],
        ])
          p.write(sourceMemory + at, Uint8Array.from([...encodeCP932(text), 0]));
        const inputs = [8, 32, 128, index];
        inputs.forEach((v, i) => p.store(argumentWords + i * 4, v));
        const control = p.call(p.load(table + 0x276 * 4), [vm, sender, argumentWords, result]),
          reply = await nativeFES(0x276, inputs, machine, own, world);
        compare(reply.control, control, 'FES notification control');
        compare(world.captured, captured, 'FES notification formatted packet');
      }
  for (const name of ['', 'word', '猫', 'x'.repeat(255)])
    for (const value of [0, 71, 0x80000000, 0xffffffff])
      for (const id of [0x372, 0x373]) {
        p.write(sourceMemory + 128, Uint8Array.from([...encodeCP932(name), 0]));
        const inputs = id === 0x372 ? [8, 128, value] : [8, 128];
        inputs.forEach((v, i) => p.store(argumentWords + i * 4, v));
        const control = p.call(p.load(table + id * 4), [vm, sender, argumentWords, result]),
          reply = await nativeFES(id, inputs, machine, own, world);
        compare(reply.control, control, 'FES named word control');
        compare(world.captured, captured, 'FES named word formatted packet');
        if (id === 0x373) compare(reply.value, p.load(result), 'FES named word output');
      }
  await writeFile(
    output,
    JSON.stringify(
      {
        sha256,
        profile: profile[0],
        passed,
        scope:
          'Original main5/7; game base-frame pause bookkeeping with empty child map; main4A..4D wrappers and child-tree iteration; FES main276/285..287/372/373 wrappers with profile message normalization; type/existence/FES routing and formatting supplied as explicit boundaries',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native task clock differential passed ${passed}/${passed}`);
} finally {
  p.close();
}
