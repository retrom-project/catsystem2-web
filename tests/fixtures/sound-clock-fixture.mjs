// SPDX-License-Identifier: MPL-2.0
// Authored PLV records with an explicit system clock and a deliberately
// unrelated AudioContext clock. No sound-device operation is synthesized.
import {
  NativeSound,
  NativeSoundPacket,
  NATIVE_SOUND_CONTROL as C,
} from '../../src/native/sound.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';

export function soundClockFixture(profile, clock) {
  const audio = { context: { currentTime: 23456 }, channels: new Map(), stop() {} },
    world = {
      profile,
      clock,
      audio,
      frame: 98765,
      configuration: new NativeConfiguration({ profile }),
      runtime: { handles: new NativeHandles() },
      base: () => ({
        message: () => {
          throw new Error('PLV test reached an unrelated Base message');
        },
      }),
      objects: {
        machine: () => {
          throw new Error('PLV test needs its explicit packet');
        },
      },
    },
    sound = new NativeSound(world),
    task = sound.create({ id: 13 });
  return {
    world,
    sound,
    task,
    send: (id, bank, value = 0, payload) =>
      task.message(
        [100, profile.startsWith('sdk-') ? id - 2 : id, bank, value],
        payload ? { payload } : {},
      ),
    setPLV(bank, values, step, start = 0xffffffff) {
      const control = task.controls[bank],
        bytes = new Uint8Array(values.length * 2),
        view = new DataView(bytes.buffer);
      values.forEach((value, i) => view.setUint16(i * 2, value, true));
      control.plv = bytes;
      control.word(C.hasPLV, 1);
      control.word(C.plvCount, values.length);
      control.word(C.plvStep, step);
      control.word(C.wallStart, start);
      return control;
    },
    queryPacket(count) {
      const packet = new NativeSoundPacket([], 144);
      packet.store(0, 16);
      packet.store(4, count);
      packet.data.fill(0xa5, 8);
      return packet;
    },
  };
}
