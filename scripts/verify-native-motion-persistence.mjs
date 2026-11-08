// SPDX-License-Identifier: MPL-2.0
// Original CTS/MOT-envelope wrappers; MOT restore is a separately verified boundary.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { nativeMotionPersistence } from '../src/native/motion-persistence.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-motion-persistence.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Motion persistence oracle requires frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  buffers = new NativeDataBuffers(engine),
  handles = new NativeHandles(),
  table = NATIVE_PROFILES[profile].tables.main.va,
  argv = p.allocate(32, true),
  out = p.allocate(4, true),
  envelope = p.allocate(12, true),
  nativeOwner = p.allocate(4, true),
  nativeRestores = [],
  modelRestores = [],
  services = {
    handles,
    motion: {
      restoreRecords: async (owner, bytes, frame) =>
        modelRestores.push({ owner, bytes: bytes.slice(), frame }),
    },
  };
let passed = 0;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  call = async (id, args = []) => {
    args.forEach((word, i) => p.store(argv + i * 4, word));
    p.store(out, 0xcafebabe);
    const control = await engine.call(p.load(table + id * 4), [0, 0, argv, out]);
    return control === 2 ? { control } : { control, value: p.load(out) };
  },
  model = (id, args) => nativeMotionPersistence(id, args, {}, services);
// Locate the target reached by the original 184 wrapper's final direct CALL.
const wrapper = p.load(table + 0x184 * 4),
  body = p.read(wrapper, 256),
  calls = [];
for (let i = 0; i < body.length - 4; i++)
  if (body[i] === 0xe8)
    calls.push(
      (wrapper +
        i +
        5 +
        new DataView(body.buffer, body.byteOffset + i + 1, 4).getInt32(0, true)) >>>
        0,
    );
const restore = profile.startsWith('sdk') ? 0x622540 : 0x78a420;
if (!calls.includes(restore))
  throw new Error('Frozen MOT restore call target changed: ' + calls.map((x) => x.toString(16)));
engine.patch(
  restore,
  'MOT manager restore boundary',
  2,
  ([data, frame]) => {
    const owner = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
    const length = currentLength;
    nativeRestores.push({ owner: Number(Boolean(owner)), bytes: p.read(data, length), frame });
    return 1;
  },
  { calleePops: true },
);
let currentLength = 0;
try {
  for (let trial = 0; trial < 32; trial++) {
    const originalFile = (await call(0xee, [trial])).value,
      modelFile = handles.add('global-file', new NativeGlobalFile(trial));
    for (const size of [0, 1, 3, 4, 8, 17, 32, 127]) {
      const data = buffers.allocateData(size),
        payload = Uint8Array.from({ length: size }, (_, i) => (i * 71 + trial + size) & 255),
        entry = (size + trial) % 7;
      p.write(data, payload);
      p.store(envelope, nativeOwner);
      p.store(envelope + 4, data);
      p.store(envelope + 8, size);
      const source = handles.add('motion-checkpoint', { owner: 73, bytes: payload.slice() });
      compare(
        await call(0x183, [originalFile, entry, envelope]),
        model(0x183, [modelFile, entry, source]),
        'write envelope',
      );
      p.zero(data, size);
      handles.get(source, 'motion-checkpoint').bytes.fill(0);
      for (const owner of [0, 73]) {
        currentLength = handles.get(modelFile, 'global-file').read(entry).length;
        const frame = (trial * 4294967 + size) >>> 0,
          original = await call(0x184, [originalFile, entry, owner ? nativeOwner : 0, frame]),
          js = await model(0x184, [modelFile, entry, owner, frame]),
          record = handles.get(js.value, 'motion-checkpoint');
        compare(original.control, js.control, 'read control');
        compare(
          Number(Boolean(p.load(original.value))),
          Number(Boolean(record.owner)),
          'manager identity',
        );
        compare(p.load(original.value + 8), record.bytes.length, 'stored extent');
        compare(
          p.read(p.load(original.value + 4), record.bytes.length),
          record.bytes,
          'independent bytes',
        );
        if (owner)
          compare(
            nativeRestores.at(-1),
            { ...modelRestores.at(-1), owner: 1 },
            'restore receives manager, frame and copied bytes',
          );
        compare((await call(0x13d, [original.value])).control, 2, 'original envelope release');
        handles.release(js.value, 'motion-checkpoint');
      }
      buffers.releaseData(data);
      handles.release(source, 'motion-checkpoint');
    }
    compare(
      await call(0x184, [originalFile, 0xffffffff, 73, 0]),
      model(0x184, [modelFile, 0xffffffff, 73, 0]),
      'missing entry',
    );
    await call(0xf6, [originalFile]);
    handles.release(modelFile, 'global-file');
  }
  for (const [id, args] of [
    [0x183, [0, 1, 2]],
    [0x183, [1234, 1, 0]],
    [0x184, [0, 1, 2, 3]],
  ])
    compare(await call(id, args), model(id, args), 'null result');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Complete original main183/184 CTS-envelope wrappers plus CTS record methods and original13D release. Full copied bytes, size, owner and restore-call parameters; zero lengths, duplicates, null/missing and release. The MOT manager restore implementation is an explicit boundary, not established by this wrapper test.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original motion persistence differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
