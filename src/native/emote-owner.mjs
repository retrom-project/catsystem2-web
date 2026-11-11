// SPDX-License-Identifier: MPL-2.0
import { EmoteProfiles, sections } from '../emote/profiles.mjs';
import { EmoteDocument } from '../emote/document.mjs';
import { M2Model } from '../emote/m2-model.mjs';
import { NativeM2Configuration } from './fes-config.mjs';
import { parseNativeXML } from './xml.mjs';
import { parseNativeInteger } from './standard.mjs';
import { decodeText } from '../binary.mjs';
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { compareNativeBytes } from './dictionary.mjs';

const settingsFields = {
  motion: ['motion'],
  eff_dif: ['eff', 'dif'],
  eff_iner: ['eff', 'inertia'],
  eff_blink: ['eff', 'blink'],
  eff_lip: ['eff', 'lip'],
  fade: ['eff_to_fade'],
};
const escape = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export class M2Owner {
  constructor(world) {
    this.world = world;
    this.tasks = new Map();
    this.documents = new Map();
    this.hits = [];
    this.configuration = new NativeM2Configuration({
      changed: () => {
        for (const task of this.tasks.values()) task.configure();
        return true;
      },
    });
    world.fesConfiguration.m2 = this.configuration;
  }
  async initialize() {
    if (this.initialized) return;
    if (nativeABI(this.world.profile).plugins.emoteDriver === 'placeholder') {
      this.initialized = true;
      return;
    }
    const game = this.world.game,
      bytes = game.readCategory
        ? await game.readCategory('m2view.cnf', 'm2config')
        : await game.read('m2view.cnf');
    this.initialized = true;
    if (!bytes) return;
    this.profiles = await EmoteProfiles.load(game);
    const config = sections(decodeText(bytes));
    this.definition = config;
    this.configuration.models = new NativeM2Configuration({
      models: (config.chheader ?? []).map(([name]) => name),
    }).models;
    this.configuration.levels = new Map(
      (config.inertia_lv_label ?? []).map(([name]) => [name, 100]),
    );
    this.configuration.enabled = new Map(
      (config.inertia_enable_label ?? []).map(([name]) => [name, 1]),
    );
    await this.loadSettings();
  }
  modelConfiguration(program) {
    const name = program.split(',')[0].toLowerCase(),
      key = [...this.configuration.models.keys()]
        .filter((key) => name.startsWith(key.toLowerCase()))
        .sort((a, b) => b.length - a.length)[0];
    return this.configuration.models.get(key) ?? null;
  }
  async document(model) {
    if (!this.documents.has(model)) {
      const record = { document: null };
      record.promise = (async () => {
        const game = this.world.game,
          bytes = game.requireCategory
            ? await game.requireCategory(model, 'm2psb')
            : await game.require(model);
        return (record.document = await EmoteDocument.open(bytes, { name: model }));
      })();
      this.documents.set(model, record);
    }
    const record = this.documents.get(model);
    try {
      return await record.promise;
    } catch (error) {
      if (this.documents.get(model) === record) this.documents.delete(model);
      throw error;
    }
  }
  async model(program) {
    await this.initialize();
    if (!this.profiles) throw new Error('M2 requires m2view.cnf and its model profiles');
    const pose = this.profiles.pose(program);
    return new M2Model(await this.document(pose.model), {
      profiles: this.profiles,
      program,
      randomInteger: () => this.world.random.rand(),
    });
  }
  release(model) {
    if (
      !model ||
      [...this.tasks.values()].some(
        (task) =>
          task.model?.document === model.document || task.oldModel?.document === model.document,
      )
    )
      return;
    if (this.documents.get(model.pose.model)?.document === model.document)
      this.documents.delete(model.pose.model);
    for (const texture of model.document.textures.values())
      this.world.stageRenderer.gpu?.releaseTextureFrame(texture);
  }
  async loadSettings() {
    const bytes = await this.world.storage.read('m2setting.xml');
    if (!bytes) return false;
    let root;
    try {
      root = parseNativeXML(bytes, 'utf-8');
    } catch (error) {
      this.world.host.nativeDiagnostic?.({ type: 'm2-settings', message: error.message });
      return false;
    }
    const value = (fallback, ...path) => {
      const text = root.node(...path)?.text;
      return text === undefined ? fallback : parseNativeInteger(text) >>> 0;
    };
    this.configuration.interleave = value(1, 'interleaving');
    for (const [name, model] of this.configuration.models)
      for (const [field, path] of Object.entries(settingsFields))
        model[field] = value(1, name, ...path);
    for (const [name, level] of this.configuration.levels)
      this.configuration.levels.set(name, value(level, 'inertia', name, 'lv'));
    for (const [name, enabled] of this.configuration.enabled)
      this.configuration.enabled.set(name, value(enabled, 'inertia', name, 'enable'));
    for (const task of this.tasks.values()) task.configure();
    return true;
  }
  async saveSettings() {
    if (!this.definition) return;
    // XML's insertion vector is reversed in the original serializer.
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<document>'];
    for (const [name, model] of [...this.configuration.models].sort(([a], [b]) =>
      compareNativeBytes(encodeCP932(b), encodeCP932(a)),
    )) {
      lines.push(
        `  <${escape(name)}>`,
        `    <eff_to_fade>${model.fade}</eff_to_fade>`,
        '    <eff>',
      );
      for (const [key, field] of [
        ['lip', 'eff_lip'],
        ['blink', 'eff_blink'],
        ['inertia', 'eff_iner'],
        ['dif', 'eff_dif'],
      ])
        lines.push(`      <${key}>${model[field]}</${key}>`);
      lines.push('    </eff>', `    <motion>${model.motion}</motion>`, `  </${escape(name)}>`);
    }
    if (this.configuration.levels.size || this.configuration.enabled.size) {
      lines.push('  <inertia>');
      const names = new Set([
        ...this.configuration.levels.keys(),
        ...this.configuration.enabled.keys(),
      ]);
      for (const name of [...names].sort((a, b) =>
        compareNativeBytes(encodeCP932(b), encodeCP932(a)),
      )) {
        lines.push(`    <${escape(name)}>`);
        if (this.configuration.enabled.has(name))
          lines.push(`      <enable>${this.configuration.enabled.get(name)}</enable>`);
        if (this.configuration.levels.has(name))
          lines.push(`      <lv>${this.configuration.levels.get(name)}</lv>`);
        lines.push(`    </${escape(name)}>`);
      }
      lines.push('  </inertia>');
    }
    lines.push(
      `  <interleaving>${this.configuration.interleave}</interleaving>`,
      '</document>',
      '',
    );
    await this.world.storage.write('m2setting.xml', new TextEncoder().encode(lines.join('\r\n')));
  }
  async command(id) {
    await this.initialize();
    if (id === 922) await this.loadSettings();
    else if (id === 923) await this.saveSettings();
    else if (id === 932) this.documents.clear();
    else if (id === 933)
      this.world.host.nativeLog?.(
        JSON.stringify({ models: [...this.tasks.values()].map((task) => task.program) }),
      );
  }
  snapshot() {
    return {
      initialized: this.initialized ?? false,
      configuration: this.configuration.snapshot(),
      hits: structuredClone(this.hits),
    };
  }
  async restore(state) {
    if (state.initialized) await this.initialize();
    this.configuration.restore(state.configuration);
    this.hits = structuredClone(state.hits);
  }
  async close({ flushFiles = true } = {}) {
    if (flushFiles && this.initialized) await this.saveSettings();
    this.documents.clear();
    this.tasks.clear();
  }
}
