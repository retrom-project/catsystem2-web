// SPDX-License-Identifier: MPL-2.0
// Script ABI wrappers. Payloads belong to JS/VM memory, never to a PE arena.
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument, nativeDataFormat } from './data-text.mjs';
import { NativeSoundPacket } from './sound.mjs';
import { nativeEngineWord } from './engine-message.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export const NATIVE_M2_IDS = Object.freeze([
  ...Array.from({ length: 28 }, (_, i) => 906 + i),
  965,
  966,
  1025,
  1027,
  1028,
  1029,
  1030,
  1047,
  1048,
]);
const messages = new Map([
  [907, 526],
  [908, 527],
  [909, 528],
  [918, 535],
  [927, 541],
  [928, 542],
  [930, 544],
  [931, 545],
  [1047, 552],
  [1048, 550],
]);
const strings = new Map([
  [906, 524],
  [917, 533],
  [929, 543],
  [1027, 551],
]);
const dictionaryMessages = new Map([
  [913, 530],
  [916, 532],
  [921, 538],
  [966, 531],
]);
const decoded = (bytes) => new TextDecoder('shift_jis').decode(bytes ?? []);

export async function emoteNative(owner, id, args, machine, task) {
  const world = owner.world,
    a = (i) => nativeDataArgument(args, machine, i) >>> 0,
    done = () => nativeReply(2),
    value = (word) => nativeReply(1, word),
    format = () => decoded(nativeDataFormat(args, machine, world.runtime.services, 1)),
    send = (message, w = 0, l = 0, payload = machine) =>
      world.sendNativeEngine(a(0), task.id, message, w, l, {
        machine,
        payload,
        nativeSenderWorldID: task.id,
      }),
    textPacket = (text, size = 0) => {
      const packet = new NativeSoundPacket([], Math.max(128 + text.length * 2, size));
      packet.writeString(text, 64);
      return packet;
    };
  if (id === 925) return value(1);
  if ([922, 923, 932, 933].includes(id)) {
    await owner.command(id);
    return done();
  }
  if (messages.has(id)) {
    const message = messages.get(id),
      result = await send(message, 0, [907, 918, 927, 928, 931].includes(id) ? a(1) : 0);
    return id === 909 ? value(nativeEngineWord(result, 'M2 busy query')) : done();
  }
  if (strings.has(id)) {
    const packet = textPacket(format()),
      result = await send(strings.get(id), [906, 917].includes(id) ? a(2) : 0, 64, packet);
    return id === 1027 ? value(result ?? 0) : done();
  }
  if ([911, 912, 914, 915].includes(id)) {
    const named = id === 912 || id === 915,
      packet = textPacket(named ? format() : '');
    packet.store(4, a(named ? 2 : 1));
    await send(id < 914 ? 530 : 532, named ? 64 : 0, 4, packet);
    return done();
  }
  if (dictionaryMessages.has(id)) {
    const handle = a(1);
    if (!handle) return done();
    const message = dictionaryMessages.get(id),
      dictionary = world.runtime.handles.get(handle, 'dictionary');
    // A non-null empty map still clears the old body-variable list (538).
    if (id === 921) await send(539);
    for (const { key, value: word } of dictionary.ordered()) {
      const packet = textPacket(decoded(key));
      packet.store(4, word);
      await send(message, 64, message === 538 ? word : message === 531 ? 0 : 4, packet);
    }
    return done();
  }
  if (id === 910) {
    const packet = new NativeSoundPacket();
    await send(529, a(1), 4, packet);
    for (let i = 0; i < 3; i++) machine.store(a(i + 2), packet.load(4 + i * 4));
    return done();
  }
  if (id === 919) {
    const packet = new NativeSoundPacket([0, a(1), a(2), a(3)]);
    await send(536, 0, 4, packet);
    return done();
  }
  if (id === 920) {
    const packet = textPacket(format());
    await send(538, 64, a(2), packet);
    return done();
  }
  if (id === 924) {
    await send(540, a(2), a(1));
    return done();
  }
  if (id === 926) {
    await send(534, 0, a(1));
    return done();
  }
  if (id === 965) {
    const name = format();
    if (encodeCP932(name).length >= 64)
      throw new RangeError('M2 voice selector exceeds its 64-byte CP932 name');
    const packet = textPacket(name);
    // The public packet has a fixed 64-byte CP932 name, followed by two words.
    const bytes = packet.data.slice(64, 128);
    packet.data.fill(0);
    packet.data.set(bytes, 4);
    packet.store(68, a(2));
    packet.store(72, a(3));
    await send(547, 0, 4, packet);
    return done();
  }
  if (id === 1025) {
    await send(a(1) ? 548 : 549);
    return done();
  }
  if (id === 1028) {
    format(); // The original formats this argument even though its receiver ignores it.
    return value((await send(553)) ?? 0);
  }
  if (id === 1029 || id === 1030) {
    const found = await send(554, a(1), a(2));
    if (!found) return value(0);
    const hits = owner.hits;
    if (id === 1029) return value(hits.length);
    const hit = hits[a(3)];
    if (!hit) return value(0);
    machine.writeString(hit[0], a(4));
    if (hit[1] != null) machine.writeString(hit[1], a(5));
    return value(1);
  }
  throw new Error(`Unknown M2 script native ${id}`);
}
