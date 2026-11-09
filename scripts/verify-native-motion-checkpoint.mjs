// SPDX-License-Identifier: MPL-2.0
// Original serializer and refresh wrapper against authored manager/VM memory.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { encodeMotionRecords, decodeMotionRecords } from '../src/motion/checkpoint.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';

const [filename, profile, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-motion-checkpoint.mjs EXE PROFILE IGNORED_REPORT',
  );
const engine = await NativeEngineProcess.open({
    bytes: new Uint8Array(await readFile(filename)),
    profile,
  }),
  p = engine.process,
  sdk = profile.startsWith('sdk-'),
  serializer = sdk ? 0x622400 : 0x78a2f0,
  manager = p.allocate(64, true),
  map = p.allocate(8, true),
  sentinel = p.allocate(32, true),
  nodes = [p.allocate(100, true), p.allocate(100, true)],
  contexts = [p.allocate(1208, true), p.allocate(1208, true)],
  vms = [p.allocate(64, true), p.allocate(64, true)],
  extras = [p.allocate(64, true), p.allocate(64, true)],
  capacity = 4096,
  destination = p.allocate(capacity, true),
  envelope = p.allocate(12, true),
  argv = p.allocate(8, true),
  out = p.allocate(4, true);
let seed = 0x651238ab,
  passed = 0;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
try {
  p.store(manager, map);
  p.store(map, sentinel);
  p.write(sentinel + 13, Uint8Array.of(1));
  for (let variant = 0; variant < 96; variant++) {
    const count = variant % 3,
      frame = random(),
      records = new Map();
    p.store(map + 4, count);
    p.store(sentinel, count ? nodes[0] : sentinel);
    for (let i = 0; i < count; i++) {
      const node = nodes[i],
        context = contexts[i],
        vm = vms[i],
        name = variant % 2 ? `動作${i}.kcs` : `authored-${i}.kcs`,
        nameBytes = sdk
          ? Uint8Array.from([...encodeCP932(name), 0])
          : new Uint8Array((name.length + 1) * 2),
        registers = Uint8Array.from({ length: 1024 }, () => random() >>> 24),
        extra = Uint8Array.from({ length: variant % 32 }, () => random() >>> 24),
        startTick = random(),
        group = random(),
        delay = random(),
        shared = new Uint8Array(MOTION_ABI.sharedSize);
      if (!sdk) {
        const words = new DataView(nameBytes.buffer);
        for (let j = 0; j < name.length; j++) words.setUint16(j * 2, name.charCodeAt(j), true);
      }
      p.store(node, sentinel);
      p.store(node + 4, i ? nodes[0] : sentinel);
      p.store(node + 8, i + 1 < count ? nodes[i + 1] : sentinel);
      p.write(node + 13, Uint8Array.of(0));
      p.write(node + 20, nameBytes);
      p.store(node + (sdk ? 52 : 84), context);
      p.store(node + (sdk ? 56 : 88), startTick);
      p.store(node + (sdk ? 60 : 92), group);
      p.store(context + 4, vm);
      p.write(context + 164, registers);
      p.store(context + 1188, extra.length ? 4 : 0);
      p.store(context + 1192, extra.length);
      p.store(context + 1200, delay);
      p.store(vm + 20, extras[i]);
      p.store(vm + 36, 64);
      p.write(extras[i] + 4, extra);
      shared.set(registers, MOTION_ABI.registers);
      const view = new DataView(shared.buffer);
      view.setUint32(MOTION_ABI.extraData, extra.length ? 4 : 0, true);
      view.setUint32(MOTION_ABI.extraSize, extra.length, true);
      records.set(i + 1, {
        handle: i + 1,
        group,
        startTick,
        instance: {
          shared,
          view,
          delay,
          script: { name },
          machine: { bytes: () => extra },
        },
      });
    }
    const model = { profile, records },
      initial = Uint8Array.from({ length: capacity }, () => random() >>> 24),
      expected = encodeMotionRecords(model, frame, initial.slice()),
      used = new DataView(expected.buffer).getUint32(0, true);
    p.write(destination, initial);
    assert.equal(await engine.call(serializer, [destination, frame], manager), used);
    assert.deepEqual(p.read(destination, capacity), expected);
    assert.equal(decodeMotionRecords(expected, profile).length, count);
    passed += 3;
    // 13C reuses its allocation: bytes beyond used length and name padding
    // are observable in subsequent global-file persistence.
    p.write(destination, initial);
    p.store(envelope, manager);
    p.store(envelope + 4, destination);
    p.store(envelope + 8, capacity);
    p.store(argv, envelope);
    p.store(argv + 4, frame);
    assert.equal(
      await engine.call(p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 0x13c * 4), [
        0,
        0,
        argv,
        out,
      ]),
      1,
    );
    assert.equal(p.load(out), 1);
    assert.equal(p.load(envelope + 4), destination);
    assert.equal(p.load(envelope + 8), capacity);
    assert.deepEqual(p.read(destination, capacity), expected);
    passed += 5;
  }
  await writeFile(
    output,
    JSON.stringify({ profile, cases: 96, comparisons: passed }, null, 2) + '\n',
  );
  console.log(`${profile}: ${passed} native checkpoint comparisons passed`);
} finally {
  await engine.close();
}
