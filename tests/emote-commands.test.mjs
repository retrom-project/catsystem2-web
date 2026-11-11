// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSMachine, floatBits, formatNativeAt, encodeCP932 } from '../src/kcs.mjs';
import { NativeDictionary } from '../src/native/dictionary.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { emoteNative } from '../src/native/emote-commands.mjs';

function fixture() {
  const machine = new KCSMachine({ data: new Uint8Array(4096), stackSize: 4096, codeSize: 1 }),
    handles = new NativeHandles(),
    packets = [],
    owner = {
      hits: [
        ['front', 'face'],
        ['back', 'body'],
      ],
      command: async (id) => packets.push({ command: id }),
      world: {
        runtime: { handles, services: { formatBytes: formatNativeAt } },
        async sendNativeEngine(target, sender, message, w, l, context) {
          assert.deepEqual([target, sender], [72, 8]);
          assert.equal(context.machine, machine);
          const p = context.payload;
          if (message === 529) {
            p.store(l, floatBits(-3.5));
            p.store(l + 4, 17);
            p.store(l + 8, 0xfeed);
          }
          packets.push({
            message,
            w: [530, 531, 532, 538].includes(message) && w ? p.string(w) : w,
            l: [524, 533, 543, 551].includes(message) ? p.string(l) : l,
            word: [530, 532].includes(message) ? p.load(l) : undefined,
          });
          if (message === 534) machine.writeString('aa01,1,1,1', l);
          return [528, 551, 553, 554].includes(message) ? 1 : undefined;
        },
      },
    };
  return {
    machine,
    handles,
    packets,
    owner,
    call: (id, args) => emoteNative(owner, id, args, machine, { id: 8 }),
  };
}

test('M2 named parameters retain formatted CP932 and exact float words through the JS boundary', async () => {
  const { machine, packets, call } = fixture();
  machine.writeString('猫', 128);
  await call(912, [72, 128, floatBits(-0)]);
  await call(915, [72, 128, floatBits(1.25)]);
  await call(920, [72, 128, floatBits(-2)]);
  assert.deepEqual(
    packets.map(({ message, w, word }) => [message, w, word]),
    [
      [530, '猫', floatBits(-0)],
      [532, '猫', floatBits(1.25)],
      [538, '猫', undefined],
    ],
  );
});

test('M2 dictionary replacement clears once, then visits CP932 byte order; null and empty differ', async () => {
  const { handles, packets, call } = fixture(),
    dictionary = new NativeDictionary(),
    handle = handles.add('dictionary', dictionary);
  await call(921, [72, 0]);
  assert.equal(packets.length, 0);
  await call(921, [72, handle]);
  assert.deepEqual(
    packets.map(({ message }) => message),
    [539],
  );
  dictionary.set(encodeCP932('z'), 3);
  dictionary.set(encodeCP932('猫'), 5);
  dictionary.set(encodeCP932('a'), 7);
  await call(921, [72, handle]);
  assert.deepEqual(
    packets.slice(1).map(({ message, w, l }) => [message, w, l]),
    [
      [539, 0, 0],
      [538, 'a', 7],
      [538, 'z', 3],
      [538, '猫', 5],
    ],
  );
});

test('M2 output vectors, strings, hit names and control codes write through only their destinations', async () => {
  const { machine, call } = fixture();
  machine.bytes(500, 80).fill(0xa5);
  assert.deepEqual(await call(910, [72, 2, 512, 520, 532]), { control: 2 });
  assert.deepEqual(
    [512, 520, 532].map((at) => machine.load(at)),
    [floatBits(-3.5), 17, 0xfeed],
  );
  assert.equal(machine.load(516), 0xa5a5a5a5);
  assert.deepEqual(await call(925, []), { control: 1, value: 1 });
  assert.deepEqual(await call(909, [72]), { control: 1, value: 1 });
  assert.deepEqual(await call(926, [72, 640]), { control: 2 });
  assert.equal(machine.string(640), 'aa01,1,1,1');
  assert.deepEqual(await call(1029, [72, 0, 0]), { control: 1, value: 2 });
  assert.deepEqual(await call(1030, [72, 0, 0, 1, 768, 832]), { control: 1, value: 1 });
  assert.equal(machine.string(768), 'back');
  assert.equal(machine.string(832), 'body');
  const before = machine.bytes(768, 128).slice();
  assert.deepEqual(await call(1030, [72, 0, 0, 2, 768, 832]), { control: 1, value: 0 });
  assert.deepEqual(machine.bytes(768, 128), before);
});
