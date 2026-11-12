// SPDX-License-Identifier: MPL-2.0
// One FES collection owns semantic objects, motion and requested resources.
import {
  FESImageControlCommands,
  FES_IMAGE_CONTROL_COMMANDS,
} from './fes-image-control-commands.mjs';
import { NativeFESSoundTable } from './fes-sound-table.mjs';
import { NativeFESData } from './fes-data.mjs';
import { installJSControlTasks } from './control-task-js.mjs';
import { installNativeAreaEffects } from './area-effect.mjs';
import { installNativeScreenEffects } from './screen-effect.mjs';
import { FESObjectCollection } from './fes-object-collection.mjs';
import { FESResourceEntries } from './fes-resource-entries.mjs';
import { createFESTypedObject } from './fes-object-factory.mjs';
import { FESDefinitionModel } from './fes-definitions.mjs';
import { FESMotionDriver, createFESMotionTarget } from './fes-motion-driver.mjs';
import { FESCommonCommands, FES_COMMON_COMMANDS } from './fes-common-commands.mjs';
import { FESResourceCommands, FES_RESOURCE_COMMANDS } from './fes-resource-commands.mjs';
import { initializeFESImage, setFESImageFile } from './fes-image-driver.mjs';
import { FESPanelImages } from './fes-panel-driver.mjs';
import { initializeFESPanelTail, setFESPanelFile } from './fes-panel-model.mjs';
import { initializeFESDifTail, setFESDifImageFile } from './fes-dif-image.mjs';
import { FESPlaneDriver } from './fes-plane-driver.mjs';
import { FESControlDriver } from './fes-control-driver.mjs';
import { FESStringDriver, initializeFESString, FES_TEXT_VERBS } from './fes-string-driver.mjs';
import { fesConfigurationFontBytes } from './fes-text-layout.mjs';
import { FESLogDriver, initializeFESLogObject, FES_LOG_VERBS } from './fes-log-driver.mjs';
import {
  FESParticleDriver,
  configureFESParticle,
  setFESParticleRegisters,
} from './fes-particle-driver.mjs';
import { FESWorldEffects } from './fes-effect-driver.mjs';
import { motionDefinition } from '../motion/definitions.mjs';
import { FES_BUILTIN_VERBS } from '../fes/object.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../fes/types.mjs';
import { initializeFESM2, FES_M2_VERBS } from './emote-fes.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { fesNarrowText } from '../fes/tokens.mjs';
import { fesRawTail } from '../fes/source.mjs';
import { nativeABI } from './abi/index.mjs';
import { replaceFESToneTable, clearFESToneTable } from './fes-tone-table.mjs';
import { readNativeResource } from './resource-file.mjs';

const effectTypes = new Set([7, 8, 26, 27, 30, 31, 32]);
const screenVerbs = new Set(['rdraw', 'rwipe', 'wbreak', 'rwmos', 'rfmos']);
const imageEntryTypes = new Set([1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22]);
const soundTypes = new Set([9, 10]);
const textTypes = new Set([21, 29, 37]);
const textSelectionCommands = new Set([
  'clear',
  'apendmark',
  'skip',
  'reset',
  'isdraw',
  'isdrawmark',
  'insert',
  'linecnt',
  'endpos',
]);
const clone = (state) => structuredClone(state);
const decoder = new TextDecoder('shift_jis');

export class FESCoordinator {
  constructor(world, instance, cache) {
    Object.assign(this, {
      world,
      instance,
      cache,
      top: null,
      pendingRecords: [],
      configurationDirty: false,
    });
    this.targets = new Map();
    this.ownedTaskIDs = new Set();
    this.collection = new FESObjectCollection({
      create: (identity) => this.construct(identity),
      close: (object) => this.closeObject(object),
      serialize: (object) => this.serializeObject(object),
    });
    const ordinaryLookup = this.collection.lookup.bind(this.collection);
    this.collection.lookup = (name, index = 0) => {
      const text = typeof name === 'string' ? name : decoder.decode(name);
      if (text === '_TOPOBJ_' && index === 0) return this.topObject();
      return ordinaryLookup(name, index);
    };
    Object.assign(instance, {
      collection: this.collection,
      objects: this.collection.objects,
      byKey: this.collection.byKey,
      runtimeID: instance.player.nativeOwner,
    });
    const cacheFor = () => cache;
    this.images = world.imagesFES;
    this.planes = world.planesFES;
    this.controls = world.controlsFES;
    this.particles = world.particlesFES;
    this.strings = world.text.fes;
    this.logs = world.text.log;
    this.effects = new FESWorldEffects(world, instance, {
      cacheFor,
      createObject: ({ type, name, parent }) =>
        this.collection.create(type, name, 1, {
          parent: this.collection.graph.get(parent),
        })[0],
      addDummyMotion: (object, spec) =>
        this.motions.add(object, spec.name, { registers: spec.registers }),
      queueWipeRecord: (_object, words) =>
        this.pendingRecords.push({ operation: 'draw-upload', value: words[1] | 0 }),
      clearMotion: (object) => this.targetFor(object, false)?.clear(),
      motionBusy: (object) => this.motions.busy(object),
      deleteObject: (object) => this.collection.remove(object),
      notify: (name) => instance.player.notify(name),
      maskOutputs: (value) => this.maskOutputs(value),
    });
    this.bindMotionGraph();
    this.definitions = new FESDefinitionModel(instance, {
      collection: this.collection,
      expandToken: (value) => instance.argumentBytes(value),
      expandName: (value) => instance.player.host.nativeFESStringBytes?.(value) ?? value,
      report: (message) => instance.diagnostic(message),
      setImageFile: (object, name, bytes) => this.setImageFile(object, name, bytes),
      loadImageTable: (s, o, file) => this.images.loadTable(s, o, file),
      applySpecial: (object, record, index) => this.applySpecial(object, record, index),
    });
    this.common = new FESCommonCommands(instance, {
      collection: this.collection,
      motions: this.motions,
      writeGlobal: (index, value) => instance.setGlobal(index, value),
      reference: (token) => this.reference(token),
      logModel: (object) => this.logs.model(instance, object),
      bitmap: (object) => {
        const handle = this.images.currentBitmap(object);
        return handle ? world.graphics.images.get(handle) : null;
      },
      table: (object) => this.images.table(object),
      soundAlpha: (object, value) => world.fesSound.state(instance, object).setVolume(value),
      stopExtra: (object) => this.stopExtra(object),
    });
    this.imageCommands = new FESImageControlCommands(instance, {
      collection: this.collection,
      reference: (token) => this.reference(token),
      writeGlobal: (index, value) => instance.setGlobal(index, value),
      writeString: (index, bytes) => this.writeString(index, bytes),
      motions: this.motions,
      images: this.images,
      loadToneTable: (object, filename) =>
        replaceFESToneTable(object, filename, (bytes, mode) =>
          readNativeResource(world, decoder.decode(bytes), mode),
        ),
      strings: this.strings,
      logModel: (object) => this.logs.model(instance, object),
      soundSetID: (object, id) =>
        new NativeFESSoundTable(world.fesSound.state(instance, object)).selectPosition(id),
      soundGetID: (object) =>
        new NativeFESSoundTable(world.fesSound.state(instance, object)).getID(),
      m2Tone: (object, rgb) => {
        const state = world.m2FES.state(instance, object);
        state.tone = rgb.slice();
      },
      expandString: (text) =>
        decoder.decode(
          instance.player.host.nativeFESStringBytes?.(encodeCP932(text)) ?? encodeCP932(text),
        ),
    });
    this.resourceCommands = new FESResourceCommands(instance, {
      collection: this.collection,
      images: this.images,
      setImageFile: (object, name) => this.setImageFile(object, name),
      loadSound: (object, file, crossfade, frames) =>
        world.fesSound.state(instance, object).load(file, crossfade, frames),
      soundLoadParameters: nativeABI(world.profile).sound.fesLoadParameters,
      loadM2: (object, file) => world.m2FES.setFile(object, file),
      bitmap: (object) => {
        const handle =
          object.nativeType === 25
            ? object.imageResource?.source &&
              world.renderSources.get(object.imageResource.source).bitmap
            : this.images.currentBitmap(object);
        return handle ? world.graphics.images.get(handle) : null;
      },
      stringID: (object, id) => this.strings.stringID(instance, object, id),
      logStringID: (object, row, id) => this.logs.stringID(instance, object, row, id),
      redraw: (object) => {
        this.strings.state(object).redraw = true;
      },
    });
    this.resources = new FESResourceEntries({
      resolve: (name, index) => this.collection.lookup(name, index),
      allocate: (entry, object) => this.allocateEntry(entry, object),
      visit: (entry, object) => this.visitEntry(entry, object),
      cleanup: (entry) => this.cleanupEntry(entry),
      validate: (entry, object) => this.validateEntry(entry, object),
    });
  }
  bindMotionGraph() {
    this.motions = new FESMotionDriver(this.collection.graph, (object, create) =>
      this.targetFor(object, create),
    );
    if (this.common) this.common.motions = this.motions;
    if (this.imageCommands) this.imageCommands.motions = this.motions;
  }
  construct(identity) {
    const object = createFESTypedObject(identity, {
      initializeImage: initializeFESImage,
      initializeSpecial: (object) => {
        const type = object.nativeType;
        if (type === 11 || type === 12) initializeFESPanelTail(object);
        else if (type === 25) initializeFESDifTail(object);
        else if (textTypes.has(type)) initializeFESString(object, this.world);
        else if (soundTypes.has(type)) this.world.fesSound.state(this.instance, object);
        else if (type === 33) {
          initializeFESM2(object);
        } else return false;
        return true;
      },
    });
    if (object.nativeType === 24 || object.nativeType === 38)
      initializeFESLogObject(object, this.world);
    return object;
  }
  async initialize() {
    const { program } = this.instance;
    for (const declaration of program.definitions) {
      const name = this.instance.soundArgument(declaration.name);
      this.collection.create(declaration.type, name, declaration.count ?? 1, {
        scalar: declaration.count === null,
      });
      if (declaration.type === 'BUTTON') this.instance.keyNames.add(name);
    }
    for (const table of program.tables) {
      const compiled = this.definitions.compile(table.columns);
      for (const row of table.rows)
        await this.definitions.rowCompiled(compiled, row.target, row.values);
    }
  }
  createObjects(typeIndex, name, count) {
    const type = FES_OBJECT_DEFINITION_ORDER[typeIndex];
    if (!type) throw new Error('Unknown FES object factory index ' + typeIndex);
    return this.collection.create(type, name, count);
  }
  topObject() {
    if (!this.top) {
      const graph = this.collection.graph;
      this.top = this.construct({
        type: 'BASE',
        nativeType: 0,
        baseName: '_TOPOBJ_',
        index: 0,
        key: '_TOPOBJ_',
      });
      this.top.handle = graph.allocateHandle();
      graph.register(this.top);
    }
    return this.top;
  }
  reference(token) {
    if (token === '@' && this.instance.eventObject) {
      const object = this.instance.eventObject;
      return {
        name: object.baseName,
        nameBytes: encodeCP932(object.baseName),
        index: object.index ?? 0,
      };
    }
    return this.definitions.reference(this.instance.argumentBytes(token));
  }
  elements(token) {
    const ref = this.reference(token),
      result = [];
    for (const object of this.collection.selection(ref.nameBytes, ref.index))
      if (object) result.push(object);
    return result;
  }
  targetFor(object, create) {
    let target = this.targets.get(object.handle);
    if (!target && create) {
      target = soundTypes.has(object.nativeType)
        ? this.world.fesSound.target(this.instance, object)
        : createFESMotionTarget(this.world.motionLibrary, this.instance, object);
      this.targets.set(object.handle, target);
      Object.defineProperty(object, 'motionTarget', { value: target, configurable: true });
    }
    return target;
  }
  setImageFile(object, name, bytes) {
    if (object.nativeType === 11 || object.nativeType === 12) setFESPanelFile(object, name);
    else if (object.nativeType === 25) setFESDifImageFile(object, name);
    else setFESImageFile(object, name, bytes);
  }
  async applySpecial(object, record, index) {
    const type = object.nativeType,
      fields = record.fields;
    if (this.strings.supports(object))
      return this.strings.applyDefinition(this.instance, object, record);
    if (this.logs.supports(object)) return this.logs.applyDefinition(this.instance, object, record);
    if (soundTypes.has(type)) {
      const state = this.world.fesSound.state(this.instance, object);
      if (fields.has('FILE')) state.load(fields.get('FILE'));
      if (fields.has('STYPE')) state.set('systemVoice', fields.get('STYPE'), true);
      if (fields.has('CHANNEL')) state.setBank(fields.get('CHANNEL'));
      if (fields.has('BLEND')) state.set('bypassVolume', fields.get('BLEND'));
      if (fields.has('GROUP')) state.setGroup(fields.get('GROUP'));
      if (type === 10 && fields.has('SIZE')) {
        object.soundCapacity = fields.get('SIZE')[0];
        this.world.fesSound.initialize(this.instance, object, ['SIZE']);
      }
      return true;
    }
    if (type === 34) {
      if (fields.has('FILE'))
        await this.world.dataFES.loadStringTable(this.instance, object, fields.get('FILE'));
      return true;
    }
    if (type === 33) return this.world.m2FES.applyDefinition(this.instance, object, record, index);
    return false;
  }
  writeString(index, bytes) {
    const record = this.world.objects.objects.get(this.instance.runtimeID),
      handle = record?.context.stringBank;
    if (!handle) throw new Error('FES string output requires its owning string bank');
    this.world.runtime.handles.get(handle, 'string-bank').setBytes(index, bytes);
  }
  beforeStep() {
    for (const entry of this.resources.entries) {
      const object = this.collection.lookup(entry.nameBytes, entry.index);
      if (object?.nativeType === 4) object.beforeCount = object.currentCount;
    }
    const record = this.world.objects.objects.get(this.instance.runtimeID),
      frame = ((record.effectiveFrame ?? 0) - (record.pausedFrames ?? 0)) >>> 0;
    for (const root of this.collection.graph.children()) this.motions.update(root, frame);
  }
  queueBaseImage(object) {
    if (object?.nativeType === 4)
      this.pendingRecords.push({ operation: 'base-plane', handle: object.handle });
    else if (!object || [1, 2, 6, 11, 12, 22].includes(object.nativeType))
      this.pendingRecords.push({
        operation: 'base-image',
        bitmap: object ? this.images.currentBitmap(object) : 0,
      });
  }
  async flushRecords() {
    while (this.pendingRecords.length) {
      const record = this.pendingRecords.shift();
      if (record.operation === 'draw-upload')
        await this.world.sendEngine(
          this.instance.player.surface,
          this.instance.runtimeID,
          286,
          0,
          record.value,
        );
      else if (record.operation === 'base-plane') {
        const object = this.collection.graph.get(record.handle);
        if (!object || object.nativeType !== 4)
          throw new Error('FES baseimg pending PLANE has no live semantic object');
        await this.world.graphics.baseImage(this.instance, object);
      } else if (record.operation === 'base-image') {
        const draw = this.world.graphics.drawTasks.get(this.instance.player.surface);
        if (!draw?.state.renderer)
          throw new Error('FES baseimg requires its initialized Draw surface');
        await draw.setBaseImage(record.bitmap);
      } else throw new Error('Unknown FES scheduling operation');
    }
  }
  async initializeResources() {
    await this.resources.appendPending(this.collection);
  }
  async sync({ restoring = false, resourcesOnly = false } = {}) {
    if (restoring) {
      for (const entry of this.resources.entries)
        this.validateEntry(entry, this.collection.lookup(entry.nameBytes, entry.index));
      for (const object of this.instance.objects) {
        if (this.controls.supports(object))
          await this.controls.update(this.instance, object, { restoring: true });
        if (this.strings.supports(object))
          await this.strings.update(this.instance, object, { restoring: true });
        if (this.logs.supports(object))
          await this.logs.update(this.instance, object, { restoring: true });
        if (this.particles.supports(object))
          await this.particles.update(this.instance, object, { restoring: true });
      }
      return;
    }
    if (resourcesOnly) return this.resources.traverse();
    await this.flushRecords();
    for (const entry of this.resources.entries) {
      const object = this.collection.lookup(entry.nameBytes, entry.index);
      if (!object || !this.images.supports(object) || !(object.displayDelta | 0)) continue;
      const plane = this.images.find(this.instance, object.planeReference);
      if (!plane) continue;
      if (plane.nativeType !== 4) throw new Error('FES display counter target has no PLANE fields');
      plane.currentCount = (plane.currentCount + (object.displayDelta > 0 ? 1 : -1)) | 0;
      object.displayDelta = 0;
    }
    await this.resources.appendPending(this.collection);
    await this.resources.traverse();
    this.configurationDirty = false;
  }
  async allocateEntry(entry, object) {
    const type = object.nativeType;
    if (imageEntryTypes.has(type)) {
      await this.images.allocateEntry(this.instance, object, entry);
      if (type === 6) {
        object.nativeInputTaskID = entry.buttonTaskID = await this.world.objects.create({
          kind: 6,
          parent: this.instance.runtimeID,
          creator: this.instance.runtimeID,
          name: 'FE Button',
        });
        this.instance.player.nativeInput.registerObject(object, entry.buttonTaskID);
      }
    } else if (this.controls.supports(object) || this.strings.supports(object)) {
      object.nativeTaskID = null;
      await (this.controls.supports(object) ? this.controls : this.strings).initialize(
        this.instance,
        object,
      );
      entry.cleanupTaskID = object.nativeTaskID;
    } else if (type === 23) {
      await this.particles.allocateEntry(this.instance, object, entry);
    } else if (effectTypes.has(type)) {
      const effect = this.effects.initialize(object);
      Object.assign(effect, {
        phase: 'unallocated',
        taskId: 0,
        taskKind: 0,
        ownedBitmaps: [],
        borrowedBitmap: 0,
        drawTaskId: 0,
      });
      await this.effects.model.allocate(effect);
      entry.effectTaskID = effect.taskId;
      entry.effectOwnedBitmaps = effect.ownedBitmaps.slice();
    } else if (![3, 4, 9, 10, 24, 25, 29, 33, 37, 38].includes(type))
      throw new Error('Unimplemented FES resource allocator raw' + type);
    for (const id of [
      entry.cleanupTaskID,
      entry.buttonTaskID,
      entry.particle?.taskID,
      entry.effectTaskID,
    ])
      if (id != null) this.ownedTaskIDs.add(id);
  }
  async visitEntry(entry, object) {
    const { instance, world } = this,
      type = object.nativeType,
      options = { configurationDirty: world.configurationDirty || this.configurationDirty };
    if (imageEntryTypes.has(type)) await this.images.visitEntry(instance, object, entry, options);
    else if (type === 25) {
      await this.images.update(instance, object, options);
      entry.lastOwnerSource = object.imageResource?.source ?? 0;
    } else if (type === 3 || type === 4) {
      await this.planes.update(instance, object, {
        ...options,
        previousTaskID: entry.previousTaskID ?? null,
      });
      entry.previousTaskID = object.nativeTaskID;
      if (object.nativeTaskID != null) this.ownedTaskIDs.add(object.nativeTaskID);
    } else if (type === 33) {
      await world.m2FES.update(instance, object, {
        ...options,
        previousTaskID: entry.previousTaskID ?? null,
      });
      entry.previousTaskID = object.nativeTaskID;
      if (object.nativeTaskID != null) this.ownedTaskIDs.add(object.nativeTaskID);
    } else if (soundTypes.has(type)) {
      const state = await world.fesSound.update(instance, object, {
        ...options,
        advanceMotion: false,
      });
      entry.soundOwned = state.get('playOption');
      entry.soundIndex = state.get('bank');
    } else if (this.controls.supports(object))
      await this.controls.update(instance, object, options);
    else if (this.strings.supports(object)) await this.strings.update(instance, object, options);
    else if (this.logs.supports(object)) await this.logs.update(instance, object, options);
    else if (this.particles.supports(object))
      await this.particles.update(instance, object, options);
    else if (effectTypes.has(type)) await this.effects.update(object, options);
    else if (![0, 34, 35].includes(type))
      throw new Error('Unimplemented FES resource driver raw' + type);
  }
  async requestDestroy(id) {
    if (id != null && this.world.objects.objects.has(id))
      await this.world.objects.destroy(id, this.instance.runtimeID);
  }
  async cleanupEntry(entry) {
    const type = entry.savedType;
    if (imageEntryTypes.has(type)) await this.images.cleanupEntry(this.instance, entry);
    else if ([3, 4, 33, 36].includes(type)) await this.requestDestroy(entry.previousTaskID);
    else if ([13, 14, 15, 21, 29, 37].includes(type))
      await this.requestDestroy(entry.cleanupTaskID);
    else if ([7, 8, 26, 27, 30].includes(type)) {
      await this.requestDestroy(entry.effectTaskID);
      for (const bitmap of entry.effectOwnedBitmaps ?? [])
        await this.world.graphics.images.release(bitmap);
    } else if (soundTypes.has(type) && entry.soundOwned && entry.soundIndex !== -1)
      await this.world.fesSound.send(this.instance, 181, entry.soundIndex);
    else if (type === 23) this.particles.cleanupEntry(entry);
    else if (type === 25 && entry.lastOwnerSource)
      await this.removeDifOutput(entry.lastOwnerSource);
    // Explicit zeroed raw23 guard and missing mosaic/LOG cleanup branches.
  }
  validateEntry(entry, object) {
    if (entry.savedType === 23) this.particles.validateEntry(this.instance, object, entry);
    if (imageEntryTypes.has(entry.savedType))
      this.images.validateEntry(this.instance, object, entry);
    for (const id of [
      entry.previousTaskID,
      entry.cleanupTaskID,
      entry.effectTaskID,
      entry.particleTaskID,
      entry.buttonTaskID,
    ])
      if (id != null) {
        const record = this.world.objects.objects.get(id);
        if (!record || record.parent !== this.instance.runtimeID)
          throw new Error('FES resource checkpoint child has no owning World task');
      }
    for (const bitmap of entry.effectOwnedBitmaps ?? []) this.world.graphics.images.get(bitmap);
  }
  async removeDifOutput(source) {
    const draw = this.world.graphics.drawTasks.get(this.instance.player.surface);
    if (!draw?.state.renderer) return;
    for (const item of [...draw.state.renderer.items].sort((a, b) => a.key - b.key))
      if (this.world.retainedDraw.record(draw, item.key)?.source === source) {
        await draw.remove(item.key);
        break;
      }
  }
  async stopExtra(object) {
    if (soundTypes.has(object.nativeType)) this.world.fesSound.state(this.instance, object).play(0);
    else if (object.nativeType === 23) this.particles.stop(object);
    else throw new Error('FES stop has no JS task service for raw' + object.nativeType);
  }
  context(args, context) {
    const { instance } = this;
    return {
      ...context,
      argument: (i) => instance.value(instance.soundArgument(args[i])) | 0,
      text: (i) => instance.soundArgument(args[i]),
      bytes: (i) => instance.argumentBytes(args[i]),
      evaluate: (token) => instance.value(instance.soundArgument(token)),
      evaluateExpanded: (token) => instance.value(token),
    };
  }
  async screenCommand(verb, args) {
    if (!screenVerbs.has(verb)) throw new Error('Unknown FES screen command ' + verb);
    const ctx = this.context(args, {});
    await this.effects.screenCommand(verb, args, {
      top: this.topObject().handle,
      evaluate: ctx.evaluate,
      text: (token) => this.instance.soundArgument(token),
    });
    return 0;
  }
  async command(verb, selection, args, source = {}) {
    const { instance, collection, world } = this,
      context = this.context(args, {
        ...source,
        index: selection.index,
        referenceAddress: source.objectNameAddress,
      });
    if (FES_COMMON_COMMANDS.has(verb)) return this.common.command(verb, selection, args, context);
    if (FES_IMAGE_CONTROL_COMMANDS.has(verb))
      return this.imageCommands.command(verb, selection, args, context);
    if (FES_RESOURCE_COMMANDS.has(verb))
      return this.resourceCommands.command(verb, selection, args, context);
    const count =
        selection.index === -1 ? collection.count(selection.nameBytes) : selection.index + 1,
      first = selection.index === -1 ? 0 : selection.index,
      lookup = (index) => collection.lookup(selection.nameBytes, index);
    if (verb === 'layout' && args.length) {
      const mode = context.text(0);
      context.layoutMode = mode;
      if (['font', 'fontind', 'fontind_sub'].includes(mode)) {
        if (!nativeABI(world.profile).text.layoutModes.includes(mode)) return 0;
        if (!(source.commandBytes instanceof Uint8Array))
          throw new TypeError('FES layout font requires its exact executing command bytes');
        const indexed = mode !== 'font',
          tail = fesRawTail(source.commandBytes, indexed ? 4 : 3),
          index = indexed && args[1] !== undefined ? context.argument(1) : 0,
          bytes = tail.length
            ? new Uint8Array(tail)
            : fesConfigurationFontBytes(world.profile, world.configuration),
          parameters = indexed ? [index, bytes] : [bytes];
        for (let at = first; at < count; at++) {
          const object = lookup(at);
          if (!object) continue;
          if (mode !== 'fontind_sub' && this.strings.supports(object))
            this.strings.setFont(object, bytes, index);
          else if (this.logs.supports(object))
            await this.logs.model(instance, object).layout(mode, parameters, Number);
        }
        return 0;
      }
      if (mode === 'prof' || mode === 'd_prof') {
        if (!(source.commandBytes instanceof Uint8Array))
          throw new TypeError('FES layout profile requires its exact executing command bytes');
        const tail = fesRawTail(source.commandBytes, 4);
        const index = args[1] === undefined ? 0 : context.argument(1),
          bytes = tail.length ? new Uint8Array(tail) : undefined;
        for (let at = first; at < count; at++) {
          const object = lookup(at);
          if (!object) continue;
          if (object.nativeType === 21 || object.nativeType === 37)
            this.strings.setProfile(object, mode, index, bytes);
          else if (mode === 'prof' && this.logs.supports(object))
            await this.logs
              .model(instance, object)
              .layout(mode, bytes === undefined ? [index] : [index, bytes], Number);
        }
        return 0;
      }
    }
    if (verb === 'getdiv') {
      let division = 0;
      for (let at = first; at < count; at++) {
        const object = lookup(at);
        if (object?.nativeType === 29) division = this.strings.state(object).division;
      }
      instance.setLocal(0, division);
      return 0;
    }
    if (textSelectionCommands.has(verb)) {
      let parameters = args;
      if (verb === 'linecnt') {
        if (!args.length) return 0;
        parameters = [context.argument(0)];
      } else if (verb === 'endpos')
        parameters = [0, 1].map((at) =>
          args[at] === undefined ? undefined : context.argument(at),
        );
      for (let at = first; at < count; at++) {
        const object = lookup(at);
        if (!object) {
          if (verb === 'insert' || verb === 'linecnt') break;
          continue;
        }
        const type = object.nativeType;
        if (
          verb === 'insert'
            ? type === 29
            : verb === 'linecnt'
              ? type === 21 || type === 37
              : textTypes.has(type)
        )
          await this.strings.command(instance, object, verb, parameters, context);
        else if (verb === 'reset' && this.logs.supports(object))
          await this.logs.command(instance, object, verb, parameters, context);
      }
      return 0;
    }
    if (verb === 'str' || verb === 'apend' || verb === 'name') {
      const hasTail = source.rawTail === undefined ? args.length > 0 : source.rawTail.length > 0;
      if (verb === 'apend' && !hasTail) return 0;
      const inputBytes = hasTail
        ? this.strings.input(instance, null, args, context)
        : new Uint8Array();
      for (let at = first; at < count; at++) {
        const object = lookup(at);
        if (
          !object ||
          !this.strings.supports(object) ||
          (verb === 'name' && object.nativeType !== 29)
        )
          continue;
        await this.strings.command(instance, object, verb, args, { ...context, inputBytes });
      }
      return 0;
    }
    if (verb === 'wipe' || (verb === 'draw' && lookup(first)?.nativeType === 4)) {
      await this.effects.areaCommand(verb, lookup(first), args, {
        referenceIndex: selection.index,
        evaluate: context.evaluate,
        text: (token) => instance.soundArgument(token),
      });
      return 0;
    }
    if (!FES_BUILTIN_VERBS.has(verb)) {
      const raw = instance.program.subcommands[verb];
      if (!raw) throw new Error('Unimplemented FES object command ' + verb);
      const definition = motionDefinition(verb, { ...raw, words: raw.words.map(fesNarrowText) });
      for (let at = first; at < count; at++) {
        const object = lookup(at);
        if (!object) break;
        await this.motions.subcommand(
          object,
          definition,
          args.map(fesNarrowText),
          (token, current) => instance.value(instance.soundArgument(token), current),
        );
      }
      return 0;
    }
    if (verb === 'userfontobj' && args.length) context.reference = this.reference(args[0]);
    for (let at = first; at < count; at++) {
      const object = lookup(at);
      if (!object) break;
      const type = object.nativeType;
      if (this.logs.supports(object) && FES_LOG_VERBS.has(verb)) {
        await this.logs.command(instance, object, verb, args, context);
      } else if (this.logs.supports(object) && verb === 'draw')
        await this.logs.model(instance, object).display(1);
      else if (this.strings.supports(object) && FES_TEXT_VERBS.has(verb)) {
        await this.strings.command(instance, object, verb, args, context);
      } else if (soundTypes.has(type)) {
        const result = await world.fesSound.command(instance, object, verb, args, context);
        if (typeof result === 'number' && result !== 0) return result;
      } else if (type === 33 && FES_M2_VERBS.has(verb))
        await world.m2FES.command(instance, object, verb, args, context);
      else if (type === 34 || type === 35) {
        await world.dataFES.command(instance, object, verb, args, context);
      } else if (type === 23 && ['init', 'param', 'start', 'attach'].includes(verb)) {
        if (verb === 'init') {
          if (args.length < 5)
            throw new Error('FES PARTICLE init requires all authored parameters');
          const family = context.argument(0),
            program = context.text(1),
            texture = context.text(2),
            count = context.argument(3),
            priority = context.argument(4);
          if (encodeCP932(program).length >= 64 || encodeCP932(texture).length >= 64)
            throw new RangeError('FES PARTICLE names exceed their defined slots');
          configureFESParticle(object, { family, program, texture, count, priority });
        } else if (verb === 'param')
          setFESParticleRegisters(
            object,
            args.slice(0, 32).map((_v, i) => context.argument(i)),
          );
        else if (verb === 'start') this.particles.start(object);
        else {
          if (!args.length)
            throw new Error('FES PARTICLE attach has no defined missing-target state');
          const ref = this.reference(args[0]);
          this.particles.attach(instance, object, collection.lookup(ref.nameBytes, ref.index));
        }
      } else throw new Error('Unimplemented FES raw' + type + ' command ' + verb);
    }
    return 0;
  }
  async maskOutputs(sleeping) {
    const { instance, world } = this;
    instance.player.nativeInput.state.sleeping = !!sleeping;
    for (const object of instance.objects) {
      if (this.images.supports(object) && object.imageResource?.binding) {
        const binding = object.imageResource.binding;
        await world.sendEngine(
          binding.surface,
          instance.runtimeID,
          287,
          object.renderID,
          Number(object.disp && !sleeping),
        );
      } else if (this.controls.supports(object)) await this.controls.update(instance, object);
      else if ([3, 4, 21, 29, 33, 37].includes(object.nativeType) && object.nativeTaskID != null)
        await world.sendEngine(
          object.nativeTaskID,
          instance.runtimeID,
          47,
          0,
          Number(object.disp && !sleeping),
        );
      if (object.nativeType === 6 && object.nativeInputTaskID != null)
        await world.sendEngine(
          object.nativeInputTaskID,
          instance.runtimeID,
          92,
          0,
          Number(object.enable && !sleeping),
        );
    }
    await instance.player.nativeInput.sync();
  }
  async setSleeping(value) {
    const sleeping = Boolean(value),
      { instance } = this;
    if (instance.player.nativeInput.state.sleeping === sleeping) return;
    await instance.player.notify(sleeping ? '_FES_SLEEP_' : '_FES_WAKE_');
    await this.resources.traverse();
    if (sleeping)
      for (const effect of this.effects.model.entries.values())
        if ([7, 8].includes(effect.type) && effect.taskId)
          await this.effects.send(effect.taskId, 258);
    await this.maskOutputs(sleeping);
    if (!sleeping && this.world.graphics.drawTasks.get(instance.player.surface)?.state.renderer)
      await this.world.sendEngine(instance.player.surface, instance.runtimeID, 292);
  }
  async closeObject(object) {
    if (object.nativeType === 16 || object.nativeType === 17) clearFESToneTable(object);
    this.targetFor(object, false)?.clear();
    this.targets.delete(object.handle);
    if (this.images.supports(object)) await this.images.closeObject(object);
    if (this.logs.supports(object)) this.logs.close(object);
    if (effectTypes.has(object.nativeType)) {
      this.effects.model.entries.delete(object.handle);
      this.effects.model.packets.delete(object.handle);
    }
  }
  serializeObject(object) {
    const result = clone({ ...object });
    if (imageEntryTypes.has(object.nativeType)) delete result.imageResource;
    if (object.nativeType === 23) delete result.particleResource;
    if (soundTypes.has(object.nativeType))
      result.nativeSoundState.motion = this.targetFor(object, false)?.snapshot() ?? null;
    return result;
  }
  snapshot() {
    return {
      collection: this.collection.snapshot(),
      resources: this.resources.snapshot(),
      top: this.top ? this.serializeObject(this.top) : null,
      effects: this.effects.snapshot(),
      motions: [...this.targets]
        .filter(([handle]) => !soundTypes.has(this.collection.graph.get(handle)?.nativeType))
        .map(([handle, target]) => [handle, target.snapshot()]),
      pendingRecords: clone(this.pendingRecords),
      ownedTaskIDs: [...this.ownedTaskIDs],
      configurationDirty: this.configurationDirty,
    };
  }
  async restore(state) {
    this.top = state.top
      ? Object.assign(
          this.construct({
            type: 'BASE',
            nativeType: 0,
            baseName: '_TOPOBJ_',
            index: 0,
            key: '_TOPOBJ_',
          }),
          clone(state.top),
        )
      : null;
    this.collection.restore(state.collection, { extraObjects: this.top ? [this.top] : [] });
    Object.assign(this.instance, {
      objects: this.collection.objects,
      byKey: this.collection.byKey,
      collection: this.collection,
    });
    this.bindMotionGraph();
    this.effects.restore(state.effects);
    this.pendingRecords = clone(state.pendingRecords);
    this.ownedTaskIDs = new Set(state.ownedTaskIDs);
    this.configurationDirty = state.configurationDirty;
    await this.resources.restore(state.resources);
    for (const object of this.instance.objects)
      if (soundTypes.has(object.nativeType)) {
        await this.world.fesSound.restore(this.instance, object);
        const target = this.world.fesSound.targets.get(object);
        if (target) {
          this.targets.set(object.handle, target);
          Object.defineProperty(object, 'motionTarget', { value: target, configurable: true });
        }
      }
    for (const [handle, saved] of state.motions)
      await this.motions.restore(this.collection.graph.get(handle), saved);
  }
  async close() {
    await this.collection.close();
    await this.resources.close();
    this.effects.model.entries.clear();
    this.effects.model.packets.clear();
    if (this.top) {
      this.targetFor(this.top, false)?.clear();
      this.collection.graph.release(this.top);
      this.top = null;
    }
    this.targets.clear();
    for (const id of this.ownedTaskIDs)
      if (this.world.objects.objects.has(id)) await this.world.objects.release(id);
    this.ownedTaskIDs.clear();
  }
}

export function installFESCoordinator(world) {
  installJSControlTasks(world);
  installNativeAreaEffects(world);
  installNativeScreenEffects(world);
  const cacheFor = (instance) => {
      const cache = world.objects.objects.get(instance.runtimeID)?.implementation?.imageCacheModel;
      if (!cache) throw new Error('FES resource requires its owning task encoded image cache');
      return cache;
    },
    lookup = (instance, ref) => instance.collection.lookup(ref.nameBytes ?? ref.name, ref.index);
  world.imagesFES = new FESPanelImages(world, {
    cacheFor,
    lookup,
    snapshotMotion: (instance, object) => instance.runtime.motions.prepare(object),
  });
  world.planesFES = new FESPlaneDriver(world, { cacheFor });
  world.controlsFES = new FESControlDriver(world, { cacheFor, lookup });
  world.particlesFES = new FESParticleDriver(world);
  world.text.fes = new FESStringDriver(world, {
    cacheFor,
    lookup,
    imageDataFor: (instance, object) => world.imagesFES.dataFor(instance, object),
  });
  world.text.log = new FESLogDriver(world, {
    strings: world.text.fes,
    createChild: async (instance, spec) => {
      const child = instance.collection.create(spec.nativeType, spec.name, 1)[0];
      child.nativeControlledByLog = spec.logObjectHandle;
      return child;
    },
    resolveChild: (instance, handle) => instance.collection.graph.get(handle),
    findChild: (instance, name, index) => instance.collection.lookup(name, index),
    writeString: (instance, index, bytes) => instance.runtime.writeString(index, bytes),
  });
  world.dataFES = new NativeFESData(world);
}
