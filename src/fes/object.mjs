// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESInstance / FESObject (OWCramer).
export class FESObject {
  constructor(type, baseName, index, handle) {
    Object.assign(this, {
      type,
      baseName,
      index,
      handle,
      key: index === null ? baseName : `${baseName}[${index}]`,
      file: null,
      ids: [],
      idIndex: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
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
      rotation: 0,
      motions: [],
      slot: null,
    });
  }
  get currentID() {
    return this.ids.length ? this.ids[Math.min(this.idIndex, this.ids.length - 1)] : this.idIndex;
  }
  get isPlane() {
    return this.type === 'PLANE' || this.type === 'CPLANE';
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
  advance() {
    for (const m of this.motions) {
      let t = Math.min(1, ++m.elapsed / m.frames);
      if (m.curve === 'ease') t = t * t * (3 - 2 * t);
      for (let i = 0; i < m.properties.length; i++)
        this[m.properties[i]] = m.from[i] + (m.to[i] - m.from[i]) * t;
    }
    this.motions = this.motions.filter((m) => m.elapsed < m.frames);
  }
  finish() {
    for (const m of this.motions)
      for (let i = 0; i < m.properties.length; i++) this[m.properties[i]] = m.to[i];
    this.motions = [];
  }
}

export const objectVerbs = new Set(
  'disp enable setid settbl fade fade2 move amove1 amove2 amove3 arc stop blend pos pos2 getpos getpos2 page load sndtbl play loop getid str apend clear draw isdraw skip reset layout dispid ptype setsave getsavestr getsavedate setlog remake max next rev blockcolor lineinfo pathinfo blockinfo pri scale rot crossfade noact setid_s setanm anm delay lock attr base refex apendmark linecnt endpos userfont userfontobj attach'.split(
    ' ',
  ),
);

export function objectCommand(s, o, sub, args) {
  const player = s.player,
    p = (i) => s.value(args[i] || '0'),
    store = (i, v) => {
      if (args[i] !== undefined) s.setGlobal(Number(args[i]), v);
    };
  const isSound = o.type === 'SOUND' || o.type === 'SNDTABLE';
  switch (sub) {
    case 'disp':
      o.disp = (args.length ? p(0) : 1) !== 0;
      if (o.disp) o.revealStart = player.frameCount;
      break;
    case 'enable':
      o.enable = (args.length ? p(0) : 1) !== 0;
      break;
    case 'setid':
      if (!['SLIDER', 'SCROLL2'].includes(o.type)) o.idIndex = Math.max(0, p(0));
      break;
    case 'settbl':
      o.ids[p(0)] = p(1);
      break;
    case 'fade':
    case 'fade2':
      o.motion(
        args.length ? p(0) : 30,
        ['alpha'],
        [args.length > 1 ? p(1) : 0],
        [args.length > 2 ? p(2) : 255],
      );
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
      if (isSound) player.sound({ channel: o.key, file: null });
      else o.finish();
      break;
    case 'blend':
      if (isSound) o.volume = p(0);
      else o.alpha = args.length ? p(0) : 255;
      break;
    case 'pos':
      if (['SLIDER', 'SCROLL2'].includes(o.type)) o.value = p(0);
      else if (o.type === 'LOGSTRING8') o.top = Math.max(0, p(0));
      else {
        o.x = p(0);
        o.y = p(1);
      }
      break;
    case 'pos2': {
      const ref = s.frameReference(args[0]);
      if (ref) {
        o.x = ref.frame?.offsetX || 0;
        o.y = ref.frame?.offsetY || 0;
      }
      break;
    }
    case 'getpos':
      store(
        0,
        ['SLIDER', 'SCROLL2'].includes(o.type) ? o.value : o.type === 'LOGSTRING8' ? o.top : o.x,
      );
      if (args.length > 1) store(1, o.y);
      break;
    case 'getpos2':
      store(0, o.x);
      store(1, o.y);
      break;
    case 'page':
      o.min = p(0);
      o.max = args.length > 1 ? p(1) : 10;
      o.page = p(2);
      break;
    case 'load':
      o.sound = s.text(args[0] || '');
      break;
    case 'sndtbl':
      o.soundTable[p(0)] = s.text(args[1]);
      break;
    case 'play':
      player.sound({
        channel: o.key,
        file:
          o.type === 'SNDTABLE'
            ? (o.soundTable[o.idIndex] ?? Object.values(o.soundTable)[0])
            : (o.sound ?? o.file),
        loop: o.type === 'SNDTABLE' || o.loop,
        group: o.group,
        volume: o.volume,
      });
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
      break;
    }
    case 'dispid': {
      const match = /^\[(\d+)-(\d+)\]$/.exec(args[1]);
      const ids = match
        ? Array.from(
            { length: Math.abs(+match[2] - +match[1]) + 1 },
            (_, i) => Math.min(+match[1], +match[2]) + i,
          )
        : [p(1)];
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
    case 'lineinfo':
      o.lineInfo = p(0);
      break;
    case 'pathinfo':
      store(1, p(0));
      store(2, 0);
      break;
    case 'blockinfo':
      store(args.length - 1, Number(!!player.host.log?.[p(0)]?.voice));
      break;
    case 'pri':
      o.pri = p(0);
      break;
    case 'scale':
      o.scaleX = p(0) / 100;
      o.scaleY = (args.length > 1 ? p(1) : p(0)) / 100;
      break;
    case 'rot':
      o.rotation = p(2) || p(0);
      break;
    case 'crossfade':
    case 'noact':
    case 'setid_s':
    case 'setanm':
    case 'anm':
    case 'delay':
    case 'lock':
    case 'attr':
    case 'base':
    case 'refex':
    case 'apendmark':
    case 'linecnt':
    case 'endpos':
    case 'userfont':
    case 'userfontobj':
    case 'attach':
      player.note(`FES object hint ${o.type}.${sub}`);
      break;
    default:
      player.unsupported(`${s.name}: ${o.type}.${sub}`);
  }
}
