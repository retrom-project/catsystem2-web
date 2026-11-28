// SPDX-License-Identifier: MPL-2.0
import { originalOwner, originalFeature } from './original-adapter.mjs';
// One ordinary Plane movie owner and canonical load/query packets.
import { nativeReply } from '../kcs/vm.mjs';
import { NativePlaneMovies } from './plane-movie-session.mjs';
import { formatNativeAt, encodeCP932 } from '../kcs.mjs';
import { nativeABI } from './abi/index.mjs';
import { nativeCategoryFilename, nativeNarrowCategoryPath } from './resource-file.mjs';
const PLANE_COMMANDS = new Map([
  [0x2bd, { words: 2, control: 2, message: 43, load: true }],
  [0x2be, { words: 1, control: 1, message: 87 }],
  [0x3dc, { words: 2, control: 2, message: 44, load: true }],
  [0x3dd, { words: 1, control: 1, message: 88 }],
]);
async function ordinaryPlaneMovie(world, id, args, machine, task) {
  const spec = PLANE_COMMANDS.get(id),
    target = (args[0] ?? machine.nativeArgument(0)) >>> 0,
    abi = nativeABI(world.profile),
    legacy = abi.graphics.planeMovieLegacy === true;
  // Both loaders skip formatting and I/O for a zero target; queries initialize
  // their own local output to zero even if the target writes no result.
  if (spec.load && !target) return nativeReply(2);
  const owner = legacy ? world.resolveTaskID(target, task.id) : null,
    kind = owner === null ? null : world.objects.objects.get(owner)?.kind;
  if (legacy && owner !== null && ![1, 2, 6].includes(kind))
    throw new Error('Native Plane movie requires a Top, Plane or BasePlane recipient');
  let output = 0;
  if (!spec.load) {
    await world.sendNativeEngine(target, task.id, spec.message, 0, 0, {
      flags: 0,
      payload: {
        store: (_at, word) => {
          output = word >>> 0;
        },
      },
    });
    return nativeReply(1, output);
  }
  const raw = (world.runtime.services.formatBytes ?? formatNativeAt)(
      args[1] ?? machine.nativeArgument(1),
      machine,
    ),
    end = raw.indexOf(0),
    name = end < 0 ? raw : raw.subarray(0, end),
    category = spec.message === 44 ? 'veff' : 'movie';
  let bytes;
  if (legacy) {
    bytes = nativeNarrowCategoryPath(world.game, name, category, abi.resources.categoryCount);
    if (!bytes && kind === 2)
      throw new Error('Plane movie category did not initialize its filename');
    if (bytes?.length > abi.text.pathBytes)
      throw new RangeError('Plane movie filename exceeds its CP932 path buffer');
  } else {
    const filename = nativeCategoryFilename(
      world.game,
      new TextDecoder('shift_jis').decode(name),
      category,
    );
    bytes = encodeCP932((filename ?? '') + '\0');
  }
  const packet = new Uint8Array(12 + (bytes?.length ?? 1));
  if (bytes) packet.set(bytes, 12);
  const view = new DataView(packet.buffer);
  await world.sendNativeEngine(target, task.id, spec.message, 0, 0, {
    flags: 0,
    payload: {
      load: (at) => view.getUint32(at, true),
      bytes: (at, count) => packet.subarray(at, at + count),
    },
  });
  return nativeReply(2);
}

export function installNativePlaneMovieCommands(world) {
  world.planeMovies = new NativePlaneMovies(world);
  for (const id of PLANE_COMMANDS.keys())
    world.runtime.register('main', id, (args, machine, task) =>
      originalOwner(world)
        ? originalFeature(world, 'plane-movie-commands', 'apply', id, args, machine, task)
        : ordinaryPlaneMovie(world, id, args, machine, task),
    );
}
