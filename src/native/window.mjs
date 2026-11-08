// SPDX-License-Identifier: MPL-2.0
// Window message/action ordering from the two original application handlers.
import { nativeWindowMenuCommand } from './window-commands.mjs';
const preparation = new Set([119, 40002, 40027, 40057, 40011, 40041, 40019, 40037]),
  commands = new Set([
    119, 40045, 40002, 40008, 40009, 40021, 40034, 40027, 40057, 40011, 40041, 40019, 40037,
  ]);
export class NativeWindow {
  constructor(world) {
    this.world = world;
  }
  get handle() {
    // One browser game view is the application's virtual Win32 window.
    return 1;
  }
  post(message, wParam = 0, lParam = 0) {
    this.world.windowMessages.push({
      message: message >>> 0,
      wParam: wParam >>> 0,
      lParam: lParam >>> 0,
    });
  }
  text(value) {
    return this.world.globalStrings.get(value);
  }
  async action(type, detail = {}) {
    if (typeof this.world.host.nativeWindowAction !== 'function')
      throw new Error(`Native window operation ${type} requires its browser host service`);
    return this.world.host.nativeWindowAction({ type, ...detail }, this.world);
  }
  async sendEvent(event, w = 0, l = 0, options) {
    if (this.world.root === undefined || !this.world.objects.objects.has(this.world.root)) return 0;
    return (await this.world.getNativeFeature('window-events')).send(event, w, l, options);
  }
  async broadcast() {
    const world = this.world;
    if (world.profile !== 'nekopara-vol3-engine-2.6.1.76')
      throw new Error('This engine has no native broadcast flag');
    if (world.steamService.managerExists) {
      await world.steamService.observeBroadcastQuery();
      if (!world.configuration.authorMode) return 0;
    }
    const engine = await world.ensureNativeEngine();
    return engine.call(0x713f70, [], engine.refs.owner);
  }
  async command(word) {
    const command = word & 0xffff,
      world = this.world;
    if (command === 40096 && world.profile === 'nekopara-vol3-engine-2.6.1.76') {
      const engine = await world.ensureNativeEngine(),
        old = await engine.call(0x713f70, [], engine.refs.owner),
        next = Number(!old);
      await engine.call(0x713f60, [next], engine.refs.owner);
      if (world.configuration.authorMode) world.host.nativeMenuChecked?.(40096, Boolean(next));
      return true;
    }
    if (!commands.has(command)) return false;
    if (preparation.has(command)) await this.sendEvent(158, 0, 1);
    switch (command) {
      case 119:
        if (
          await this.action('confirm-title', {
            caption: this.text('$0000-0035$'),
            message: this.text('$0000-0036$'),
          })
        )
          await this.sendEvent(21);
        break;
      case 40045:
        await this.action('save-directory');
        break;
      case 40002:
        this.post(0x10);
        break;
      case 40008:
      case 40009: {
        const fullscreen = command === 40008,
          screen = world.configuration.screen;
        if (Boolean(screen.fullscreen) === fullscreen) break;
        if (fullscreen && screen.noFullResolution) {
          screen.fullWidth = world.graphics.view.clientWidth;
          screen.fullHeight = world.graphics.view.clientHeight;
        }
        if (typeof world.host.nativeWindowMessage !== 'function')
          throw new Error('Native fullscreen/window service is unavailable');
        await world.host.nativeWindowMessage(
          { message: 0x467, wParam: 0, lParam: Number(fullscreen) },
          world,
        );
        world.markConfigurationDirty();
        break;
      }
      case 40021:
        this.post(0x112, 0xf020);
        break;
      case 40034:
        await this.sendEvent(20);
        break;
      case 40027:
        await this.action('game-configuration');
        break;
      case 40057:
        await world.flushConfiguration();
        await this.action('system-configuration');
        break;
      case 40011:
        await this.action('volume');
        break;
      case 40041:
        await this.action('version');
        break;
      case 40019:
        await this.action('system-information');
        break;
      case 40037:
        await this.action('configuration-tool');
        break;
    }
    return true;
  }
  async message(message) {
    if (message.message === 0x468) {
      await this.sendEvent(21);
      return true;
    }
    if (message.message === 0x46c) {
      const command = nativeWindowMenuCommand(message.lParam);
      if (command !== null) this.post(0x111, command);
      return true;
    }
    if (message.message === 0x111) return this.command(message.wParam);
    if (message.message === 0x112 && (message.wParam & 0xfff0) === 0xf020) {
      await this.action('minimize');
      return true;
    }
    if (message.message === 0x10) {
      const title = this.text(this.world.configuration.fields.application.title),
        template = this.text('$0000-0042$'),
        yes = await this.action('confirm-close', {
          caption: this.text('$0000-0043$'),
          message: template.replace('%s', title),
        });
      if (yes) {
        await this.action('hide');
        this.post(0x410);
      }
      return true;
    }
    if (message.message === 0x410) {
      await this.sendEvent(162, 0, 0, { taskType: 12 });
      this.world.quitRequested = true;
      await this.action('close');
      return true;
    }
    return false;
  }
}
