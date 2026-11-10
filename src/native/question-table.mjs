// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { NativeCompiledTable } from './compiled-table.mjs';
import { parseNativeInteger } from './standard.mjs';
import { sortNativeRecords } from './record-sort.mjs';
import {
  nativeDataArgument,
  nativeDataBytes,
  nativeDataFormat,
  nativeDataKey,
  nativeDataLines,
  nativeDataMapped,
  nativeDataPair,
  nativeDataString,
} from './data-text.mjs';

export const NATIVE_QUESTION_TABLE_IDS = Object.freeze(
  Array.from({ length: 37 }, (_, index) => 0x2e6 + index),
);
function filenameKey(bytes) {
  let name = nativeDataString(bytes).slice();
  const slash = Math.max(name.lastIndexOf(92), name.lastIndexOf(47));
  name = name.slice(slash + 1);
  const dot = name.lastIndexOf(46);
  if (dot >= 0) name = name.slice(0, dot);
  for (let index = 0; index < name.length; index++) {
    if (nativeDataPair(name, index)) index++;
    else if (name[index] >= 97 && name[index] <= 122) name[index] -= 32;
  }
  return nativeDataKey(name);
}
function initialConfiguration() {
  return {
    disable: 0,
    norma: 0,
    bg: '',
    rival: 0,
    type: 0,
    image: '',
    position: 0,
    x: 0,
    y: 0,
    bgm: 0,
    experience: 0,
    scores: [0, 0, 0, 0],
    count: 0,
    members: new Set(),
    partners: new Set(),
    genres: [[], [], []],
    genreDisable: 0,
  };
}
const optionFields = new Map([
  ['NORMA', 'norma'],
  ['RIVAL', 'rival'],
  ['RTYPE', 'type'],
  ['BGM', 'bgm'],
  ['EXP', 'experience'],
  ['CNT', 'count'],
]);
const integer = (word) => parseNativeInteger(word ?? '') ?? 0;
function configurationTokens(line) {
  return line.split(' ');
}
function parseConfigurations(bytes) {
  const lines = nativeDataLines(bytes).map(nativeDataKey),
    configurations = new Map();
  let at = 0,
    norma = 0;
  while (lines[at]?.startsWith('#')) {
    const name = lines[at++].slice(1),
      state = initialConfiguration();
    state.rival = -1;
    state.norma = norma;
    while (at < lines.length) {
      const [key, ...words] = configurationTokens(lines[at]),
        option = key.toUpperCase();
      if (optionFields.has(option)) {
        if (option === 'CNT' || words.length) state[optionFields.get(option)] = integer(words[0]);
      } else if (option === 'BG') state.bg = words[0] ?? state.bg;
      else if (option === 'RIMG') state.image = words[0] ?? state.image;
      else if (option === 'RPOS') {
        if (words.length) {
          state.position = 1;
          state.x = integer(words[0]);
          if (words.length > 1) state.y = integer(words[1]);
        }
      } else if (option === 'DISABLE')
        for (const word of words) state.disable |= 1 << ((integer(word) - 1) & 31);
      else if (option === 'MEMBER' || option === 'PARTNER')
        for (const word of words)
          state[option === 'MEMBER' ? 'members' : 'partners'].add(integer(word) | 0);
      else if (['PWIN', 'PLOSE', 'RWIN', 'RLOSE'].includes(option)) {
        if (words.length)
          state.scores[['PWIN', 'PLOSE', 'RWIN', 'RLOSE'].indexOf(option)] = integer(words[0]);
      } else break;
      at++;
    }
    norma = state.norma;
    if (lines[at]?.toUpperCase() === '$GEN') {
      at++;
      while (at < lines.length) {
        const [key, ...words] = configurationTokens(lines[at]),
          option = key.toUpperCase(),
          group = ['GENRE_A', 'GENRE_B', 'GENRE_C'].indexOf(option);
        if (group >= 0) {
          for (const word of words) {
            if (word.startsWith('@')) {
              state.genres[group].push(-10);
              if (group === 0) break;
            } else {
              const match = /^([+-]?(?:0x[\da-f]+|\d+))(?:-([+-]?(?:0x[\da-f]+|\d+)))?/i.exec(word);
              const first = match ? integer(match[1]) | 0 : -1,
                last = match?.[2] ? integer(match[2]) | 0 : first;
              if (last - first > 0x100000)
                throw new RangeError('Native genre range exceeds its resource limit');
              for (let value = first; value <= last; value++) state.genres[group].push(value);
            }
          }
        } else if (option === 'DISABLE')
          for (const word of words) state.genreDisable |= 1 << ((integer(word) - 1) & 31);
        else break;
        at++;
      }
    }
    if (!configurations.has(name)) configurations.set(name, state);
  }
  return configurations;
}
export class NativeQuestionTable {
  constructor() {
    this.tree = new Map();
    this.files = new Map();
    this.configurations = new Map();
    this.currentName = '';
    this.configuration = initialConfiguration();
    this.members = new Uint32Array(20);
    this.extraGenres = [[], [], []];
    this.pool = [];
    this.count = 0;
  }
  async load(name, bytes) {
    const key = filenameKey(name);
    if (this.files.has(key)) return false;
    if (key.length > 63) throw new RangeError('Native question filename exceeds its fixed field');
    const table = new NativeCompiledTable();
    if (!(await table.load(bytes))) return false;
    const records = new Map();
    this.files.set(key, records);
    for (let index = 0; index < table.rows.length && table.field(index, 'G_A'); index++) {
      const groups = ['G_A', 'G_B', 'G_C'].map((field) => table.number(index, field) | 0),
        id = table.number(index, 'ID') | 0;
      let node = this.tree;
      for (const group of [...groups, key]) {
        if (!node.has(group)) node.set(group, new Map());
        node = node.get(group);
      }
      if (node.has(id)) continue;
      const text = (field, capacity) => {
        const bytes = nativeDataString(table.field(index, field) ?? new Uint8Array()).slice();
        if (bytes.length >= capacity)
          throw new RangeError('Native question text exceeds its fixed field');
        return bytes;
      };
      const row = {
        file: key,
        id,
        groups,
        image: table.number(index, 'IMG'),
        question: text('Q', 256),
        answers: [1, 2, 3, 4].map((i) => text('A' + i, 64)),
        state: new Uint32Array(5),
      };
      node.set(id, row);
      if (!records.has(id)) records.set(id, row);
      this.count++;
    }
    return true;
  }
  loadConfigurations(bytes) {
    this.configurations.clear();
    if (!bytes?.length) return false;
    this.configurations = parseConfigurations(bytes);
    return true;
  }
  configure(name) {
    const value = this.configurations.get(name);
    if (!value) return false;
    this.currentName = name;
    this.configuration = structuredClone(value);
    return true;
  }
  orderedRecords(filters = [[], [], []]) {
    const result = [];
    const visit = (node, depth) => {
      if (depth === 5) {
        result.push(node);
        return;
      }
      const keys =
        depth < 3 && filters[depth].length
          ? [...new Set(filters[depth])].sort((a, b) => a - b)
          : [...node.keys()].reverse();
      for (const key of keys) if (node.has(key)) visit(node.get(key), depth + 1);
    };
    visit(this.tree, 0);
    return result;
  }
  rebuild() {
    const filters = this.configuration.genres.map((values, index) =>
      values.flatMap((value) => (value === -10 ? this.extraGenres[index] : [value])),
    );
    this.pool = this.orderedRecords(filters);
    for (const row of this.pool) {
      row.state[3] = row.state[2];
      row.state[4] = 0;
    }
  }
  draw(random) {
    sortNativeRecords(
      this.pool,
      (a, b) => !a.state[4] && (Boolean(b.state[4]) || a.state[3] < b.state[3]),
    );
    let count = 0,
      previous = 0xffffffff;
    const first = this.pool[0];
    for (const row of this.pool) {
      if (previous < row.state[3] || row.state[4] !== first.state[4]) break;
      previous = row.state[3];
      count++;
    }
    if (!count) return 0;
    const index = random.rand() % count;
    this.pool[index].state[3]++;
    this.pool[index].state[4] = 1;
    return index;
  }
  export(memory, pointer) {
    if (pointer) {
      memory.store(pointer, 12);
      memory.store(pointer + 4, 88);
      memory.store(pointer + 8, this.count);
    }
    const rows = this.orderedRecords();
    rows.forEach((row, index) => {
      if (!pointer) return;
      const at = pointer + 12 + 88 * index;
      memory.write(at, Uint8Array.from([...nativeDataBytes(row.file), 0]));
      memory.store(at + 64, row.id);
      row.state.forEach((word, i) => memory.store(at + 68 + i * 4, word));
    });
    return 12 + 88 * rows.length;
  }
  import(memory, pointer) {
    if (memory.load(pointer) !== 12 || memory.load(pointer + 4) !== 88) return false;
    const count = memory.load(pointer + 8);
    for (let index = 0; index < count; index++) {
      const at = pointer + 12 + 88 * index,
        name = nativeDataKey(memory.read(at, 64)),
        row = this.files.get(name)?.get(memory.load(at + 64) | 0);
      if (row)
        for (let word = 0; word < 5; word++) row.state[word] = memory.load(at + 68 + 4 * word);
    }
    return true;
  }
  snapshot() {
    return structuredClone({
      tree: this.tree,
      files: this.files,
      configurations: this.configurations,
      currentName: this.currentName,
      configuration: this.configuration,
      members: this.members,
      extraGenres: this.extraGenres,
      pool: this.pool,
      count: this.count,
    });
  }
  restore(state) {
    Object.assign(this, structuredClone(state));
    return this;
  }
}
export async function nativeQuestionTable(id, args, machine, services) {
  const argument = (index) => nativeDataArgument(args, machine, index),
    { handles } = services;
  if (id === 0x2e6)
    return nativeReply(
      1,
      handles.add('content-database', { family: 'question', data: new NativeQuestionTable() }),
    );
  const handle = argument(0),
    voids = [0x2e7, 0x2ed, 0x2f5, 0x2fb, 0x2fc, 0x2fe, 0x301, 0x302, 0x305, 0x306, 0x309, 0x30a],
    control = voids.includes(id) ? 2 : 1;
  if (!handle)
    return nativeReply(
      control,
      control === 2 ? undefined : [0x2f3, 0x2fd, 0x308].includes(id) ? -1 : 0,
    );
  const owner = handles.get(handle, 'content-database');
  if (owner.family !== 'question')
    throw new Error('Native content database has a different object family');
  const table = owner.data,
    config = table.configuration,
    value = (word) => nativeReply(1, word);
  if (id === 0x2e7) handles.release(handle, 'content-database');
  else if (id === 0x2e8 || id === 0x2ee) {
    const name = nativeDataFormat(args, machine, services, 1);
    if (name === null) return value(0);
    const filename = new TextDecoder('shift_jis').decode(name),
      first = await services.read(filename, 'database');
    if (id === 0x2ee) table.configurations.clear();
    if (!first?.length) return value(0);
    const bytes = await services.read(filename, 'database');
    return value(
      Number(id === 0x2e8 ? await table.load(name, bytes) : table.loadConfigurations(bytes)),
    );
  } else if (id === 0x2ef) {
    const name = nativeDataFormat(args, machine, services, 1);
    return value(Number(name !== null && table.configure(nativeDataKey(name))));
  } else if (id === 0x2e9) return value(table.count);
  else if ([0x2ea, 0x2eb, 0x2ec, 0x2ed, 0x2fe, 0x303, 0x304, 0x308].includes(id)) {
    const row = table.pool[argument(1) >>> 0];
    if (id === 0x2eb) return value(row?.image ?? -1);
    if (id === 0x303 || id === 0x304) return value(row?.state[id === 0x303 ? 2 : 1] ?? 0);
    if (id === 0x2ed || id === 0x2fe) {
      if (row) row.state[id === 0x2ed ? 2 : 1]++;
    } else {
      const destination = argument(id === 0x2ec ? 3 : 2);
      if (id === 0x308) {
        if (!row) return value(-1);
        machine.writeStringBytes(nativeDataBytes(row.file), destination);
        return value(row.id);
      }
      if (!row || !nativeDataMapped(machine, destination)) return value(0);
      const bytes = id === 0x2ea ? row.question : row.answers[argument(2)];
      if (!bytes) throw new RangeError('Native question answer index exceeds its fixed array');
      machine.writeStringBytes(bytes, destination);
      return value(1);
    }
  } else if (id === 0x2f0) return value(config.count);
  else if (id === 0x2f1) return value(config.norma);
  else if (id === 0x2f3) return value(config.rival);
  else if (id === 0x2f4) return value(config.type);
  else if (id === 0x2f8) return value(config.bgm);
  else if (id === 0x2f9) return value(config.disable);
  else if (id === 0x2fa) return value(config.experience);
  else if (id === 0x2f2 || id === 0x2f5) {
    const destination = argument(1);
    if (nativeDataMapped(machine, destination)) {
      machine.writeStringBytes(
        nativeDataBytes(id === 0x2f2 ? config.bg : config.image),
        destination,
      );
      if (id === 0x2f2) return value(1);
    } else if (id === 0x2f2) return value(0);
  } else if (id === 0x2f6) {
    const x = argument(1),
      y = argument(2);
    if (!nativeDataMapped(machine, x) || !nativeDataMapped(machine, y)) return value(0);
    machine.store(x, config.x);
    machine.store(y, config.y);
    return value(config.position);
  } else if (id === 0x2f7) {
    const member = argument(1) | 0;
    return value(
      Number(
        config.partners.has(member) ||
          (!config.members.has(member) && member >= 0 && member < 20 && table.members[member]),
      ),
    );
  } else if (id === 0x2fb)
    config.scores.forEach((word, index) => machine.store(argument(index + 1), word));
  else if (id === 0x2fc) table.rebuild();
  else if (id === 0x2fd) return value(table.draw(services.random));
  else if (id === 0x2ff) {
    const pointer = argument(1),
      memory = pointer ? (await services.dataBuffers()).process : null;
    return value(table.export(memory, pointer));
  } else if (id === 0x300)
    return value(Number(table.import((await services.dataBuffers()).process, argument(1))));
  else if (id === 0x305) table.members.fill(0);
  else if (id === 0x306) {
    const member = argument(1) >>> 0;
    if (member < 20) table.members[member] = 1;
  } else if (id === 0x307) return value(Number(config.partners.size > 0));
  else if (id === 0x309) {
    const group = argument(1) >>> 0;
    if (group < 3) table.extraGenres[group].push(argument(2) | 0);
  } else if (id === 0x30a) for (const group of table.extraGenres) group.length = 0;
  return nativeReply(control);
}
export function installNativeQuestionTables(world) {
  for (const id of NATIVE_QUESTION_TABLE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeQuestionTable(id, args, machine, world.runtime.services),
    );
}
