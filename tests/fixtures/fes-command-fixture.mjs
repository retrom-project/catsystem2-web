// SPDX-License-Identifier: MPL-2.0
import { FESObjectCollection } from '../../src/native/fes-object-collection.mjs';
import { createFESTypedObject } from '../../src/native/fes-object-factory.mjs';
import { initializeFESImage } from '../../src/native/fes-image-driver.mjs';
import { initializeFESDifTail } from '../../src/native/fes-dif-image.mjs';
import { initializeFESPanelTail } from '../../src/native/fes-panel-model.mjs';
import { FESStringDriver, initializeFESString } from '../../src/native/fes-string-driver.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeVariableBank } from '../../src/native/bank.mjs';
import { evaluateNativeExpression } from '../../src/native/expression.mjs';
import { FESImageControlCommands } from '../../src/native/fes-image-control-commands.mjs';

export const profile = 'nekopara-vol3-engine-2.6.1.76';
export function fixture() {
  const configuration = new NativeConfiguration({ profile }),
    bank = new NativeVariableBank();
  bank.initialize(32);
  bank.registerContext('fes');
  const evaluations = [],
    writes = [],
    specs = [],
    strings = new Map(),
    sound = [],
    instances = [],
    instance = {
      objects: [],
      byKey: new Map(),
      value(token) {
        evaluations.push(token);
        return evaluateNativeExpression(token, bank);
      },
    },
    collection = new FESObjectCollection({
      create: (identity) =>
        createFESTypedObject(identity, {
          initializeImage: initializeFESImage,
          initializeSpecial: (object) => {
            if (object.nativeType === 10) {
              object.soundID = 0;
              return true;
            }
            if ([21, 29, 37].includes(object.nativeType)) {
              initializeFESString(object, { profile, configuration });
              return true;
            }
            if (object.nativeType === 25) {
              initializeFESDifTail(object);
              return true;
            }
            if (object.nativeType === 11 || object.nativeType === 12) {
              initializeFESPanelTail(object);
              return true;
            }
            if (object.nativeType === 33 || object.nativeType === 36) return true;
            return false;
          },
        }),
    }),
    services = {
      collection,
      reference(token) {
        const match = /^([^[]+)(?:\[(.*)\])?$/.exec(token);
        const index = match[2] === undefined ? -1 : instance.value(match[2]);
        return {
          name: match[1],
          index: index === -1 && collection.count(match[1]) <= 1 ? 0 : index,
        };
      },
      writeGlobal(index, value) {
        writes.push([index, value]);
        bank.set(index, value);
      },
      writeString(index, bytes) {
        strings.set(index, bytes.slice());
      },
      motions: {
        async add(object, file, options) {
          specs.push({ key: object.key, file, ...options });
        },
      },
      soundSetID(object, id) {
        sound.push(['set', object.key, id]);
        object.soundID = id;
      },
      soundGetID(object) {
        sound.push(['get', object.key]);
        return object.soundID;
      },
      expandString: (text) => text,
      images: {
        table: (object) => object.table,
        tableMax: (object, selectors) => object.table.max(selectors),
        saveFile: (object) => object.fixtureSaveFile ?? null,
        async setSave(_instance, object, ...args) {
          instances.push(['setsave', object.key, ...args]);
        },
        async refBitmap(_instance, object, handle) {
          instances.push(['bitmap', object.key, handle]);
        },
        async refex(_instance, object, handle) {
          instances.push(['owner', object.key, handle]);
        },
      },
      logModel: (object) => object.logModel,
      m2Tone: (_object, values) => {
        instances.push(['m2tone', ...values]);
      },
    },
    commands = new FESImageControlCommands(instance, services);
  Object.assign(instance, { collection, objects: collection.objects, byKey: collection.byKey });
  commands.strings = new FESStringDriver(
    { profile, configuration },
    {
      cacheFor: () => null,
      lookup: (owner, ref) => owner.collection.lookup(ref.nameBytes ?? ref.name, ref.index),
      imageDataFor: () => null,
    },
  );
  return {
    configuration,
    bank,
    evaluations,
    writes,
    specs,
    strings,
    sound,
    instances,
    instance,
    collection,
    services,
    commands,
    create: (type, name = 'items', count = 3) =>
      collection.create(type, name, count, { enqueue: false }),
    command: (verb, args = [], index = -1, context = {}) =>
      commands.command(verb, { name: 'items', index }, args, context),
  };
}
