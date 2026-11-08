// SPDX-License-Identifier: MPL-2.0
// Native 78A2F0/78A420 record format. This guest-visible checkpoint rebuilds
// scripts from registers/extra data; emulator checkpoints also retain VM heaps.
import { MOTION_ABI } from './abi.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    size: 1108,
    group: 68,
    registers: 72,
    nameBytes: 64,
    wide: true,
  },
  'sdk-4.01-engine-2.6.1.74': { size: 1076, group: 36, registers: 40, nameBytes: 32, wide: false },
};
const layoutFor = (profile) => {
  const layout = layouts[profile];
  if (!layout) throw new Error(`Native MOT checkpoint profile is unavailable: ${profile}`);
  return layout;
};
const gameProfile = 'nekopara-vol3-engine-2.6.1.76';

export function encodeMotionRecords(manager, frame, storage = null) {
  const layout = layoutFor(manager.profile);
  const records = [...manager.records.values()].sort((a, b) => a.handle - b.handle);
  const extras = records.map(({ instance }) => {
    const pointer = instance.view.getUint32(MOTION_ABI.extraData, true);
    const size = instance.view.getUint32(MOTION_ABI.extraSize, true);
    return pointer ? instance.machine.bytes(pointer, size).slice() : new Uint8Array();
  });
  const length = 8 + extras.reduce((size, extra) => size + layout.size + extra.length, 0),
    bytes = storage && storage.length >= length ? storage : new Uint8Array(length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, length, true);
  view.setUint32(4, records.length, true);
  let at = 8;
  records.forEach((record, index) => {
    const { instance } = record,
      extra = extras[index];
    const name = (instance.script.recordName || instance.script.name)
      .replaceAll('\\', '/')
      .split('/')
      .at(-1);
    const encoded = layout.wide
      ? new Uint8Array((name.length + 1) * 2)
      : Uint8Array.from([...encodeCP932(name), 0]);
    if (layout.wide) {
      const words = new DataView(encoded.buffer);
      for (let i = 0; i < name.length; i++) words.setUint16(i * 2, name.charCodeAt(i), true);
    }
    if (encoded.length > layout.nameBytes)
      throw new Error(`MOT record filename exceeds native ${layout.nameBytes}-byte storage`);
    view.setUint32(at, layout.size + extra.length, true);
    // lstrcpyW / CP932 strcpy write only through NUL; existing name padding
    // and capacity beyond the used prefix survive a checkpoint refresh.
    bytes.set(encoded, at + 4);
    view.setUint32(at + layout.group, record.group, true);
    bytes.set(
      instance.shared.subarray(MOTION_ABI.registers, MOTION_ABI.registers + 1024),
      at + layout.registers,
    );
    view.setUint32(at + layout.size - 12, extra.length, true);
    view.setUint32(at + layout.size - 8, frame - record.startTick, true);
    view.setUint32(at + layout.size - 4, instance.delay, true);
    bytes.set(extra, at + layout.size);
    at += layout.size + extra.length;
  });
  return bytes;
}

export function decodeMotionRecords(bytes, profile = gameProfile) {
  const layout = layoutFor(profile);
  if (!(bytes instanceof Uint8Array) || bytes.length < 8)
    throw new Error('Invalid native MOT record block');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(0, true),
    count = view.getUint32(4, true);
  if (length < 8 || length > bytes.length || count > Math.floor((length - 8) / layout.size))
    throw new Error('Invalid native MOT record count/length');
  const records = [];
  let at = 8;
  for (let index = 0; index < count; index++) {
    if (at + layout.size > length) throw new Error('Truncated native MOT record');
    const size = view.getUint32(at, true);
    if (!size) {
      at += layout.size;
      continue;
    }
    const extraSize = view.getUint32(at + layout.size - 12, true);
    if (size !== layout.size + extraSize || at + size > length)
      throw new Error('Invalid native MOT record size');
    const nameStart = at + 4,
      step = layout.wide ? 2 : 1;
    let end = nameStart;
    while (
      end < nameStart + layout.nameBytes &&
      (layout.wide ? view.getUint16(end, true) : bytes[end])
    )
      end += step;
    if (end === nameStart || end === nameStart + layout.nameBytes)
      throw new Error('Invalid native MOT record filename');
    const name = new TextDecoder(layout.wide ? 'utf-16le' : 'shift_jis').decode(
      bytes.subarray(nameStart, end),
    );
    records.push({
      name,
      group: view.getUint32(at + layout.group, true),
      registerWords: bytes.slice(at + layout.registers, at + layout.registers + 1024),
      extra: bytes.slice(at + layout.size, at + size),
      elapsed: view.getUint32(at + layout.size - 8, true),
      delay: view.getUint32(at + layout.size - 4, true),
    });
    at += size;
  }
  if (at !== length) throw new Error('Native MOT record block has trailing data');
  return records;
}

export async function restoreMotionRecords(manager, bytes, frame, loadScript) {
  const records = decodeMotionRecords(bytes, manager.profile);
  const scripts = await Promise.all(records.map((record) => loadScript(record.name)));
  manager.clear();
  records.forEach((record, index) =>
    manager.add(scripts[index], {
      registerWords: record.registerWords,
      extra: record.extra,
      delay: record.delay,
      group: record.group,
      startTick: (frame - record.elapsed) >>> 0,
    }),
  );
}
