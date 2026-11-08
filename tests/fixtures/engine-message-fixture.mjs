// SPDX-License-Identifier: MPL-2.0
import { NativeObjects } from '../../src/native/objects.mjs';
import { NativeEngineMessages, nativeTaskKeyOrder } from '../../src/native/engine-message.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';

export const messageMemoryBase = 0x30010000;
export function messageMemory() {
  const data = new Uint8Array(65536),
    memory = {
      data,
      bytes(address, size) {
        const offset = address - messageMemoryBase;
        if (!Number.isInteger(offset) || offset < 0 || offset + size > data.length)
          throw new RangeError('Authored task-message memory range is not mapped');
        return data.subarray(offset, offset + size);
      },
      load(address) {
        const bytes = this.bytes(address, 4);
        return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
      },
    };
  const narrow = encodeCP932('authored日本語\0');
  data.set(narrow, 0);
  new DataView(data.buffer).setUint32(256, 0x12345678, true);
  const wide = 'wide日本語';
  for (let i = 0; i < wide.length; i++) {
    data[128 + i * 2] = wide.charCodeAt(i) & 255;
    data[129 + i * 2] = wide.charCodeAt(i) >>> 8;
  }
  // Embedded MSG13 packet for the special whole-tree traversal messages.
  new Uint32Array(data.buffer, 512, 6).set([99, 88, 13, 0, 0, 0]);
  data.set(encodeCP932('later\0'), 600);
  return memory;
}

export function engineMessageWorld(profile) {
  const files = new Map(),
    world = {
      profile,
      root: null,
      objects: new NativeObjects(),
      runtime: { scheduler: { tasks: new Map() } },
      host: {},
      storage: {
        write: async (name, bytes) => {
          files.set(name.replace(/^\.\//, ''), bytes.slice());
          return true;
        },
      },
    };
  const messages = new NativeEngineMessages(world);
  world.messages = messages;
  world.objects.identity = ({ parent }) =>
    parent === null ? { nativeID: 0, namespace: null } : messages.creation(parent);
  world.objects.releaseIdentity = (record) => messages.release(record);
  world.objects.unregisterIdentity = (record) => messages.unregister(record);
  world.objects.pruneRoutes = (record) => messages.pruneNullRoutes(record);
  world.objects.notify = (...args) => messages.send(...args);
  world.objects.register(0, (record) => messages.base(record));
  world.objects.register(1, (record, _, options) => messages.root(record, options));
  world.objects.register(11, (record) => messages.base(record));
  world.objects.register(13, (record) => messages.base(record));
  return { world, messages, files };
}

export async function engineMessageFixture(profile) {
  const fixture = engineMessageWorld(profile),
    { world } = fixture;
  world.root = await world.objects.create({ kind: 1, name: 'root' });
  const main = await world.objects.create({ kind: 0, parent: world.root, name: 'main' });
  await world.objects.create({ kind: 0, parent: main, name: 'child' });
  const nested = await world.objects.create({ kind: 1, parent: world.root, name: 'nested' });
  const inner = await world.objects.create({ kind: 0, parent: nested, name: 'inner' });
  await world.objects.create({ kind: 0, parent: inner, name: 'leaf' });
  return { ...fixture, main, nested, inner };
}

export async function prepareEngineMessageCase(fixture, operations) {
  for (const descriptor of operations[0].prepare ?? [])
    await fixture.world.objects.create(descriptor);
  fixture.visits = [];
  if (!operations[0].dynamic) return;
  const originalInvoke = fixture.messages.invoke.bind(fixture.messages);
  fixture.messages.invoke = async (record, packet, ...rest) => {
    if (packet[2] === 222) fixture.visits.push(record.id);
    return originalInvoke(record, packet, ...rest);
  };
  const record = fixture.world.objects.objects.get(4),
    original = record.implementation.message;
  let added = false;
  record.implementation.message = async (words, context) => {
    const reply = await original(words, context);
    if (words[1] === 222 && !added) {
      added = true;
      await fixture.messages.dispatchNative(4, 3, 1, 0, messageMemoryBase + 600, context);
      const earlier = await fixture.world.objects.create({
        kind: 0,
        parent: null,
        nativeID: 2,
        namespace: 0,
        name: 'earlier',
      });
      await fixture.messages.dispatchNative(3, 3, 2, 2, earlier, context);
      context.nativeUnhandled = true;
    }
    return reply;
  };
}

export function engineMessageModelState(fixture) {
  return [...fixture.world.objects.objects.values()].map((record) => {
    const state = {
      worldID: record.id,
      nativeID: record.nativeID,
      parent: record.parent,
      flags: record.flags >>> 0,
      exitCode: record.exitCode >>> 0,
      destroyRequested: Number(!!record.destroyRequested),
      userValue: record.userValue >>> 0,
      routes: [...fixture.messages.registry(record)].sort((a, b) => nativeTaskKeyOrder(a[0], b[0])),
    };
    if (record.kind === 1)
      Object.assign(state, {
        input: fixture.world.objects.objects.get(record.implementation.input).nativeID,
        sound: fixture.world.objects.objects.get(record.implementation.sound).nativeID,
        caption: record.implementation.caption,
        field: record.implementation.field,
        sharedPointer: record.sharedDataAddress,
        sharedData: [...fixture.messages.sharedBytes(record)],
      });
    return state;
  });
}

export function* engineMessageCases(profile) {
  const sdk = profile.startsWith('sdk-'),
    first = sdk ? 30 : 32;
  for (const sender of [0, 3, 4, 5, 6, 8, 9])
    for (const target of [0, 1, 2, 3, 4, 5, 8, 99])
      for (const message of [0, 3, 7, 8, 13, 17, 23, 24, 29, 99])
        for (const flags of [0, 1])
          yield [{ sender, target, message, w: 37, l: 0x87654321, flags }];
  for (const sender of [0, 3, 5, 6, 8])
    for (const query of [0, 1, 2, 3, 4, 5, 99])
      yield [{ sender, target: sender >= 5 ? 5 : 0, message: first + 1, w: query, l: 0, flags: 0 }];
  for (const target of [0, 5]) {
    for (const message of [first + 2, first + 3, first + 7, first + 8])
      yield [{ sender: 3, target, message, w: 25, l: 31, flags: 0 }];
    yield [
      { sender: 3, target, message: first, w: 9, l: messageMemoryBase + 256, flags: 0 },
      {
        sender: 3,
        target,
        message: first + 5,
        w: 0,
        l: messageMemoryBase + (sdk ? 0 : 128),
        flags: 0,
      },
      { sender: 3, target, message: first + 6, w: 0, l: messageMemoryBase + 1024, flags: 0 },
    ];
  }
  for (const sender of [0, 3, 4, 5, 6])
    for (const target of [0, 3, 5, 99])
      for (const message of [11, 12])
        for (const w of [0, 1, 11, 13, 99])
          yield [{ sender, target, message, w, l: messageMemoryBase + 512, flags: 0 }];
  for (const target of [0, 3, 5])
    for (const message of [15, 16])
      yield [{ sender: 3, target, message, w: 0, l: messageMemoryBase + 2048, flags: 0 }];
  for (const target of [0, 3, 5]) {
    const child = target === 0 ? 1 : target === 3 ? 4 : 0;
    yield [{ sender: 3, target, message: 2, w: child, l: 0, flags: 0 }];
  }
  for (const sender of [3, 6]) {
    const owner = sender === 3 ? 0 : 5,
      nativeID = sender === 3 ? 6 : 4;
    yield [
      { sender, target: owner, message: 1, w: 0, l: messageMemoryBase, flags: 0 },
      { sender, target: nativeID, message: 13, w: 0, l: 0, flags: 0 },
      { sender, target: owner, message: first + 1, w: nativeID, l: 0, flags: 0 },
    ];
  }
  yield [
    { sender: 3, target: 3, message: 1, w: 1, l: messageMemoryBase, flags: 0 },
    { sender: 3, target: 6, message: first + 2, w: 0, l: 0, flags: 0 },
    { sender: 10, target: 0, message: 13, w: 0, l: 0, flags: 0 },
  ];
  yield [
    {
      prepare: [{ kind: 0, parent: null, nativeID: 7, namespace: 0, name: 'detached' }],
      sender: 0,
      target: 3,
      message: 2,
      w: 7,
      taskL: 10,
      flags: 0,
    },
    { sender: 0, target: 7, message: 13, w: 0, l: 0, flags: 0 },
    { sender: 3, target: 7, message: 13, w: 0, l: 0, flags: 0 },
  ];
  if (sdk)
    yield [
      { sender: 3, target: 0, message: first, w: 9, l: messageMemoryBase + 256, flags: 0 },
      { sender: 3, target: 0, message: 34, w: 0x12345678, l: messageMemoryBase, flags: 0 },
    ];
  yield [{ sender: 3, target: 3, message: 222, w: 0, l: 0, flags: 1, dynamic: true }];
  for (const nativeID of [0x80000000, 0xffffffff])
    yield [
      {
        prepare: [{ kind: 0, parent: 3, nativeID, namespace: 0, name: 'signed-key' }],
        sender: 0,
        target: 3,
        message: 16,
        w: 0,
        l: messageMemoryBase + 2048,
        flags: 0,
      },
    ];
  yield [{ sender: 3, target: 0, message: first, w: 0, l: 0x12345678, flags: 0 }];
  yield [
    { sender: 3, target: 4, message: 3, w: 0, l: 0, flags: 0 },
    { sender: 3, target: 4, message: 13, w: 0, l: 0, flags: 0 },
  ];
  for (const erase of [false, true])
    for (const id of [4, 7])
      yield [
        {
          unregister: id,
          erase,
          sender: 3,
          target: 0,
          message: first + 1,
          w: id === 4 ? 4 : 1,
          l: 0,
          flags: 0,
        },
        { sender: 3, target: id === 4 ? 4 : 1, message: 13, w: 0, l: 0, flags: 0 },
        { prune: 0, sender: 3, target: 0, message: first + 1, w: id === 4 ? 4 : 1, l: 0, flags: 0 },
      ];
}

export function prepareEngineMessageOperation(fixture, operation) {
  if (operation.unregister !== undefined)
    fixture.messages.unregister(fixture.world.objects.objects.get(operation.unregister), {
      erase: operation.erase,
    });
  if (operation.prune !== undefined) {
    const visit = (record) => {
      for (const child of fixture.messages.children(record)) visit(child);
      fixture.messages.pruneNullRoutes(record);
    };
    visit(fixture.world.objects.objects.get(operation.prune));
  }
}
