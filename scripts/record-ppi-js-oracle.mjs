// SPDX-License-Identifier: MPL-2.0
// Replay existing public DLL lifecycle APIs in the existing oracle host.
// No EXE, new native probe, patch or injected code is used.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { resolve } from 'node:path';
import { NativePPIRuntime } from '../src/ppi/native.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { capturePPIFrame } from '../oracle/plugin-frames.mjs';
import { PPI_SCENARIOS, scenarioPlist } from '../tests/fixtures/ppi-js-scenarios.mjs';
const sha = (data) => createHash('sha256').update(data).digest('hex');
export function compactPPIFrame(p, entry) {
  const { random, ...state } = capturePPIFrame(p, entry);
  return { ...state, randomSHA256: sha(JSON.stringify(random)) };
}
export async function recordPPIPlugins({ root, output }) {
  const plist = new Uint8Array(
      await readFile(new URL('../tests/fixtures/ppi-native.plist', import.meta.url)),
    ),
    cases = [];
  for (const scenario of PPI_SCENARIOS) {
    const bytes = new Uint8Array(await readFile(resolve(root, scenario.name + '.ppi'))),
      resource = scenarioPlist(plist, scenario.plist),
      { attachment: initial, ...options } = scenario.options;
    let attachment = initial;
    const runtime = await NativePPIRuntime.open({
      unicornFactory: loadUnicorn,
      now: () => 0,
      epoch: 0,
      readParticleData: () => resource,
    });
    try {
      runtime.process.cpu.reg_write_i32(runtime.process.uc.X86_REG_FPCW, 0x7f);
      const p = await runtime.create(bytes, {
        ...options,
        name: scenario.name + '.ppi',
        attachment: () => attachment,
      });
      const states = [compactPPIFrame(p, 'Init')];
      for (const action of scenario.actions) {
        if (action.registers) p.setRegisters(action.registers);
        if (action.attachment) attachment = action.attachment;
        if (action.stop) p.stop();
        else if (action.start) p.start();
        else p.update(action.frame);
        states.push(compactPPIFrame(p, action.stop ? 'Stop' : action.start ? 'Init' : 'Exec'));
      }
      cases.push({
        name: scenario.name,
        label: scenario.label ?? 'motion',
        version: p.version,
        pluginSHA256: sha(bytes),
        states,
      });
    } finally {
      runtime.close();
    }
  }
  const result = {
    source: 'Existing public NativePPIRuntime DLL oracle, normal engine floating point',
    controlWord: 0x7f,
    recorderSHA256: sha(await readFile(new URL('../oracle/plugin-frames.mjs', import.meta.url))),
    inputsSHA256: sha(
      await readFile(new URL('../tests/fixtures/ppi-js-scenarios.mjs', import.meta.url)),
    ),
    cases,
  };
  await writeFile(
    output,
    await format(JSON.stringify(result), {
      ...(await resolveConfig(fileURLToPath(new URL('../.prettierrc.json', import.meta.url)))),
      parser: 'json',
    }),
  );
  return { cases: cases.length, states: cases.reduce((sum, c) => sum + c.states.length, 0) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: { root: { type: 'string' }, output: { type: 'string' } },
  });
  if (!values.root || !values.output)
    throw new Error('Usage: --root PRIVATE_PPI_DIRECTORY --output TRACE.json');
  console.log(await recordPPIPlugins(values));
}
