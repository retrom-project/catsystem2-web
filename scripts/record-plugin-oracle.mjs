// SPDX-License-Identifier: MPL-2.0
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { NativeEmoteDevice } from '../oracle/m2-device-original.mjs';
import { NativePPI } from '../oracle/ppi-native-original.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { recordEmoteFrames, recordPPIFrames } from '../oracle/plugin-frames.mjs';
import { emotePSBFixture } from '../tests/fixtures/emote-psb-fixture.mjs';

export async function recordPluginOracle(args) {
  const { values } = parseArgs({
    args,
    options: {
      kind: { type: 'string' },
      plugin: { type: 'string' },
      model: { type: 'string' },
      input: { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (!['emote', 'ppi'].includes(values.kind) || !values.plugin || !values.input || !values.output)
    throw new Error(
      'Usage: --kind emote|ppi --plugin DLL --input schedule.json --output trace.json [--model PSB]',
    );
  const bytes = new Uint8Array(await readFile(values.plugin)),
    input = JSON.parse(await readFile(values.input, 'utf8')),
    sha256 = (data) => createHash('sha256').update(data).digest('hex'),
    trace = {
      kind: values.kind,
      pluginSHA256: sha256(bytes),
      recorderSHA256: sha256(
        await readFile(new URL('../oracle/plugin-frames.mjs', import.meta.url)),
      ),
      input,
      coverage: {
        memory: 'public-output-only',
        internalControllers: 'not-observed; exported variable values are recorded',
        privateVelocityAndLife: 'not-observed; requires per-plugin reviewed state layout',
        pixels: 'not-observed; use the existing Wine/D3D pixel oracle',
      },
    };
  if (values.kind === 'emote') {
    const model = values.model ? new Uint8Array(await readFile(values.model)) : emotePSBFixture(),
      device = await NativeEmoteDevice.open(bytes, { width: 256, height: 256 });
    try {
      const player = await device.createPlayer(model);
      player.show();
      trace.modelSHA256 = sha256(model);
      trace.result = recordEmoteFrames(player, input.steps, input);
    } finally {
      device.close();
    }
  } else {
    const { particleData, ...options } = input.options ?? {},
      data = particleData ? new Uint8Array(await readFile(particleData)) : null,
      particle = await NativePPI.open(bytes, {
        ...options,
        name: values.plugin,
        unicornFactory: loadUnicorn,
        now: () => 0,
        epoch: 0,
        ...(data ? { readParticleData: () => data } : {}),
      });
    try {
      trace.version = particle.version;
      trace.result = recordPPIFrames(particle, input.frames);
    } finally {
      particle.close();
    }
  }
  await writeFile(values.output, JSON.stringify(trace, null, 2) + '\n');
  return {
    kind: trace.kind,
    pluginSHA256: trace.pluginSHA256,
    frames: trace.result.frames?.length ?? trace.result.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await recordPluginOracle(process.argv.slice(2))));
