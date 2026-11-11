// SPDX-License-Identifier: MPL-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { NativeEmoteDevice } from '../oracle/m2-device-original.mjs';
import { recordEmoteFrames } from '../oracle/plugin-frames.mjs';
import { emoteGeometryCases, emoteGeometryModel } from '../tests/fixtures/emote-geometry-cases.mjs';
const { values } = parseArgs({
  options: { driver: { type: 'string' }, output: { type: 'string' } },
});
if (!values.driver || !values.output)
  throw new Error('Usage: --driver private/emotedriver.dll --output golden.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  driver = await readFile(values.driver);
const driverSHA256 = hash(driver);
if (driverSHA256 !== '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce')
  throw new Error('Requires the reviewed driver digest');
const result = {
  kind: 'Original DLL geometry output on authored PSB models',
  driverSHA256,
  generatorSHA256: hash(await readFile(new URL('./record-emote-geometry.mjs', import.meta.url))),
  casesSHA256: hash(
    await readFile(new URL('../tests/fixtures/emote-geometry-cases.mjs', import.meta.url)),
  ),
  comparison: {
    vertices: 'exact float32 bits',
    color: 'exact packed bytes',
    uv: 'exact float32 bits',
  },
  cases: [],
};
for (const input of emoteGeometryCases()) {
  const d = await NativeEmoteDevice.open(driver, {
    width: 256,
    height: 256,
    now: () => 0,
    epoch: 0,
  });
  try {
    const model = emoteGeometryModel(input),
      p = await d.createPlayer(model);
    p.show();
    const states = [];
    d.d3d.onDraw = (command) => {
      if (command.type === 'triangles')
        states.push({
          states: [...command.state.states].filter(([id]) =>
            [
              7, 8, 9, 14, 15, 19, 20, 22, 23, 24, 25, 26, 27, 52, 53, 54, 55, 56, 57, 58, 59, 168,
              171, 174, 194, 206, 207, 208, 209,
            ].includes(id),
          ),
          samplers: [...command.state.samplers],
          stages: [...command.state.stages].map(([stage, data]) => [stage, [...data]]),
        });
    };
    const recorded = recordEmoteFrames(p, input.steps);
    let at = 0;
    for (const frame of recorded.frames) for (const draw of frame.draws) draw.state = states[at++];
    result.cases.push({ name: input.name, modelSHA256: hash(model), ...recorded });
  } finally {
    d.close();
  }
}
await writeFile(values.output, JSON.stringify(result, null, 2) + '\n');
console.log({ cases: result.cases.length });
