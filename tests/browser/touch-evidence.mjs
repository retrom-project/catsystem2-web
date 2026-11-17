// SPDX-License-Identifier: MPL-2.0
// Test-side evidence. This never drives a frame or supplies guest input.
import { test } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const captured = new WeakSet();
const prefix = '__CS2_TOUCH_EVIDENCE__';

export async function captureTouchBeforeClick(page, { key, owner }) {
  if (captured.has(page)) return;
  captured.add(page);
  const info = test.info(),
    events = info.outputPath('touch-events.ndjson');
  let received = 0;
  page.on('console', (message) => {
    const text = message.text();
    if (!text.startsWith(prefix) || text.length > 4096 || received >= 129) return;
    const value = JSON.parse(text.slice(prefix.length));
    appendFileSync(events, JSON.stringify(value) + '\n');
    received++;
  });
  const observation = await page.evaluate(
    ({ key, owner, prefix }) => {
      const engine = window.catSystem2,
        world = engine.world,
        record = world.objects.objects.get(owner),
        player = record?.implementation.player,
        object = player?.root.byKey.get(key),
        input = world.inputFor(owner),
        region = input?.get(object?.nativeInputTaskID),
        point = region && [
          (region.bounds[0] + region.bounds[2]) / 2,
          (region.bounds[1] + region.bounds[3]) / 2,
        ];
      if (!record || !object || !input || !region)
        throw new Error('Touch evidence requires the selected real FES/Input owner');
      const identity = { owner, nativeID: world.nativeTaskID(owner), inputOwner: region.owner },
        emit = (entry) => {
          if (emit.count++ < 128)
            console.log(prefix + JSON.stringify({ frame: world.frame, ...identity, ...entry }));
          else if (emit.count === 129)
            console.log(prefix + JSON.stringify({ kind: 'limit', retainedEvents: 128 }));
        };
      emit.count = 0;
      const dispatch = input.dispatch;
      input.dispatch = function (...args) {
        if ([4, 5, 7, 8].includes(args[1]))
          emit({ kind: 'input', target: args[0], message: args[1], w: args[2], l: args[3] });
        return dispatch.apply(this, args);
      };
      const send = world.runtime.scheduler.send;
      world.runtime.scheduler.send = function (recipient, words) {
        if (recipient === record.parent || recipient === player.root.kcsTaskID)
          emit({ kind: 'script', recipient, words: words.slice(0, 4) });
        return send.apply(this, arguments);
      };
      const nativeEvent = player.nativeEvent;
      player.nativeEvent = function (reference, event) {
        if (['PUSH_L', 'RELEASE_L', 'TOUCH', 'FOCUS', 'UNFOCUS'].includes(event))
          emit({ kind: 'fes-event', event });
        return nativeEvent.apply(this, arguments);
      };
      const result = {
        frame: world.frame,
        profile: world.profile,
        source: engine.identity,
        ...identity,
        parentWorldID: record.parent,
        parentNativeID: world.nativeTaskID(record.parent),
        candidates: [...engine.nativeFES.values()].filter((value) =>
          value.stack.some((label) => label.startsWith('touch#')),
        ).length,
        authoredEnabled: object.enable,
        shown: player.root.placement(object).shown,
        buttonType: object.buttonType,
        point,
        region: {
          bounds: region.bounds.slice(),
          enabled: region.enabled,
          active: region.active,
          mask: region.mask,
          priority: region.priority,
          alpha: Boolean(region.alpha),
          centerHit: input.hit(region, false, point),
        },
        pointer: [input.x, input.y],
        warp: input.warp && { ...input.warp },
        // These are possible earlier candidates, not proof that they consume a click.
        precedingHits: input
          .ordered()
          .slice(0, input.ordered().indexOf(region))
          .filter((value) => value.enabled && value.mask & 2 && input.hit(value, true, point))
          .slice(0, 16)
          .map((value) => ({
            owner: value.owner,
            enabled: value.enabled,
            mask: value.mask,
            priority: value.priority,
          })),
      };
      emit({ kind: 'before', ...result });
      return result;
    },
    { key, owner, prefix },
  );
  await info.attach('touch-before.json', {
    body: JSON.stringify(observation),
    contentType: 'application/json',
  });

  const slot = '__ordinaryTouchCheckpointBytes';
  const metadata = await page.evaluate(async (slot) => {
    const engine = window.catSystem2,
      { serializeCheckpoint } = await import('/src/checkpoint.mjs'),
      frame = engine.world.frame,
      saved = await engine.snapshot(),
      bytes = await serializeCheckpoint(saved, engine.checkpointLimit);
    if (Object.hasOwn(window, slot))
      throw new Error('Touch checkpoint transfer slot already exists');
    window[slot] = bytes;
    return {
      bytes: bytes.byteLength,
      frame,
      afterFrame: engine.world.frame,
      profile: engine.world.profile,
      source: engine.identity,
      sha256: new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).toHex(),
    };
  }, slot);
  const path = info.outputPath('touch-before.cs2web'),
    digest = createHash('sha256');
  let file, failure;
  try {
    file = await open(path, 'wx');
    for (let offset = 0; offset < metadata.bytes; offset += 65536) {
      const values = await page.evaluate(
        ({ slot, offset }) => Array.from(window[slot].subarray(offset, offset + 65536)),
        { slot, offset },
      );
      if (
        values.length !== Math.min(65536, metadata.bytes - offset) ||
        values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
      )
        throw new Error('Touch checkpoint byte transfer differs');
      const bytes = Buffer.from(values);
      digest.update(bytes);
      await file.writeFile(bytes);
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const cleanup of [
      () => file?.close(),
      () =>
        page.evaluate((slot) => {
          delete window[slot];
        }, slot),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure) throw failure;
  const sha256 = digest.digest('hex');
  if (sha256 !== metadata.sha256) throw new Error('Touch checkpoint browser/file digest differs');
  await info.attach('touch-before.cs2web', { path, contentType: 'application/octet-stream' });
  await info.attach('touch-checkpoint.json', {
    body: JSON.stringify({
      ...metadata,
      sha256,
      productionCodec: true,
      replayedFrames: metadata.afterFrame - metadata.frame,
      purpose:
        'finite restore at the real point before the existing touch gesture; no Game pass claim',
    }),
    contentType: 'application/json',
  });
}
