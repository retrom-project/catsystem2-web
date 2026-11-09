// SPDX-License-Identifier: MPL-2.0
// Executes the original FES field dispatch and its dirty/volume epilogue.
// Only parser/expression/variable/string-bank/event boundaries are host traps.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { PPIWindowsServices } from '../src/ppi/native-services.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  fesConfigurationFixture,
  fesConfigurationCases,
  fesConfigurationStrings,
  fesM2Models,
  fesM2Cases,
} from '../tests/fixtures/fes-config-fixture.mjs';

const profiles = {
  ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0: {
    profile: 'nekopara-vol3-engine-2.6.1.76',
    get: 0x77cdb0,
    set: 0x77dd20,
    legacy: 0x77c060,
    tokens: 0x766440,
    expression: 0x728d80,
    mark: 0x766590,
    variable: 0x728c40,
    stringGet: 0x740500,
    stringSet: 0x740980,
    stringOffset: 0x810,
    event: 0x77a310,
    engineGlobal: 0xb91bf8,
    settingsGlobal: 0xb91bfc,
    settingsOffset: 0x418,
    dirty: 0x410,
    isWindow: 0x27db8,
    blocks: [0x11990, 0x12f8c, 0x12fd4, 0x12ff4],
    font: 0xf7f8,
    presets: 0xc384,
    sysplay: 0x13600,
    scalars: [0xf78c, 0xf7e4, 0xf7e8, 0xf7ec, 0x13cc4, 0x13cc8],
    languages: 0xe0cc,
    wide: true,
  },
  '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f': {
    profile: 'sdk-4.01-engine-2.6.1.74',
    get: 0x616610,
    set: 0x617310,
    legacy: 0x6158c0,
    tokens: 0x6020c0,
    expression: 0x5d9230,
    mark: 0x602210,
    variable: 0x5d90f0,
    stringGet: 0x5e1360,
    stringSet: 0x5e1660,
    stringOffset: 0x708,
    event: 0x613cc0,
    engineGlobal: 0xc965d0,
    settingsGlobal: 0xc965d4,
    settingsOffset: 0x210,
    dirty: 0x208,
    isWindow: 0x21040,
    blocks: [0xe3f0, 0xf9ec, 0xfa28, 0xfa44],
    font: 0xce18,
    presets: 0xb91c,
    sysplay: 0x10050,
    scalars: [0xcdb8, null, null, null, null, null],
    wide: false,
  },
};
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const exe = option('--exe');
if (!process.argv.includes('--exe') || !exe)
  throw new Error(
    'Usage: node scripts/native-fes-config-oracle.mjs --exe <frozen.exe> --output <ignored.json>',
  );
const bytes = new Uint8Array(await fs.readFile(exe));
const sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = profiles[sha256];
if (!profile) throw new Error(`Unknown original engine SHA256 ${sha256}`);
// The analysis image alone is marked DLL to reuse the loader. No entry point,
// TLS initialization or on-disk fixture is changed.
const header = new DataView(bytes.buffer),
  pe = header.getUint32(60, true);
header.setUint16(pe + 22, header.getUint16(pe + 22, true) | 0x2000, true);
const p = new PE32Process(await loadUnicorn(), { trace: true });
const services = new PPIWindowsServices(p, { now: () => 0, epoch: 0 });
p.loadModule(bytes, (symbol) => services.resolve(symbol), 'frozen-engine.exe');
const engine = p.allocate(0x30000, true),
  settings = engine + profile.settingsOffset;
const object = p.allocate(0x1000, true),
  dummy = p.allocate(64, true),
  strings = p.allocate(1024, true),
  languageRows = p.allocate(3 * 56, true),
  languageVector = p.allocate(12, true);
p.store(languageVector, languageRows);
p.store(languageVector + 4, languageRows + 3 * 56);
p.store(languageVector + 8, languageRows + 3 * 56);
p.store(profile.engineGlobal, engine);
p.store(profile.settingsGlobal, settings);
p.store(object, dummy);
p.store(object + 0x24, dummy);
p.store(object + profile.stringOffset, dummy);
p.store(object + 0x5bc, dummy);
let input, writes, events;
const patch = (address, count, callback) => {
  const trap = p.trap(`FES boundary 0x${address.toString(16)}`, count, callback);
  p.write(
    address,
    Uint8Array.from([
      0xb8,
      trap & 255,
      (trap >>> 8) & 255,
      (trap >>> 16) & 255,
      trap >>> 24,
      0xff,
      0xe0,
    ]),
  );
};
patch(profile.tokens, 3, ([, index, out]) => {
  const token = input.tokens[index - 1];
  if (token === undefined) return 0;
  p.write(out, encodeCP932(`${token}\0`));
  return 1;
});
patch(profile.expression, 1, ([text]) => Number(p.string(text)) | 0);
patch(profile.mark, 2, () => 1);
patch(profile.variable, 2, ([index, value]) => {
  writes.push({ bank: 'number', index, value });
  return 1;
});
patch(profile.stringSet, 2, ([index, text]) => {
  writes.push({ bank: 'string', index, value: p.string(text, profile.wide) });
  return 1;
});
patch(profile.stringGet, 2, ([index]) => {
  p.write(strings, encodeCP932(`${fesConfigurationStrings[index] ?? ''}\0`));
  return strings;
});
patch(profile.event, 1, ([packet]) => {
  events.push(Array.from({ length: 5 }, (_, i) => p.load(packet + 4 * i)));
  return 1;
});
const hash = (data) => createHash('sha256').update(data).digest('hex');
const result = [];
const legacyCases = [];
const m2Cases = [];
try {
  for (const row of fesConfigurationCases()) {
    const config = fesConfigurationFixture(profile.profile);
    p.zero(engine, 0x30000);
    config.blocks.forEach((block, i) => p.write(settings + profile.blocks[i], block));
    p.write(settings + profile.font, config.fields.data);
    p.write(settings + profile.presets, new Uint8Array(config.autoPresets.buffer));
    const sysplay = config.getField('voice.sysplay');
    p.write(
      settings + profile.sysplay,
      new Uint8Array(sysplay.buffer, sysplay.byteOffset, sysplay.byteLength),
    );
    const values = [
      'screen.fullscreen',
      'language.ui',
      'language.main',
      'language.sub',
      'window.active',
      'scene.animation',
    ];
    profile.scalars.forEach((offset, i) => {
      if (offset !== null) p.store(settings + offset, config.getField(values[i]));
    });
    if (profile.languages) p.store(settings + profile.languages, languageVector);
    p.store(engine + profile.isWindow, 1);
    input = {
      ...row,
      tokens: [row.operation === 'get' ? 11 : row.value, row.name, row.ex1, row.ex2],
    };
    writes = [];
    events = [];
    try {
      p.call(profile[row.operation], [object, 0, 0, dummy, 0]);
    } catch (cause) {
      throw new Error(`${profile.profile} ${JSON.stringify(row)}: ${cause.message}`, { cause });
    }
    const arrays = [
      ...config.blocks.map((block, i) => p.read(settings + profile.blocks[i], block.length)),
      p.read(settings + profile.font, config.fields.data.length),
      p.read(settings + profile.presets, config.autoPresets.byteLength),
      p.read(settings + profile.sysplay, 48 * 4),
      new Uint8Array(
        Uint32Array.from(
          profile.scalars.map((offset) => (offset === null ? 0 : p.load(settings + offset))),
        ).buffer,
      ),
    ];
    result.push({
      ...row,
      writes,
      events,
      dirty: p.load(engine + profile.dirty),
      stateSHA256: hash(Buffer.concat(arrays)),
    });
  }
  p.write(settings + profile.blocks[0], fesConfigurationFixture(profile.profile).blocks[0]);
  for (const tokens of [
    [850, 'vol_bgm'],
    [851, 'vol_se'],
    [852, 'vol_pcm', 'ignored_extra'],
    [853, 'vol_voice'],
    [854, 'VOL_BGM'],
    [855],
    [],
  ]) {
    input = { tokens };
    writes = [];
    p.call(profile.legacy, [object, 0, 0, dummy, 0]);
    legacyCases.push({ tokens, writes });
  }
  if (profile.wide) {
    const manager = p.allocate(96, true),
      localsBacking = p.allocate(514 * 4, true),
      locals = localsBacking + 4;
    p.store(dummy + 0x24, locals);
    const makeTree = (names) => {
      const head = p.allocate(80, true),
        nodes = names.map(() => p.allocate(80, true));
      p.write(head + 13, [1]);
      p.store(head, nodes[0] ?? head);
      p.store(head + 4, nodes[0] ?? head);
      p.store(head + 8, nodes.at(-1) ?? head);
      nodes.forEach((node, i) => {
        p.store(node, head);
        p.store(node + 4, nodes[i - 1] ?? head);
        p.store(node + 8, nodes[i + 1] ?? head);
        p.write(node + 16, encodeCP932(names[i] + '\0'));
        p.store(node + 32, names[i].length);
        p.store(node + 36, 15);
      });
      return { head, nodes };
    };
    const trees = {
      model: makeTree(fesM2Models.map(([name]) => name)),
      level: makeTree(['Body']),
      enabled: makeTree(['Body']),
      empty: makeTree([]),
    };
    for (const row of fesM2Cases()) {
      p.zero(manager, 96);
      p.zero(localsBacking, 514 * 4);
      p.store(locals + (row.index ?? 11) * 4, 0x5a5a5a5a);
      p.store(0xb9bd98, row.manager === 'absent' ? 0 : manager);
      p.store(manager + 60, row.manager === 'empty' ? trees.empty.head : trees.model.head);
      p.store(manager + 72, trees.level.head);
      p.store(manager + 80, trees.enabled.head);
      p.store(manager + 68, 6);
      fesM2Models.forEach(([, model], i) =>
        Object.values(model).forEach((value, j) =>
          p.store(trees.model.nodes[i] + 40 + j * 4, value),
        ),
      );
      p.store(trees.level.nodes[0] + 40, 77);
      p.store(trees.enabled.nodes[0] + 40, 9);
      input = {
        tokens: [row.name, row.operation === 'get' ? (row.index ?? 11) : row.value, row.part],
      };
      writes = [];
      events = [];
      try {
        p.call(row.operation === 'get' ? 0x786970 : 0x786e50, [object, 0, 0, dummy, 0]);
      } catch (cause) {
        throw new Error(`M2 ${JSON.stringify(row)}: ${cause.message}`, { cause });
      }
      m2Cases.push({
        ...row,
        local: p.load(locals + (row.index ?? 11) * 4),
        models:
          row.manager === 'empty'
            ? []
            : fesM2Models.map(([name], i) => [
                name,
                Object.fromEntries(
                  Object.keys(fesM2Models[i][1]).map((field, j) => [
                    field,
                    p.load(trees.model.nodes[i] + 40 + j * 4),
                  ]),
                ),
              ]),
        level: p.load(trees.level.nodes[0] + 40),
        enabled: p.load(trees.enabled.nodes[0] + 40),
        interleave: p.load(manager + 68),
      });
    }
  }
} finally {
  p.close();
}
const output = {
  format: 'native-fes-configuration-oracle',
  engineSHA256: sha256,
  profile: profile.profile,
  boundaries: [
    'token read',
    'numeric expression with authored integer literals',
    'token mark',
    'number/string bank write',
    'string bank read',
    'FES event enqueue',
  ],
  cases: result,
  legacyCases,
  m2Cases,
};
if (process.argv.includes('--output'))
  await fs.writeFile(option('--output'), JSON.stringify(output, null, 2) + '\n');
process.stdout.write(
  JSON.stringify({ profile: profile.profile, cases: result.length, engineSHA256: sha256 }) + '\n',
);
