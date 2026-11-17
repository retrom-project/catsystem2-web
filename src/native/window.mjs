// SPDX-License-Identifier: MPL-2.0
// Window message/action ordering from the two original application handlers.
import { nativeABI } from './abi/index.mjs';
import {
  isNativeWindowCommandMessage,
  nativeWindowLanguageCommand,
  nativeWindowMessageCommand,
} from './window-commands.mjs';
import { browserVirtualKey } from './input-bindings.mjs';
import { virtualKeyCharacter } from './windows-keyboard.mjs';
import {
  matchNativeAcceleratorRows,
  NATIVE_WINDOW_BASE_ACCELERATORS,
} from './accelerator-rows.mjs';

const preparation = new Set([119, 40002, 40027, 40057, 40011, 40041, 40019, 40037]),
  commands = new Set([
    119, 40045, 40002, 40008, 40009, 40012, 40021, 40034, 40027, 40057, 40011, 40041, 40019, 40037,
  ]);
export class NativeWindow {
  constructor(world) {
    this.world = world;
    // The original Game owner constructor712820 initializes this raw DWORD.
    this.broadcastFlag = 0;
  }
  snapshot() {
    return { broadcastFlag: this.broadcastFlag };
  }
  restore(state) {
    if (
      !state ||
      !Number.isInteger(state.broadcastFlag) ||
      state.broadcastFlag < 0 ||
      state.broadcastFlag > 0xffffffff
    )
      throw new Error('Invalid broadcast window checkpoint');
    this.broadcastFlag = state.broadcastFlag;
  }
  get handle() {
    // One browser game view is the application's virtual Win32 window.
    return 1;
  }

  post(message, wParam = 0, lParam = 0, keyboard) {
    if (this.world.closed || this.world.disposalRequested) return;
    this.world.windowMessages.push({
      message: message >>> 0,
      wParam: wParam >>> 0,
      lParam: lParam >>> 0,
      ...(keyboard === undefined ? {} : { keyboard: { ...keyboard } }),
    });
  }
  handlesBrowserMessage(message, wParam) {
    if (isNativeWindowCommandMessage(message)) return true;
    if (message === 0x111) {
      const command = wParam & 0xffff;
      return (
        commands.has(command) ||
        command === 40030 ||
        (command === 40096 && nativeABI(this.world.profile).capabilities.windowReturnTitle) ||
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
  get acceleratorRows() {
    const world = this.world;
    if (world.closed || world.disposalRequested) return [];
    return [
      ...(nativeABI(world.profile).capabilities.windowBaseAccelerators
        ? NATIVE_WINDOW_BASE_ACCELERATORS
        : []),
      ...this.languageAccelerators,
    ];
  }
  get languageAccelerators() {
    const world = this.world;
    if (
      !nativeABI(world.profile).capabilities.windowLanguageAccelerators ||
      world.closed ||
      world.disposalRequested
    )
      return [];
    const rows = [],
      counts = [0, 0];
    for (const entry of world.configuration.language.entries)
      for (const [index, name] of ['accel', 'accelsub'].entries()) {
        const [key, flags] = entry[name];
        if (key) rows.push([(flags | 1) & 255, key & 65535, 40075 + index * 10 + counts[index]++]);
      }
    // The native dynamic branch appends this character row only if at least
    // one configured key exists. Its packed suffix is not a "none" sentinel.
    if (rows.length) rows.push([4, 78, 40085 + counts[1]]);
    return rows;
  }
  keyboardCommand({ message, wParam, lParam, keyboard }) {
    if (!keyboard) return null;
    const rows = this.acceleratorRows,
      command = matchNativeAcceleratorRows(rows, message, wParam, lParam, keyboard.modifiers);
    if (command !== null) return command;
    if ((message === 0x100 || message === 0x104) && keyboard.character !== null)
      return matchNativeAcceleratorRows(
        rows,
        message + 2,
        keyboard.character,
        lParam,
        keyboard.modifiers,
      );
    return null;
  }
  refreshLanguageMenu() {
    const world = this.world;
    if (
      !nativeABI(world.profile).capabilities.windowLanguageAccelerators ||
      world.closed ||
      world.disposalRequested
    )
      return;
    const { language } = world.configuration;
    for (let command = 40065; command <= 40094; command++)
      world.host.nativeMenuChecked?.(command, false);
    for (const [index, field] of ['ui', 'main', 'sub'].entries()) {
      const selected =
        language[field] === 0xffffffff && field === 'sub'
          ? language.entries.length
          : language[field];
      world.host.nativeMenuChecked?.(40065 + index * 10 + selected, true);
    }
  }
  keyboardShortcut(event) {
    if (this.world.closed || this.world.disposalRequested) return null;
    const key = browserVirtualKey(event);
    if (!this.acceleratorRows.length || !key || event.metaKey) return null;
    const modifiers = (event.shiftKey ? 4 : 0) | (event.ctrlKey ? 8 : 0) | (event.altKey ? 16 : 0),
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
            }),
      keyboard = { modifiers, character };
    if (this.keyboardCommand({ message, wParam: key, lParam: data, keyboard }) !== null)
      return [message, key, data, keyboard];
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
    const world = this.world;
    if (world.root === undefined || !world.objects.objects.has(world.root)) return 0;

    const { taskType } = options ?? {},
      data = new Uint8Array(24),
      view = new DataView(data.buffer);
    [0, 0, event, w, l].forEach((word, i) => view.setUint32(i * 4, word >>> 0, true));
    const context = {
      payload: {
        load: (at) => view.getUint32(at, true),
        bytes: (at, size) => data.subarray(at, at + size),
      },
      fromHost: true,
      flags: 0,
    };
    // sendEngine accepts World identities and supplies the native Root's
    // zero sender. The copied source tail is padding; D2 clears decoded flags.
    await world.sendEngine(
      world.root,
      world.root,
      taskType === undefined ? 11 : 12,
      taskType ?? 0,
      0,
      context,
    );
    return Number(context.nativeRouted);
  }
  async broadcast() {
    const world = this.world;
    if (!nativeABI(world.profile).capabilities.broadcast)
      throw new Error('This engine has no native broadcast flag');
    if (world.steamService.managerExists) {
      await world.steamService.observeBroadcastQuery();
      if (!world.configuration.authorMode) return 0;
    }

    return this.broadcastFlag;
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
      await world.screenCapture.menuBitmap();
      return true;
    }
    if (command === 40096 && nativeABI(world.profile).capabilities.windowReturnTitle) {
      const next = (this.broadcastFlag = Number(!this.broadcastFlag));
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
