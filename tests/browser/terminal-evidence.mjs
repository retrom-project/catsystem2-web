// SPDX-License-Identifier: MPL-2.0
// Read-only teardown evidence. Values stay in binary attachments, never stdout.
import { transferCheckpointBytes } from './touch-evidence.mjs';

export async function captureTerminalState(page, info) {
  const result = {
      checkpoint: { complete: false },
      userdata: { complete: false, records: [] },
      errors: [],
    },
    slot = '__ordinaryTerminalBytes',
    stateSlot = '__ordinaryTerminalStores',
    failure = (stage, error) => result.errors.push({ stage, type: error?.name ?? typeof error });
  if (page.isClosed()) result.errors.push({ stage: 'page', type: 'Unavailable' });
  else {
    try {
      const metadata = await page.evaluate(async (slot) => {
        const engine = window.catSystem2;
        if (!engine?.world || engine.world.closed)
          throw new Error('Terminal checkpoint requires the live ordinary Core');
        if (Object.hasOwn(window, slot)) throw new Error('Terminal transfer slot is occupied');
        const { serializeCheckpoint } = await import('/src/checkpoint.mjs'),
          frame = engine.world.frame,
          saved = await engine.snapshot(),
          bytes = await serializeCheckpoint(saved, engine.checkpointLimit);
        if (engine.world.frame !== frame) throw new Error('Terminal capture advanced the World');
        window[slot] = bytes;
        return {
          bytes: bytes.length,
          frame,
          afterFrame: engine.world.frame,
          profile: engine.world.profile,
          source: engine.identity,
          sha256: new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).toHex(),
        };
      }, slot);
      const path = info.outputPath('terminal.cs2web'),
        transfer = await transferCheckpointBytes(page, { slot, path, ...metadata });
      await info.attach('terminal.cs2web', { path, contentType: 'application/octet-stream' });
      result.checkpoint = { ...metadata, ...transfer, complete: true, productionCodec: true };
    } catch (error) {
      failure('checkpoint', error);
    }
    try {
      const prepared = await page.evaluate(async (stateSlot) => {
        const engine = window.catSystem2;
        if (!engine?.identity || Object.hasOwn(window, stateSlot))
          throw new Error('Terminal storage owner is unavailable');
        const stores = [
            ['saves', engine.saves],
            ['native-files', engine.nativeStorage?.store],
            ['native-platform', engine.nativeStorage?.platformStore],
          ],
          databases = new Map(),
          beforeCloseFrame = engine.world?.frame ?? null;
        for (const [kind, store] of stores) {
          const namespace = kind === 'saves' ? engine.identity : `${engine.identity}:${kind}`;
          if (!store?.db || store.namespace !== namespace)
            throw new Error('Terminal storage namespace differs');
          if (!databases.has(store.database))
            databases.set(store.database, { name: store.database, stores: [], keys: [], db: null });
          databases.get(store.database).stores.push({ kind, namespace: store.namespace });
        }
        const close = { complete: false, alreadyDisposed: Boolean(engine.disposed) };
        try {
          if (engine.disposed) throw new Error('Core was already disposed before observation');
          await engine.dispose();
          close.complete = true;
        } catch (error) {
          const types = (value) => [
            value?.name ?? typeof value,
            ...[...(value?.errors ?? [])].flatMap(types),
          ];
          close.errorTypes = types(error);
        }
        close.worldClosed = engine.world?.closed ?? null;
        close.audioState = engine.audio?.context.state ?? null;
        const groups = [...databases.values()],
          request = (db, action) =>
            new Promise((resolve, reject) => {
              const transaction = db.transaction('saves', 'readonly'),
                operation = action(transaction.objectStore('saves'));
              transaction.oncomplete = () => resolve(operation.result);
              transaction.onabort = () => reject(transaction.error || operation.error);
              transaction.onerror = () => reject(transaction.error || operation.error);
            }),
          selected = (group, key) =>
            typeof key === 'string' &&
            group.stores.some(({ namespace }) => key.startsWith(namespace + ':'));
        const entries = [];
        try {
          for (const [database, group] of groups.entries()) {
            group.db = await new Promise((resolve, reject) => {
              const opening = indexedDB.open(group.name);
              opening.onupgradeneeded = () => {
                opening.transaction.abort();
                reject(new Error('Terminal userdata database does not exist'));
              };
              opening.onsuccess = () => resolve(opening.result);
              opening.onerror = () => reject(opening.error);
            });
            const keys = await request(group.db, (store) => store.getAllKeys());
            group.keys = keys.filter((key) => selected(group, key));
            for (const key of group.keys) entries.push({ database, key });
          }
        } catch (error) {
          for (const group of groups) group.db?.close();
          throw error;
        }
        window[stateSlot] = { groups, entries, selected, request };
        return {
          source: engine.identity,
          frame: engine.world?.frame ?? null,
          beforeCloseFrame,
          close,
          phase: 'after-normal-Core-dispose',
          databases: groups.length,
          recordCount: entries.length,
          scope:
            'current Core SaveStore, native-files and native-platform committed IndexedDB records',
          persistence:
            'existing Core.dispose/World.close flush and callbacks completed before readonly export',
          storageUnit: 'one complete IndexedDB record per production-codec attachment',
        };
      }, stateSlot);
      result.userdata = { ...result.userdata, ...prepared };
      if (!prepared.close.complete)
        result.errors.push({ stage: 'normal-close', types: prepared.close.errorTypes });
      for (let index = 0; index < prepared.recordCount; index++) {
        const metadata = await page.evaluate(
          async ({ stateSlot, slot, index }) => {
            const state = window[stateSlot],
              entry = state.entries[index],
              group = state.groups[entry.database],
              record = await state.request(group.db, (store) => store.get(entry.key)),
              binding = group.stores.find((store) => store.namespace === record?.namespace);
            if (!binding || record.key !== entry.key || Object.hasOwn(window, slot))
              throw new Error('Terminal userdata changed or belongs to another namespace');
            const { serializeCheckpoint } = await import('/src/checkpoint.mjs'),
              bytes = await serializeCheckpoint(record);
            window[slot] = bytes;
            return {
              index,
              store: binding.kind,
              bytes: bytes.length,
              sha256: new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).toHex(),
            };
          },
          { stateSlot, slot, index },
        );
        const name = `terminal-userdata-${String(index).padStart(4, '0')}.cs2web`,
          path = info.outputPath(name),
          transfer = await transferCheckpointBytes(page, { slot, path, ...metadata });
        await info.attach(name, { path, contentType: 'application/octet-stream' });
        result.userdata.records.push({ ...metadata, ...transfer, file: name });
      }
      const stable = await page.evaluate(async (stateSlot) => {
        const state = window[stateSlot];
        for (const group of state.groups) {
          const keys = await state.request(group.db, (store) => store.getAllKeys()),
            current = keys.filter((key) => state.selected(group, key));
          if (
            current.length !== group.keys.length ||
            current.some((key, index) => key !== group.keys[index])
          )
            return false;
        }
        return true;
      }, stateSlot);
      if (!stable) throw new Error('Terminal userdata key set changed during export');
      result.userdata.complete = true;
      result.userdata.keySetStable = true;
      result.userdata.atomicTransactionAcrossAttachments = false;
    } catch (error) {
      failure('userdata', error);
    } finally {
      try {
        await page.evaluate(
          ({ slot, stateSlot }) => {
            for (const group of window[stateSlot]?.groups ?? []) group.db?.close();
            delete window[slot];
            delete window[stateSlot];
          },
          { slot, stateSlot },
        );
      } catch (error) {
        failure('transfer-cleanup', error);
      }
    }
  }
  result.complete =
    result.checkpoint.complete && result.userdata.complete && result.errors.length === 0;
  await info.attach('terminal-evidence.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  if (!result.complete && (!info.status || info.status === info.expectedStatus))
    throw new Error('Terminal evidence is incomplete; see the separate artifact');
  return result;
}
