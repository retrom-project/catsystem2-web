// SPDX-License-Identifier: MPL-2.0
import { readFontNames } from '../formats/font.mjs';
export class CanvasRenderer {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.images = images;
    this.frames = new WeakMap();
    this.fonts = new Map();
    this.loadedFaces = new Set();
    this.fontFaces = new Set();
    this.base = new OffscreenCanvas(canvas.width, canvas.height);
    this.baseContext = this.base.getContext('2d');
    this.buffer = new OffscreenCanvas(canvas.width, canvas.height);
    this.ctx = this.buffer.getContext('2d');
  }
  frameCanvas(frame) {
    if (!this.frames.has(frame)) {
      const c = new OffscreenCanvas(frame.width, frame.height);
      if (frame.width && frame.height)
        c.getContext('2d').putImageData(
          new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height),
          0,
          0,
        );
      this.frames.set(frame, c);
    }
    return this.frames.get(frame);
  }
  snapshotBase() {
    this.baseContext.clearRect(0, 0, this.base.width, this.base.height);
    this.baseContext.drawImage(this.canvas, 0, 0);
  }
  clearBase() {
    this.baseContext.clearRect(0, 0, this.base.width, this.base.height);
  }
  begin() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.buffer.width, this.buffer.height);
  }
  present() {
    this.context.drawImage(this.buffer, 0, 0);
  }
  async image(name, id, x, y, alpha = 1, options = {}) {
    const frame = await this.images.frame(name, id),
      ctx = options.context || this.ctx;
    if (!frame.width || !frame.height) return frame;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.scale(options.flipX ? -1 : 1, options.flipY ? -1 : 1);
    if (options.filter) ctx.filter = options.filter;
    ctx.drawImage(
      this.frameCanvas(frame),
      options.flipX ? -(options.width || frame.width) : 0,
      options.flipY ? -(options.height || frame.height) : 0,
      options.width || frame.width,
      options.height || frame.height,
    );
    ctx.restore();
    return frame;
  }
  async fes(players, overlay = false, context = this.ctx) {
    if (!overlay) {
      context.reset();
      context.fillStyle = '#000';
      context.fillRect(0, 0, context.canvas.width, context.canvas.height);
      context.drawImage(this.base, 0, 0);
    }
    const drawImage = (name, id, x, y, alpha = 1, options = {}) =>
      this.image(name, id, x, y, alpha, { ...options, context });
    const text = (value, x, y, width, style = {}) => this.text(value, x, y, width, style, context);
    const draws = [];
    for (const player of Array.isArray(players) ? players : [players])
      for (const s of player.instances)
        for (const o of s.objects) {
          const at = s.placement(o);
          if (!o.disp || !at.shown || at.alpha <= 0) continue;
          const plane = s.plane(o);
          draws.push({
            player,
            s,
            o,
            at,
            pri: o.plane && plane ? plane.pri : o.pri,
            sub: o.plane ? o.pri : -Infinity,
          });
        }
    draws.sort((a, b) => a.pri - b.pri || a.sub - b.sub);
    for (const { player, s, o, at } of draws) {
      const ctx = context;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, at.alpha / 255));
      if (o.rotation) {
        ctx.translate(at.x, at.y);
        ctx.rotate((o.rotation * Math.PI) / 180);
        ctx.translate(-at.x, -at.y);
      }
      if (o.type === 'STRING8')
        text(
          o.text.slice(0, o.reveal(player.frameCount)),
          at.x,
          at.y,
          o.areaWidth || context.canvas.width - at.x,
          o.style,
        );
      else if (o.type === 'DIFIMAGE') await player.host.drawFace?.(o, ctx, at);
      else if (o.type === 'LOGSTRING8') {
        for (let i = 0; i < o.count; i++) {
          const entry = player.host.log?.[o.top + i];
          if (!entry) continue;
          const area = player.picture(o.areaFile)?.frame((o.areaID || 0) + i);
          text(
            entry.text,
            area?.offsetX ?? at.x,
            area?.offsetY ?? at.y + i * 155,
            area?.width || 802,
            { ...o.style, color: o.highlighted[i] ? [255, 192, 128] : o.style.color },
          );
        }
      } else if (o.type === 'SAVEPANEL' && o.file) {
        const image = player.picture(o.file);
        for (const id of o.shownIDs.toSorted((a, b) => a - b)) {
          const f = image?.frame(id);
          if (!f) continue;
          const info = player.host.saveInfo?.(o.slot);
          if (o.simage[id] && info?.thumbnail) {
            const thumb = await this.thumbnail(info.thumbnail);
            ctx.drawImage(thumb, at.x + f.offsetX, at.y + f.offsetY, ...o.simage[id]);
          } else await drawImage(player.expand(o.file), id, at.x + f.offsetX, at.y + f.offsetY);
        }
      } else if (['SLIDER', 'SCROLL2'].includes(o.type) && o.file) {
        const k = player.knob(s, o);
        if (o.type === 'SLIDER')
          await drawImage(
            player.expand(o.file),
            player.dragging?.o === o ? 3 : player.focused?.o === o ? 2 : o.enable ? 0 : 1,
            k.x,
            k.y,
          );
        else {
          const top = player.picture(o.file)?.frame(1),
            bottom = player.picture(o.file)?.frame(2);
          await drawImage(player.expand(o.file), 1, k.x, k.y);
          await drawImage(player.expand(o.file), 0, k.x, k.y + (top?.height || 0), 1, {
            width: k.w,
            height: Math.max(1, k.h - (top?.height || 0) - (bottom?.height || 0)),
          });
          await drawImage(player.expand(o.file), 2, k.x, k.y + k.h - (bottom?.height || 0));
        }
      } else if (o.color !== undefined && o.width > 0) {
        const a = ['CPLANE', 'CIMAGE'].includes(o.type) ? 255 : o.color >>> 24;
        ctx.fillStyle = `rgba(${(o.color >>> 16) & 255},${(o.color >>> 8) & 255},${o.color & 255},${a / 255})`;
        ctx.fillRect(at.x, at.y, o.width, o.height);
      } else if (o.file && player.picture(o.file)) {
        const image = player.picture(o.file),
          f = image.frame(o.currentID) || (!o.ids.length ? image.frames[0] : null);
        if (f)
          await drawImage(player.expand(o.file), f.id, at.x + f.offsetX, at.y + f.offsetY, 1, {
            width: f.width * o.scaleX,
            height: f.height * o.scaleY,
          });
      }
      ctx.restore();
    }
  }
  text(text, x, y, maxWidth, style = {}, context = this.ctx) {
    const ctx = context,
      size = style.size || 26,
      family = this.fonts.get(style.font?.toLowerCase()) || this.defaultFont || 'sans-serif';
    ctx.save();
    ctx.font = `${size}px "${family}"`;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.fillStyle = `rgb(${(style.color || [255, 255, 255]).join(',')})`;
    ctx.strokeStyle = `rgb(${(style.edge || [0, 0, 0]).join(',')})`;
    ctx.lineWidth = style.outline ?? 2;
    const words = text.match(/[A-Za-z0-9'’.,!?;:()-]+|[^\n]|\n/g) || [];
    let line = '',
      atY = y;
    const draw = () => {
      if (ctx.lineWidth) ctx.strokeText(line, x, atY);
      ctx.fillText(line, x, atY);
      line = '';
      atY += size * 1.35;
    };
    for (const word of words) {
      if (word === '\n') {
        draw();
        continue;
      }
      if (line && ctx.measureText(line + word).width > maxWidth) draw();
      line += word;
    }
    draw();
    ctx.restore();
    return atY;
  }
  async thumbnail(data) {
    this.thumbs ||= new Map();
    if (!this.thumbs.has(data))
      this.thumbs.set(data, createImageBitmap(await (await fetch(data)).blob()));
    return this.thumbs.get(data);
  }
  async loadFonts(game) {
    for (const name of [...game.names('ttf'), ...game.names('otf')]) {
      const bytes = await game.require(name),
        metadata = readFontNames(bytes),
        family = `cat_${name.replace(/[^\w]/g, '_')}`,
        font = new FontFace(family, bytes, { weight: String(metadata.weight) });
      await font.load();
      document.fonts.add(font);
      this.fontFaces.add(font);
      this.fonts.set(name.toLowerCase(), family);
      for (const face of metadata.names) {
        this.fonts.set(face.toLowerCase(), family);
        this.loadedFaces.add(face.toLowerCase());
      }
      if (!this.defaultFont || /gothic|goth|noto|sans/i.test(name)) this.defaultFont = family;
    }
  }
  fontAvailable(name) {
    return this.loadedFaces.has(name.toLowerCase());
  }
  async dispose() {
    for (const face of this.fontFaces) document.fonts.delete(face);
    this.fontFaces.clear();
    this.fonts.clear();
    this.loadedFaces.clear();
    this.frames = new WeakMap();
    for (const thumbnail of this.thumbs?.values() || []) (await thumbnail).close();
    this.thumbs?.clear();
    this.base.width = this.base.height = this.buffer.width = this.buffer.height = 0;
  }
}
