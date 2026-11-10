// SPDX-License-Identifier: MPL-2.0
import { NativeGlobalFile, nativeSavePath } from './persistence.mjs';
import { tokenizeNativeFESSoundConfiguration } from './fes-sound-config.mjs';
import { nativeFileTime, nativeSystemTime } from './file-time.mjs';
import { nativeABI } from './abi/index.mjs';

export const NATIVE_FES_SAVE_COMMANDS = Object.freeze([
  'saveexist',
  'datasave',
  'savedelete',
  'saveexchg',
  'savecopy',
  'newsave',
  'saveapend_str',
  'saveget_str',
  'sortsave',
  'sortsave2',
  'saveget_date',
]);
const decoder = new TextDecoder('shift_jis');
const slotName = (slot) => {
  const value = slot | 0;
  return `save${value < 0 ? '-' + String(-value).padStart(3, '0') : String(value).padStart(4, '0')}.dat`;
};
// The original partition moves the middle pivot first. Its comparator returns
// zero for both equal and older timestamps, so equal-date ordering is visible.
function sortSlots(rows, first = 0, last = rows.length - 1) {
  while (first < last) {
    const middle = (first + last) >>> 1,
      pivot = rows[middle];
    rows[middle] = rows[first];
    let position = first;
    for (let index = first + 1; index <= last; index++)
      if (rows[index].time > pivot.time) {
        position++;
        [rows[position], rows[index]] = [rows[index], rows[position]];
      }
    rows[first] = rows[position];
    rows[position] = pivot;
    sortSlots(rows, first, position - 1);
    first = position + 1;
  }
}
function slotRange(first, last) {
  const count = Math.max(0, (last | 0) - (first | 0) + 1);
  if (count > 0x1000000) throw new RangeError('Native save slot range exceeds its resource limit');
  return Array.from({ length: count }, (_, index) => (first + index) | 0);
}
export class NativeSaveSlots {
  constructor(world) {
    this.world = world;
  }
  supports(command) {
    return NATIVE_FES_SAVE_COMMANDS.includes(command);
  }
  async remove(name) {
    const storage = this.world.storage;
    if ((await storage.read(name)) === null) return false;
    await storage.setAttributes?.(name, 0x80);
    return storage.remove?.(name) ?? false;
  }
  async load(name) {
    const bytes = await this.world.storage.read(name);
    if (!bytes) return null;
    try {
      return await NativeGlobalFile.fromFile(bytes);
    } catch {
      return null;
    }
  }
  async write(name, file, updateModified = true) {
    const storage = this.world.storage,
      bytes = await file.file(),
      space = await storage.diskSpace?.(),
      info = await storage.stat?.(name);
    if ((space && space.availableBytes < bytes.length) || info?.attributes & 1) return false;
    if (!(await storage.write(name, bytes, { updateModified }))) return false;
    if (!updateModified && info) await storage.setTimes?.(name, { modifiedMs: info.modifiedMs });
    return true;
  }
  async exchange(first, second, directory) {
    const storage = this.world.storage,
      a = await storage.read(first),
      b = await storage.read(second);
    if (!a) {
      if (b) await storage.move?.(second, first);
      return;
    }
    if (!b) {
      await storage.move?.(first, second);
      return;
    }
    const tempA = nativeSavePath(directory, 'tmp_save_1.tmp'),
      tempB = nativeSavePath(directory, 'tmp_save_2.tmp');
    if (
      !(await storage.copy?.(first, tempA, false)) ||
      !(await storage.copy?.(second, tempB, false))
    )
      return;
    const ok =
      (await this.remove(first)) &&
      (await this.remove(second)) &&
      (await storage.copy?.(tempA, second, false)) &&
      (await storage.copy?.(tempB, first, false));
    if (!ok) {
      await storage.copy?.(tempA, first, false);
      await storage.copy?.(tempB, second, false);
    }
    await this.remove(tempA);
    await this.remove(tempB);
  }
  async command(instance, command, source) {
    if (!this.supports(command)) throw new Error(`Unknown native FES save command ${command}`);
    const world = this.world,
      record = world.objects.objects.get(instance.runtimeID);
    if (!record || record.kind !== 34)
      throw new Error('Native FES save command requires its live interpreter task');
    const directory = record.context.contextName;
    if (typeof directory !== 'string')
      throw new Error('Native FES save command requires its initialized context directory');
    const tokens = tokenizeNativeFESSoundConfiguration(source, world.profile).slice(1),
      bytes = (index) => instance.argumentBytes(tokens[index]),
      number = (index) => instance.value(decoder.decode(bytes(index))) | 0,
      name = (index) => nativeSavePath(directory, slotName(number(index))),
      set = (index, value) => instance.setGlobal(index >>> 0, value >>> 0),
      storage = world.storage;
    if (!tokens.length) return 0;
    if (command === 'datasave') {
      if (tokens.length < 2 || !number(1)) return 0;
      await this.write(name(0), world.runtime.handles.get(number(1) >>> 0, 'global-file'));
    } else if (command === 'savedelete') {
      await this.remove(name(0));
    } else if (command === 'savecopy' || command === 'saveexchg') {
      if (tokens.length < 2) return 0;
      const first = name(0),
        second = name(1);
      if (command === 'saveexchg') await this.exchange(first, second, directory);
      else {
        const a = await storage.read(first),
          b = await storage.read(second);
        if (a) {
          if (b) await this.remove(second);
          await storage.copy?.(first, second, false);
        }
      }
    } else if (command === 'saveexist') {
      let at = 1,
        filename = slotName(number(0));
      if (number(0) < 0) {
        if (tokens.length < 2) return 0;
        const raw = bytes(1);
        // The wide engine passes the narrow token directly to its wide %s.
        filename =
          nativeABI(world.profile).text.settingsCharacterBytes === 2
            ? new TextDecoder('utf-16le').decode(
                Uint8Array.from([...raw, 0].slice(0, (raw.length + 1) & ~1)),
              )
            : decoder.decode(raw);
        at++;
      }
      if (tokens.length <= at) return 0;
      const destination = number(at++),
        min = tokens.length > at ? number(at++) >>> 0 : 0xffffffff,
        max = tokens.length > at ? number(at) >>> 0 : min,
        file = await this.load(nativeSavePath(directory, filename));
      set(
        destination,
        file ? (min !== 0xffffffff && (file.tag < min || file.tag > max) ? -1 : 1) : 0,
      );
    } else if (command === 'saveget_str' || command === 'saveapend_str') {
      if (tokens.length < 3) return 0;
      const filename = name(0),
        file = await this.load(filename);
      if (!file) return 0;
      if (command === 'saveapend_str') {
        const text = bytes(2),
          data = new Uint8Array(text.length + 4);
        data.set(text);
        file.remove(number(1));
        file.write(number(1), data);
        await this.write(filename, file, false);
      } else {
        const data = file.read(number(1));
        if (data && record.context.stringBank) {
          const end = data.indexOf(0);
          world.runtime.handles
            .get(record.context.stringBank, 'string-bank')
            .setBytes(number(2) >>> 0, data.subarray(0, end < 0 ? data.length : end));
        }
      }
    } else if (command === 'saveget_date') {
      const filename = name(0),
        data = await storage.read(filename),
        info = await storage.stat?.(filename);
      if (
        !data ||
        data.length < 4 ||
        new DataView(data.buffer, data.byteOffset).getUint32(0, true) !==
          0x535343 /* exe-address-check: non-address - CSS file signature */ ||
        !info
      )
        return 0;
      const time = nativeFileTime(info.modifiedMs),
        offset = world.runtime.services?.localOffsetMinutes?.() ?? -new Date().getTimezoneOffset(),
        date = time === null ? null : nativeSystemTime(time + BigInt(offset) * 600000000n);
      if (date)
        [date[0], date[1], date[3], date[4], date[5], date[6]].forEach((value, index) => {
          if (tokens.length > index + 1 && number(index + 1) !== -1) set(number(index + 1), value);
        });
    } else {
      if (tokens.length < (command === 'sortsave2' ? 2 : 3)) return 0;
      const destination = number(0),
        slots =
          command === 'sortsave2'
            ? tokens.slice(1).map((_, index) => number(index + 1))
            : slotRange(number(1), number(2));
      if (command === 'sortsave' && slots.length < 2) return 0;
      const rows = [];
      for (const slot of slots) {
        const info = await storage.stat?.(nativeSavePath(directory, slotName(slot)));
        rows.push({
          slot,
          time: info ? (nativeFileTime(info.modifiedMs) ?? 0n) : 0n,
          exists: Boolean(info),
        });
      }
      if (command === 'newsave') {
        let latest = null;
        for (const row of rows) if (row.exists && (!latest || row.time > latest.time)) latest = row;
        set(destination, latest?.slot ?? -1);
      } else {
        sortSlots(rows);
        rows.forEach((row, index) => set(destination + index, row.slot));
      }
    }
    return 0;
  }
}
