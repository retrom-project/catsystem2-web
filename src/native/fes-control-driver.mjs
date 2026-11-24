// SPDX-License-Identifier: MPL-2.0
// FES control state owns authored values; real World tasks own input/pixels.
import {
  initializeFESControl,
  isFESControl,
  fesControlLoadPacket,
  fesControlRangePacket,
  setFESControlOrigin,
  setFESControlRect,
  setFESControlValue,
} from './fes-control-model.mjs';
import { JSControlTask, controlTaskBehavior } from './control-task-js.mjs';
import { mapABIMessage } from './abi/messages.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { projectControlPointValue, projectControlThumbRect } from './control-task-model.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { nativeCategoryFilename } from './resource-file.mjs';
import { nativeEngineWord } from './engine-message.mjs';

export { initializeFESControl };

export class FESControlDriver {
  constructor(world, { cacheFor, lookup } = {}) {
    if (typeof cacheFor !== 'function' || typeof lookup !== 'function')
      throw new TypeError('FES controls require canonical cache and collection lookup services');
    Object.assign(this, { world, cacheFor, lookup });
    this.scratch = new WeakMap();
  }
  supports(object) {
    return isFESControl(object);
  }
  state(object) {
    if (!this.supports(object) || object.skinTable?.length !== 4)
      throw new TypeError('FES controls require their pure typed initializer');
    return object;
  }
  workspace(object) {
    let scratch = this.scratch.get(object);
    if (!scratch) {
      scratch = {
        packet: new NativeGraphicsPacket(),
        metadata: new Uint8Array(36),
        rectangle: new Int32Array(4),
      };
      scratch.view = new DataView(scratch.metadata.buffer);
      this.scratch.set(object, scratch);
    }
    return scratch;
  }
  validate(instance, object) {
    this.state(object);
    const record = this.world.objects.objects.get(object.nativeTaskID);
    if (
      !record ||
      record.kind !== object.nativeType + 27 ||
      record.parent !== instance.runtimeID ||
      !(record.implementation instanceof JSControlTask)
    )
      throw new Error('FES control requires its actual owned JS World task');
    return record.implementation;
  }
  projectSlideValue(instance, object, x, y) {
    if (object.nativeType !== 14 && object.nativeType !== 15) return null;
    const runtime = instance.runtime,
      record = this.world.objects.objects.get(instance.runtimeID);
    if (
      runtime?.world !== this.world ||
      !instance.player.publicEventLive(instance, runtime, record, object)
    )
      return null;
    const reference = instance.collection.reference(object);
    if (
      instance.collection.lookup(reference.nameBytes, reference.index) !== object ||
      object.nativeTaskID == null
    )
      return null;
    const task = this.validate(instance, object),
      state = task.model.state,
      metadata = task.resource.metadata[0];
    if (
      object.filePending ||
      !state.loaded ||
      metadata?.length !== 9 ||
      !Number.isInteger(metadata[4]) ||
      !Number.isInteger(metadata[5]) ||
      !Number.isInteger(state.minimumThumb)
    )
      return null;
    const left = object.x | 0,
      top = object.y | 0;
    return projectControlPointValue(
      task.kind,
      [left, top, (left + (object.width | 0)) | 0, (top + (object.height | 0)) | 0],
      { minimum: object.minimum, maximum: object.maximum, pageSize: object.pageSize },
      { thumbSize: [metadata[4], metadata[5]], minimumThumb: state.minimumThumb },
      [x, y],
    );
  }
  projectKnobRect(instance, object) {
    if (object.nativeType !== 14 && object.nativeType !== 15) return null;
    const runtime = instance.runtime,
      record = this.world.objects.objects.get(instance.runtimeID);
    if (
      runtime?.world !== this.world ||
      !instance.player.publicEventLive(instance, runtime, record, object)
    )
      return null;
    const reference = instance.collection.reference(object);
    if (
      instance.collection.lookup(reference.nameBytes, reference.index) !== object ||
      object.nativeTaskID == null
    )
      return null;
    const task = this.validate(instance, object),
      state = task.model.state,
      metadata = task.resource.metadata[0];
    if (
      object.filePending ||
      !state.loaded ||
      metadata?.length !== 9 ||
      !Number.isInteger(metadata[2]) ||
      !Number.isInteger(metadata[3]) ||
      !Number.isInteger(metadata[4]) ||
      !Number.isInteger(metadata[5]) ||
      !Number.isInteger(state.minimumThumb)
    )
      return null;
    const left = object.x | 0,
      top = object.y | 0;
    return projectControlThumbRect(
      task.kind,
      [left, top, (left + (object.width | 0)) | 0, (top + (object.height | 0)) | 0],
      {
        minimum: object.minimum,
        maximum: object.maximum,
        pageSize: object.pageSize,
        value: object.value,
      },
      {
        cropSize: [metadata[2], metadata[3]],
        canvasSize: [metadata[4], metadata[5]],
        minimumThumb: state.minimumThumb,
      },
    );
  }
  async initialize(instance, object, { restoring = false } = {}) {
    this.state(object);
    if (restoring) return object.nativeTaskID == null ? undefined : this.validate(instance, object);
    if (object.deleted) return this.close(object);
    if (object.nativeTaskID == null)
      object.nativeTaskID = await this.world.objects.create({
        kind: object.nativeType + 27,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name:
          object.nativeType === 13
            ? 'FE scroll'
            : object.nativeType === 14
              ? 'FE scroll2'
              : 'FE slider',
      });
    return this.validate(instance, object);
  }
  draw(instance) {
    const id = instance.player.surface,
      draw = this.world.graphics.drawTasks.get(id);
    if (!draw?.state.renderer)
      throw new Error('FES control requires an initialized Draw World surface');
    return id;
  }
  usesLegacyScroll2(object) {
    return (
      object.nativeType === 14 &&
      controlTaskBehavior(this.world.profile).scroll2Protocol === 'legacy'
    );
  }
  send(instance, object, message, w = 0, l = 0, payload = null) {
    const context = payload ? { payload, flags: 1 } : { flags: 1 };
    if (this.usesLegacyScroll2(object))
      return this.world.sendNativeEngine(
        this.world.nativeTaskID(object.nativeTaskID),
        instance.runtimeID,
        mapABIMessage(this.world.profile, 'control', 'raw', message, 41),
        w,
        l,
        context,
      );
    return this.world.sendEngine(object.nativeTaskID, instance.runtimeID, message, w, l, context);
  }
  packet(object, values) {
    const packet = this.workspace(object).packet;
    packet.data.fill(0);
    values.forEach((value, index) => packet.store(index * 4, value));
    return packet;
  }
  async metadata(instance, object, reference) {
    if (!reference) throw new Error('FES control POS2 has no resource reference');
    const cache = this.cacheFor(instance);
    if (typeof cache?.data !== 'function')
      throw new Error('FES control has no owning encoded-byte cache');
    const scratch = this.workspace(object),
      pointer = await cache.data(reference.name);
    try {
      scratch.metadata.fill(0);
      if (pointer)
        nativeImageMetadata(
          this.world.runtime.imageDataBuffers.data(pointer),
          reference.index,
          false,
          scratch.metadata,
        );
      for (let i = 0; i < 4; i++) scratch.rectangle[i] = scratch.view.getInt32(i * 4, true);
      return scratch.rectangle;
    } finally {
      this.world.runtime.imageDataBuffers.releasePointer(pointer);
    }
  }
  async load(instance, object, task) {
    if (object.positionPending) {
      // All three original reference getters consume before metadata I/O.
      object.positionPending = false;
      const rectangle = await this.metadata(instance, object, object.positionReference);
      if (object.nativeType === 13)
        setFESControlOrigin(instance, object, rectangle[0], rectangle[1]);
      else
        setFESControlRect(
          instance,
          object,
          rectangle[0],
          rectangle[1],
          (rectangle[0] + rectangle[2]) | 0,
          (rectangle[1] + rectangle[3]) | 0,
        );
    }
    let plane = null;
    if (object.nativeType !== 13 && object.planeReference) {
      const target = this.lookup(instance, object.planeReference);
      if (target?.nativeType === 4) plane = target;
    }
    const config = fesControlLoadPacket(object, this.draw(instance), plane);
    config.file = nativeCategoryFilename(this.world.game, object.file, 'image') ?? '';
    if (this.usesLegacyScroll2(object)) {
      const filename = encodeCP932(config.file);
      const packet = new NativeGraphicsPacket(new Array(73).fill(0));
      packet.store(0, this.world.nativeTaskID(config.drawID));
      packet.data.set(filename.subarray(0, 259), 4);
      [config.priority, ...config.rect, config.planeX, config.planeY].forEach((word, index) =>
        packet.store(264 + index * 4, word),
      );
      await this.send(instance, object, 368, 0, 0, packet);
    } else await task.load(config);
    if (object.nativeType !== 13)
      object.direction =
        nativeEngineWord(
          await this.send(instance, object, object.nativeType === 14 ? 372 : 364),
          'FES control direction query',
        ) | 0;
    object.filePending = false; // The original consumes after load/query.
  }
  async update(instance, object, { restoring = false } = {}) {
    this.state(object);
    if (restoring) return object.nativeTaskID == null ? undefined : this.validate(instance, object);
    if (object.deleted) return this.close(object);
    const task = await this.initialize(instance, object),
      type = object.nativeType,
      sleeping = !!instance.player.nativeInput?.state.sleeping,
      sleepChanged = sleeping !== !!object.controlSleepMask;
    if (object.filePending) await this.load(instance, object, task);
    if (object.pagePending) {
      const range = this.packet(object, fesControlRangePacket(object));
      object.pagePending = false; // All original range getters consume before send.
      await this.send(instance, object, type === 13 ? 356 : type === 14 ? 370 : 362, 0, 0, range);
    }
    if (object.valuePending) {
      const value = object.value | 0,
        notify = object.valueNotify | 0;
      if (type === 13) object.valuePending = false; // Clear before reentrant FES message 27.
      object.valueNotify = 0; // All notify getters consume before the send.
      await this.send(instance, object, type === 13 ? 357 : type === 14 ? 371 : 363, notify, value);
      if (type !== 13) object.valuePending = false; // Clear after FES message 27 returns.
    }
    if (type !== 13 && object.alphaPending) {
      const alpha = object.alpha;
      object.alphaPending = false;
      await this.send(instance, object, type === 14 ? 374 : 365, 0, alpha);
    }
    if (object.dirty || sleepChanged) {
      const shown = Number(object.disp && !sleeping),
        enabled = Number(object.enable && !sleeping);
      if (type === 13) {
        await this.send(instance, object, 354, 0, shown);
        await this.send(instance, object, 355, 0, Number(enabled && shown));
        await this.send(instance, object, 358, 0, object.alpha);
      } else {
        await this.send(instance, object, type === 14 ? 369 : 361, 0, enabled);
        await this.send(instance, object, type === 14 ? 373 : 360, 0, shown);
      }
      object.dirty = false;
    }
    object.controlSleepMask = sleeping;
    if (type !== 13 && object.tablePending) {
      object.tablePending = false; // Getter consumes once, before the four writes.
      for (let index = 0; index < 4; index++)
        await this.send(instance, object, type === 14 ? 375 : 366, index, object.skinTable[index]);
      await this.send(instance, object, type === 14 ? 376 : 367);
    }
  }
  async message(record, player, words, context = {}) {
    const [sender, message, , value] = words;
    if (message !== 27 && message !== 28)
      throw new Error('FES control event requires canonical27 or28');
    if (!player?.root) return false;
    const instance = player.root,
      senderWorldID = context.nativeSenderWorldID ?? this.world.resolveTaskID(sender, record.id);
    // The owning FESTask selects its private variable context before this hook.
    await player.nativeInput.updateMouse();
    for (const object of instance.objects) {
      if (!this.supports(object) || object.deleted || object.nativeTaskID !== senderWorldID)
        continue;
      if (message === 27) {
        setFESControlValue(object, value, 0);
        await player.nativeEvent(instance.collection.reference(object), 'SCRL_P');
      } else
        await player.nativeEvent(
          instance.collection.reference(object),
          value === 0 ? 'UNFOCUS' : 'FOCUS',
        );
    }
    return true;
  }
  async close(object) {
    if (object.nativeTaskID != null) {
      if (this.world.objects.objects.has(object.nativeTaskID))
        await this.world.objects.destroy(object.nativeTaskID);
      object.nativeTaskID = null;
    }
  }
}
