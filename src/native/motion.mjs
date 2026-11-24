// SPDX-License-Identifier: MPL-2.0
// The main native table exposes the motion manager wrappers.
// These IDs are separate from the generic native table inside each MOT script.
import { nativeReply, bitsFloat } from '../kcs.mjs';
import { initialMotionObject } from '../motion/abi.mjs';
import { encodeMotionRecords, restoreMotionRecords } from '../motion/checkpoint.mjs';
import { prepareMotionSpline } from '../motion/spline.mjs';
import { linearInterpolate, roundInteger, x87LinearInterpolate } from '../ppi/numeric.mjs';
import { roundX87Single } from '../ppi/x87.mjs';
import { floatBits } from '../kcs.mjs';
import { nativeABI } from './abi/index.mjs';
import { nativeDataFormat, nativeDataMapped } from './data-text.mjs';

const cp932 = new TextDecoder('shift_jis');
const value = (word) => nativeReply(1, word >>> 0),
  done = () => nativeReply(2);
const transfer = [
  [1, 0, 12],
  [2, 12, 12],
  [3, 24, 12],
  [4, 36, 64],
  [5, 100, 12],
  [6, 112, 4],
  [7, 116, 12],
  [8, 128, 12],
  [9, 140, 4],
];

export class NativeMotionRegistry {
  constructor({ handles, library }) {
    if (!handles || !library)
      throw new Error('Native MOT registry requires resource handles and a motion library');
    this.handles = handles;
    this.library = library;
    handles.registerType('motion-manager', {
      snapshot: (record) => ({
        owner: record.owner,
        state: record.manager ? record.manager.snapshot() : record.state,
      }),
      // Loading KCS is asynchronous. The opaque resource is restored now; its
      // first call resolves scripts before returning the native control reply.
      restore: ({ owner, state }) => ({ owner, state, manager: null, pending: null }),
    });
    handles.registerType('motion-checkpoint', {
      snapshot: (record) => ({ owner: record.owner, bytes: record.bytes.slice() }),
      restore: (state) => ({ owner: state.owner, bytes: state.bytes.slice() }),
    });
  }
  create(owner = null) {
    return this.handles.add('motion-manager', {
      owner,
      manager: this.library.manager(initialMotionObject()),
    });
  }
  get(handle) {
    const record = this.handles.get(handle, 'motion-manager');
    if (record.manager) return record.manager;
    if (!record.pending)
      record.pending = (async () => {
        const manager = this.library.manager(initialMotionObject());
        await manager.restore(record.state);
        record.manager = manager;
        delete record.state;
        delete record.pending;
        return manager;
      })();
    return record.pending;
  }
  release(handle) {
    this.handles.release(handle, 'motion-manager');
  }
  releaseOwner(owner) {
    for (const [handle, record] of this.handles.records)
      if (record.type === 'motion-manager' && record.value.owner === owner) this.release(handle);
  }
  capture(handle, frame) {
    return this.with(handle, (manager) => encodeMotionRecords(manager, frame));
  }
  restoreRecords(handle, bytes, frame) {
    return this.with(handle, (manager) =>
      restoreMotionRecords(manager, bytes, frame, (name) => this.library.load(name)),
    );
  }
  with(handle, callback) {
    const manager = this.get(handle);
    return manager && typeof manager.then === 'function'
      ? manager.then(callback)
      : callback(manager);
  }
}

function setState(manager, working, word, machine) {
  const bytes = new Uint8Array(0x90),
    view = new DataView(bytes.buffer);
  for (const [index, offset, length] of transfer) {
    if (index === 6 || index === 9) view.setUint32(offset, word(index), true);
    else bytes.set(machine.bytes(word(index), length), offset);
  }
  (working ? manager.working : manager.base).set(bytes);
}
function getState(manager, working, word, machine) {
  const state = working ? manager.working : manager.base;
  for (const [index, offset, length] of transfer) {
    if (working && index === 9) {
      // This mode needs a mapped host pointer. Zero is
      // a valid guest data address; an unmapped VM pointer translates to NULL.
      try {
        machine.region(word(index), length);
      } catch {
        continue;
      }
    }
    machine.bytes(word(index), length).set(state.subarray(offset, offset + length));
  }
}

const ids = new Set([
  0x126, 0x127, 0x128, 0x129, 0x12a, 0x12b, 0x12c, 0x12d, 0x12e, 0x12f, 0x130, 0x131, 0x132, 0x133,
  0x134, 0x135, 0x136, 0x137, 0x138, 0x139, 0x13a, 0x13b, 0x13c, 0x13d, 0x1b8, 0x202, 0x217, 0x24a,
]);
const returning = new Set([0x130, 0x133, 0x135, 0x136, 0x137, 0x13b, 0x13c, 0x1b8, 0x202, 0x217]);

export function nativeMotion(id, args, machine, services = {}) {
  if (id === 0x13e) {
    const interpolate =
      services.profile && nativeABI(services.profile).math?.lerpUsesX87
        ? x87LinearInterpolate
        : linearInterpolate;
    return value(floatBits(interpolate(...args.map(bitsFloat))));
  }
  if (id === 0x13f) {
    const input = bitsFloat(args[0]);
    if (services.math?.roundIntegerResult !== 'int64-low-word') return value(roundInteger(input));
    const rounded = Math.floor(Math.fround(input + 0.5));
    return value(rounded >= -(2 ** 63) && rounded < 2 ** 63 ? rounded : 0);
  }
  if (id === 0x140) {
    const x87 = services.profile && nativeABI(services.profile).motion?.splineUsesX87;
    const count = x87 ? args[1] | 0 : args[1];
    if (x87 && count < 3) return done();
    prepareMotionSpline(
      machine.bytes(args[0], count * 20),
      count,
      x87 ? roundX87Single : undefined,
    );
    return done();
  }
  if (!ids.has(id) || !services.motion) return undefined;
  // Some older shipped KCS scripts pass fewer words than a frozen wrapper
  // reads (SDK 13B). The C wrapper observes adjacent guest stack words. Do not
  // invent a zero default: GCALL leaves its argument block at machine.sp.
  const argumentBase = machine.sp,
    word = (index) => (index < args.length ? args[index] : machine.load(argumentBase + index * 4));
  const registry = services.motion;
  if (id === 0x126) return value(registry.create(services.owner));
  if (!word(0)) return returning.has(id) ? value(0) : done();
  if (id === 0x127) {
    registry.release(word(0));
    return done();
  }
  if (id === 0x13d) {
    registry.handles.release(word(0), 'motion-checkpoint');
    return done();
  }
  if (id === 0x13c) {
    const checkpoint = registry.handles.get(word(0), 'motion-checkpoint');
    return registry.with(checkpoint.owner, (manager) => {
      checkpoint.bytes = encodeMotionRecords(manager, word(1), checkpoint.bytes);
      return value(1);
    });
  }
  return registry.with(word(0), (manager) => {
    switch (id) {
      case 0x128:
        manager.clear();
        return done();
      case 0x129:
        manager.remove(word(1));
        return done();
      case 0x12a:
        manager.removeGroup(word(1));
        return done();
      case 0x12b:
      case 0x12d:
        setState(manager, id === 0x12d, word, machine);
        return done();
      case 0x12c:
      case 0x12e:
        getState(manager, id === 0x12e, word, machine);
        return done();
      case 0x12f:
        manager.base.set(manager.working);
        return done();
      case 0x130:
      case 0x217: {
        const formatted = services.profile && nativeABI(services.profile).motion?.addUsesFormat;
        const name = formatted
          ? cp932.decode(nativeDataFormat(args, machine, services, 1) ?? undefined)
          : machine.string(word(1));
        if (!name || name === '-') return value(0);
        const count = Math.min(word(3) >>> 0, 256);
        const registerWords =
          formatted && !count ? new Uint8Array() : machine.bytes(word(2), count * 4).slice();
        const extra =
          word(5) && (!formatted || nativeDataMapped(machine, word(4)))
            ? machine.bytes(word(4), word(5)).slice()
            : null;
        const script = registry.library.optional
          ? registry.library.optional(name)
          : registry.library.load(name);
        return Promise.resolve(script).then((script) =>
          script
            ? value(
                manager.add(script, {
                  registerWords,
                  extra,
                  group: word(6),
                  delay: id === 0x217 ? word(7) : 0,
                }),
              )
            : value(0),
        );
      }
      case 0x131:
        for (const record of manager.records.values())
          if (!word(1) || record.handle === word(1)) record.startTick = word(2) >>> 0;
        return done();
      case 0x132: {
        const record = manager.records.get(word(1));
        if (record)
          record.instance.setRegisterWords(
            machine.bytes(word(2), Math.min(word(3) >>> 0, 256) * 4),
          );
        return done();
      }
      case 0x133:
        manager.update(word(1) >>> 0, word(2) !== 0);
        return value(Number(manager.lastProcessed));
      case 0x134:
        manager.speed = bitsFloat(word(1));
        return done();
      case 0x135: {
        const instance = manager.records.get(word(1))?.instance,
          raw = services.profile && nativeABI(services.profile).motion?.activeQueryUsesRawWord;
        return value(raw ? (instance?.activeWord ?? 0) : Number(instance?.active ?? false));
      }
      case 0x136:
        return value(Number(manager.busy(word(1))));
      case 0x137:
        return value(Number(manager.busy()));
      case 0x138:
        manager.records.get(word(1))?.instance.setSkip();
        return done();
      case 0x139:
        manager.skip(word(1));
        return done();
      case 0x13a:
        manager.skip();
        return done();
      case 0x13b:
        return value(
          registry.handles.add('motion-checkpoint', {
            owner: word(0),
            bytes: encodeMotionRecords(manager, word(1)),
          }),
        );
      case 0x1b8: {
        const any = manager.records.size > 0;
        manager.finish();
        return value(Number(any));
      }
      case 0x202: {
        manager.working.set(manager.base);
        const name = machine.string(word(1)).replaceAll('\\', '/').split('/').at(-1).toLowerCase();
        return value(
          Number(
            [...manager.records.values()].some(
              (record) =>
                record.instance.script.name
                  .replaceAll('\\', '/')
                  .split('/')
                  .at(-1)
                  .toLowerCase() === name,
            ),
          ),
        );
      }
      case 0x24a:
        manager.flags = word(1) >>> 0;
        return done();
      default:
        throw new Error(`Missing recovered MOT dispatch ${id.toString(16)}`);
    }
  });
}
