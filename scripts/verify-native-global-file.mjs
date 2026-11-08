// SPDX-License-Identifier: MPL-2.0
// Actual CTS constructors/writers/remove/clear/clone/release, with an explicit
// VM-address boundary for the authored record payload.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-global-file.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Global-file oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  table = NATIVE_PROFILES[profile].tables.main.va,
  args = p.allocate(32, true),
  result = p.allocate(4, true),
  data = p.allocate(1024, true);
let passed = 0;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  invoke = async (id, words) => {
    p.zero(args, 32);
    words.forEach((word, i) => p.store(args + i * 4, word));
    p.store(result, 0xcafebabe);
    const control = await engine.call(p.load(table + id * 4), [0, 0, args, result]);
    return { control, value: p.load(result) };
  },
  state = (pointer) => {
    const inner = p.load(pointer),
      capacity = p.load(inner + 4),
      used = p.load(inner + 8),
      tag = p.load(inner + 12);
    return { capacity, used, tag, payload: p.read(p.load(inner), used) };
  },
  match = (pointer, model, label) =>
    compare(
      state(pointer),
      {
        capacity: model.capacity,
        used: model.used,
        tag: model.tag,
        payload: model.payload(),
      },
      label,
    );
engine.patch(
  profile.startsWith('sdk-') ? 0x8a6910 : 0x8772a0,
  'authored CTS VM address boundary',
  1,
  ([address]) => (address === 0xffffffff ? 0 : address),
  { calleePops: true },
);
try {
  for (let trial = 0; trial < 48; trial++) {
    const tag = (trial * 97121) >>> 0,
      created = await invoke(0xee, [tag]),
      source = created.value,
      model = new NativeGlobalFile(tag);
    compare(created.control, 1, 'constructor control');
    match(source, model, 'constructor state');
    for (let record = 0; record < 12; record++) {
      const payload = Uint8Array.from(
          { length: (trial * 17 + record * 13) % 128 },
          (_, i) => (i * 47 + trial) & 255,
        ),
        id = record % 4 === 0 ? 0xffffffff : record % 7;
      p.write(data, payload);
      compare(
        await invoke(0xf4, [source, id, payload.length, data]),
        { control: 1, value: 1 },
        'record write result',
      );
      model.write(id, payload);
    }
    compare((await invoke(0x1d5, [source, trial % 7])).control, 2, 'record removal control');
    model.remove(trial % 7);
    match(source, model, 'state after record removal');
    const copied = await invoke(0x186, [source]),
      clone = copied.value,
      copy = model.clone();
    compare(copied.control, 1, 'clone control');
    assert.notEqual(clone, source);
    passed++;
    match(clone, copy, 'clone retains capacity, tag and used bytes');
    compare(await invoke(0x185, [source]), { control: 1, value: 1 }, 'clear result');
    model.clear();
    match(source, model, 'clear restores initial capacity and retains tag');
    match(clone, copy, 'clone survives source clear');
    p.write(data, Uint8Array.of(8, 7, 6));
    await invoke(0xf4, [source, 9, 3, data]);
    model.write(9, Uint8Array.of(8, 7, 6));
    match(source, model, 'cleared source accepts a new record');
    match(clone, copy, 'clone survives source writes');
    compare((await invoke(0xf6, [source])).control, 2, 'source release control');
    match(clone, copy, 'clone survives source release');
    compare((await invoke(0xf6, [clone])).control, 2, 'clone release control');
  }
  compare(await invoke(0x185, [0]), { control: 1, value: 0 }, 'null clear');
  compare(await invoke(0x186, [0]), { control: 1, value: 0 }, 'null clone result');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Complete original mainEE/F4/1D5/185/186/F6 constructors, records, clear, clone and release. VM address translation is supplied. Compared bytes are the initialized used payload; uninitialized capacity tails and the original null-source clone allocation leak are outside the exposed file-data contract.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original global-file differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
