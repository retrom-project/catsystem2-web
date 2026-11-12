// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { GameFiles, BlobFile } from '../../../src/files.mjs';
import { binaryIdentity } from '../../../src/identity.mjs';
import { PNG } from '../../../src/formats/png.mjs';
import { nativeCategoryFilename, readNativeResource } from '../../../src/native/resource-file.mjs';
import { encodeNativeCP932, decodeNativeCP932 } from '../../../src/native/cp932.mjs';
import { EffekseerResources } from '../../../src/effekseer/resources.mjs';
import { EffekseerManagerLifecycle } from '../../../src/effekseer/manager-lifecycle.mjs';
import { LogicalCRTThreads } from '../../../src/effekseer/crt-threads.mjs';
import { createEffekseerInstanceOperations } from '../../../src/effekseer/instance-operations.mjs';

export const official = [
  'Laser01',
  'Laser02',
  'Simple_Ribbon_Parent',
  'Simple_Ring_Shape1',
  'Simple_Track1',
  'Simple_Sprite_FixedYAxis',
  'Simple_Distortion',
  'block_simple',
];
const encoder = new TextEncoder();
function kif(entries) {
  const result = new Uint8Array(
      8 + entries.length * 72 + entries.reduce((n, [, b]) => n + b.length, 0),
    ),
    view = new DataView(result.buffer);
  result.set(encoder.encode('KIF\0'));
  view.setUint32(4, entries.length, true);
  let offset = 8 + entries.length * 72;
  for (const [i, [name, bytes]] of entries.entries()) {
    result.set(encodeNativeCP932(name), 8 + i * 72);
    view.setUint32(8 + i * 72 + 64, offset, true);
    view.setUint32(8 + i * 72 + 68, bytes.length, true);
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}
let mountedInputs;
async function inputs() {
  if (mountedInputs) return mountedInputs;
  const manifest = JSON.parse(
      await readFile(new URL('./public-1.23-manifest.json', import.meta.url)),
    ),
    effects = [],
    textures = [];
  for (const entry of manifest) {
    const name = entry.path.split('/').at(-1);
    if (!/\.(efk|png)$/.test(name)) continue;
    const bytes = await readFile(new URL(`./public-1.23/${name}`, import.meta.url));
    (name.endsWith('.efk') ? effects : textures).push([name, bytes]);
  }
  effects.push([
    'authored.efk',
    await readFile(new URL('./authored-particles-v9.efk', import.meta.url)),
  ]);
  textures.push([
    'authored-spark.png',
    await readFile(new URL('./authored-spark.png', import.meta.url)),
  ]);
  const startup =
    '<?xml version="1.0" encoding="utf-8"?><document><INT><int00><name>efk</name><int>effects.int</int><ext>efk</ext></int00><int01><name>efktex</name><int>textures.int</int><ext>png</ext></int01></INT></document>';
  mountedInputs = [
    ['startup.xml', encoder.encode(startup)],
    ['effects.int', kif(effects)],
    ['textures.int', kif(textures)],
  ];
  return mountedInputs;
}
export async function setupMounted() {
  const game = new GameFiles(
    new Map((await inputs()).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))])),
  );
  await game.open();
  const world = { game },
    reads = [],
    disposed = [];
  const resources = new EffekseerResources({
      resolveCategory: (name, category) => nativeCategoryFilename(game, name, category),
      readNative: (name, mode) => {
        reads.push(name);
        return readNativeResource(world, name, mode);
      },
      roundTripCP932: (name) => decodeNativeCP932(encodeNativeCP932(name)),
      identify: binaryIdentity,
      decodeTexture: async (bytes) => {
        const png = new PNG(bytes);
        return { width: png.width, height: png.height, rgba: await png.decode() };
      },
      disposeTexture: (frame) => disposed.push(frame),
    }),
    threads = new LogicalCRTThreads();
  threads.create('frame');
  threads.create('forced');
  return { resources, threads, reads, disposed };
}
export const managerFor = (s) =>
  new EffekseerManagerLifecycle({
    resources: s.resources,
    threads: s.threads,
    instanceOperations: createEffekseerInstanceOperations(),
  });
