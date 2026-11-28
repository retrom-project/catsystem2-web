// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-registry-legacy-golden.json', import.meta.url)),
);
for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
]) {
  test(`${profile} Registry fixed frames, ANSI bytes and independent persistent hive match own GCALLs`, async () => {
    const platform = new Map();
    let reads = 0;
    const storage = {
      read: async () => null,
      write: async () => true,
      async readPlatform(name) {
        assert.equal(name, 'windows-hkcu');
        reads++;
        return platform.get(name)?.slice() ?? null;
      },
      async writePlatform(name, bytes) {
        assert.equal(name, 'windows-hkcu');
        platform.set(name, bytes.slice());
      },
    };
    const files = { 'case.kcs': kcsProgram([[43, 0, 0], [59]]) };
    let world = await dataWorld(profile, files, { storage });
    try {
      for (const [index, row] of golden.cases.entries()) {
        const task = world.main;
        task.status = 'ready';
        task.io = null;
        const count = row.declared ?? row.args.length;
        const machine = (task.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, row.id, count * 4], [59]])),
          { native: (id, args, vm) => world.runtime.scheduler.native(task, id, args, vm) },
        ));
        machine.memory.fill(0xa5);
        machine.shared.fill(0x93);
        for (const [address, text] of row.strings) {
          const bytes = encodeCP932(text);
          machine.bytes(address, bytes.length + 1).set([...bytes, 0]);
        }
        for (const [address, bytes] of row.write ?? [])
          machine.bytes(address, bytes.length).set(bytes);
        machine.floor = machine.fp = 3584;
        machine.sp = 3588 + count * 4;
        machine.store(3584, 0x9ec633a5);
        row.args.forEach((word, i) => machine.store(3588 + i * 4, word));
        assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted', row.name);
        assert.equal(machine.load(3584), 0x9ec633a5, row.name);
        assert.equal(machine.sp, 3592, row.name);
        assert.equal(machine.load(3588), row.result, row.name);
        assert.deepEqual(
          row.inspect.map(([address, count]) => [address, [...machine.bytes(address, count)]]),
          row.outputs,
          row.name,
        );
        assert.equal(world.platformRegistry.handles.size, 0, row.name);
        if ([27, 70, 90].includes(index)) {
          await world.close({ flushFiles: false });
          world = await dataWorld(profile, files, { storage });
          assert.equal(world.platformRegistry, null);
        }
      }
      assert.equal(reads, 4, 'each independent World loads the persisted hive on its first GCALL');
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
