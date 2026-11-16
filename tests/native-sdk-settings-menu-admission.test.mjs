// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { EngineHost } from '../src/host.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const rawWords = [0, 1, 0xfffffff9, 0x80000000];
const sentinel = 0x24681357;
const callerProgram = kcsProgram([
  [37, sentinel],
  ...rawWords.flatMap((word) => [
    [37, word],
    [43, 393, 4],
  ]),
  [37, 73],
  [38, [0x13, 512]],
  [59],
]);

function declaration(profile) {
  const entry = nativeABI(profile).tables.main.entries[393];
  assert.equal(entry.status, 'recovered');
  assert.equal(entry.name, 'environment.enableSettingsMenu');
  assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[393].signature);
  assert.equal(entry.signature.argumentWords, 1);
  assert.deepEqual(entry.controlCodes, [2]);
  assert.equal(entry.signature.result.kind, 'void');
  assert.equal(entry.signature.resultWritten, false);
  if (profile === profiles[0]) {
    assert.match(entry.evidence, /SDK-2\.6\.1\.74-main393-full-wrapper/);
    assert.notEqual(entry.evidence, nativeABI(profiles[1]).tables.main.entries[393].evidence);
    for (const id of [428, 361])
      assert.equal(nativeABI(profile).tables.main.entries[id].status, 'unknown');
  }
  assert.equal(nativeABI(profile).tables.main.entries[467].status, 'unknown');
}

for (const profile of profiles) {
  test(`${profile} settings-menu GCALL submits raw boolean state through its World and Host`, async () => {
    const world = await dataWorld(profile, { 'caller.kcs': callerProgram });
    try {
      const requests = [],
        app = {
          onNativeMenuChanged(id, enabled) {
            assert.equal(
              world.menu.get(id),
              enabled,
              'World commits desired state before the Host request',
            );
            requests.push([id, enabled]);
          },
        },
        engineHost = new EngineHost(app),
        originalHost = world.host;
      originalHost.nativeMenuChanged = engineHost.nativeMenuChanged.bind(engineHost);
      const parent = world.objects.objects.get(world.main.id),
        callerID = await world.objects.create({
          kind: 12,
          parent: parent.id,
          name: 'settings-menu',
        }),
        record = world.objects.objects.get(callerID);
      await record.implementation.loadScript('caller.kcs');
      const caller = record.implementation.task,
        machine = caller.machine,
        initialSP = machine.sp,
        calls = [],
        native = world.runtime.native;
      assert.strictEqual(world.host, originalHost);
      assert.strictEqual(world.runtime.scheduler.tasks.get(callerID), caller);
      assert.strictEqual(record.context, caller.context);
      machine.bytes(800, 8).fill(0xa5);
      world.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 393)
          calls.push({ args: [...args[0]].map((word) => word >>> 0), reply });
        return reply;
      };
      await world.runtime.scheduler.execute(caller);
      // Registration is checked after real Script GCALL dispatch: the SDK red
      // must be an unknown-slot failure, not a metadata-only assertion.
      declaration(profile);
      assert.deepEqual(
        calls.map((call) => call.args),
        rawWords.map((word) => [word]),
      );
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: 4 }, () => ({ control: 2 })),
      );
      assert.deepEqual(requests, [
        [0x77, false],
        [0x77, true],
        [0x77, true],
        [0x77, true],
      ]);
      assert.deepEqual([...world.menu], [[0x77, true]]);
      assert.equal(machine.load(512), 73, 'Guest execution continued after all four void requests');
      assert.equal(machine.halted, true);
      assert.equal(
        machine.pop(),
        sentinel,
        'No native result was pushed above the original sentinel',
      );
      assert.equal(machine.sp, initialSP);
      assert.deepEqual([...machine.bytes(800, 8)], Array(8).fill(0xa5));
    } finally {
      await world.close();
    }
  });
}
