// SPDX-License-Identifier: MPL-2.0
// Runs the original language loader, parser, maps and prefix lookup. Only file
// I/O, CRT allocation and Windows NLS cross the declared host boundaries.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeGlobalStrings } from '../src/native/global-strings.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeConfigurationMemory } from '../src/native/config-memory.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [exe, output] = process.argv.slice(2);
if (!exe || !output)
  throw new Error('Usage: node scripts/verify-native-global-strings.mjs FIXED_EXE IGNORED_REPORT');
const image = new Uint8Array(await readFile(exe)),
  sha256 = createHash('sha256').update(image).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Global string oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk'),
  engine = await NativeEngineProcess.open({
    profile,
    bytes: image,
    standardLibraries: false,
    trace: true,
  }),
  p = engine.process,
  registry = sdk ? 0xcc2bf8 : 0xbc3880,
  files = new Map(),
  archives = new Map(),
  reads = [],
  strings = new NativeGlobalStrings({
    profile,
    read(name) {
      reads.push(['direct', name, 257]);
      return files.get(name) ?? null;
    },
    readArchive(name, flag) {
      reads.push(['archive', name, flag]);
      return archives.get(name) ?? null;
    },
  }),
  encode = (text) => (sdk ? encodeCP932(text) : new TextEncoder().encode(text)),
  key = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
let opened = null,
  nativeReads = [],
  checks = 0;
const results = [];
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
engine.patch(
  sdk ? 0x4b36c0 : 0x5d70a0,
  'language direct file open',
  2,
  ([name, mode]) => {
    name = p.string(name, !sdk);
    nativeReads.push(['direct', name, mode]);
    opened = files.get(name) ?? null;
    return opened === null ? 0 : 1;
  },
  { calleePops: true },
);
engine.patch(sdk ? 0x4b35a0 : 0x5d6f80, 'language direct file length', 0, () => opened.length, {
  calleePops: true,
});
engine.patch(
  sdk ? 0x4b3800 : 0x5d71d0,
  'language direct file read',
  2,
  ([out, count]) => {
    p.write(out, opened.subarray(0, count));
    return count;
  },
  { calleePops: true },
);
if (!sdk) {
  engine.patch(
    0x5d47c0,
    'language archive open',
    2,
    ([name, flag]) => {
      name = p.string(name, true);
      nativeReads.push(['archive', name, flag]);
      opened = archives.get(name) ?? null;
      return opened === null ? 0 : 0x76543210;
    },
    { calleePops: true },
  );
  engine.patch(0x5d46e0, 'language archive length', 1, () => opened.length, { calleePops: true });
  engine.patch(
    0x5d50d0,
    'language archive read',
    3,
    ([, out, count]) => {
      p.write(out, opened.subarray(0, count));
      return count;
    },
    { calleePops: true },
  );
  engine.patch(0x5d3d60, 'language archive close', 1, () => 0, { calleePops: true });
}
function reset() {
  const head = p.allocate(64, true);
  p.store(head, head);
  p.store(head + 4, head);
  p.store(head + 8, head);
  p.store(head + 12, 257);
  p.store(registry, head);
  p.store(registry + 4, 0);
  strings.tables.clear();
  strings.filenames.clear();
}
function nativeEntries(head) {
  const out = [];
  function visit(node) {
    if (p.read(node + 13, 1)[0]) return;
    visit(p.load(node));
    const sso = (at) => {
      const address = p.load(at + 20) >= (sdk ? 16 : 8) ? p.load(at) : at;
      return sdk ? p.stringBytes(address) : p.string(address, true);
    };
    const name = sso(node + 16),
      value = sso(node + 40);
    out.push([sdk ? key(name) : name, sdk ? [...value] : value]);
    visit(p.load(node + 8));
  }
  visit(p.load(head + 4));
  return out;
}
function nativeTables() {
  const head = p.load(registry);
  if (sdk) return [[0, nativeEntries(head)]];
  const out = [];
  function visit(node) {
    if (p.read(node + 13, 1)[0]) return;
    visit(p.load(node));
    out.push([p.load(node + 16) | 0, nativeEntries(p.load(node + 20))]);
    visit(p.load(node + 8));
  }
  visit(p.load(head + 4));
  return out;
}
function expectedTables() {
  const tables = [...strings.tables]
    .map(([id, entries]) => [
      id,
      [...entries]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, value]) => [name, sdk ? [...value] : value]),
    ])
    .sort(([a], [b]) => a - b);
  return sdk && !tables.length ? [[0, []]] : tables;
}
async function reload(id, filename) {
  reads.length = 0;
  nativeReads = [];
  const name = p.allocate((filename.length + 1) * 2, true);
  engine.kernel.writeString(name, filename, !sdk);
  if (!sdk) p.cpu.reg_write_i32(p.uc.X86_REG_EDX, name);
  const result = await engine.call(sdk ? 0x47e690 : 0x5ab510, [], sdk ? undefined : id);
  check(result, Number(await strings.reload(id, filename)), 'loader result');
  check(nativeReads, reads, 'direct file/archive order');
  check(nativeTables(), expectedTables(), 'all native map keys and values');
}
async function lookup(query) {
  const raw = query instanceof Uint8Array ? query : encode(query),
    pointer = p.allocate(raw.length * 2 + 8, true);
  if (sdk) p.write(pointer, raw);
  else engine.kernel.writeString(pointer, query, true);
  const address = await engine.call(sdk ? 0x47ecf0 : 0x5abe00, [pointer]),
    actual = sdk ? [...p.stringBytes(address)] : p.string(address, true),
    expected = sdk ? [...strings.getBytes(raw)] : strings.get(query);
  check(actual, expected, 'prefix lookup');
}
try {
  const sources = [
    '',
    '\n\r\n\r',
    'orphan',
    '$one$\nfirst',
    '$one$\rfirst\r$two$\rsecond\r',
    '$one$\r\nfirst\r\n$one$\r\nsecond\n',
    '$one$\n$nr$\n$one$\naccepted\n',
    '$one$\n$empty$\n$two$\n$nr$x\n',
    ' $one$ \n value \n  $two$  \n  spaced  \n',
    '\t$one$\t\n\tv\ta\tl\tu\te\t\n',
    '// comment\n$one$/*a*/\nvalue//tail\n',
    '/* multi\ncomment */$one$\nvalue\n',
    '$one$\nbe/*a\nb*/fore\n$two$\nafter\n',
    '$one$\nvalue\n/* unterminated\n$two$\nother',
    '$one$\n"quoted // value"\n',
    '$one$\nhttp://host\n$two$\nsecond\n',
    '$one$\nvalue\0$two$\nignored\n',
    '$猫$\n猫の名前\n#hash#\nhashed\n$$\nempty-key\n',
    '$recursive$\n$other$literal\n$a#b$\nother\n',
    '\ufeff$first$\nvalue\n',
    '$' + 'a'.repeat(64) + '$\n' + 'v'.repeat(127) + '\n',
  ].map(encode);
  sources.push(Uint8Array.of(36, 0x81, 36, 10, 0x81, 10));
  let seed = 0x713e8b5;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let test = 0; test < 160; test++) {
    const lines = [],
      newline = ['\r\n', '\n', '\r'][test % 3];
    for (let n = 0; n < 8 + (next() % 25); n++) {
      const name = '$key_' + (next() % 17) + '$',
        value = [
          '$nr$',
          '$empty$',
          'plain',
          '  spaced value  ',
          'line\twith\ttab',
          '日本語',
          '#hash#literal',
          'x/*c*/y',
          'value//tail',
        ][next() % 9];
      lines.push((next() & 1 ? ' ' : '') + name + (next() & 1 ? ' ' : ''), value);
      if (next() % 3 === 0) lines.push('// discarded', '\t \t');
    }
    sources.push(encode(lines.join(newline)));
  }
  for (let i = 0; i < sources.length; i++) {
    reset();
    files.clear();
    archives.clear();
    const filename = sdk ? 'language.txt' : 'authored.txt',
      source = sources[i];
    if (!sdk && i % 3 === 2) archives.set(filename, source);
    else files.set(filename, source);
    await reload(0, filename);
    const queries = [
      '$one$fallback',
      '$two$fallback',
      '$missing$literal$one$',
      '#hash#fallback',
      '$$literal',
      '$one',
      'literal',
      '$猫$fallback',
      '$recursive$literal',
      '$a#b$fallback',
      '$' + 'a'.repeat(64) + '$literal',
    ];
    for (const entry of strings.tables.get(0)?.keys() ?? []) {
      if (sdk) queries.push(Uint8Array.from(Buffer.from(entry, 'hex')));
      else queries.push(entry + 'fallback');
    }
    for (const query of queries) await lookup(query);
    results.push({ kind: 'parser-and-lookup', source: i, queries: queries.length });
  }
  reset();
  files.clear();
  archives.clear();
  const filename = sdk ? 'language.txt' : 'reload.txt';
  files.set(filename, encode('$key$\nfirst\n'));
  await reload(0, filename);
  files.set(filename, encode('$key$\nsecond\n$added$\nnew\n'));
  await reload(0, filename);
  await lookup('$key$literal');
  await lookup('$added$literal');
  files.delete(filename);
  await reload(0, filename);
  await lookup('$key$literal');
  await lookup('$added$literal');
  if (!sdk) {
    for (const id of [1, 0, 0x7fffffff, -1, -2147483648]) {
      files.set(filename, encode('$key$\nfrom-' + id + '\n'));
      await reload(id, filename);
      await lookup('$key$literal');
    }
    files.delete(filename);
    await reload(-2147483648, filename);
    await lookup('$key$literal');
    const configuration = new NativeConfiguration({ profile }),
      codec = new NativeConfigurationMemory(p, configuration, engine.refs),
      buffer = p.allocate(8192, true),
      prefixes = p.allocate(768, true);
    strings.configuration = configuration;
    for (let variant = 0; variant < 5; variant++)
      for (const ui of [0, 1, 2, 0xffffffff])
        for (const main of [0, 1, 2, 0xffffffff]) {
          configuration.language.entries = [
            {
              prefix: variant === 3 ? '%LANG_M%' : 'jp',
              lang: 'a',
              code: 0x411,
              accel: [0, 0],
              accelsub: [0, 0],
            },
            {
              prefix: 'english-prefix-long',
              lang: 'b',
              code: 0x409,
              accel: [0, 0],
              accelsub: [0, 0],
            },
          ];
          if (variant === 4) configuration.language.entries = [];
          Object.assign(configuration.language, {
            ui,
            main,
            sub: 0xffffffff,
            default: variant === 2 ? 99 : 0,
            optionTable: 'option_%LANG%_%LANG_M%_%LANG%_%LANG_S%.txt',
          });
          codec.push();
          engine.kernel.writeString(buffer, configuration.language.optionTable, true);
          await engine.call(0x713970, [buffer], engine.refs.owner);
          await engine.call(0x713ae0, [buffer], engine.refs.owner);
          check(
            p.string(buffer, true),
            strings.optionFilename(),
            'option filename substitutions and fallbacks',
          );
          await engine.call(
            0x7137d0,
            [prefixes, prefixes + 256, prefixes + 512],
            engine.refs.owner,
          );
          check(
            'language_' + p.string(prefixes, true) + '.txt',
            strings.uiFilename(),
            'initial UI filename fallback',
          );
        }
    results.push({ kind: 'language-path-helpers', cases: 80 });
  }
  const report = {
    profile,
    sha256,
    passed: checks,
    failed: 0,
    boundaries: [
      'CRT initialization/allocation/free',
      'direct file and archive I/O',
      'Windows NLS and string APIs',
    ],
    original: sdk
      ? { loader: '47E690', parser: '47E770', lookup: '47ECF0', prefix: '47F070' }
      : {
          loader: '5AB510',
          parser: '5AB7A0',
          lookup: '5ABE00',
          prefix: ['5AC550', '5AC640'],
          filename: ['7137D0', '713970', '713AE0'],
        },
    results,
  };
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ profile, passed: checks, failed: 0 }));
} catch (error) {
  console.error({ checks, recent: p.recent.map((value) => value.toString(16)), trap: p.lastTrap });
  throw error;
} finally {
  engine.close();
}
