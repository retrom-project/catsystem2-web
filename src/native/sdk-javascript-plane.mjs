// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../kcs.mjs';
import { scriptError } from '../javascript/program.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeEngineWord } from './engine-message.mjs';
import { canonicalMessage } from './control-task.mjs';
import { readNativeResource } from './resource-file.mjs';
import { MOTION_ABI, motionVector, setMotionVector } from '../motion/abi.mjs';

const name = new TextEncoder().encode('JS Plane\0');
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const moveFile = 'mot.int/motMove.kcs';
const moveKey = 'mot.int/motmove';
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
    if (operation.member === 'setPos' || operation.member === 'setDisp') {
      const valid =
        operation.member === 'setPos'
          ? args.length <= 3 &&
            args.every((value) => typeof value === 'number' && Number.isFinite(Math.fround(value)))
          : args.length <= 1 && (!args.length || [false, true, 0, 1].includes(args[0]));
      if (!valid)
        throw scriptError(
          'Unsupported JavaScript host import',
          location,
          'CsPlane finite pose arguments',
        );
      const plane = this.world.runtime.handles.get(
        operation.receiver.hostObject,
        'javascript-plane',
      );
      this.child(plane, true);
      if (this.busy(plane))
        throw scriptError(
          'Unsupported JavaScript host import',
          location,
          'CsPlane pose while motion is active',
        );
      return {
        wait: {
          planeState: operation.receiver.hostObject,
          operation: operation.member,
          args: [...args],
        },
      };
    }
    if (operation.member === 'motMove') {
      const valid =
        Array.isArray(args) &&
        args.length <= 4 &&
        (args.length === 0 ||
          (Number.isInteger(args[0]) && args[0] >= -0x80000000 && args[0] <= 0x7fffffff)) &&
        args
          .slice(1)
          .every((value) => typeof value === 'number' && Number.isFinite(Math.fround(value)));
      if (!valid)
        throw scriptError(
          'Unsupported JavaScript host import',
          location,
          'CsPlane motMove numeric arguments',
        );
      const plane = this.world.runtime.handles.get(
        operation.receiver.hostObject,
        'javascript-plane',
      );
      if (plane.owner !== this.owner.id)
        throw scriptError('Unsupported JavaScript host import', location, 'CsPlane motion owner');
      this.child(plane, true);
      return { wait: { motion: { plane: operation.receiver.hostObject, args: [...args] } } };
    }
    if (operation.construct !== 'CsPlane' || !validArgs(args))
      throw scriptError(
        'Unsupported JavaScript host import',
        location,
        'CsPlane arguments or method',
      );
    return { wait: { plane: [...args] } };
  }
  child(plane, motion = false) {
    const child = this.world.objects.objects.get(plane.child);
    if (
      plane.owner !== this.owner.id ||
      !child ||
      child.kind !== 2 ||
      child.parent !== this.owner.id ||
      child.creator !== this.owner.id ||
      child.namespace !== this.owner.namespace
    )
      throw new Error('JavaScript Plane lost its owned child');
    if (motion && (child.nativeID === 0 || !child.implementation?.graph))
      throw new Error('JavaScript Plane motion requires its real nonzero owned model');
    return child;
  }
  motionRecord(plane) {
    const record = this.world.runtime.handles.get(plane.motion, 'motion-manager');
    if (record.owner !== plane.child) throw new Error('JavaScript Plane motion owner mismatch');
    return record;
  }
  manager(plane) {
    const record = this.motionRecord(plane);
    if (!record.manager || record.pending)
      throw new Error('JavaScript Plane motion manager is not settled');
    return record.manager;
  }
  busy(plane) {
    return plane.motion === undefined ? false : this.manager(plane).busy();
  }
  selectedBusy(reference, location) {
    this.checkOpen();
    const unsupported = () =>
        scriptError(
          'Unsupported JavaScript host import',
          location,
          'cfIsExecMotion CsPlane reference',
        ),
      record =
        reference &&
        typeof reference === 'object' &&
        !Array.isArray(reference) &&
        Object.keys(reference).length === 1 &&
        Number.isSafeInteger(reference.hostObject) &&
        this.world.runtime.handles.records.get(reference.hostObject);
    if (record?.type !== 'javascript-plane' || record.value?.owner !== this.owner.id)
      throw unsupported();
    try {
      this.child(record.value, true);
      return this.busy(record.value);
    } catch (cause) {
      const error = unsupported();
      error.cause = cause;
      throw error;
    }
  }
  modelState(plane) {
    const graph = this.child(plane, true).implementation.graph,
      state = graph.kx2.slice();
    // The native local KX2 packs the UV field separately from physical pos.
    setMotionVector(state, MOTION_ABI.vram, motionVector(graph.textureTransform, MOTION_ABI.pos));
    setMotionVector(state, MOTION_ABI.vscale, [1, 1, 1]);
    return state;
  }
  async publish(plane, state) {
    const child = this.child(plane, true),
      view = new DataView(state.buffer, state.byteOffset, state.byteLength),
      vector = (offset) => motionVector(state, offset).map(floatBits),
      packets = [
        [0x31, 0, vector(MOTION_ABI.pos)],
        [0x2f, 0, vector(MOTION_ABI.base)],
        [0x40, 0, vector(MOTION_ABI.scale)],
        [
          0x37,
          0,
          Array.from({ length: 16 }, (_, i) => view.getUint32(MOTION_ABI.matrix + i * 4, true)),
        ],
        [0x39, 1, view.getUint32(MOTION_ABI.color, true)],
        [0x2d, 0, view.getUint32(MOTION_ABI.display, true)],
      ];
    for (const [raw, w, value] of packets) {
      const payload = Array.isArray(value) ? new NativeGraphicsPacket(value) : undefined;
      await this.world.sendNativeEngine(
        child.nativeID,
        this.owner.id,
        canonicalMessage(this.world.profile, 2, raw),
        w,
        payload ? 0 : value,
        { flags: 0, ...(payload ? { payload } : {}) },
      );
      this.checkOpen();
      if (this.child(plane, true) !== child)
        throw new Error('JavaScript Plane motion child changed');
    }
  }
  async update(plane, frame) {
    this.checkOpen();
    if (!this.busy(plane)) return;
    const manager = this.manager(plane);
    const state = manager.update(frame >>> 0);
    await this.publish(plane, state);
    if (!manager.busy()) manager.clear();
  }
  async tick(frame) {
    this.checkOpen();
    for (const [, record] of this.records()) await this.update(record.value, frame);
  }
  async completeMotion(request) {
    this.checkOpen();
    const value = request.motion,
      plane = this.world.runtime.handles.get(value.plane, 'javascript-plane'),
      child = this.child(plane, true);
    // 5397B4..C1: update first, then sample current/delta, all before source I/O.
    await this.update(
      plane,
      ((this.owner.effectiveFrame ?? 0) - (this.owner.pausedFrames ?? 0)) >>> 0,
    );
    const base = this.modelState(plane),
      current = motionVector(base, MOTION_ABI.pos),
      args = value.args,
      duration = args.length ? args[0] : 30,
      registers = [
        Math.fround(duration === 0 ? 0 : duration),
        0,
        0,
        0,
        ...current.map((position, i) =>
          Math.fround(Math.fround(args.length > i + 1 ? args[i + 1] : position) - position),
        ),
      ];
    if (plane.motion !== undefined && !this.busy(plane)) this.manager(plane).base.set(base);
    const registry = this.world.runtime.services.motion,
      script = await registry.library.optional(moveFile, {
        read: (name) => readNativeResource(this.world, name, 3),
      });
    this.checkOpen();
    if (
      this.world.runtime.handles.get(value.plane, 'javascript-plane') !== plane ||
      this.child(plane, true) !== child
    )
      throw new Error('JavaScript Plane motion owner changed during I/O');
    if (script === null) return undefined;
    if (plane.motion === undefined) {
      plane.motion = registry.create(child.id);
      this.manager(plane).base.set(base);
    }
    this.manager(plane).add(script, { registers });
    return undefined;
  }
  async restoreMotions() {
    this.checkOpen();
    const seen = new Set(),
      registry = this.world.runtime.services.motion;
    for (const [, record] of this.records()) {
      const plane = record.value;
      if (plane.motion === undefined) continue;
      if (!Number.isSafeInteger(plane.motion) || plane.motion <= 0 || seen.has(plane.motion))
        throw new Error('Invalid JavaScript Plane motion reference');
      seen.add(plane.motion);
      const resource = this.motionRecord(plane),
        state = resource.manager ? resource.manager.snapshot() : resource.state;
      if (
        !state ||
        !Array.isArray(state.records) ||
        state.records.some((record) => record.script !== moveKey)
      )
        throw new Error('Invalid JavaScript Plane motion script checkpoint');
      if (state.records.length) {
        const script = await registry.library.optional(moveFile, {
          read: (name) => readNativeResource(this.world, name, 3),
        });
        if (script === null) throw new Error('JavaScript Plane motion source is absent');
        this.checkOpen();
      }
      await registry.get(plane.motion);
      this.checkOpen();
    }
  }
  async completeState(request) {
    this.checkOpen();
    const plane = this.world.runtime.handles.get(request.planeState, 'javascript-plane'),
      state = this.modelState(plane);
    if (request.operation === 'setPos') {
      const position = motionVector(state, MOTION_ABI.pos);
      request.args.forEach((value, i) => {
        position[i] = Math.fround(value);
      });
      setMotionVector(state, MOTION_ABI.pos, position);
    } else if (request.operation === 'setDisp') {
      if (request.args.length)
        new DataView(state.buffer, state.byteOffset, state.byteLength).setUint32(
          MOTION_ABI.display,
          Number(Boolean(request.args[0])),
          true,
        );
    } else throw new Error('Invalid JavaScript Plane pose continuation');
    await this.publish(plane, state);
    if (plane.motion !== undefined) this.manager(plane).base.set(state);
    return undefined;
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
        if (record.value.motion !== undefined) {
          try {
            const motion = this.motionRecord(record.value);
            motion.manager?.clear();
            this.world.runtime.services.motion.release(record.value.motion);
          } catch (error) {
            errors.push(error);
          }
        }
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
