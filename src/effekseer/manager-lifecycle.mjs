// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Manager/instance lifecycle adapted from fixed official Effekseer 1.23,
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263. Required-operation CPU state seam.
// Full upstream grant: ../../licenses/effekseer-MIT.txt.
import { sampleFloat, sampleInt } from './numerical.mjs';
import { identity43 } from './math43.mjs';

const f = Math.fround;
const CHILDREN_MAX = 16;
const FLT_MAX = 3.4028234663852886e38;
const sorted = (map) => [...map.values()].sort((a, b) => a.handle - b.handle);
const lastBirth = (node) => {
  if (node.common.maxGeneration === -2147483648)
    throw new Error('Effekseer last-generation signed-int32 subtraction overflows');
  return f(
    f(
      f(node.common.generationTime.max * f(node.common.maxGeneration - 1)) +
        node.common.generationOffset.max,
    ) + 1,
  );
};

// This module owns lifetime/containers/groups/GC only. Parameter and current
// matrix/color cache operations are required services, never silent stubs.
export class EffekseerManagerLifecycle {
  constructor({ resources, threads, instanceOperations, capacity = 2000 } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65536)
      throw new RangeError('Invalid Effekseer manager capacity');
    if (!resources || !threads || !instanceOperations)
      throw new TypeError(
        'Effekseer manager resources, threads and instance operations are required',
      );
    for (const name of ['initializeGroup', 'initializeInstance', 'calculateInstance'])
      if (typeof instanceOperations[name] !== 'function')
        throw new TypeError(`Effekseer instance operation ${name} is required`);
    Object.assign(this, { resources, threads, operations: instanceOperations, capacity });
    this.sets = new Map();
    this.removing = [new Map(), new Map()];
    this.groups = new Map();
    this.instances = new Map();
    this.freeSlots = Array.from({ length: capacity }, (_, i) => i);
    this.rendering = [];
    this.nextHandle = 0;
    this.nextInstanceID = 1;
    this.nextGroupID = 1;
    this.sequence = 0;
    this.closed = false;
    this.fault = null;
  }
  assertOpen() {
    if (this.closed) throw new Error('Effekseer manager is closed');
    if (this.fault)
      throw new Error('Effekseer manager has an incomplete failed operation', {
        cause: this.fault,
      });
  }
  node(set, nodeID) {
    return this.resources.get(set.assetID).effect.nodes[nodeID];
  }
  root(set) {
    const group = this.groups.get(set.containers[set.root].groups[0]);
    return group?.active.length ? this.instances.get(group.active[0]) : null;
  }
  createGroup(set, nodeID, owner, random) {
    const node = this.node(set, nodeID),
      group = {
        id: this.nextGroupID++,
        nodeID,
        owner,
        referenced: true,
        time: 0,
        active: [],
        removing: [],
        values: null,
      };
    this.groups.set(group.id, group);
    set.containers[nodeID].groups.push(group.id);
    group.values = this.operations.initializeGroup({ node, group, set, random });
    return group;
  }
  createInstance(set, group, parent, number, random) {
    const node = this.node(set, group.nodeID),
      isRoot = node.type === 'root';
    if (!isRoot && !this.freeSlots.length) return null;
    const instance = {
      id: this.nextInstanceID++,
      nodeID: node.id,
      groupID: group.id,
      slot: isRoot ? null : this.freeSlots.shift(),
      parent: parent?.id ?? null,
      number,
      state: 'active',
      age: 0,
      life: FLT_MAX,
      stepTime: false,
      sequence: 0,
      childGroups: [],
      generated: [],
      nextGeneration: [],
      matrix: identity43(),
      values: null,
    };
    this.instances.set(instance.id, instance);
    group.active.push(instance.id);
    set.global.count++;
    // Constructor-time child groups (notably Track samples) precede Initialize.
    for (const childID of node.children)
      instance.childGroups.push(this.createGroup(set, childID, instance.id, random).id);
    for (const childID of node.children.slice(0, CHILDREN_MAX)) {
      instance.generated.push(0);
      instance.nextGeneration.push(
        sampleFloat(this.node(set, childID).common.generationOffset, random),
      );
    }
    if (isRoot) return instance;
    instance.life = f(sampleInt(node.common.life, random));
    instance.values = this.operations.initializeInstance({ node, instance, parent, set, random });
    return instance;
  }
  play(assetID, position, threadID) {
    this.assertOpen();
    if (assetID === null) return -1;
    const random = this.threads.forThread(threadID),
      asset = this.resources.get(assetID);
    if (
      !position ||
      position.length !== 3 ||
      !position.every((n) => Number.isFinite(n) && Number.isFinite(f(n)))
    )
      throw new TypeError('Effekseer Play requires three finite coordinates');
    if (this.sets.has(this.nextHandle) || this.removing.some((map) => map.has(this.nextHandle)))
      throw new Error('Effekseer handle wrap collision is unimplemented');
    const set = {
      handle: this.nextHandle,
      assetID,
      root: asset.effect.root,
      containers: asset.effect.nodes.map((node) => ({ nodeID: node.id, groups: [] })),
      global: { count: 0, updatedFrame: 0, targetLocation: [0, 0, 0] },
      removing: false,
      stop: false,
      stopRoot: false,
      paused: false,
      shown: true,
      autoDrawing: true,
      speed: 1,
    };
    this.nextHandle = this.nextHandle === 0x7fffffff ? 0 : this.nextHandle + 1;
    this.resources.retain(assetID);
    this.sets.set(set.handle, set);
    try {
      const group = this.createGroup(set, set.root, null, random),
        root = this.createInstance(set, group, null, 0, random);
      group.referenced = false;
      root.matrix[9] = f(position[0]);
      root.matrix[10] = f(position[1]);
      root.matrix[11] = f(position[2]);
      return set.handle;
    } catch (error) {
      // Unknown parameter operations remain a visible failure. close() can
      // release the partial graph; a subsequent update cannot mask it.
      this.fault = error;
      throw error;
    }
  }
  exists(handle) {
    return this.sets.has(handle) && !this.sets.get(handle).removing;
  }
  stop(handle) {
    this.assertOpen();
    const set = this.sets.get(handle);
    if (set) set.stop = set.removing = true;
  }
  stopAll() {
    for (const set of this.sets.values()) set.stop = set.removing = true;
  }
  kill(instance) {
    if (instance.state !== 'active') return;
    for (const id of instance.childGroups) {
      const group = this.groups.get(id);
      if (group) group.referenced = false;
    }
    instance.state = 'removing';
  }
  killGroups(set, rootOnly = false) {
    for (const container of set.containers) {
      if (rootOnly && container.nodeID !== set.root) continue;
      for (const groupID of container.groups) {
        const group = this.groups.get(groupID);
        for (const instanceID of group.active) {
          const instance = this.instances.get(instanceID);
          if (instance.state === 'active') {
            this.kill(instance);
            group.removing.push(instanceID);
          }
        }
        group.active.length = 0;
      }
    }
  }
  executeEvents() {
    for (const set of sorted(this.sets)) {
      if (set.stop) {
        this.killGroups(set);
        set.removing = true;
      }
      if (set.stopRoot) this.killGroups(set, true);
    }
  }
  cleanInstances(set, group) {
    let keep = 0;
    for (const id of group.removing) {
      const instance = this.instances.get(id);
      if (instance.state === 'removing') {
        instance.state = 'removed';
        group.removing[keep++] = id;
      } else if (instance.state === 'removed') {
        this.instances.delete(id);
        if (instance.slot !== null) this.freeSlots.push(instance.slot);
        set.global.count--;
      } else throw new Error('Effekseer removing list contains an active instance');
    }
    group.removing.length = keep;
  }
  cleanGroups(container) {
    let keep = 0;
    for (const id of container.groups) {
      const group = this.groups.get(id);
      if (!group.referenced && !group.active.length && !group.removing.length)
        this.groups.delete(id);
      else container.groups[keep++] = id;
    }
    container.groups.length = keep;
  }
  removeForcibly(set) {
    this.killGroups(set);
    for (const container of set.containers) {
      for (const id of container.groups) {
        const group = this.groups.get(id);
        this.cleanInstances(set, group);
        this.cleanInstances(set, group);
        // Container destruction owns all remaining groups, including groups
        // whose owner died without a later child-container update.
        this.groups.delete(id);
      }
      container.groups.length = 0;
    }
    if (set.global.count !== 0) throw new Error('Effekseer forced cleanup lost instances');
  }
  gc() {
    for (const set of sorted(this.removing[1])) {
      this.removeForcibly(set);
      this.resources.release(set.assetID);
    }
    this.removing[1].clear();
    for (const set of sorted(this.removing[0])) this.removing[1].set(set.handle, set);
    this.removing[0].clear();
    for (const set of sorted(this.sets)) {
      let remove = set.removing || set.global.count === 0;
      if (!remove && set.global.count === 1) {
        const root = this.root(set),
          node = this.node(set, set.root);
        if (root?.state === 'active') {
          let finished = 0;
          for (const childID of node.children.slice(0, CHILDREN_MAX)) {
            if (root.age >= lastBirth(this.node(set, childID))) finished++;
            else break;
          }
          remove = finished === node.children.length;
        }
      }
      if (remove) {
        set.stop = set.removing = true;
        this.removing[0].set(set.handle, set);
        this.sets.delete(set.handle);
      }
    }
  }
  calculate(set, instance, delta) {
    if (instance.sequence === this.sequence) return;
    instance.sequence = this.sequence;
    if (instance.nodeID === set.root) return;
    this.operations.calculateInstance({
      node: this.node(set, instance.nodeID),
      instance,
      parent: this.instances.get(instance.parent) ?? null,
      root: this.root(set),
      set,
      delta,
    });
  }
  updateInstance(set, instance, delta, shown, random) {
    const node = this.node(set, instance.nodeID),
      common = node.common,
      isRoot = node.type === 'root',
      originalTime = instance.age;
    let calculate = shown || (!isRoot && node.absolute.type !== 'none');
    if (
      !calculate &&
      instance.stepTime &&
      (originalTime <= instance.life || !common?.removeOnLife)
    ) {
      for (let i = 0; i < Math.min(CHILDREN_MAX, node.children.length); i++)
        if (
          this.node(set, node.children[i]).common.maxGeneration > instance.generated[i] &&
          f(originalTime + delta) > instance.nextGeneration[i]
        ) {
          calculate = true;
          break;
        }
    }
    let parent = this.instances.get(instance.parent);
    if (
      !calculate &&
      parent &&
      parent.state !== 'active' &&
      !(common.removeOnParent && !node.children.length)
    )
      calculate = true;
    if (calculate) this.calculate(set, instance, delta);
    if (parent && parent.state !== 'active') instance.parent = null;
    if (instance.stepTime) instance.age = f(instance.age + delta);
    if (instance.stepTime && (originalTime <= instance.life || !common?.removeOnLife)) {
      for (let i = 0; i < Math.min(CHILDREN_MAX, node.children.length); i++) {
        const child = this.node(set, node.children[i]),
          group = this.groups.get(instance.childGroups[i]);
        while (
          child.common.maxGeneration > instance.generated[i] &&
          f(originalTime + delta) > instance.nextGeneration[i]
        ) {
          if (!this.createInstance(set, group, instance, instance.generated[i], random)) break;
          instance.generated[i]++;
          instance.nextGeneration[i] = f(
            instance.nextGeneration[i] +
              Math.max(0, sampleFloat(child.common.generationTime, random)),
          );
        }
      }
    }
    let killed =
      !isRoot &&
      ((common.removeOnLife && instance.age > instance.life) ||
        (common.removeOnParent &&
          (instance.parent === null ||
            !this.instances.has(instance.parent) ||
            this.instances.get(instance.parent).state !== 'active')));
    if (!isRoot && !killed && common.removeOnChildren) {
      let finished = 0;
      for (let i = 0; i < Math.min(CHILDREN_MAX, node.children.length); i++) {
        const group = this.groups.get(instance.childGroups[i]);
        if (instance.age >= lastBirth(this.node(set, node.children[i])) && !group.active.length)
          finished++;
        else break;
      }
      killed = finished === node.children.length;
    }
    if (killed) {
      if (!calculate && node.children.length) this.calculate(set, instance, delta);
      this.kill(instance);
    } else instance.stepTime = true;
  }
  updateGroup(set, group, delta, shown, random) {
    this.cleanInstances(set, group);
    let keep = 0;
    for (const id of group.active) {
      const instance = this.instances.get(id);
      this.updateInstance(set, instance, delta, shown, random);
      if (instance.state === 'active') group.active[keep++] = id;
      else group.removing.push(id);
    }
    group.active.length = keep;
    group.time = (group.time + 1) | 0;
  }
  update(threadID, delta = 1) {
    this.assertOpen();
    const random = this.threads.forThread(threadID);
    if (!Number.isFinite(delta) || !Number.isFinite(f(delta)))
      throw new TypeError('Effekseer delta must be finite float32');
    try {
      this.executeEvents();
      this.gc();
      this.rendering = sorted(this.sets).map((set) => ({
        handle: set.handle,
        paused: set.paused,
        shown: set.shown,
        autoDrawing: set.autoDrawing,
        speed: set.speed,
      }));
      this.sequence = (this.sequence + 1) | 0;
      for (const render of this.rendering) {
        if (render.paused) continue;
        const set = this.sets.get(render.handle),
          df = f(f(delta) * render.speed);
        // Reader node IDs are preorder; native container Update visits parent
        // groups, invalid groups, then child containers in that same order.
        for (const container of set.containers) {
          for (const id of container.groups)
            this.updateGroup(set, this.groups.get(id), df, render.shown, random);
          this.cleanGroups(container);
        }
        set.global.updatedFrame = f(set.global.updatedFrame + df);
      }
    } catch (error) {
      this.fault = error;
      throw error;
    }
  }
  draw(visitor) {
    this.assertOpen();
    if (typeof visitor?.instance !== 'function')
      throw new TypeError('Effekseer draw instance visitor is required');
    for (const render of this.rendering) {
      if (!render.shown || !render.autoDrawing) continue;
      const set =
        this.sets.get(render.handle) ??
        this.removing[0].get(render.handle) ??
        this.removing[1].get(render.handle);
      if (!set) throw new Error('Effekseer rendering set lost its owner');
      for (const container of set.containers) {
        const node = this.node(set, container.nodeID);
        if (node.type === 'root' || node.type === 'none') continue;
        let count = 0;
        for (const id of container.groups) count += this.groups.get(id).active.length;
        if (!count) continue;
        visitor.beginNode?.({ set, node, count });
        for (const id of container.groups) {
          const group = this.groups.get(id);
          visitor.beginGroup?.({ set, node, group });
          const reverse = node.renderer.order === 1;
          for (let i = 0; i < group.active.length; i++) {
            const instance = this.instances.get(
              group.active[reverse ? group.active.length - 1 - i : i],
            );
            if (node.isRendered === false) continue;
            // Original Instance::Draw lazily refreshes caches with delta zero.
            // Evaluation has no random service and never advances living time.
            try {
              this.calculate(set, instance, 0);
            } catch (error) {
              this.fault = error;
              throw error;
            }
            visitor.instance({ set, node, group, instance });
          }
          visitor.endGroup?.({ set, node, group });
        }
        visitor.endNode?.({ set, node, count });
      }
    }
  }
  snapshot() {
    this.assertOpen();
    return structuredClone({
      capacity: this.capacity,
      nextHandle: this.nextHandle,
      nextInstanceID: this.nextInstanceID,
      nextGroupID: this.nextGroupID,
      sequence: this.sequence,
      freeSlots: this.freeSlots,
      sets: [...this.sets.values()],
      removing: this.removing.map((map) => [...map.values()]),
      groups: [...this.groups.values()],
      instances: [...this.instances.values()],
      rendering: this.rendering,
    });
  }
  restore(encoded) {
    this.assertOpen();
    if (this.sets.size || this.groups.size || this.instances.size || this.nextInstanceID !== 1)
      throw new Error('Effekseer manager restore requires a fresh owner');
    const state = structuredClone(encoded),
      fail = () => {
        throw new Error('Invalid Effekseer manager checkpoint');
      },
      integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max,
      flags = (s) =>
        ['paused', 'shown', 'autoDrawing'].every((key) => typeof s[key] === 'boolean') &&
        Number.isFinite(s.speed);
    if (
      !state ||
      state.capacity !== this.capacity ||
      !integer(state.nextHandle, 0, 0x7fffffff) ||
      !integer(state.nextInstanceID, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(state.nextGroupID, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(state.sequence, -2147483648, 2147483647) ||
      !Array.isArray(state.freeSlots) ||
      !Array.isArray(state.sets) ||
      !Array.isArray(state.removing) ||
      state.removing.length !== 2 ||
      !state.removing.every(Array.isArray) ||
      !Array.isArray(state.groups) ||
      !Array.isArray(state.instances) ||
      !Array.isArray(state.rendering)
    )
      fail();
    const allSets = new Map(),
      sets = new Map(),
      removing = [new Map(), new Map()],
      groups = new Map(),
      instances = new Map(),
      slots = new Set(),
      groupOwners = new Map(),
      memberships = new Set(),
      references = new Map();
    for (const slot of state.freeSlots) {
      if (!integer(slot, 0, this.capacity - 1) || slots.has(slot)) fail();
      slots.add(slot);
    }
    for (const group of state.groups) {
      if (
        !group ||
        !integer(group.id, 1, state.nextGroupID - 1) ||
        groups.has(group.id) ||
        !integer(group.time, -2147483648, 2147483647) ||
        typeof group.referenced !== 'boolean' ||
        !Array.isArray(group.active) ||
        !Array.isArray(group.removing)
      )
        fail();
      groups.set(group.id, group);
    }
    for (const instance of state.instances) {
      if (
        !instance ||
        !integer(instance.id, 1, state.nextInstanceID - 1) ||
        instances.has(instance.id) ||
        !['active', 'removing', 'removed'].includes(instance.state) ||
        !Number.isFinite(instance.age) ||
        !Number.isFinite(instance.life) ||
        typeof instance.stepTime !== 'boolean' ||
        !integer(instance.sequence, -2147483648, 2147483647) ||
        !integer(instance.number, 0, 2147483647) ||
        !(instance.parent === null || integer(instance.parent, 1, state.nextInstanceID - 1)) ||
        !(instance.matrix instanceof Float32Array) ||
        instance.matrix.length !== 12 ||
        !Array.isArray(instance.childGroups) ||
        !Array.isArray(instance.generated) ||
        !Array.isArray(instance.nextGeneration)
      )
        fail();
      if (instance.slot !== null) {
        if (!integer(instance.slot, 0, this.capacity - 1) || slots.has(instance.slot)) fail();
        slots.add(instance.slot);
      }
      instances.set(instance.id, instance);
    }
    if (slots.size !== this.capacity) fail();
    const insertSets = (list, target) => {
      for (const set of list) {
        if (
          !set ||
          !integer(set.handle, 0, 0x7fffffff) ||
          allSets.has(set.handle) ||
          !flags(set) ||
          !['removing', 'stop', 'stopRoot'].every((key) => typeof set[key] === 'boolean') ||
          !Array.isArray(set.containers) ||
          !set.global ||
          !Number.isFinite(set.global.updatedFrame) ||
          !Array.isArray(set.global.targetLocation) ||
          set.global.targetLocation.length !== 3 ||
          !set.global.targetLocation.every(Number.isFinite)
        )
          fail();
        const asset = this.resources.get(set.assetID),
          effect = asset.effect;
        if (set.root !== effect.root || set.containers.length !== effect.nodes.length) fail();
        references.set(set.assetID, (references.get(set.assetID) ?? 0) + 1);
        let count = 0;
        for (let i = 0; i < set.containers.length; i++) {
          const container = set.containers[i],
            node = effect.nodes[i];
          if (!container || container.nodeID !== node.id || !Array.isArray(container.groups))
            fail();
          for (const groupID of container.groups) {
            const group = groups.get(groupID);
            if (!group || group.nodeID !== node.id || groupOwners.has(groupID)) fail();
            groupOwners.set(groupID, set);
            for (const [ids, active] of [
              [group.active, true],
              [group.removing, false],
            ])
              for (const id of ids) {
                const instance = instances.get(id);
                if (
                  !instance ||
                  memberships.has(id) ||
                  instance.groupID !== groupID ||
                  instance.nodeID !== node.id ||
                  (instance.state === 'active') !== active ||
                  (instance.slot === null) !== (node.type === 'root') ||
                  instance.childGroups.length !== node.children.length ||
                  instance.generated.length !== Math.min(CHILDREN_MAX, node.children.length) ||
                  instance.nextGeneration.length !== instance.generated.length ||
                  !instance.generated.every((n) => integer(n, 0, 2147483647)) ||
                  !instance.nextGeneration.every(Number.isFinite)
                )
                  fail();
                if (active) {
                  if (instance.parent !== null && !instances.has(instance.parent)) fail();
                  for (let c = 0; c < node.children.length; c++) {
                    const child = groups.get(instance.childGroups[c]);
                    if (
                      !child ||
                      child.nodeID !== node.children[c] ||
                      !child.referenced ||
                      child.owner !== id
                    )
                      fail();
                  }
                }
                memberships.add(id);
                count++;
              }
          }
        }
        if (set.global.count !== count) fail();
        allSets.set(set.handle, set);
        target.set(set.handle, set);
      }
    };
    insertSets(state.sets, sets);
    insertSets(state.removing[0], removing[0]);
    insertSets(state.removing[1], removing[1]);
    if (memberships.size !== instances.size || groupOwners.size !== groups.size) fail();
    for (const instance of instances.values())
      if (
        instance.state === 'active' &&
        instance.parent !== null &&
        groupOwners.get(instance.groupID) !==
          groupOwners.get(instances.get(instance.parent).groupID)
      )
        fail();
    for (const group of groups.values())
      if (group.referenced) {
        const owner = instances.get(group.owner);
        if (!owner || owner.state !== 'active' || !owner.childGroups.includes(group.id)) fail();
      }
    for (const [id, count] of references) if (this.resources.get(id).references < count) fail();
    for (const render of state.rendering)
      if (!render || !allSets.has(render.handle) || !flags(render)) fail();
    // World restores the resource owner's aggregate refs first. Adopting these
    // existing refs must not retain, Play, create groups, seed or evaluate again.
    Object.assign(this, {
      sets,
      removing,
      groups,
      instances,
      freeSlots: state.freeSlots,
      nextHandle: state.nextHandle,
      nextInstanceID: state.nextInstanceID,
      nextGroupID: state.nextGroupID,
      sequence: state.sequence,
      rendering: state.rendering,
    });
  }
  close() {
    if (this.closed) return;
    this.stopAll();
    this.executeEvents();
    for (let i = 0; i < 5; i++) this.gc();
    this.rendering.length = 0;
    this.closed = true;
  }
}
