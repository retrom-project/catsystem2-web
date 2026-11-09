// SPDX-License-Identifier: MPL-2.0
import { NATIVE_UNWRITTEN_WORD, nativeEngineWord } from './engine-message.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeSceneMemory } from './scene-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';
import { readKCS } from '../kcs.mjs';

const bytesAt = (memory, address, count) =>
  memory.bytes ? memory.bytes(address, count) : memory.read(address, count);
const putBytes = (memory, address, bytes) =>
  memory.write ? memory.write(address, bytes) : bytesAt(memory, address, bytes.length).set(bytes);
const cstring = (memory, address) => {
  if (memory.string) return memory.string(address);
  const result = [];
  for (let at = address; ; at++) {
    const b = bytesAt(memory, at, 1)[0];
    if (!b) break;
    result.push(b);
  }
  return new TextDecoder('shift_jis', { ignoreBOM: true }).decode(Uint8Array.from(result));
};
const putString = (memory, address, text) => {
  if (memory.writeString) memory.writeString(text, address);
  else putBytes(memory, address, Uint8Array.from([...encodeCP932(text), 0]));
};
const decodeCString = (bytes) => new TextDecoder('shift_jis', { ignoreBOM: true }).decode(bytes);
const cstringBytes = (memory, address) => {
  if (!memory.bytes && !memory.read) return encodeCP932(memory.string(address));
  const result = [];
  for (let at = address; ; at++) {
    const byte = bytesAt(memory, at, 1)[0];
    if (!byte) return Uint8Array.from(result);
    result.push(byte);
  }
};
const setContextName = (record, bytes) => {
  record.context.contextNameBytes = bytes.slice();
  record.context.contextName = decodeCString(bytes);
};
const contextBytes = (record) => {
  const bytes = record.context.contextNameBytes;
  return bytes && decodeCString(bytes) === record.context.contextName
    ? bytes
    : encodeCP932(record.context.contextName || '');
};

export function createNativeScriptTask(world, record) {
  const implementation = world.base(record);
  record.scriptEnabled ??= 0;
  record.scriptLoaded ??= 0;
  record.scriptSharedBound ??= false;
  record.scriptStringDirty ??= 0;
  record.scriptDebugCallback ??= 0;
  record.scriptDebugData ??= 0;
  record.scriptDebugHook ??= 0;
  record.scriptMessages ??= [];
  world.runtime.stringBank({ context: record.context });
  Object.assign(implementation, {
    async bindMachineShared() {
      const machine = this.machine,
        reference = record.sharedDataRef;
      if (!machine || !record.scriptSharedBound) return;
      if (reference && (reference.kind === 'engine' || world.nativeEngine)) {
        const memory = await world.getNativeFeature('task-memory');
        if (memory.bindSharedMachine(record.id, machine, reference)) return;
        if (reference.kind === 'engine')
          throw new Error('Native shared RAM binding is unavailable');
      }
      if (reference) machine.bindShared({ bytes: () => world.engineMessages.sharedBytes(record) });
      else machine.shared = world.engineMessages.sharedBytes(record);
    },
    async dumpSize(context) {
      if (!this.machine)
        throw new Error('Native Script dump-size query dereferences its absent interpreter');
      let size = 88 + this.machine.memory.length;
      await world.engineMessages.eachChild(record, async (child) => {
        size =
          (size +
            nativeEngineWord(
              await world.sendEngine(child.id, record.id, 15, 0, 0, context),
              'Script child dump size',
            )) >>>
          0;
      });
      return size;
    },
    async dump(sender, address, context, source) {
      if (!this.machine) {
        context.nativeUnhandled = true;
        return NATIVE_UNWRITTEN_WORD;
      }
      const m = this.machine,
        // Browser I/O parks GCALL for a retry. The original synchronous
        // native callback sees the advanced PC and the already popped args.
        duringNative = m.waiting?.kind === 'io' && this.task?.io?.pc === m.pc,
        header = bytesAt(source, address, 88).slice(),
        view = new DataView(header.buffer);
      const type = encodeCP932((record.nativeTypeName ?? '') + '\0'),
        name = encodeCP932(record.name + '\0');
      if (type.length > 16 || name.length > 32)
        throw new Error('Script dump name exceeds native header');
      if (!record.nativeDumpHeader || record.nativeTypeName !== undefined) header.set(type, 0);
      header.set(name, 16);
      const data = (await world.getNativeFeature('task-memory')).guestAddress(record.id, m, 0);
      [
        world.nativeTaskID(record.id),
        0,
        m.shared.length,
        duringNative ? m.pc + m.instruction().size : m.pc,
        m.memory.length,
        data,
        duringNative ? m.nativeArgumentBase : m.sp,
        m.floor,
        m.fp,
        m.switchValue,
      ].forEach((v, i) => view.setUint32(48 + i * 4, v, true));
      putBytes(source, address, header);
      putBytes(source, address + 88, m.memory);
      let size = 88 + m.memory.length,
        count = 0;
      const hadPayload = Object.hasOwn(context, 'payload'),
        oldPayload = context.payload;
      context.payload = source;
      try {
        await world.engineMessages.eachChild(record, async (child) => {
          size =
            (size +
              nativeEngineWord(
                await world.sendEngine(child.id, record.id, 16, 0, address + size, context),
                'Script child dump bytes',
              )) >>>
            0;
          count++;
        });
      } finally {
        if (hadPayload) context.payload = oldPayload;
        else delete context.payload;
      }
      view.setUint32(52, count, true);
      putBytes(source, address + 52, header.subarray(52, 56));
      return size;
    },
    async parentAssigned(parentID) {
      let inherited = 0;
      await world.sendEngine(parentID, record.id, 177, 0, 0, {
        payload: {
          store: (_at, value) => {
            inherited = value;
          },
        },
      });
      if (inherited) {
        if (!record.context.stringBankInherited)
          world.runtime.handles.release(record.context.stringBank, 'string-bank');
        record.context.stringBankInherited = true;
        record.context.stringBank = inherited;
      }
    },
    async loadScript(name, { initialExecute = false, context = {}, nativeLoad = false } = {}) {
      const previousContext = this.task?.context ?? record.context;
      await world.graphics.images.releaseOwner(record.id);
      await world.nativeEngine?.features.get('image-owners')?.releaseOwner(record.id);
      world.runtime.services.motion?.releaseOwner(record.id);
      if (this.task) {
        record.scriptMessages = this.task.messages;
        world.runtime.scheduler.cancel(record.id, false);
        world.runtime.scheduler.tasks.delete(record.id);
      }
      world.nativeEngine?.features.get('task-memory')?.releaseMachine(record.id);
      const inherited = {
        variableBank: previousContext?.variableBank || 0,
        stringBank: previousContext?.stringBank || 0,
        stringBankInherited: previousContext?.stringBankInherited ?? false,
        allowVariableInitialization: previousContext?.allowVariableInitialization ?? true,
        sceneData: previousContext?.sceneData || 0,
        contextName: '',
        contextNameBytes: new Uint8Array(),
      };
      const bytes = await world.runtime.read(name, 'kcs'),
        present = !!bytes?.length;
      if (!present && !nativeLoad) throw new Error(`Missing KCS resource ${name}`);
      const task = present
        ? world.runtime.scheduler.add(
            { ...(await readKCS(bytes)), name },
            {
              id: record.id,
              name,
              abi: 'main',
              context: { ...inherited, ...context },
            },
          )
        : { context: { ...inherited, ...context } };
      record.context = task.context;
      if (present) {
        task.messages = record.scriptMessages;
        await this.bindMachineShared();
      }
      if (present) record.scriptEnabled = 1;
      record.scriptLoaded = 1;
      if (record.parent !== null) {
        let inheritedBank = 0;
        await world.sendEngine(record.parent, record.id, 176, 0, 0, {
          payload: {
            store: (_at, value) => {
              inheritedBank = value;
            },
          },
          flags: 1,
        });
        if (inheritedBank) {
          task.context.variableBank = inheritedBank;
          task.context.allowVariableInitialization = false;
          world.runtime.variableBank(task, false).registerContext(record.id);
        }
        await world.sendEngine(record.parent, record.id, 25, 0, 0, {
          payload: {
            write: (_address, bytes) => {
              const end = bytes.indexOf(0);
              setContextName(record, bytes.subarray(0, end < 0 ? bytes.length : end));
            },
            writeString: (text) => {
              setContextName(record, encodeCP932(text));
            },
          },
        });
      }
      if (initialExecute && present) {
        await world.runtime.scheduler.execute(task);
        if (task.status === 'finished') record.scriptEnabled = 0;
      }
      return record.id;
    },
    async tick() {
      const task = this.task,
        scheduler = world.runtime.scheduler;
      if (record.scriptEnabled && !task) record.scriptEnabled = 0;
      if (
        !record.scriptEnabled ||
        !task ||
        ['cancelled', 'failed'].includes(task.status) ||
        !scheduler.ready(task)
      )
        return;
      world.runtime.variableBank(task, false)?.selectContext(record.id);
      try {
        let used = 0;
        let cursor = 0;
        while (cursor < task.messages.length) {
          const words = task.messages[cursor++];
          if (!task.machine.receiveMessage(words)) continue;
          used += (await scheduler.execute(task, scheduler.budget - used)).executed;
        }
        task.messages.length = 0;
        if (['cancelled', 'failed'].includes(task.status)) {
          record.scriptEnabled = 0;
          return;
        }
        if (!task.machine.executionMode) return;
        if (task.status === 'finished') {
          record.scriptEnabled = 0;
          return;
        }
        task.machine.idle();
        await scheduler.execute(task, scheduler.budget - used);
        if (task.status === 'finished') record.scriptEnabled = 0;
      } catch (error) {
        task.status = 'failed';
        task.error = error.message;
        throw error;
      }
    },
    async message(words, context = {}) {
      const [sender, id, wParam, lParam] = words;
      const memory = () => {
        const result =
          context.payload ||
          context.machine ||
          world.objects.machine(context.nativeSenderWorldID ?? sender);
        if (!result)
          throw new Error(`Script task ${record.id} message ${id} requires sender memory`);
        return result;
      };
      const hasPointer = (address) =>
        address !== 0 || (!context.nativePointer && !!(context.payload || context.machine));
      if (id === 3) {
        if (this.task)
          await world.runtime.scheduler.send(record.id, [0xffffffff, 0xffff0006, 0, 0]);
        return implementation.baseMessage(words, context);
      }
      if (id === 25) {
        if (hasPointer(lParam)) {
          const source = memory();
          if (source.write || source.bytes || source.read)
            putBytes(source, lParam, Uint8Array.from([...contextBytes(record), 0]));
          else putString(source, lParam, record.context.contextName || '');
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 26) {
        if (hasPointer(lParam)) setContextName(record, cstringBytes(memory(), lParam));
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 15) return this.dumpSize(context);
      if (id === 16) {
        if (!this.machine) {
          context.nativeUnhandled = true;
          return NATIVE_UNWRITTEN_WORD;
        }
        return this.dump(sender, lParam, context, memory());
      }
      if (id === 160) {
        await this.loadScript(cstring(memory(), lParam), {
          initialExecute: !!wParam,
          nativeLoad: true,
        });
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 161 || id === 162) {
        if (this.machine) {
          record.scriptEnabled = id === 161 ? 1 : 0;
          this.machine.setExecutionMode(
            id === 162 ? 0 : wParam === world.nativeTaskID(record.id) ? lParam : 1,
          );
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 163) {
        if (this.machine)
          memory().store(
            lParam,
            (await world.getNativeFeature('task-memory')).guestAddress(record.id, this.machine, 0),
          );
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 164 || id === 165) {
        if (this.machine) {
          const m = this.machine,
            global = id === 165,
            scopes = m.debug.scopes,
            first = global ? scopes[0] : scopes.at(-1),
            count = global && scopes.length >= 2 ? scopes[1] : m.debug.locals.length - first;
          if ((wParam | 0) >= (count | 0)) memory().store(lParam, 0xffffffff);
          else {
            const bytes = bytesAt(memory(), lParam, 152).slice();
            m.debugSymbol(wParam, global, bytes);
            putBytes(memory(), lParam, bytes);
          }
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 166) {
        record.scriptDebugCallback = wParam;
        record.scriptDebugData = lParam;
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 167) {
        if (this.machine) {
          if (!this.machine.debug.sourceInitialized)
            throw new Error(
              'Native Script source query reads uninitialized state before opcode 65',
            );
          memory().store(wParam, this.machine.debug.line);
          if (lParam) putString(memory(), lParam, this.machine.debug.file);
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 168) {
        if (this.machine) {
          const bytes = bytesAt(memory(), lParam, 156).slice();
          this.machine.debugValue(bytes);
          memory().store(lParam + 148, new DataView(bytes.buffer).getUint32(148, true));
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 169) {
        if (this.machine) {
          let address = memory().load(lParam);
          if ((address & 0x7fffffff) < this.machine.memory.length)
            address = (address + (wParam ? -this.machine.fp : this.machine.fp)) >>> 0;
          memory().store(lParam, address);
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 170) {
        if (this.machine) {
          record.scriptDebugHook = lParam;
          this.machine.debugHook = lParam;
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 6) {
        if (!this.task) return NATIVE_UNWRITTEN_WORD;
        const source = memory(),
          pack = (address) => (source.load(address) & 65535) | (source.load(address + 4) << 16);
        await world.runtime.scheduler.send(record.id, [
          sender,
          0xffff0002,
          pack(wParam),
          pack(lParam),
        ]);
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 171) {
        if (this.task) {
          world.engineMessages.bindSharedData(record, sender, wParam, lParam, context);
          record.scriptSharedBound = true;
          await this.bindMachineShared();
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 174) {
        if (this.task)
          memory().store(
            lParam,
            (await world.getNativeFeature('task-memory')).vmPointer(record.id),
          );
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 172 || id === 173) {
        if (!this.task) return 1;
        if (id === 172) world.runtime.variableBank(this.task, false)?.selectContext(record.id);
        const source = memory(),
          packet = Array.from({ length: 4 }, (_, i) => source.load(lParam + i * 4));
        if (id === 173) {
          this.task.messages.push(packet.map((word) => word >>> 0));
          return 1;
        }
        const reply = await world.runtime.scheduler.send(record.id, packet);
        if (reply.accepted) source.store(lParam + 4, reply.message[1]);
        return reply.result;
      }
      if (id === 176 || id === 177) {
        if (id === 176 || hasPointer(lParam))
          memory().store(lParam, record.context[id === 176 ? 'variableBank' : 'stringBank'] || 0);
        return NATIVE_UNWRITTEN_WORD;
      }
      if (id === 178) {
        memory().store(lParam, record.scriptStringDirty);
        if (wParam) record.scriptStringDirty = 0;
        return NATIVE_UNWRITTEN_WORD;
      }
      const immediate = new Map([
        [4, 0xffff0001],
        [9, 0xffff0003],
        [10, 0xffff0004],
        [18, 0xffff0016],
        [22, 0xffff0014],
        [30, 0xffff0018],
        [31, 0xffff0019],
        [64, 0xffff0005],
        [65, 0xffff0017],
        [446, 0xffff0015],
      ]);
      const queued = new Map([
        [19, 0xffff0011],
        [20, 0xffff0012],
        [21, 0xffff0013],
      ]);
      if (world.profile.startsWith('sdk-') && [30, 31].includes(id))
        return implementation.baseMessage(words, context);
      if (immediate.has(id)) {
        if (!this.task) return [9, 10, 30, 31, 65].includes(id) ? 1 : NATIVE_UNWRITTEN_WORD;
        const reply = await world.runtime.scheduler.send(record.id, [
          id === 18 ? 0xffffffff : sender,
          immediate.get(id),
          id === 18 || id === 22 || id === 446 ? 0 : wParam,
          id === 18 ? 0 : lParam,
        ]);
        if ([9, 10].includes(id)) return 0;
        if ([4, 18, 64, 446].includes(id)) return NATIVE_UNWRITTEN_WORD;
        if ([30, 31, 65].includes(id)) return 1;
        return reply.result;
      }
      if (queued.has(id)) {
        if (this.task) this.task.messages.push([sender, queued.get(id), 0, 0]);
        return 1;
      }
      if (id === 330) {
        if (!this.machine) return 1;
        const bytes = cstringBytes(memory(), lParam),
          address = this.machine.allocate(bytes.length + 2);
        this.machine.bytes(address, bytes.length + 1).set(Uint8Array.from([...bytes, 0]));
        this.task.messages.push([sender, 0xffff0010, wParam, address]);
        setContextName(record, bytes);
        const packet = new Uint8Array(24 + bytes.length + 1),
          view = new DataView(packet.buffer);
        [0, world.nativeTaskID(record.id), 26, 0, 24, 0].forEach((v, i) =>
          view.setUint32(i * 4, v, true),
        );
        packet.set(bytes, 24);
        const payload = {
          load: (at) => view.getUint32(at, true),
          bytes: (at, n) => packet.subarray(at, at + n),
          string: (at) =>
            new TextDecoder('shift_jis').decode(packet.subarray(at, packet.indexOf(0, at))),
        };
        await world.sendEngine(record.id, record.id, 11, 0, 0, { payload });
        return 1;
      }
      if (id === 175) {
        const handle = record.context.sceneData;
        const [reader, history] = handle
          ? await (await world.getNativeFeature('scene-memory')).pointers(handle)
          : [0, 0];
        memory().store(wParam, reader);
        memory().store(lParam, history);
        return NATIVE_UNWRITTEN_WORD;
      }
      return implementation.baseMessage(words, context);
    },
    async close({ fromHost = false } = {}) {
      let destructionError;
      try {
        await world.objects.baseDestruction(record.id, { fromHost });
      } catch (error) {
        destructionError = error;
      }
      await world.graphics.images.releaseOwner(record.id);
      await world.nativeEngine?.features
        .get('image-owners')
        ?.releaseOwner(record.id, { dispose: true });
      world.runtime.services.motion?.releaseOwner(record.id);
      {
        const task = this.task;
        if (task) {
          world.runtime.scheduler.cancel(record.id, false);
          world.runtime.scheduler.tasks.delete(record.id);
        }
        world.nativeEngine?.features.get('task-memory')?.releaseMachine(record.id);
        const bank = world.runtime.variableBank(task ?? { context: record.context }, false);
        bank?.unregisterContext(record.id);
        if (bank && record.context.allowVariableInitialization !== false)
          world.runtime.handles.release(record.context.variableBank, 'variable-bank');
      }
      if (record.context.sceneData) {
        await world.nativeEngine?.features.get('scene-memory')?.release(record.context.sceneData);
        world.runtime.handles.release(record.context.sceneData, 'scene-data');
        record.context.sceneData = 0;
      }
      if (record.context.stringBank && !record.context.stringBankInherited)
        world.runtime.handles.release(record.context.stringBank, 'string-bank');
      record.scriptMessages.length = 0;
      if (destructionError) throw destructionError;
    },
    async restore() {
      if (this.task) {
        record.context = this.task.context;
        record.scriptMessages = this.task.messages;
        await this.bindMachineShared();
      }
    },
  });
  implementation.baseMessage = world.base(record).message;
  Object.defineProperties(implementation, {
    task: { configurable: true, get: () => world.runtime.scheduler.tasks.get(record.id) },
    machine: {
      configurable: true,
      get: () => world.runtime.scheduler.tasks.get(record.id)?.machine ?? null,
    },
  });
  return implementation;
}

export function installNativeScripts(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('scene-memory', (engine) => new NativeSceneMemory(engine, world));
  const game = world.game;
  world.runtime.register('main', 0x8f, async (args, machine, task) => {
    if (args.length !== 3) throw new Error('KCS script load expects three arguments');
    const source = world.runtime.services.format(args[1], machine),
      name = game.resolveCategory ? (game.resolveCategory(source, 'kcs') ?? '') : source,
      bytes = Uint8Array.from([...encodeCP932(name), 0]);
    await world.sendNativeEngine(args[0], task.id, 160, args[2], 0, {
      payload: {
        string: () => name,
        bytes: (address, count) => bytes.subarray(address, address + count),
      },
    });
    await world.sendNativeEngine(args[0], task.id, 171, machine.shared.length, 0x80000000, {
      machine,
    });
    return nativeReply(args[2] ? 4 : 2);
  });
  for (const [id, message, count] of [
    [0x23a, 442, 1],
    [0x23b, 445, 2],
    [0x23c, 444, 1],
  ])
    world.runtime.register('main', id, async (args, _machine, task) => {
      if (args.length !== count)
        throw new Error(`KCS task message ${message} expects ${count} arguments`);
      const value =
        id === 0x23b && args[1] ? (await world.ensureNativeEngine()).process.load(args[1]) : 0;
      await world.sendNativeEngine(args[0], task.id, message, 0, value);
      return nativeReply(2);
    });
}
