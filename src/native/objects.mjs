// SPDX-License-Identifier: MPL-2.0
// Task identities are a separate space from native resource pointers. The
// original factory chooses the lowest unused task ID, including zero.
function snapshotSharedData(objects) {
  const buffers = new Map();
  for (const record of objects) {
    const bytes = record.sharedData;
    if (bytes === undefined) continue;
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Native shared task data must be bytes');
    if (!bytes.length) {
      record.sharedData = new Uint8Array();
      continue;
    }
    let ranges = buffers.get(bytes.buffer);
    if (!ranges) buffers.set(bytes.buffer, (ranges = []));
    ranges.push({ record, bytes, start: bytes.byteOffset, end: bytes.byteOffset + bytes.length });
  }
  for (const [buffer, ranges] of buffers) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let first = 0; first < ranges.length; ) {
      const start = ranges[first].start;
      let end = ranges[first].end,
        after = first + 1;
      while (after < ranges.length && ranges[after].start <= end) {
        end = Math.max(end, ranges[after].end);
        after++;
      }
      // Clone only this connected span. A short live view can otherwise make
      // structuredClone retain the entire engine's WASM linear memory.
      const bytes = new Uint8Array(end - start);
      bytes.set(new Uint8Array(buffer, start, end - start));
      for (let i = first; i < after; i++)
        ranges[i].record.sharedData = bytes.subarray(
          ranges[i].start - start,
          ranges[i].end - start,
        );
      first = after;
    }
  }
}
export class NativeObjects {
  constructor() {
    this.factories = new Map();
    this.objects = new Map();
    this.queue = [];
    this.nextSequence = 1;
  }
  register(kind, factory) {
    if (
      !Number.isInteger(kind) ||
      kind < 0 ||
      typeof factory !== 'function' ||
      this.factories.has(kind)
    )
      throw new Error(`Invalid or duplicate task factory ${kind}`);
    this.factories.set(kind, factory);
  }
  async create({
    kind,
    parent = null,
    name = '',
    creator = null,
    frameRate,
    nativeID,
    namespace,
    detached = false,
    effectiveFrame,
    fromHost = false,
  }) {
    if (parent !== null && !this.objects.has(parent))
      throw new Error(`Missing native parent task ${parent}`);
    const factory = this.factories.get(kind);
    if (!factory)
      throw new Error(
        `Native task kind ${kind} has not been implemented (name=${name}, parent=${parent}, creator=${creator})`,
      );
    let id = 0;
    while (this.objects.has(id)) id++;
    const owner = this.objects.get(parent);
    const identity =
      this.identity?.({ kind, parent, name, creator, frameRate, nativeID, namespace }) ?? {};
    const record = {
      id,
      kind,
      parent,
      name,
      creator,
      nativeID: nativeID ?? identity.nativeID ?? id,
      namespace: namespace ?? identity.namespace ?? null,
      state: 'creating',
      implementation: null,
      frameRate: frameRate ?? identity.frameRate ?? owner?.frameRate ?? 60,
      effectiveFrame:
        effectiveFrame ??
        (owner ? ((owner.effectiveFrame ?? 0) - (owner.pausedFrames ?? 0)) >>> 0 : 0),
      pausedFrames: 0,
      lastFrame: 0,
    };
    if (detached) record.detached = true;
    this.objects.set(id, record);
    try {
      const implementation = await factory(record, this, {
        fromHost: Boolean(fromHost || this.nativeHostDepth),
      });
      if (!implementation || typeof implementation.message !== 'function')
        throw new Error(`Task factory ${kind} lacks a message handler`);
      record.implementation = implementation;
      if (parent !== null) await implementation.parentAssigned?.(parent);
      record.state = 'active';
      return id;
    } catch (error) {
      try {
        await this.release(id, { rollback: true });
      } catch (cleanup) {
        error.cleanup = cleanup;
      }
      throw error;
    }
  }
  children(record) {
    if (this.childrenProvider) return this.childrenProvider(record);
    return [...this.objects.values()]
      .filter((child) => child.parent === record.id)
      .sort((a, b) => ((a.nativeID ?? a.id) | 0) - ((b.nativeID ?? b.id) | 0));
  }
  async eachChild(record, callback, options) {
    if (this.eachChildProvider) return this.eachChildProvider(record, callback, options);
    let previous = -Infinity;
    for (;;) {
      const child = this.children(record).find(
        (child) => ((child.nativeID ?? child.id) | 0) > previous,
      );
      if (!child) return;
      previous = (child.nativeID ?? child.id) | 0;
      await callback(child);
    }
  }
  async baseDestruction(id, { fromHost = false } = {}) {
    const record = this.objects.get(id);
    if (!record || record.baseDestructionBegan) return;
    record.baseDestructionBegan = true;
    const errors = [],
      attempt = async (callback) => {
        try {
          await callback();
        } catch (error) {
          errors.push(error);
        }
      };
    if (fromHost) this.nativeHostDepth = (this.nativeHostDepth || 0) + 1;
    try {
      await attempt(() => this.unregisterIdentity?.(record));
      await this.eachChild(
        record,
        (child) => attempt(() => this.destroy(child.id, id, { fromHost })),
        { teardown: true },
      );
      // The C++ base destructor has installed its own vtable before sending
      // this packet to itself, so derived notifications must not run again.
      record.destroyRequested = true;
      await this.eachChild(record, (child) => attempt(() => this.release(child.id, { fromHost })), {
        teardown: true,
      });
      record.nativeTaskRoutes?.clear();
    } finally {
      if (fromHost) this.nativeHostDepth--;
    }
    if (errors.length)
      throw new AggregateError(errors, `Native task ${id} base destruction failed`);
  }
  async release(id, { fromHost = false, rollback = false } = {}) {
    const record = this.objects.get(id);
    if (!record || record.state === 'releasing') return false;
    record.state = 'releasing';
    fromHost = Boolean(fromHost || this.nativeHostDepth);
    const errors = [];
    try {
      await record.implementation?.close?.({ fromHost });
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.baseDestruction(id, { fromHost });
    } catch (error) {
      errors.push(error);
    }
    try {
      if (rollback) await this.releaseIdentity?.(record);
    } catch (error) {
      errors.push(error);
    } finally {
      this.objects.delete(id);
      this.markReleasedIdentity?.(record);
      this.queue = this.queue.filter((q) => q.target !== id);
    }
    if (errors.length) throw new AggregateError(errors, `Native task ${id} cleanup failed`);
    return true;
  }
  async destroy(id, sender = 0xffffffff, context = {}) {
    const record = this.objects.get(id);
    if (!record || record.destroyRequested) return false;
    if (this.notify) await this.notify(id, sender, 3, 0, 0, context);
    else
      await record.implementation?.message(
        [this.objects.get(sender)?.nativeID ?? sender, 3, 0, 0],
        { ...context, nativeSenderWorldID: sender },
      );
    record.destroyRequested = true;
    if (record.implementation?.runsBaseLogic === false) record.hostDestroyRequested = true;
    return true;
  }
  machine(id) {
    return this.objects.get(id)?.implementation?.machine ?? null;
  }
  async send(id, words, { queued = false } = {}) {
    if (!Array.isArray(words) || words.length !== 4 || words.some((n) => !Number.isInteger(n)))
      throw new Error('Native messages require four integer words');
    const record = this.objects.get(id);
    if (!record || record.state !== 'active') return 0;
    if (queued) {
      this.queue.push({
        sequence: this.nextSequence++,
        target: id,
        words: words.map((n) => n >>> 0),
      });
      return 1;
    }
    const reply = await record.implementation.message(words.map((n) => n >>> 0));
    if (!Number.isInteger(reply))
      throw new Error(`Task ${id} message ${words[1]} did not return a word`);
    return reply >>> 0;
  }
  async tick(frame) {
    const visit = async (record, clock) => {
      if (record.state !== 'active') return;
      clock >>>= 0;
      if (record.implementation.runsBaseLogic === false) {
        // These original vtables replace the Base logic phase entirely.
        if (record.hostDestroyRequested) await this.release(record.id);
        else await record.implementation.tick?.(clock);
        return;
      }
      if (record.userValue)
        record.pausedFrames = ((record.pausedFrames ?? 0) + clock - (record.lastFrame ?? 0)) >>> 0;
      else record.effectiveFrame = clock;
      record.lastFrame = clock;
      record.implementation.beforeChildren?.();
      // The original walk resolves live signed native route keys.
      await this.eachChild(record, (child) => visit(child, record.effectiveFrame));
      if (!this.objects.has(record.id)) return;
      await this.pruneRoutes?.(record);
      if (record.destroyRequested) {
        await this.release(record.id);
        return;
      }
      const queued = this.queue.filter((q) => q.target === record.id);
      this.queue = this.queue.filter((q) => q.target !== record.id);
      for (const message of queued) {
        if (!this.objects.has(record.id)) break;
        await this.send(record.id, message.words);
      }
      if (this.objects.has(record.id)) await record.implementation.tick?.(record.effectiveFrame);
    };
    let rootID = -1;
    for (;;) {
      const root = [...this.objects.values()]
        .filter((r) => r.parent === null && !r.detached && r.id > rootID)
        .sort((a, b) => a.id - b.id)[0];
      if (!root) break;
      rootID = root.id;
      await visit(root, frame);
    }
  }
  async drawTick(frame) {
    // Root manager 5DC470 calls vft+12 after the entire vft+8 logic phase.
    // Base 5DCBE0 writes its current frame even while the task is paused,
    // then walks the live ordered child map before the derived draw phase.
    const visit = async (record, clock) => {
      if (record.state !== 'active') return;
      record.effectiveFrame = clock >>> 0;
      if (record.destroyRequested) return;
      await this.eachChild(record, (child) => visit(child, record.effectiveFrame));
      if (this.objects.has(record.id))
        await record.implementation.drawTick?.(record.effectiveFrame);
    };
    let rootID = -1;
    for (;;) {
      const root = [...this.objects.values()]
        .filter((r) => r.parent === null && !r.detached && r.id > rootID)
        .sort((a, b) => a.id - b.id)[0];
      if (!root) break;
      rootID = root.id;
      await visit(root, frame);
    }
  }
  snapshot() {
    const objects = [...this.objects.values()].map((record) => {
      if (record.state !== 'active' || typeof record.implementation.snapshot !== 'function')
        throw new Error(`Native task ${record.id} cannot be checkpointed`);
      const { implementation, ...descriptor } = record;
      return { ...descriptor, data: implementation.snapshot() };
    });
    snapshotSharedData(objects);
    return structuredClone({ objects, queue: this.queue, nextSequence: this.nextSequence });
  }
  async restore(state) {
    if (this.objects.size) throw new Error('Native object restore requires an empty task graph');
    const ids = new Set(state.objects.map((r) => r.id));
    if (ids.size !== state.objects.length) throw new Error('Duplicate native task checkpoint ID');
    const savedByID = new Map(state.objects.map((r) => [r.id, r]));
    for (const record of state.objects) {
      if (!Number.isSafeInteger(record.id) || record.id < 0)
        throw new Error('Invalid native task checkpoint ID');
      if (record.parent !== null && !ids.has(record.parent))
        throw new Error('Native task checkpoint parent is absent');
      const chain = new Set([record.id]);
      let ancestor = record.parent;
      while (ancestor !== null) {
        if (chain.has(ancestor)) throw new Error('Native task checkpoint parent cycle');
        chain.add(ancestor);
        ancestor = savedByID.get(ancestor).parent;
      }
    }
    // Clone the descriptor graph together: per-record clones would split the
    // overlapping shared spans which snapshotSharedData deliberately retained.
    const descriptors = structuredClone(
      state.objects.map(({ data: _data, ...descriptor }) => descriptor),
    );
    for (const descriptor of descriptors) {
      this.objects.set(descriptor.id, { ...descriptor, implementation: null });
    }
    try {
      for (const saved of state.objects) {
        const record = this.objects.get(saved.id),
          factory = this.factories.get(saved.kind);
        if (!factory) throw new Error(`Native checkpoint task kind ${saved.kind} is unavailable`);
        record.implementation = await factory(record, this, { restoring: true });
        if (typeof record.implementation.restore !== 'function')
          throw new Error(`Native task ${saved.id} lacks checkpoint restore`);
        await record.implementation.restore(structuredClone(saved.data));
      }
      this.queue = structuredClone(state.queue);
      this.nextSequence = state.nextSequence;
    } catch (error) {
      const cleanup = [];
      for (const id of [...this.objects.keys()]) {
        try {
          await this.release(id);
        } catch (failure) {
          cleanup.push(failure);
        }
      }
      if (cleanup.length) error.cleanup = cleanup;
      throw error;
    }
  }
}
