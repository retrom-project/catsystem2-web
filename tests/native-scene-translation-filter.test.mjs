// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTranslation } from '../src/formats/scene.mjs';
import { NativeSceneData, NativeSceneReader } from '../src/native/scene-data.mjs';
import { translation } from './helpers.mjs';

const ignore = { translationUnknownPrefixes: 'ignore' };
const filtered = (table, names) =>
  Object.fromEntries(Object.entries(table).filter(([name]) => names.includes(name)));
const input = () =>
  translation(
    ['en', 'jp', '__proto__'],
    [
      {
        en: ['Speaker', '\ufeffFirst\x1fline'],
        jp: ['名前', '文章'],
        ['__proto__']: ['P', 'Literal'],
      },
      { en: ['', 'x'.repeat(300)], jp: ['', '次の行'], ['__proto__']: ['', 'Own key'] },
    ],
  );

function nativeScene() {
  const name = new TextEncoder().encode('Name'),
    text = new TextEncoder().encode('Original'),
    strings = Uint8Array.from([1, 0x21, ...name, 0, 1, 0x20, ...text, 0]),
    bytes = new Uint8Array(16 + 32 + strings.length),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('CatScene'));
  view.setUint32(12, 32 + strings.length, true);
  for (const [at, word] of [
    [16, 16 + strings.length],
    [20, 1],
    [24, 8],
    [28, 16],
    [32, 2],
    [36, 0],
    [40, 0],
    [44, name.length + 3],
  ])
    view.setUint32(at, word, true);
  bytes.set(strings, 48);
  return bytes;
}

test('CSTL selected construction matches complete parsing then filtering, including literal keys', () => {
  const bytes = input(),
    full = readTranslation(bytes);
  for (const prefixes of [[], ['en'], ['jp', 'en'], ['__proto__'], ['absent'], ['en', 'en']])
    assert.deepEqual(readTranslation(bytes, prefixes), filtered(full, prefixes));
  assert(Object.hasOwn(readTranslation(bytes, ['__proto__']), '__proto__'));
  assert.deepEqual(readTranslation(bytes), full, 'the public default still returns every locale');
  for (const edge of [
    translation([], [{}]),
    translation(['en'], []),
    translation(['en', 'en'], [{ en: ['Name', 'Repeated header'] }]),
  ])
    for (const prefixes of [[], ['en']])
      assert.deepEqual(readTranslation(edge, prefixes), filtered(readTranslation(edge), prefixes));
});

test('CSTL selected calls keep independent output and never retain mutable source bytes', () => {
  const bytes = input(),
    saved = bytes.slice(),
    first = readTranslation(bytes, ['en']);
  first.en[0].text = 'changed';
  assert.equal(readTranslation(bytes, ['en']).en[0].text, 'First\x1fline');
  assert.deepEqual(bytes, saved);
  const second = readTranslation(bytes, ['en']);
  bytes.fill(0);
  assert.equal(second.en[1].text, 'x'.repeat(300));
});

test('discarded locales construct no message decoders while every language header is still decoded', () => {
  const Original = globalThis.TextDecoder,
    bytes = input();
  let count = 0;
  globalThis.TextDecoder = class extends Original {
    constructor(...args) {
      super(...args);
      count++;
    }
  };
  try {
    const full = readTranslation(bytes);
    assert.equal(count, 15, 'three headers and twelve speaker/text fields');
    count = 0;
    assert.deepEqual(readTranslation(bytes, ['en']), filtered(full, ['en']));
    assert.equal(count, 7, 'three headers and only four selected fields');
    count = 0;
    assert.deepEqual(readTranslation(bytes, []), {});
    assert.equal(count, 3, 'empty registration builds no speaker/text fields');
  } finally {
    globalThis.TextDecoder = Original;
  }
});

test('discarded CSTL strings retain truncation, integer, container and trailing-byte validation', () => {
  const valid = input();
  const malformed = [
    new Uint8Array(),
    valid.subarray(0, 9),
    valid.subarray(0, valid.length - 1),
    Uint8Array.from([...valid, 1]),
    Uint8Array.from([
      ...new TextEncoder().encode('CSTL'),
      0,
      0,
      0,
      0,
      ...new Uint8Array(62746).fill(255),
    ]),
  ];
  for (const bytes of malformed) {
    let expected;
    try {
      readTranslation(bytes);
    } catch (error) {
      expected = error;
    }
    assert(expected);
    for (const prefixes of [[], ['absent'], ['en']])
      assert.throws(() => readTranslation(bytes, prefixes), {
        name: expected.name,
        message: expected.message,
      });
  }
});

test('discarded invalid UTF-8 keeps the original nonfatal replacement policy', () => {
  const bytes = translation(['en'], [{ en: ['Speaker', 'BAD!'] }]),
    at = bytes.length - 4;
  bytes.set([0xf0, 0x80, 0x80, 0x41], at);
  assert.equal(readTranslation(bytes).en[0].text, '\ufffd\ufffd\ufffdA');
  assert.deepEqual(readTranslation(bytes, ['en']), readTranslation(bytes));
  assert.deepEqual(readTranslation(bytes, []), {});
});

test('reader ignore policy selects registered prefixes while strict/default behavior remains complete', () => {
  const bytes = input(),
    reader = new NativeSceneReader(['en']);
  assert.equal(reader.loadTranslations(bytes, ignore), true);
  assert.deepEqual(reader.translations, filtered(readTranslation(bytes), ['en']));
  assert.equal(reader.loadTranslations(bytes), false);
  assert.equal(reader.translations, null, 'strict unknown locale still rejects the table');
  const complete = new NativeSceneReader(['en', 'jp', '__proto__']);
  assert.equal(complete.loadTranslations(bytes), true);
  assert.deepEqual(complete.translations, readTranslation(bytes));
});

test('empty-prefix reader still performs resource reads/awaits and ordinary fresh loads', async () => {
  const data = new NativeSceneData(),
    calls = [],
    files = { 'sample.cst': nativeScene(), 'sample.cstl': input() };
  const read = async (name, category) => {
    calls.push([name, category, 'begin']);
    await Promise.resolve();
    calls.push([name, category, 'end']);
    return files[name];
  };
  assert.equal(await data.load('sample.cst', read, undefined, ignore), true);
  assert.deepEqual(data.reader.translations, {});
  assert.equal(new TextDecoder('shift_jis').decode(data.reader.text(0, 1)), 'Original');
  const body = data.reader.body,
    state = data.snapshot();
  assert.equal(await data.load('sample.cst', read, undefined, ignore), true);
  assert.notEqual(data.reader.body, body, 'no reader/body or file cache was added');
  const one = [
    ['sample.cst', 'scene', 'begin'],
    ['sample.cst', 'scene', 'end'],
    ['sample.cstl', 'scene', 'begin'],
    ['sample.cstl', 'scene', 'end'],
  ];
  assert.deepEqual(calls, [...one, ...one]);
  const fresh = new NativeSceneData();
  fresh.restore(state);
  assert.deepEqual(fresh.snapshot(), state);
  assert.deepEqual(fresh.reader.translations, {});
  assert.notEqual(fresh.reader.body.bytes, data.reader.body.bytes);
});

test('ignored-prefix malformed sidecar preserves diagnostics and leaves translations cleared', async () => {
  const bytes = input(),
    bad = bytes.subarray(0, bytes.length - 1),
    errors = [],
    data = new NativeSceneData();
  data.reader.translations = { old: [] };
  const read = async (name) => (name.endsWith('.cstl') ? bad : nativeScene());
  assert.equal(await data.load('sample.cst', read, (value) => errors.push(value), ignore), true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].resource, 'sample.cstl');
  assert.match(errors[0].error, /CSTL: range/);
  assert.equal(data.reader.translations, null);
});
