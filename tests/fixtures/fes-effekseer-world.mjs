// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './default-fes-world.mjs';
import { readFile } from 'node:fs/promises';
import { defaultFESWorld, loadDefaultFES } from './default-fes-world.mjs';
import { batchEffect } from './effekseer/batch-authored.mjs';

export const PROFILE = 'nekopara-vol3-engine-2.6.1.76';
export const SDK = 'sdk-4.01-engine-2.6.1.74';
export const ascii = (text) => new TextEncoder().encode(text);
const png = await readFile(new URL('./effekseer-level0/one.png', import.meta.url));
export const source = `#DEFINE
EFKPLANE fx
#OBJECT FILE SIZE POS BASE PRI DISP COLOR
fx scene.efk 800,600 5,6,7 2,3,4 170 1 0x80abcdef
#START
fx play
next IDLE
#IDLE
break
next IDLE
#PLAY
fx play
break
#STOP
fx stop
break
#FILE
fx load other.efk
break
#CASE
fx load SCENE.EFK
break
#BAD
fx load bad.efk
break
#SIZE
fx size 64 48
break
#DELETE
fx delete
break
#_FES_SLEEP_
fx play
break
`;
export function files(text = source) {
  const effect = () => batchEffect({ colorPaths: ['a/one.png'], nodes: [{ textureIndex: 0 }] });
  return {
    'screen.fes': ascii(text),
    'scene.efk': effect(),
    'other.efk': effect(),
    'bad.efk': Uint8Array.of(0, 1, 2, 3),
    'one.png': png,
  };
}
export async function open({
  profile = PROFILE,
  text = source,
  extra = {},
  initialize = true,
} = {}) {
  const world = await defaultFESWorld(profile, { ...files(text), ...extra }, { initialize });
  world.graphics.createLogicalDevice();
  if (!initialize) return { world };
  try {
    return { world, ...(await loadDefaultFES(world)) };
  } catch (error) {
    await world.close({ flushFiles: false });
    throw error;
  }
}
export const object = (h) => h.instance.collection.lookup('fx', 0);
export const task = (h) => h.world.objects.objects.get(object(h).nativeTaskID).implementation;
export function step(h, executor = h.world.effekseer.frameExecutor) {
  return h.world.withExecutor(executor, (executorEntry) =>
    h.world.sendEngine(h.id, h.world.main.id, 333, 0, 0, { executorEntry }),
  );
}
export function notify(h, label, executor = h.world.effekseer.frameExecutor) {
  return h.world.withExecutor(executor, (executorEntry) =>
    h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
      executorEntry,
      payload: fesLabelPayload(() => label),
    }),
  );
}
export function observe(h) {
  const calls = [],
    original = h.world.sendEngine.bind(h.world);
  h.world.sendEngine = (target, sender, id, w, l, context = {}) => {
    const record = h.world.objects.objects.get(target);
    if (record?.kind === 61)
      calls.push({
        id,
        target,
        sender,
        w,
        l,
        flags: context.flags,
        entry: context.executorEntry,
        pendingFile: object(h)?.resourcePending,
        pendingPlay: object(h)?.playDirty,
        floats: context.payload?.load
          ? Float32Array.from(
              { length: id === 57 ? 16 : 3 },
              (_, i) => new Float32Array(new Uint32Array([context.payload.load(i * 4)]).buffer)[0],
            )
          : null,
      });
    return original(target, sender, id, w, l, context);
  };
  return calls;
}
