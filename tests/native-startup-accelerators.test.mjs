// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { initializeNativeAccelerators } from '../src/native/engine-startup-accelerators.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import {
  initializeNativeWindowOwner,
  releaseNativeWindowOwner,
} from '../src/native/engine-startup-window.mjs';

const base = [
  [0x13, 112, 40021],
  [0x13, 13, 40012],
  [0x13, 115, 40002],
  [3, 45, 40030],
];
for (const [profile, variable, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'W'],
])
  test(
    `${profile} WinMain owns the original accelerator table after fresh restore`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        open = () =>
          NativeEngineProcess.open({
            profile,
            bytes,
            bootstrapOwner: {},
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            readFile: async () => null,
          }),
        engine = await open(),
        { process: p, kernel } = engine,
        { language } = engine.options.configuration,
        block = NATIVE_STARTUP_BLOCKS[profile],
        get = (instance) => {
          const owner = instance.process.load(block);
          return instance.process.load(owner + 12);
        };
      let fresh;
      try {
        await initializeNativeWindowOwner(engine);
        await initializeNativeAccelerators(engine);
        const resource = get(engine);
        assert.deepEqual(kernel.accelerators.tables.get(resource).rows, base);
        const copy = kernel.resolve({ dll: 'USER32.dll', name: 'CopyAcceleratorTable' + suffix }),
          out = p.allocate(24);
        p.write(out, new Uint8Array(24).fill(0xa5));
        assert.equal(p.call(copy, [resource, 0, 0]), 4);
        assert.equal(p.call(copy, [resource, out, 2]), 2);
        const data = new DataView(p.read(out, 12).buffer);
        for (let i = 0; i < 2; i++)
          assert.deepEqual(
            [
              data.getUint8(i * 6),
              data.getUint16(i * 6 + 2, true),
              data.getUint16(i * 6 + 4, true),
            ],
            base[i],
          );
        assert.equal(data.getUint8(1), 0xa5);
        assert.equal(data.getUint8(7), 0xa5);
        assert.deepEqual(p.read(out + 12, 12), new Uint8Array(12).fill(0xa5));
        if (language) {
          await releaseNativeWindowOwner(engine);
          language.entries = [
            { code: 1033, prefix: 'en', lang: 'English', accel: [69, 0], accelsub: [69, 4] },
            { code: 1041, prefix: 'jp', lang: '日本語', accel: [0, 0], accelsub: [74, 8] },
            { code: 1028, prefix: 'cn', lang: '繁体中文', accel: [67, 16], accelsub: [0, 0] },
          ];
          await initializeNativeWindowOwner(engine);
          await initializeNativeAccelerators(engine);
        }
        const handle = get(engine),
          actual = kernel.accelerators.tables.get(handle);
        assert.deepEqual(
          actual.rows,
          language
            ? [
                ...base,
                [1, 69, 40075],
                [5, 69, 40085],
                [9, 74, 40086],
                [17, 67, 40076],
                [4, 78, 40087],
              ]
            : base,
        );
        assert.equal(Boolean(actual.resource), !language);
        fresh = await open();
        fresh.options.configuration.restore(engine.options.configuration.snapshot());
        fresh.restore(engine.snapshot());
        assert.equal(get(fresh), handle);
        assert.deepEqual(fresh.kernel.accelerators.tables.get(handle), actual);
        await releaseNativeWindowOwner(fresh);
        assert.equal(fresh.kernel.accelerators.tables.has(handle), !language);
        assert.equal(fresh.kernel.accelerators.tables.has(resource), true);
        assert.deepEqual(kernel.accelerators.tables.get(handle), actual);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
