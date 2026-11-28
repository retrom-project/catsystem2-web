// SPDX-License-Identifier: MPL-2.0
// Retain only differences between the host codec and the measured NT CP932
// boundary. Input is authored RTL output from native-registry-oracle.py.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const [input, output, golden] = process.argv.slice(2);
if (!golden) throw new Error('Usage: prepare-registry-codepage.mjs NLS_BIN CODEC_DATA GOLDEN_JSON');
const raw = new Uint8Array(await readFile(input)),
  view = new DataView(raw.buffer),
  decoder = new TextDecoder('shift_jis', { fatal: true, ignoreBOM: true }),
  decode = [],
  encode = [],
  lead = (byte) => (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc),
  baseDecode = (bytes) => {
    if (bytes.length === 1 && lead(bytes[0])) return 0;
    try {
      return decoder.decode(Uint8Array.from(bytes)).charCodeAt(0);
    } catch {
      return 0x30fb;
    }
  },
  code = (bytes) => bytes.reduce((word, byte, i) => word | (byte << (i * 8)), 0),
  read = (at) => {
    const size = view.getUint32(at, true),
      word = view.getUint32(at + 4, true);
    return [size, word & (size === 1 ? 255 : 65535)];
  };
let at = 0;
for (let i = 0; i < 256; i++, at += 8) {
  const [size, word] = read(at);
  if (size !== 2) throw new Error('Unexpected RTL single-byte width');
  if (baseDecode([i]) !== word) decode.push([i, word]);
}
for (let a = 0x81; a <= 0xfc; a++)
  if (lead(a))
    for (let b = 0; b < 256; b++, at += 8) {
      const [size, word] = read(at);
      if (size !== 2) throw new Error('Unexpected RTL DBCS width');
      if (baseDecode([a, b]) !== word) decode.push([0x10000 + a * 256 + b, word]);
    }
for (let unit = 0; unit < 65536; unit++, at += 8) {
  const [size, word] = read(at),
    baseline = encodeCP932(String.fromCharCode(unit));
  if (![1, 2].includes(size)) throw new Error('Unexpected RTL encoded width');
  if (baseline.length !== size || code(baseline) !== word) encode.push([unit, size, word]);
}
if (at !== raw.length) throw new Error('Unexpected RTL oracle length');
const sha256 = createHash('sha256').update(raw).digest('hex');
await writeFile(
  output,
  '// SPDX-License-Identifier: MPL-2.0\n// Generated from authored RTL calls; regenerate with prepare-registry-codepage.mjs.\n' +
    'export const REGISTRY_CP932_EXCEPTIONS = ' +
    JSON.stringify({ decode, encode }) +
    ';\n',
);
await writeFile(
  golden,
  JSON.stringify(
    { sha256, bytes: raw.length, decodeExceptions: decode.length, encodeExceptions: encode.length },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ sha256, decodeExceptions: decode.length, encodeExceptions: encode.length }),
);
