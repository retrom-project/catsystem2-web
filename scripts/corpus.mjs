// SPDX-License-Identifier: MPL-2.0
import { nodeGame } from './node-files.mjs';
import { readScene, readTranslation, readFES } from '../src/formats/scene.mjs';
import { readKCS, KCSMachine, BootHost } from '../src/kcs.mjs';
import { HG3 } from '../src/formats/hg3.mjs';
import { readPSB } from '../src/formats/psb.mjs';
import { EmoteModel } from '../src/emote/model.mjs';
import { ScenePlayer } from '../src/scene.mjs';
const args = process.argv.slice(2);
const game = await nodeGame(process.argv[2]);
const result = {
  title: game.title,
  archives: game.archives.length,
  resources: game.index.size,
  formats: {},
  errors: [],
  decodedFrames: 0,
  jpegFrames: 0,
  models: 0,
};
for (const [ext, reader] of Object.entries({
  cst: readScene,
  cstl: readTranslation,
  fes: readFES,
  kcs: readKCS,
  hg3: (b) => new HG3(b),
})) {
  let count = 0;
  for (const name of game.names(ext)) {
    try {
      const parsed = await reader(await game.require(name));
      if (ext === 'kcs') {
        const vm = new KCSMachine(parsed);
        let at = 0;
        while (at < parsed.codeSize) at += vm.instruction(at).size;
      }
      if (ext === 'hg3' && args.includes('--decode'))
        for (const frame of parsed.frames) {
          if (frame.sections.has('img_jpg')) result.jpegFrames++;
          else {
            await parsed.decode(frame);
            result.decodedFrames++;
          }
        }
      count++;
    } catch (e) {
      result.errors.push({ name, error: e.message });
    }
  }
  result.formats[ext] = count;
}
if (args.includes('--decode'))
  for (const name of game.names('psz')) {
    try {
      new EmoteModel(await readPSB(await game.require(name)));
      result.models++;
    } catch (e) {
      result.errors.push({ name, error: e.message });
    }
  }
const host = new BootHost();
host.stopAt = new Set([0x1bf]);
const main = new KCSMachine(await readKCS(await game.require('main.kcs')), host);
main.run(5000000, () => host.stopped !== null);
result.boot = {
  steps: main.steps,
  request: host.stopped,
  natives: Object.fromEntries([...host.calls].map(([id, count]) => [id.toString(16), count])),
};
if (args.includes('--walk')) {
  const entry = args[args.indexOf('--walk') + 1];
  if (!entry) throw new Error('--walk needs a scene entry');
  const scenes = new Set(),
    movies = [],
    player = new ScenePlayer(
      game,
      { message: (message) => scenes.add(message.scene), movie: (name) => movies.push(name) },
      host.globals,
    );
  await player.start(entry);
  let steps = 0;
  try {
    while (!player.finished && ++steps < 100000) {
      await player.tick();
      player.advance();
      player.stage.frame += 100000;
    }
  } catch (e) {
    result.errors.push({ name: player.stack.at(-1)?.name, error: e.message });
  }
  result.walk = {
    entry,
    finished: player.finished,
    messages: player.sequence,
    steps,
    scenes: [...scenes],
    movies,
    unsupported: [...player.unsupported],
    stageUnsupported: [...player.stage.unsupported],
    scope: 'Headless command traversal; skips timing, media and pixel output',
  };
  if (!player.finished) process.exitCode = 1;
}
console.log(JSON.stringify(result, null, 2));
if (result.errors.length || !host.stopped) process.exitCode = 1;
