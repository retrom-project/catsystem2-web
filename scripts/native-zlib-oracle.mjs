// SPDX-License-Identifier: MPL-2.0
// Execute the original wrapper, not its WASM replacement. Inputs are authored.
import fs from 'node:fs/promises';
import {
  NativeEngineProcess,
  nativeImageIdentity,
  NATIVE_ENGINE_IMAGES,
} from '../src/native/engine-process.mjs';
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--exe') || !process.argv.includes('--output'))
  throw new Error(
    'Usage: node scripts/native-zlib-oracle.mjs --exe <mounted original> --output <ignored report>',
  );
const bytes = new Uint8Array(await fs.readFile(option('--exe'))),
  identity = await nativeImageIdentity(bytes),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === identity,
  );
if (!profile) throw new Error('Unknown original engine identity');
const e = await NativeEngineProcess.open({
    bytes,
    profile,
    standardLibraries: false,
    now: () => 0,
    epoch: 0,
  }),
  p = e.process,
  input = JSON.parse(
    await fs.readFile(
      new URL('../tests/fixtures/native-zlib-golden.json', import.meta.url),
      'utf8',
    ),
  ),
  cases = [];
try {
  for (const row of input.cases) {
    const source = new Uint8Array(Buffer.from(row.input, 'base64')),
      at = p.allocate(source.length + 16, true),
      out = p.allocate(row.capacity + 16, true);
    try {
      p.write(at, source);
      p.write(out, new Uint8Array(row.capacity).fill(row.fill));
      const result = await e.call(NATIVE_ENGINE_IMAGES[profile].zlib, [
        out,
        row.capacity,
        at,
        source.length,
      ]);
      cases.push({
        ...row,
        result,
        output: Buffer.from(p.read(out, row.capacity)).toString('base64'),
      });
    } finally {
      p.free(at);
      p.free(out);
    }
  }
  await fs.writeFile(
    option('--output'),
    JSON.stringify(
      { kind: 'Original engine zlib 1.2.3 wrapper', engineSHA256: identity, profile, cases },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(JSON.stringify({ profile, cases: cases.length }) + '\n');
} finally {
  await e.close();
}
