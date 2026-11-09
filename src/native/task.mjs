// SPDX-License-Identifier: MPL-2.0
// Main ABI task/message bridge, recovered from 0x65A430..0x65A876.
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeEngineWord, NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';

const result = (value) => nativeReply(1, value >>> 0);
const voidResult = () => nativeReply(2);
const then = (value, map) =>
  value && typeof value.then === 'function' ? value.then(map) : map(value);
const taskString = (bytes) => {
  const source = new Uint8Array(bytes.length + 1);
  source.set(bytes);
  return {
    payload: {
      bytes: (address, size) => source.subarray(address, address + size),
      string: (address) =>
        new TextDecoder('shift_jis').decode(source.subarray(address, source.indexOf(0, address))),
    },
  };
};

export function nativeTask(id, args, machine, task, services) {
  const check = (count) => {
    if (args.length !== count)
      throw new Error(`KCS task native 0x${id.toString(16)} expects ${count} arguments`);
  };
  const objects = services.objects,
    world = services.world;
  const resolve = (nativeID) => (world ? world.resolveTaskID(nativeID, task.id) : nativeID);
  const nativeID = (worldID) => (world ? world.nativeTaskID(worldID) : worldID);
  switch (id) {
    case 0x42:
      check(3);
      if (!objects?.create || !services.format) return undefined;
      if (world) {
        const name =
            services.formatBytes?.(args[2], machine) ??
            encodeCP932(services.format(args[2], machine)),
          context = taskString(name);
        return then(
          world.sendNativeEngine(args[1], task.id, 1, args[0], 0, context),
          async (value) => {
            if (context.nativeCreatedTask === null) return result(NATIVE_RESULT_SENTINEL);
            if (context.nativeCreatedTask === undefined)
              throw new Error('Native task creation did not reach its Top factory');
            const path =
              task.context?.contextNameBytes ?? encodeCP932(task.context?.contextName || '');
            await world.sendNativeEngine(value, task.id, 26, 0, 0, taskString(path));
            return result(value);
          },
        );
      }
      return then(
        objects.create({
          kind: args[0],
          parent: resolve(args[1]),
          name: services.format(args[2], machine),
          creator: task.id,
        }),
        (created) => result(nativeID(created)),
      );
    case 0x43:
      check(1);
      if (!objects?.release) return undefined;
      if (world && objects.objects.get(resolve(args[0]))?.implementation?.pointer)
        return then(world.sendNativeEngine(args[0], task.id, 3), voidResult);
      return then(
        objects.destroy
          ? objects.destroy(resolve(args[0]), task.id)
          : objects.release(resolve(args[0])),
        voidResult,
      );
    case 0x44:
      check(0);
      return result(nativeID(task.id));
    case 0x4a:
    case 0x4b:
    case 0x4c:
    case 0x4d: {
      check(id === 0x4c ? 0 : 1);
      if (!(objects?.objects instanceof Map)) return undefined;
      const records = objects.objects,
        own = records.get(task.id);
      if (!own) throw new Error(`Native task ${task.id} is absent`);
      if (id === 0x4a) {
        const record = records.get(resolve(args[0]));
        if (!record) return result(-1);
        if (world && (record.implementation?.pointer || record.kind === 1)) {
          const context = {};
          return then(world.sendNativeEngine(args[0], task.id, 13, 0, 0, context), (value) => {
            if (!context.nativeRouted) return result(-1);
            if (value !== NATIVE_UNWRITTEN_WORD) return result(nativeEngineWord(value));
            // The original wrapper passes its initialized caller pointer as
            // the reply word. A routed receiver can leave that word intact.
            return then(
              world.getNativeFeature('task-memory').then((memory) => memory.pointer(task.id)),
              result,
            );
          });
        }
        if (record.kind === 1)
          throw new Error('The native root type query retains its caller task pointer');
        return result(record.flags ?? record.kind);
      }
      if (id === 0x4b) {
        if (world) {
          const keys = [...world.engineMessages.registry(own).keys()]
            .sort((a, b) => (a | 0) - (b | 0))
            .filter((key) => world.engineMessages.lookupPointer(own, key)?.parent === task.id);
          return result(keys[args[0] >>> 0] ?? -1);
        }
        const children = [...records.values()]
          .filter((record) => record.parent === task.id)
          .sort((a, b) => (nativeID(a.id) | 0) - (nativeID(b.id) | 0));
        return result(children[args[0] >>> 0] ? nativeID(children[args[0] >>> 0].id) : -1);
      }
      if (id === 0x4c) {
        if (own.parent === null)
          throw new Error('The native parent query dereferences the root null parent');
        return result(nativeID(own.parent));
      }
      if (world) {
        return then(
          world.sendNativeEngine(0, task.id, world.engineMessages.layout.rootStart + 1, args[0], 0),
          (value) => result(value === NATIVE_UNWRITTEN_WORD ? 0 : nativeEngineWord(value)),
        );
      }
      const record = records.get(resolve(args[0]));
      // kcTaskTop's existence query searches the shared registration map.
      // Its initial root is routed directly and is not inserted into that map.
      return result(Number(!!record && !(record.kind === 1 && record.parent === null)));
    }
    case 0x45:
    case 0x46:
      check(4);
      if (world) {
        const bytes = new Uint8Array(16),
          view = new DataView(bytes.buffer);
        [nativeID(task.id), ...args.slice(1)].forEach((word, i) =>
          view.setUint32(i * 4, word, true),
        );
        const payload = {
          load: (address) => view.getUint32(address, true),
          store: (address, value) => view.setUint32(address, value, true),
          bytes: (address, count) => bytes.subarray(address, address + count),
        };
        return then(
          world.sendNativeEngine(args[0], task.id, id === 0x45 ? 172 : 173, 0, 0, {
            payload,
            flags: 1,
          }),
          (value) => {
            if (id === 0x45) world.runtime.variableBank(task, false)?.selectContext(task.id);
            return result(nativeEngineWord(value, 'KCS script message result'));
          },
        );
      }
      if (!objects?.send) return undefined;
      return then(
        objects.send(args[0], [task.id, args[1], args[2], args[3]], { queued: id === 0x46 }),
        result,
      );
    case 0x47:
      check(1);
      return machine.waitMessage(args[0]);
    case 0x48:
    case 0x49: {
      check(4);
      if (!objects?.machine) return undefined;
      const remote = objects.machine(resolve(args[0]));
      if (!remote) throw new Error(`KCS task ${args[0]} has no script address space`);
      if (id === 0x48) machine.bytes(args[3], args[2]).set(remote.bytes(args[1], args[2]).slice());
      else remote.bytes(args[1], args[2]).set(machine.bytes(args[3], args[2]).slice());
      return voidResult();
    }
    default:
      return undefined;
  }
}
