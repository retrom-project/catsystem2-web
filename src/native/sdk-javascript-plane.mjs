// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../kcs.mjs';
import { scriptError } from '../javascript/program.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeEngineWord } from './engine-message.mjs';
import { canonicalMessage } from './control-task.mjs';

const name = new TextEncoder().encode('JS Plane\0');
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const validArgs = (args) =>
  Array.isArray(args) &&
  args.length === 5 &&
  args.every((v) => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) &&
  args[0] > 0 &&
  args[1] > 0;

export class SDKJavaScriptPlanes {
  constructor(world, owner) {
    this.world = world;
    this.owner = owner;
    this.closed = false;
  }
  records() {
    return [...this.world.runtime.handles.records].filter(
      ([, record]) => record.type === 'javascript-plane' && record.value.owner === this.owner.id,
    );
  }
  checkOpen() {
    if (
      this.closed ||
      this.owner.implementation?.closed ||
      this.world.objects.objects.get(this.owner.id) !== this.owner
    )
      throw new Error('JavaScript Plane owner is closed');
  }
  host(operation, args, location) {
    this.checkOpen();
    if (operation.construct !== 'CsPlane' || !validArgs(args))
      throw scriptError(
        'Unsupported JavaScript host import',
        location,
        'CsPlane arguments or method',
      );
    return { wait: { plane: [...args] } };
  }
  async complete(request) {
    this.checkOpen();
    if (!validArgs(request.plane)) throw new Error('Invalid JavaScript Plane continuation');
    const [width, height, u, v, priority] = request.plane.map((value) =>
      Math.fround(value === 0 ? 0 : value),
    );
    let child;
    try {
      const nativeID = nativeEngineWord(
        await this.world.sendNativeEngine(this.owner.nativeID, this.owner.id, 1, 2, 0, {
          flags: 0,
          payload: {
            bytes(address, size) {
              if (address < 0 || address + size > name.length)
                throw new RangeError('JavaScript Plane name packet');
              return name.subarray(address, address + size);
            },
          },
        }),
        'JavaScript Plane creation',
      );
      // The reply is a namespace-local nativeID, never a WorldID or C pointer.
      // The owner may have closed during creation, so use its retained identity
      // to find the actual allocated record even before parent registration.
      child = [...this.world.objects.objects.values()].find(
        (record) =>
          record.nativeID === nativeID &&
          record.namespace === this.owner.namespace &&
          record.creator === this.owner.id,
      );
      if (!child || child.kind !== 2) throw new Error('JavaScript Plane child is absent');
      this.checkOpen();
      if (child.parent !== this.owner.id) throw new Error('JavaScript Plane child lost its owner');
      const vector = (values) => values.map(floatBits);
      const packets = [
        [
          0x27,
          0,
          [0, 0, floatBits(priority), floatBits(width), floatBits(height), 32, 1, 0xffffffff],
        ],
        [0x31, 1, vector([u, v, 0])],
        [0x31, 0, vector([0, 0, 0])],
        [0x2f, 0, vector([0, 0, priority])],
        [0x40, 0, vector([1, 1, 1])],
        [0x37, 0, vector(identity)],
        [0x39, 1, 0xffffffff],
        [0x2d, 0, 0],
      ];
      for (const [raw, w, value] of nativeID === 0 ? [] : packets) {
        const payload = Array.isArray(value) ? new NativeGraphicsPacket(value) : undefined;
        await this.world.sendNativeEngine(
          nativeID,
          this.owner.id,
          canonicalMessage(this.world.profile, 2, raw),
          w,
          payload ? 0 : value,
          { flags: 0, ...(payload ? { payload } : {}) },
        );
        this.checkOpen();
      }
      const handle = this.world.runtime.handles.add('javascript-plane', {
        owner: this.owner.id,
        child: child.id,
      });
      return { hostObject: handle };
    } catch (error) {
      if (child && this.world.objects.objects.get(child.id) === child) {
        try {
          await this.world.objects.release(child.id);
        } catch (cleanup) {
          error.cleanup = cleanup;
        }
      }
      throw error;
    }
  }
  validate(cells) {
    for (const [, record] of this.records()) {
      const value = record.value,
        child = this.world.objects.objects.get(value.child);
      if (
        !Number.isSafeInteger(value.child) ||
        value.child < 0 ||
        !child ||
        child.kind !== 2 ||
        child.parent !== this.owner.id ||
        child.creator !== this.owner.id ||
        child.namespace !== this.owner.namespace
      )
        throw new Error('Invalid JavaScript Plane owner checkpoint');
    }
    for (const value of cells) {
      const plane = this.world.runtime.handles.get(value.hostObject, 'javascript-plane');
      if (plane.owner !== this.owner.id) throw new Error('Invalid JavaScript Plane host reference');
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    const errors = [];
    for (const [handle, record] of this.records()) {
      const child = this.world.objects.objects.get(record.value.child);
      try {
        if (child) {
          try {
            if (child.nativeID !== 0)
              await this.world.sendNativeEngine(child.nativeID, this.owner.id, 3, 0, 0, {
                flags: 0,
              });
          } finally {
            await this.world.objects.release(child.id);
          }
        }
      } catch (error) {
        errors.push(error);
      } finally {
        this.world.runtime.handles.release(handle, 'javascript-plane');
      }
    }
    if (errors.length) throw new AggregateError(errors, 'JavaScript Plane cleanup failed');
  }
}
