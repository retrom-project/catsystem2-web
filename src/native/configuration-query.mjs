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
function voiceText(configuration, row, offset, length) {
  const start = configuration.voiceRecordByte(row) + offset;
  return nativeDataString(configuration.blocks[0].subarray(start, start + length));
}
function directoryIndex(configuration, path) {
  const directory = withoutExtension(path);
  const { count, archiveByte } = configuration.voiceLayout;
  for (let i = 0; i < count; i++)
    if (equal(directory, voiceText(configuration, i, archiveByte, 32))) return i;
  return -1;
}
function legacyIndex(configuration, filename) {
  const slash = separator(filename);
  if (slash > 0) {
    const index = directoryIndex(configuration, filename.subarray(0, slash));
    if (index >= 0) return index;
  }
  const name = lower(filename),
    { count, headBytes } = configuration.voiceLayout;
  for (let i = 0; i < count; i++) {
    const head = voiceText(configuration, i, 40, headBytes);
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
    { count, headBytes, groupByte } = configuration.voiceLayout,
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
  if (configuration.voiceMuted()) return 0;
  folded(filename);
  let slash = 0,
    row = -1;
  for (let at = 0; at < filename.length; at++) {
    if (pair(filename, at)) at++;
    else if (filename[at] === 47 || filename[at] === 92) slash = at;
  }
  if (slash) row = directoryIndex(configuration, filename.subarray(0, slash));
  if (row < 0) {
    const last = separator(filename),
      name = folded(filename.subarray(last > 0 ? last + 1 : 0));
    for (let i = 0; i < count; i++) {
      const head = voiceText(configuration, i, 40, headBytes);
      if (head.length && head.length <= name.length && same(head, name.subarray(0, head.length))) {
        row = i;
        break;
      }
    }
  }
  const groupID =
      row < 0 ? -1 : data.getInt32(configuration.voiceRecordByte(row) + groupByte, true),
    group =
      groupID === -1 ? null : configuration.soundGroups.find((value) => (value.id | 0) === groupID);
  if (!group) return 100;
  const aliases = nativeABIBehavior(configuration.profile, 'sound.legacyVolumeAliases'),
    key = Object.keys(aliases).find((name) => equal(encodeCP932(group.type), encodeCP932(name))),
    bank = key === undefined ? undefined : aliases[key];
  return bank === undefined
    ? 100
    : configuration.voiceMuted(bank)
      ? 0
      : data.getUint32(bank * 4, true);
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
    index = legacyIndex(configuration, filename),
    { archiveByte, groupByte } = configuration.voiceLayout;
  if (id === 0x34c) return value(index);
  if (id === 0x25e || id === 0x25f)
    return value(
      index < 0
        ? 0
        : words.getUint32(configuration.voiceRecordByte(index) + (id === 0x25e ? 0 : 36), true),
    );
  if (id === 0x25d) {
    if (configuration.voiceMuted()) return value(0);
    const slash = separator(filename),
      directory = slash > 0 ? directoryIndex(configuration, filename.subarray(0, slash)) : -1,
      row = directory >= 0 ? directory : legacyIndex(configuration, filename.subarray(slash + 1)),
      groupID = row < 0 ? -1 : words.getInt32(configuration.voiceRecordByte(row) + groupByte, true),
      group =
        groupID === -1
          ? null
          : configuration.soundGroups.find((group) => (group.id | 0) === groupID);
    if (!group) return value(100);
    const type = encodeCP932(group.type),
      aliases = nativeABIBehavior(configuration.profile, 'sound.legacyVolumeAliases'),
      key = Object.keys(aliases).find((name) => equal(type, encodeCP932(name))),
      bank = key === undefined ? undefined : aliases[key];
    return value(
      bank === undefined
        ? 100
        : configuration.voiceMuted(bank)
          ? 0
          : words.getUint32(bank * 4, true),
    );
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
        : voiceText(configuration, index, archiveByte, 32);
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
