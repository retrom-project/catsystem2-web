// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { NativeCompiledTable } from './compiled-table.mjs';
import { parseNativeInteger } from './standard.mjs';
import {
  nativeDataArgument,
  nativeDataFormat,
  nativeDataKey,
  nativeDataMapped,
  nativeDataString,
} from './data-text.mjs';

export const NATIVE_MISSION_TABLE_IDS = Object.freeze(
  Array.from({ length: 34 }, (_, index) => 0x31b + index),
);
const numericFields = [
  'TYPE',
  'CLIENT',
  'REWARD',
  'LV_MIN',
  'LV_MAX',
  'PLACE',
  'COND',
  'PRI',
  'EXP',
  'SECCNT',
  'KEY',
];
function parameterGroups(bytes) {
  const text = nativeDataKey(bytes),
    groups = [];
  let at = 0;
  while (text[at] === '[') {
    const end = text.indexOf(']', at + 1);
    if (end < 0) throw new SyntaxError('Unterminated native mission parameter group');
    const group = text.slice(at + 1, end);
    groups.push(
      group
        ? group.split(',').map((word) => {
            const value = parseNativeInteger(word);
            if (value === null) throw new SyntaxError('Invalid native mission parameter');
            return value | 0;
          })
        : [],
    );
    at = end + 1;
  }
  return groups;
}
function stringField(table, index, name) {
  return nativeDataString(table.field(index, name) ?? new Uint8Array()).slice();
}
export class NativeMissionTable {
  constructor() {
    this.records = new Map();
    this.characters = Array.from({ length: 20 }, () => new Uint32Array(6));
    this.level = 0;
    this.secondary = 0;
    this.total = 0;
  }
  rows() {
    return [...this.records.values()].sort((a, b) => a.id - b.id);
  }
  async load(bytes) {
    this.records.clear();
    const table = new NativeCompiledTable();
    if (!(await table.load(bytes))) return false;
    for (let index = 0; index < table.rows.length; index++) {
      const id = table.number(index, 'TBL') | 0;
      if (this.records.has(id)) continue;
      const fields = Object.fromEntries(
          numericFields.map((name) => [name, table.number(index, name) | 0]),
        ),
        params = parameterGroups(stringField(table, index, 'CPARAM')),
        characters = [...new Set(parameterGroups(stringField(table, index, 'CHAR'))[0] ?? [])].sort(
          (a, b) => a - b,
        ),
        questions = Array.from({ length: 3 }, (_, i) =>
          stringField(table, index, 'QZTBL' + (i + 1)),
        ),
        points = new Uint8Array(80),
        fourth = table.field(index, 'QZTBL4');
      if (fourth) points.set(fourth.subarray(0, 32));
      for (let point = 0; point < 20; point++) {
        const field = table.field(index, `PT${String(point).padStart(2, '0')}`);
        if (field) {
          if (field.length > 4) throw new RangeError('Native mission point field exceeds its word');
          points.set(field, point * 4);
        }
      }
      if (params[0]?.[0] === -1) params[0] = characters.slice();
      this.records.set(id, {
        id,
        fields,
        file: stringField(table, index, 'FILE'),
        params,
        characters,
        questions,
        points,
        progress: Uint32Array.of(0, 0x80000000, 0, 0, 0),
      });
    }
    return true;
  }
  reset() {
    for (const row of this.records.values()) {
      row.progress[0] = 0;
      row.progress[1] = 0x80000000;
      row.progress[2] = 0;
    }
    for (const character of this.characters) character.fill(0);
    this.level = 1;
    this.secondary = 0;
    this.total = 0;
  }
  completedCount() {
    return this.rows().filter((row) => row.id < 100 && row.progress[2]).length;
  }
  condition(row) {
    const { params, fields } = row,
      code = fields.COND,
      pairs = params.filter((values) => values.length >= 2 && values[0] >= 0 && values[0] < 20),
      statistic = (index, word) => this.characters[index][word] | 0;
    if (code === 0) return true;
    if (code === 1 || code === 20)
      return pairs.every(([index, threshold]) => statistic(index, 3) >= threshold);
    if (code === 2) return pairs.some(([index, threshold]) => statistic(index, 3) >= threshold);
    if (code === 21) return pairs.every(([index, threshold]) => statistic(index, 4) >= threshold);
    if (code === 3) {
      if (params.length < 2 || !params[1].length) return false;
      const sum = params[0].reduce(
        (sum, index) => (index >= 0 && index < 20 ? (sum + statistic(index, 3)) | 0 : sum),
        0,
      );
      return sum >= params[1][0];
    }
    if (code === 10)
      return params
        .flat()
        .every((id) => !this.records.has(id) || Boolean(this.records.get(id).progress[2]));
    if (code === 11) return params.flat().some((id) => Boolean(this.records.get(id)?.progress[2]));
    const threshold = params[0]?.[0];
    if (threshold === undefined) return false;
    if (code === 30) return threshold <= (this.secondary | 0);
    if (code === 40) return threshold <= (this.total | 0);
    if (code === 41) return threshold <= this.completedCount();
    return false;
  }
  updateAvailability() {
    for (const row of this.records.values()) {
      const { fields, progress } = row,
        level = this.level | 0,
        dependency = this.records.get(fields.KEY);
      progress[0] = Number(
        (fields.TYPE === 0 || !progress[2]) &&
          level >= fields.LV_MIN &&
          level <= (fields.LV_MAX === -1 ? fields.LV_MIN : fields.LV_MAX) &&
          (fields.KEY === -1 || !dependency || dependency.progress[2]) &&
          fields.TYPE >>> 0 <= 5 &&
          this.condition(row),
      );
    }
  }
  findTag(tag, types = null) {
    return this.rows().find(
      (row) => (row.progress[1] | 0) === (tag | 0) && (!types || types.includes(row.fields.TYPE)),
    );
  }
  clearTags() {
    for (const row of this.records.values()) row.progress[1] = 0x80000000;
  }
  select() {
    this.clearTags();
    for (const row of this.rows()) {
      if (!row.progress[0]) continue;
      const previous = this.findTag(row.fields.PLACE, [2, 3, 4]);
      if (previous) {
        if (previous.fields.PRI >= row.fields.PRI) continue;
        previous.progress[1] = 0x80000000;
      }
      row.progress[1] = row.fields.PLACE;
    }
  }
  complete(id) {
    const row = this.records.get(id | 0);
    if (row) {
      row.progress[2] = this.level;
      row.progress[1] = 0x80000000;
      row.progress[3]++;
    }
  }
  changeStatistic(index, word, amount) {
    const character = this.characters[index >>> 0];
    if (!character) return;
    character[word] += amount;
    if ((character[word] | 0) < 0) character[word] = 0;
  }
  points(row) {
    const view = new DataView(row.points.buffer, row.points.byteOffset, row.points.length);
    return Array.from({ length: 20 }, (_, index) => view.getUint32(index * 4, true));
  }
  question(row, index) {
    if (index < 3) return row.questions[index];
    // The recovered fourth question-table field overlaps the PT word array.
    const bytes = new Uint8Array(100),
      view = new DataView(bytes.buffer);
    bytes.set(row.points);
    row.progress.forEach((word, i) => view.setUint32(80 + i * 4, word, true));
    return nativeDataString(bytes);
  }
  export(memory, pointer) {
    const rows = this.rows(),
      first = 36 + 24 * rows.length,
      second = first + 28 * this.characters.length,
      words = [
        36,
        24 * rows.length,
        rows.length,
        first,
        28 * this.characters.length,
        this.characters.length,
        second,
        4,
        4,
      ];
    if (!pointer) return second + 4;
    words.forEach((word, index) => memory.store(pointer + 4 * index, word));
    rows.forEach((row, index) => {
      const at = pointer + 36 + 24 * index;
      memory.store(at, row.id);
      row.progress.forEach((word, i) => memory.store(at + 4 + 4 * i, word));
    });
    this.characters.forEach((character, index) => {
      const at = pointer + first + 28 * index;
      memory.store(at, index);
      character.forEach((word, i) => memory.store(at + 4 + 4 * i, word));
    });
    memory.store(pointer + second, this.total);
    return second + 4;
  }
  import(memory, pointer, size) {
    if (!pointer || size < 36) return false;
    const header = Array.from({ length: 9 }, (_, index) => memory.load(pointer + 4 * index));
    if (size >>> 0 < (header[4] + header[1] + 36) >>> 0) return false;
    const rows = [],
      characters = [];
    for (let index = 0; index < header[2]; index++) {
      const at = pointer + header[0] + 24 * index;
      rows.push([
        memory.load(at) | 0,
        Uint32Array.from({ length: 5 }, (_, word) => memory.load(at + 4 + word * 4)),
      ]);
    }
    for (let index = 0; index < header[5]; index++) {
      const at = pointer + header[3] + 28 * index;
      characters.push([
        memory.load(at),
        Uint32Array.from({ length: 6 }, (_, word) => memory.load(at + 4 + word * 4)),
      ]);
    }
    const total = memory.load(pointer + header[6]);
    for (const [id, progress] of rows) this.records.get(id)?.progress.set(progress);
    for (const [id, words] of characters) this.characters[id]?.set(words);
    this.total = total;
    return true;
  }
  snapshot() {
    return structuredClone({
      records: this.records,
      characters: this.characters,
      level: this.level,
      secondary: this.secondary,
      total: this.total,
    });
  }
  restore(state) {
    Object.assign(this, structuredClone(state));
    return this;
  }
}
const controls = new Map([
  [0x31b, 1],
  [0x31e, 1],
  [0x320, 1],
  [0x324, 1],
  [0x325, 1],
  [0x326, 1],
  [0x331, 1],
  [0x332, 1],
  [0x333, 1],
  [0x334, 1],
  [0x337, 1],
  [0x338, 1],
  [0x339, 1],
  [0x33a, 1],
]);
export async function nativeMissionTable(id, args, machine, services) {
  const argument = (index) => nativeDataArgument(args, machine, index),
    { handles } = services,
    value = (word) => nativeReply(1, word);
  if (id === 0x31b) {
    const table = new NativeMissionTable(),
      name = nativeDataFormat(args, machine, services, 0);
    if (name !== null) {
      const filename = new TextDecoder('shift_jis').decode(name),
        first = await services.read(filename, 'database');
      if (!first?.length || !(await table.load(await services.read(filename, 'database'))))
        return value(0);
    }
    return value(handles.add('content-database', { family: 'mission', data: table }));
  }
  const handle = argument(0);
  if (id === 0x323 && !handle) {
    machine.store(argument(2), 0);
    machine.store(argument(3), 0);
  }
  if (!handle)
    return nativeReply(
      controls.get(id) ?? 2,
      controls.has(id) ? ([0x325, 0x331, 0x332, 0x333].includes(id) ? -1 : 0) : undefined,
    );
  const owner = handles.get(handle, 'content-database');
  if (owner.family !== 'mission')
    throw new Error('Native content database has a different object family');
  const table = owner.data,
    record = () => table.records.get(argument(1) | 0),
    mapped = (index) => nativeDataMapped(machine, argument(index));
  if (id === 0x31c) handles.release(handle, 'content-database');
  else if (id === 0x31d) table.level = argument(1) >>> 0;
  else if (id === 0x31e) return value(table.level);
  else if (id === 0x31f) table.secondary = argument(1) >>> 0;
  else if (id === 0x320) return value(table.secondary);
  else if (id === 0x321) table.complete(argument(1));
  else if (id === 0x322) {
    const first = argument(1),
      second = argument(2),
      min = argument(3) | 0,
      max = argument(4) | 0;
    machine.store(second, 0);
    machine.store(first, 0);
    for (const row of table.rows())
      if (row.id >= min && row.id <= max) {
        if (row.progress[2]) machine.store(first, machine.load(first) + 1);
        if (row.progress[3]) machine.store(second, machine.load(second) + 1);
      }
  } else if (id === 0x323) {
    const row = record();
    machine.store(argument(2), Number(Boolean(row?.progress[2])));
    machine.store(argument(3), Number(Boolean(row?.progress[3])));
  } else if (id === 0x324) {
    const row = record();
    if (!row || !mapped(2)) return value(0);
    machine.writeStringBytes(row.file, argument(2));
    return value(1);
  } else if (id === 0x325) {
    const row = record(),
      selected = row ? table.points(row).flatMap((word, index) => (word ? [index] : [])) : [];
    return value(selected[argument(2) >>> 0] ?? -1);
  } else if (id === 0x326) {
    const row = record(),
      index = argument(2) >>> 0;
    if (!row || index > 3 || !mapped(3)) return value(0);
    machine.writeStringBytes(table.question(row, index), argument(3));
    return value(1);
  } else if (id === 0x327) {
    const character = table.characters[argument(1) >>> 0];
    if (character) {
      character[0]++;
      character[1]++;
      if (argument(2)) character[2]++;
      table.total = (table.total + 1) >>> 0;
    }
  } else if (id === 0x328) {
    const index = argument(1) >>> 0;
    if (index === 0xffffffff) for (const character of table.characters) character[1] = 0;
    else if (index < 20) table.characters[index][1] = 0;
  } else if (id === 0x329 || id === 0x32a) {
    const row = record();
    if (row)
      for (const index of row.characters)
        if (index >= 0 && index < 20)
          table.changeStatistic(
            index,
            1,
            id === 0x329 ? -(table.characters[index][1] | 0) : -(argument(2) | 0),
          );
  } else if (id === 0x32b || id === 0x32c)
    table.changeStatistic(argument(1), id === 0x32b ? 3 : 4, argument(2) | 0);
  else if (id === 0x32d) {
    const character = table.characters[argument(1) >>> 0];
    if (character) character[5]++;
  } else if (id === 0x32e) {
    const character = table.characters[argument(1) >>> 0];
    if (character)
      character.forEach((word, index) => {
        if (mapped(index + 2)) machine.store(argument(index + 2), word);
      });
  } else if (id === 0x32f) table.updateAvailability();
  else if (id === 0x330) {
    const count = argument(2) | 0;
    for (let index = 0; index < count; index++) machine.load(argument(1) + 4 * index);
    table.select();
  } else if (id === 0x331)
    return value(
      table.rows().filter((row) => (row.progress[1] | 0) === (argument(1) | 0))[argument(2) >>> 0]
        ?.id ?? -1,
    );
  else if (id === 0x332) return value(table.findTag(argument(1), [2, 3, 4])?.id ?? -1);
  else if (id === 0x333) return value(table.findTag((argument(1) + 100) | 0, [3])?.id ?? -1);
  else if (id === 0x334) {
    const row = record(),
      selector = argument(2) >>> 0;
    if (!row || selector > 11 || !mapped(3)) return value(0);
    const { fields, progress } = row,
      words = [
        fields.TYPE,
        fields.CLIENT,
        fields.REWARD,
        fields.LV_MIN,
        fields.LV_MAX,
        fields.COND,
        progress[1],
        progress[2],
        progress[3],
        row.characters[0] ?? 0,
        fields.EXP,
        fields.SECCNT,
      ];
    machine.store(argument(3), words[selector]);
    return value(1);
  } else if (id === 0x335) table.reset();
  else if (id === 0x336) table.clearTags();
  else if (id === 0x337) {
    const pointer = argument(1),
      memory = pointer ? (await services.imageDataBuffers()).process : null;
    return value(table.export(memory, pointer));
  } else if (id === 0x338)
    return value(
      Number(table.import((await services.imageDataBuffers()).process, argument(1), argument(2))),
    );
  else if (id === 0x339)
    return value(record()?.params[argument(2) >>> 0]?.[argument(3) >>> 0] ?? -1);
  else if (id === 0x33a) return value(record()?.progress[4] ?? -1);
  else if (id === 0x33b) {
    for (const row of table.records.values()) if (row.progress[1] !== 0x80000000) row.progress[4]++;
  } else if (id === 0x33c) table.total = 0;
  return nativeReply(2);
}
export function installNativeMissionTables(world) {
  for (const id of NATIVE_MISSION_TABLE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeMissionTable(id, args, machine, world.runtime.services),
    );
}
