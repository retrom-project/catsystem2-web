// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess, nativeImageIdentity } from '../src/native/engine-process.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { Particles } from '../src/particles.mjs';
import { PPIRegistry } from '../src/ppi/plugin-identity.mjs';
import { authoredPPI } from './fixtures/ppi-js-fixture.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { kif } from './helpers.mjs';

const startup = (encoding) =>
  new TextEncoder().encode(
    `<?xml version="1.0" encoding="${encoding}"?><document><INT><int00><name>ptclpi</name><int>dummy.int</int><ext>ppi</ext><dir>plugins</dir></int00></INT></document>`,
  );

for (const [profile, variable, resolver, encoding] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x4b0710, 'Shift_JIS'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x5d3810, 'UTF-8'],
])
  test(
    profile + ' particle DLL names use the original physical directory resolver',
    { skip: !process.env[variable] },
    async () => {
      const bytes = startup(encoding),
        resources = new NativeResources(parseNativeXML(bytes, encoding)),
        engine = await NativeEngineProcess.open({
          bytes: new Uint8Array(await readFile(process.env[variable])),
          profile,
          bootstrapOwner: {},
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          readFile: async (path) => (path === 'config/startup.xml' ? bytes : null),
        }),
        p = engine.process;
      try {
        const source = p.allocate(256, true),
          out = p.allocate(256, true),
          category = p.allocate(16, true);
        engine.kernel.writeString(category, 'ptclpi');
        for (const name of [
          '',
          'flare',
          'flare.dll',
          'flare.',
          '.flare',
          'other/flare',
          'other\\flare',
          '/flare',
          '\\flare',
          '星a',
        ]) {
          engine.kernel.writeString(source, name);
          assert.equal(await p.callAsync(resolver, [out, source, category]), 1);
          assert.equal(resources.resolveLoose(name, 'ptclpi'), p.string(out));
        }
      } finally {
        await engine.close();
      }
    },
  );

test('a mounted plugin identity uses the loose file and JS checkpoint restore never rereads its DLL', async () => {
  const plugin = nativeParticleFixture(),
    override = Uint8Array.of(1, 2, 3),
    files = new Map(
      Object.entries({
        'config/startup.xml': startup('UTF-8'),
        'plugins/probe.ppi': plugin,
        'update02.int': kif([
          ['probe.ppi', override],
          ['archiveonly.ppi', override],
        ]),
      }).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
    ),
    game = new GameFiles(files),
    create = () =>
      new Particles(
        { width: 8, height: 8, frame: 0, emitters: {} },
        {
          game,
          images: {},
          registry: new PPIRegistry({ implementations: { probe: authoredPPI } }),
        },
      );
  await game.open();
  assert.deepEqual(await game.readNative('dummy.int/probe.ppi'), override);
  const host = create(),
    fresh = create();
  try {
    const bank = await host.load(0, { family: 'plugin', program: 'probe', count: 2, priority: 1 });
    assert.equal(bank.program, 'plugins\\probe.ppi');
    assert.equal(bank.instance.identity, await nativeImageIdentity(plugin));
    assert.deepEqual(await game.readNative('dummy.int/archiveonly.ppi'), override);
    await assert.rejects(
      host.readPlugin('plugins\\archiveonly.ppi'),
      /Missing loose particle library/,
    );
    game.readLoose = async () => assert.fail('JS restore must not read a DLL');
    await fresh.restore(host.snapshot());
    assert.equal(fresh.get(0).instance.identity, bank.instance.identity);
    assert.deepEqual(fresh.get(0).instance.records(), bank.instance.records());
  } finally {
    fresh.close();
    host.close();
  }
});
