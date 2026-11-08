// SPDX-License-Identifier: MPL-2.0
import { CGRegistry, CGGallery, parseCGReference, readCGList } from '../gallery.mjs';
import { nativeReply } from '../kcs/vm.mjs';

export const nativeGalleryCodec = {
  snapshot: (gallery) => ({ list: gallery.list, registrations: gallery.registry.write() }),
  restore: (state) => new CGGallery(state.list, new CGRegistry(state.registrations)),
};

export function registerNativeCG(registry, source) {
  const ref = parseCGReference(source, true);
  if (!ref) return;
  registry.register(ref.file, ref.selectors);
  // The fixed handler also registers a filename with the L immediately before
  // an underscore removed. Its preceding-digit test uses OR and accepts every
  // character; preserving that behavior matters for existing scripts.
  for (let i = 2; i < ref.file.length; i++) {
    if (ref.file[i] === '_' && /[lL]/.test(ref.file[i - 1])) {
      registry.register(ref.file.slice(0, i - 1) + ref.file.slice(i), ref.selectors);
      break;
    }
  }
}

export function nativeGallery(id, args, machine, services = {}) {
  const count = new Map([
    [0x1a3, 0],
    [0x1a4, 1],
    [0x1a5, 1],
    [0x1a6, 2],
    [0x1a7, 2],
    [0x1a8, 3],
    [0x1a9, 3],
    [0x1ca, 2],
    [0x1cb, 3],
  ]).get(id);
  if (count === undefined) return undefined;
  if (args.length !== count)
    throw new Error(`KCS CG native 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  const handles = services.handles,
    scalar = (n) => nativeReply(1, n),
    done = () => nativeReply(2);
  if (id === 0x1a3) return scalar(handles.add('cg-registration', new CGGallery()));
  if (id === 0x1a4) {
    if (args[0]) handles.release(args[0], 'cg-registration');
    return done();
  }
  if (id === 0x1a8 || id === 0x1a9) {
    if (!args[0] || !args[2]) return scalar(0);
    const gallery = handles.get(args[2], 'cg-registration');
    if (!services.globalEntries) return undefined;
    if (id === 0x1a8) {
      return Promise.resolve(
        services.globalEntries.write(args[0], args[1], gallery.registry.write()),
      ).then(() => scalar(1));
    }
    return Promise.resolve(services.globalEntries.read(args[0], args[1])).then((bytes) => {
      if (bytes === null) return scalar(0);
      gallery.registry.read(bytes);
      return scalar(1);
    });
  }
  if (!args[0]) return id === 0x1a7 ? scalar(0) : done();
  const gallery = handles.get(args[0], 'cg-registration');
  if (id === 0x1a5) {
    gallery.registry.files.clear();
    return done();
  }
  if (!services.format) return undefined;
  if (id === 0x1a6) registerNativeCG(gallery.registry, services.format(args[1], machine));
  else if (id === 0x1a7)
    return scalar(Number(gallery.registry.hasReference(services.format(args[1], machine), true)));
  else if (id === 0x1cb) gallery.registerGroup(services.format(args[2], machine), args[1] | 0);
  else {
    if (!services.read) return undefined;
    const name = services.format(args[1], machine);
    return Promise.resolve(services.read(name, 'config')).then((bytes) => {
      if (bytes?.length) gallery.list = readCGList(bytes);
      else services.diagnostic?.({ native: id, resource: name, error: 'CG list was not found' });
      return done();
    });
  }
  return done();
}
