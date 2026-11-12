// SPDX-License-Identifier: MPL-2.0
// Whole-selection command semantics. Arguments are evaluated at their original
// boundaries; collection holes are never compressed into a dense object list.
import {
  fesObjectFamily,
  markFESObjectDirty,
  setFESEnabled,
  setFESGraphicalDisplay,
  setFESGraphicalPriority,
  setFESGraphicalPosition,
  fesGraphicalPosition,
  setFESGraphicalSize,
  fesGraphicalSize,
  fesGraphicalBase,
  setFESImageClip,
  setFESImagePlane,
  setFESImageParentPlane,
  writeFESQuery,
} from './fes-common-model.mjs';
import {
  isFESControl,
  setFESControlDisplay,
  setFESControlPriority,
  setFESControlPlanePriority,
  setFESControlValue,
  fesControlPosition,
} from './fes-control-model.mjs';
import { setFESButtonLock } from './fes-image-model.mjs';
import { buildNativeFESMotion } from './fes-motion.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export const FES_COMMON_COMMANDS = new Set(
  'enable disp pri pos getpos getpos2 size getsize pl refparentpl getbase getoffset clip lock exist copy delete delay ismot stop arc mcarc blend baseopt'.split(
    ' ',
  ),
);
const isLog = (o) => o.nativeType === 24 || o.nativeType === 38,
  isImage = (o) => fesObjectFamily(o) === 'image',
  copyTypes = new Set([2, 6, 11, 12, 22]),
  blendTypes = new Set([9, 10, 14, 15, 23]);

export class FESCommonCommands {
  constructor(instance, services) {
    if (!instance || typeof instance.value !== 'function')
      throw new TypeError('FES common commands require an expression context');
    const { collection, motions, writeGlobal, reference } = services;
    if (
      !collection?.lookup ||
      !collection?.count ||
      !collection?.remove ||
      !motions?.add ||
      !motions?.busy ||
      !motions?.stop ||
      typeof writeGlobal !== 'function' ||
      typeof reference !== 'function'
    )
      throw new TypeError(
        'FES common commands require collection, MOT, bank and reference services',
      );
    Object.assign(this, { instance, ...services });
    this.words = new Int32Array(3);
  }
  log(object) {
    if (typeof this.logModel !== 'function')
      throw new Error('FES LOG command requires its JavaScript viewport service');
    const model = this.logModel(object);
    if (!model) throw new Error(`Missing FES LOG model ${object.key}`);
    return model;
  }
  async alpha(object, value) {
    const family = fesObjectFamily(object);
    if (family === 'image') {
      if (object.alpha !== value >>> 0) {
        object.alpha = value >>> 0;
        markFESObjectDirty(this.instance, object);
      }
    } else if (family === 'plane') {
      object.color = ((value << 24) | (object.color & 0xffffff)) >>> 0;
      object.alpha = object.color >>> 24;
      markFESObjectDirty(this.instance, object);
    } else if (object.nativeType === 9 || object.nativeType === 10) {
      if (typeof this.soundAlpha !== 'function')
        throw new Error('FES sound blend requires its JS sound state owner');
      await this.soundAlpha(object, value);
    } else {
      object.alpha = value >>> 0;
      if (object.nativeType === 23) markFESObjectDirty(this.instance, object);
      else object.alphaPending = true;
    }
  }
  query(verb, object) {
    if (verb === 'getpos') {
      if (isFESControl(object)) return fesControlPosition(object);
      if (isLog(object)) return this.log(object).positionQuery();
      return fesGraphicalPosition(this.instance, object);
    }
    if (verb === 'getpos2') return fesGraphicalPosition(this.instance, object, true);
    if (verb === 'getsize')
      return isFESControl(object) ? fesControlPosition(object) : fesGraphicalSize(object);
    if (verb === 'getbase') return fesGraphicalBase(object);
    if (!isImage(object)) return null;
    if (typeof this.bitmap !== 'function')
      throw new Error('FES getoffset requires its JS bitmap owner');
    const state = this.bitmap(object)?.state;
    this.words[0] = state?.offsetX ?? 0;
    this.words[1] = state?.offsetY ?? 0;
    this.words[2] = 0;
    return this.words;
  }
  async command(verb, { name, index }, args, context = {}) {
    if (!FES_COMMON_COMMANDS.has(verb)) return undefined;
    index |= 0;
    const { collection, instance } = this,
      value = (at, fallback = 0) =>
        args[at] === undefined
          ? fallback
          : (context.argument ? context.argument(at) : instance.value(args[at])) | 0,
      end = index === -1 ? collection.count(name) : index + 1,
      start = index === -1 ? 0 : index,
      lookup = (at) => collection.lookup(name, at);

    if (['getpos', 'getpos2', 'getsize', 'getbase', 'getoffset'].includes(verb)) {
      if (index === -1) return 0;
      const object = lookup(index);
      if (!object) return 0;
      const outputs = [value(0, -1), value(1, -1), value(2, -1)];
      writeFESQuery(this.query(verb, object), outputs, this.writeGlobal);
      return 0;
    }
    if (verb === 'clip') {
      if (index === -1 || !lookup(index)) return 0;
      // Token presence is checked after each earlier token's evaluation.
      const rectangle = [];
      for (let at = 0; at < 4; at++) {
        if (args[at] === undefined) return 0;
        rectangle.push(value(at));
      }
      setFESImageClip(instance, lookup(index), ...rectangle);
      return 0;
    }
    if (verb === 'exist') {
      const object = lookup(index);
      if (!object) throw new Error('FES exist requires a live explicit table element');
      if (object.nativeType !== 16 && object.nativeType !== 17) return 0;
      const row = value(0),
        variant = value(1),
        output = value(2);
      if (typeof this.table !== 'function')
        throw new Error('FES exist requires its JS table owner');
      const table = this.table(object),
        result = Number(!!table && table.select([row, variant]) !== null);
      // Unlike coordinate queries, exist has no -1 output sentinel.
      this.writeGlobal(output, result);
      return 0;
    }
    if (verb === 'ismot') {
      if (args[0] === undefined) return 0;
      const output = value(0);
      let busy = 0;
      for (let at = start; at < end; at++) {
        const object = lookup(at);
        if (!object) return 0; // A hole aborts without writing a partial OR.
        busy |= object.nativeType === 23 ? object.running | 0 : Number(this.motions.busy(object));
      }
      this.writeGlobal(output, busy);
      return 0;
    }
    if (verb === 'delete' || verb === 'stop') {
      for (let at = start; at < end; at++) {
        const object = lookup(at);
        if (!object) {
          if (verb === 'delete') break;
          continue;
        }
        if (verb === 'delete') await collection.remove(object);
        else {
          this.motions.stop(object);
          if ([9, 10, 23, 36].includes(object.nativeType)) {
            if (typeof this.stopExtra !== 'function')
              throw new Error(`FES stop requires raw${object.nativeType} task cleanup`);
            await this.stopExtra(object);
          }
        }
      }
      return 0;
    }

    let numbers, reference, text;
    if (verb === 'pri') {
      if (args[0] === undefined) return 0;
      numbers = [value(0)];
    } else if (verb === 'pos')
      numbers = [0, 1, 2].map((at) => (args[at] === undefined ? undefined : value(at)));
    else if (verb === 'size') numbers = [value(0), value(1)];
    else if (verb === 'pl' || verb === 'copy') {
      if (args[0] === undefined) return 0;
      reference = this.reference(args[0]);
      if (!reference) return 0;
      if (verb === 'copy') {
        if (reference.index === -1) reference = { ...reference, index: 0 };
        numbers = [value(1), value(2), value(3), value(4)];
      }
    } else if (verb === 'baseopt') text = encodeCP932(args[0] ?? '');
    else if (verb === 'arc' || verb === 'mcarc')
      numbers = [value(0, 30), value(1), value(2), value(3), value(4)];
    else numbers = [value(0, verb === 'disp' ? 1 : verb === 'blend' ? 255 : 0)];

    let skipLogHoles = false,
      color = context.commandPointer;
    for (let at = start; at < end; at++) {
      const object = lookup(at);
      if (!object) {
        if (['size', 'pl', 'delay', 'arc', 'mcarc'].includes(verb)) break;
        if ((verb === 'disp' || verb === 'pri') && !skipLogHoles) break;
        continue;
      }
      switch (verb) {
        case 'enable':
          setFESEnabled(object, numbers[0]);
          break;
        case 'disp':
          if (isLog(object) || skipLogHoles) {
            skipLogHoles = true;
            await this.log(object).display(numbers[0]);
          } else if (!setFESControlDisplay(instance, object, numbers[0]))
            setFESGraphicalDisplay(instance, object, numbers[0]);
          break;
        case 'pri':
          if (isLog(object) || skipLogHoles) {
            skipLogHoles = true;
            await this.log(object).setPriority(numbers[0]);
          } else if (
            !setFESControlPlanePriority(object, numbers[0]) &&
            !setFESControlPriority(object, numbers[0])
          )
            setFESGraphicalPriority(instance, object, numbers[0]);
          break;
        case 'pos': {
          if (isLog(object)) await this.log(object).position(numbers[0] ?? 0);
          else if (!setFESControlValue(object, numbers[0] ?? 0, 0)) {
            const position = setFESGraphicalPosition(instance, object, numbers);
            if (position)
              await this.motions.add(object, 'pPos', { registers: position.slice(), group: 0 });
          }
          break;
        }
        case 'size':
          if (!setFESGraphicalSize(object, ...numbers)) return 0;
          break;
        case 'pl':
          if (!setFESImagePlane(instance, object, reference.name, reference.index)) return 0;
          break;
        case 'refparentpl':
          setFESImageParentPlane(object, numbers[0]);
          break;
        case 'lock':
          if (object.nativeType === 6) setFESButtonLock(instance, object, numbers[0]);
          break;
        case 'copy':
          if (copyTypes.has(object.nativeType)) {
            object.copyRequest = { ...reference, rectangle: Int32Array.from(numbers) };
            object.imageChanged = true;
          }
          break;
        case 'delay':
          object.motionDelay = numbers[0] >>> 0;
          break;
        case 'arc':
        case 'mcarc': {
          const spec = buildNativeFESMotion(verb, numbers, null, Number);
          await this.motions.add(object, spec.file, spec);
          break;
        }
        case 'blend': {
          const family = fesObjectFamily(object);
          if (family !== 'image' && family !== 'plane' && !blendTypes.has(object.nativeType)) break;
          // This local belongs to the whole original group loop. A plane
          // replaces it with ARGB, which also feeds later non-plane elements.
          if (family === 'plane') color = object.color >>> 0;
          await this.alpha(object, numbers[0]);
          const spec = buildNativeFESMotion('blend', numbers, null, Number, {
            commandPointer: color,
          });
          await this.motions.add(object, spec.file, spec);
          break;
        }
        case 'baseopt':
          if (object.nativeType === 19 || object.nativeType === 20) {
            object.baseOption = text.slice();
            if (typeof this.table !== 'function')
              throw new Error('FES baseopt requires its JS table owner');
            this.table(object)?.setBaseOption(text);
          }
          break;
      }
    }
    // These recovered builtins return the original control code0, including
    // their independently established unsupported-type no-op branches.
    return 0;
  }
}
