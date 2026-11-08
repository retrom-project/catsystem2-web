// SPDX-License-Identifier: MPL-2.0
// Main F1 saves a bitmap as HG2 in a CTS entry; FB creates a new wrapper by
// decoding the stored image. These are image entries, not task checkpoints.
import { encodeHG2 } from '../formats/hg2.mjs';
import { openImage } from '../formats/hg3.mjs';
import { UnsupportedNativeImageFormat } from '../formats/raster.mjs';
import { nativeReply } from '../kcs/vm.mjs';

export function installNativeImagePersistence(world) {
  for (const id of [0xf1, 0xfb])
    world.runtime.register('main', id, async (args, _machine, task) => {
      if (args.length !== (id === 0xf1 ? 3 : 2))
        throw new Error(`Native image persistence ${id.toString(16)} argument count`);
      const result = (value) => nativeReply(1, value);
      if (!args[0] || (id === 0xf1 && !args[2])) return result(0);
      const file = world.runtime.handles.get(args[0], 'global-file'),
        images = world.graphics.images;
      if (id === 0xf1) {
        const bitmap = images.get(args[2]);
        bitmap.commitCanvas();
        file.write(args[1], await encodeHG2({ ...bitmap.state, rgba: await bitmap.pixels() }));
        return result(1);
      }
      const bytes = file.read(args[1]);
      if (!bytes) return result(0);
      let frame;
      try {
        const image = await openImage(bytes);
        frame = image.frame(0);
        if (!frame) return result(0);
        await image.decode(frame);
      } catch (error) {
        if (error instanceof UnsupportedNativeImageFormat) throw error;
        world.host.nativeDiagnostic?.({
          type: 'stored-image-invalid',
          native: id,
          entry: args[1],
          error: error.message,
        });
        return result(0);
      }
      const handle = images.create(frame.width, frame.height, task.id),
        bitmap = images.get(handle);
      Object.assign(bitmap.state, {
        canvasWidth: frame.canvasWidth,
        canvasHeight: frame.canvasHeight,
        offsetX: frame.offsetX,
        offsetY: frame.offsetY,
        baseX: frame.baseX,
        baseY: frame.baseY,
        bpp: frame.bpp / 8,
        rgba: new Uint8ClampedArray(frame.rgba),
      });
      bitmap.changed();
      return result(handle);
    });
}
