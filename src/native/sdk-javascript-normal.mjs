// SPDX-License-Identifier: MPL-2.0
import { formatNativeAt } from '../kcs.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { compileJavaScript, scriptError } from '../javascript/program.mjs';
import { JavaScriptMachine } from '../javascript/machine.mjs';
import { nativeCategoryFilename, readNativeResource } from './resource-file.mjs';
import { nativeEngineWord } from './engine-message.mjs';
import { canonicalMessage } from './control-task.mjs';
import { SDKJavaScriptImages } from './sdk-javascript-image.mjs';
import { SDKJavaScriptPlanes } from './sdk-javascript-plane.mjs';
import { SDKJavaScriptSounds } from './sdk-javascript-sound.mjs';

const decoder = new TextDecoder('shift_jis', { fatal: true });

export class NormalSDKJavaScriptTask {
  constructor(world, record) {
    Object.assign(this, {
      world,
      record,
      base: world.base(record),
      machine: null,
      link: null,
      child: null,
      closed: false,
      images: new SDKJavaScriptImages(world, record),
      planes: new SDKJavaScriptPlanes(world, record),
      sounds: new SDKJavaScriptSounds(world, record),
    });
    record.exitCode ??= -1;
  }
  get loaded() {
    return !this.closed && Boolean(this.machine?.state.initialized);
  }
  get running() {
    return this.loaded && this.machine.state.exitCode === null;
  }
  message(words, context) {
    return this.base.message(words, context);
  }
  async attach(caller, owner) {
    if (this.link) throw new Error('JavaScript relinking is outside the ordinary execution slice');
    if (this.world.resolveTaskID(owner, caller.id) !== caller.id)
      throw new Error('JavaScript link requires its calling Script owner');
    this.world.runtime.stringBank(caller);
    this.link = {
      script: caller.id,
      strings: caller.context.stringBank,
      variables: caller.context.variableBank || 0,
    };
    const name = Uint8Array.from([...encodeCP932('js base button'), 0]),
      payload = {
        bytes(address, size) {
          if (address < 0 || address + size > name.length)
            throw new RangeError('JavaScript child name packet');
          return name.subarray(address, address + size);
        },
      },
      nativeID = nativeEngineWord(
        await this.world.sendNativeEngine(this.record.nativeID, this.record.id, 1, 6, 0, {
          flags: 0,
          payload,
        }),
        'JavaScript child creation',
      );
    this.child = this.world.resolveTaskID(nativeID, this.record.id);
    if (this.world.objects.objects.get(this.child)?.kind !== 6)
      throw new Error('JavaScript base image-plane child is absent');
    let depth = 1,
      parent = this.world.objects.objects.get(this.record.parent);
    while (parent && (parent.flags ?? parent.kind) !== 1) {
      depth++;
      parent = this.world.objects.objects.get(parent.parent);
    }
    if (!parent) throw new Error('JavaScript input registration requires an owned Top');
    const [width, height] = this.world.graphics.view.virtualSize(),
      words = [0, 0, width, height, depth, nativeID],
      region = new DataView(new ArrayBuffer(24));
    words.forEach((word, index) => region.setUint32(index * 4, word, true));
    await this.world.sendNativeEngine(
      nativeID,
      this.record.id,
      canonicalMessage(this.world.profile, 6, 0x57),
      0,
      0,
      { flags: 1, payload: { load: (address) => region.getUint32(address, true) } },
    );
    await this.world.sendNativeEngine(
      nativeID,
      this.record.id,
      canonicalMessage(this.world.profile, 6, 0x5a),
      0,
      1,
      { flags: 1 },
    );
  }
  host(name, args, location) {
    if (this.closed) throw new Error('JavaScript task owner is closed');
    if (name && typeof name === 'object') {
      if (name.construct === 'CsSound') return this.sounds.host(name, args, location);
      if (name.construct)
        return (name.construct === 'CsPlane' ? this.planes : this.images).host(
          name,
          args,
          location,
        );
      const reference = name.receiver,
        record =
          reference &&
          Object.keys(reference).length === 1 &&
          Number.isSafeInteger(reference.hostObject) &&
          this.world.runtime.handles.records.get(reference.hostObject);
      if (
        !record ||
        record.value.owner !== this.record.id ||
        !['javascript-image', 'javascript-plane', 'javascript-sound'].includes(record.type)
      )
        throw scriptError('Unsupported JavaScript host import', location, 'invalid host reference');
      if (record.type === 'javascript-sound') return this.sounds.host(name, args, location);
      return (record.type === 'javascript-plane' ? this.planes : this.images).host(
        name,
        args,
        location,
      );
    }
    if (name === 'cfLog') {
      if (
        args.length !== 1 ||
        typeof args[0] !== 'string' ||
        args[0].length >= 500 ||
        /[\u0080-\uffff\0%]/.test(args[0]) ||
        typeof this.world.host.nativeDebugOutput !== 'function'
      )
        throw scriptError(
          'Unsupported JavaScript host import',
          location,
          'cfLog requires its explicit debug sink and one bounded ASCII string',
        );
      return { wait: { log: args[0] } };
    }
    if (name === 'cfIsExecMotion') {
      if (args.length === 1) return { value: this.planes.selectedBusy(args[0], location) };
      if (args.length)
        throw scriptError(
          'Unsupported JavaScript host import',
          location,
          'cfIsExecMotion selectors',
        );
      // These are the current Context's supported type1 objects, not Graph kinds.
      // CsImage has no enabled MOT methods; its accepted constructor leaves its
      // manager empty. CsPlane uses its real object-local manager below.
      for (const record of this.world.runtime.handles.records.values()) {
        if (record.value?.owner !== this.record.id) continue;
        if (record.type === 'javascript-plane' && this.planes.busy(record.value))
          return { value: true };
      }
      return { value: false };
    }
    if (
      name !== 'cfExit' ||
      !this.loaded ||
      (args.length && (!Number.isInteger(args[0]) || args[0] < -0x80000000 || args[0] > 0xffffffff))
    )
      throw scriptError(
        'Unsupported JavaScript host import',
        location,
        `${name} arguments or execution phase`,
      );
    this.machine.state.exitCode = args.length ? args[0] | 0 : 0;
    this.record.exitCode = this.machine.state.exitCode;
    return { value: undefined };
  }
  async load(name) {
    if (this.closed) throw new Error('JavaScript task owner is closed');
    if (!this.link) throw new Error('JavaScript load requires a linked Script');
    if (this.machine)
      throw new Error('JavaScript reloading is outside the ordinary execution slice');
    const path = nativeCategoryFilename(this.world.game, name, 'javascript'),
      bytes = path === null ? null : await readNativeResource(this.world, path);
    if (this.closed) throw new Error('JavaScript task owner is closed');
    if (bytes === null) throw new Error(`JavaScript source is absent: ${name}`);
    const machine = new JavaScriptMachine(compileJavaScript(decoder.decode(bytes), name));
    this.machine = machine;
    await this.drain(
      machine,
      machine.run((...args) => this.host(...args)),
    );
  }
  async drain(machine, result) {
    if (this.closed) throw new Error('JavaScript task owner is closed');
    while (result.status === 'waiting') {
      let value;
      if (Object.hasOwn(result.request, 'log')) {
        // Keep the real sink's synchronous call/exception or original Promise.
        // Only its completion is awaited; no function or Promise enters the DTO.
        await this.world.runtime.services.nativeDebugOutput(
          new TextEncoder().encode(result.request.log),
        );
      } else
        value = await (Object.hasOwn(result.request, 'sound')
          ? this.sounds.complete(result.request)
          : Object.hasOwn(result.request, 'plane')
            ? this.planes.complete(result.request)
            : Object.hasOwn(result.request, 'motion')
              ? this.planes.completeMotion(result.request)
              : this.images.complete(result.request));
      if (this.closed) throw new Error('JavaScript image owner is closed');
      machine.resumeHost(value);
      result = machine.run((...args) => this.host(...args));
    }
    if (result.status === 'paused')
      throw new Error('JavaScript callback exceeded its instruction budget');
  }
  async tick(frame) {
    if (!this.running) return;
    const machine = this.machine;
    await this.drain(
      machine,
      machine.call('GameLoop', [frame >>> 0], (...args) => this.host(...args)),
    );
    // Native 50FA7F still runs this object phase after this callback's cfExit.
    if (!this.closed) await this.planes.tick(frame >>> 0);
  }
  snapshot() {
    return {
      link: this.link && { ...this.link },
      child: this.child,
      machine: this.machine?.snapshot() ?? null,
    };
  }
  async restore(state) {
    if (state.link) {
      const script = this.world.runtime.scheduler.tasks.get(state.link.script);
      if (
        !script ||
        script.context.stringBank !== state.link.strings ||
        (script.context.variableBank || 0) !== state.link.variables ||
        this.world.objects.objects.get(state.child)?.kind !== 6
      )
        throw new Error('Invalid JavaScript linked owner checkpoint');
      this.world.runtime.handles.get(state.link.strings, 'string-bank');
      if (state.link.variables)
        this.world.runtime.handles.get(state.link.variables, 'variable-bank');
    } else if (state.child !== null || state.machine !== null)
      throw new Error('JavaScript checkpoint lost its linked owner');
    this.link = state.link && { ...state.link };
    this.child = state.child;
    this.machine = state.machine === null ? null : JavaScriptMachine.restore(state.machine);
    const images = [],
      planes = [],
      sounds = [];
    for (const value of this.machine?.state.cells ?? []) {
      if (value?.hostObject === undefined) continue;
      const record = this.world.runtime.handles.records.get(value.hostObject);
      if (
        !record ||
        record.value.owner !== this.record.id ||
        !['javascript-image', 'javascript-plane', 'javascript-sound'].includes(record.type)
      )
        throw new Error('Invalid JavaScript host reference checkpoint');
      (record.type === 'javascript-image'
        ? images
        : record.type === 'javascript-plane'
          ? planes
          : sounds
      ).push(value);
    }
    this.images.validate(images);
    this.planes.validate(planes);
    this.sounds.validate(sounds);
    await this.planes.restoreMotions();
  }
  async close() {
    this.closed = true;
    const errors = [];
    this.sounds.close();
    try {
      await this.images.close(this.link);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.planes.close();
    } catch (error) {
      errors.push(error);
    }
    this.machine = null;
    this.link = null;
    this.child = null;
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'JavaScript host cleanup failed');
  }
}

export async function normalSDKJavaScriptCommand(world, id, args, machine, caller) {
  const target = world.objects.objects.get(world.resolveTaskID(args[0], caller.id));
  if (target?.kind !== 55 || !(target.implementation instanceof NormalSDKJavaScriptTask))
    throw new Error('JavaScript command target is not an ordinary kind55 owner');
  if (id === 0x3ce) await target.implementation.attach(caller, args[1]);
  else if (id === 0x3cf)
    await target.implementation.load(decoder.decode(formatNativeAt(args[1], machine)));
  else throw new Error(`Ordinary JavaScript command ${id} has not been implemented`);
  return nativeReply(2);
}
