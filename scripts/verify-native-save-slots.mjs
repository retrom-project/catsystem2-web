// SPDX-License-Identifier: MPL-2.0
// Original FES save handlers/file/CSS/sort helpers versus the shared adapter.
// Only authored expression, parameter and global/string-bank boundaries differ.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NATIVE_FES_SAVE_HANDLERS } from '../oracle/save-slots.mjs';
import { tokenizeNativeFESSoundConfiguration } from '../src/native/fes-sound-config.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { saveSlotFixture } from '../tests/fixtures/save-slots-fixture.mjs';
import { SaveSlotFiles } from '../tests/fixtures/save-slot-files.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-save-slots.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Save-slots oracle requires a frozen engine image');
const fixture = await saveSlotFixture(bytes, profile, { oracle: false }),
  originalFiles = new SaveSlotFiles(),
  original = await NativeEngineProcess.open({ bytes, profile, ...originalFiles.options() }),
  p = original.process,
  buffers = new NativeDataBuffers(original),
  interpreter = p.allocate(4096, true),
  globals = new Map(),
  strings = new Map(),
  sdk = profile.startsWith('sdk-'),
  at = (game, sdkVA) => (sdk ? sdkVA : game),
  handlers = NATIVE_FES_SAVE_HANDLERS[profile],
  files = new Map(),
  covered = new Set(),
  operations = [];
let comparisons = 0,
  calls = 0,
  context,
  index;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const patch = (game, sdkVA, name, count, callback) =>
  original.patch(at(game, sdkVA), name, count, callback, { calleePops: true });
patch(0x766440, 0x6020c0, 'authored FES save parameter boundary', 3, ([source, token, out]) => {
  index = token;
  const value = tokenizeNativeFESSoundConfiguration(p.string(source), profile)[token];
  if (value === undefined) return 0;
  const bytes = fixture.instance.argumentBytes(value);
  p.write(out, Uint8Array.of(...bytes, 0));
  return 1;
});
patch(0x728d80, 0x5d9230, 'authored FES save integer boundary', 1, ([source]) => {
  const value = fixture.instance.value(p.string(source));
  return context.command === 'datasave' && index === 2 ? context.project(value) : value;
});
patch(0x728c40, 0x5d90f0, 'authored FES save global boundary', 2, ([key, value]) => {
  globals.set(key >>> 0, value >>> 0);
  return 0;
});
patch(0x740800, 0x5e1660, 'authored FES save string boundary', 2, ([key, value]) => {
  strings.set(key >>> 0, value ? p.stringBytes(value).slice() : new Uint8Array());
  return 1;
});
function setDirectory(directory) {
  fixture.record.context.contextName = directory;
  const encoded = sdk ? encodeCP932(directory + '\0') : new Uint8Array((directory.length + 1) * 2);
  if (!sdk)
    for (let i = 0; i < directory.length; i++)
      new DataView(encoded.buffer).setUint16(i * 2, directory.charCodeAt(i), true);
  p.zero(interpreter + 1480, sdk ? 260 : 520);
  p.write(interpreter + 1480, encoded);
}
async function normalized(storage) {
  const result = [];
  for (const [name, file] of storage.snapshot()) {
    let data = file.bytes;
    // saveapend_str deliberately copies strlen+4: its final three stack bytes
    // are unwritten by the string producer. They have no defined common value.
    if (data.length >= 16 && new DataView(data.buffer).getUint32(0, true) === 0x535343) {
      const css = await NativeGlobalFile.fromFile(data);
      if (!css.used) data = { header: data.slice(0, 16), size: data.length };
      // With an empty payload the original allocates only its 16-byte header,
      // then reads eight unwritten bytes beyond that allocation into the file.
      // The CSS reader ignores this tail when the declared payload size is zero.
      if (css.records.some((record) => record.id === 77))
        data = {
          tag: css.tag,
          records: css.records.map(({ id, bytes }) => ({
            id,
            bytes: id === 77 ? bytes.slice(0, bytes.length - 3) : bytes,
            size: bytes.length,
          })),
        };
    }
    result.push([name, { ...file, bytes: data }]);
  }
  return result;
}
async function command(source) {
  calls++;
  const command = source.split(' ')[0],
    projected = [],
    raw = encodeCP932(source),
    input = p.allocate(raw.length + 1, true);
  covered.add(command);
  p.write(input, raw);
  context = {
    command,
    project(handle) {
      if (!handle) return 0;
      const file = files.get(handle);
      assert.ok(file, 'authored raw CSS object exists');
      const payload = file.payload(),
        data = buffers.allocateData(payload.length),
        inner = p.allocate(16),
        outer = p.allocate(4);
      p.write(data, payload);
      [data, file.capacity, payload.length, file.tag].forEach((word, i) =>
        p.store(inner + i * 4, word),
      );
      p.store(outer, inner);
      projected.push({ outer, inner, data });
      return outer;
    },
  };
  try {
    const expected = await original.call(handlers[command], [interpreter, 0, 0, input, 0]),
      actual = await fixture.slots.command(fixture.instance, command, source);
    check(actual, expected, 'original FES command return');
    check(
      [...fixture.globals].sort(([a], [b]) => a - b),
      [...globals].sort(([a], [b]) => a - b),
      'global writes/preservation',
    );
    check(
      [...fixture.strings.entries].sort(([a], [b]) => a - b),
      [...strings].sort(([a], [b]) => a - b),
      'raw numbered-string writes/preservation',
    );
    check(
      await normalized(fixture.files),
      await normalized(originalFiles),
      'complete saved CSS files and metadata',
    );
    check(
      fixture.files.operations,
      originalFiles.operations,
      'original file operations/failure path',
    );
    operations.push(source);
  } finally {
    p.free(input);
    for (const { outer, inner, data } of projected) {
      buffers.releaseData(data);
      p.free(inner);
      p.free(outer);
    }
  }
}
async function seed(slot, tag, count) {
  const file = new NativeGlobalFile(tag);
  for (let i = 0; i < count; i++)
    file.write(
      i + 1,
      Uint8Array.from({ length: i * 9 + 1 }, (_, j) => (j * 31) & 255),
    );
  const handle = fixture.handles.add('global-file', file);
  files.set(handle, file.clone());
  await command(`datasave ${slot} ${handle}`);
  return handle;
}
try {
  for (let trial = 0; trial < (process.env.CATSYSTEM2_EXTENDED ? 16 : 2); trial++) {
    setDirectory(trial & 1 ? 'authored/sub' : 'authored');
    fixture.files.time = originalFiles.time =
      Date.UTC(2024, trial % 12, trial + 1, 3, 4, 5) + trial;
    await command('datasave');
    await command('datasave 1');
    await command('datasave 1 0');
    await seed(1, 100 + trial, trial % 7);
    await seed(2, 200 + trial, 3);
    for (const [slot, min, max] of [
      [1, null, null],
      [1, 100 + trial, null],
      [1, 100, 200],
      [1, 101 + trial, 101 + trial],
      [1, 0xffffffff, 0],
      [1, 0, 0xffffffff],
      [1, 200, 100],
      [99, 0, 0],
    ])
      await command(
        `saveexist ${slot} ${50 + trial}${min === null ? '' : ` ${min}${max === null ? '' : ` ${max}`}`}`,
      );
    for (const source of [
      'saveexist',
      'saveexist 1',
      'saveget_str',
      'saveget_str 1 1',
      'saveget_str 99 1 3',
      'saveget_str 1 900 3',
      'saveget_str 1 1 3',
    ])
      await command(source);
    await command(`saveget_date 1 100 101 102 103 104 105`);
    await command('saveget_date 99 100 101 102 103 104 105');
    await command('saveget_date 1 -1 101 -1 103');
    for (const source of [
      'newsave 20 1 2',
      'newsave 20 3 2',
      'newsave 20 99 100',
      'sortsave 30 1 2',
      'sortsave 30 2 2',
      'sortsave2 40 2 1 99 1',
      'sortsave2 40',
      'sortsave2 40 2',
    ])
      await command(source);
    fixture.files.time += 10000;
    originalFiles.time += 10000;
    await command(`saveapend_str 1 77 (日本語 ${trial})`);
    await command('saveget_str 1 77 9');
    await command('saveapend_str 99 77 missing');
    for (const source of [
      'savecopy 1 3',
      'savecopy 1 2',
      'savecopy 99 3',
      'saveexchg 1 3',
      'saveexchg 3 4',
      'saveexchg 99 98',
      'savedelete 4',
      'savedelete 4',
    ])
      await command(source);
    for (const name of [
      'savecopy',
      'saveexchg',
      'savedelete',
      'saveapend_str',
      'saveget_date',
      'newsave',
      'sortsave',
      'sortsave2',
    ])
      await command(name);
  }
  setDirectory('failure');
  for (const failed of [
    'copy:failure/tmp_save_1.tmp',
    'copy:failure/tmp_save_2.tmp',
    'remove:failure/save0001.dat',
    'remove:failure/save0002.dat',
    'copy:failure/save0002.dat',
    'copy:failure/save0001.dat',
  ]) {
    for (const storage of [fixture.files, originalFiles]) {
      for (const name of storage.files.keys())
        if (name.startsWith('failure/')) storage.files.delete(name);
    }
    await seed(1, 501, 2);
    await seed(2, 502, 3);
    fixture.files.failures.add(failed);
    originalFiles.failures.add(failed);
    await command('saveexchg 1 2');
    fixture.files.failures.clear();
    originalFiles.failures.clear();
  }
  for (const failed of [
    'copy:failure/save0003.dat',
    'move:failure/save0003.dat',
    'remove:failure/save0001.dat',
  ]) {
    fixture.files.failures.add(failed);
    originalFiles.failures.add(failed);
    await command('savecopy 1 3');
    await command('saveexchg 1 3');
    await command('savedelete 1');
    fixture.files.failures.clear();
    originalFiles.failures.clear();
  }
  check([...covered].sort(), Object.keys(handlers).sort(), 'complete eleven-command coverage');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        commands: [...covered],
        scope:
          'Complete original FES save handlers plus CSS compression/parser, filesystem sequencing, FILETIME date/newest/sort and cleanup; explicit authored tokenizer/expression/bank boundaries. saveapend_str final three uninitialized stack bytes excluded from byte comparison; their original stored length retained.',
        operations,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original save-slots differential ${comparisons}/${comparisons}; ${calls} full-handler calls`,
  );
} finally {
  p.free(interpreter);
  await original.close();
  await fixture.engine?.close();
}
