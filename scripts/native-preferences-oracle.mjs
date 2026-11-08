// SPDX-License-Identifier: MPL-2.0
// Original XML tree construction, serializer, parser and preference readers.
// Host boundaries are allocation, sprintf, Win32 NLS and the output file sink.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { PPIWindowsServices } from '../src/ppi/native-services.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import {
  preferencesFixture,
  preferenceScalarNames,
  preferencePaths,
  preferenceScalar,
  preferenceReaderInputs,
} from '../tests/fixtures/preferences-fixture.mjs';

const profiles = {
  ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0: {
    profile: 'nekopara-vol3-engine-2.6.1.76',
    wide: true,
    create: 0x722660,
    write: [0x721000, 0x721510],
    convert: 0x722ef0,
    file: 0x726000,
    serialize: 0x725f20,
    parse: 0x725700,
    importTree: 0x722c60,
    read: [0x71ff80, 0x720630, 0x720940],
    allocate: [0x79ea57, 0x5cac7e],
    free: [0x6f81d0, 0x79ecbc],
    sprintf: 0x79d913,
    engineGlobal: 0xb91bf8,
    settingsGlobal: 0xb91bfc,
    settingsOffset: 0x418,
    displayGlobal: 0xb8f074,
    stricmp: 0x7a6dff,
    vsprintf: 0x7a5985,
    blocks: [0x11da8, 0x133a4, 0x133ec, 0x1340c],
    font: 64528,
    systemVoice: 78872,
    first: 62768,
    second: 64416,
  },
  '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f': {
    profile: 'sdk-4.01-engine-2.6.1.74',
    wide: false,
    create: 0x5d2ed0,
    write: [0x5d1440, 0x5d18f0],
    convert: 0x5d36d0,
    file: 0x5d6680,
    serialize: 0x5d65a0,
    parse: 0x5d5e90,
    importTree: 0x5d34d0,
    read: [0x5d05e0, 0x5d0ba0, 0x5d0e40],
    allocate: [0x4a7bc0, 0x636cc0, 0x4a7efa],
    free: [0x4a7c70, 0x49c240, 0x664230],
    sprintf: 0x636423,
    engineGlobal: 0xc965d0,
    settingsGlobal: 0xc965d4,
    settingsOffset: 0x210,
    displayGlobal: 0xc93b94,
    stricmp: 0x63d325,
    vsprintf: 0x63d29a,
    blocks: [0xe600, 0xfbfc, 0xfc38, 0xfc54],
    font: 53288,
    systemVoice: 64608,
    first: 52320,
    second: 53188,
  },
};
const option = (name) => process.argv[process.argv.indexOf(name) + 1],
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (!process.argv.includes('--exe'))
  throw new Error(
    'Usage: node scripts/native-preferences-oracle.mjs --exe <frozen.exe> --output <ignored.json>',
  );
const image = new Uint8Array(await fs.readFile(option('--exe'))),
  sha256 = hash(image),
  profile = profiles[sha256];
if (!profile) throw new Error(`Unknown frozen original engine SHA256 ${sha256}`);
const v = new DataView(image.buffer),
  pe = v.getUint32(60, true);
v.setUint16(pe + 22, v.getUint16(pe + 22, true) | 0x2000, true);
const a = profile.first,
  b = profile.second,
  sdk = !profile.wide;
const mapping = [
  ...['width', 'height', 'fullWidth', 'fullHeight', 'currentWidth', 'currentHeight'].map(
    (field, i) => [`screen.${field}`, a + i * 2, 2],
  ),
  ...[
    ['screen.fullWide', 12],
    ['screen.limit', 16],
    ['screen.fps', 20],
    ['screen.cursorMode', 24],
    ['texture.bpp', 28],
    ['texture.min', 32],
    ['texture.mag', 36],
    ['texture.dither', 40],
    ['sound.use3d', 44],
    ['sound.sticky', 48],
    ['sound.stereo', 52],
    ['general.imageCache', 56],
    ['screen.screensaver', 60],
    ['screen.camouflage', 64],
    ['general.gdiCap', 68],
    ['general.z32', 72],
    ['general.useZ', 76],
    ['screen.outInfo', 80],
    ['general.cache', 84],
  ].map(([name, offset]) => [name, a + offset, 4]),
  ...[
    ['screen.mode', 0],
    ['screen.fullscreen', 4],
    ['screen.bpp', 8],
    ['d3d.hardTnL', 12],
    ['d3d.backBuffer', 16],
    ['d3d.light', 20],
    ['d3d.vsync', 24],
    ['d3d.antialias', 28],
    ['d3d.fogType', 32],
    ['d3d.textureSize', 36],
    ['d3d.textureCompression', 40],
    ['general.dualCore', 48],
    ['general.disableMovie', 52],
    ['general.disablePixelShader', 56],
    ['screen.fullSize', 60],
    ['screen.fullPosition', 64],
    ['screen.multiWindowPosition', 68],
    ['screen.wall', 72],
    ['general.waitD3DCommand', 76],
    ['screen.noFullResolution', 80],
  ].map(([name, offset]) => [name, b + offset, 4]),
  ['screen.setMode', a - 4, 4],
  ['configuration.type', sdk ? 53280 : 64520, 4],
  ['window.drag', sdk ? 53284 : 64524, 4],
  ...(!sdk
    ? [
        ['language.ui', 64508, 4],
        ['language.main', 64512, 4],
        ['language.sub', 64516, 4],
        ['language.default', 58592, 4],
        ['window.active', 82140, 4],
        ['scene.animation', 82144, 4],
      ]
    : []),
  ['scene.autoSelect', sdk ? 67872 : 82136, 4],
];
const paths = preferencePaths.map((name, i) => [name, a + 88 + i * (sdk ? 260 : 520)]);
const cases = [];
const inputs = [
  ...[
    ['authored', 0],
    ['authored', 1],
    ['authored', 2],
    ['authored', 3],
    ['empty', 3],
    ['signed', 3],
    ['xml-text', 3],
  ].map(([variant, flags]) => ({ variant, flags })),
  ...preferenceReaderInputs(profile.profile).map((row) => ({ ...row, flags: 3, readerOnly: true })),
];
for (const { variant, flags, readerOnly, xml: sourceXML } of inputs) {
  const p = new PE32Process(await loadUnicorn(), { trace: true, budget: 500000000 }),
    services = new PPIWindowsServices(p, { now: () => 0, epoch: 0 });
  services.definitions.set('lstrcpyW', {
    count: 2,
    fn: ([target, source]) => {
      p.write(target, p.stringBytes(source, true, true));
      return target;
    },
  });
  services.definitions.set('lstrlenW', {
    count: 1,
    fn: ([source]) => p.stringBytes(source, true).length / 2,
  });
  p.loadModule(image, (symbol) => services.resolve(symbol), 'frozen-engine.exe');
  const patch = (address, count, callback, cdecl = false) => {
    const trap = p.trap(`preference boundary ${address.toString(16)}`, count, callback);
    if (cdecl) p.write(trap, [0xc3]);
    p.write(address, [
      0xb8,
      trap & 255,
      (trap >>> 8) & 255,
      (trap >>> 16) & 255,
      trap >>> 24,
      0xff,
      0xe0,
    ]);
  };
  for (const address of profile.allocate)
    patch(address, 3, ([size]) => p.allocate(size, true), true);
  if (profile.wide) {
    patch(0x6a49d0, 2, ([, size]) => p.allocate(size, true), true);
    patch(0x6a4b00, 1, () => 0, true);
  } else patch(0x575ce0, 2, ([, size]) => p.allocate(size, true), true);
  for (const address of profile.free) patch(address, 1, () => 0, true);
  patch(
    profile.sprintf,
    8,
    ([out, format, ...args]) => {
      let i = 0;
      const text = p.string(format).replace(/%([0-9]*)([ds])/g, (_, width, kind) => {
        const value = args[i++];
        return (kind === 's' ? p.string(value) : String(value | 0)).padStart(+width || 0, '0');
      });
      services.writeString(out, text);
      return text.length;
    },
    true,
  );
  patch(
    profile.stricmp,
    2,
    ([left, right]) => {
      left = p.string(left).toLowerCase();
      right = p.string(right).toLowerCase();
      return left === right ? 0 : left < right ? -1 : 1;
    },
    true,
  );
  patch(
    profile.vsprintf,
    3,
    ([out, format, args]) => {
      let i = 0;
      const text = p.string(format).replace(/%([0-9]*)([ds])/g, (_, width, kind) => {
        const value = p.load(args + i++ * 4);
        return (kind === 's' ? p.string(value) : String(value | 0)).padStart(+width || 0, '0');
      });
      services.writeString(out, text);
      return text.length;
    },
    true,
  );
  const owner = p.allocate(0x30000, true),
    document = p.allocate(8, true),
    file = p.allocate(512, true),
    size = p.allocate(4, true);
  p.store(profile.engineGlobal, owner);
  p.store(profile.settingsGlobal, owner + profile.settingsOffset);
  p.store(profile.displayGlobal, 0);
  const rows = p.allocate(56 * 3, true),
    vector = p.allocate(12, true);
  p.store(vector, rows);
  p.store(vector + 4, rows + 56 * 3);
  p.store(vector + 8, rows + 56 * 3);
  const setOwner = (configuration) => {
    p.zero(owner, 0x30000);
    configuration.blocks.forEach((block, i) => p.write(owner + profile.blocks[i], block));
    p.write(owner + profile.font, configuration.fields.data);
    p.write(owner + profile.systemVoice, configuration.fields.systemVoice);
    for (const [name, offset, width] of mapping) {
      const value = preferenceScalar(configuration, name);
      if (width === 2) {
        p.write(owner + offset, [value & 255, (value >>> 8) & 255]);
      } else p.store(owner + offset, value);
    }
    for (const [name, offset] of paths)
      services.writeString(owner + offset, configuration.getField(name), profile.wide);
    if (!sdk) p.store(owner + 58596, vector);
  };
  const state = () => {
    const values = new Map(
      mapping.map(([name, offset, width]) => [
        name,
        width === 2
          ? new DataView(p.read(owner + offset, 2).buffer).getUint16(0, true)
          : p.load(owner + offset),
      ]),
    );
    return Buffer.concat([
      ...configuration.blocks.map((block, i) => p.read(owner + profile.blocks[i], block.length)),
      p.read(owner + profile.font, configuration.fields.data.length),
      p.read(owner + profile.systemVoice, configuration.fields.systemVoice.length),
      new Uint8Array(
        Uint32Array.from(preferenceScalarNames.map((name) => values.get(name) ?? 0)).buffer,
      ),
      new TextEncoder().encode(
        JSON.stringify(paths.map(([, offset]) => p.string(owner + offset, profile.wide))),
      ),
    ]);
  };
  const configuration = preferencesFixture(profile.profile, readerOnly ? 'authored' : variant);
  try {
    setOwner(configuration);
    p.call(profile.create, [], document);
    if (flags & 1) p.call(profile.write[0], [document], owner);
    if (flags & 2) p.call(profile.write[1], [document], owner);
    let raw;
    patch(profile.file, 1, () => {
      raw = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
      return 0;
    });
    p.call(profile.convert, [file], document);
    p.store(size, 0);
    p.call(profile.serialize, [0, size], raw);
    let buffer = p.allocate(p.load(size));
    p.call(profile.serialize, [buffer, size], raw);
    let xml = p.read(buffer, p.load(size));
    if (readerOnly) {
      xml = sourceXML;
      buffer = p.allocate(xml.length);
      p.write(buffer, xml);
    }
    const target = preferencesFixture(profile.profile, 'target');
    setOwner(target);
    const readerDocument = p.allocate(8, true);
    p.call(profile.create, [], readerDocument);
    const parsed = p.call(profile.parse, [buffer, xml.length], p.load(readerDocument));
    let imported = 0;
    if (!parsed) {
      imported = p.call(profile.importTree, [], readerDocument);
      if (flags & 1) p.call(profile.read[0], [readerDocument], owner);
      if (flags & 2) {
        p.call(profile.read[1], [readerDocument], owner);
        p.call(profile.read[2], [readerDocument], owner);
      }
    }
    const after = state();
    cases.push({
      variant,
      flags,
      readerOnly: !!readerOnly,
      xml: Buffer.from(xml).toString('base64'),
      parseStatus: parsed,
      imported,
      stateSHA256: hash(after),
      ...(process.argv.includes('--state-bytes') ? { state: after.toString('base64') } : {}),
      imports: [...services.calls],
    });
  } catch (cause) {
    throw new Error(`${profile.profile} ${variant}/${flags}: ${cause.message}`, { cause });
  } finally {
    p.close();
  }
}
const output = {
  format: 'native-preference-xml-oracle',
  profile: profile.profile,
  engineSHA256: sha256,
  boundaries: ['allocation/free', 'C sprintf', 'Win32 NLS string conversion', 'output file sink'],
  cases,
};
if (process.argv.includes('--output'))
  await fs.writeFile(option('--output'), JSON.stringify(output, null, 2) + '\n');
process.stdout.write(
  JSON.stringify({
    profile: profile.profile,
    cases: cases.length,
    parserStatuses: cases.map((row) => row.parseStatus),
  }) + '\n',
);
