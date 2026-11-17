// SPDX-License-Identifier: MPL-2.0
import { nativeABI, nativeABIBehavior } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import {
  nativeDataArgument,
  nativeDataFormat,
  nativeDataPair,
  nativeDataString,
} from './data-text.mjs';

export const NATIVE_CONFIGURATION_QUERY_IDS = Object.freeze([
  0x24d, 0x25d, 0x25e, 0x25f, 0x2a2, 0x34c,
]);
const fold = (byte) => (byte >= 65 && byte <= 90 ? byte + 32 : byte);
function equal(a, b) {
  return a.length === b.length && a.every((byte, i) => fold(byte) === fold(b[i]));
}
function lower(bytes) {
  const result = bytes.slice();
  for (let at = 0; at < result.length; at++) {
    if (nativeDataPair(result, at)) at++;
    else result[at] = fold(result[at]);
  }
  return result;
}
const separator = (bytes) => Math.max(bytes.lastIndexOf(47), bytes.lastIndexOf(92));
function withoutExtension(bytes) {
  const dot = bytes.lastIndexOf(46);
  return dot > separator(bytes) ? bytes.subarray(0, dot) : bytes;
}
function directoryIndex(voice, path) {
  const directory = withoutExtension(path);
  for (let i = 0; i < 48; i++)
    if (equal(directory, nativeDataString(voice.subarray(104 + i * 116, 136 + i * 116)))) return i;
  return -1;
}
function legacyIndex(voice, filename) {
  const slash = separator(filename);
  if (slash > 0) {
    const index = directoryIndex(voice, filename.subarray(0, slash));
    if (index >= 0) return index;
  }
  const name = lower(filename);
  for (let i = 0; i < 48; i++) {
    const head = nativeDataString(voice.subarray(60 + i * 116, 100 + i * 116));
    if (head.length && head.length <= name.length && head.every((byte, at) => name[at] === byte))
      return i;
  }
  return -1;
}
function flatSoundGain(configuration, filename, policy) {
  if (
    policy.maximumBytes !== 255 ||
    !['wide', 'standard'].includes(policy.pairs) ||
    policy.caseFold !== 'c-locale-ascii' ||
    policy.lastSeparatorZero !== 'retain-name' ||
    policy.extensionScan !== 'raw-backwards' ||
    policy.headComparison !== 'raw-byte-prefix' ||
    policy.directoryComparison !== 'c-locale-bytewise'
  )
    throw new Error('Unreviewed flat sound filename policy');
  if (filename.length > policy.maximumBytes)
    throw new Error('Unreviewed flat sound filename exceeds its 255-byte CString domain');
  const voice = configuration.blocks[0],
    data = new DataView(voice.buffer, voice.byteOffset, voice.byteLength),
    word = (index) => data.getUint32(index * 4, true),
    pair = (bytes, at) => nativeDataPair(bytes, at, policy.pairs),
    folded = (bytes) => {
      const result = bytes.slice();
      for (let at = 0; at < result.length; at++) {
        if (pair(result, at)) {
          at++;
          continue;
        }
        if (result[at] >= 0x80 && !(result[at] >= 0xa1 && result[at] <= 0xdf))
          throw new Error('Unreviewed flat sound filename byte/locale domain');
        result[at] = fold(result[at]);
      }
      return result;
    },
    same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
  // The wrapper always formats into its fixed scratch before the getter's mute gate.
  if (word(1402)) return 0;
  folded(filename);
  let slash = 0,
    row = -1;
  for (let at = 0; at < filename.length; at++) {
    if (pair(filename, at)) at++;
    else if (filename[at] === 47 || filename[at] === 92) slash = at;
  }
  if (slash) {
    const directory = withoutExtension(filename.subarray(0, slash));
    for (let i = 0; i < 48; i++) {
      const name = nativeDataString(voice.subarray(104 + i * 116, 136 + i * 116));
      if (equal(directory, name)) {
        row = i;
        break;
      }
    }
  }
  if (row < 0) {
    const last = separator(filename),
      name = folded(filename.subarray(last > 0 ? last + 1 : 0));
    for (let i = 0; i < 48; i++) {
      const head = nativeDataString(voice.subarray(60 + i * 116, 100 + i * 116));
      if (head.length && head.length <= name.length && same(head, name.subarray(0, head.length))) {
        row = i;
        break;
      }
    }
  }
  const groupID = row < 0 ? -1 : word(25 + row * 29) | 0,
    group =
      groupID === -1 ? null : configuration.soundGroups.find((value) => (value.id | 0) === groupID);
  if (!group) return 100;
  const aliases = nativeABIBehavior(configuration.profile, 'sound.legacyVolumeAliases'),
    key = Object.keys(aliases).find((name) => equal(encodeCP932(group.type), encodeCP932(name))),
    bank = key === undefined ? undefined : aliases[key];
  return bank === undefined ? 100 : word(1403 + bank) ? 0 : word(bank);
}

function soundArchive(nodes, filename, encode) {
  for (const node of nodes) {
    const head = nativeDataString(encode(node.head));
    if (
      head.length &&
      head.length <= filename.length &&
      head.every((byte, i) => filename[i] === byte)
    )
      return encode(node.int);
    const result = soundArchive(node.children ?? [], filename, encode);
    if (result !== null) return result;
  }
  return null;
}
export function nativeConfigurationQuery(id, args, machine, services) {
  const configuration = services.configuration,
    value = (word) => nativeReply(1, word),
    arg = (index) => nativeDataArgument(args, machine, index);
  if (id === 0x24d) {
    const first = arg(0),
      second = arg(1);
    machine.store(first, configuration.queryWords[0]);
    machine.store(second, configuration.queryWords[1]);
    return nativeReply(2);
  }
  const filename = nativeDataFormat(args, machine, services, 0);
  if (filename === null)
    throw new Error('Native configuration query reads an unmapped format string');
  if (id === 0x25d) {
    const policy = nativeABIBehavior(configuration.profile, 'sound.filenamePolicy');
    if (policy.classification === 'cp932-pair-directory')
      return value(flatSoundGain(configuration, filename, policy));
    if (policy.classification !== 'ascii-byte-directory')
      throw new Error('Unreviewed flat sound filename classification');
  }
  const voice = configuration.blocks[0],
    words = new DataView(voice.buffer, voice.byteOffset, voice.byteLength),
    word = (index) => words.getUint32(index * 4, true),
    index = legacyIndex(voice, filename);
  if (id === 0x34c) return value(index);
  if (id === 0x25e || id === 0x25f)
    return value(index < 0 ? 0 : word((id === 0x25e ? 5 : 14) + 29 * index));
  if (id === 0x25d) {
    if (word(1402)) return value(0);
    const slash = separator(filename),
      directory = slash > 0 ? directoryIndex(voice, filename.subarray(0, slash)) : -1,
      row = directory >= 0 ? directory : legacyIndex(voice, filename.subarray(slash + 1)),
      groupID = row < 0 ? -1 : word(25 + row * 29) | 0,
      group =
        groupID === -1
          ? null
          : configuration.soundGroups.find((group) => (group.id | 0) === groupID);
    if (!group) return value(100);
    const type = encodeCP932(group.type),
      aliases = nativeABIBehavior(configuration.profile, 'sound.legacyVolumeAliases'),
      key = Object.keys(aliases).find((name) => equal(type, encodeCP932(name))),
      bank = key === undefined ? undefined : aliases[key];
    return value(bank === undefined ? 100 : word(1403 + bank) ? 0 : word(bank));
  }
  const category = nativeDataFormat(args, machine, services, 1);
  if (category === null) throw new Error('Native archive query reads an unmapped category format');
  const abi = nativeABI(services.world.profile),
    encode = (text) =>
      text instanceof Uint8Array
        ? text
        : abi.xmlEncoding === 'Shift_JIS'
          ? encodeCP932(String(text))
          : new TextEncoder().encode(String(text)),
    resources = services.world.game.nativeResources?.entries ?? [],
    sound = services.world.soundConfiguration;
  let archive = category;
  if (equal(category, encodeCP932('sound'))) {
    archive = sound.loaded
      ? soundArchive(sound.parts, lower(filename), encode)
      : index < 0
        ? null
        : nativeDataString(voice.subarray(104 + index * 116, 136 + index * 116));
    if (archive === null) return value(-1);
  }
  for (let i = 0; i < 128; i++)
    if (equal(archive, nativeDataString(encode(resources[i]?.name ?? '')))) return value(i);
  return value(-1);
}
export function installNativeConfigurationQueries(world) {
  for (const id of NATIVE_CONFIGURATION_QUERY_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeConfigurationQuery(id, args, machine, world.runtime.services),
    );
}
