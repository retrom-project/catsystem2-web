// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESInstance / FESObject (OWCramer).
import { MotionTarget, objectMotionState, applyObjectMotionState } from '../motion/target.mjs';
import { motionDefinition, motionRegisters } from '../motion/definitions.mjs';
import { FES_OBJECT_TYPES } from './types.mjs';
import { FES_TEXT_VERBS } from '../native/fes-text.mjs';
import { FES_M2_VERBS } from '../native/emote-fes.mjs';

export class FESObject {
  constructor(type, baseName, index, handle) {
    if (!Object.hasOwn(FES_OBJECT_TYPES, type)) throw new Error(`Unknown FES object type ${type}`);
    Object.assign(this, {
      type,
      nativeType: FES_OBJECT_TYPES[type],
      baseName,
      index,
      handle,
      key: index === null ? baseName : `${baseName}[${index}]`,
      file: null,
      ids: [],
      idIndex: 0,
      x: 0,
      y: 0,
      z: 0,
      width: 0,
      height: 0,
      depth: 0,
      baseX: 0,
      baseY: 0,
      baseZ: 0,
      vramX: 0,
      vramY: 0,
      vramZ: 0,
      areaWidth: 0,
      areaHeight: 0,
      pri: 0,
      disp: false,
      enable: true,
      alpha: 255,
      plane: null,
      parent: null,
      text: '',
      style: { size: 26, color: [255, 255, 255], edge: [0, 0, 0], revealFrame: 0 },
      revealStart: 0,
      soundTable: {},
      sound: null,
      group: null,
      volume: 100,
      loop: false,
      channel: null,
      soundType: null,
      defaultHandler: null,
      keyblock: null,
      keyPosition: null,
      lockedRect: null,
      deleted: false,
      min: 0,
      max: 10,
      page: 0,
      value: 0,
      count: 4,
      top: 0,
      shownIDs: [],
      simage: {},
      highlighted: {},
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      rotation: 0,
      motions: [],
      motionDelay: 0,
      slot: null,
    });
  }
  get currentID() {
    if (this.idIndex < 0) return this.idIndex;
    return this.ids.length ? this.ids[Math.min(this.idIndex, this.ids.length - 1)] : this.idIndex;
  }
  get isPlane() {
    return this.type === 'PLANE' || this.type === 'CPLANE';
  }
  get soundChannel() {
    return this.channel ?? this.key;
  }
  get motionBusy() {
    return (
      !this.deleted &&
      Boolean(this.nativeMotionBusy || this.motionTarget?.busy() || this.motions.length)
    );
  }
  attachMotion(library) {
    if (!this.motionTarget)
      Object.defineProperty(this, 'motionTarget', {
        configurable: true,
        value: new MotionTarget(library, {
          readState: () => objectMotionState(this),
          writeState: (state) => applyObjectMotionState(this, state),
        }),
      });
    return this.motionTarget;
  }
  reveal(frame) {
    return this.style.revealFrame
      ? Math.min(
          this.text.length,
          Math.floor(Math.max(0, frame - this.revealStart) / (this.style.revealFrame * 0.5)),
        )
      : this.text.length;
  }
  motion(frames, properties, from, to, curve = 'linear') {
    for (let i = 0; i < properties.length; i++) this[properties[i]] = from[i];
    this.motions = this.motions.filter((m) => !m.properties.some((p) => properties.includes(p)));
    if (frames <= 0) for (let i = 0; i < properties.length; i++) this[properties[i]] = to[i];
    else this.motions.push({ frames, properties, from, to, elapsed: 0, curve });
  }
  advance(frame) {
    this.motionTarget?.update(frame);
    for (const m of this.motions) {
      let t = Math.min(1, ++m.elapsed / m.frames);
      if (m.curve === 'ease') t = t * t * (3 - 2 * t);
      if (m.curve === 'triangle') t = t <= 0.5 ? t * 2 : (1 - t) * 2;
      for (let i = 0; i < m.properties.length; i++)
        this[m.properties[i]] = m.from[i] + (m.to[i] - m.from[i]) * t;
    }
    this.motions = this.motions.filter((m) => m.elapsed < m.frames);
  }
  finish() {
    this.motionTarget?.finish();
    for (const m of this.motions)
      for (let i = 0; i < m.properties.length; i++)
        this[m.properties[i]] = m.curve === 'triangle' ? m.from[i] : m.to[i];
    this.motions = [];
  }
}

export const objectVerbs = new Set(
  'disp enable setid settbl fade fade2 move amove1 amove2 amove3 arc stop blend pos pos2 getpos getpos2 page load sndtbl play loop getid str apend clear draw isdraw skip reset layout dispid ptype setsave getsavestr getsavedate setlog remake max next rev blockcolor lineinfo pathinfo blockinfo pri scale rot crossfade noact setid_s setanm anm delay lock attr base refex apendmark linecnt endpos userfont userfontobj attach anm channel clip color coordmode copy delete exist getflag getsize gettonetbl imot init insert ismot keyblock keypos linecolor loadlist loadlist2 mag mcmove mrot mcrot mscale mcscalecos mcscalesin mcfade mcarc param pend pl ref refparentpl repeat setact shuffle size start stype time tone tonetable vram wipe'.split(
    ' ',
  ),
);

export const FES_BUILTIN_VERBS = new Set(
  'setid getid enable disp draw wipe getpos stop blend load play copy delete size color noact sndtbl next rev repeat shuffle settbl loadlist loadlist2 dispid ptype setnum setsave pos pl getpos2 setact page getsize ref clip lock exist max keypos attach getflag arc mcarc userfont channel stype tone tonetbl gettonetbl coordmode pend mcpend setanm anm keyblock layout str reset locator pos2 baseopt init param start apend apendmark clear isdraw isdrawmark skip refex setlog blockinfo linecolor blockcolor lineinfo endpos attr refparentpl mag time userfontobj delay ismot insert name getdiv redraw refcap filter pri linecnt getbase getoffset drag bmode mode getfile m2eff m2att m2fspeed m2prmscale m2body m2iner m2enable_blink m2enable_lip m2splay m2draw m2enable_eff sndtag strid get pathinfo getsavestr loop blur make remake getsavedate pause crossfade'.split(
    ' ',
  ),
);

export function objectCommand(s, o, sub, args, context = {}) {
  const player = s.player,
    p = (i, current) => (args[i] === undefined ? (current ?? 0) : s.value(args[i], current)),
    store = (i, v) => {
      if (args[i] !== undefined && p(i) >= 0) s.setGlobal(p(i), v);
    };
  const unsupported = (detail = '') =>
    s.diagnostic
      ? s.diagnostic(`unimplemented ${o.type} ${o.key}.${sub}${detail ? `: ${detail}` : ''}`)
      : player.unsupported(`${s.name}: ${o.type}.${sub}`);
  const isSound = o.type === 'SOUND' || o.type === 'SNDTABLE';
  const nativeResult = (result) => {
    const reply = (value) => (typeof value === 'number' ? { nativeReturn: value >>> 0 } : value);
    return result && typeof result.then === 'function' ? result.then(reply) : reply(result);
  };
  if (player?.nativeText?.supports(o) && FES_TEXT_VERBS.has(sub))
    return nativeResult(player.nativeText.command(s, o, sub, args, context));
  if (player?.nativeLog?.supports(o) && FES_BUILTIN_VERBS.has(sub) && sub !== 'delete')
    return nativeResult(player.nativeLog.command(s, o, sub, args, context));
  if (player?.nativeControls?.supports(o) && FES_BUILTIN_VERBS.has(sub) && sub !== 'delete')
    return nativeResult(player.nativeControls.command(s, o, sub, args, context));
  if (player?.nativeImages?.supports(o) && FES_BUILTIN_VERBS.has(sub) && sub !== 'delete')
    return nativeResult(player.nativeImages.command(s, o, sub, args, context));
  if (player?.nativeData?.supports(o) && FES_BUILTIN_VERBS.has(sub) && sub !== 'delete')
    return nativeResult(player.nativeData.command(s, o, sub, args, context));
  if (player?.nativeEffects?.supports(o) && FES_BUILTIN_VERBS.has(sub))
    return nativeResult(player.nativeEffects.command(s, o, sub, args, context));
  if (player?.nativePlanes?.supports(o) && FES_BUILTIN_VERBS.has(sub))
    return nativeResult(player.nativePlanes.command(s, o, sub, args, context));
  if (player?.nativeArea?.supports(o) && FES_BUILTIN_VERBS.has(sub))
    return nativeResult(player.nativeArea.command(s, o, sub, args, context));
  if (player?.nativeM2?.supports(o) && FES_M2_VERBS.has(sub))
    return nativeResult(player.nativeM2.command(s, o, sub, args, context));
  if (isSound && player.nativeSound) {
    return nativeResult(player.nativeSound.command(s, o, sub, args, context));
  }
  // Built-in object commands precede SUBCOMMAND lookup in native 769940.
  // These names have no built-in handler; they are defined by motion.h (or
  // another application header), so their exact KCS program must be executed.
  const rawDefinition = !FES_BUILTIN_VERBS.has(sub) && s.program?.subcommands?.[sub];
  if (rawDefinition) {
    if (player.nativeImages?.supports(o))
      return player.nativeImages.motion(s, o, motionDefinition(sub, rawDefinition), args);
    if (player.nativeControls?.supports(o))
      return player.nativeControls.motion(s, o, motionDefinition(sub, rawDefinition), args);
    if (player.nativeEffects?.supports(o))
      return player.nativeEffects.motion(s, o, motionDefinition(sub, rawDefinition), args);
    if (player.nativePlanes?.supports(o))
      return player.nativePlanes.motion(s, o, motionDefinition(sub, rawDefinition), args);
    if (player.nativeArea?.supports(o))
      return player.nativeArea.motion(s, o, motionDefinition(sub, rawDefinition), args);
    if (isSound) return unsupported('sound KX2 adapter is required');
    if (!player.motionLibrary) return unsupported('MOT script library is unavailable');
    const target = o.attachMotion(player.motionLibrary),
      definition = motionDefinition(sub, rawDefinition);
    const registers = motionRegisters(definition, args, target.state(), (expression, current) =>
      s.value(expression, current),
    );
    // Both declarations follow the same header path in frozen 75B020; the
    // declaration's group field remains zero. The KCS script controls exit.
    return target.add(definition.file, { registers, group: 0, delay: o.motionDelay >>> 0 });
  }
  if (player?.nativePlanes?.supports(o) || player?.nativeArea?.supports(o))
    return unsupported(`undeclared native object command ${sub}`);
  switch (sub) {
    case 'disp':
      o.disp = (args.length ? p(0) : 1) !== 0;
      if (o.disp) o.revealStart = player.frameCount;
      break;
    case 'enable':
      o.enable = (args.length ? p(0) : 1) !== 0;
      break;
    case 'setid':
      if (!['SLIDER', 'SCROLL2'].includes(o.type)) o.idIndex = Math.max(0, p(0, o.idIndex));
      break;
    case 'settbl':
      o.ids[p(0)] = p(1);
      break;
    case 'fade':
    case 'fade2':
      o.motion(
        args.length ? p(0) : 30,
        [isSound ? 'volume' : 'alpha'],
        [args.length > 1 ? p(1, isSound ? o.volume : o.alpha) : 0],
        [args.length > 2 ? p(2, isSound ? o.volume : o.alpha) : 255],
        sub === 'fade2' ? 'triangle' : 'linear',
      );
      if (isSound) unsupported('sound volume automation is not connected to the mixer');
      break;
    case 'move':
    case 'amove1':
    case 'amove2':
    case 'amove3':
      o.motion(p(0), ['x', 'y'], [o.x, o.y], [p(1), p(2)], sub === 'move' ? 'linear' : 'ease');
      break;
    case 'arc': {
      const change = Math.sin((p(2) * Math.PI) / 180) - Math.sin((p(1) * Math.PI) / 180);
      o.motion(p(0), ['x', 'y'], [o.x, o.y], [o.x + change * p(3), o.y + change * p(4)], 'ease');
      break;
    }
    case 'stop':
      if (isSound) player.sound({ channel: o.soundChannel, file: null });
      else {
        o.motionTarget?.stop(player.frameCount);
        o.motions = [];
      }
      break;
    case 'blend':
      if (isSound) o.volume = p(0, o.volume);
      else o.alpha = args.length ? p(0, o.alpha) : 255;
      break;
    case 'pos':
      if (['SCROLL', 'SLIDER', 'SCROLL2'].includes(o.type)) o.value = p(0, o.value);
      else if (o.type === 'LOGSTRING8') o.top = Math.max(0, p(0));
      else {
        o.x = p(0, o.x);
        o.y = p(1, o.y);
        o.z = p(2, o.z);
      }
      break;
    case 'pos2': {
      const ref = s.frameReference(args.length > 1 ? `${s.text(args[0])}:${p(1)}` : args[0]);
      if (ref) {
        o.x = ref.frame?.offsetX || 0;
        o.y = ref.frame?.offsetY || 0;
      }
      break;
    }
    case 'getpos':
      store(
        0,
        ['SCROLL', 'SLIDER', 'SCROLL2'].includes(o.type)
          ? o.value
          : o.type === 'LOGSTRING8'
            ? o.top
            : o.x,
      );
      if (args.length > 1) store(1, o.y);
      store(2, o.z);
      break;
    case 'getpos2': {
      const at = s.placement(o);
      store(0, at.x);
      store(1, at.y);
      store(2, at.z);
      break;
    }
    case 'base':
      o.baseX = p(0, o.baseX);
      o.baseY = p(1, o.baseY);
      o.baseZ = p(2, o.baseZ);
      break;
    case 'vram':
      o.vramX = p(0, o.vramX);
      o.vramY = p(1, o.vramY);
      o.vramZ = p(2, o.vramZ);
      break;
    case 'size':
      o.width = p(0, o.width);
      o.height = p(1, o.height);
      o.depth = p(2, o.depth);
      break;
    case 'getsize': {
      const f = player.picture(o.file)?.frame(o.currentID);
      store(0, o.width || f?.width || 0);
      store(1, o.height || f?.height || 0);
      store(2, o.depth);
      break;
    }
    case 'color':
      o.color = p(0, o.color) >>> 0;
      if (!['CIMAGE', 'CPLANE', 'PLANE'].includes(o.type))
        unsupported('image pixel fill requires renderer support');
      break;
    case 'pl':
      o.plane = args[0];
      break;
    case 'ref': {
      const source = s.elements(args[0])[0];
      if (source) o.file = source.file;
      else unsupported(`unknown image reference ${args[0]}`);
      break;
    }
    case 'noact':
      s.defaultButton = o.key;
      break;
    case 'setact':
      player.focusObject(s, o);
      break;
    case 'keypos':
      o.keyPosition = p(0) ? { x: p(1), y: p(2) } : null;
      break;
    case 'keyblock':
      o.keyblock = { block: p(0), x: p(1), y: p(2) };
      s.keyNames.add(o.baseName);
      break;
    case 'lock':
      o.lockedRect = p(0) ? structuredClone(s.rect(o)) : null;
      break;
    case 'ismot':
      store(0, Number(o.motionBusy));
      if (o.type === 'PARTICLE') unsupported('particle execution state is not available');
      break;
    case 'delay':
      o.motionDelay = p(0) >>> 0;
      break;
    case 'page':
      o.min = p(0);
      o.max = args.length > 1 ? p(1) : 10;
      o.page = p(2);
      break;
    case 'load':
      if (isSound) o.sound = s.text(args[0] || '');
      else {
        o.file = s.text(args[0] || '');
        if (args.length > 1) {
          o.ids[0] = p(1);
          o.idIndex = 0;
        }
        player.enqueue(player.loadPicture(o.file));
      }
      break;
    case 'sndtbl':
      o.soundTable[p(0)] = s.text(args[1]);
      break;
    case 'play':
      player.sound({
        channel: o.soundChannel,
        file:
          o.type === 'SNDTABLE'
            ? (o.soundTable[o.idIndex] ?? Object.values(o.soundTable)[0])
            : (o.sound ?? o.file),
        loop: args.length ? p(0) === 0 : o.loop,
        group: o.group ?? ['bgm', 'se', 'voice'][o.soundType],
        volume: o.volume,
      });
      if (args.length && p(0) > 1)
        unsupported('finite repeat count greater than one requires sound lifecycle scheduling');
      break;
    case 'channel':
      o.channel = p(0);
      break;
    case 'stype':
      o.soundType = p(0);
      break;
    case 'loop':
      o.loop = !!p(0);
      break;
    case 'getid':
      store(0, o.idIndex);
      break;
    case 'str':
      o.text = s.text(args.join(' '));
      o.revealStart = player.frameCount;
      break;
    case 'apend':
      o.text += s.text(args.join(' '));
      break;
    case 'clear':
      o.text = '';
      break;
    case 'draw':
      o.revealStart = player.frameCount;
      break;
    case 'isdraw':
      s.setLocal(0, Number(o.reveal(player.frameCount) < o.text.length));
      break;
    case 'skip':
      o.revealStart = -100000000;
      break;
    case 'reset':
      o.style = { size: 26, color: [255, 255, 255], edge: [0, 0, 0], revealFrame: 0 };
      break;
    case 'layout': {
      const values = ['size', 'color', 'frame'].includes(args[0])
        ? args.slice(1).map((a) => s.value(a))
        : [];
      if (args[0] === 'size') o.style.size = values[2] ?? values[0] ?? 26;
      if (args[0] === 'color') {
        o.style.color = values.slice(0, 3);
        if (values.length >= 6) o.style.edge = values.slice(3, 6);
      }
      if (args[0] === 'fontind') o.style.font = args[2];
      if (args[0] === 'frame') o.style.revealFrame = values[0];
      if (!['size', 'color', 'fontind', 'frame'].includes(args[0]))
        unsupported(`layout ${args[0]}`);
      break;
    }
    case 'dispid': {
      const ids = args.slice(1).flatMap((token) => {
        const match = /^\[(\d+)-(\d+)\]$/.exec(token);
        return match
          ? Array.from(
              { length: Math.abs(+match[2] - +match[1]) + 1 },
              (_, i) => +match[1] + i * Math.sign(+match[2] - +match[1]),
            )
          : [s.value(token)];
      });
      const set = new Set(o.shownIDs);
      for (const id of ids) {
        if (p(0)) set.add(id);
        else set.delete(id);
      }
      o.shownIDs = [...set];
      break;
    }
    case 'ptype':
      if (args[0] === 'SIMAGE') o.simage[p(1)] = [p(3), p(4)];
      else unsupported(`panel type ${args[0]}`);
      break;
    case 'setsave':
      o.slot = p(0);
      break;
    case 'getsavestr': {
      const info = player.host.saveInfo?.(o.slot),
        key = p(1) >>> 0;
      const date = info ? new Date(info.date) : null;
      player.strings[p(0)] =
        key === 0x201
          ? info?.title || ''
          : key === 0x200
            ? info?.comment || ''
            : key === 0x80000000 && date
              ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
              : key === 0x80000001 && date
                ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
                : '';
      break;
    }
    case 'getsavedate': {
      const info = player.host.saveInfo?.(o.slot);
      if (info) {
        const d = new Date(info.date);
        [
          d.getFullYear(),
          d.getMonth() + 1,
          d.getDate(),
          d.getHours(),
          d.getMinutes(),
          d.getSeconds(),
        ].forEach((v, i) => store(i, v));
      }
      break;
    }
    case 'setlog':
    case 'remake':
      o.top = Math.max(0, (player.host.log?.length || 0) - o.count);
      break;
    case 'max':
      store(0, player.host.log?.length || 0);
      break;
    case 'next':
      if (o.type === 'LOGSTRING8')
        o.top = Math.min(
          Math.max(0, (player.host.log?.length || 0) - o.count),
          o.top + (args.length ? p(0) : 1),
        );
      else o.idIndex++;
      break;
    case 'rev':
      if (o.type === 'LOGSTRING8') o.top = Math.max(0, o.top - 1);
      else o.idIndex = Math.max(0, o.idIndex - 1);
      break;
    case 'blockcolor':
      o.highlighted[p(0)] = p(1);
      break;
    case 'lineinfo': {
      o.lineInfo = p(0);
      const line = player.host.fesLogLine?.(o, p(0));
      if (line) {
        player.strings[p(1)] = line.scene;
        store(2, line.line);
      } else unsupported('host.fesLogLine does not provide source scene and line');
      break;
    }
    case 'pathinfo':
      unsupported('native replay path/step mapping is not available');
      break;
    case 'blockinfo': {
      const line = player.host.fesLogLine?.(o, p(0));
      if (line)
        [line.block, line.min, line.max, line.voices].forEach((value, i) => store(i + 1, value));
      else unsupported('host.fesLogLine does not provide logical text blocks');
      break;
    }
    case 'pri':
      o.pri = p(0, o.pri);
      break;
    case 'scale':
      o.scaleX = p(0, o.scaleX * 100) / 100;
      o.scaleY = p(1, o.scaleY * 100) / 100;
      break;
    case 'rot':
      o.rotationX = p(0, o.rotationX || 0);
      o.rotationY = p(1, o.rotationY || 0);
      o.rotation = p(2, o.rotation);
      break;
    case 'delete':
      o.deleted = true;
      o.disp = false;
      o.enable = false;
      o.motions = [];
      if (isSound) player.sound({ channel: o.soundChannel, file: null });
      s.byKey.delete(o.key);
      break;
    case 'crossfade':
    case 'setid_s':
    case 'setanm':
    case 'anm':
    case 'attr':
    case 'refex':
    case 'apendmark':
    case 'linecnt':
    case 'endpos':
    case 'userfont':
    case 'userfontobj':
    case 'attach':
      unsupported();
      break;
    default:
      unsupported();
  }
}
