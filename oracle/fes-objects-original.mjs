// SPDX-License-Identifier: MPL-2.0
// Reviewed FES object constructors, built-in command handlers and frame drivers
// execute from the mounted engine image. Only script storage/variable access,
// file metadata and native task message transport cross into the host.
import { nativeABI } from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { planeState } from './fes-plane-state-original.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { objectMotionState } from '../src/motion/target.mjs';
import { tokenizeNativeFESSoundConfiguration } from '../src/native/fes-sound-config.mjs';
import { withNativeFESGallery } from './fes-gallery-original.mjs';

export class NativeFESObjectRuntime {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    this.context = null;
    this.contextQueue = Promise.resolve();
    this.pendingContexts = 0;
    this.objects = new Map();
    this.images = new Map();
    this.stringIdentities = new Map();
    this.types = new Map();
    this.topObjects = new Map();
    this.initializationLists = new Map();
    this.buffers = engine.features.get('data-buffers');
    if (!this.buffers) throw new Error('Native FES objects require the shared data-buffer feature');
    const p = this.process,
      at = (game, sdk) => (this.sdk ? sdk : game);
    this.registerType(0, {
      construct: at(0x7484a0, 0x5e8ac0),
      size: 44,
      vramOffset: null,
      syncObject() {},
    });
    engine.registerWindows('USER32.dll', 'SetRectEmpty', {
      count: 1,
      fn: ([out]) => {
        p.zero(out, 16);
        return 1;
      },
    });
    this.table = new Map();
    const table = at(0x8f5d08, 0x9b7ad8);
    for (let i = 0; i < 150; i++) {
      const row = table + i * 20,
        name = p.string(row),
        fn = p.load(row + 16);
      if (!/^[a-z0-9_]+$/.test(name) || fn < 0x400000 || fn >= 0x900000) break;
      this.table.set(name, fn);
    }
    this.memory = {
      load: (address) => p.load(address),
      store: (address, value) => p.store(address, value),
      bytes: (address, length) => p.read(address, length),
      write: (address, bytes) => p.write(address, bytes),
      string: (address, wide = false) => p.string(address, wide),
      writeString: (address, text) => p.write(address, encodeCP932(`${text}\0`)),
    };
    this.send = p.trap(
      'FES object native task transport',
      7,
      async ([sender, target, rawMessage, w, l, flags, result]) => {
        const context = this.requireContext(),
          adapter = context.object ? this.adapter(context.object.nativeType) : null;
        const origin = context.instance.runtimeID,
          senderWorldID = world.resolveTaskID ? world.resolveTaskID(sender, origin) : sender;
        if (senderWorldID == null)
          throw new Error(`FES native task sender ${sender} is outside its Top namespace`);
        const targetWorldID = world.resolveTaskID
          ? world.resolveTaskID(target, senderWorldID)
          : target;
        if (targetWorldID == null) return 0;
        await world.effectsFES?.prepareTaskTransport(rawMessage, w, targetWorldID);
        let value;
        if (rawMessage === 1) {
          let id;
          if (world.sendNativeEngine) {
            const transport = {
              payload: this.memory,
              nativePointer: true,
              nativeResult: result,
              fromHost: true,
              flags,
            };
            const nativeID = await world.sendNativeEngine(
              target,
              senderWorldID,
              1,
              w,
              l,
              transport,
            );
            id = Number.isInteger(nativeID) ? world.resolveTaskID(nativeID, senderWorldID) : null;
            if (id == null)
              throw new Error('Original FES task creation did not return its new task');
          } else
            id = await world.objects.create({
              kind: w,
              parent: targetWorldID,
              creator: senderWorldID,
              name: p.string(l),
            });
          const implementation = world.objects.objects.get(id).implementation;
          // Native registration writes its actual task prefix to the guest
          // output, including for host-owned receivers such as particles.
          const pointer =
            world.sendNativeEngine && result ? p.load(result) : implementation.pointer;
          if (!pointer) {
            await world.objects.release(id);
            throw new Error(`Original FES task factory ${w} has no original guest task instance`);
          }
          value = pointer;
          context.object.nativeTaskID = id;
        } else {
          const task =
            this.world.graphics.get(targetWorldID) ||
            world.objects.objects.get(targetWorldID)?.implementation;
          if (!task) return 0;
          const message = world.screenEffects?.tasks.has(targetWorldID)
            ? mapABIMessage(engine.profile, 'screen', 'canonical', rawMessage, task.record.kind)
            : world.areaEffects?.tasks.has(targetWorldID)
              ? mapABIMessage(engine.profile, 'area', 'canonical', rawMessage)
              : adapter?.canonicalMessage
                ? adapter.canonicalMessage(rawMessage)
                : rawMessage;
          const transport = {
            payload: this.memory,
            nativePointer: true,
            fromHost: true,
            nativeResult: result,
            flags,
          };
          transport.nativeSenderWorldID = senderWorldID;
          value = this.world.sendNativeEngine
            ? await this.world.sendNativeEngine(target, senderWorldID, message, w, l, transport)
            : await task.message([sender, message, w, l], transport);
          if (result && Number.isInteger(value)) p.store(result, value);
          if (message === 3) {
            const record = world.objects.objects.get(targetWorldID);
            if (record) record.destroyRequested = true;
          }
          context.messages?.push({ message, w, l, flags });
        }
        if (rawMessage === 1 && result) p.store(result, value);
        return 1;
      },
    );
    this.vtable = p.allocate(32, true);
    p.store(this.vtable + 16, this.send);
    this.driver = p.allocate(0x1000, true);
    p.store(this.driver, this.vtable);
    this.interpreter = p.allocate(0x1000, true);
    p.store(this.driver + 104, this.interpreter);
    p.store(this.driver + 380, this.interpreter);
    const patch = (game, sdk, name, count, callback) =>
      engine.patch(at(game, sdk), name, count, callback, { calleePops: true });
    patch(0x766440, 0x6020c0, 'FES object parameter token', 3, ([source, index, out]) => {
      const c = this.requireContext(),
        token = (
          c.sourceTokens
            ? tokenizeNativeFESSoundConfiguration(p.string(source), engine.profile)
            : c.tokens
        )?.[index];
      c.tokenIndex = index >>> 0;
      if (token === undefined) return 0;
      const bytes = c.argumentBytes
        ? c.argumentBytes(token)
        : c.instance.argumentBytes
          ? c.instance.argumentBytes(token)
          : encodeCP932(token);
      if (!(bytes instanceof Uint8Array))
        throw new TypeError('Native FES token expansion must supply bytes');
      if (bytes.length >= 2560)
        throw new RangeError('Native FES parameter exceeds its 2560-byte destination');
      p.write(out, bytes);
      p.zero(out + bytes.length, 1);
      return 1;
    });
    patch(
      0x755520,
      0x5f3a80,
      'FES object object count',
      1,
      ([name]) => this.requireContext().instance.declaredGroups[p.string(name)] ?? 0,
    );
    patch(0x755630, 0x5f3b90, 'FES object object lookup', 2, async ([name, index]) => {
      const c = this.requireContext(),
        key = p.string(name),
        object = c.instance.objects.find(
          (object) =>
            object.baseName === key &&
            (object.index ?? 0) === (index | 0) &&
            c.instance.byKey.get(object.key) === object,
        );
      const top = key === '_TOPOBJ_' && index === 0;
      if (c.fontSource && (top || (object && !object.deleted && object.nativeType !== 2))) {
        const stack = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
        // userfontobj retains the source for its next driver pass, which
        // reads the IMAGE tail without checking the source object's type.
        // Only this lookup is the source; the destination is a text object.
        if (p.load(stack) === at(0x777408, 0x6114f8))
          throw new Error(`FES userfontobj requires an IMAGE source: ${key}`);
      }
      if (top) return this.topObject(c.instance);
      if (!object || object.deleted) return 0;
      if (c.resourceDrivers) {
        c.object = object;
        c.pointer = object.nativeObjectPointer;
      }
      if (object === c.object) return c.pointer;
      if (object.nativeType === 2 && !c.planeAssociation) return this.image(c.instance, object);
      if (this.types.has(object.nativeType)) {
        const pointer = await this.create(c.instance, object);
        if (object.nativeType === 4) await this.syncObject(c.instance, object, pointer);
        return pointer;
      }
      throw new Error(`Original FES object referenced an unbound ${object.type} object ${key}`);
    });
    patch(0x7556a0, 0x5f3c00, 'FES object reverse lookup', 3, ([pointer, name, index]) => {
      const object = this.requireContext().instance.objects.find(
        (candidate) => candidate.nativeObjectPointer === pointer,
      );
      if (!object) return 0;
      if (name) p.write(name, encodeCP932(object.baseName + '\0'));
      if (index) p.store(index, object.index ?? 0);
      return 1;
    });
    patch(
      0x7563b0,
      0x5f4660,
      'FES object dynamic factory',
      4,
      async ([type, name, count, owner]) => {
        const c = this.requireContext(),
          key = p.string(name);
        if (owner && this.objects.get(owner)?.owner !== c.instance.runtimeID)
          throw new Error('Native FES dynamic parent is outside its interpreter');
        c.instance.createObjects(type, key, count);
        for (const object of c.instance.objects.filter(
          (candidate) =>
            candidate.baseName === key &&
            !candidate.deleted &&
            c.instance.byKey.get(candidate.key) === candidate,
        )) {
          object.nativeParentPointer = owner;
          if ([24, 38].includes(c.object?.nativeType))
            object.nativeControlledByLog = c.object.handle;
          await this.create(c.instance, object);
        }
        return 1;
      },
    );
    patch(0x7562e0, 0x5f4590, 'FES object pending resource queue', 3, ([name, index, remove]) => {
      const c = this.requireContext(),
        queue = c.initializationQueue;
      if (!queue) throw new Error('Original FES allocation requires its pending object queue');
      const object = queue[0];
      if (!object) return 0;
      p.write(name, encodeCP932(object.baseName + '\0'));
      p.store(index, object.index ?? 0);
      c.object = object;
      c.pointer = object.nativeObjectPointer;
      if (remove) queue.shift();
      return 1;
    });
    patch(0x756770, 0x5f4a20, 'FES object collection deletion', 1, async ([pointer]) => {
      const c = this.requireContext();
      await this.deleteObject(c.instance, pointer);
      return 1;
    });
    patch(0x7554c0, 0x5f3a20, 'FES object map deletion', 1, async ([pointer]) => {
      await this.deleteObject(this.requireContext().instance, pointer);
      return 1;
    });
    patch(0x728d80, 0x5d9230, 'FES object integer expression', 1, ([source]) =>
      this.requireContext().evaluate
        ? this.requireContext().evaluate(p.string(source), this.requireContext().tokenIndex)
        : this.requireContext().instance.value(p.string(source)),
    );
    patch(0x728c40, 0x5d90f0, 'FES object global result', 2, ([index, value]) =>
      this.requireContext().instance.setGlobal(index | 0, value | 0),
    );
    patch(0x757bb0, 0x5f5d40, 'FES object local result', 2, ([index, value]) =>
      this.requireContext().instance.setLocal(index | 0, value | 0),
    );
    patch(0x740800, 0x5e1660, 'FES object string result', 2, ([index, source]) => {
      const c = this.requireContext();
      if (c.setStringBytes)
        c.setStringBytes(index >>> 0, source ? p.stringBytes(source).slice() : new Uint8Array());
      else c.instance.player.strings[index >>> 0] = source ? p.string(source) : '';
      return 1;
    });
    patch(0x7402f0, 0x5e1150, 'FES object string expression', 2, ([source, out]) => {
      const c = this.requireContext();
      if (c.expandBytes) {
        const bytes = c.expandBytes(p.stringBytes(source));
        if (bytes.length >= 4096)
          throw new RangeError('Native scene display string exceeds its 4096-byte destination');
        p.write(out, bytes);
        p.zero(out + bytes.length, 1);
        return out;
      }
      if (typeof c.instance.player.host.nativeFESStringBytes === 'function') {
        const bytes = c.instance.player.host.nativeFESStringBytes(
          p.stringBytes(source),
          c.instance,
        );
        if (!(bytes instanceof Uint8Array))
          throw new TypeError('Native FES string expansion must supply bytes');
        // Both original handlers reserve 2048 bytes and the original string
        // bank writes a second NUL. SCRIPT replacement runs afterwards in the
        // original handler, independently of this single bank expansion.
        if (bytes.length + 2 > 2048)
          throw new RangeError('Native FES expanded string exceeds its 2048-byte destination');
        p.write(out, bytes);
        p.zero(out + bytes.length, 2);
        return 1;
      }
      const input = new TextDecoder(c.object.nativeType === 37 ? 'utf-8' : 'shift_jis').decode(
        p.stringBytes(source),
      );
      const bytes = this.encode(c.object, c.instance.player.expand(input));
      const capacity = this.adapter(c.object.nativeType).stringCapacity ?? 2048;
      if (bytes.length >= capacity)
        throw new RangeError(`Native FES expanded string exceeds its ${capacity}-byte destination`);
      p.write(out, bytes);
      p.zero(out + bytes.length, 1);
      return out;
    });
    // The original driver can query a reference frame's size or position.
    // The image resource provider retains the engine's actual cropped frame.
    for (const [game, sdk, name, position] of [
      [0x62b8d0, 0x502ef0, 'FES object reference size', false],
      [0x62b640, 0x502c90, 'FES object reference position', true],
    ])
      patch(game, sdk, name, 4, async ([source, selector, x, y]) => {
        p.store(x, 0);
        p.store(y, 0);
        const c = this.requireContext(),
          handle = await world.graphics.images.load(
            c.instance.player.expand(p.string(source)),
            selector | 0,
            c.instance.runtimeID,
          );
        if (!handle) return 0;
        try {
          const image = world.graphics.images.get(handle);
          p.store(x, position ? image.state.offsetX : image.width);
          p.store(y, position ? image.state.offsetY : image.height);
          return 1;
        } finally {
          await world.graphics.images.release(handle);
        }
      });
    engine.registerFeature('fes-objects', this);
  }
  requireContext() {
    if (!this.context) throw new Error('Original FES object boundary has no active interpreter');
    return this.context;
  }
  encode(object, text) {
    return object.nativeType === 37 ? new TextEncoder().encode(text) : encodeCP932(text);
  }
  withContext(context, callback) {
    if (this.context && this.process.asyncEnabled) {
      const previous = this.context;
      this.pendingContexts++;
      this.context = context;
      return (async () => {
        try {
          return await this.withStringIdentity(context, callback);
        } finally {
          this.context = previous;
          this.pendingContexts--;
        }
      })();
    }
    this.pendingContexts++;
    const operation = this.contextQueue.then(async () => {
      this.context = context;
      try {
        return await this.withStringIdentity(context, callback);
      } finally {
        this.context = null;
        this.pendingContexts--;
      }
    });
    this.contextQueue = operation.catch(() => {});
    return operation;
  }
  async withStringIdentity(context, callback) {
    const p = this.process,
      record = this.world.objects.objects.get(context.instance.runtimeID),
      handle = record?.context?.stringBank,
      key = handle === undefined ? `authored:${context.instance.runtimeID}` : handle;
    let pointer = 0;
    if (handle !== 0) {
      pointer = this.stringIdentities.get(key);
      if (!pointer) {
        pointer = p.allocate(4, true);
        try {
          await this.call(this.sdk ? 0x5e1080 : 0x740220, [], pointer);
          this.stringIdentities.set(key, pointer);
        } catch (error) {
          p.free(pointer);
          throw error;
        }
      }
    }
    const bankOffset = nativeABI(this.engine.profile).fes.variableBankOffset,
      previous = p.load(this.interpreter + bankOffset);
    p.store(this.interpreter + bankOffset, pointer);
    try {
      return await callback();
    } finally {
      p.store(this.interpreter + bankOffset, previous);
    }
  }
  registerType(type, adapter) {
    if (!Number.isInteger(type) || this.types.has(type) || !adapter.construct)
      throw new Error(`Invalid or duplicate native FES object adapter ${type}`);
    this.types.set(type, adapter);
  }
  adapter(type) {
    const adapter = this.types.get(type);
    if (!adapter) throw new Error(`Native FES object type ${type} has no recovered region adapter`);
    return adapter;
  }
  call(
    address,
    args = [],
    pointer,
    task = this.context?.instance.runtimeID ?? this.objects.get(pointer)?.owner,
    messageContext,
  ) {
    const options = { task, messageContext };
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, options)
      : this.engine.call(address, args, pointer, options);
  }
  async constructBase(instance, object, pointer, args) {
    await this.call(this.adapter(0).construct, args, pointer, instance.runtimeID);
    this.process.store(pointer + 4, object.nativeType);
  }
  async constructPlane(instance, object, pointer, args) {
    // D7 common motion/parent prefix only; JS text and M2 own their suffixes.
    await this.call(this.sdk ? 0x5ebea0 : 0x74b940, args, pointer, instance.runtimeID);
    this.process.store(pointer + 4, object.nativeType);
  }
  async create(instance, object) {
    if (object.nativeObjectPointer != null) {
      if (!this.objects.has(object.nativeObjectPointer))
        throw new Error('FES checkpoint object is missing from the shared engine');
      const adapter = this.adapter(object.nativeType),
        rows = object.nativeDefinitions || [];
      if (adapter.definitionApply && (object.nativeDefinitionAppliedCount || 0) < rows.length) {
        const pending = rows.slice(object.nativeDefinitionAppliedCount || 0);
        await this.applyDefinition(
          instance,
          object,
          object.nativeObjectPointer,
          adapter.definitionApply,
        );
        await adapter.afterDefinition?.(
          this,
          instance,
          object,
          object.nativeObjectPointer,
          pending,
        );
      }
      return object.nativeObjectPointer;
    }
    const adapter = this.adapter(object.nativeType),
      p = this.process,
      pointer = p.allocate(adapter.size ?? 0x800, true),
      cache = this.sdk ? 0xc967ec : 0xb91e54;
    if (!p.load(cache))
      p.store(
        cache,
        await this.call(this.sdk ? 0x622ad0 : 0x78a9d0, [0, 0], cache, instance.runtimeID),
      );
    let constructed = false;
    try {
      const constructor = adapter.constructorArguments
        ? await adapter.constructorArguments(this, instance, object)
        : { args: [object.nativeParentPointer ?? 0] };
      try {
        if (typeof adapter.construct === 'function')
          await adapter.construct(this, instance, object, pointer, constructor.args);
        else await this.call(adapter.construct, constructor.args, pointer, instance.runtimeID);
      } finally {
        constructor.release?.();
      }
      constructed = true;
      this.objects.set(pointer, { pointer, type: object.nativeType, owner: instance.runtimeID });
      object.nativeObjectPointer = pointer;
      object.nativeDefinitionAppliedCount = 0;
      await adapter.initialize?.(this, instance, object, pointer);
      return pointer;
    } catch (error) {
      if (constructed) await this.destroy(pointer);
      else p.free(pointer);
      object.nativeObjectPointer = null;
      throw error;
    }
  }
  async topObject(instance) {
    const owner = instance.runtimeID;
    if (this.topObjects.has(owner)) return this.topObjects.get(owner);
    const pointer = await this.create(instance, {
      nativeType: 0,
      baseName: '_TOPOBJ_',
      key: '_TOPOBJ_',
      index: 0,
    });
    this.topObjects.set(owner, pointer);
    return pointer;
  }
  async initializeObjectResources(instance, object) {
    const pointer = await this.create(instance, object),
      p = this.process;
    if (!this.initializationLists.has(instance.runtimeID)) {
      const list = p.allocate(8, true),
        head = p.allocate(12, true);
      p.store(list, head);
      p.store(head, head);
      p.store(head + 4, head);
      this.initializationLists.set(instance.runtimeID, list);
    }
    p.store(this.driver + 384, this.initializationLists.get(instance.runtimeID));
    p.store(this.driver + 4, this.world.nativeTaskID(instance.runtimeID));
    await this.withContext({ instance, object, pointer, initializationQueue: [object] }, () =>
      this.call(this.sdk ? 0x500390 : 0x628d60, [], this.driver),
    );
  }
  async runResourceDrivers(instance) {
    const list = this.initializationLists.get(instance.runtimeID);
    if (!list) return;
    const p = this.process,
      record = this.world.objects.objects.get(instance.runtimeID),
      context = { instance, resourceDrivers: true },
      types = this.types;
    await this.withContext(context, async () => {
      p.store(this.driver + 4, this.world.nativeTaskID(instance.runtimeID));
      p.store(this.driver + 88, record.pausedFrames ?? 0);
      p.store(this.driver + 100, record.effectiveFrame ?? 0);
      p.store(this.driver + 384, list);
      await this.call(this.sdk ? 0x504e50 : 0x62da50, [], this.driver, instance.runtimeID, {
        // The list driver can visit several object types during one call.
        get categoryFilenameCapacity() {
          return types.get(context.object?.nativeType)?.categoryFilenameCapacity;
        },
      });
    });
  }
  async planeAssociationPhase(instance, beforeScript) {
    // 628B20 / 62E0B0 iterate the resource identities, not their resource
    // ownership fields. Project those identities from the live interpreter;
    // the original routines own all count, type and pending-delta semantics.
    // This temporary read-only list must not replace the allocation queue.
    const objects = instance.objects.filter((object) =>
        [1, 2, 4, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25].includes(object.nativeType),
      ),
      p = this.process,
      storage = p.allocate(20 + objects.length * 44, true),
      list = storage,
      head = storage + 8,
      previous = p.load(this.driver + 384);
    p.store(list, head);
    p.store(head, objects.length ? storage + 20 : head);
    p.store(head + 4, objects.length ? storage + 20 + (objects.length - 1) * 44 : head);
    try {
      for (let i = 0; i < objects.length; i++) {
        const object = objects[i],
          node = storage + 20 + i * 44,
          name = encodeCP932(object.baseName);
        if (name.length >= 32) throw new RangeError('Native FES resource name exceeds 31 bytes');
        p.store(node, i + 1 === objects.length ? head : node + 44);
        p.store(node + 4, i === 0 ? head : node - 44);
        p.write(node + 8, name);
        p.store(node + 40, object.index ?? 0);
      }
      // These two passes query object identity and display counts. Running
      // an image driver during lookup consumes its dirty flag before the
      // frame's declared resource order has established the plane geometry.
      await this.withContext({ instance, planeAssociation: true }, async () => {
        p.store(this.driver + 384, list);
        await this.call(
          this.sdk ? (beforeScript ? 0x500150 : 0x505460) : beforeScript ? 0x628b20 : 0x62e0b0,
          [],
          this.driver,
        );
      });
    } finally {
      p.store(this.driver + 384, previous);
      p.free(storage);
    }
  }
  async deleteObject(instance, pointer) {
    if (this.objects.get(pointer)?.owner !== instance.runtimeID) return;
    const visit = async (current) => {
      for (const child of [...this.objects.keys()])
        if (this.process.load(child + 12) === current) await visit(child);
      const object = instance.objects.find((object) => object.nativeObjectPointer === current);
      if (object) {
        object.deleted = true;
        instance.player.nativeVariableContext?.(instance);
        const record = this.world.objects.objects.get(instance.runtimeID),
          handle = record?.context?.variableBank;
        if (handle)
          this.world.runtime.handles
            .get(handle, 'variable-bank')
            .deleteName(object.baseName, object.index ?? 0);
        const queue = this.context?.initializationQueue;
        if (queue) {
          const index = queue.indexOf(object);
          if (index !== -1) queue.splice(index, 1);
        }
      }
      await this.destroy(current);
      if (object) object.nativeObjectPointer = null;
    };
    await visit(pointer);
  }
  releaseInitializationList(owner) {
    const list = this.initializationLists.get(owner);
    if (!list) return;
    const p = this.process,
      head = p.load(list);
    let node = p.load(head);
    while (node !== head) {
      const next = p.load(node);
      p.free(node);
      node = next;
    }
    p.free(head);
    p.free(list);
    this.initializationLists.delete(owner);
  }
  releaseImageData(image) {
    if (!image.block) return;
    this.buffers.releasePointer(image.block);
  }
  releaseOwnerImages(owner) {
    for (const [key, image] of this.images) {
      if (!key.startsWith(`${owner}:`)) continue;
      this.releaseImageData(image);
      this.process.free(image.pointer);
      this.images.delete(key);
    }
  }
  async releaseOwnerObjects(owner) {
    for (const pointer of this.destructionOrder())
      if (this.objects.get(pointer)?.owner === owner) await this.destroy(pointer);
    this.releaseInitializationList(owner);
  }
  destructionOrder() {
    const depth = (pointer) => {
      const seen = new Set();
      let current = pointer;
      while (this.objects.has(current)) {
        if (seen.has(current)) throw new Error('Native FES object parent cycle');
        seen.add(current);
        current = this.process.load(current + 12);
      }
      return seen.size;
    };
    return [...this.objects.keys()].sort((a, b) => depth(b) - depth(a));
  }
  async image(instance, object) {
    if (object.nativeType === 2 && this.types.has(2)) {
      await this.world.imagesFES.update(instance, object);
      return object.nativeObjectPointer;
    }
    const p = this.process,
      key = `${instance.runtimeID}:${object.handle}`,
      file = instance.player.expand(object.file || '');
    let image = this.images.get(key);
    if (!image) {
      image = { file: null, block: 0, pointer: p.allocate(0x800, true) };
      p.store(image.pointer + 4, object.nativeType);
      this.images.set(key, image);
    }
    if (image.file !== file) {
      let bytes = null;
      let block = 0;
      const owner = this.world.objects?.objects?.get(instance.runtimeID)?.implementation;
      if (file && typeof owner?.imageData === 'function') {
        block = await owner.imageData(file);
        if (block) this.buffers.retainPointer(block);
      } else if (file) {
        if (this.world.game.readCategory) bytes = await this.world.game.readCategory(file, 'image');
        else if (
          !this.world.game.resolveCategory ||
          this.world.game.resolveCategory(file, 'image') !== null
        )
          bytes = this.world.game.requireCategory
            ? await this.world.game.requireCategory(file, 'image')
            : await this.world.game.require(file);
      }
      // An absent image leaves its original data-buffer field null. A user
      // font can bind that object and the native text engine clears the old
      // image font. Present, malformed image bytes still reach its parser.
      this.releaseImageData(image);
      Object.assign(image, { file, block });
      if (bytes) {
        image.block = this.buffers.createPointer(bytes);
      }
      p.store(image.pointer + nativeABI(this.engine.profile).fes.imageBlockOffset, image.block);
    }
    return image.pointer;
  }
  syncObject(instance, object, pointer) {
    const p = this.process;
    const adapter = this.adapter(object.nativeType);
    if (adapter.syncObject) return adapter.syncObject(this, instance, object, pointer);
    if (object.nativeControlledByLog != null) {
      const sleeping = !!instance.player.nativeInput?.state.sleeping;
      if (sleeping && object.nativeLogDisplay == null) {
        object.nativeLogDisplay = p.load(pointer + 188);
        p.store(pointer + 188, 0);
      } else if (!sleeping && object.nativeLogDisplay != null) {
        p.store(pointer + 188, object.nativeLogDisplay);
        object.nativeLogDisplay = null;
      }
      return;
    }
    const bytes = p.load(pointer + 12) ? objectMotionState(object) : planeState(instance, object),
      view = new DataView(bytes.buffer),
      copy = (source, destination, count) =>
        p.write(pointer + destination, bytes.subarray(source, source + count));
    copy(MOTION_ABI.pos, 48, 12);
    copy(MOTION_ABI.base, 64, 8);
    copy(MOTION_ABI.scale, 96, 12);
    copy(MOTION_ABI.matrix, 112, 64);
    p.store(pointer + 184, object.pri);
    p.store(pointer + 188, Number(object.disp && !instance.player.nativeInput?.state.sleeping));
    p.store(pointer + 192, view.getUint32(MOTION_ABI.color, true));
    const vramOffset = this.adapter(object.nativeType).vramOffset;
    if (vramOffset != null) {
      // Text drivers upload to their own configured page, independently of
      // the Draw task that owns the surrounding retained images.
      const vram = new Float32Array([object.vramX, object.vramY, object.vramZ, 0]);
      p.write(pointer + vramOffset, new Uint8Array(vram.buffer));
    }
    p.store(pointer + 16, 1);
  }
  async runDriver(
    instance,
    object,
    { configurationDirty = false, arguments: driverArguments } = {},
  ) {
    if (object.deleted) {
      await this.destroy(object.nativeObjectPointer);
      object.nativeObjectPointer = null;
      return;
    }
    const pointer = await this.create(instance, object),
      adapter = this.adapter(object.nativeType),
      p = this.process;
    if (!adapter.driver)
      throw new Error(`Native FES object ${object.type} has no recovered frame driver`);
    await this.syncObject(instance, object, pointer);
    await this.withContext({ instance, object, pointer }, async () => {
      p.store(
        this.driver + 4,
        this.world.nativeTaskID ? this.world.nativeTaskID(instance.runtimeID) : instance.runtimeID,
      );
      const record = this.world.objects.objects.get(instance.runtimeID);
      p.store(this.driver + 88, record.pausedFrames ?? 0);
      p.store(this.driver + 100, record.effectiveFrame ?? 0);
      if (configurationDirty && adapter.configurationChanged) {
        if (typeof adapter.configurationChanged === 'function')
          await adapter.configurationChanged(this, instance, object, pointer);
        else await this.call(adapter.configurationChanged, [], pointer);
      }
      await adapter.beforeDriver?.(this, instance, object, pointer);
      const args = driverArguments ??
        adapter.driverArguments?.(this, instance, object, pointer) ?? [pointer];
      if (typeof adapter.driver === 'function')
        await adapter.driver(this, instance, object, { configurationDirty });
      else await this.call(adapter.driver, args, this.driver);
      await adapter.afterDriver?.(this, instance, object, pointer);
    });
  }
  async configurationChanged(instance, object, { virtual = false } = {}) {
    const pointer = await this.create(instance, object),
      adapter = this.adapter(object.nativeType),
      address = virtual
        ? this.process.load(this.process.load(pointer) + 12)
        : adapter.configurationChanged;
    if (!address) return;
    return this.withContext({ instance, object, pointer }, () =>
      typeof address === 'function'
        ? address(this, instance, object, pointer)
        : this.call(address, [], pointer),
    );
  }
  async applyDefinition(instance, object, pointer, apply) {
    const p = this.process;
    const rows = object.nativeDefinitions || [];
    for (let index = object.nativeDefinitionAppliedCount || 0; index < rows.length; index++) {
      const row = rows[index];
      const header = encodeCP932(row.header + '\0'),
        source = encodeCP932(row.source + '\0'),
        columns = p.allocate(264, true),
        record = p.allocate(896, true),
        name = p.allocate(64, true),
        head = p.allocate(header.length, true),
        values = p.allocate(source.length, true);
      p.write(head, header);
      p.write(values, source);
      try {
        await this.withContext({ instance, object, pointer, sourceTokens: true }, async () => {
          const recognized = await this.call(
            this.sdk ? 0x5f8190 : 0x75a050,
            [head, columns],
            this.interpreter,
          );
          if (!recognized)
            throw new Error(`Native FES definition header was rejected for ${object.key}`);
          await this.call(
            this.sdk ? 0x5f84f0 : 0x75a3b0,
            [values, columns, record, name],
            this.interpreter,
          );
          // The common 759650/5F77D0 dispatcher applies PARENT before its
          // type-specific function. The row parser already resolved the
          // reference to the actual object; retain that native relationship.
          if (
            !this.adapter(object.nativeType).definitionIncludesParent &&
            this.process.load(record) & 0x40
          )
            await this.call(
              this.sdk ? 0x5e8d10 : 0x7486f0,
              [this.process.load(record + 240)],
              pointer,
            );
          if (typeof apply === 'function') await apply(this, instance, object, pointer, record);
          else await this.call(apply, [pointer, record, object.index ?? 0]);
          object.nativeDefinitionAppliedCount = index + 1;
        });
      } finally {
        for (const address of [columns, record, name, head, values]) p.free(address);
      }
    }
  }
  async command(instance, object, verb, args, context = {}) {
    const group = instance.objects.filter((candidate) => candidate.baseName === object.baseName),
      index = group.length === 1 ? 0 : (context.index ?? object.index ?? 0);
    if (index === -1 && object !== group.find((candidate) => !candidate.deleted)) return;
    if (!this.adapter(object.nativeType).verbs?.has(verb))
      throw new Error(`Unrecovered native FES object command ${verb}`);
    const fn = this.table.get(verb);
    if (!fn) throw new Error(`The engine does not declare FES object command ${verb}`);
    const pointer = await this.create(instance, object),
      p = this.process,
      tokens = [object.baseName, verb, ...args],
      encodeText = ['str', 'apend'].includes(verb),
      prefix = encodeCP932(`${object.baseName} ${verb}${args.length ? ' ' : ''}`),
      content = encodeText ? this.encode(object, args.join(' ')) : encodeCP932(args.join(' ')),
      command = new Uint8Array(prefix.length + content.length + 1),
      objectName = encodeCP932(object.baseName + '\0');
    // The original tail reader can start after any parameter. STRING8
    // supplies its text bytes in the same command buffer it scans.
    command.set(prefix);
    command.set(content, prefix.length);
    if (command.length > 4096 || objectName.length > 128) {
      throw new RangeError('Native FES command or object name exceeds its source record');
    }
    const source = p.allocate(command.length, true),
      name = p.allocate(objectName.length, true);
    p.write(source, command);
    p.write(name, objectName);
    try {
      const execute = () => this.call(fn, [this.interpreter, source, name, index]);
      return await this.withContext(
        { ...context, instance, object, pointer, tokens, fontSource: verb === 'userfontobj' },
        () =>
          verb === 'loadlist' || verb === 'loadlist2'
            ? withNativeFESGallery(this, instance, execute)
            : execute(),
      );
    } finally {
      p.free(name);
      p.free(source);
    }
  }
  async commonCommand(instance, address, command, context = {}) {
    const p = this.process,
      bytes = command instanceof Uint8Array ? command : encodeCP932(command),
      source = p.allocate(bytes.length + 1, true);
    p.write(source, bytes);
    try {
      return await this.withContext({ ...context, instance, sourceTokens: true }, async () => {
        const previous = p.read(
            this.interpreter + 1480,
            nativeABI(this.engine.profile).text.pathBytes,
          ),
          previousView = p.load(this.interpreter + 8),
          name = context.contextName ?? '';
        if (typeof name !== 'string') throw new TypeError('Native FES context name requires text');
        const encoded =
          nativeABI(this.engine.profile).text.settingsCharacterBytes === 1
            ? encodeCP932(name + '\0')
            : new Uint8Array((name.length + 1) * 2);
        if (nativeABI(this.engine.profile).text.settingsCharacterBytes === 2) {
          const view = new DataView(encoded.buffer);
          for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
        }
        if (encoded.length > previous.length)
          throw new RangeError('Native FES context name exceeds its original field');
        p.write(this.interpreter + 1480, encoded);
        if (context.nativeViewPointer !== undefined)
          p.store(this.interpreter + 8, context.nativeViewPointer);
        try {
          return await this.call(address, [this.interpreter, 0, 0, source, 0]);
        } finally {
          p.write(this.interpreter + 1480, previous);
          p.store(this.interpreter + 8, previousView);
        }
      });
    } finally {
      p.free(source);
    }
  }
  async destroy(pointer) {
    if (pointer == null || !this.objects.has(pointer)) return;
    await this.call(this.process.load(this.process.load(pointer)), [1], pointer);
    this.objects.delete(pointer);
    for (const [owner, top] of this.topObjects) if (top === pointer) this.topObjects.delete(owner);
  }
  snapshot() {
    if (this.pendingContexts) throw new Error('Cannot checkpoint pending FES object work');
    return structuredClone({
      driver: this.driver,
      vtable: this.vtable,
      interpreter: this.interpreter,
      objects: [...this.objects],
      images: [...this.images],
      stringIdentities: [...this.stringIdentities],
      topObjects: [...this.topObjects],
      initializationLists: [...this.initializationLists],
    });
  }
  restore(state) {
    Object.assign(this, {
      driver: state.driver,
      vtable: state.vtable,
      interpreter: state.interpreter,
    });
    this.objects = new Map(structuredClone(state.objects));
    this.images = new Map(structuredClone(state.images));
    this.stringIdentities = new Map(state.stringIdentities);
    this.topObjects = new Map(state.topObjects);
    this.initializationLists = new Map(state.initializationLists);
  }
  async close() {
    for (const pointer of this.destructionOrder()) await this.destroy(pointer);
    for (const image of this.images.values()) {
      this.releaseImageData(image);
      this.process.free(image.pointer);
    }
    this.images.clear();
    for (const pointer of this.stringIdentities.values()) {
      await this.call(this.sdk ? 0x5e1110 : 0x7402b0, [], pointer);
      this.process.free(pointer);
    }
    this.stringIdentities.clear();
    for (const owner of this.initializationLists.keys()) this.releaseInitializationList(owner);
    this.process.free(this.driver);
    this.process.free(this.interpreter);
    this.process.free(this.vtable);
  }
}

export function registerNativeFESObjectType(world, type, factory) {
  if (!world.nativeFESObjectTypes) {
    world.nativeFESObjectTypes = new Map();
    world.registerNativeFeature('fes-objects', async (engine) => {
      await world.getNativeFeature('data-buffers');
      const runtime = new NativeFESObjectRuntime(engine, world);
      for (const [type, make] of world.nativeFESObjectTypes)
        runtime.registerType(type, make(runtime));
      return runtime;
    });
  }
  if (world.nativeFESObjectTypes.has(type))
    throw new Error(`Duplicate native FES object registration ${type}`);
  world.nativeFESObjectTypes.set(type, factory);
}
