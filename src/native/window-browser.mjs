// SPDX-License-Identifier: MPL-2.0
// Browser substitutes for the application's modal OS interfaces.
import { NativeConfiguration } from './config.mjs';
import { NativeFESConfiguration } from './fes-config.mjs';
const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  },
  fields = [
    [
      'Message',
      [
        ['messpd', 'Text speed'],
        ['autospd', 'Automatic timing preset'],
        ['autoind', 'Automatic timing indicator', 'check'],
        ['autospd_b', 'Automatic delay'],
        ['autospd_c', 'Delay per character'],
        ['stillread', 'Remember read text', 'check'],
        ['contauto', 'Keep automatic mode', 'check'],
        ['waitpcm', 'Wait for voice', 'check'],
        ['fullskip', 'Skip unread text', 'check'],
        ['enable_readcol', 'Highlight read text', 'check'],
        ['readcol', 'Read text color', 'color'],
        ['skip_speed', 'Skip speed'],
        ['contskip', 'Keep skip mode', 'check'],
        ['strscroll', 'Scroll messages', 'check'],
        ['ctrlmode', 'Control key mode'],
        ['autoleft', 'Left click stops automatic mode', 'check'],
        ['enable_readselcol', 'Highlight read choices', 'check'],
      ],
    ],
    [
      'Audio',
      [
        ['vol_master', 'Master volume'],
        ['vol_bgm', 'Music volume'],
        ['vol_se', 'Effects volume'],
        ['vol_voice', 'Voice volume'],
        ['vol_play', 'Playback volume'],
        ['mute_master', 'Mute all audio', 'check'],
        ['mute_bgm', 'Mute music', 'check'],
        ['mute_se', 'Mute effects', 'check'],
        ['mute_voice', 'Mute voice', 'check'],
        ['mute_play', 'Mute playback', 'check'],
        ['contvoice', 'Continue voice between messages', 'check'],
      ],
    ],
    [
      'Effects',
      [
        ['effspd', 'Effect speed'],
        ['effcut', 'Skip effects', 'check'],
        ['autocur', 'Move pointer automatically', 'check'],
        ['autodel', 'Hide pointer automatically', 'check'],
        ['dorama', 'Dramatic effects', 'check'],
        ['motcut', 'Skip motions', 'check'],
        ['enable_sceneanm', 'Scene animation', 'check'],
      ],
    ],
    [
      'Window',
      [
        ['wndcolor', 'Window color', 'color'],
        ['dragwnd', 'Allow window dragging', 'check'],
        ['wndframe', 'Show window frame', 'check'],
        ['activewindow', 'Active window behavior'],
        ['screen', 'Fullscreen', 'check'],
      ],
    ],
    [
      'Text and language',
      [
        ['font', 'Text font', 'text'],
        ['ruby', 'Ruby font', 'text'],
        ['fontweight', 'Font weight'],
        ['fontprop', 'Proportional font', 'check'],
        ['fontfix', 'Fixed font size', 'check'],
        ['lang_ui', 'Interface language', 'language'],
        ['lang_text_main', 'Main text language', 'language'],
        ['lang_text_sub', 'Secondary text language', 'language'],
      ],
    ],
  ];
export class BrowserNativeWindow {
  constructor(engine) {
    this.engine = engine;
    this.dialog = null;
  }
  async show(title, build, { confirm = false, closeLabel = confirm ? 'Cancel' : 'Close' } = {}) {
    if (this.dialog) throw new Error('A native window dialog is already open');
    const dialog = element('dialog'),
      heading = element('h2', title),
      body = element('div'),
      buttons = element('div'),
      close = element('button', closeLabel);
    dialog.className = 'native-window';
    body.className = 'native-window-body';
    buttons.className = 'native-window-buttons';
    dialog.append(heading, body, buttons);
    buttons.append(close);
    document.body.append(dialog);
    this.dialog = dialog;
    let answer = false,
      settle;
    const result = new Promise((resolve) => {
      settle = resolve;
    });
    this.cancel = () => {
      answer = false;
      if (dialog.open) dialog.close();
      else dialog.dispatchEvent(new Event('close'));
    };
    close.onclick = this.cancel;
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    dialog.addEventListener('cancel', () => {
      answer = false;
    });
    dialog.addEventListener(
      'close',
      () => {
        this.dialog = null;
        this.cancel = null;
        dialog.remove();
        settle(answer);
      },
      { once: true },
    );
    try {
      await build(body, buttons, (value) => {
        answer = value;
        dialog.close();
      });
      if (this.dialog !== dialog) return await result;
      dialog.showModal();
      close.focus();
      return await result;
    } catch (error) {
      this.dialog = null;
      this.cancel = null;
      dialog.remove();
      throw error;
    }
  }
  confirm({ caption, message }) {
    return this.show(
      caption,
      (body, buttons, finish) => {
        body.append(element('p', message));
        const yes = element('button', 'Yes');
        yes.onclick = () => finish(true);
        buttons.prepend(yes);
      },
      { confirm: true },
    );
  }
  async files(world) {
    const storage = world.storage;
    if (!storage.store?.records)
      throw new Error('Browser save directory requires persistent game storage');
    return this.show('Game save files', (body) => {
      const list = element('div'),
        upload = element('input'),
        refresh = () => {
          list.replaceChildren();
          const records = [...storage.store.records.values()].sort((a, b) =>
            String(a.slot).localeCompare(String(b.slot)),
          );
          if (!records.length) list.append(element('p', 'No save files yet.'));
          for (const record of records) {
            const row = element('div'),
              download = element('button', 'Download'),
              remove = element('button', 'Delete');
            row.className = 'native-file';
            row.append(
              element(
                'span',
                `${record.slot} · ${record.data.bytes.length.toLocaleString()} bytes`,
              ),
              download,
              remove,
            );
            download.onclick = () => {
              const url = URL.createObjectURL(new Blob([record.data.bytes])),
                link = element('a');
              link.href = url;
              link.download = String(record.slot).split('/').at(-1);
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            };
            remove.onclick = async () => {
              if (window.confirm(`Delete ${record.slot}?`)) {
                await storage.remove(record.slot);
                refresh();
              }
            };
            list.append(row);
          }
        };
      upload.type = 'file';
      upload.setAttribute('aria-label', 'Import a game save file');
      upload.onchange = async () => {
        const file = upload.files[0];
        if (!file) return;
        if (file.size > 128 * 1024 * 1024)
          throw new Error('Imported game file exceeds the storage limit');
        if (storage.store.get(file.name) && !window.confirm(`Replace ${file.name}?`)) return;
        await storage.write(file.name, new Uint8Array(await file.arrayBuffer()));
        refresh();
        upload.value = '';
      };
      body.append(list, element('label', 'Import a game save file'), upload);
      refresh();
    });
  }
  configuration(world, system = false, volume = false) {
    const controls = [],
      config = world.configuration,
      service = world.fesConfiguration;
    return this.show(
      volume ? 'Audio output' : system ? 'System configuration' : 'Game configuration',
      (body, buttons, finish) => {
        const error = element('p');
        error.setAttribute('role', 'alert');
        for (const [title, items] of fields) {
          if (volume && title !== 'Audio') continue;
          if (!system && !volume && title === 'Text and language') continue;
          const group = element('fieldset');
          group.append(element('legend', title));
          for (const [name, label, kind = 'number'] of items) {
            if (!service.recognized(name)) continue;
            const row = element('label'),
              input = element(kind === 'language' ? 'select' : 'input'),
              value = service.get(name);
            row.className = 'native-setting';
            row.append(element('span', label), input);
            input.name = name;
            if (kind === 'language') {
              if (name === 'lang_text_sub') {
                const option = element('option', 'Off');
                option.value = '4294967295';
                input.append(option);
              }
              for (const [index, language] of (config.language?.entries ?? []).entries()) {
                const option = element(
                  'option',
                  language.name || language.prefix || String(index + 1),
                );
                option.value = String(index);
                input.append(option);
              }
              input.value = String(value);
            } else if (kind === 'check') {
              input.type = 'checkbox';
              input.checked = Boolean(value);
            } else if (kind === 'color') {
              input.type = 'color';
              input.value = '#' + (value & 0xffffff).toString(16).padStart(6, '0');
            } else {
              input.type = kind === 'text' ? 'text' : 'number';
              input.value = String(value ?? '');
              if (kind === 'number') {
                input.min = '0';
                input.max =
                  name === 'autospd' ? '31' : name.startsWith('vol_') ? '100' : '4294967295';
                input.step = '1';
              }
            }
            group.append(row);
            controls.push({ name, input, kind, previous: value });
          }
          if (group.children.length > 1) body.append(group);
        }
        body.append(error);
        const apply = element('button', 'Apply');
        buttons.prepend(apply);
        apply.onclick = async () => {
          error.textContent = '';
          try {
            const pending = [],
              copy = new NativeConfiguration({ profile: config.profile });
            copy.restore(structuredClone(config.snapshot()));
            const draft = new NativeFESConfiguration({
              configuration: copy,
              languages: () => copy.language?.entries ?? [],
              emit: (event) => pending.push(event),
            });
            for (const { name, input, kind, previous } of controls) {
              if (!input.checkValidity()) {
                input.reportValidity();
                return;
              }
              const value =
                kind === 'text'
                  ? input.value
                  : kind === 'check'
                    ? Number(input.checked)
                    : kind === 'color'
                      ? ((previous & 0xff000000) | parseInt(input.value.slice(1), 16)) >>> 0
                      : Number(input.value);
              if (kind !== 'text' && (!Number.isInteger(value) || value < 0 || value > 0xffffffff))
                throw new Error(
                  'Choose a valid value for ' + input.previousElementSibling.textContent,
                );
              if (value !== previous) await draft.set(name, value);
            }
            config.restore(copy.snapshot());
            for (const event of pending) await service.emit?.(event);
            config.deriveVolumes();
            world.audio?.refresh?.();
            world.markConfigurationDirty();
            await world.flushConfiguration();
            finish(true);
          } catch (reason) {
            error.textContent = reason.message;
          }
        };
      },
    );
  }
  async perform(action, world) {
    switch (action.type) {
      case 'confirm-title':
      case 'confirm-close':
        return this.confirm(action);
      case 'script-message-box':
        await this.show(
          action.caption,
          (body) => {
            const message = element('p', action.message);
            message.style.whiteSpace = 'pre-wrap';
            body.append(message);
          },
          { closeLabel: 'OK' },
        );
        return 1;
      case 'save-directory':
        return this.files(world);
      case 'game-configuration':
        return this.configuration(world);
      case 'system-configuration':
        return this.configuration(world, true);
      case 'volume':
        return this.configuration(world, false, true);
      case 'version':
      case 'system-information':
        return this.show(
          action.type === 'version' ? 'CatSystem2 Web' : 'System information',
          (body) => {
            const entries =
              action.type === 'version'
                ? [
                    ['Game', world.game.title || 'CatSystem2 game'],
                    ['Engine', world.profile],
                    ['Player', 'CatSystem2 Web'],
                  ]
                : [
                    [
                      'Resolution',
                      `${world.configuration.screen.currentWidth} × ${world.configuration.screen.currentHeight}`,
                    ],
                    ['Game resources', String(world.game.index?.size ?? 0)],
                    ['Audio', world.audio?.context?.state ?? 'Unavailable'],
                    ['Graphics', 'WebGL 2 / Canvas 2D'],
                  ];
            const list = element('dl');
            for (const [label, value] of entries)
              list.append(element('dt', label), element('dd', value));
            body.append(list);
          },
        );
      case 'configuration-tool':
        return this.show('External configuration tool', (body) => {
          body.append(
            element(
              'p',
              'The configured tool requires Windows. Use System configuration to adjust this browser player.',
            ),
          );
        });
      case 'minimize':
        return this.show('Game paused', (body, buttons, finish) => {
          body.append(element('p', 'Resume when you are ready.'));
          buttons.firstChild.textContent = 'Resume';
          buttons.firstChild.onclick = () => finish(true);
        });
      case 'hide':
        this.engine.canvas.hidden = true;
        return;
      case 'close':
        return;
      default:
        throw new Error(`Unknown browser window action ${action.type}`);
    }
  }
  close() {
    this.cancel?.();
  }
}
