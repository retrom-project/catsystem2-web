// SPDX-License-Identifier: MPL-2.0
// Window message/action ordering from the two original application handlers.
import {
  isNativeWindowCommandMessage,
  NATIVE_WINDOW_COMMAND_CALLBACKS,
  nativeWindowLanguageCommand,
  nativeWindowMessageCommand,
} from './window-commands.mjs';
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';
import { browserVirtualKey } from './input-bindings.mjs';
import { virtualKeyCharacter } from './windows-keyboard.mjs';
const preparation = new Set([119, 40002, 40027, 40057, 40011, 40041, 40019, 40037]),
  commands = new Set([
    119, 40045, 40002, 40008, 40009, 40012, 40021, 40034, 40027, 40057, 40011, 40041, 40019, 40037,
  ]);
export class NativeWindow {
  constructor(world) {
    this.world = world;
  }
  get handle() {
    // One browser game view is the application's virtual Win32 window.
    return 1;
  }
  get opened() {
    return this.world.nativeEngine?.kernel?.windowViews.windows.has(this.handle) ?? false;
  }
  post(message, wParam = 0, lParam = 0, keyboard) {
    if (this.opened) {
      if (
        !this.world.nativeEngine.kernel.messageQueue.post(
          this.handle,
          message,
          wParam,
          lParam,
          keyboard,
        )
      )
        throw new Error(`Could not post native window message ${message}`);
      return;
    }
    this.world.windowMessages.push({
      message: message >>> 0,
      wParam: wParam >>> 0,
      lParam: lParam >>> 0,
    });
  }
  handlesBrowserMessage(message, wParam) {
    if (isNativeWindowCommandMessage(message))
      return !this.world.nativeEngine?.refs.applicationWindowHook;
    if (message === 0x111) {
      const command = wParam & 0xffff;
      return (
        commands.has(command) ||
        command === 40030 ||
        (command === 40096 && this.world.profile === 'nekopara-vol3-engine-2.6.1.76') ||
        Boolean(this.world.configuration.language && nativeWindowLanguageCommand(command))
      );
    }
    return (
      message === 0x10 ||
      message === 0x410 ||
      [0x467, 0x468, 0x46e, 0x46f, 0x470].includes(message) ||
      (message === 0x112 && (wParam & 0xfff0) === 0xf020)
    );
  }
  keyboardShortcut(event) {
    const engine = this.world.nativeEngine,
      owner = engine?.kernel.windowViews.windows.get(this.handle)?.userData,
      key = browserVirtualKey(event);
    if (!owner || !key || event.metaKey) return null;
    const table = engine.process.load(owner + 12),
      accelerators = engine.kernel.accelerators,
      modifiers = (event.shiftKey ? 4 : 0) | (event.ctrlKey ? 8 : 0) | (event.altKey ? 16 : 0),
      extended =
        /^(?:AltRight|ControlRight|Insert|Delete|Home|End|PageUp|PageDown|Arrow\w+|NumpadEnter|NumpadDivide)$/.test(
          event.code,
        ),
      data =
        1 | (event.altKey ? 1 << 29 : 0) | (extended ? 1 << 24 : 0) | (event.repeat ? 1 << 30 : 0),
      message = event.altKey ? 0x104 : 0x100,
      character =
        event.key?.length === 1 && (!event.ctrlKey || event.getModifierState?.('AltGraph'))
          ? event.key.charCodeAt(0)
          : virtualKeyCharacter(key, modifiers, {
              capsLock: Boolean(event.getModifierState?.('CapsLock')),
              numLock: Boolean(event.getModifierState?.('NumLock')),
            });
    // Predict browser default handling now. The original loop translates
    // the queued key and, where applicable, its later character message.
    if (
      accelerators.match(table, message, key, data, modifiers) !== null ||
      (character !== null &&
        accelerators.match(table, message + 2, character, data, modifiers) !== null)
    )
      return [message, key, data, { modifiers, character }];
    return null;
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
    const language = world.configuration.language,
      selection = language && nativeWindowLanguageCommand(command);
    if (selection) {
      const { field, index } = selection,
        valid = index < language.entries.length,
        next = valid ? index : 0xffffffff;
      if ((valid || field === 'sub') && language[field] !== next) {
        language[field] = next;
        await world.applyNativeLanguage(field);
      }
      return true;
    }
    if (command === 40030) {
      if (world.nativeEngine) await (await world.getNativeFeature('screen-capture')).menuBitmap();
      return true;
    }
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
      case 40009:
      case 40012: {
        // The native desktop survey can force fullscreen on unsupported color depths.
        if (
          command === 40012 &&
          world.nativeEngine?.process.load(NATIVE_STARTUP_BLOCKS[world.profile] + 44)
        )
          break;
        const screen = world.configuration.screen,
          fullscreen = command === 40012 ? !screen.fullscreen : command === 40008;
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
    if (isNativeWindowCommandMessage(message.message)) {
      if (this.world.nativeEngine?.refs.applicationWindowHook) return true;
      if (this.opened) {
        const { nativeEngine, profile } = this.world;
        // These four branches only post their command and never write the
        // optional LRESULT. WinMain supplies its startup record as context.
        await nativeEngine.call(NATIVE_WINDOW_COMMAND_CALLBACKS[profile], [
          NATIVE_STARTUP_BLOCKS[profile],
          this.handle,
          message.message,
          message.wParam,
          message.lParam,
          0,
        ]);
        return true;
      }
      const command = nativeWindowMessageCommand(message.message, message.lParam);
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
