// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import {
  NATIVE_CONFIGURATION_QUERY_LAYOUTS,
  NativeConfigurationQueries,
} from '../oracle/configuration-query.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { readNativeStartupSoundConfiguration } from '../src/native/engine-startup-sound.mjs';
import {
  NativeSoundConfiguration,
  applyNativeSoundPreferences,
} from '../src/native/sound-config.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';

const filename = 'sound-settings.xml';
const startup = `<SOUNDCONFIG>${filename}</SOUNDCONFIG><INT><int00><name>config</name><int>config.int</int><dir>config</dir><ext>xml</ext></int00></INT>`;
const mounted =
  '<SOUNDGROUP><one><id>17</id><type>voice</type><label>Voice</label></one><two><id>5</id><comment>効果音</comment><type>se</type><label>Effects</label><min>3</min><max>7</max></two></SOUNDGROUP>' +
  '<MASTER><volume>79</volume><voicevol>81</voicevol><sysplay>1</sysplay><mute>0</mute></MASTER>' +
  '<PART><effects><id>4</id><group>5</group><sameid>1</sameid><name>日本語の長い効果音の名前</name><type>se</type><head>FX</head><int>se</int><mastervol>62</mastervol><volume>82</volume><part><child><name>child</name></child></part></effects></PART>';
const preferences =
  '<MASTER><volume>37</volume><mute>0</mute></MASTER><PART><effects><volume>57</volume><part><child><volume>43</volume></child></part></effects></PART>';

for (const [profile, variable, encoding] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'Shift_JIS'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'UTF-8'],
]) {
  test(
    `${profile} startup sound keeps the original mounted, saved and native-owned trees distinct`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        xml = (body) => {
          const text = `<?xml version="1.0" encoding="${encoding}"?><document>${body}</document>`;
          return encoding === 'Shift_JIS' ? encodeCP932(text) : new TextEncoder().encode(text);
        },
        document = xml(mounted),
        saved = xml(preferences),
        expected = new NativeSoundConfiguration({
          profile,
          filename,
          document: parseNativeXML(document, encoding),
        }),
        file = (data) => new BlobFile(new Blob([data])),
        game = new GameFiles(
          new Map([
            ['main.kcs', file(Uint8Array.of(59))],
            ['config/startup.xml', file(xml(startup))],
            [`config/${filename}`, file(document)],
          ]),
        );
      assert.equal(applyNativeSoundPreferences(expected, saved), true);
      await game.open();
      const readStorage = async (name) => (name === filename ? saved : game.read(name)),
        open = () =>
          NativeEngineProcess.open({
            profile,
            bytes,
            game,
            readFile: readStorage,
            bootstrapOwner: {
              mountFiles(engine) {
                new NativeDataBuffers(engine);
                new NativeEngineFiles(engine, { game });
              },
            },
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          }),
        engine = await open(),
        p = engine.process,
        layout = NATIVE_CONFIGURATION_QUERY_LAYOUTS[profile],
        sound = new NativeSoundConfiguration({ profile });
      let fresh, invalid;
      try {
        const requests = [],
          diagnostics = [];
        await readNativeStartupSoundConfiguration(
          engine,
          sound,
          (name) => {
            requests.push(name);
            return saved;
          },
          (detail) => diagnostics.push(detail),
        );
        assert.deepEqual(requests, [filename]);
        assert.deepEqual(diagnostics, []);
        assert.equal(engine.kernel.readFile, readStorage);
        assert.equal(engine.kernel.fileProviders.has('startup-sound-configuration'), false);
        assert.equal(engine.refs.startupSoundConfiguration, true);
        assert.deepEqual(sound.master, expected.master);
        assert.deepEqual(sound.parts, expected.parts);
        assert.deepEqual(sound.groups, expected.groups);
        assert.deepEqual([...sound.groups.keys()], [5, 17]);
        assert.equal(sound.master.defaults.volume, 79);
        assert.equal(sound.master.current.volume, 37);
        assert.equal(sound.parts[0].children[0].current.volume, 43);

        const base = engine.refs.owner,
          parts = p.load(base + layout.soundParts),
          children = p.load(parts + 184),
          groups = p.load(base + layout.soundParts - 8),
          groupRoot = p.load(groups + 4);
        new NativeConfigurationQueries(engine, { soundConfiguration: sound, game });
        const sync = (instance) =>
          instance.call(instance.kernel.resolve({ dll: 'KERNEL32.dll', name: 'GetTickCount' }));
        sound.set('volume', 23, { by: 'key', query: 'effects' });
        await sync(engine);
        assert.equal(p.load(base + layout.soundParts), parts);
        assert.equal(p.load(parts + 160), 23);
        assert.equal(p.load(parts + 184), children);
        assert.equal(engine.refs.configurationQueries.allocations.size, 0);

        fresh = await open();
        const restored = new NativeSoundConfiguration({ profile }).restore(sound.snapshot()),
          queries = new NativeConfigurationQueries(fresh, { soundConfiguration: restored, game });
        fresh.restore(engine.snapshot());
        await sync(fresh);
        assert.equal(fresh.process.load(parts + 160), 23);
        queries.close();
        await fresh.releaseOwner();
        for (const address of [parts, children, groups, groupRoot]) {
          assert.equal(fresh.process.allocations.has(address), false);
          assert(p.allocations.has(address));
        }
        invalid = await open();
        const defaults = new NativeSoundConfiguration({ profile });
        await readNativeStartupSoundConfiguration(
          invalid,
          defaults,
          () => new TextEncoder().encode('<broken'),
          (detail) => diagnostics.push(detail),
        );
        assert.deepEqual(diagnostics, [{ type: 'preferences-invalid', file: filename }]);
        assert.equal(defaults.master.current.volume, 79);
      } finally {
        await invalid?.close();
        await fresh?.close();
        await engine.close();
      }
    },
  );
}
