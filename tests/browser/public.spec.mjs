// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { kcsProgram } from '../helpers.mjs';

const sdkProfile = 'sdk-4.01-engine-2.6.1.74',
  gameProfile = 'nekopara-vol3-engine-2.6.1.76';

async function gameApplication(executable) {
  const directory = dirname(executable);
  // The fixture may mount the original tree or its separated analysis PE.
  for (const path of [
    resolve(directory, 'config/startup.xml'),
    resolve(directory, '../../original/config/startup.xml'),
  ]) {
    let startup;
    try {
      startup = await readFile(path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    const app = /<APP>([\s\S]*?)<\/APP>/i.exec(startup)?.[1],
      identity = /<v_code>[^<]+<\/v_code>/i.exec(app ?? '')?.[0];
    if (!identity) throw new Error(`Original game APP identity is missing in ${path}`);
    return `<APP>${identity}</APP>`;
  }
  throw new Error('The original game startup.xml is required alongside the frozen engine fixture');
}

async function mountOriginalEngines(page, profiles) {
  const { CATSYSTEM2_SDK_EXE, CATSYSTEM2_ENGINE_EXE, CATSYSTEM2_EMOTE_DLL } = process.env;
  test.skip(
    (profiles.includes(sdkProfile) && !CATSYSTEM2_SDK_EXE) ||
      (profiles.includes(gameProfile) && (!CATSYSTEM2_ENGINE_EXE || !CATSYSTEM2_EMOTE_DLL)),
    'Mount the frozen CatSystem2 EXE and its original E-mote driver for the game profile',
  );
  test.setTimeout(180000);
  const assets = new Map(),
    fixtures = [];
  for (const profile of profiles) {
    const sdk = profile === sdkProfile,
      executable = sdk ? CATSYSTEM2_SDK_EXE : CATSYSTEM2_ENGINE_EXE,
      files = [[basename(executable), executable]];
    if (!sdk) files.push(['emotedriver.dll', CATSYSTEM2_EMOTE_DLL]);
    const mounted = files.map(([name, path]) => {
      const url = `/public-native-fixtures/${profile}/${encodeURIComponent(name)}`;
      assets.set(url, path);
      return [name, url];
    });
    fixtures.push({ profile, files: mounted, app: sdk ? '' : await gameApplication(executable) });
  }
  await page.route('**/public-native-fixtures/**', (route) => {
    const path = assets.get(new URL(route.request().url()).pathname);
    return route.fulfill(
      path ? { path, contentType: 'application/octet-stream' } : { status: 404 },
    );
  });
  await page.goto('/');
  await page.evaluate(async (fixtures) => {
    const { BlobFile } = await import('/src/files.mjs');
    window.publicNativeFixtures = new Map();
    for (const { profile, files, app } of fixtures) {
      const mounted = await Promise.all(
        files.map(async ([name, url]) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Could not mount original engine fixture ${name}`);
          return [name, new BlobFile(await response.blob())];
        }),
      );
      window.publicNativeFixtures.set(profile, { files: mounted, app });
    }
  }, fixtures);
}

test('native platform state persists in its own game namespace and rolls back failed writes', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { NativeFileStorage } = await import('/src/native/storage.mjs'),
      database = 'native-platform-' + crypto.randomUUID(),
      game = { read: async () => null, looseIndex: new Map() },
      stores = [],
      open = async (namespace) => {
        const storage = new NativeFileStorage(game, namespace, database);
        stores.push(storage);
        await storage.open();
        return storage;
      };
    try {
      const a = await open('authored-a'),
        bytes = Uint8Array.of(8, 7, 6);
      await a.writePlatform('windows-hkcu', bytes);
      bytes[0] = 99;
      await a.write('windows-hkcu', Uint8Array.of(1, 2, 3));
      const names = (await a.list()).map((x) => x.name),
        originalRequest = a.platformStore.request;
      a.platformStore.request = function (mode, action) {
        return originalRequest.call(this, mode, (store) => {
          const request = action(store);
          store.transaction.abort();
          return request;
        });
      };
      let aborted = false;
      try {
        await a.writePlatform('windows-hkcu', Uint8Array.of(9));
      } catch {
        aborted = true;
      }
      a.platformStore.request = originalRequest;
      const afterAbort = [...(await a.readPlatform('windows-hkcu'))];
      a.close();
      const reopened = await open('authored-a'),
        other = await open('authored-b'),
        saved = [...(await reopened.readPlatform('windows-hkcu'))],
        ordinary = [...(await reopened.readSaved('windows-hkcu'))],
        isolated = await other.readPlatform('windows-hkcu');
      await reopened.remove('windows-hkcu');
      return {
        names,
        aborted,
        afterAbort,
        saved,
        ordinary,
        isolated,
        afterFileDelete: [...(await reopened.readPlatform('windows-hkcu'))],
        remainingFiles: (await reopened.list()).length,
      };
    } finally {
      for (const storage of stores) storage.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(database);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
    }
  });
  expect(result).toEqual({
    names: ['windows-hkcu'],
    aborted: true,
    afterAbort: [8, 7, 6],
    saved: [8, 7, 6],
    ordinary: [1, 2, 3],
    isolated: null,
    afterFileDelete: [8, 7, 6],
    remainingFiles: 0,
  });
});
test('native persistent files retain metadata and namespaces, keep mounted sources intact, and roll back an aborted move transaction', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { NativeFileStorage } = await import('/src/native/storage.mjs'),
      database = `authored-native-files-${crypto.randomUUID()}`,
      original = Uint8Array.of(1, 2, 3),
      mounted = { modifiedMs: 123456, size: 3 },
      game = {
        looseIndex: new Map([['source.dat', mounted]]),
        read: async (name) => (name === 'source.dat' ? original.slice() : null),
        lookup: (name) => (name === 'source.dat' ? { file: mounted } : null),
      },
      a = new NativeFileStorage(game, 'game-a', database),
      b = new NativeFileStorage(game, 'game-b', database),
      fresh = new NativeFileStorage(game, 'game-a', database),
      checks = [],
      check = (value, label) => {
        if (!value) throw new Error(label);
        checks.push(label);
      },
      same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    try {
      await a.open();
      await b.open();
      check(
        (await a.readSaved('source.dat')) === null,
        'mounted files are outside the writable overlay',
      );
      check(same([...(await a.read('source.dat'))], [1, 2, 3]), 'mount is readable');
      check(
        await a.write('C:\\catsystem2-web\\Save\\..\\source.dat', Uint8Array.of(8, 9)),
        'virtual absolute path resolves inside the mount',
      );
      check(
        await a.setTimes('source.dat', { createdMs: 10, accessedMs: 20, modifiedMs: 30 }),
        'explicit file times are stored',
      );
      check(await a.setAttributes('source.dat', 1), 'read-only attributes are stored');
      check(
        (await a.write('source.dat', Uint8Array.of(7))) === false,
        'read-only prevents overwrite',
      );
      check((await a.remove('source.dat')) === false, 'read-only prevents deletion');
      check(
        await a.copy('source.dat', 'save/copied.dat', true),
        'read-only source permits copying',
      );
      const copy = await a.stat('save/copied.dat');
      check(
        copy.modifiedMs === 30 && copy.attributes === 1,
        'copy retains source modification time and attributes',
      );
      check(
        (await a.copy('source.dat', 'save/copied.dat', true)) === false,
        'copy refuses an existing target',
      );
      check(await a.setAttributes('source.dat', 0x80), 'attributes can be cleared');
      check(await a.move('source.dat', 'save/moved.dat'), 'move commits atomically');
      check(
        same(await a.stat('save/moved.dat'), {
          createdMs: 10,
          accessedMs: 20,
          modifiedMs: 30,
          attributes: 0x80,
        }),
        'move retains all file metadata',
      );
      check(
        same([...(await a.read('source.dat'))], [1, 2, 3]),
        'moving an overlay preserves the mounted source',
      );
      check(
        (await b.readSaved('save/moved.dat')) === null,
        'games have isolated writable namespaces',
      );
      check(same([...original], [1, 2, 3]), 'mounted source bytes remain intact');
      await a.write('save/transaction.dat', Uint8Array.of(4, 5, 6));
      const request = a.store.request.bind(a.store);
      a.store.request = (mode, action) =>
        request(mode, (store) => {
          const r = action(store);
          store.transaction.abort();
          return r;
        });
      let aborted = false;
      try {
        await a.move('save/transaction.dat', 'save/should-not-exist.dat');
      } catch {
        aborted = true;
      } finally {
        a.store.request = request;
      }
      check(aborted, 'a failed transaction is reported');
      check(
        (await a.readSaved('save/should-not-exist.dat')) === null,
        'an aborted move leaves no destination in memory',
      );
      check(
        same([...(await a.readSaved('save/transaction.dat'))], [4, 5, 6]),
        'an aborted move retains its source in memory',
      );
      await fresh.open();
      check(
        (await fresh.readSaved('save/should-not-exist.dat')) === null,
        'an aborted move leaves no destination on disk',
      );
      check(
        same([...(await fresh.readSaved('save/transaction.dat'))], [4, 5, 6]),
        'an aborted move retains its source on disk',
      );
      check(
        same(await fresh.stat('save/moved.dat'), {
          createdMs: 10,
          accessedMs: 20,
          modifiedMs: 30,
          attributes: 0x80,
        }),
        'a fresh instance reads persisted metadata',
      );
      const listing = await fresh.list(),
        space = await fresh.diskSpace();
      check(
        listing.some((f) => f.name === 'source.dat' && f.modifiedMs === 123456) &&
          listing.some((f) => f.name === 'save/moved.dat' && f.modifiedMs === 30),
        'enumeration combines loose mounts and writable files',
      );
      check(
        Number.isSafeInteger(space?.totalBytes) &&
          space.totalBytes > 0 &&
          space.availableBytes <= space.totalBytes,
        'quota is obtained from browser storage',
      );
      for (const invalid of [
        '../escaped',
        'C:\\elsewhere\\one.dat',
        'D:\\one.dat',
        '/absolute',
        'a\0b',
      ]) {
        let failed = false;
        try {
          await fresh.write(invalid, Uint8Array.of(1));
        } catch {
          failed = true;
        }
        check(failed, `reject escaped virtual path ${invalid}`);
      }
      return checks;
    } finally {
      a.close();
      b.close();
      fresh.close();
      await new Promise((resolve, reject) => {
        const r = indexedDB.deleteDatabase(database);
        r.onsuccess = resolve;
        r.onerror = () => reject(r.error);
      });
    }
  });
  expect(result.length).toBe(29);
});

test('browser window services apply native preferences, manage real save files, confirm exit and release the complete engine', async ({
  page,
}) => {
  await mountOriginalEngines(page, [sdkProfile]);
  const program = [...kcsProgram([[37, 1024], [43, 0x47, 4], [59]])];
  await page.evaluate(async (program) => {
    const { CatSystem2 } = await import('/src/engine.mjs'),
      { GameFiles, BlobFile } = await import('/src/files.mjs'),
      profile = 'sdk-4.01-engine-2.6.1.74',
      file = (bytes) => new BlobFile(new Blob([bytes])),
      xml =
        '<?xml version="1.0" encoding="Shift_JIS"?><document><SCREEN><width>32</width><height>24</height><v_width>32</v_width><v_height>24</v_height></SCREEN><INT><int00><name>kcs</name><ext>kcs</ext></int00></INT><SCRIPT><start>main.kcs</start></SCRIPT></document>',
      game = new GameFiles(
        new Map([
          ...window.publicNativeFixtures.get(profile).files,
          ['config/startup.xml', file(new TextEncoder().encode(xml))],
          ['main.kcs', file(Uint8Array.from(program))],
        ]),
      );
    await game.open();
    window.makeWindowEngine = async () => {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const context = new AudioContext();
      await context.resume();
      const engine = new CatSystem2({
        game,
        canvas,
        audioContext: context,
        nativeProfile: profile,
      });
      await engine.initialize();
      return engine;
    };
    window.windowEngine = await window.makeWindowEngine();
    window.windowResult = window.windowEngine.host.nativeWindowAction(
      { type: 'system-configuration' },
      window.windowEngine.world,
    );
  }, program);
  const dialog = page.locator('dialog.native-window');
  await expect(dialog).toBeVisible();
  await dialog.locator('[name=vol_master]').fill('37');
  await dialog.locator('[name=font]').fill('Arial');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.windowResult)).toBe(true);
  expect(
    await page.evaluate(() => ({
      volume: window.windowEngine.world.fesConfiguration.get('vol_master'),
      font: window.windowEngine.world.configuration.font.name,
    })),
  ).toEqual({ volume: 37, font: 'Arial' });
  await page.evaluate(async () => {
    const e = window.windowEngine;
    await e.world.storage.write('authored.sav', Uint8Array.of(1, 2, 3));
    window.windowResult = e.host.nativeWindowAction({ type: 'save-directory' }, e.world);
  });
  await expect(dialog.getByText('authored.sav', { exact: false })).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'imported.sav',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([4, 5, 6]),
  });
  await expect(dialog.getByText('imported.sav', { exact: false })).toBeVisible();
  expect(
    await page.evaluate(async () => [
      ...(await window.windowEngine.world.storage.readSaved('imported.sav')),
    ]),
  ).toEqual([4, 5, 6]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.windowResult);
  await page.evaluate(() => {
    const e = window.windowEngine;
    window.windowEvents = [];
    e.world.window.sendEvent = async (...args) => window.windowEvents.push(args);
    e.world.window.post(0x46c, 0, 2);
    window.windowResult = e.step();
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.windowResult);
  expect(await page.evaluate(() => window.windowEngine.disposed)).toBe(false);
  await page.evaluate(() => {
    window.windowEngine.world.window.post(0x10);
    window.windowResult = window.windowEngine.step();
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.evaluate(() => window.windowResult);
  expect(
    await page.evaluate(() => ({
      closed: window.windowEngine.world.closed,
      disposed: window.windowEngine.disposed,
      tasks: window.windowEngine.world.objects.objects.size,
      mode: window.windowEngine.mode,
      events: window.windowEvents,
    })),
  ).toEqual({
    closed: true,
    disposed: true,
    tasks: 0,
    mode: 'closed',
    events: [
      [158, 0, 1],
      [162, 0, 0, { taskType: 12 }],
    ],
  });
  expect(
    await page.evaluate(async () => {
      const e = await window.makeWindowEngine();
      try {
        return {
          volume: e.world.fesConfiguration.get('vol_master'),
          font: e.world.configuration.font.name,
          file: [...(await e.world.storage.readSaved('imported.sav'))],
        };
      } finally {
        await e.dispose();
      }
    }),
  ).toEqual({ volume: 37, font: 'Arial', file: [4, 5, 6] });
});

test('script message boxes display literal text and acknowledge OK and Escape', async ({
  page,
}) => {
  await page.goto('/');
  for (const dismiss of ['OK', 'Escape']) {
    const message = '確認 <img src=x>\r\n第二行',
      result = page.evaluate(async (message) => {
        const { BrowserNativeWindow } = await import('/src/native/window-browser.mjs');
        return new BrowserNativeWindow({}).perform({
          type: 'script-message-box',
          caption: 'system error',
          message,
        });
      }, message);
    result.catch(() => {});
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText('system error');
    expect(await dialog.locator('p').textContent()).toBe(message);
    await expect(dialog.locator('img')).toHaveCount(0);
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'OK' }).click();
    expect(await result).toBe(1);
    await expect(dialog).toHaveCount(0);
  }
});

test('FES dialog buttons produce the original Win32 result and Yes/No ignores Escape', async ({
  page,
}) => {
  await page.goto('/');
  for (const [buttons, action, expected] of [
    [1, 'OK', 1],
    [1, 'Escape', 2],
    [4, 'Yes', 6],
    [4, 'No', 7],
  ]) {
    const result = page.evaluate(async (buttons) => {
      const { BrowserNativeWindow } = await import('/src/native/window-browser.mjs');
      return new BrowserNativeWindow({}).perform({
        type: 'fes-message-box',
        buttons,
        caption: 'Save changes?',
        message: 'Keep the new state?',
      });
    }, buttons);
    result.catch(() => {});
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: buttons === 4 ? 'Yes' : 'OK', exact: true }),
    ).toBeFocused();
    if (buttons === 4) {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
    }
    if (action === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: action, exact: true }).click();
    expect(await result).toBe(expected);
    await expect(dialog).toHaveCount(0);
  }
});

test('native movie decoding, audible PCM, loop completion and fresh decoder restoration use real browser media', async ({
  page,
}) => {
  await page.route('**/authored-movie.webm', async (route) => {
    const bytes = await readFile(new URL('../fixtures/native-movie.webm', import.meta.url)),
      range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || ''),
      start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Number(range[2]) : bytes.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/webm',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
      },
      body: bytes.subarray(start, end + 1),
    });
  });
  await page.goto('/');
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'movie-proof';
    button.textContent = 'Play authored movie';
    document.body.append(button);
  });
  await page.evaluate(async () => {
    const { NativeMovies, nativeMovie } = await import('/src/native/movie.mjs'),
      { NativeHandles } = await import('/src/native/handles.mjs'),
      { BrowserNativeMovie } = await import('/src/native/movie-browser.mjs');
    window.runMovieProof = async () => {
      const context = new AudioContext();
      await context.resume();
      const container = document.createElement('div');
      container.style.cssText = 'position:relative;width:64px;height:48px';
      document.body.append(container);
      const create = () => {
          const handles = new NativeHandles(),
            sessions = [],
            movies = new NativeMovies({
              handles,
              dimensions: () => [64, 48],
              inputGate: async () => {},
              cursorGate() {},
              cursorVisible() {},
              create: async () => {
                const adapter = new BrowserNativeMovie({
                  game: {
                    movieSource: async () => ({ url: '/authored-movie.webm' }),
                  },
                  container,
                  width: 64,
                  height: 48,
                });
                sessions.push(adapter);
                return adapter;
              },
            }),
            call = (id, args) =>
              nativeMovie(id, args, {}, { id: 73 }, movies, () => 'authored.webm');
          return { handles, sessions, movies, call };
        },
        first = create(),
        fresh = create(),
        frame = (adapter) =>
          new Promise((resolve) => adapter.video.requestVideoFrameCallback(resolve)),
        pixels = (adapter) => {
          const canvas = new OffscreenCanvas(32, 24),
            ctx = canvas.getContext('2d');
          ctx.drawImage(adapter.video, 0, 0);
          return [...ctx.getImageData(0, 0, 32, 24).data];
        };
      try {
        const handle = (await first.call(0x109, [0])).value;
        first.movies.activate();
        const initiallyHidden = first.sessions[0].video.hidden;
        await first.call(0x314, [handle, 8, 4, 32, 24]);
        const firstFrame = frame(first.sessions[0]);
        await first.call(0x10a, [handle, 2]);
        await firstFrame;
        const source = context.createMediaElementSource(first.sessions[0].video),
          analyser = context.createAnalyser();
        source.connect(analyser);
        analyser.connect(context.destination);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const waveform = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(waveform);
        const audioPeak = Math.max(...waveform.map(Math.abs)),
          before = pixels(first.sessions[0]),
          geometry = ['left', 'top', 'width', 'height'].map(
            (key) => first.sessions[0].video.style[key],
          ),
          movieState = first.movies.snapshot(),
          handleState = first.handles.snapshot(),
          position = first.movies.get(handle).position;
        fresh.handles.restore(structuredClone(handleState));
        await fresh.movies.restore(structuredClone(movieState));
        const deferred = fresh.sessions[0].video.paused && fresh.sessions[0].video.hidden,
          seekPosition = fresh.sessions[0].position();
        await first.movies.close();
        source.disconnect();
        analyser.disconnect();
        const resumedFrame = frame(fresh.sessions[0]);
        fresh.movies.activate();
        await resumedFrame;
        const restored = pixels(fresh.sessions[0]);
        await new Promise((resolve, reject) => {
          const start = performance.now(),
            check = () => {
              if (!fresh.movies.get(handle).running) return resolve();
              if (performance.now() - start > 5000)
                return reject(new Error('Movie repeats did not finish'));
              setTimeout(check, 20);
            };
          check();
        });
        return {
          initiallyHidden,
          geometry,
          audioPeak,
          before,
          restored,
          deferred,
          position: String(position),
          seekPosition: String(seekPosition),
          repeat: fresh.movies.get(handle).repeat,
          running: fresh.movies.get(handle).running,
          videoNodes: container.querySelectorAll('video').length,
        };
      } finally {
        await first.movies.close();
        await fresh.movies.close();
        await context.close();
        container.remove();
      }
    };
    document.getElementById('movie-proof').addEventListener('click', () => {
      window.movieProof = window.runMovieProof().then(
        (result) => ({ result }),
        (error) => ({ error: error.stack }),
      );
    });
  });
  await page.click('#movie-proof');
  const { result, error } = await page.evaluate(() => window.movieProof);
  expect(error).toBeUndefined();
  expect(result.initiallyHidden).toBe(true);
  expect(result.deferred).toBe(true);
  expect(result.audioPeak).toBeGreaterThan(0.01);
  expect(result.geometry).toEqual(['12.5%', '8.33333%', '50%', '50%']);
  expect(Number(result.position)).toBeGreaterThan(0);
  expect(Math.abs(Number(result.position) - Number(result.seekPosition))).toBeLessThan(20000);
  expect(result.before).toEqual(result.restored);
  expect(result.before[0]).toBeGreaterThan(240);
  expect(result.before[2]).toBeLessThan(10);
  expect(result.before[24 * 4 + 2]).toBeGreaterThan(240);
  expect(result.repeat).toBe(0);
  expect(result.running).toBe(false);
  expect(result.videoNodes).toBe(1);
});

test('full native movie calls preserve view gates and active video across a fresh CatSystem2 world', async ({
  page,
}) => {
  await mountOriginalEngines(page, [sdkProfile, gameProfile]);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const program = [
      ...kcsProgram(
        [
          [37, 512],
          [43, 0x109, 4],
          [21, [0x13, 16], [0x63, 0]],
          [60],
          [37, [0x13, 16]],
          [37, 2],
          [43, 0x10a, 8],
          [60],
          [43, 0x41, 0],
          [43, 0x41, 0],
          [59],
        ],
        [[512, 'authored']],
      ),
    ],
    media = [...(await readFile(new URL('../fixtures/native-movie.webm', import.meta.url)))];
  const results = await page.evaluate(
    async ({ program, media }) => {
      const { CatSystem2 } = await import('/src/engine.mjs'),
        { GameFiles, BlobFile } = await import('/src/files.mjs'),
        { serializeCheckpoint, deserializeCheckpoint } = await import('/src/checkpoint.mjs'),
        results = [];
      for (const [profile, fixture] of window.publicNativeFixtures) {
        const file = (bytes) => new BlobFile(new Blob([bytes])),
          xml =
            '<?xml version="1.0" encoding="' +
            (profile.startsWith('sdk-') ? 'Shift_JIS' : 'UTF-8') +
            '"?><document>' +
            fixture.app +
            '<SCREEN><width>32</width><height>24</height><v_width>32</v_width><v_height>24</v_height></SCREEN><INT><int00><name>kcs</name><ext>kcs</ext></int00><int01><name>movie</name><ext>webm</ext></int01></INT><SCRIPT><start>main.kcs</start></SCRIPT></document>',
          game = new GameFiles(
            new Map([
              ...fixture.files,
              ['config/startup.xml', file(new TextEncoder().encode(xml))],
              ['main.kcs', file(Uint8Array.from(program))],
              ['authored.webm', file(Uint8Array.from(media))],
              ['profile.txt', file(new TextEncoder().encode(profile))],
            ]),
          );
        await game.open();
        const container = document.createElement('div'),
          canvas = document.createElement('canvas'),
          video = document.createElement('video');
        video.hidden = true;
        container.append(canvas, video);
        document.body.append(container);
        const audioContext = new AudioContext();
        await audioContext.resume();
        const engine = new CatSystem2({
          game,
          canvas,
          video,
          audioContext,
          nativeProfile: profile,
        });
        try {
          await engine.initialize();
          const task = engine.world.main,
            handle = task.machine.load(16),
            session = engine.world.movies.session(handle),
            call = (id, args) =>
              engine.world.runtime.native(
                'main',
                id,
                args,
                engine.world.main.machine,
                engine.world.main,
                engine.world.runtime.scheduler,
              );
          await new Promise((resolve) => session.video.requestVideoFrameCallback(resolve));
          const initial = {
              cursor: engine.world.graphics.cursorAllowed,
              gate: engine.world.movies.renderGate,
              prepared: engine.world.movies.get(handle).prepared,
              running: (await call(0x10d, [handle])).value,
            },
            render = engine.stageRenderer.render.bind(engine.stageRenderer);
          let normalRenders = 0;
          engine.stageRenderer.render = (...args) => {
            normalRenders++;
            return render(...args);
          };
          await engine.render();
          const blockedRenders = normalRenders;
          await call(0x3e5, [handle, 1]);
          await engine.render();
          const openGateRenders = normalRenders,
            openCursor = engine.world.graphics.cursorAllowed;
          await call(0x3e5, [handle, 0]);
          const saved = await deserializeCheckpoint(
              await serializeCheckpoint(await engine.snapshot()),
            ),
            old = engine.world;
          await engine.restore(saved);
          const restored = {
            fresh: old !== engine.world,
            oldClosed: old.closed,
            cursor: engine.world.graphics.cursorAllowed,
            gate: engine.world.movies.renderGate,
            running: (await call(0x10d, [handle])).value,
            visibleVideos: [...container.querySelectorAll('video')].filter((v) => !v.hidden).length,
          };
          await call(0x10c, [handle]);
          const closed = {
            cursor: engine.world.graphics.cursorAllowed,
            gate: engine.world.movies.renderGate,
            movies: engine.world.movies.sessions.size,
            visibleVideos: [...container.querySelectorAll('video')].filter((v) => !v.hidden).length,
          };
          results.push({ initial, blockedRenders, openGateRenders, openCursor, restored, closed });
        } finally {
          await engine.dispose();
          if (audioContext.state !== 'closed') await audioContext.close();
          container.remove();
        }
      }
      return results;
    },
    { program, media },
  );
  for (const result of results) {
    expect(result.initial).toEqual({ cursor: 0, gate: 1, prepared: true, running: 1 });
    expect(result.blockedRenders).toBe(0);
    expect(result.openGateRenders).toBe(1);
    expect(result.openCursor).toBe(1);
    expect(result.restored).toEqual({
      fresh: true,
      oldClosed: true,
      cursor: 0,
      gate: 1,
      running: 1,
      visibleVideos: 1,
    });
    expect(result.closed).toEqual({ cursor: 1, gate: 0, movies: 0, visibleVideos: 0 });
  }
});

test('empty native bitmap contexts preserve zero dimensions and compose no pixels', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { NativeImages } = await import('/src/native/image.mjs'),
      { NativeHandles } = await import('/src/native/handles.mjs'),
      { CanvasRenderer } = await import('/src/render/canvas.mjs'),
      world = { runtime: { handles: new NativeHandles() }, images: {} },
      images = new NativeImages(world),
      handle = images.create(0, 0, 73),
      bitmap = images.get(handle),
      context = await bitmap.context();
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 9, 9);
    bitmap.commitCanvas();
    const frame = await bitmap.frame(),
      canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const renderer = new CanvasRenderer(canvas, { frame: async () => frame });
    try {
      renderer.begin();
      renderer.present();
      const before = [...canvas.getContext('2d').getImageData(0, 0, 2, 2).data];
      const emptyCanvas = renderer.frameCanvas(frame);
      await renderer.image('authored-empty', 0, 0, 0);
      renderer.present();
      return {
        bitmap: [bitmap.width, bitmap.height, frame.rgba.length],
        nativeCanvas: [context.canvas.width, context.canvas.height],
        rendererCanvas: [emptyCanvas.width, emptyCanvas.height],
        before,
        after: [...canvas.getContext('2d').getImageData(0, 0, 2, 2).data],
      };
    } finally {
      images.release(handle);
      renderer.dispose();
    }
  });
  expect(result.bitmap).toEqual([0, 0, 0]);
  expect(result.nativeCanvas).toEqual([0, 0]);
  expect(result.rendererCanvas).toEqual([0, 0]);
  expect(result.after).toEqual(result.before);
});

test('native cursor raw pixels, hotspot, visibility, movement and fresh GPU restoration reach the composed frame', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { NativeGraphics } = await import('/src/native/graphics.mjs'),
      { NativeHandles } = await import('/src/native/handles.mjs'),
      { CanvasRenderer } = await import('/src/render/canvas.mjs'),
      { StageRenderer } = await import('/src/render/stage.mjs'),
      frame = {
        width: 2,
        height: 2,
        canvasWidth: 20,
        canvasHeight: 30,
        offsetX: 8,
        offsetY: 9,
        baseX: 10,
        baseY: 11,
        rgba: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255),
      },
      create = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 6;
        canvas.height = 4;
        const world = {
            game: { width: 6, height: 4 },
            host: {},
            input: { x: 3, y: 2 },
            runtime: { handles: new NativeHandles() },
            images: { load: async () => ({ frame: () => frame, decode: async () => {} }) },
          },
          graphics = new NativeGraphics(world),
          renderer = new CanvasRenderer(canvas, world.images),
          stage = new StageRenderer(renderer, null);
        graphics.cursor.state.backend = 'software';
        return { world, graphics, renderer, stage, canvas };
      },
      first = create(),
      fresh = create(),
      render = async (owner) => {
        await owner.stage.render(owner.graphics.stage, null);
        owner.renderer.present();
        return [...owner.canvas.getContext('2d').getImageData(0, 0, 6, 4).data];
      };
    try {
      await first.graphics.cursor.setImage('authored', 1, 1);
      const before = await render(first),
        handles = first.world.runtime.handles.snapshot(),
        graphics = first.graphics.snapshot();
      first.world.input.x = 1;
      first.world.input.y = 1;
      const moved = await render(first);
      first.graphics.cursor.setVisible(false);
      const hidden = await render(first);
      fresh.world.runtime.handles.restore(structuredClone(handles));
      fresh.graphics.restore(structuredClone(graphics));
      const restored = await render(fresh);
      return { before, moved, hidden, restored };
    } finally {
      await first.graphics.cursor.close();
      await fresh.graphics.cursor.close();
      first.stage.dispose();
      fresh.stage.dispose();
    }
  });
  const expected = (left, top) => {
      const rgba = new Uint8Array(6 * 4 * 4);
      for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 255, 255],
      ].forEach((pixel, i) => rgba.set(pixel, ((top + (i >> 1)) * 6 + left + (i % 2)) * 4));
      return [...rgba];
    },
    black = new Uint8Array(6 * 4 * 4);
  for (let at = 3; at < black.length; at += 4) black[at] = 255;
  expect(result.before).toEqual(expected(2, 1));
  expect(result.moved).toEqual(expected(0, 0));
  expect(result.hidden).toEqual([...black]);
  expect(result.restored).toEqual(result.before);
});

test('VRAM page updates reach existing GPU textures, release drops ownership and restore recreates pixels', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      { NativeTexturePages, negotiateNativeTextureLayout } = await import(
        '/src/native/texture-layout.mjs'
      ),
      gpu = new ParticlesGL(2, 2),
      layout = negotiateNativeTextureLayout({
        size: [2, 2],
        grid: [1, 1],
        areas: [[0, 0, 1, 1]],
        bppY: [0, 1],
        bpp: 32,
      }),
      pages = new NativeTexturePages(layout, {
        release: (frame) => gpu.releaseTextureFrame(frame),
      }),
      point = (x, y, u, v) => ({ x, y, z: 0.5, w: 1, color: 0xffffffff, u, v }),
      a = point(-0.5, -0.5, 0, 0),
      b = point(1.5, -0.5, 1, 0),
      c = point(1.5, 1.5, 1, 1),
      d = point(-0.5, 1.5, 0, 1),
      geometry = [{ vertices: [a, b, c] }, { vertices: [a, d, c] }],
      render = (frame) => {
        gpu.render(geometry, frame, 0xff000000);
        return [...gpu.pixels()];
      },
      bitmap = (rgba) => ({
        width: 2,
        height: 2,
        frame: async () => ({ width: 2, height: 2, rgba: Uint8Array.from(rgba) }),
      });
    let restored;
    try {
      const original = await pages.frame(0);
      await pages.upload(bitmap(new Array(4).fill([255, 0, 0, 255]).flat()));
      const first = render(original),
        texture = gpu.textures.get(original);
      await pages.upload(
        bitmap([0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 0, 255, 255]),
      );
      const second = render(await pages.frame(0)),
        same = texture === gpu.textures.get(original),
        saved = pages.snapshot();
      pages.releaseRectangle(0, 0, 1, 1);
      const released = !gpu.textures.has(original);
      pages.allocateMissing();
      const cleared = render(await pages.frame(0));
      restored = new NativeTexturePages(layout, {
        release: (frame) => gpu.releaseTextureFrame(frame),
      });
      restored.restore(saved);
      return { first, second, same, released, cleared, restored: render(await restored.frame(0)) };
    } finally {
      pages.close();
      restored?.close();
      gpu.close();
    }
  });
  expect(result.first).toEqual(new Array(4).fill([255, 0, 0, 255]).flat());
  expect(result.second).toEqual([
    0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 0, 255, 255,
  ]);
  expect(result.same).toBe(true);
  expect(result.released).toBe(true);
  expect(result.cleared).toEqual(new Array(4).fill([0, 0, 0, 255]).flat());
  expect(result.restored).toEqual(result.second);
});

test('ordinary native planes draw divided VRAM pages with their own depth and released-page fallback', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { NativeWorld } = await import('/src/native/world.mjs'),
      { NativeConfiguration } = await import('/src/native/config.mjs'),
      { ParticlesGL } = await import('/src/render/particles-gl.mjs'),
      { MotionLibrary } = await import('/src/motion/library.mjs'),
      { ParticleRandom } = await import('/src/ppi/random.mjs'),
      { floatBits } = await import('/src/kcs.mjs'),
      profile = 'nekopara-vol3-engine-2.6.1.76',
      configuration = new NativeConfiguration({ profile }),
      gpu = new ParticlesGL(4, 2),
      texture = configuration.fields.texture;
    texture.size.set([2, 2]);
    texture.grid.set([2, 1]);
    texture.areas[0].set([0, 0, 2, 1]);
    texture.bppY.set([0, 1]);
    texture.bpp = 16;
    const game = { width: 4, height: 2, read: async () => null },
      random = new ParticleRandom(),
      world = new NativeWorld({
        game,
        images: {},
        host: { nativeGPU: () => gpu },
        profile,
        configuration,
        random,
        motionLibrary: new MotionLibrary(game, { profile, random }),
        storage: { read: async () => null, write: async () => true },
      });
    try {
      const root = await world.objects.create({ kind: 1, parent: null }),
        id = await world.objects.create({ kind: 2, parent: root }),
        task = world.graphics.get(id),
        render = async () => {
          gpu.beginFrame(0xff000000);
          await task.drawGPU(gpu);
          gpu.endFrame();
          return [...gpu.pixels()];
        };
      task.makeGraph({ type: 1, x: 0, y: 0, z: 0, width: 4, height: 2, vram: true });
      await world.graphics.fill(0, 0, 2, 2, 0xff123456);
      await world.graphics.fill(2, 0, 2, 2, 0xffabcdef);
      const first = await render();
      world.graphics.texturePages.releaseRectangle(2, 0, 1, 1);
      const released = await render();
      world.graphics.texturePages.allocateMissing();
      const cleared = await render();
      await world.graphics.fill(2, 0, 2, 2, 0xff654321);
      const changed = await render(),
        packet = { load: (at) => floatBits([2, 0, 0][at / 4]) };
      await task.message([root, 51, 1, 0], { payload: packet, nativeSenderWorldID: root });
      const moved = await render();
      return { first, released, cleared, changed, moved };
    } finally {
      await world.close({ flushFiles: false });
      gpu.close();
    }
  });
  const row = (a, b) => [...a, ...a, ...b, ...b],
    repeat = (r) => [...r, ...r];
  expect(result.first).toEqual(repeat(row([17, 51, 85, 255], [170, 204, 238, 255])));
  expect(result.released).toEqual(repeat(row([17, 51, 85, 255], [255, 255, 255, 255])));
  expect(result.cleared).toEqual(repeat(row([17, 51, 85, 255], [0, 0, 0, 255])));
  expect(result.changed).toEqual(repeat(row([17, 51, 85, 255], [102, 68, 34, 255])));
  expect(result.moved).toEqual(repeat(row([102, 68, 34, 255], [0, 0, 0, 255])));
});

test('the pinned native zlib library loads in the browser and preserves original partial output', async ({
  page,
}) => {
  await page.goto('/');
  const golden = JSON.parse(
    await readFile(new URL('../fixtures/native-zlib-golden.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (cases) => {
    const { nativeInflate } = await import('/src/native/zlib.mjs');
    for (const row of cases) {
      const input = Uint8Array.from(atob(row.input), (c) => c.charCodeAt(0)),
        expected = Uint8Array.from(atob(row.output), (c) => c.charCodeAt(0)),
        actual = await nativeInflate(input, new Uint8Array(row.capacity).fill(row.fill));
      if (
        actual.result !== row.result ||
        actual.bytes.length !== expected.length ||
        !actual.bytes.every((value, i) => value === expected[i])
      )
        throw new Error(`Native zlib browser contract differs: ${row.name}`);
    }
    return cases.length;
  }, golden.cases);
  expect(result).toBe(golden.cases.length);
});

test('native engine checkpoints restore through a fresh world, reject a broken candidate atomically, and persist original preferences', async ({
  page,
}) => {
  await mountOriginalEngines(page, [gameProfile]);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const program = [
    ...kcsProgram(
      [
        [37, 64],
        [43, 1, 4],
        [37, 16],
        [43, 0xd1, 4],
        [37, 2],
        [37, 71],
        [43, 0xd3, 8],
        [43, 0x41, 0],
        [37, 2],
        [37, 72],
        [43, 0xd3, 8],
        [43, 0x41, 0],
        [37, 2],
        [37, 73],
        [43, 0xd3, 8],
        [59],
      ],
      [[64, 'authored-boot']],
    ),
  ];
  const result = await page.evaluate(async (program) => {
    const { CatSystem2 } = await import('/src/engine.mjs'),
      { GameFiles, BlobFile } = await import('/src/files.mjs'),
      { serializeCheckpoint, deserializeCheckpoint } = await import('/src/checkpoint.mjs'),
      { NativeSoundPacket } = await import('/src/native/sound.mjs');
    const fixture = window.publicNativeFixtures.get('nekopara-vol3-engine-2.6.1.76'),
      xml =
        '<?xml version="1.0" encoding="UTF-8"?><document>' +
        fixture.app +
        '<SCREEN><width>32</width><height>32</height><v_width>32</v_width><v_height>32</v_height></SCREEN><SOUNDCONFIG>sound-options.xml</SOUNDCONFIG><INT><int00><name>kcs</name><ext>kcs</ext></int00><int01><name>config</name><ext>xml</ext></int01></INT><SCRIPT><start>main.kcs</start></SCRIPT></document>',
      soundXML =
        '<?xml version="1.0" encoding="UTF-8"?><document><MASTER><volume>80</volume><play>1</play><sysplay>1</sysplay><mute>0</mute></MASTER></document>',
      sampleRate = 8000,
      // The original device uses a static buffer for clips up to four seconds.
      samples = sampleRate * 5,
      bytes = new Uint8Array(44 + samples * 2),
      wav = new DataView(bytes.buffer);
    for (const [at, text] of [
      [0, 'RIFF'],
      [8, 'WAVE'],
      [12, 'fmt '],
      [36, 'data'],
    ])
      for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
    for (const [at, value] of [
      [4, bytes.length - 8],
      [16, 16],
      [24, sampleRate],
      [28, sampleRate * 2],
      [40, samples * 2],
    ])
      wav.setUint32(at, value, true);
    for (const [at, value] of [
      [20, 1],
      [22, 1],
      [32, 2],
      [34, 16],
    ])
      wav.setUint16(at, value, true);
    for (let i = 0; i < samples; i++)
      wav.setInt16(44 + i * 2, Math.sin((i * Math.PI) / 20) * 4096, true);
    const file = (bytes) => new BlobFile(new Blob([bytes])),
      game = new GameFiles(
        new Map([
          ...fixture.files,
          ['main.kcs', file(Uint8Array.from(program))],
          ['config/startup.xml', file(new TextEncoder().encode(xml))],
          ['sound-options.xml', file(new TextEncoder().encode(soundXML))],
          ['sound/tone.wav', file(bytes)],
        ]),
      );
    await game.open();
    const context = new AudioContext(),
      canvas = document.createElement('canvas'),
      engine = new CatSystem2({
        game,
        canvas,
        audioContext: context,
        nativeProfile: 'nekopara-vol3-engine-2.6.1.76',
      });
    let restarted, resumed;
    try {
      await engine.initialize();
      await engine.audio.unlock();
      const packet = new NativeSoundPacket([], 288),
        sound = engine.world.sound.primary();
      packet.store(0, 0);
      packet.writeString('sound/tone.wav', 12);
      packet.store(272, 1);
      const loaded = await sound.message([engine.world.main.id, 179, 0, 0], { payload: packet });
      await sound.message([engine.world.main.id, 182, 0, 0]);
      const state = await deserializeCheckpoint(await serializeCheckpoint(await engine.snapshot())),
        oldWorld = engine.world,
        oldAudio = engine.audio,
        oldRandom = engine.random.snapshot(),
        oldSource = oldAudio.channels.get('native:0').source,
        bad = structuredClone(state);
      bad.world.objects.objects.find((r) => r.kind === 11).kind = 0x7fffffff;
      bad.world.random.integer.words[0] = (bad.world.random.integer.words[0] + 1) >>> 0;
      let rejected = false;
      try {
        await engine.restore(bad);
      } catch (error) {
        rejected = /unavailable/.test(error.message);
      }
      const atomic =
        rejected &&
        engine.world === oldWorld &&
        engine.audio === oldAudio &&
        oldAudio.channels.get('native:0').source === oldSource &&
        oldAudio.channels.get('native:0').playing &&
        !oldWorld.stageRenderer.gpu.gl.isContextLost() &&
        JSON.stringify(engine.random.snapshot()) === JSON.stringify(oldRandom);
      await engine.step();
      const beforeRestore = engine.globals[2];
      await engine.restore(state);
      const restored = engine.globals[2],
        fresh = engine.world !== oldWorld && engine.audio !== oldAudio,
        oldReleased =
          oldWorld.objects.objects.size === 0 &&
          oldWorld.runtime.handles.records.size === 0 &&
          oldWorld.runtime.scheduler.tasks.size === 0 &&
          oldWorld.stageRenderer.gpu.gl.isContextLost() &&
          oldAudio.channels.size === 0,
        mediaPlaying =
          engine.audio.channels.get('native:0').playing &&
          !!engine.audio.channels.get('native:0').source;
      await engine.step();
      const continued = engine.globals[2];
      engine.world.fesConfiguration.set('vol_master', 25);
      engine.world.soundConfiguration.set('volume', 37, { by: 'master' });
      await engine.step();
      const preferences = await engine.nativeStorage.read('setup.xml'),
        dirty = engine.world.configurationDirty;
      await engine.dispose();
      restarted = new CatSystem2({
        game,
        canvas,
        audioContext: new AudioContext(),
        nativeProfile: 'nekopara-vol3-engine-2.6.1.76',
      });
      await restarted.initialize();
      resumed = new CatSystem2({
        game,
        canvas,
        audioContext: new AudioContext(),
        nativeProfile: 'nekopara-vol3-engine-2.6.1.76',
      });
      await resumed.initialize({ checkpoint: state });
      const resumedValue = resumed.globals[2],
        resumedBootLogs = resumed.nativeLog?.length ?? 0;
      await resumed.step();
      return {
        loaded,
        atomic,
        fresh,
        oldReleased,
        mediaPlaying,
        beforeRestore,
        restored,
        continued,
        preferencesHeader: new TextDecoder()
          .decode(preferences)
          .startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
        dirty,
        restartedVolume: restarted.world.fesConfiguration.get('vol_master'),
        restartedSoundVolume: restarted.world.soundConfiguration.get('volume', { by: 'master' }),
        resourceSoundVolume: new TextDecoder()
          .decode(await game.read('sound-options.xml'))
          .includes('<volume>80</volume>'),
        resumedValue,
        resumedContinued: resumed.globals[2],
        resumedBootLogs,
      };
    } finally {
      if (!engine.disposed) await engine.dispose();
      await restarted?.dispose();
      await resumed?.dispose();
    }
  }, program);
  expect(result).toEqual({
    loaded: 1,
    atomic: true,
    fresh: true,
    oldReleased: true,
    mediaPlaying: true,
    beforeRestore: 72,
    restored: 71,
    continued: 72,
    preferencesHeader: true,
    dirty: false,
    restartedVolume: 25,
    restartedSoundVolume: 37,
    resourceSoundVolume: true,
    resumedValue: 71,
    resumedContinued: 72,
    resumedBootLogs: 0,
  });
});
test('authored WAV audio decodes, pauses at its playhead and resumes through a frame-based end', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const result = await page.evaluate(async () => {
    const { AudioMixer } = await import('/src/audio.mjs');
    const sampleRate = 8000,
      samples = sampleRate * 2;
    const bytes = new Uint8Array(44 + samples * 2),
      wav = new DataView(bytes.buffer);
    for (const [at, text] of [
      [0, 'RIFF'],
      [8, 'WAVE'],
      [12, 'fmt '],
      [36, 'data'],
    ])
      for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
    for (const [at, value] of [
      [4, bytes.length - 8],
      [16, 16],
      [24, sampleRate],
      [28, sampleRate * 2],
      [40, samples * 2],
    ])
      wav.setUint32(at, value, true);
    for (const [at, value] of [
      [20, 1],
      [22, 1],
      [32, 2],
      [34, 16],
    ])
      wav.setUint16(at, value, true);
    for (let i = 0; i < samples; i++)
      wav.setInt16(44 + i * 2, Math.sin((i * 2 * Math.PI * 440) / sampleRate) * 4096, true);
    const context = new AudioContext(),
      mixer = new AudioMixer(
        { resolve: () => 'tone.wav', require: async () => bytes, read: async () => null },
        context,
      );
    await mixer.unlock();
    try {
      await mixer.command({ group: 'bgm', banks: [0], verb: 'play', args: ['tone'] });
      const until = async (predicate) => {
        const deadline = performance.now() + 3000;
        while (!predicate()) {
          if (performance.now() > deadline) throw new Error('Audio render clock did not advance');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
      await until(() => mixer.position(mixer.channels.get('bgm:0')) > 0.05);
      await mixer.command({ group: 'bgm', banks: [0], verb: 'pause' });
      const paused = mixer.position(mixer.channels.get('bgm:0'));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const held = mixer.position(mixer.channels.get('bgm:0'));
      await mixer.command({ group: 'bgm', banks: [0], verb: 'replay' });
      await until(() => mixer.position(mixer.channels.get('bgm:0')) > paused + 0.02);
      const resumed = mixer.position(mixer.channels.get('bgm:0'));
      await mixer.command({ group: 'bgm', banks: [0], verb: 'end', args: ['30'] });
      mixer.setFrame(15);
      await until(
        () => Math.abs(mixer.channels.get('bgm:0').gain.gain.value - 10 ** (-1000 / 2000)) < 0.005,
      );
      const halfway = mixer.channels.get('bgm:0').gain.gain.value;
      mixer.setFrame(30);
      return {
        state: context.state,
        paused,
        held,
        resumed,
        halfway,
        cleared: !mixer.channels.has('bgm:0'),
        complete: mixer.events.at(-1)?.reason,
      };
    } finally {
      await mixer.dispose();
    }
  });
  expect(result.state).toBe('running');
  expect(result.paused).toBeGreaterThan(0);
  expect(result.held).toBe(result.paused);
  expect(result.resumed).toBeGreaterThan(result.paused);
  expect(result.halfway).toBeCloseTo(10 ** (-1000 / 2000));
  expect(result.cleared).toBe(true);
  expect(result.complete).toBe('fade-ended');
});
test('the fixed x86 backend lazy-loads once and executes authored 32-bit code', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { loadUnicorn } = await import('/src/ppi/backend.mjs');
    const [uc, again] = await Promise.all([loadUnicorn(), loadUnicorn()]);
    const cpu = new uc.Unicorn(uc.ARCH_X86, uc.MODE_32);
    try {
      cpu.mem_map(0x1000, 0x1000, uc.PROT_ALL);
      cpu.mem_write(0x1000, [0xb8, 0x2a, 0, 0, 0, 0x83, 0xc0, 1]);
      cpu.emu_start(0x1000, 0x1008, 0, 10);
      return {
        same: uc === again,
        eax: cpu.reg_read_i32(uc.X86_REG_EAX),
        scripts: document.querySelectorAll('script[src$="unicorn_x86.js"]').length,
      };
    } finally {
      cpu.close();
    }
  });
  expect(result).toEqual({ same: true, eax: 43, scripts: 1 });
});
test('mask wipes reveal their two regions at different times and terminate on the new frame', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Transition } = await import('/src/render/transition.mjs'),
      old = new OffscreenCanvas(2, 1),
      canvas = new OffscreenCanvas(2, 1),
      ctx = canvas.getContext('2d');
    old.getContext('2d').fillStyle = '#ff0000';
    old.getContext('2d').fillRect(0, 0, 2, 1);
    const transition = new Transition(
      old,
      10,
      0,
      'rwipe',
      Promise.resolve({
        width: 2,
        height: 1,
        rgba: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
      }),
    );
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 2, 1);
    await transition.composite(ctx, 5);
    const middle = [...ctx.getImageData(0, 0, 2, 1).data];
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 2, 1);
    const done = await transition.composite(ctx, 10);
    return { middle, done, final: [...ctx.getImageData(0, 0, 2, 1).data] };
  });
  expect(result.middle).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
  expect(result.done).toBe(true);
  expect(result.final).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
});
test('WebGL draws BGRA atlases with alpha stencils across consecutive frames and releases its context', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { EmoteGL } = await import('/src/render/emote-gl.mjs'),
      gpu = new EmoteGL(32, 32);
    const model = {
      textures: [
        {
          width: 2,
          height: 2,
          pixels: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]),
        },
      ],
    };
    const icon = { width: 2, height: 2, left: 0, top: 0, originX: 0, originY: 0 };
    const list = {
      nodes: [
        { transform: [8, 0, 0, 8, 8, 8], parent: -1, box: [0, 0, 1, 1] },
        { transform: [0.5, 0, 0, 1, 0, 0], parent: 0, box: [0, 0, 1, 1] },
      ],
      masks: [[{ node: 1, texture: 0, icon, divisions: 1, opacity: 1, clips: [] }]],
      items: [{ node: 0, texture: 0, icon, divisions: 1, opacity: 1, clips: [0] }],
    };
    const gl = gpu.gl,
      left = new Uint8Array(4),
      right = new Uint8Array(4),
      frames = [];
    for (let i = 0; i < 3; i++) {
      gpu.render(model, list);
      gl.readPixels(10, 15, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left);
      gl.readPixels(20, 15, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);
      frames.push({ left: [...left], right: [...right], error: gl.getError() });
    }
    gpu.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { frames, disposed: gl.isContextLost() };
  });
  for (const frame of result.frames) {
    expect(frame.left).toEqual([255, 0, 0, 255]);
    expect(frame.right).toEqual([0, 0, 0, 0]);
    expect(frame.error).toBe(0);
  }
  expect(result.disposed).toBe(true);
});
test('IndexedDB saves survive a new store instance, remain scoped by content and cannot overwrite copy identity', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SaveStore } = await import('/src/saves.mjs'),
      first = new SaveStore('content-a', 'catsystem2-public-tests');
    await first.open();
    await first.put(0, { story: 'state', variables: { 1: 42 } }, { title: 'Slot 0' });
    first.close();
    const second = new SaveStore('content-a', 'catsystem2-public-tests');
    await second.open();
    const saved = second.get(0);
    await second.put(1, saved.data, saved);
    const copied = second.get(1);
    second.close();
    const other = new SaveStore('content-b', 'catsystem2-public-tests');
    await other.open();
    const count = other.records.size;
    other.close();
    return { data: saved.data, copyKey: copied.key, copySlot: copied.slot, otherCount: count };
  });
  expect(result.data.variables['1']).toBe(42);
  expect(result.copyKey).toBe('content-a:1');
  expect(result.copySlot).toBe(1);
  expect(result.otherCount).toBe(0);
});
test('HTTP files request exact byte ranges and reject a full-response server', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { HTTPFile } = await import('/src/files.mjs'),
      head = await fetch('/src/binary.mjs', { method: 'HEAD' });
    const file = new HTTPFile('/src/binary.mjs', Number(head.headers.get('content-length'))),
      bytes = await file.read(0, 7);
    const original = globalThis.fetch;
    let rejected = false;
    try {
      globalThis.fetch = async () => new Response(new Uint8Array(100));
      await file.read(0, 7);
    } catch {
      rejected = true;
    } finally {
      globalThis.fetch = original;
    }
    return { text: new TextDecoder().decode(bytes), rejected };
  });
  expect(result.text).toBe('// SPDX');
  expect(result.rejected).toBe(true);
});
test('native audio output preserves source-rate PCM, DirectSound pan attenuation and spatial Doppler', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { AudioMixer } = await import('/src/audio.mjs');
    const wave = (sine) => {
      const bytes = new Uint8Array(44 + 16000),
        view = new DataView(bytes.buffer);
      for (const [at, text] of [
        [0, 'RIFF'],
        [8, 'WAVEfmt '],
        [36, 'data'],
      ])
        bytes.set(new TextEncoder().encode(text), at);
      for (const [at, value] of [
        [4, bytes.length - 8],
        [16, 16],
        [24, 8000],
        [28, 16000],
        [40, 16000],
      ])
        view.setUint32(at, value, true);
      for (const [at, value] of [
        [20, 1],
        [22, 1],
        [32, 2],
        [34, 16],
      ])
        view.setUint16(at, value, true);
      for (let i = 0; i < 8000; i++)
        view.setInt16(44 + i * 2, sine ? Math.sin((i * Math.PI) / 20) * 16384 : 16384, true);
      return bytes;
    };
    const render = async (sound, sine = false) => {
      const context = new OfflineAudioContext(2, 8000, 8000),
        mixer = new AudioMixer(
          {
            resolve: () => 'authored.wav',
            require: async () => wave(sine),
            read: async () => null,
          },
          context,
        );
      const channel = await mixer.play({
        channel: 'native:0',
        file: 'authored',
        sourceMode: 'static',
        loopCount: 1,
        ...sound,
      });
      const metadata = (await mixer.preload('authored')).metadata,
        pcm = await context.startRendering();
      return {
        left: [...pcm.getChannelData(0).slice(512, 2512)],
        right: [...pcm.getChannelData(1).slice(512, 2512)],
        rate: channel.source.playbackRate.value,
        sourceRate: metadata.sampleRate,
      };
    };
    const pan = await render({ volume: 50, volumeFactor: 100, pan: 50 }),
      spatial = await render({
        volume: 100,
        nativeSpatial: {
          enabled: true,
          position: [10, 0, 0],
          velocity: [0, 0, 0],
          minimumDistance: 1,
          maximumDistance: 100,
          dopplerFactor: 1,
        },
      }),
      doppler = await render(
        {
          volume: 100,
          nativeSpatial: {
            enabled: true,
            position: [0, 0, 10],
            velocity: [0, 0, -171.65],
            minimumDistance: 10,
            maximumDistance: 100,
            dopplerFactor: 1,
          },
        },
        true,
      );
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      pan: [mean(pan.left), mean(pan.right)],
      sourceRate: pan.sourceRate,
      spatial: [Math.max(...spatial.left.map(Math.abs)), mean(spatial.right)],
      rate: doppler.rate,
      crossings: doppler.right.reduce(
        (n, x, i, xs) => n + Number(i > 0 && xs[i - 1] <= 0 && x > 0),
        0,
      ),
    };
  });
  expect(result.sourceRate).toBe(8000);
  expect(result.pan[0]).toBeCloseTo(0.05, 5);
  expect(result.pan[1]).toBeCloseTo(0.5 * 10 ** (-1000 / 2000), 5);
  expect(result.spatial[0]).toBeLessThan(1e-6);
  expect(result.spatial[1]).toBeCloseTo(0.05, 5);
  expect(result.rate).toBe(2);
  expect(result.crossings).toBeGreaterThanOrEqual(99);
  expect(result.crossings).toBeLessThanOrEqual(101);
});
