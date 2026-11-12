// SPDX-License-Identifier: MPL-2.0
// The soundconf tree is separate from the older four startup configuration blocks.
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { findNativeXML, parseNativeXML } from './xml.mjs';
import { parseNativeInteger } from './standard.mjs';

const profile76 = 'nekopara-vol3-engine-2.6.1.76';
const mutable = ['volume', 'play', 'sysplay', 'voicevol', 'skipvol', 'mute'];
const resetFields = ['volume', 'play', 'sysplay', 'mute', 'voicevol'];
const inherited = [
  'head',
  'group',
  'int',
  'mastervol',
  'volume',
  'play',
  'sysplay',
  'voicevol',
  'skipvol',
];
const numericDefaults = {
  id: -1,
  group: -1,
  mastervol: -1,
  volume: -1,
  play: -1,
  sysplay: -1,
  voicevol: -1,
  skipvol: -1,
  sameid: 0,
  mute: 0,
};
const missing = {
  volume: 100,
  play: 1,
  sysplay: 1,
  mastervol: 100,
  voicevol: 100,
  skipvol: -1,
  mute: 100,
  sameid: 0,
  id: -1,
  group: -1,
  head: '',
  int: '',
  type: '',
  name: '',
};
const ptr = (root, path) => root && findNativeXML(root, path.join('/'));
const text = (root, path, fallback = '') => ptr(root, path)?.text ?? fallback;
const integer = (root, path, fallback) => {
  const node = ptr(root, path);
  return node ? (parseNativeInteger(node.text) ?? 0) | 0 : fallback | 0;
};
const mulPercent = (a, b) => Math.trunc(Math.imul(a, b) / 100) | 0;

// Native lowercasing skips valid CP932 pairs and changes ASCII A..Z only.
export function lowerSoundName(value) {
  const bytes = encodeCP932(String(value));
  for (let i = 0; i < bytes.length; i++) {
    const lead = bytes[i],
      trail = bytes[i + 1];
    if (
      ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xef)) &&
      trail >= 0x40 &&
      trail <= 0xfc &&
      trail !== 0x7f
    )
      i++;
    else if (lead >= 65 && lead <= 90) bytes[i] += 32;
  }
  return new TextDecoder('shift_jis').decode(bytes);
}

function readRecord(root, path, key) {
  const record = { key, defaults: {}, current: {}, children: [] };
  for (const name of ['name', 'type', 'head', 'int']) record[name] = text(root, [...path, name]);
  record.head = lowerSoundName(record.head);
  for (const [name, fallback] of Object.entries(numericDefaults)) {
    const value = integer(root, [...path, name], fallback);
    if (mutable.includes(name)) record.defaults[name] = value;
    else record[name] = value;
  }
  const children = ptr(root, [...path, 'part'])?.children ?? [];
  for (const child of children) {
    const item = readRecord(root, [...path, 'part', child.name], lowerSoundName(child.name));
    // Inheritance occurs after recursive parsing; it does not run again on grandchildren.
    for (const name of inherited) {
      const target = mutable.includes(name) ? item.defaults : item;
      const source = mutable.includes(name) ? record.defaults : record;
      if (target[name] === -1 || target[name] === '') target[name] = source[name];
    }
    item.current = { ...item.defaults };
    record.children.push(item);
  }
  record.current = { ...record.defaults };
  return record;
}

function visit(nodes, callback) {
  for (const node of nodes) {
    const found = callback(node) || visit(node.children, callback);
    if (found) return found;
  }
  return null;
}

function matchFilename(filename, node, state, field, apply) {
  if (node.head && filename.startsWith(node.head)) {
    if (apply)
      state.value = mulPercent(
        node.current.mute ? 0 : mulPercent(state.value, node.current[field]),
        node.mastervol,
      );
    return true;
  }
  for (const child of node.children) {
    if (!matchFilename(filename, child, state, field, apply)) continue;
    state.value = mulPercent(
      node.current.mute ? 0 : mulPercent(state.value, node.current[field]),
      node.mastervol,
    );
    return true;
  }
  return false;
}

function matchCategory(category, filename, node, state, field) {
  if (node.key === category) {
    // The native voice-volume path deliberately calls the ordinary volume helper here.
    matchFilename(filename, node, state, 'volume', false);
    state.value = mulPercent(
      node.current.mute ? 0 : mulPercent(state.value, node.current[field]),
      node.mastervol,
    );
    return true;
  }
  for (const child of node.children) {
    if (!matchCategory(category, filename, child, state, field)) continue;
    state.value = mulPercent(
      node.current.mute ? 0 : mulPercent(state.value, node.current[field]),
      node.mastervol,
    );
    return true;
  }
  return false;
}

export class NativeSoundConfiguration {
  constructor({
    profile = profile76,
    document,
    preferences,
    loaded = !!document,
    filename = '',
  } = {}) {
    this.abi = nativeABI(profile);
    this.profile = profile;
    this.loaded = !!loaded;
    this.filename = String(filename);
    this.master = null;
    this.parts = [];
    this.groups = new Map();
    this.dirty = false;
    if (document) this.load(document);
    if (preferences && this.master) this.applyPreferences(preferences);
  }

  load(root) {
    this.master = readRecord(root, ['MASTER'], 'MASTER');
    this.parts = (ptr(root, ['PART'])?.children ?? []).map((node) =>
      readRecord(root, ['PART', node.name], lowerSoundName(node.name)),
    );
    this.groups.clear();
    for (const node of ptr(root, ['SOUNDGROUP'])?.children ?? []) {
      const path = ['SOUNDGROUP', node.name],
        id = integer(root, [...path, 'id'], -1);
      if (this.groups.has(id)) continue;
      this.groups.set(id, {
        id,
        comment: text(root, [...path, 'comment']),
        label: text(root, [...path, 'label']),
        type: text(root, [...path, 'type']),
        min: integer(root, [...path, 'min'], -1),
        max: integer(root, [...path, 'max'], -1),
      });
    }
    return this;
  }

  requireTree() {
    if (!this.master)
      throw new Error('Native soundconf fields were not initialized by a parsed document');
  }

  applyPreferences(root) {
    this.requireTree();
    const apply = (node, path) => {
      const at = [...path, node.key];
      for (const field of mutable) {
        // 719C60 uses the sysplay default for a missing mute field.
        node.current[field] = integer(
          root,
          [...at, field],
          node.defaults[field === 'mute' ? 'sysplay' : field],
        );
      }
      for (const child of node.children) apply(child, [...at, 'part']);
    };
    apply(this.master, []);
    for (const node of this.parts) apply(node, ['PART']);
  }

  find({ by = 'key', query = '', ids = [] } = {}) {
    this.requireTree();
    if (by === 'master') return this.master;
    if (by === 'idPath') {
      let nodes = this.parts,
        result = null;
      for (const id of ids) {
        result = nodes.find((node) => node.id === (id | 0)) ?? null;
        if (result) nodes = result.children;
      }
      return result;
    }
    const value = lowerSoundName(query);
    if (by === 'filename')
      return visit(this.parts, (node) => node.head && value.startsWith(node.head) && node);
    if (by === 'type') return visit(this.parts, (node) => node.type === value && node);
    if (by === 'key') return visit(this.parts, (node) => node.key === value && node);
    throw new Error(`Unknown native sound selector ${by}`);
  }

  systemVoiceAtIDPath(ids) {
    const missing = this.abi.sound.missingIdPathFields.includes('sysplay') ? -1 : 1;
    let nodes = this.parts,
      value = missing;
    for (const id of ids) {
      const node = nodes.find((node) => node.id === (id | 0));
      value = node ? node.current.sysplay : missing;
      if (node) nodes = node.children;
    }
    return value;
  }

  systemVoiceCandidates() {
    const ids = [];
    visit(this.parts, (node) => {
      if (node.current.sysplay === 1) ids.push(node.id);
      return false;
    });
    return ids;
  }

  get(field, selector = {}) {
    const node = this.find(selector);
    if (!node) {
      if (selector.by === 'idPath') {
        if (field === 'mute') return 0;
        if (this.abi.sound.missingIdPathFields.includes(field)) return -1;
      }
      return missing[field];
    }
    const value = mutable.includes(field) ? node.current[field] : node[field];
    return field === 'mute' && value === -1 ? 0 : value;
  }

  set(field, value, selector = {}) {
    if (!mutable.includes(field)) throw new Error(`Read-only native sound field ${field}`);
    this.requireTree();
    value |= 0;
    const write = (node, restoreDefault) => {
      if (['play', 'sysplay', 'mute'].includes(field) && node.defaults[field] === -1) return;
      node.current[field] = restoreDefault && value === -1 ? node.defaults[field] : value;
    };
    if (selector.by === 'type') {
      const query = String(selector.query ?? '');
      visit(this.parts, (node) => {
        if (node.type === query) write(node, true);
        return false;
      });
    } else {
      const node = this.find(selector);
      if (node) write(node, selector.by === 'idPath');
    }
    this.dirty = true;
  }

  reset(selector = {}) {
    this.requireTree();
    const reset = (node) => {
      for (const field of resetFields) node.current[field] = node.defaults[field];
    };
    if (selector.by === 'type') {
      visit(this.parts, (node) => {
        if (node.type === String(selector.query ?? '')) reset(node);
        return false;
      });
    } else if (selector.by === 'all') {
      visit(this.parts, (node) => {
        reset(node);
        return false;
      });
    } else {
      const node = this.find(selector);
      if (node) reset(node);
    }
    this.dirty = true;
  }

  effectiveVolume(filename, { category = '', voice = false } = {}) {
    this.requireTree();
    if (this.master.current.mute !== -1 && this.master.current.mute) return 0;
    const state = { value: 100 },
      name = lowerSoundName(filename),
      field = voice ? 'voicevol' : 'volume';
    for (const node of this.parts) {
      if (
        category
          ? matchCategory(lowerSoundName(category), name, node, state, field)
          : matchFilename(name, node, state, field, true)
      )
        break;
    }
    return mulPercent(state.value, this.master.current.volume);
  }

  snapshot() {
    return {
      profile: this.profile,
      loaded: this.loaded,
      filename: this.filename,
      master: structuredClone(this.master),
      parts: structuredClone(this.parts),
      groups: [...this.groups].map(([key, value]) => [key, { ...value }]),
      dirty: this.dirty,
    };
  }

  restore(snapshot) {
    if (snapshot.profile !== this.profile)
      throw new Error('Native sound configuration profile differs');
    this.loaded = !!snapshot.loaded;
    this.filename = snapshot.filename;
    this.master = structuredClone(snapshot.master);
    this.parts = structuredClone(snapshot.parts);
    this.groups = new Map(snapshot.groups.map(([key, value]) => [key, { ...value }]));
    this.dirty = !!snapshot.dirty;
    return this;
  }
}

// 71EF80/5CFB50 read this root leaf with an empty-string default. The
// original game tree and the user's mutable tree use the same filename,
// respectively in the resource directory and the user's save directory.
export function nativeSoundConfigurationFilename(startup) {
  return (startup && findNativeXML(startup, 'SOUNDCONFIG')?.text) || '';
}

export function serializeNativeSoundPreferences(configuration) {
  const abi = nativeABI(configuration?.profile);
  configuration.requireTree();
  const document = { name: 'document', text: '', children: [] };
  const put = (path, value) => {
    let at = document;
    for (const name of path) {
      let next = at.children.find((node) => node.name === name);
      if (!next) {
        next = { name, text: '', children: [] };
        at.children.unshift(next);
      }
      at = next;
    }
    at.text = String(value | 0);
  };
  // 71A3F0/5CB230 call the XML setters in this order. Nodes are inserted
  // at the front; repeated paths replace their value without moving them.
  const write = (record, path) => {
    const at = [...path, record.key];
    for (const field of mutable) put([...at, field], record.current[field]);
    for (const child of record.children) write(child, [...at, 'part']);
  };
  write(configuration.master, []);
  for (const record of configuration.parts) write(record, ['PART']);
  const serialize = (node, depth = 0) => {
    const indent = '  '.repeat(depth);
    if (!node.children.length) return `${indent}<${node.name}>${node.text}</${node.name}>\r\n`;
    return `${indent}<${node.name}>\r\n${node.children.map((child) => serialize(child, depth + 1)).join('')}${indent}</${node.name}>\r\n`;
  };
  const encoding = abi.xmlEncoding,
    text = `<?xml version="1.0" encoding="${encoding}"?>\r\n${serialize(document)}`;
  return encoding === 'UTF-8' ? new TextEncoder().encode(text) : encodeCP932(text);
}

export function applyNativeSoundPreferences(configuration, bytes) {
  const abi = nativeABI(configuration?.profile);
  let root;
  try {
    root = parseNativeXML(bytes, abi.xmlEncoding);
  } catch {
    return false;
  }
  configuration.applyPreferences(root);
  return true;
}

export function nativeSoundConfiguration(id, args, machine, services) {
  if (!((id >= 0x3aa && id <= 0x3c4) || [0x3e3, 0x3e8, 0x3e9].includes(id))) return undefined;
  const sound = services.soundConfiguration;
  if (!sound) return undefined;
  nativeABI(sound.profile);
  const expected = id <= 0x3ae ? 0 : 1;
  if (args.length !== expected)
    throw new Error(
      `KCS sound configuration native 0x${id.toString(16)} expects ${expected} arguments`,
    );
  if (id === 0x3aa) return nativeReply(1, Number(sound.loaded));
  if (id <= 0x3ae)
    return nativeReply(
      1,
      sound.get(['volume', 'play', 'sysplay', 'mute'][id - 0x3ab], { by: 'master' }) >>> 0,
    );
  if (!services.format) return undefined;
  const query = services.format(args[0], machine);
  if (id === 0x3c4 || id === 0x3e3)
    return nativeReply(1, sound.effectiveVolume(query, { voice: id === 0x3e3 }) >>> 0);
  if (id === 0x3e8 || id === 0x3e9)
    return nativeReply(
      1,
      sound.get(id === 0x3e8 ? 'sameid' : 'id', { by: 'filename', query }) >>> 0,
    );
  const index = id - 0x3af,
    fields = ['volume', 'play', 'sysplay', 'mastervol', 'voicevol', 'skipvol', 'mute'];
  return nativeReply(
    1,
    sound.get(fields[index % 7], {
      by: ['filename', 'type', 'key'][Math.floor(index / 7)],
      query,
    }) >>> 0,
  );
}
