// SPDX-License-Identifier: MPL-2.0
// Main3DF/3E0/3E2 store, restore and branch scene-local checkpoint chains.
// Selectors read the current JS configuration and resource XML.
import { Binary } from '../binary.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeABI } from './abi/index.mjs';
import { parseNativeXML, findNativeXML } from './xml.mjs';
import { parseNativeInteger } from './standard.mjs';
import { NativeStringBank } from './string-bank.mjs';
import { serializeStringBank, importStringBank } from './persistence.mjs';
import { nativeDeflate, nativeInflate } from './zlib.mjs';

const empty = new Uint8Array();
function bounded(size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0x10000000)
    throw new RangeError('Native scene checkpoint exceeds its resource limit');
  return size;
}
export async function appendSceneCheckpoint(history, position, variables, strings, selection) {
  const bank = new NativeStringBank();
  for (const id of selection.strings) {
    if (!strings) throw new Error('Native scene checkpoint requires its caller string bank');
    bank.setBytes(id, strings.getBytes(id) ?? empty);
  }
  const stringBytes = serializeStringBank(bank),
    variableBytes = bounded(selection.variables.length * 8),
    payload = new Uint8Array(bounded(variableBytes + stringBytes.length)),
    view = new DataView(payload.buffer);
  selection.variables.forEach((id, i) => {
    if (!variables) throw new Error('Native scene checkpoint requires its caller variable bank');
    view.setUint32(i * 8, id, true);
    view.setUint32(i * 8 + 4, variables.get(id), true);
  });
  payload.set(stringBytes, variableBytes);
  const encoded = await nativeDeflate(payload, new Uint8Array(bounded(payload.length * 2)));
  if (encoded.result < 0 || encoded.result > encoded.bytes.length)
    throw new Error('Native scene checkpoint compression failed');
  const previous = history.path.at(-1)?.extra ?? empty,
    headerSize = 20 + encoded.result,
    bytes = new Uint8Array(bounded(headerSize + previous.length)),
    out = new DataView(bytes.buffer);
  [
    previous.length ? headerSize : 0,
    headerSize,
    variableBytes,
    stringBytes.length,
    position >>> 0,
  ].forEach((n, i) => out.setUint32(i * 4, n, true));
  bytes.set(encoded.bytes.subarray(0, encoded.result), 20);
  bytes.set(previous, headerSize);
  if (history.path.length) history.path.at(-1).extra = bytes;
}
export async function restoreSceneCheckpoint(
  history,
  index,
  position,
  variables,
  strings,
  selection,
  onSelected = () => {},
) {
  const origin = index | 0;
  for (let current = origin; current >= 0; current--) {
    const bytes = history.path[current]?.extra;
    if (!bytes?.length) continue;
    const b = new Binary(bytes, 'Native chained scene checkpoint');
    let at = 0,
      found = true;
    while (current === origin && (b.u32(at + 16) | 0) > (position | 0)) {
      const next = b.u32(at);
      if (!next) {
        found = false;
        break;
      }
      const offset = at + next;
      if (offset <= at || offset + 20 > bytes.length)
        throw new Error('Native scene checkpoint chain crosses its allocation');
      at = offset;
    }
    if (!found) continue;
    const selected = b.u32(at + 16);
    onSelected(current, selected);
    const variableSize = b.u32(at + 8),
      stringSize = b.u32(at + 12),
      payloadSize = bounded(variableSize + stringSize),
      compressedSize = b.u32(at + 4) - 20;
    if (compressedSize < 0) throw new Error('Invalid native scene checkpoint header');
    const decoded = await nativeInflate(
      b.range(at + 20, compressedSize),
      new Uint8Array(payloadSize),
    );
    if (decoded.result !== payloadSize)
      throw new Error('Invalid native scene checkpoint compressed payload');
    const payload = new Binary(decoded.bytes, 'Native scene checkpoint bank payload');
    for (let offset = 0; offset < variableSize; offset += 8) {
      if (!variables) throw new Error('Native scene checkpoint requires its caller variable bank');
      variables.set(payload.u32(offset), payload.u32(offset + 4));
    }
    const bank = new NativeStringBank();
    importStringBank(bank, payload.range(variableSize, stringSize));
    for (const id of selection.strings) {
      if (!strings) throw new Error('Native scene checkpoint requires its caller string bank');
      strings.setBytes(id, bank.getBytes(id) ?? empty);
    }
    return true;
  }
  return false;
}

export function pruneSceneCheckpoints(history, index, position) {
  const atIndex = index >>> 0,
    entry = history.path[atIndex],
    extra = entry?.extra;
  if (extra?.length) {
    const b = new Binary(extra, 'Native scene checkpoint branch');
    let at = 0,
      older = true;
    while ((b.u32(at + 16) | 0) >= (position | 0)) {
      const next = b.u32(at);
      if (!next) {
        older = false;
        break;
      }
      const following = at + next;
      if (following <= at || following + 20 > extra.length)
        throw new Error('Native scene checkpoint branch crosses its allocation');
      at = following;
    }
    // 5B1330 uses SetExDataToPath, which writes the *last* path entry.
    // Finding no older checkpoint deliberately leaves all extra data intact.
    if (older && at > 0) history.path.at(-1).extra = extra.slice(at);
  }
  if (entry) entry.value = position >>> 0;
  const next = (atIndex + 1) >>> 0;
  if (next !== 0xffffffff) history.path.splice(Math.max(0, next | 0));
}

export class NativeSceneCheckpoints {
  constructor(world) {
    this.world = world;
  }
  async selection(filename) {
    const { world } = this,
      variables = [],
      strings = [],
      ranges = world.configuration.variableRanges.local;
    for (let range = 0; range < 8; range++) {
      const first = ranges[range * 2] | 0,
        end = (first + ranges[range * 2 + 1]) | 0;
      bounded(Math.max(0, end - first) * 4);
      for (let index = first; index < end; index++) variables.push(index >>> 0);
    }
    if (filename !== null) {
      const bytes = await world.runtime.read(filename, 'config');
      if (bytes) {
        try {
          const root = parseNativeXML(bytes, nativeABI(world.profile).xmlEncoding),
            text = findNativeXML(root, 'localstr')?.text ?? '';
          for (const token of text.split(',').filter(Boolean))
            strings.push((parseNativeInteger(token) ?? 0) >>> 0);
        } catch (error) {
          world.runtime.services.diagnostic?.({ resource: filename, error: error.message });
        }
      }
    }
    return { strings, variables };
  }
  async apply(id, args, machine, task) {
    if (args.length !== (id === 0x3e0 ? 4 : 3))
      throw new Error(`Native scene checkpoint 0x${id.toString(16)} has invalid arguments`);
    // 3E0 translates both VM destinations before testing its scene handle.
    const region = (address) => {
      try {
        return machine.region(address >>> 0, 1);
      } catch {
        return null;
      }
    };
    if (id === 0x3e0) {
      region(args[1]);
      region(args[2]);
    }
    const scene = args[0] ? this.world.runtime.handles.get(args[0], 'scene-data') : null;
    if (!scene) return nativeReply(id === 0x3e0 ? 1 : 2, id === 0x3e0 ? 0 : undefined);
    if (id === 0x3e2) {
      await this.selection(null);
      pruneSceneCheckpoints(scene.history, args[1], args[2]);
      return nativeReply(2);
    }
    const selection = await this.selection(
        this.world.runtime.services.format(args.at(-1), machine),
      ),
      variables = this.world.runtime.variableBank(task, false),
      strings = this.world.runtime.stringBank(task, false);
    if (id === 0x3df) {
      await appendSceneCheckpoint(scene.history, args[1], variables, strings, selection);
      return nativeReply(2);
    }
    const ok = await restoreSceneCheckpoint(
      scene.history,
      machine.load(args[1]),
      machine.load(args[2]),
      variables,
      strings,
      selection,
      (index, position) => {
        machine.store(args[1], index);
        machine.store(args[2], position);
      },
    );
    return nativeReply(1, Number(ok));
  }
}
export function installNativeSceneCheckpoints(world) {
  const checkpoints = new NativeSceneCheckpoints(world);
  for (const id of [0x3df, 0x3e0, 0x3e2])
    world.runtime.register('main', id, (args, machine, task) =>
      checkpoints.apply(id, args, machine, task),
    );
}
