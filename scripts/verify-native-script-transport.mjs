// SPDX-License-Identifier: MPL-2.0
// Original wrappers -> upward routing -> Top/Script/Base packet receivers.
// Only the Root's two device constructors use the original Base constructor;
// no input/audio behavior is replaced or claimed by this protocol probe.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NATIVE_ENGINE_MESSAGE_LAYOUTS } from '../src/native/engine-message.mjs';
import { kcsProgram, memoryGame } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-script-transport.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Script transport oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  configuration = new NativeConfiguration({ profile }),
  engine = await NativeEngineProcess.open({ bytes, profile, configuration, trace: true }),
  p = engine.process,
  layout = NATIVE_ENGINE_MESSAGE_LAYOUTS[profile],
  table = sdk ? 0xb3c900 : 0xa2dd38,
  game = memoryGame({ 'main.kcs': kcsProgram([[43, 0x41, 0], [59]]) }),
  random = new ParticleRandom(),
  world = new NativeWorld({
    game,
    profile,
    configuration,
    images: {},
    host: {},
    random,
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  }),
  pointers = new Map(),
  originals = new Map(),
  allocated = [],
  out = p.allocate(4, true),
  args = p.allocate(8, true),
  value = p.allocate(4, true),
  mainIDs = [0x23a, 0x23b, 0x23c];
let passed = 0,
  rawTrace = [],
  modelTrace = [];
const check = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
const name = (text) => {
  const bytes = encodeCP932(text + '\0'),
    pointer = p.allocate(bytes.length, true);
  allocated.push(pointer);
  p.write(pointer, bytes);
  return pointer;
};
const canonical = (raw) => (sdk && raw >= 437 && raw <= 440 ? raw + 5 : raw);
for (const [address, count] of sdk
  ? [
      [0x4c2c60, 5],
      [0x4c62b0, 3],
    ]
  : [
      [0x5e69a0, 5],
      [0x5ea210, 3],
    ])
  engine.patch(
    address,
    'Root device-constructor boundary',
    count,
    async (a) =>
      engine.callFromHost(
        layout.baseCtor,
        a.slice(0, 3),
        p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
      ),
    { calleePops: true },
  );
const trap = p.trap('original packet instrumentation', 2, async ([packet, result]) => {
  const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
    record = [...pointers].find(([, v]) => v === pointer)?.[0],
    words = Array.from({ length: 6 }, (_, i) => p.load(packet + i * 4)),
    unhandled = await engine.callFromHost(layout.packet, [packet, result], pointer);
  rawTrace.push([record, words[1], canonical(words[2]), words[3], words[4], Boolean(unhandled)]);
  return unhandled;
});
async function instrument(record, pointer) {
  pointers.set(record.id, pointer);
  const original = p.load(pointer),
    vft = p.allocate(32, true);
  originals.set(pointer, original);
  allocated.push(vft);
  p.write(vft, p.read(original, 32));
  p.store(vft + 24, trap);
  p.store(pointer, vft);
}
try {
  await world.initialize('main.kcs');
  world.nativeEngine = engine;
  world.nativeEngineLoading = Promise.resolve(engine);
  const root = world.objects.objects.get(world.root),
    caller = world.main,
    callerRecord = world.objects.objects.get(caller.id),
    childID = await world.objects.create({ kind: 0, parent: root.id, name: 'BASE' }),
    child = world.objects.objects.get(childID),
    rootPointer = p.allocate(1024, true);
  await engine.call(layout.rootCtor, [root.nativeID, name(root.name), 60, 0, 0], rootPointer);
  await instrument(root, rootPointer);
  for (const record of [callerRecord, child]) {
    const pointer = p.allocate(1024, true);
    if (record === callerRecord)
      await engine.call(
        sdk ? 0x4c4b60 : 0x5e8840,
        [record.nativeID, name(record.name), 60, 0, 0, 0, 0, name('')],
        pointer,
      );
    else await engine.call(layout.baseCtor, [record.nativeID, name(record.name), 60], pointer);
    await engine.call(layout.send, [0, 0, 2, record.nativeID, pointer, 0, out], rootPointer);
    await instrument(record, pointer);
  }
  for (const record of [root, callerRecord, child]) {
    const original = record.implementation.message.bind(record.implementation);
    record.implementation.message = async (words, context) => {
      const result = await original(words, context);
      modelTrace.push([record.id, ...words, Boolean(context.nativeUnhandled)]);
      return result;
    };
  }
  for (const id of mainIDs)
    for (const target of [root.nativeID, callerRecord.nativeID, child.nativeID, 0xffffffff])
      for (const payload of id === 0x23b
        ? [null, 0, 1, 0x80000000, 0xffffffff, 0xdeadbeef]
        : [null]) {
        p.store(value, payload ?? 0);
        p.store(args, target);
        p.store(args + 4, payload === null ? 0 : value);
        p.store(out, 0x35ad6c12);
        rawTrace = [];
        modelTrace = [];
        const raw = await engine.call(p.load(table + id * 4), [
            0,
            pointers.get(caller.id),
            args,
            out,
          ]),
          reply = await world.runtime.native(
            'main',
            id,
            id === 0x23b ? [target, payload === null ? 0 : value] : [target],
            caller.machine,
            caller,
          );
        check(reply.control, raw, 'wrapper control');
        check(p.load(out), 0x35ad6c12, 'wrapper output remains unwritten');
        check(modelTrace, rawTrace, 'full upward/packet/default receiver trace');
        check(p.load(value), payload ?? 0, 'source DWORD is retained');
      }
  console.log(`Native Script transport passed ${passed}/${passed}`);
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Main23A/23B/23C through original upward routing, original Top and Script/Base packet handlers; zero, own, other and missing targets. Nullable raw PE argument dereference and unwritten output canaries. Root device constructors are explicit Base-only transport boundaries.',
        patches: engine.patches,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  const rootPointer = pointers.get(world.root);
  if (rootPointer) {
    for (const [pointer, original] of originals) p.store(pointer, original);
    await engine.call(p.load(p.load(rootPointer)), [0], rootPointer);
    p.free(rootPointer);
  }
  for (const pointer of allocated) p.free(pointer);
  for (const pointer of [out, args, value]) p.free(pointer);
  world.nativeEngine = null;
  world.nativeEngineLoading = null;
  await world.close({ flushFiles: false });
  await engine.close();
}
