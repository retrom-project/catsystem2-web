// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-cross-build-fes-context.json', import.meta.url)),
);
for (const build of golden.builds) {
  const code = Buffer.from(build.program, 'base64');
  const open = (initialize) =>
    modernParticleMessageWorld(
      build.profile,
      {
        'startup.xml': Buffer.from(build.startup),
        'scripts.int': kif([
          ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
          ['context-owner.kcs', code],
        ]),
        'scripts-loose/context-owner.kcs': code,
        'fes.int': kif([['context-state.fes', Buffer.from(build.source)]]),
        'fes-loose/context-state.fes': Buffer.from(build.source),
        'images.int': kif([]),
        'ptcl.int': kif([]),
        'scenes.int': kif([]),
      },
      { initialize, startup: parseXML(build.startup) },
    );
  for (const cold of [false, true])
    test(`own${build.version} primary Root FES metadata/owned save object/retirement${cold ? ' across independent cold' : ''}`, async () => {
      let world = await open(true),
        caller = await world.spawnScript('context-owner', { parent: world.root });
      const compare = (row) => {
        const m = caller.machine,
          handle = m.load(84),
          words = Array.from({ length: 6 }, (_, i) => m.load(128 + i * 4));
        if (words[4] === handle) words[4] = 'owned-file';
        assert.deepEqual(words, row.words);
        assert.equal(m.pc, row.pc);
        assert.equal(world.objects.objects.get(caller.id).exitCode, row.exitCode);
        assert.equal(world.runtime.handles.records.has(handle), row.fileAlive);
        assert.deepEqual(
          [...world.objects.objects.values()]
            .filter((r) => [15, 34].includes(r.kind))
            .map((r) => r.kind),
          row.remainingRecipients.map((r) => r.kind),
        );
        if (row.private0 !== null) assert.equal(m.load(160), row.private0);
      };
      try {
        for (const row of build.rows) {
          await world.objects.update(world.root, 700 + row.frame);
          compare(row);
          if (cold && row.frame === 0) {
            const id = caller.id,
              saved = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await open(false);
            await world.restore(saved);
            caller = world.runtime.scheduler.tasks.get(id);
            compare(row);
          }
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    });
  if (['74', '76'].includes(build.version))
    test(`own${build.version} unqualified nested Top keeps original target0 unwritten boundary`, async () => {
      const world = await open(true);
      try {
        const m = world.main.machine;
        m.writeString('separate Top', 2048);
        const reply = await world.runtime.native(
          'main',
          66,
          [1, world.nativeTaskID(world.main.id), 2048],
          m,
          world.main,
        );
        const top = world.resolveTaskID(reply.value, world.main.id);
        await world.spawnScript('context-owner', { parent: top });
        await assert.rejects(
          world.objects.update(top, 700),
          /FES initialization sound-task query has no initialized 32-bit output word/,
        );
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}
