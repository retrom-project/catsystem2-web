// SPDX-License-Identifier: MPL-2.0
// CsImage's non-plane, data-only slice shares the existing bitmap authority.
import { scriptError } from '../javascript/program.mjs';
import { canonicalMessage } from './control-task.mjs';

export class SDKJavaScriptImages {
  constructor(world, owner) {
    this.world = world;
    this.owner = owner;
    this.closed = false;
  }
  records() {
    return [...this.world.runtime.handles.records].filter(
      ([, record]) => record.type === 'javascript-image' && record.value.owner === this.owner.id,
    );
  }
  image(reference) {
    if (this.closed) throw new Error('JavaScript image owner is closed');
    if (
      !reference ||
      Object.keys(reference).length !== 1 ||
      !Number.isSafeInteger(reference.hostObject)
    )
      throw new Error('Invalid JavaScript image reference');
    const image = this.world.runtime.handles.get(reference.hostObject, 'javascript-image');
    if (image.owner !== this.owner.id) throw new Error('JavaScript image belongs to another owner');
    return image;
  }
  host(operation, args, location) {
    if (this.closed) throw new Error('JavaScript image owner is closed');
    const unsupported = () => {
      throw scriptError(
        'Unsupported JavaScript host import',
        location,
        'CsImage arguments or method',
      );
    };
    if (operation.construct === 'CsImage') {
      if (args.length) return unsupported();
      const occupied = new Set(this.records().map(([, record]) => record.value.slot));
      let slot = 1;
      while (occupied.has(slot)) slot++;
      const handle = this.world.runtime.handles.add('javascript-image', {
        owner: this.owner.id,
        slot,
        bitmap: 0,
        baseType: 1,
        plane: 0,
        x: 0,
        y: 0,
        anchorX: 0,
        anchorY: 0,
      });
      return { value: { hostObject: handle } };
    }
    const image = this.image(operation.receiver);
    if (operation.member === 'setBaseType') {
      if (args.length > 1 || (args.length && !['string', 'number'].includes(typeof args[0])))
        return unsupported();
      if (
        typeof args[0] === 'number' &&
        (!Number.isInteger(args[0]) || args[0] < -0x80000000 || args[0] > 0x7fffffff)
      )
        return unsupported();
      image.baseType = args.length && (args[0] === 'scene' || args[0] === 0) ? 0 : 1;
      return { value: undefined };
    }
    if (
      operation.member !== 'load' ||
      args.length < 1 ||
      args.length > 2 ||
      typeof args[0] !== 'string' ||
      (args.length === 2 && args[1] !== 0)
    )
      return unsupported();
    return { wait: { image: operation.receiver.hostObject, name: args[0] } };
  }
  async complete(request) {
    const reference = { hostObject: request.image },
      image = this.image(reference);
    if (image.bitmap) {
      const previous = image.bitmap;
      image.bitmap = 0;
      await this.world.graphics.images.release(previous);
      if (this.closed) throw new Error('JavaScript image owner is closed');
    }
    const bitmap = await this.world.imageComposites.load(request.name);
    if (this.closed || this.world.runtime.handles.records.get(request.image)?.value !== image) {
      if (bitmap) await this.world.graphics.images.release(bitmap);
      throw new Error('JavaScript image owner is closed');
    }
    image.bitmap = bitmap;
    if (bitmap) {
      const value = this.world.graphics.images.get(bitmap).state;
      if (image.baseType) {
        image.anchorX = Math.fround(value.baseX | 0);
        image.anchorY = Math.fround(value.baseY | 0);
        image.x = Math.fround(image.anchorX - Math.fround(value.offsetX >>> 0));
        image.y = Math.fround(image.anchorY - Math.fround(value.offsetY >>> 0));
        value.offsetX = value.offsetY = 0;
        value.canvasWidth = value.width;
        value.canvasHeight = value.height;
      } else {
        image.anchorX = image.anchorY = 0;
        image.x = Math.fround(value.baseX | 0);
        image.y = Math.fround(value.baseY | 0);
      }
    }
    return Boolean(bitmap);
  }
  validate(cells) {
    const slots = new Set();
    for (const [, record] of this.records()) {
      const image = record.value;
      if (
        !Number.isSafeInteger(image.slot) ||
        image.slot < 1 ||
        slots.has(image.slot) ||
        ![0, 1].includes(image.baseType) ||
        image.plane !== 0 ||
        ![image.x, image.y, image.anchorX, image.anchorY].every(Number.isFinite)
      )
        throw new Error('Invalid JavaScript image checkpoint');
      slots.add(image.slot);
      if (image.bitmap) this.world.graphics.images.get(image.bitmap);
    }
    for (const value of cells) if (value?.hostObject !== undefined) this.image(value);
  }
  async close(link) {
    if (this.closed) return;
    this.closed = true;
    for (const [handle, record] of this.records()) {
      const image = record.value;
      // Native cleanup sends this even when no explicit plane ever published a draw item.
      // Slot return and bitmap release below do not depend on its transport result.
      if (link && this.world.objects.objects.has(link.script)) {
        await this.world.sendNativeEngine(
          this.world.nativeTaskID(link.script),
          this.owner.id,
          canonicalMessage(
            this.world.profile,
            this.world.objects.objects.get(link.script).kind,
            0x114,
          ),
          image.slot,
          0,
          { flags: 0 },
        );
      }
      this.world.runtime.handles.release(handle, 'javascript-image');
      if (image.bitmap) await this.world.graphics.images.release(image.bitmap);
    }
  }
}
