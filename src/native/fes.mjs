// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeEngineWord, NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';

export const NATIVE_FES_IDS = Object.freeze([
  0x1bf, 0x1c0, 0x1c1, 0x1c2, 0x1c3, 0x1c4, 0x1c5, 0x1c6, 0x276, 0x277, 0x278, 0x285, 0x286, 0x287,
  0x289, 0x28a, 0x298, 0x299, 0x29a, 0x29b, 0x29c, 0x2e2, 0x372, 0x373,
]);

function byteMemory(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    written = new Set();
  return {
    load: (address) => view.getUint32(address, true),
    store: (address, value) => {
      view.setUint32(address, value >>> 0, true);
      written.add(address);
    },
    written: (address) => written.has(address),
    bytes: (address, size) => data.subarray(address, address + size),
    string: (address) => {
      const end = data.indexOf(0, address);
      if (end < 0) throw new Error('Unterminated FES message string');
      return new TextDecoder('shift_jis').decode(data.subarray(address, end));
    },
  };
}
function notification(event, name, index) {
  const key = encodeCP932(name),
    text = encodeCP932(event);
  if (key.length > 31)
    throw new Error('Native FES notification object name exceeds its 32-byte stack field');
  const data = new Uint8Array(64 + text.length + 1),
    view = new DataView(data.buffer);
  data.set(key, 16);
  view.setUint32(48, index >>> 0, true);
  data.set(text, 64);
  return {
    pointer: name ? 16 : 0,
    event: 64,
    memory: byteMemory(data),
  };
}

function stringsPacket(values, start = 16) {
  const encoded = values.map((text) => Uint8Array.from([...encodeCP932(text), 0])),
    data = new Uint8Array(start + encoded.reduce((n, bytes) => n + bytes.length, 0)),
    addresses = [];
  let at = start;
  for (const bytes of encoded) {
    addresses.push(at);
    data.set(bytes, at);
    at += bytes.length;
  }
  return { addresses, memory: byteMemory(data) };
}

async function persistFESBank(id, [handle, tag, target], task, world) {
  const reply = (value) => nativeReply(1, value);
  if (!handle) return reply(0);
  const file = world.runtime.handles.get(handle, 'global-file'),
    send = (message, size = 0, address = 0, payload) =>
      world.sendNativeEngine(target, task.id, message, size, address, { payload }),
    address = 4;
  if (id === 0x28a) {
    const bytes = file.read(tag);
    if (bytes === null) return reply(0);
    const packet = new Uint8Array(address + bytes.length);
    packet.set(bytes, address);
    await send(344, bytes.length, address, byteMemory(packet));
    return reply(1);
  }
  const size = nativeEngineWord(await send(343), 'FES save entry size');
  if (!size) return reply(0);
  if (size > 0x10000000) throw new RangeError('FES save entry exceeds the save size limit');
  const packet = new Uint8Array(address + size),
    written = nativeEngineWord(
      await send(343, size, address, byteMemory(packet)),
      'FES save entry bytes written',
    );
  if (written > size) throw new RangeError('FES save entry exceeds its allocated buffer');
  file.write(tag, packet.subarray(address, address + written));
  return reply(1);
}

export function nativeFES(id, args, machine, task, world) {
  const count = new Map([
    [0x1bf, 2],
    [0x1c0, 1],
    [0x1c1, 2],
    [0x1c2, 2],
    [0x1c3, 2],
    [0x1c4, 1],
    [0x1c5, 1],
    [0x1c6, 1],
    [0x276, 4],
    [0x277, 4],
    [0x278, 3],
    [0x285, 3],
    [0x286, 2],
    [0x287, 2],
    [0x289, 3],
    [0x28a, 3],
    [0x298, 3],
    [0x299, 1],
    [0x29a, 1],
    [0x29b, 1],
    [0x29c, 1],
    [0x2e2, 3],
    [0x372, 3],
    [0x373, 2],
  ]).get(id);
  if (count === undefined) return undefined;
  if (args.length !== count)
    throw new Error(`KCS FES native 0x${id.toString(16)} expects ${count} arguments`);
  if (id === 0x289 || id === 0x28a) return persistFESBank(id, args, task, world);
  const own = world.objects.objects.get(task.id),
    done = () => nativeReply(2),
    value = (n) => nativeReply(1, nativeEngineWord(n, `FES native 0x${id.toString(16)}`)),
    send = (message, w = 0, l = 0, context = {}) =>
      world.sendNativeEngine(args[0], task.id, message, w, l, context),
    format = (index) => world.runtime.services.format(args[index], machine);
  if (id === 0x1c5) {
    own.exitCode = args[0] | 0;
    return done();
  }
  if (id === 0x1c6) {
    machine.writeString(own.context.contextName || '', args[0]);
    return done();
  }
  if (id === 0x1c4)
    return Promise.resolve(send(23)).then((result) =>
      value(result === NATIVE_UNWRITTEN_WORD ? -1 : result),
    );
  if (id === 0x372 || id === 0x373) {
    const name = format(1);
    if (encodeCP932(name).length > 255)
      throw new Error('Native FES word name exceeds its 256-byte stack field');
    const packet = stringsPacket([name]);
    return Promise.resolve(
      send(id === 0x372 ? 352 : 351, packet.addresses[0], id === 0x372 ? args[2] : 0, {
        payload: packet.memory,
      }),
    ).then(() => {
      if (id === 0x372) return done();
      if (!packet.memory.written(0))
        throw new Error('Native FES named word query has an unwritten output pointer');
      return value(packet.memory.load(0));
    });
  }
  if (id === 0x276) {
    const packet = notification(format(1), format(2), args[3]);
    return Promise.resolve(
      send(337, packet.pointer, packet.event, { payload: packet.memory }),
    ).then(done);
  }
  if (id === 0x277) {
    const name = format(2),
      bytes = encodeCP932(name);
    if (bytes.length > 31)
      throw new Error('Native dynamic FES name exceeds its 32-byte stack field');
    const data = new Uint8Array(40),
      memory = byteMemory(data);
    data.set(bytes, 4);
    memory.store(36, args[3]);
    return Promise.resolve(send(338, 4, args[1], { payload: memory })).then(done);
  }
  if (id === 0x278) {
    // Both pinned wrappers expand argv[1] twice; argv[2] is not read.
    const packet = stringsPacket([format(1), format(1)]);
    return Promise.resolve(
      send(339, packet.addresses[0], packet.addresses[1], { payload: packet.memory }),
    ).then(done);
  }
  if (id >= 0x285 && id <= 0x287)
    return Promise.resolve(
      send(
        id - 0x285 + 340,
        id === 0x287 ? 0 : args[1],
        id === 0x285 ? args[2] : id === 0x287 ? args[1] : 0,
      ),
    ).then((result) => (id === 0x286 ? value(result) : done()));
  if (id === 0x298 || id === 0x2e2) {
    const packet = stringsPacket([format(1)]);
    return Promise.resolve(
      send(id === 0x298 ? 345 : 350, packet.addresses[0], args[2], { payload: packet.memory }),
    ).then(done);
  }
  if (id === 0x299 || id === 0x29a)
    return Promise.resolve(
      send(id === 0x299 ? 346 : 347, 0, 0, { nativeVariableContextKey: task.id }),
    ).then(done);
  if (id === 0x29b || id === 0x29c)
    return Promise.resolve(send(id === 0x29b ? 348 : 349)).then((result) =>
      id === 0x29b ? value(result) : done(),
    );
  if (id === 0x1bf) {
    const packet = stringsPacket([format(1)]);
    return (async () => {
      await send(331, 0, task.context.variableBank || 0);
      await send(332, 0, packet.addresses[0], { payload: packet.memory });
      return done();
    })();
  }
  if (id === 0x1c0) return Promise.resolve(send(333)).then(done);
  if (id === 0x1c1) return Promise.resolve(send(334, 0, args[1])).then(done);
  if (id === 0x1c2) {
    const packet = stringsPacket([format(1)]);
    return Promise.resolve(send(335, 0, packet.addresses[0], { payload: packet.memory })).then(
      (result) => value(result === NATIVE_UNWRITTEN_WORD ? 0 : result),
    );
  }
  if (id === 0x1c3) return Promise.resolve(send(336, 0, args[1])).then(done);
  return undefined;
}
