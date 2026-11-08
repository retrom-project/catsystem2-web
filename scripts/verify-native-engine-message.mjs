// SPDX-License-Identifier: MPL-2.0
// Executes original constructors, ordered maps, packet wrappers, routing and
// Base/Top handlers. Device-only INPUT/SOUND constructors call the original
// Base constructor; no device behavior is claimed by this protocol probe.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import {
  NATIVE_ENGINE_MESSAGE_LAYOUTS,
  NATIVE_UNWRITTEN_WORD,
} from '../src/native/engine-message.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  engineMessageFixture,
  engineMessageCases,
  messageMemory,
  messageMemoryBase,
  prepareEngineMessageCase,
  engineMessageModelState,
  prepareEngineMessageOperation,
} from '../tests/fixtures/engine-message-fixture.mjs';

const [filename, outputPath] = process.argv.slice(2);
if (!filename || !outputPath)
  throw new Error(
    'Usage: node scripts/verify-native-engine-message.mjs FIXED_EXE IGNORED_REPORT [--limit N]',
  );
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Task-message oracle requires a frozen engine image');
const layout = NATIVE_ENGINE_MESSAGE_LAYOUTS[profile],
  sdk = profile.startsWith('sdk-'),
  functions = sdk
    ? { input: 0x4c2c60, sound: 0x4c62b0, lookup: 0x4b9690, unregister: 0x4b9c10, frame: 0x4b8ea0 }
    : { input: 0x5e69a0, sound: 0x5ea210, lookup: 0x5dd450, unregister: 0x5dd9d0, frame: 0x5dcc80 },
  files = new Map(),
  native = await NativeEngineProcess.open({
    profile,
    bytes,
    standardLibraries: false,
    trace: true,
    readFile: async () => null,
    writeFile: async (name, bytes) => {
      files.set(name, bytes.slice());
      return true;
    },
  }),
  p = native.process;
p.map(messageMemoryBase, 65536);
const held = p.allocate(4, true),
  result = p.allocate(4, true),
  canary = 0xa5a55a5a,
  hash = (data) => createHash('sha256').update(data).digest('hex'),
  results = [];
let pointers = new Map(),
  reverse = new Map(),
  traces = [],
  baseVFT,
  rootVFT,
  dynamic = false,
  dynamicDone = false;
for (const [kind, address, count] of [
  [11, functions.input, 5],
  [13, functions.sound, 3],
])
  native.patch(
    address,
    `task ${kind} device-constructor boundary`,
    count,
    async (args) => {
      const object = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
      return native.callFromHost(layout.baseCtor, args.slice(0, 3), object);
    },
    { calleePops: true },
  );
const packetTrap = p.trap('original packet wrapper instrumentation', 2, async ([packet, out]) => {
  const object = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
    values = Array.from({ length: 6 }, (_, i) => p.load(packet + i * 4)),
    control = await native.callFromHost(layout.packet, [packet, out], object);
  if (dynamic && !dynamicDone && reverse.get(object) === 4 && values[2] === 222) {
    dynamicDone = true;
    const slot = p.allocate(4, true),
      name = nameAddress('later');
    await native.callFromHost(layout.send, [4, 3, 1, 0, name, 0, slot], object);
    await install({ id: 10, kind: 0 }, p.load(slot));
    const earlier = p.allocate(104, true);
    await native.callFromHost(layout.baseCtor, [2, nameAddress('earlier'), 60], earlier);
    await install({ id: 11, kind: 0 }, earlier);
    await native.callFromHost(layout.send, [3, 3, 2, 2, earlier, 0, slot], pointers.get(3));
  }
  traces.push({
    worldID: reverse.get(object),
    words: values.slice(1),
    after: Array.from({ length: 6 }, (_, i) => p.load(packet + i * 4)),
    unhandled: control,
  });
  return control;
});
const nameAddress = (text) => {
  const source = encodeCP932(text + '\0'),
    address = p.allocate(source.length, true);
  p.write(address, source);
  return address;
};
async function install(record, pointer) {
  pointers.set(record.id, pointer);
  reverse.set(pointer, record.id);
  const isRoot = record.kind === 1;
  let vft = isRoot ? rootVFT : baseVFT;
  if (!vft) {
    vft = p.allocate(32, true);
    p.write(vft, p.read(p.load(pointer), 32));
    p.store(vft + 24, packetTrap);
    if (isRoot) rootVFT = vft;
    else baseVFT = vft;
  }
  p.store(pointer, vft);
}
async function rawFixture(fixture) {
  pointers = new Map();
  reverse = new Map();
  for (const record of fixture.world.objects.objects.values()) {
    if (pointers.has(record.id)) continue;
    const pointer = p.allocate(record.kind === 1 ? 656 : 104, true),
      name = nameAddress(record.name);
    if (record.kind === 1) {
      await native.call(layout.rootCtor, [record.nativeID, name, record.frameRate, 0, 0], pointer);
      // Both the outer thread manager and the task factory set kind 1 after
      // the complete Top constructor has returned.
      p.store(pointer + 64, record.kind);
      await install(record, pointer);
      for (const field of ['input', 'sound']) {
        const childID = record.implementation[field],
          child = fixture.world.objects.objects.get(childID),
          nativeID = p.load(pointer + (field === 'input' ? 120 : 124));
        if (nativeID !== child.nativeID)
          throw new Error('Original Top constructor assigned a different local task identity');
        p.store(held, 0);
        await native.call(functions.lookup, [nativeID, held], pointer);
        await install(child, p.load(held));
      }
    } else {
      await native.call(layout.baseCtor, [record.nativeID, name, record.frameRate], pointer);
      p.store(pointer + 64, record.kind);
      await install(record, pointer);
    }
    if (record.parent !== null) {
      const parent = fixture.world.objects.objects.get(record.parent),
        top = fixture.messages.closestTop(parent.id),
        topPointer = pointers.get(top.id);
      p.store(result, pointer);
      const packet = p.allocate(24, true);
      p.write(
        packet,
        new Uint8Array(
          Uint32Array.from([parent.nativeID, top.nativeID, 2, record.nativeID, pointer, 0]).buffer,
        ),
      );
      // Creation's Top upward handler rewrites MSG1 into MSG2 and starts its
      // route at Top. A direct MSG2 via vft+16 instead skips a cached branch.
      await native.call(layout.route, [packet, result], topPointer);
    }
  }
  if (process.argv.includes('--inspect') && !results.length) {
    const scan = (node, head) =>
      node === head
        ? []
        : [
            ...scan(p.load(node), head),
            [p.load(node + 16), reverse.get(p.load(node + 20))],
            ...scan(p.load(node + 8), head),
          ];
    console.log(
      JSON.stringify({
        maps: [...pointers].map(([id, ptr]) => [
          id,
          scan(p.load(p.load(p.load(ptr + 8)) + 4), p.load(p.load(ptr + 8))),
        ]),
        traces,
      }),
    );
  }
}
function nativeState(fixture) {
  const scan = (node, head) =>
    node === head
      ? []
      : [
          ...scan(p.load(node), head),
          [p.load(node + 16), reverse.get(p.load(node + 20)) ?? null],
          ...scan(p.load(node + 8), head),
        ];
  return [...fixture.world.objects.objects.values()].map((record) => {
    const pointer = pointers.get(record.id),
      state = {
        worldID: record.id,
        nativeID: p.load(pointer + 4),
        parent: reverse.get(p.load(pointer + 12)) ?? null,
        flags: p.load(pointer + 64),
        exitCode: p.load(pointer + 80),
        destroyRequested: p.load(pointer + 84),
        userValue: p.load(pointer + 92),
        routes: scan(p.load(p.load(p.load(pointer + 8)) + 4), p.load(p.load(pointer + 8))),
      };
    if (record.kind === 1)
      Object.assign(state, {
        input: p.load(pointer + 120),
        sound: p.load(pointer + 124),
        caption: p.string(pointer + 128, !sdk),
        field: p.load(pointer + layout.rootField),
        sharedPointer: p.load(pointer + 112),
        sharedData: [...p.read(p.load(pointer + 112), p.load(pointer + 116))],
      });
    return state;
  });
}
try {
  const limitAt = process.argv.indexOf('--limit'),
    limit = limitAt < 0 ? Infinity : Number(process.argv[limitAt + 1]);
  for (const operations of engineMessageCases(profile)) {
    if (results.length >= limit) break;
    const fixture = await engineMessageFixture(profile),
      memory = messageMemory(),
      context = { payload: memory },
      actual = [],
      expected = [],
      visits = [];
    dynamic = !!operations[0].dynamic;
    dynamicDone = false;
    await prepareEngineMessageCase(fixture, operations);
    p.write(messageMemoryBase, memory.data);
    files.clear();
    await rawFixture(fixture);
    let error;
    for (const operation of operations) {
      const { sender, target, message, w, l, flags } = operation;
      traces = [];
      p.store(result, canary);
      try {
        if (operation.unregister !== undefined) {
          const record = fixture.world.objects.objects.get(operation.unregister);
          await native.call(
            functions.unregister,
            [pointers.get(record.id), Number(operation.erase)],
            pointers.get(record.parent),
          );
        }
        if (operation.prune !== undefined)
          await native.call(functions.frame, [0, held], pointers.get(operation.prune));
        prepareEngineMessageOperation(fixture, operation);
        const beforeIDs = new Set(fixture.world.objects.objects.keys()),
          control = await native.call(
            layout.send,
            [
              fixture.world.objects.objects.get(sender).nativeID,
              target,
              message,
              w,
              operation.taskL === undefined ? l : pointers.get(operation.taskL),
              flags,
              result,
            ],
            pointers.get(sender),
          ),
          word = p.load(result);
        actual.push({
          routed: !!control,
          handled: traces.at(-1)?.unhandled === 0,
          result: word === canary ? 'unwritten' : message === 1 ? p.load(word + 4) : word,
        });
        visits.push(
          ...traces.filter(({ words }) => words[1] === 222).map(({ worldID }) => worldID),
        );
        context.flags = flags;
        const reply = await fixture.messages.dispatchNative(
          sender,
          target,
          message,
          w,
          operation.taskL ?? l,
          context,
        );
        expected.push({
          ...reply,
          result: reply.result === NATIVE_UNWRITTEN_WORD ? 'unwritten' : reply.result,
        });
        if (message === 1) {
          const created = [...fixture.world.objects.objects.values()].filter(
              (record) => !beforeIDs.has(record.id),
            ),
            primary = created[0];
          await install(primary, word);
          if (primary.kind === 1)
            for (const field of ['input', 'sound']) {
              const child = fixture.world.objects.objects.get(primary.implementation[field]);
              p.store(held, 0);
              await native.call(functions.lookup, [child.nativeID, held], word);
              await install(child, p.load(held));
            }
        }
      } catch (cause) {
        error = cause.message;
        break;
      }
    }
    const raw = {
        replies: actual,
        state: nativeState(fixture),
        memorySHA256: hash(p.read(messageMemoryBase, 65536)),
        files: [...files].map(([name, data]) => [name, hash(data)]),
        visits,
      },
      model = {
        replies: expected,
        state: engineMessageModelState(fixture),
        memorySHA256: hash(memory.data),
        files: [...fixture.files].map(([name, data]) => [name, hash(data)]),
        visits: fixture.visits,
      };
    results.push({
      operations,
      actual: raw,
      expected: model,
      error,
      match: !error && JSON.stringify(raw) === JSON.stringify(model),
    });
    if (error) break;
  }
} finally {
  await native.close();
}
const failed = results.filter((row) => !row.match),
  report = {
    format: 'native-engine-message-differential',
    profile,
    engineSHA256: sha256,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    boundaries: [
      'CRT allocation/free and Windows services',
      'INPUT/SOUND device construction replaced by the original Base constructor',
      'packet wrapper instrumentation calls its complete original body',
    ],
    resultsSHA256: hash(JSON.stringify(results.map(({ actual }) => actual))),
    results,
  };
await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log({ ...report, results: undefined });
if (failed.length) {
  console.log(JSON.stringify(failed.slice(0, 3), null, 2));
  process.exitCode = 1;
}
