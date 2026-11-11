// SPDX-License-Identifier: MPL-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { NativeEmoteDevice } from '../oracle/m2-device-original.mjs';
import { recordEmoteFrames } from '../oracle/plugin-frames.mjs';
import {
  emoteControllerCases,
  emoteControllerModel,
} from '../tests/fixtures/emote-controller-cases.mjs';

const { values } = parseArgs({
  options: { driver: { type: 'string' }, output: { type: 'string' } },
});
if (!values.driver || !values.output)
  throw new Error('Usage: --driver private/emotedriver.dll --output golden.json');
const driver = new Uint8Array(await readFile(values.driver)),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  driverSHA256 = hash(driver);
if (driverSHA256 !== '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce')
  throw new Error('Controller oracle requires the reviewed NEKOPARA driver SHA-256');
const golden = {
  kind: 'Original DLL output from authored PSB models; no game model or executable code',
  driverSHA256,
  generatorSHA256: hash(await readFile(new URL('./record-emote-controllers.mjs', import.meta.url))),
  harnessSHA256: hash(await readFile(new URL('../oracle/plugin-frames.mjs', import.meta.url))),
  casesSHA256: hash(
    await readFile(new URL('../tests/fixtures/emote-controller-cases.mjs', import.meta.url)),
  ),
  comparison: {
    variables: 'exact float32 bits',
    vertices: 'raw bytes; geometry checks belong to 9.3',
  },
  cases: [],
};
for (const input of emoteControllerCases()) {
  const device = await NativeEmoteDevice.open(driver, {
    width: 256,
    height: 256,
    now: () => 0,
    epoch: 0,
  });
  try {
    const model = emoteControllerModel(input.category, input.settings),
      player = await device.createPlayer(model);
    player.show();
    golden.cases.push({
      name: input.name,
      modelSHA256: hash(model),
      ...recordEmoteFrames(player, input.steps, input),
    });
  } finally {
    device.close();
  }
}
await writeFile(values.output, JSON.stringify(golden, null, 2) + '\n');
console.log(JSON.stringify({ output: values.output, cases: golden.cases.length }));
