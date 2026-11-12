// SPDX-License-Identifier: MPL-2.0
// LOG semantic state owns viewport slots; the canonical collection owns STRING children.
import { nativeABI } from './abi/index.mjs';
import { FESLogModel, initializeFESLog } from './fes-log-model.mjs';
import { FESLogTextService } from './fes-log-text-service.mjs';
import { fesDefinitionResourceReference } from './fes-definitions.mjs';

export function initializeFESLogObject(object, { profile }) {
  if (object.nativeType === 38 && !nativeABI(profile).capabilities.utf8Text)
    throw new Error('The registered ABI has no LOGSTRING8 task implementation');
  return initializeFESLog(object);
}
export const FES_LOG_VERBS = new Set(
  'setlog remake pos page next rev max lineinfo pathinfo blockinfo linecolor blockcolor layout reset userfont userfontobj'.split(
    ' ',
  ),
);
export class FESLogDriver {
  constructor(world, { createChild, resolveChild, findChild, strings, writeString } = {}) {
    if (
      typeof createChild !== 'function' ||
      typeof resolveChild !== 'function' ||
      typeof findChild !== 'function' ||
      !strings?.reference
    )
      throw new TypeError(
        'FES LOG requires canonical collection children and typed STRING resources',
      );
    Object.assign(this, { world, createChild, resolveChild, findChild, strings, writeString });
    this.models = new WeakMap();
  }
  supports(object) {
    return object.nativeType === 24 || object.nativeType === 38;
  }
  model(instance, object) {
    if (!this.supports(object)) throw new TypeError('Expected LOGSTRING or LOGSTRING8');
    if (object.nativeType === 38 && !nativeABI(this.world.profile).capabilities.utf8Text)
      throw new Error('The registered ABI has no LOGSTRING8 task implementation');
    let entry = this.models.get(object);
    if (entry) {
      if (entry.instance !== instance) throw new Error('LOG semantic object has a different owner');
      return entry.model;
    }
    const service = new FESLogTextService({
        world: this.world,
        instance,
        createChild: (spec) => this.createChild(instance, spec),
        resolveChild: (handle) => this.resolveChild(instance, handle),
        findChild: (name, index) => this.findChild(instance, name, index),
      }),
      model = new FESLogModel(object, this.world.displayLogs, service);
    this.models.set(object, { model, instance, service });
    return model;
  }
  async applyDefinition(instance, object, record) {
    if (!this.supports(object)) return false;
    const model = this.model(instance, object),
      fields = record.fields,
      has = (key) => fields.has(key),
      get = (key) => fields.get(key);
    if (has('COUNT')) model.setCount(get('COUNT'));
    if (has('VRAM')) {
      const value = get('VRAM');
      model.setVRAM(value[0], value[1] ?? 0);
    }
    if (has('POS2')) {
      const ref = fesDefinitionResourceReference(get('POS2'));
      model.setPositionReference(ref.name, ref.index);
    }
    if (has('SIZE2')) {
      const ref = fesDefinitionResourceReference(get('SIZE2'));
      model.setSizeReference(ref.name, ref.index);
    }
    if (has('PRI')) await model.setPriority(get('PRI'));
    if (has('DISP')) await model.display(get('DISP'));
    return true;
  }
  validate(instance, object) {
    this.model(instance, object);
    if (object.logHandle) this.world.displayLogs.get(object.logHandle);
    for (const slot of object.slots ?? []) {
      for (const handle of [slot.main, slot.secondary]) {
        if (handle === null) continue;
        const child = this.resolveChild(instance, handle);
        if (!child || child.deleted || child.parentHandle != null)
          throw new Error('LOG checkpoint generated STRING is absent or has a PARENT');
        this.strings.state(child);
        if (child.nativeTaskID != null) this.strings.validate(instance, child);
      }
    }
  }
  async update(instance, object, { restoring = false } = {}) {
    if (restoring) return this.validate(instance, object);
    if (object.deleted) return this.close(object);
    const model = this.model(instance, object);
    await model.drive((_kind, name, index) =>
      this.strings.reference(instance, { name, index }, object),
    );
  }
  async command(instance, object, verb, args = [], context = {}) {
    if (!FES_LOG_VERBS.has(verb)) throw new Error(`Unknown LOG command ${verb}`);
    const model = this.model(instance, object),
      evaluated = new Map(),
      p = (i, fallback = 0) => {
        if (args[i] === undefined) return fallback;
        if (!evaluated.has(i))
          evaluated.set(
            i,
            (typeof args[i] === 'number'
              ? args[i]
              : context.argument
                ? context.argument(i)
                : instance.value(args[i])) | 0,
          );
        return evaluated.get(i);
      },
      write = (at, value) => {
        const index = p(at, -1);
        if (index !== -1) instance.setGlobal(index, value);
      };
    switch (verb) {
      case 'setlog':
        model.bind(p(0));
        break;
      case 'remake': {
        const language = (i) =>
          args[i] === undefined ? null : (instance.player.strings[p(i)] ?? null);
        await model.remake(language(0), language(1));
        break;
      }
      case 'pos':
        await model.position(p(0));
        break;
      case 'page':
        await model.page(p(0));
        break;
      case 'next':
      case 'rev':
        if (!Number.isInteger(context.index))
          throw new Error('LOG next/rev requires its parsed reference index');
        await model[verb](p(0, verb === 'next' ? 1 : -1), context.index);
        break;
      case 'max':
        instance.setGlobal(p(0), model.max());
        break;
      case 'lineinfo': {
        if (!args.length) break;
        if (typeof this.writeString !== 'function')
          throw new Error('LOG lineinfo requires its string-bank byte writer');
        const info = model.lineInfo(p(0));
        this.writeString(instance, p(1), info.scene);
        instance.setGlobal(p(2), info.block);
        break;
      }
      case 'pathinfo': {
        if (!args.length) break;
        const info = model.pathInfo(p(0));
        for (let i = 0; i < 2; i++) write(i + 1, info[i]);
        break;
      }
      case 'blockinfo': {
        if (!args.length) break;
        const info = model.blockInfo(p(0));
        for (let i = 0; i < 4; i++) write(i + 1, info[i]);
        break;
      }
      case 'linecolor':
        await model.lineColor(p(0), p(1), p(2), p(3));
        break;
      case 'blockcolor':
        await model.blockColor(p(0), p(1));
        break;
      case 'layout':
        if (args.length)
          return model.layout(args[0], args.slice(1), (value) =>
            typeof value === 'number'
              ? value
              : context.evaluate
                ? context.evaluate(value)
                : instance.value(value),
          );
        break;
      case 'reset':
        await model.reset();
        break;
      case 'userfont':
      case 'userfontobj': {
        if (!args.length || (verb === 'userfont' && args.length < 2)) break;
        let source, char, selector;
        if (verb === 'userfont') {
          char = p(0) & 65535;
          selector = p(1) & 65535;
        } else {
          if (!context.reference || typeof context.reference !== 'object')
            throw new Error('LOG userfontobj requires its once-parsed canonical reference');
          source = this.strings.lookup(instance, context.reference);
          if (source && source.nativeType !== 2)
            throw new Error('FES userfontobj requires an IMAGE source');
        }
        const limit = Math.min(model.max(), object.slots?.length ?? 0);
        for (let at = 0; at < limit; at++) {
          const handle = object.slots[at].main;
          if (handle === null) continue;
          const child = this.resolveChild(instance, handle);
          if (!child || child.deleted) throw new Error('LOG generated STRING is absent');
          if (verb === 'userfont') this.strings.setFontMapping(child, char, selector);
          else this.strings.setFontSource(child, source);
        }
        break;
      }
    }
    return 0;
  }
  close(object) {
    const entry = this.models.get(object);
    if (entry) entry.model.close();
  }
}
