// SPDX-License-Identifier: MPL-2.0
// Whole native selections retain encoded names, holes, class gates and argument order.
import { setFESImageID, setFESImageTable } from './fes-image-model.mjs';
import { setFESControlPage, setFESControlSkin } from './fes-control-model.mjs';
import { markFESObjectDirty } from './fes-common-model.mjs';
import { fesDefinitionResourceReference } from './fes-definitions.mjs';
import { setFESDifImageFilter, requestFESDifCapture } from './fes-dif-image.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import {
  readFESPanelType,
  setFESSavePanelType,
  setFESPanelDisplayID,
  setFESPanelNumber,
  fesSavePanelFlag,
  readFESPanelUserFont,
  setFESPanelUserFont,
} from './fes-panel-model.mjs';
import { nativeDataString } from './data-text.mjs';
import { nativeImagePathParts } from './image-file.mjs';
import { buildNativeFESMotion } from './fes-motion.mjs';
import { readFESToneRGB } from './fes-tone-table.mjs';

// Object branches only: a coordinator must not use these gates to skip
// argument evaluation, selection traversal, or the native first-target branch.
export const FES_IMAGE_CONTROL_TYPE_GATES = Object.freeze(
  Object.fromEntries(
    [
      ['setid', [2, 6, 10, 11, 12, 22]],
      ['getid', [2, 6, 10, 11, 12, 22], 'write-reference-address'],
      ['settbl', [2, 6, 11, 12, 14, 15, 22]],
      ['page', [13, 14, 15, 24, 38]],
      ['ref', [2, 6, 11, 12, 22]],
      ['pos2', [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 21, 22, 25, 29, 37]],
      ['color', [1, 2, 3, 4, 6, 11, 12, 21, 22, 24, 29, 33, 36, 37, 38]],
      ['tone', [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25, 33]],
      ['tonetbl', [16, 17]],
      ['gettonetbl', [16, 17]],
      ['coordmode', [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25]],
      ['blur', [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25]],
      ['setanm', [2, 6]],
      ['anm', [2, 6]],
      ['drag', [6]],
      ['mode', [2]],
      ['bmode', [3, 4, 33]],
      ['keypos', [1, 2, 6, 11, 12, 22, 25]],
      ['keyblock', [6]],
      ['locator', [3, 4]],
      ['mag', [21, 29, 37]],
      ['filter', [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25]],
      ['max', [16, 17, 18, 19, 20, 24, 38]],
      ['getfile', [2, 19, 20]],
      ['refex', [1, 2, 25]],
      ['refcap', [25]],
      ['dispid', [11, 12]],
      ['ptype', [12]],
      ['setnum', [11, 12]],
      ['setsave', [12]],
      ['getflag', [12]],
      ['getsavestr', [12]],
      ['getsavedate', [12]],
      ['userfont', [11, 12, 21, 24, 29, 37, 38]],
      ['userfontobj', [21, 24, 29, 37, 38]],
      ['mcpend', null, 'apply'],
    ].map(([verb, types, otherwise = 'no-op']) => [
      verb,
      Object.freeze({ types: types && Object.freeze(types), otherwise }),
    ]),
  ),
);
export const FES_IMAGE_CONTROL_COMMANDS = new Set(Object.keys(FES_IMAGE_CONTROL_TYPE_GATES));
const imageTypes = new Set([1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25]),
  selectorTypes = new Set([2, 6, 11, 12, 22]),
  colorImages = new Set([1, 2, 6, 11, 12, 22]),
  colorPlanes = new Set([3, 4, 21, 29, 33, 36, 37]),
  strings = new Set([21, 29, 37]),
  keyPositionImages = new Set([1, 2, 6, 11, 12, 22, 25]);
const copyReference = (ref) => ({
  ...ref,
  ...(ref.nameBytes ? { nameBytes: ref.nameBytes.slice() } : {}),
});
const keyIncrement = (size) =>
  size > 32 ? (size - 16) | 0 : size > 16 ? (size - 8) | 0 : Math.trunc(size / 2) | 0;

export class FESImageControlCommands {
  constructor(instance, services = {}) {
    const { collection, reference, writeGlobal } = services;
    if (
      typeof instance?.value !== 'function' ||
      typeof collection?.lookup !== 'function' ||
      typeof collection?.count !== 'function' ||
      typeof reference !== 'function' ||
      typeof writeGlobal !== 'function'
    )
      throw new TypeError(
        'FES image/control commands require canonical collection, evaluator, reference and bank services',
      );
    Object.assign(this, { instance, ...services });
  }
  required(name) {
    if (typeof this[name] !== 'function')
      throw new Error(`FES command requires its ${name} JavaScript service`);
    return this[name];
  }
  async command(verb, selection, args = [], context = {}) {
    if (!FES_IMAGE_CONTROL_COMMANDS.has(verb))
      throw new Error(`Unknown image/control FES command ${verb}`);
    const { collection, instance } = this,
      name = selection.nameBytes ?? selection.name,
      index = selection.index | 0,
      lookup = (at) => collection.lookup(name, at),
      bounds = () => [index === -1 ? 0 : index, index === -1 ? collection.count(name) : index + 1],
      value = (at, fallback = 0) =>
        args[at] === undefined
          ? fallback
          : (typeof args[at] === 'number'
              ? args[at]
              : context.argument
                ? context.argument(at)
                : instance.value(args[at])) | 0,
      text = (at) => (context.text ? context.text(at) : String(args[at])),
      // Readers stringify only tokens on their actual native branch. References
      // retain raw tokens for their canonical argumentBytes expansion boundary.
      parameter = (at) =>
        args[at] === undefined ? undefined : { raw: args[at], toString: () => text(at) },
      parameters = (mode = false) =>
        args.map((_arg, at) => (mode && !at ? text(at) : parameter(at))),
      visit = async (limits, stop, apply) => {
        for (let at = limits[0]; at < limits[1]; at++) {
          const object = lookup(at);
          if (!object) {
            if (stop) break;
            continue;
          }
          await apply(object, at);
        }
      },
      imageService = (method) => {
        if (typeof this.images?.[method] !== 'function')
          throw new Error(`FES command requires its images.${method} JavaScript service`);
        return this.images[method].bind(this.images);
      };
    if (verb === 'tonetbl') {
      if (args[0] === undefined) return 0;
      const filename = context.bytes ? context.bytes(0) : instance.argumentBytes(args[0]),
        limits = bounds();
      await visit(limits, true, async (object) => {
        if (object.nativeType === 16 || object.nativeType === 17)
          await this.required('loadToneTable')(object, filename);
      });
      return 0;
    }
    if (verb === 'gettonetbl') {
      const outputs = [0, 1, 2].map((at) => value(at, -1)),
        limits = bounds();
      await visit(limits, true, async (object) => {
        if (object.nativeType !== 16 && object.nativeType !== 17) return;
        if (!(object.fileBytes instanceof Uint8Array))
          throw new Error('BGTABLE current FILE bytes are missing');
        const rgb = readFESToneRGB(object.toneTable, object.fileBytes);
        for (let at = 0; at < 3; at++)
          if (outputs[at] !== -1) this.writeGlobal(outputs[at], rgb[at] | 0);
      });
      return 0;
    }
    if (verb === 'setid') {
      const id = value(0),
        limits = bounds();
      await visit(limits, true, async (object) => {
        if (selectorTypes.has(object.nativeType)) setFESImageID(object, id);
        else if (object.nativeType === 10) await this.required('soundSetID')(object, id);
      });
      return 0;
    }
    if (verb === 'getid') {
      if (index === -1) return 0;
      const output = value(0),
        object = lookup(index);
      if (!object) return 0;
      let result;
      if (selectorTypes.has(object.nativeType)) result = object.idIndex | 0;
      else if (object.nativeType === 10) result = await this.required('soundGetID')(object);
      else {
        if (!Number.isInteger(context.referenceAddress))
          throw new Error('FES getid default branch requires its original group/name ABI address');
        result = context.referenceAddress;
      }
      this.writeGlobal(output, result | 0);
      return 0;
    }
    if (verb === 'settbl') {
      const limits = bounds(),
        slot = value(0),
        frame = value(1);
      await visit(limits, true, (object) => {
        if (selectorTypes.has(object.nativeType)) setFESImageTable(object, slot, frame);
        else if (object.nativeType === 14 || object.nativeType === 15)
          setFESControlSkin(object, slot, frame);
      });
      return 0;
    }
    if (verb === 'page') {
      const limits = bounds(),
        minimum = value(0),
        maximum = value(1),
        page = value(2);
      await visit(limits, false, async (object) => {
        if (object.nativeType >= 13 && object.nativeType <= 15)
          setFESControlPage(object, minimum, maximum, page);
        else if (object.nativeType === 24 || object.nativeType === 38)
          await this.required('logModel')(object).page(minimum);
      });
      return 0;
    }
    if (verb === 'ref') {
      const limits = bounds();
      if (args[0] === undefined) return 0;
      const ref = this.reference(args[0]);
      if (!ref) return 0;
      await visit(limits, false, (object) => {
        if (selectorTypes.has(object.nativeType)) object.referenceRequest = copyReference(ref);
      });
      return 0;
    }
    if (verb === 'pos2') {
      const limits = bounds();
      if (args[0] === undefined) return 0;
      const filename = text(0),
        selector = value(1),
        ref = fesDefinitionResourceReference({ name: `${filename}:${selector}` });
      await visit(limits, false, (object) => {
        if (imageTypes.has(object.nativeType) || strings.has(object.nativeType)) {
          object.positionReference = copyReference(ref);
          object.positionPending = true;
          if (imageTypes.has(object.nativeType)) markFESObjectDirty(instance, object);
        }
      });
      return 0;
    }
    if (verb === 'color') {
      const limits = bounds(),
        color = value(0) >>> 0;
      await visit(limits, false, async (object) => {
        if (colorImages.has(object.nativeType)) {
          object.color = color;
          object.sizeDirty = true;
        } else if (colorPlanes.has(object.nativeType)) {
          object.color = color;
          object.alpha = color >>> 24;
          markFESObjectDirty(instance, object);
        } else if (object.nativeType !== 24 && object.nativeType !== 38) return;
        if (typeof this.motions?.add !== 'function')
          throw new Error('FES color requires the actual MOT manager');
        await this.motions.add(object, 'pColor', {
          registers: [color >>> 24, (color >>> 16) & 255, (color >>> 8) & 255, color & 255],
          group: 0,
        });
      });
      return 0;
    }
    if (verb === 'mcpend') {
      const limits = bounds(),
        spec = buildNativeFESMotion(
          verb,
          [value(0, 30), value(1), value(2), value(3)],
          null,
          Number,
        );
      await visit(limits, true, (object) => {
        if (typeof this.motions?.add !== 'function')
          throw new Error('FES mcpend requires the actual MOT manager');
        return this.motions.add(object, spec.file, spec);
      });
      return 0;
    }
    if (verb === 'tone') {
      const values = [value(0, 100), value(1, 100), value(2, 100)],
        limits = bounds();
      await visit(limits, true, async (object) => {
        if (imageTypes.has(object.nativeType)) {
          object.toneRGB = values.slice();
          object.imageChanged = true;
        } else if (object.nativeType === 33) await this.required('m2Tone')(object, values);
      });
      return 0;
    }
    if (verb === 'blur') {
      const x = value(0, 1),
        y = value(1, 1),
        limits = bounds();
      await visit(limits, true, (object) => {
        if (imageTypes.has(object.nativeType)) {
          object.blurX = x;
          object.blurY = y;
          object.imageChanged = true;
        }
      });
      return 0;
    }
    if (verb === 'coordmode') {
      const mode = value(0),
        limits = bounds();
      await visit(limits, true, (object) => {
        if (imageTypes.has(object.nativeType)) object.coordinateMode = mode;
      });
      return 0;
    }
    if (verb === 'setanm') {
      const limits = bounds();
      let file = this.required('expandString')(args[0] === undefined ? '' : text(0));
      if (typeof file !== 'string') throw new TypeError('FES string service must return text');
      const parts = nativeImagePathParts(file);
      if (parts.extension.length <= 1) file = parts.stem + '.anm';
      await visit(limits, false, (object) => {
        if (object.nativeType === 2 || object.nativeType === 6) {
          object.anmFile = file;
          object.anmPending = true;
        }
      });
      return 0;
    }
    if (verb === 'anm') {
      const limits = bounds(),
        enabled = args[0] === undefined || text(0).toUpperCase() !== 'STOP';
      await visit(limits, false, (object) => {
        if (object.nativeType === 2 || object.nativeType === 6) {
          object.anmEnabled = enabled;
          object.anmPending = true;
        }
      });
      return 0;
    }
    if (verb === 'drag') {
      const limits = bounds(),
        enabled = value(0);
      await visit(limits, true, (object) => {
        if (object.nativeType === 6) {
          object.fullInput = enabled;
          object.fullInputChanged = true;
        }
      });
      return 0;
    }
    if (verb === 'mode') {
      const limits = bounds(),
        mode = value(0);
      await visit(limits, true, (object) => {
        if (object.nativeType === 2) object.pathMode = mode;
      });
      return 0;
    }
    if (verb === 'bmode') {
      const limits = bounds(),
        mode = value(0);
      await visit(limits, true, (object) => {
        if (object.nativeType === 3 || object.nativeType === 4 || object.nativeType === 33) {
          object.blendMode = mode;
          markFESObjectDirty(instance, object);
        }
      });
      return 0;
    }
    if (verb === 'keypos') {
      const limits = bounds(),
        manual = value(0),
        x = value(1),
        y = value(2);
      await visit(limits, true, (object) => {
        if (keyPositionImages.has(object.nativeType)) {
          object.auxiliarySizeMode = manual;
          if (manual) {
            object.auxiliaryWidth = x;
            object.auxiliaryHeight = y;
          } else {
            object.auxiliaryWidth = (object.auxiliaryWidth + keyIncrement(object.width)) | 0;
            object.auxiliaryHeight = (object.auxiliaryHeight + keyIncrement(object.height)) | 0;
          }
        }
      });
      return 0;
    }
    if (verb === 'keyblock') {
      const limits = bounds(),
        block = value(0, -1),
        x = value(1, -1),
        y = value(2, -1);
      await visit(limits, false, (object) => {
        if (object.nativeType === 6) object.keyblock = { block, x, y };
      });
      return 0;
    }
    if (verb === 'locator') {
      const limits = bounds();
      if (args[0] === undefined) return 0;
      const file = text(0);
      await visit(limits, false, (object) => {
        if (object.nativeType === 3 || object.nativeType === 4) {
          object.resourceFile = file;
          object.resourcePending = true;
        }
      });
      return 0;
    }
    if (verb === 'mag') {
      const speed = value(0, 10),
        limits = bounds();
      await visit(limits, false, (object) => {
        if (strings.has(object.nativeType)) {
          if (!object.nativeTextState)
            throw new Error('FES mag requires initialized typed STRING state');
          if (object.nativeTextState.speed !== speed) {
            object.nativeTextState.speed = speed;
            object.dirty = true;
          }
        }
      });
      return 0;
    }
    if (verb === 'filter') {
      const limits = bounds(),
        filter = (args[0] === undefined ? '' : text(0)).toLowerCase(),
        mode = filter === 'mono' ? 1 : filter === 'sepia' ? 2 : filter === 'np' ? 3 : 0;
      await visit(limits, false, (object) => {
        if (object.nativeType === 25) setFESDifImageFilter(object, mode);
        else if (imageTypes.has(object.nativeType) && object.filterMode !== mode) {
          object.filterMode = mode;
          object.filterPending = true;
        }
      });
      return 0;
    }
    if (verb === 'refex') {
      const limits = bounds(),
        handle = value(0) >>> 0;
      await visit(limits, false, async (object) => {
        if (object.nativeType === 1 || object.nativeType === 2)
          await imageService('refBitmap')(instance, object, handle);
        else if (object.nativeType === 25) await imageService('refex')(instance, object, handle);
      });
      return 0;
    }
    if (verb === 'refcap') {
      const limits = bounds(),
        minimum = value(0),
        maximum = value(1, 45000);
      await visit(limits, false, (object) => {
        if (object.nativeType === 25) requestFESDifCapture(object, minimum, maximum);
      });
      return 0;
    }
    if (verb === 'max') {
      const object = lookup(index);
      if (!object) throw new Error('FES max requires a live explicit table or LOG element');
      const type = object.nativeType;
      if (type === 16 || type === 17) {
        const output = value(0);
        this.writeGlobal(output, imageService('tableMax')(object, []));
      } else if (type === 18) {
        const output = value(0),
          mode = value(1),
          character = value(2),
          pose = value(3);
        if (mode >= 0 && mode <= 3)
          this.writeGlobal(
            output,
            imageService('tableMax')(
              object,
              mode === 0 ? [mode] : mode === 1 ? [mode, character] : [mode, character, pose],
            ),
          );
      } else if (type === 19 || type === 20) {
        const output = value(0),
          selectors = [];
        for (let at = 1; at < args.length && at <= 16; at++) selectors.push(value(at));
        this.writeGlobal(output, imageService('tableMax')(object, selectors));
      } else if (type === 24 || type === 38) {
        const output = value(0);
        this.writeGlobal(output, this.required('logModel')(object).max());
      }
      return 0;
    }
    if (verb === 'getfile') {
      const limits = bounds();
      if (args[0] === undefined) return 0;
      const output = value(0),
        selectors = [];
      for (let at = 1; at < args.length && at <= 16; at++) selectors.push(value(at));
      await visit(limits, true, (object) => {
        let bytes;
        if (object.nativeType === 2) bytes = encodeCP932(object.file);
        else if (object.nativeType === 19 || object.nativeType === 20)
          bytes = imageService('table')(object)?.select(selectors) ?? new Uint8Array();
        else return;
        this.required('writeString')(output, bytes);
      });
      return 0;
    }
    if (verb === 'ptype') {
      const limits = bounds(),
        specification = readFESPanelType(parameters(true), {
          evaluate: (expression) => instance.value(expression),
          reference: (parameter) => this.reference(parameter.raw ?? parameter),
        });
      if (specification)
        await visit(limits, false, (object) => {
          if (object.nativeType === 12) setFESSavePanelType(object, specification);
        });
      return 0;
    }
    if (verb === 'dispid') {
      const limits = bounds(),
        display = value(0, 1) !== 0;
      await visit(limits, true, (object) => {
        for (let at = 1; at < args.length; at++) {
          const source = text(at);
          let left, right;
          if (source[0] === '[') {
            const dash = source.indexOf('-', 1),
              end = dash < 0 ? source.length : dash;
            const first = source.slice(1, end);
            if (encodeCP932(first).length >= 128)
              throw new RangeError('PANEL ID range exceeds its128-byte expression');
            left = instance.value(first) | 0;
            right = left;
            if (dash >= 0) {
              const close = source.indexOf(']', dash + 1),
                last = source.slice(dash + 1, close < 0 ? undefined : close);
              if (encodeCP932(last).length >= 128)
                throw new RangeError('PANEL ID range exceeds its128-byte expression');
              right = instance.value(last) | 0;
            }
          } else left = right = instance.value(source) | 0;
          if (right === 0x7fffffff)
            throw new RangeError('PANEL inclusive ID loop would wrap its signed counter');
          for (let id = left; id <= right; id++)
            if (object.nativeType === 11 || object.nativeType === 12)
              setFESPanelDisplayID(object, id, display);
        }
      });
      return 0;
    }
    if (verb === 'setnum') {
      const limits = bounds();
      if (args[0] === undefined) return 0;
      const id = value(0);
      if (args[1] === undefined) return 0;
      const number = value(1);
      await visit(limits, true, (object) => {
        if (object.nativeType === 11 || object.nativeType === 12)
          setFESPanelNumber(object, id, number);
      });
      return 0;
    }
    if (verb === 'setsave') {
      if (index === -1) return 0;
      const values = [];
      for (let at = 0; at < 3; at++) {
        if (args[at] === undefined) return 0;
        values.push(value(at));
      }
      const object = lookup(index);
      if (object?.nativeType === 12) await imageService('setSave')(instance, object, ...values);
      return 0;
    }
    if (verb === 'getflag' || verb === 'getsavestr') {
      if (index === -1 || args[0] === undefined) return 0;
      const first = value(0);
      if (args[1] === undefined) return 0;
      const second = value(1),
        object = lookup(index);
      if (object?.nativeType !== 12) return 0;
      if (verb === 'getflag') this.writeGlobal(second, fesSavePanelFlag(object, first));
      else
        this.required('writeString')(
          first,
          nativeDataString(imageService('saveFile')(object)?.read(second) ?? new Uint8Array()),
        );
      return 0;
    }
    if (verb === 'getsavedate') {
      if (index === -1) return 0;
      const object = lookup(index);
      if (object?.nativeType !== 12) return 0;
      const date = object.panel.save.date.slice();
      for (let at = 0; at < 6; at++)
        if (args[at] !== undefined) this.writeGlobal(value(at), date[at]);
      return 0;
    }
    if (verb === 'userfont' || verb === 'userfontobj') {
      const limits = bounds(),
        mainChildren = (object, apply) => {
          if (strings.has(object.nativeType)) {
            apply(object);
            return;
          }
          if (object.nativeType !== 24 && object.nativeType !== 38) return;
          const count = Math.min(
            this.required('logModel')(object).max(),
            object.slots?.length ?? 0,
          );
          for (let at = 0; at < count; at++) {
            const handle = object.slots[at].main;
            if (handle === null) continue;
            const child = collection.graph.get(handle);
            if (!child || child.deleted) throw new Error('LOG generated STRING is absent');
            apply(child);
          }
        },
        stringService = (method) => {
          if (typeof this.strings?.[method] !== 'function')
            throw new Error(`FES user font requires its strings.${method} JavaScript service`);
          return this.strings[method].bind(this.strings);
        };
      if (verb === 'userfontobj') {
        if (args[0] === undefined) return 0;
        const ref = context.reference ?? this.reference(args[0]);
        if (!ref) return 0;
        const source = collection.lookup(ref.nameBytes ?? ref.name, ref.index);
        await visit(limits, true, (object) =>
          mainChildren(object, (child) => stringService('setFontSource')(child, source)),
        );
        return 0;
      }
      const first = lookup(limits[0]);
      if (!first) return 0;
      if (first.nativeType === 11 || first.nativeType === 12) {
        const specification = readFESPanelUserFont(parameters(), (expression) =>
          instance.value(expression),
        );
        if (specification)
          await visit(limits, true, (object) => {
            if (object.nativeType === 11 || object.nativeType === 12)
              setFESPanelUserFont(object, specification.id, specification.specification);
          });
      } else if (
        strings.has(first.nativeType) ||
        first.nativeType === 24 ||
        first.nativeType === 38
      ) {
        if (args[0] === undefined) return 0;
        const char = value(0) & 65535;
        if (args[1] === undefined) return 0;
        const selector = value(1) & 65535;
        await visit(limits, true, (object) =>
          mainChildren(object, (child) => stringService('setFontMapping')(child, char, selector)),
        );
      }
      return 0;
    }
    throw new Error(`Unimplemented image/control FES command ${verb}`);
  }
}
