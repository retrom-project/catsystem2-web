// SPDX-License-Identifier: MPL-2.0
import { NativeRenderSources } from '../../src/native/render-sources.mjs';
import { NativeRetainedDraw } from '../../src/native/retained-draw.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { kcsProgram } from '../helpers.mjs';
import { imageCompositeFiles } from './image-composite-fixture.mjs';
import { imageFileFixture, imageFilePath } from './image-file-fixture.mjs';
import { imageOwnerFiles } from './image-owner-fixture.mjs';
import { authoredHG3 } from './hg3.mjs';

export const RENDER_SOURCE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    factory: 0x674f40,
    stride: 136,
    wide: true,
    wrapperBytes: 536,
    retainedBytes: 212,
    retainedRetain: 0x745c50,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    factory: 0x54c0f0,
    stride: 72,
    wide: false,
    wrapperBytes: 276,
    retainedBytes: 196,
    retainedRetain: 0x5e6b10,
  }),
});

export const RENDER_SOURCE_MANIFEST = 'alias\tanim\r\nalias\tmissing\r\n';

export async function renderSourceFiles() {
  const { files, frames } = imageCompositeFiles();
  for (const [name, bytes] of await imageOwnerFiles()) files.set(imageFilePath(name), bytes);
  const animation = files.get('anim.anm');
  files.set('alias.hg2', files.get('probe.hg2'));
  files.set('x_1.anm', animation);
  files.set('x_1.hg3.hg3', files.get('x_1.hg3'));
  files.set('x.hg3', files.get('single.hg3'));
  files.set('y_1.anm', animation);
  files.set('y_02.anm', animation);
  files.set('y_1.hg3.hg3', files.get('x_1.hg3'));
  files.set('y_02.hg3.hg3', files.get('x_02.hg3'));
  files.set('q_1.anm', animation);
  files.set('sequence.anm', animation);
  files.set(
    'sequence.hg3',
    authoredHG3(Array.from({ length: 8 }, (_, id) => ({ ...frames[0], id }))),
  );
  return { files, frames };
}

export async function renderSourceWorldFiles(profile, executable, driver) {
  const { files, frames } = await renderSourceFiles(),
    layout = RENDER_SOURCE_LAYOUTS[profile];
  files.set('engine.exe', executable);
  if (driver) files.set('emotedriver.dll', driver);
  files.set('anmtable.csv', encodeCP932(RENDER_SOURCE_MANIFEST));
  files.set(
    'main.kcs',
    kcsProgram(
      [
        [37, 2080],
        [37, 0],
        [37, 1],
        [43, 0x2bf, 12],
        [38, [4, 2000]],
        [37, 1800],
        [43, 0x47, 4],
        [59],
      ],
      [[2080, 'probe.hg2']],
    ),
  );
  files.set(
    'alias.kcs',
    kcsProgram([
      [37, 0x42424242],
      [38, [4, 4100 + layout.stride]],
      [37, 4100],
      [37, 2],
      [43, 0x2c0, 8],
      [37, 1800],
      [43, 0x47, 4],
      [59],
    ]),
  );
  files.set(
    'bind.kcs',
    kcsProgram([
      [37, [0x14, 256]],
      [37, 0],
      [37, [0x14, 0x80000024]],
      ...[0, 0x3f800000, 0, 0, 0, 0x3f800000, 0x3f800000, 255, 0, 0].map((word) => [37, word]),
      [43, 0x2c4, 52],
      [37, 1800],
      [43, 0x47, 4],
      [59],
    ]),
  );
  files.set(
    'metadata.kcs',
    kcsProgram([
      [37, [0x14, 256]],
      [37, 4100],
      [43, 0x2c2, 8],
      [38, [4, 252]],
      [37, 1800],
      [43, 0x47, 4],
      [59],
    ]),
  );
  return { files, layout, rgba: frames[0].rgba };
}

export async function renderSourceFixture(bytes, profile) {
  const fixture = await imageFileFixture(bytes, profile),
    { files, frames } = await renderSourceFiles();
  fixture.world.game.nativeResources.resolve = (name) => name;
  for (const [name, data] of files) fixture.files.set(name, data);
  const retained = new NativeRetainedDraw(fixture.engine, fixture.world),
    sources = new NativeRenderSources(fixture.engine, fixture.world);
  return { ...fixture, frames, retained, sources, layout: RENDER_SOURCE_LAYOUTS[profile] };
}
