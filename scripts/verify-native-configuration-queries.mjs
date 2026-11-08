// SPDX-License-Identifier: MPL-2.0
// Complete original wrappers, formatting and classifiers. Only ordinary PE
// platform services and independently authored configuration records are supplied.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import {
  NativeConfigurationQueries,
  NATIVE_CONFIGURATION_QUERY_CONTRACTS,
  NATIVE_CONFIGURATION_QUERY_LAYOUTS,
} from '../src/native/configuration-query.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  configurationQueryState,
  configurationQueryMachine,
  authorOriginalQueryInputs,
} from '../tests/fixtures/configuration-query-fixture.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: verify-native-configuration-queries.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Configuration query oracle requires a frozen engine');
const rawState = configurationQueryState(profile),
  state = configurationQueryState(profile),
  raw = await NativeEngineProcess.open({ bytes, profile, configuration: rawState.configuration }),
  engine = await NativeEngineProcess.open({ bytes, profile, configuration: state.configuration }),
  world = { ...state, objects: { machine: () => null } },
  model = new NativeConfigurationQueries(engine, world),
  p = raw.process,
  q = engine.process,
  a = configurationQueryMachine(),
  b = configurationQueryMachine(),
  block = a.allocate(1024),
  otherBlock = b.allocate(1024),
  index = Number(profile.startsWith('sdk-')),
  inputs = [
    '',
    'bg01',
    'BG01',
    'se00',
    'voice01',
    'voice_child01',
    'call1',
    'system1',
    'missing',
    'long_sound_filename_01',
    '日本語01',
    'pcm/voice01',
    'PCM.int/voice01',
    'other/call1',
    'x/y/voice01',
    'vo%sc%02d',
    'voice.int/voice01',
    '\\voice01',
    'voice.int\\voice01',
    new TextEncoder().encode('日本語01'),
    Uint8Array.of(0x82, 0xff, 0x5c, 0x41),
  ],
  categories = [
    '',
    'sound',
    'SOUND',
    'image',
    'pcm',
    'last',
    'missing',
    '日本語',
    '%s',
    new TextEncoder().encode('日本語'),
  ];
let comparisons = 0,
  calls = 0,
  dispose = () => {};
const covered = new Map(),
  check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  put = (at, bytes) => {
    for (const m of [a, b]) m.bytes(at, bytes.length + 1).set([...bytes, 0]);
  };
check(block, otherBlock, 'same extended allocation');
for (const spec of NATIVE_CONFIGURATION_QUERY_CONTRACTS)
  assert.equal(p.load(NATIVE_PROFILES[profile].tables.main.va + spec.id * 4), spec.handlers[index]);
async function run(spec, args) {
  const words = Array.from(args);
  while (words.length < spec.words) words.push(a.nativeArgument(words.length));
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    words.forEach((word, i) => p.store(argv + 4 * i, word));
    p.store(out, 0xcccccccc);
    control = await raw.call(spec.handlers[index], [bridge.pointer, 0, argv, out]);
    value = p.load(out);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
  }
  const reply = await model.apply(spec.id, args, b, { id: 1 });
  check(reply.control, control, 'original control');
  if (control === 1) check(reply.value, value, 'original result');
  check(b.memory, a.memory, 'whole VM data/stack');
  check(b.shared, a.shared, 'whole VM shared');
  check(b.blocks, a.blocks, 'whole extended blocks');
  check(state.configuration.blocks, rawState.configuration.blocks, 'live configuration blocks');
  calls++;
  covered.set(spec.id, (covered.get(spec.id) ?? 0) + 1);
}
try {
  for (let seed = 0; seed < 16; seed++) {
    const source = configurationQueryState(profile, seed);
    rawState.configuration.restore(source.configuration.snapshot());
    state.configuration.restore(source.configuration.snapshot());
    rawState.soundConfiguration.loaded = state.soundConfiguration.loaded =
      source.soundConfiguration.loaded;
    dispose();
    dispose = authorOriginalQueryInputs(raw, rawState);
    for (const spec of NATIVE_CONFIGURATION_QUERY_CONTRACTS) {
      if (spec.id === 0x24d) {
        for (const at of [512, a.data.length + 64, 0x80000040, block + 64]) {
          for (const m of [a, b]) {
            m.memory.fill(0xa5);
            m.shared.fill(0x5a);
            m.blocks[0].fill(0x3c);
          }
          const offset = NATIVE_CONFIGURATION_QUERY_LAYOUTS[profile].query24D;
          [0x80000000 + seed, 0xffffffff - seed].forEach((word, i) => {
            p.store(raw.refs.owner + offset + i * 4, word);
            q.store(engine.refs.owner + offset + i * 4, word);
          });
          await run(spec, [at, at + (seed & 1 ? 0 : 4)]);
        }
        continue;
      }
      for (let n = 0; n < inputs.length; n++) {
        for (const m of [a, b]) {
          m.memory.fill(0xa5);
          m.shared.fill(0x5a);
          m.blocks[0].fill(0x3c);
          m.fp = 128;
          m.store(128, 256);
          m.store(132, seed);
        }
        const at = [512, a.data.length + 64, 0x80000040, block + 64][n % 4],
          input = typeof inputs[n] === 'string' ? encodeCP932(inputs[n]) : inputs[n];
        put(at, input);
        put(256, encodeCP932('i'));
        if (spec.id === 0x2a2)
          for (const category of categories) {
            put(768, typeof category === 'string' ? encodeCP932(category) : category);
            await run(spec, [at, 768]);
          }
        else await run(spec, [at]);
      }
    }
  }
  for (const spec of NATIVE_CONFIGURATION_QUERY_CONTRACTS) {
    put(512, encodeCP932('voice01'));
    put(768, encodeCP932('sound'));
    for (const m of [a, b]) {
      m.nativeArgumentBase = 100;
      m.store(100, 512);
      m.store(104, 768);
    }
    await run(spec, []);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        covered: [...covered].map(([id, count]) => ({ id, count })),
        boundaries: [
          'original complete formatting and classifiers are executed',
          'independently authored native archive/sound records',
          'PE allocation and platform services',
          'four VM regions and complete byte canaries',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ profile, calls, comparisons, errors: 0 }));
} finally {
  dispose();
  await engine.close();
  await raw.close();
}
