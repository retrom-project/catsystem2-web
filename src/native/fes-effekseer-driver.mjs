// SPDX-License-Identifier: MPL-2.0
// Raw36 drives the real kind61 child. The resource entry owns task identity;
// each operation borrows its caller capability without retaining it as state.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeDataString } from './data-text.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { fesPlaneRenderingState } from './fes-plane-driver.mjs';
import { floatBits } from '../effekseer/math43.mjs';

const decoder = new TextDecoder('shift_jis');
const fold = (byte) => (byte >= 65 && byte <= 90 ? byte + 32 : byte);
function capable(profile) {
  if (!nativeABI(profile).capabilities.effekseerTask)
    throw new Error('The registered ABI has no FES EFKPLANE capability');
}
export function initializeFESEffekseer(object) {
  object.efkFileBytes = new Uint8Array();
  object.sizeDirty = true;
  object.playValue = 0;
  object.playDirty = false;
  Object.defineProperty(object, 'resourceFile', {
    configurable: true,
    enumerable: false,
    get() {
      return decoder.decode(this.efkFileBytes);
    },
  });
}
export function setFESEffekseerFile(profile, object, name, source) {
  capable(profile);
  if (object.nativeType !== 36) throw new TypeError('Expected FES EFKPLANE');
  if (nativeABI(profile).fes.configurationMessage.filenameComparison !== 'c-locale-ascii')
    throw new Error('Unrecovered FES EFK filename locale comparison');
  const bytes = nativeDataString(source ?? encodeCP932(name));
  if (bytes.length >= 256) throw new RangeError('FES EFK filename exceeds its 256-byte field');
  if (
    object.efkFileBytes.length === bytes.length &&
    bytes.every((b, i) => fold(b) === fold(object.efkFileBytes[i]))
  )
    return;
  object.efkFileBytes = new Uint8Array(bytes);
  object.resourcePending = true;
}
export function requestFESEffekseerPlay(object) {
  if (object.nativeType !== 36) throw new TypeError('Expected FES EFKPLANE');
  // Both original FES verbs call the same setter. Task572 is a separate API.
  object.playValue = 1;
  object.playDirty = true;
}

export class FESEffekseerDriver {
  constructor(world, { metadata } = {}) {
    if (typeof metadata !== 'function')
      throw new TypeError('EFK POS2 requires its existing image metadata service');
    Object.assign(this, { world, metadata });
  }
  validateEntry(instance, object, entry) {
    capable(this.world.profile);
    if (entry.previousTaskID == null) return;
    const task = this.world.objects.objects.get(entry.previousTaskID);
    if (
      !task ||
      task.kind !== 61 ||
      task.parent !== instance.runtimeID ||
      (object?.nativeType === 36 && object.nativeTaskID !== entry.previousTaskID)
    )
      throw new Error('FES EFK checkpoint has no matching owned kind61 task');
  }
  async update(instance, object, { previousTaskID = null, executorEntry, bindTask } = {}) {
    capable(this.world.profile);
    if (object.nativeType !== 36) throw new TypeError('Expected FES EFKPLANE');
    if (typeof bindTask !== 'function')
      throw new TypeError('FES EFK requires its owning resource entry');
    const world = this.world;
    let taskID = previousTaskID;
    const live = () =>
      !instance.runtime.closed && instance.collection.graph.get(object.handle) === object;
    if (!live()) return;
    if (object.sizeDirty) {
      if (taskID !== null && world.objects.objects.has(taskID))
        await world.objects.destroy(taskID, instance.runtimeID);
      if (!live()) return;
      taskID = await world.objects.create({
        kind: 61,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: 'EfkPlane',
      });
      object.nativeTaskID = taskID;
      object.sizeDirty = false;
      if (!bindTask(taskID) || !live()) {
        await world.objects.release(taskID);
        return;
      }
    }
    if (taskID === null) return;
    const task = world.objects.objects.get(taskID);
    if (!task || task.kind !== 61 || task.parent !== instance.runtimeID)
      throw new Error('FES EFK driver lost its owned kind61 task');
    const active = () =>
      live() &&
      world.objects.objects.get(taskID) === task &&
      task.state === 'active' &&
      !task.destroyRequested;
    const send = (id, payload = null, l = 0, w = 0, flags = 1) =>
      world.sendEngine(taskID, instance.runtimeID, id, w, l, {
        executorEntry,
        flags,
        ...(payload ? { payload } : {}),
      });
    if (object.resourcePending) {
      // The original filename getter clears pending before dispatching569.
      object.resourcePending = false;
      const name = object.resourceFile;
      await send(569, { string: () => name }, 0, 0, 0);
      if (!active()) return;
    }
    if (object.dirty) {
      if (object.positionPending) {
        object.positionPending = false;
        const metadata = await this.metadata(instance, object, object.positionReference);
        if (!active()) return;
        object.x = Math.fround(metadata.getInt32(0, true));
        object.y = Math.fround(metadata.getInt32(4, true));
      }
      const transform = fesPlaneRenderingState(instance, object);
      const packet = new NativeGraphicsPacket();
      const vector = (values) => {
        values.forEach((n, i) => packet.store(i * 4, floatBits(n)));
        return packet;
      };
      await send(51, vector(transform.position));
      if (!active()) return;
      await send(49, vector([transform.base[0], transform.base[1], Math.fround(object.pri)]));
      if (!active()) return;
      await send(66, vector(transform.scale));
      if (!active()) return;
      await send(57, vector(transform.matrix));
      if (!active()) return;
      await send(59, null, object.color, 1);
      if (!active()) return;
      await send(47, null, object.displayValue | 0);
      if (!active()) return;
      object.dirty = false;
    }
    if (object.playDirty) {
      // Read-and-clear precedes571/572; a failed operation is not replayed.
      object.playDirty = false;
      await send(object.playValue ? 571 : 572);
    }
  }
}
