// SPDX-License-Identifier: MPL-2.0
// Whole-selection resource commands retain their original token-read positions.
import { setFESImageID } from './fes-image-model.mjs';
import { setFESControlFile } from './fes-control-model.mjs';

export const FES_RESOURCE_COMMANDS = new Set(['load']);
const imageTypes = new Set([2, 6, 11, 12, 22]);

export class FESResourceCommands {
  constructor(instance, services) {
    Object.assign(this, { instance, ...services });
  }
  async command(verb, selection, args = [], context = {}) {
    if (!FES_RESOURCE_COMMANDS.has(verb)) throw new Error('Unknown FES resource command ' + verb);
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
}
