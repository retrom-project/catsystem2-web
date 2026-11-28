// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram, kif } from './helpers.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-cross-build-selected-bank.json', import.meta.url)),
);
for (const b of fixture.builds) {
  const code = Buffer.from(b.program, 'base64');
  const open = (initialize) =>
    modernParticleMessageWorld(
      b.profile,
      {
        'startup.xml': Buffer.from(b.startup),
        'scripts.int': kif([
          ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
          ['context-owner.kcs', code],
        ]),
        'scripts-loose/context-owner.kcs': code,
        'fes.int': kif([['context-state.fes', Buffer.from(b.source)]]),
        'fes-loose/context-state.fes': Buffer.from(b.source),
        'images.int': kif([]),
        'ptcl.int': kif([]),
        'scenes.int': kif([]),
      },
      { startup: parseXML(b.startup), initialize },
    );
  for (const coldAt of [null, 0, ...(['74', '76'].includes(b.version) ? [1] : [])])
    test(`own${b.version} initialized selected FES bank/CP932 owner consumer${coldAt === null ? ' normal' : ' independent cold ' + coldAt}`, async () => {
      let w = await open(true),
        caller = await w.spawnScript('context-owner', { parent: w.root });
      const check = (row) => {
        const m = caller.machine,
          words = Array.from({ length: 6 }, (_, i) => m.load(128 + i * 4));
        if (words[4] === m.load(84)) words[4] = 'owned-file';
        assert.deepEqual(words, row.words);
        assert.equal(m.pc, row.pc);
        assert.equal(w.objects.objects.get(caller.id).exitCode, row.exitCode);
        assert.deepEqual(
          [...m.bytes(1824, 32)],
          row.string,
          'full initialized CP932 span including two terminating bytes',
        );
        if (row.transfer) {
          assert.deepEqual(
            Array.from({ length: 5 }, (_, i) => m.load(1600 + i * 4)),
            row.transfer,
          );
          assert.deepEqual(
            Buffer.from(m.bytes(2048, 2048)),
            Buffer.from(row.bank, 'base64'),
            'all512 selected words copied through real CSS entry',
          );
        }
      };
      try {
        for (const row of b.rows) {
          await w.objects.update(w.root, 700 + row.frame);
          check(row);
          if (row.frame === coldAt) {
            const id = caller.id,
              state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
            await w.close({ flushFiles: false });
            w = await open(false);
            await w.restore(state);
            caller = w.runtime.scheduler.tasks.get(id);
            check(row);
          }
        }
        assert.equal(w.runtime.handles.records.has(caller.machine.load(84)), false);
        assert.equal(
          [...w.objects.objects.values()].filter((r) => [15, 34].includes(r.kind)).length,
          0,
        );
      } finally {
        await w.close({ flushFiles: false });
      }
    });
}
for (const group of ['strings', 'bank'])
  test(`own63 finite original ${group} data shape remains distinct from native cleanup qualification`, async () => {
    const f = fixture.standalone63,
      g = f[group],
      code = Buffer.from(g.program, 'base64'),
      w = await modernParticleMessageWorld(
        'rebellions-jp-engine-2.6.1.63',
        {
          'startup.xml': Buffer.from(f.startup),
          'standalone.kcs': code,
          'scripts.int': kif([
            ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
            ['standalone.kcs', code],
          ]),
          'fes.int': kif([['context-state.fes', Buffer.from(g.source ?? '')]]),
          'fes-loose/context-state.fes': Buffer.from(g.source ?? ''),
        },
        { startup: parseXML(f.startup) },
      );
    try {
      const t = await w.spawnScript('standalone.kcs');
      await w.objects.update(w.root, 703);
      if (group === 'strings')
        assert.deepEqual(
          [544, 608].map((at) => [...t.machine.bytes(at, 32)]),
          g.spans,
        );
      else {
        assert.deepEqual(
          [160, 1600, 1604, 1608, 1612, 1616].map((at) => t.machine.load(at)),
          g.values,
        );
        assert.deepEqual(Buffer.from(t.machine.bytes(2048, 2048)), Buffer.from(g.bytes, 'base64'));
      }
    } finally {
      await w.close({ flushFiles: false });
    }
  });
