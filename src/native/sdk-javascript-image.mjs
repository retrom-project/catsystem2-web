// SPDX-License-Identifier: MPL-2.0
// CsImage's non-plane, data-only slice shares the existing bitmap authority.
import { scriptError } from '../javascript/program.mjs';
import { canonicalMessage } from './control-task.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { floatBits } from '../kcs.mjs';
import { MOTION_ABI, motionVector } from '../motion/abi.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';

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
  checkOpen() {
    if (
      this.closed ||
      this.owner.implementation?.closed ||
      this.world.objects.objects.get(this.owner.id) !== this.owner
    )
      throw new Error('JavaScript image owner is closed');
  }
  plane(handle) {
    const value = this.world.runtime.handles.get(handle, 'javascript-plane');
    return this.owner.implementation.planes.child(value, true).implementation.graph;
  }
  drawing(link = this.owner.implementation.link) {
    const target = this.world.objects.objects.get(link?.target);
    if (
      target?.kind !== 15 ||
      target.namespace !== this.owner.namespace ||
      !this.world.graphics.drawTasks.has(target.id)
    )
      throw new Error('JavaScript image requires its owned Draw target');
    return target;
  }
  image(reference) {
    this.checkOpen();
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
    this.checkOpen();
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
        position: [0, 0, 0],
        display: 0,
        dirty: false,
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
    if (operation.member === 'setPlane') {
      const link = this.owner.implementation.link;
      if (args.length > 1 || (args.length && image.slot === 0)) return unsupported();
      this.drawing(link);
      if (args.length) {
        const reference = args[0];
        if (
          !reference ||
          Object.keys(reference).length !== 1 ||
          !Number.isSafeInteger(reference.hostObject)
        )
          return unsupported();
        this.plane(reference.hostObject);
      }
      return {
        wait: {
          image: operation.receiver.hostObject,
          operation: 'plane',
          boundPlane: args.length ? args[0].hostObject : 0,
        },
      };
    }
    if (operation.member === 'setPos') {
      if (
        args.length > 3 ||
        !args.every((value) => typeof value === 'number' && Number.isFinite(Math.fround(value)))
      )
        return unsupported();
      return {
        wait: {
          image: operation.receiver.hostObject,
          operation: 'position',
          args: args.map(Math.fround),
        },
      };
    }
    if (operation.member === 'setDisp' || (operation.assignment && operation.member === 'disp')) {
      if (args.length > 1 || (args.length && ![false, true, 0, 1].includes(args[0])))
        return unsupported();
      return {
        wait: {
          image: operation.receiver.hostObject,
          operation: 'display',
          value: args.length ? Number(Boolean(args[0])) : image.display,
        },
      };
    }
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
    return { wait: { image: operation.receiver.hostObject, operation: 'load', name: args[0] } };
  }
  async complete(request) {
    const reference = { hostObject: request.image },
      image = this.image(reference);
    if (request.operation === 'plane') {
      if (request.boundPlane) {
        this.plane(request.boundPlane);
        image.plane = request.boundPlane;
        image.dirty = true;
      } else {
        if (image.slot)
          await this.world.sendNativeEngine(
            this.drawing().nativeID,
            this.owner.id,
            canonicalMessage(this.world.profile, 15, 276),
            image.slot,
            0,
            { flags: 0 },
          );
        this.checkOpen();
        image.slot = 0;
        image.plane = 0;
        image.dirty = false;
      }
      return undefined;
    }
    if (request.operation === 'position') {
      request.args.forEach((value, i) => {
        image.position[i] = value;
      });
      image.dirty = true;
      return undefined;
    }
    if (request.operation === 'display') {
      image.display = request.value;
      image.dirty = true;
      return undefined;
    }
    if (request.operation !== 'load') throw new Error('Invalid JavaScript image continuation');
    if (image.bitmap) {
      const previous = image.bitmap;
      image.bitmap = 0;
      await this.world.graphics.images.release(previous);
      this.checkOpen();
    }
    const bitmap = await this.world.imageComposites.load(request.name);
    if (this.closed || this.world.runtime.handles.records.get(request.image)?.value !== image) {
      if (bitmap) await this.world.graphics.images.release(bitmap);
      throw new Error('JavaScript image owner is closed');
    }
    image.bitmap = bitmap;
    image.dirty = true;
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
  async tick(link) {
    this.checkOpen();
    for (const [, record] of this.records()) {
      const image = record.value;
      if (!image.plane || !image.slot || !image.dirty) continue;
      const graph = this.plane(image.plane),
        target = this.drawing(link),
        origin = motionVector(graph.textureTransform, MOTION_ABI.pos).map(truncateFloat32);
      const width = truncateFloat32(graph.width),
        height = truncateFloat32(graph.height);
      const clip = new NativeGraphicsPacket([
        origin[0],
        origin[1],
        (origin[0] + width) | 0,
        (origin[1] + height) | 0,
      ]);
      const values = new NativeGraphicsPacket([
        image.bitmap,
        0,
        0,
        0,
        floatBits(Math.fround(image.position[0] + origin[0])),
        floatBits(Math.fround(image.position[1] + origin[1])),
        floatBits(image.x),
        floatBits(image.y),
        0,
        floatBits(1),
        floatBits(1),
        255,
        image.display,
        0,
        0,
      ]);
      for (const [raw, payload] of [
        [284, clip],
        [275, values],
        [294, null],
      ]) {
        await this.world.sendNativeEngine(
          target.nativeID,
          this.owner.id,
          canonicalMessage(this.world.profile, 15, raw),
          image.slot,
          0,
          { flags: 0, ...(payload ? { payload } : {}) },
        );
        this.checkOpen();
      }
      image.dirty = false;
    }
  }
  validate(cells) {
    const slots = new Set();
    for (const [, record] of this.records()) {
      const image = record.value;
      if (
        !Number.isSafeInteger(image.slot) ||
        image.slot < 0 ||
        (image.slot !== 0 && slots.has(image.slot)) ||
        ![0, 1].includes(image.baseType) ||
        !Number.isSafeInteger(image.plane) ||
        image.plane < 0 ||
        (image.slot === 0 && image.plane !== 0) ||
        !Array.isArray(image.position) ||
        image.position.length !== 3 ||
        !image.position.every(Number.isFinite) ||
        ![0, 1].includes(image.display) ||
        typeof image.dirty !== 'boolean' ||
        ![image.x, image.y, image.anchorX, image.anchorY].every(Number.isFinite)
      )
        throw new Error('Invalid JavaScript image checkpoint');
      if (image.slot) slots.add(image.slot);
      if (image.plane) {
        const plane = this.world.runtime.handles.get(image.plane, 'javascript-plane');
        // Child data/Graph restores after its kind55 parent. Validate ownership
        // now; the live model check belongs to the later runtime use.
        const child = this.owner.implementation.planes.child(plane);
        if (child.nativeID === 0) throw new Error('Invalid JavaScript image Plane checkpoint');
      }
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
      if (image.slot && link && this.world.objects.objects.has(link.target)) {
        await this.world.sendNativeEngine(
          this.world.nativeTaskID(link.target),
          this.owner.id,
          canonicalMessage(
            this.world.profile,
            this.world.objects.objects.get(link.target).kind,
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
