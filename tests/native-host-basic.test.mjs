// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { registryDecodeANSI } from '../src/native/registry-codepage.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-host-basic-legacy-golden.json', import.meta.url)),
);
for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
]) {
  test(`${profile} local SYSTEMTIME words and modal arguments match own fixed-frame GCALLs`, async () => {
    const world = await dataWorld(profile);
    let current, actualBox, entered, ack;
    world.host.nativeWindowAction = (action, owner) => {
      assert.equal(owner, world);
      actualBox = action;
      if (current.heldUntilAcknowledged) {
        entered.resolve();
        return ack.promise;
      }
      return current.answer;
    };
    try {
      for (const row of golden.cases) {
        current = row;
        actualBox = null;
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
        if (row.epoch !== undefined)
          world.clock.restore({
            elapsed: { numerator: 0n, denominator: 1n },
            utcOrigin: { numerator: BigInt(row.epoch), denominator: 1n },
          });
        if (row.input) {
          machine.bytes(256, row.input.source.length).set(row.input.source);
          for (const [at, bytes] of row.input.writes ?? [])
            machine.bytes(at, bytes.length).set(bytes);
          for (const [at, word] of row.input.words ?? []) machine.store(at, word);
        }
        machine.floor = machine.fp = 3584;
        machine.sp = 3588 + count * 4;
        machine.store(3584, 0x93deff25);
        row.args.forEach((word, i) => machine.store(3588 + i * 4, word));
        let result;
        if (row.heldUntilAcknowledged) {
          entered = Promise.withResolvers();
          ack = Promise.withResolvers();
          let complete = false;
          const pending = world.runtime.scheduler.execute(task).then((value) => {
            complete = true;
            return value;
          });
          await entered.promise;
          await Promise.resolve();
          assert.equal(complete, false);
          ack.resolve(1);
          result = await pending;
        } else result = await world.runtime.scheduler.execute(task);
        assert.equal(result.status, 'halted');
        assert.equal(machine.sp, 3588);
        assert.equal(machine.load(3584), 0x93deff25);
        if (row.id === 11)
          assert.deepEqual(
            row.args.slice(0, 7).map((at) => [at, [...machine.bytes(at, 4)]]),
            row.outputs,
          );
        else
          assert.deepEqual(actualBox, {
            type: 'script-message-box',
            caption: row.box.caption,
            message: registryDecodeANSI(Uint8Array.from(row.box.messageBytes)),
          });
      }
    } finally {
      ack?.resolve(0);
      await world.close({ flushFiles: false });
    }
  });

  test(`${profile} local date cold restore preserves the clock and outputs without another query`, async () => {
    const script = kcsProgram([
      ...[256, 260, 264, 268, 272, 276, 280].map((at) => [37, at]),
      [43, 11, 28],
      [37, 240],
      [43, 71, 4],
      [59],
    ]);
    const first = await dataWorld(profile, { 'case.kcs': script }, { initialize: false });
    const fresh = await dataWorld(profile, { 'case.kcs': script }, { initialize: false });
    try {
      first.clock.restore({
        elapsed: { numerator: 0n, denominator: 1n },
        utcOrigin: { numerator: BigInt(Date.UTC(70000, 0, 1)), denominator: 1n },
      });
      await first.initialize('case.kcs');
      const words = [256, 260, 264, 268, 272, 276, 280].map((at) => first.main.machine.load(at));
      assert.equal(words[0], 70000 & 0xffff);
      const dto = structuredClone(first.snapshot());
      let queries = 0;
      fresh.runtime.services.date = () => {
        queries++;
        throw new Error('cold date query replay');
      };
      await fresh.restore(structuredClone(dto));
      assert.deepEqual(fresh.snapshot(), dto);
      assert.deepEqual(
        [256, 260, 264, 268, 272, 276, 280].map((at) => fresh.main.machine.load(at)),
        words,
      );
      assert.equal(queries, 0);
    } finally {
      await first.close({ flushFiles: false });
      await fresh.close({ flushFiles: false });
    }
  });
}
