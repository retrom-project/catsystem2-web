// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mutableDataWorld } from './fixtures/mutable-data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk63-string-bank-consumers.json', import.meta.url)),
);
const project = (machine, projection) => ({
  words: projection.words.map((at) => machine.load(at)),
  spans: projection.spans.map(({ at, size }) =>
    Buffer.from(machine.bytes(at, size)).toString('base64'),
  ),
});
for (const coldAt of [null, 0, 1, 2, 3, 4, 5, 6, 7])
  test(
    'SDK63 parsed CP932/string-bank feeds independent Script/Scene consumers' +
      (coldAt === null ? '' : ' with cold' + coldAt),
    async () => {
      const resources = new Map(
          fixture.inputs.map(({ name, data }) => [
            name,
            new Uint8Array(Buffer.from(data, 'base64')),
          ]),
        ),
        open = (initialize) =>
          mutableDataWorld(fixture.profile, resources, {
            startup: fixture.startup,
            initialize,
          });
      let { world } = await open(true),
        parent;
      try {
        parent = await world.spawnScript('resource63.kcs', { initialExecute: false });
        for (let frame = 0; frame < fixture.phases.length; frame++) {
          await world.objects.update(parent.id, frame);
          const actual = { frame, ...project(parent.machine, fixture.projections) };
          if (frame === 3 || frame === 4) {
            const childID = world.resolveTaskID(parent.machine.load(220), parent.id),
              child = world.runtime.scheduler.tasks.get(childID);
            assert(child, 'normal factory/Main143 child owns a parsed VM');
            assert.equal(child.context.stringBank, parent.context.stringBank);
            assert.equal(child.context.stringBankInherited, true);
            actual.child = project(child.machine, fixture.childProjection);
            actual.bankShared = true;
            assert.equal(
              child.machine.string(frame === 3 ? 640 : 704),
              frame === 3 ? '猫の本文A' : '犬の本文B',
              'bank-derived filename reaches the actual Scene parser/text consumer',
            );
          }
          assert.deepEqual(actual, fixture.rows[frame]);
          if (frame >= 6)
            assert.equal(
              world.runtime.scheduler.tasks.has(
                world.resolveTaskID(parent.machine.load(220), parent.id),
              ),
              false,
              'normal child retirement leaves the parent string-bank owner alive',
            );
          if (frame === coldAt) {
            const id = parent.id,
              checkpoint = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            ({ world } = await open(false));
            await world.restore(checkpoint);
            parent = world.runtime.scheduler.tasks.get(id);
            assert(parent);
            assert.deepEqual(project(parent.machine, fixture.projections), {
              words: actual.words,
              spans: actual.spans,
            });
          }
        }
        assert.equal(parent.machine.load(508), fixture.marker);
        assert.equal(parent.machine.string(1664), 'string-b.cst');
        assert.equal(parent.machine.load(200), 0, 'initialized missing entry returns zero');
        assert.deepEqual([...parent.machine.bytes(2048, 2)], [0, 0xa5]);
        const bankID = parent.context.stringBank,
          bank = world.runtime.handles.get(bankID, 'string-bank');
        assert.equal(bank.get(7), 'string-b.cst');
        assert.equal(bank.get(8), '');
        await world.close({ flushFiles: false });
        assert.throws(() => world.runtime.handles.get(bankID, 'string-bank'), /released/);
      } finally {
        await world.close({ flushFiles: false });
      }
    },
  );
