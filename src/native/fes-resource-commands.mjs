// SPDX-License-Identifier: MPL-2.0
// Whole-selection resource commands retain their original token-read positions.
import { setFESImageID } from './fes-image-model.mjs';
import { setFESControlFile } from './fes-control-model.mjs';

export const FES_RESOURCE_COMMANDS = new Set([
  'load',
  'loadlist',
  'loadlist2',
  'attr',
  'strid',
  'redraw',
]);
const listModes = Object.freeze({
  loadlist: { seenOnly: false, numericSource: 'last-read' },
  loadlist2: { seenOnly: true, numericSource: 'group' },
});
const imageTypes = new Set([2, 6, 11, 12, 22]);
const attributeTypes = new Set([1, 2, 6, 16, 17, 18, 19, 20, 25]);

export class FESResourceCommands {
  constructor(instance, services) {
    Object.assign(this, { instance, ...services });
  }
  async command(verb, selection, args = [], context = {}) {
    if (!FES_RESOURCE_COMMANDS.has(verb)) throw new Error('Unknown FES resource command ' + verb);
    if (Object.hasOwn(listModes, verb)) return this.loadList(verb, selection, args, context);
    if (verb !== 'load') return this.query(verb, selection, args, context);
    const name = selection.nameBytes ?? selection.name,
      first = selection.index === -1 ? 0 : selection.index,
      end = selection.index === -1 ? this.collection.count(name) : first + 1,
      value = (i, fallback = 0) =>
        args[i] === undefined
          ? fallback
          : typeof args[i] === 'number'
            ? args[i]
            : context.argument
              ? context.argument(i)
              : this.instance.value(args[i]),
      text = (i) =>
        args[i] === undefined
          ? ''
          : context.text
            ? context.text(i)
            : this.instance.soundArgument(args[i]);
    let imageID = 0;
    for (let at = first; at < end; at++) {
      const object = this.collection.lookup(name, at);
      if (!object) break;
      const type = object.nativeType;
      if (type >= 16 && type <= 20) {
        let selectors;
        if (type === 16 || type === 17) selectors = [value(0), value(1)];
        else if (type === 18) selectors = [value(0), value(1), value(2), value(3)];
        else {
          selectors = [];
          for (let i = 0; i < 16 && args[i] !== undefined; i++) selectors.push(value(i));
        }
        this.images.selectTable(object, selectors);
        continue;
      }
      // Even ignored classes read FILE and ID, once for each live element.
      const file = text(0);
      if (args[1] !== undefined) imageID = value(1);
      if (imageTypes.has(type)) {
        this.setImageFile(object, file);
        setFESImageID(object, imageID);
      } else if (type >= 13 && type <= 15) setFESControlFile(object, file);
      else if (type === 9) {
        // The later ABI reads the second argument again in its SOUND branch.
        const crossfade = this.soundLoadParameters ? value(1) : 0,
          frames = this.soundLoadParameters ? value(2, 60) : 0;
        this.loadSound(object, file, crossfade, frames);
      } else if (type === 33) this.loadM2(object, file);
      else if (type === 36) {
        if (!this.loadEFK) throw new Error('Unimplemented FES EFKPLANE load');
        this.loadEFK(object, file);
      }
    }
    return 0;
  }
  loadList(verb, selection, args, context) {
    if (selection.index === -1) return 0;
    const object = this.collection.lookup(selection.nameBytes ?? selection.name, selection.index),
      gallery = this.instance.cgGallery;
    if (!object || !gallery) return 0;
    const text = (i) => (context.text ? context.text(i) : this.instance.soundArgument(args[i])),
      evaluate = (token) =>
        context.evaluateExpanded
          ? context.evaluateExpanded(token) | 0
          : this.instance.value(token) | 0;
    let scratch;
    const number = (i, fallback = 0) => {
      if (args[i] === undefined) return fallback;
      scratch = text(i);
      return evaluate(scratch);
    };
    number(0);
    if (args[1] === undefined) return 0;
    const group = text(1),
      variant = number(2),
      section = number(3),
      mode = listModes[verb],
      block = /^[$0-9]/.test(group)
        ? evaluate(mode.numericSource === 'group' ? group : scratch)
        : group,
      selected = gallery.variants(block, section, mode.seenOnly)[variant >>> 0];
    if (selected !== undefined && imageTypes.has(object.nativeType)) {
      this.setImageFile(object, selected);
      setFESImageID(object, section);
    }
    return 0;
  }
  async query(verb, selection, args, context) {
    const name = selection.nameBytes ?? selection.name,
      first = selection.index === -1 ? 0 : selection.index,
      value = (i, fallback = -1) =>
        args[i] === undefined
          ? fallback
          : typeof args[i] === 'number'
            ? args[i] | 0
            : context.argument
              ? context.argument(i) | 0
              : this.instance.value(args[i]) | 0;
    if (verb === 'attr') {
      if (!args.length) return 0;
      const id = value(0) & 65535,
        outputs = Array.from({ length: 5 }, (_, i) => value(i + 1)),
        end = selection.index === -1 ? this.collection.count(name) : first + 1;
      for (let at = first; at < end; at++) {
        const object = this.collection.lookup(name, at);
        if (!object) break;
        if (!attributeTypes.has(object.nativeType)) continue;
        const attribute = this.bitmap(object)?.state.attributes.find((entry) => entry.id === id);
        if (!attribute) continue;
        const values = [...attribute.rect, attribute.color];
        outputs.forEach((index, i) => {
          if (index !== -1) this.instance.setGlobal(index, values[i]);
        });
      }
      return 0;
    }
    const end = selection.index === -1 ? this.collection.count(name) : first + 1;
    let row = -1,
      id = -1,
      output = -1;
    for (let at = first; at < end; at++) {
      const object = this.collection.lookup(name, at);
      if (!object) continue;
      const type = object.nativeType;
      if (verb === 'redraw') {
        if (type === 29) this.redraw(object);
        continue;
      }
      let result;
      if (type === 21 || type === 37) {
        if (id === -1) id = value(0);
        if (output === -1) output = value(1);
        result = await this.stringID(object, id);
      } else if (type === 24 || type === 38) {
        if (row === -1) row = value(0);
        if (id === -1) id = value(1);
        if (output === -1) output = value(2);
        result = await this.logStringID(object, row, id);
      } else continue;
      if (output !== -1) this.instance.setGlobal(output, result);
    }
    return 0;
  }
}
