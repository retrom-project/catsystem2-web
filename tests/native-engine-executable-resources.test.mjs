// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';

for (const [profile, variable, resourceImport, copyLength] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'FindResourceA', 10],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'FindResourceW', 12],
])
  test(
    `${profile} validates its mounted startup against the original executable resources`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const path = process.env[variable],
        [bytes, startup] = await Promise.all([
          readFile(path),
          readFile(resolve(dirname(path), 'config/startup.xml')),
        ]),
        make = (config, executableResources) =>
          NativeEngineProcess.open({
            profile,
            bytes,
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            bootstrapOwner: { executableResources },
            readFile: async (name) => (name === 'config/startup.xml' ? config : null),
          }),
        baseline = await make(startup, false);
      let engine, restored;
      try {
        engine = await make(startup, true);
        const { process: p, refs, kernel } = engine;
        assert.equal(baseline.process.stringBytes(baseline.refs.settings + 262).length, 0);
        assert.equal(p.stringBytes(refs.settings + 262).length, copyLength);
        assert.equal(p.allocations.size, baseline.process.allocations.size);
        for (const name of [
          resourceImport,
          'LoadResource',
          'SizeofResource',
          'LockResource',
          'FreeResource',
        ])
          assert.equal(kernel.calls.get('kernel32.dll!' + name), 3);
        assert.equal(p.executionBoundaries.size, 0);
        restored = await make(startup, true);
        restored.restore(engine.snapshot());
        assert.equal(restored.process.stringBytes(restored.refs.settings + 262).length, copyLength);
        if (profile.startsWith('nekopara-')) {
          const config = new TextDecoder().decode(startup),
            changed = config.replace(/<v_code>[^<]+<\/v_code>/i, '<v_code>INVALID</v_code>');
          assert.ok(changed !== config);
          await assert.rejects(
            make(new TextEncoder().encode(changed), true),
            /Original engine rejected its executable resources/,
          );
        }
      } finally {
        await restored?.close();
        await engine?.close();
        await baseline.close();
      }
    },
  );
