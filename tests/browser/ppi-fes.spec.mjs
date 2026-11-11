// SPDX-License-Identifier: MPL-2.0
import { routeAuthoredPPI } from '../fixtures/oracle-browser-routes.mjs';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { hg3, kcsProgram } from '../helpers.mjs';
import { nativeParticleFixture } from '../fixtures/ppi-native-fixture.mjs';

const source = `#DEFINE
CPLANE carrier
PARTICLE effect[2]
#OBJECT SIZE POS PRI DISP
carrier 16,12 4,5,6 50 1
#START
effect[0] init 0 weather.kcs quad.hg3 2 10000
effect[1] init 1 authored.ppi quad.hg3 1 10001
effect param 6 19
effect blend 128
effect start
next PLAY
#PLAY
effect ismot 21
#ATTACH
effect[1] attach carrier
next PLAY
#STOP
effect stop
next IDLE
#IDLE
effect ismot 22
`;

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(`${profile} FES particles draw through their original task and survive a fresh World`, async ({
    page,
  }) => {
    const exe = process.env[variable],
      driver = process.env.CATSYSTEM2_EMOTE_DLL,
      sdk = profile.startsWith('sdk-');
    test.skip(!exe || (!sdk && !driver));
    test.setTimeout(120000);
    const files = new Map([
      ['engine.exe', await readFile(exe)],
      ...(!sdk ? [['emotedriver.dll', await readFile(driver)]] : []),
      ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      ['particles.fes', encodeCP932(source)],
      ['weather.kcs', kcsProgram([[59]])],
      ['authored.ppi', nativeParticleFixture({ color: 0xff00d5f0 })],
      ['quad.hg3', hg3(4, 4, new Uint8Array(4 * 4 * 4).fill(255))],
    ]);
    await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
      route.fulfill({
        path: new URL('../fixtures/browser-native-world.mjs', import.meta.url).pathname,
        contentType: 'text/javascript',
      }),
    );
    await page.route('**/ppi-fes-fixture/*', (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)),
        bytes = files.get(name);
      return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
    });
    await routeAuthoredPPI(page);
    await page.goto('/');
    const result = await page.evaluate(
      async ({ names, profile }) => {
        const { browserNativeWorld, browserAssert: assert } = await import(
            '/tests/fixtures/browser-native-world.mjs'
          ),
          { authoredPPIRegistry } = await import('/tests/fixtures/ppi-js-fixture.mjs'),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(
                  await (await fetch('/ppi-fes-fixture/' + encodeURIComponent(name))).arrayBuffer(),
                ),
              ]),
            ),
          ),
          make = () =>
            browserNativeWorld({
              profile,
              files,
              storage: { read: async () => null, write: async () => true },
              particleRegistry: authoredPPIRegistry(['authored'], { color: 0xff00d5f0 }),
            }),
          world = make();
        let fresh;
        try {
          await world.initialize('main.kcs');
          const surface = await world.objects.create({ kind: 15, parent: world.main.id }),
            owner = await world.objects.create({
              kind: 34,
              parent: world.main.id,
              name: 'Authored FES particle',
            }),
            interpreter = (current) => current.objects.objects.get(owner).implementation,
            jump = (current, label) =>
              current.sendEngine(owner, current.main.id, 335, 0, 0, {
                payload: { string: () => label },
              }),
            render = async (current) => {
              const renderer = current.stageRenderer;
              await renderer.render(current.graphics.stage, null, current.particles.drawItems());
              return new Uint8Array(
                await crypto.subtle.digest('SHA-256', renderer.gpu.pixels()),
              ).toHex();
            };
          await world.sendEngine(surface, world.main.id, 279, 64, 48);
          await world.sendEngine(surface, world.main.id, 283);
          interpreter(world).surface = surface;
          await interpreter(world).load('particles', world.main);
          const instance = interpreter(world).player.root,
            ids = [0, 1].map((index) => instance.byKey.get(`effect[${index}]`).nativeTaskID),
            task = (current, index) => current.particles.get(ids[index]);
          assert.ok(ids[0] !== ids[1], 'A group should own two distinct particle tasks');
          for (const [index, id] of ids.entries()) {
            const child = world.objects.objects.get(id);
            assert.deepEqual([child.kind, child.name, child.parent], [16, 'FE Particle', owner]);
            assert.equal(task(world, index).bank, null);
          }
          for (let i = 0; i < 3; i++) await world.tick();
          for (const [index, family] of ['script', 'plugin'].entries()) {
            const bank = task(world, index).bank;
            assert.deepEqual(
              [bank.family, bank.count, bank.priority, bank.alpha],
              [family, 2 - index, 10000 + index, 128],
            );
            assert.ok(bank.nativeAtlas.pointer && bank.started && bank.instance.active);
            assert.deepEqual([...bank.registers.slice(0, 3)], [6, 19, 0]);
          }
          assert.equal(instance.global(21), 1);
          assert.equal(await jump(world, 'ATTACH'), 1);
          await world.tick();
          const graph = world.graphics.graphHandle(instance.byKey.get('carrier').nativeTaskID);
          assert.ok(graph > 0, 'The original FES plane must own a graph');
          assert.equal(task(world, 1).bank.instance.attachPlane, graph);
          assert.equal(world.particles.drawItems().length, 2);
          const playing = await render(world);
          fresh = make();
          await fresh.restore(structuredClone(world.snapshot()));
          const restored = await render(fresh);
          assert.equal(restored, playing);
          for (const current of [world, fresh]) await current.tick();
          assert.equal(await render(fresh), await render(world));
          assert.equal(task(fresh, 1).bank.instance.attachPlane, graph);
          for (const current of [world, fresh]) {
            assert.equal(await jump(current, 'STOP'), 1);
            await current.tick();
            await current.tick();
            assert.equal(interpreter(current).player.root.global(22), 0);
            assert.equal(current.particles.drawItems().length, 0);
            await current.objects.release(owner);
            assert.ok(ids.every((id) => !current.objects.objects.has(id)));
            assert.equal(current.particles.host.banks.size, 0);
          }
          return { playing, restored, stopped: await render(fresh) };
        } finally {
          await fresh?.close({ flushFiles: false });
          await world.close({ flushFiles: false });
        }
      },
      { names: [...files.keys()], profile },
    );
    expect(result.restored).toBe(result.playing);
    expect(result.stopped).not.toBe(result.playing);
  });
