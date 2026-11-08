// SPDX-License-Identifier: MPL-2.0
// Original FES dispatch, sound-tree accessors and dirty/volume epilogue execute
// unchanged. Only token, expression and global-variable bank boundaries trap.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import {
  NativeFESSoundConfiguration,
  tokenizeNativeFESSoundConfiguration,
} from '../src/native/fes-sound-config.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  soundConfigurationFields,
  fesSoundConfigurationFixture,
  fesSoundConfigurationCases,
  fesSoundExpression,
  fesSoundConfigurationState,
  fesSoundConfigurationTokenCases,
} from '../tests/fixtures/fes-sound-config-fixture.mjs';

const profiles = {
  ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0: {
    profile: 'nekopara-vol3-engine-2.6.1.76',
    get: 0x783630,
    set: 0x783fd0,
    tokens: 0x766440,
    rawToken: 0x767550,
    expression: 0x728d80,
    variable: 0x728c40,
    master: 163308,
    parts: 163296,
    dirty: 0x410,
    blocks: [0x11990, 0x12f8c, 0x12fd4, 0x12ff4],
  },
  '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f': {
    profile: 'sdk-4.01-engine-2.6.1.74',
    get: 0x61c6b0,
    set: 0x61d050,
    tokens: 0x6020c0,
    rawToken: 0x603310,
    expression: 0x5d9230,
    variable: 0x5d90f0,
    master: 135284,
    parts: 135272,
    dirty: 0x208,
    blocks: [0xe3f0, 0xf9ec, 0xfa28, 0xfa44],
  },
};
const [exe, reportPath] = process.argv.slice(2);
if (!exe || !reportPath)
  throw new Error(
    'Usage: node scripts/verify-native-fes-sound-config.mjs frozen.exe ignored-report.json',
  );
const bytes = new Uint8Array(await fs.readFile(exe)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = profiles[sha256];
if (!profile) throw new Error(`Unreviewed engine SHA256 ${sha256}`);
const native = await NativeEngineProcess.open({
    profile: profile.profile,
    bytes,
    standardLibraries: false,
    trace: true,
  }),
  p = native.process,
  owner = native.refs.owner,
  settings = native.refs.settings,
  object = p.allocate(0x100, true),
  parser = p.allocate(64, true),
  line = p.allocate(64, true),
  records = [],
  results = [],
  lexerResults = [],
  hash = (data) => createHash('sha256').update(data).digest('hex');
p.store(object, parser);
p.store(object + 36, parser);
let row, expressions, writes, tokenReads;
native.patch(
  profile.tokens,
  'FES token boundary',
  3,
  ([, index, out]) => {
    tokenReads.push(index);
    const token = row.tokens[index - 1];
    if (token === undefined) return 0;
    p.write(out, encodeCP932(token + '\0'));
    return 1;
  },
  { calleePops: true },
);
native.patch(
  profile.expression,
  'FES expression boundary',
  1,
  ([text]) => fesSoundExpression(p.string(text), row, expressions),
  { calleePops: true },
);
native.patch(
  profile.variable,
  'FES variable boundary',
  2,
  ([index, value]) => {
    writes.push({ index, value });
    return 1;
  },
  { calleePops: true },
);
const string = (at, text) => {
  const source = encodeCP932(text);
  if (source.length >= 16)
    throw new Error('Authored oracle strings must fit native inline storage');
  p.zero(at, 24);
  p.write(at, [...source, 0]);
  p.store(at + 16, source.length);
  p.store(at + 20, 15);
};
const buildRecord = (at, node) => {
  p.zero(at, 196);
  records.push(at);
  string(at, node.key);
  string(at + 52, node.type);
  p.store(at + 48, node.id);
  p.store(at + 128, node.mastervol);
  if (node.children.length) {
    const children = p.allocate(node.children.length * 196, true);
    p.store(at + 184, children);
    p.store(at + 188, children + node.children.length * 196);
    p.store(at + 192, children + node.children.length * 196);
    node.children.forEach((child, index) => buildRecord(children + index * 196, child));
  }
};
const fixture = fesSoundConfigurationFixture(profile.profile);
buildRecord(owner + profile.master, fixture.soundConfiguration.master);
const parts = p.allocate(fixture.soundConfiguration.parts.length * 196, true);
p.store(owner + profile.parts, parts);
p.store(owner + profile.parts + 4, parts + fixture.soundConfiguration.parts.length * 196);
p.store(owner + profile.parts + 8, parts + fixture.soundConfiguration.parts.length * 196);
fixture.soundConfiguration.parts.forEach((node, i) => buildRecord(parts + i * 196, node));
const defaults = [132, 136, 140, 144, 152, 148];
try {
  const lexerLine = p.allocate(4096, true),
    lexerOut = p.allocate(4096, true);
  for (const source of fesSoundConfigurationTokenCases()) {
    p.write(lexerLine, encodeCP932(source + '\0'));
    const actual = [];
    for (let index = 0; index < 64; index++) {
      const exists = await native.call(profile.rawToken, [lexerLine, index, lexerOut]);
      if (!exists) break;
      actual.push(p.string(lexerOut));
    }
    const expected = tokenizeNativeFESSoundConfiguration(source, profile.profile);
    lexerResults.push({
      source,
      actual,
      expected,
      match: JSON.stringify(actual) === JSON.stringify(expected),
    });
  }
  for (row of fesSoundConfigurationCases()) {
    const { configuration, soundConfiguration } = fesSoundConfigurationFixture(
      profile.profile,
      row.seed,
    );
    let index = 0,
      dirty = 0;
    const reset = (node) => {
      const at = records[index++];
      soundConfigurationFields.forEach((field, i) => {
        p.store(at + defaults[i], node.defaults[field]);
        p.store(at + 160 + i * 4, node.current[field]);
      });
      for (const child of node.children) reset(child);
    };
    reset(soundConfiguration.master);
    soundConfiguration.parts.forEach(reset);
    configuration.blocks.forEach((block, i) => p.write(settings + profile.blocks[i], block));
    p.store(owner + profile.dirty, 0);
    expressions = [];
    writes = [];
    tokenReads = [];
    let control;
    try {
      control = await native.call(profile[row.operation], [object, 0, 0, line, 0]);
    } catch (cause) {
      throw new Error(`${JSON.stringify(row)}: ${cause.message}`, { cause });
    }
    const actual = {
      control,
      writes,
      expressions,
      dirty: p.load(owner + profile.dirty),
      stateSHA256: hash(
        Buffer.concat([
          Buffer.from(
            Uint32Array.from(
              records.flatMap((at) =>
                soundConfigurationFields.map((_, i) => p.load(at + 160 + i * 4)),
              ),
            ).buffer,
          ),
          ...configuration.blocks.map((block, i) =>
            Buffer.from(p.read(settings + profile.blocks[i], block.length)),
          ),
        ]),
      ),
    };
    const service = new NativeFESSoundConfiguration({
        configuration,
        soundConfiguration,
        changed: () => {
          dirty = 1;
        },
      }),
      expectedExpressions = [],
      expectedWrites = [],
      context = { evaluate: (token) => fesSoundExpression(token, row, expectedExpressions) };
    if (row.tokens[0] !== undefined) {
      const first = context.evaluate(row.tokens[0]);
      if (row.tokens[1] !== undefined) {
        if (row.operation === 'get') {
          const value = service.get(row.tokens.slice(1), context);
          if (value !== undefined) expectedWrites.push({ index: first >>> 0, value: value >>> 0 });
        } else await service.set(row.tokens.slice(1), first, context);
      }
    }
    const expected = {
      control: 0,
      writes: expectedWrites,
      expressions: expectedExpressions,
      dirty,
      stateSHA256: hash(fesSoundConfigurationState(configuration, soundConfiguration)),
    };
    results.push({
      ...row,
      tokenReads,
      actual,
      expected,
      match: JSON.stringify(actual) === JSON.stringify(expected),
    });
  }
} finally {
  await native.close();
}
const mismatches = [...lexerResults, ...results].filter((result) => !result.match),
  report = {
    format: 'native-fes-sound-configuration-differential',
    profile: profile.profile,
    engineSHA256: sha256,
    total: results.length + lexerResults.length,
    passed: results.length + lexerResults.length - mismatches.length,
    failed: mismatches.length,
    boundaries: [
      'token read/substitution',
      'numeric expression evaluation',
      'global-variable bank write',
      'CRT allocation/free',
      'Windows NLS services',
    ],
    nativeResultsSHA256: hash(JSON.stringify(results.map(({ actual }) => actual))),
    lexerResultsSHA256: hash(JSON.stringify(lexerResults.map(({ actual }) => actual))),
    lexerResults,
    results,
  };
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(
  JSON.stringify({ ...report, results: undefined, lexerResults: undefined }) + '\n',
);
if (mismatches.length) {
  process.stdout.write(JSON.stringify(mismatches.slice(0, 5), null, 2) + '\n');
  process.exitCode = 1;
}
