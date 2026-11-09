// SPDX-License-Identifier: MPL-2.0
// Browser replacement for DirectShow graph/window services; each World owns its elements.
export class BrowserNativeMovie {
  constructor({ game, container, width, height, diagnostic = () => {}, timeout = 30000 }) {
    Object.assign(this, { game, container, width, height, diagnostic, timeout });
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.hidden = true;
    this.video.style.cssText =
      'position:absolute;inset:auto;object-fit:fill;pointer-events:none;background:#000';
    this.video.addEventListener('ended', () => {
      Promise.resolve(this.ended?.()).catch((error) =>
        this.diagnostic({ type: 'movie-completion-failed', message: error.message }),
      );
    });
    this.video.addEventListener('error', () => {
      Promise.resolve(
        this.error?.(new Error(this.video.error?.message || 'Movie decoder error')),
      ).catch((error) =>
        this.diagnostic({ type: 'movie-completion-failed', message: error.message }),
      );
    });
  }
  async open(name, stream = null) {
    if (!this.game.movieSource) throw new Error('Native movie source service is unavailable');
    if (stream?.audioEnabled !== undefined) this.video.muted = !stream.audioEnabled;
    this.source = await this.game.movieSource(name, (type) => this.video.canPlayType(type), stream);
    if (!this.source) {
      this.diagnostic({ type: 'movie-codec-unavailable', filename: name });
      return false;
    }
    return new Promise((resolve) => {
      const loaded = () => finish(true),
        failed = () => finish(false),
        timer = setTimeout(failed, this.timeout),
        finish = (success) => {
          clearTimeout(timer);
          this.video.removeEventListener('loadedmetadata', loaded);
          this.video.removeEventListener('error', failed);
          resolve(success);
        };
      this.video.addEventListener('loadedmetadata', loaded);
      this.video.addEventListener('error', failed);
      this.video.src = this.source.url;
      this.video.load();
    });
  }
  metadata() {
    const { videoWidth: width, videoHeight: height, duration } = this.video;
    if (!width || !height || !Number.isFinite(duration))
      throw new Error('Native movie decoder did not open a finite video stream');
    return {
      width,
      height,
      duration: BigInt(
        Math.round(
          duration * 10000000 /* exe-address-check: non-address - media time units per second */,
        ),
      ),
    };
  }
  async decodedFrame() {
    if (this.video.readyState < 2)
      await new Promise((resolve, reject) => {
        const finish = (error) => {
            clearTimeout(timer);
            this.video.removeEventListener('loadeddata', ready);
            this.video.removeEventListener('error', fail);
            error ? reject(error) : resolve();
          },
          ready = () => finish(),
          fail = () => finish(new Error('Native movie decoder could not supply a frame')),
          timer = setTimeout(
            () => finish(new Error('Native movie decoder frame timed out')),
            this.timeout,
          );
        this.video.addEventListener('loadeddata', ready);
        this.video.addEventListener('error', fail);
      });
    const { width, height } = this.metadata();
    this.frameCanvas ??= new OffscreenCanvas(width, height);
    const ctx = this.frameCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.video, 0, 0);
    return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
  }
  frameStamp() {
    // A detached texture movie may advance while its compositor count stays fixed.
    return this.position();
  }
  volume(decibels) {
    this.video.volume = Math.max(0, Math.min(1, 10 ** (decibels / 2000)));
  }
  async play() {
    try {
      await this.video.play();
      return true;
    } catch (error) {
      this.diagnostic({ type: 'movie-play-failed', message: error.message });
      return false;
    }
  }
  async stop() {
    this.video.pause();
    return true;
  }
  position() {
    return BigInt(
      Math.trunc(
        this.video.currentTime *
          10000000 /* exe-address-check: non-address - media time units per second */,
      ),
    );
  }
  async seek(position) {
    const seconds =
      Number(position) /
      10000000; /* exe-address-check: non-address - media time units per second */
    if (Math.abs(this.video.currentTime - seconds) < 0.0000001) return;
    if (seconds > 0)
      await new Promise((resolve, reject) => {
        const check = () => {
            if (
              this.video.readyState >= 2 &&
              Array.from(
                { length: this.video.seekable.length },
                (_, i) =>
                  seconds >= this.video.seekable.start(i) && seconds <= this.video.seekable.end(i),
              ).some(Boolean)
            ) {
              clearTimeout(timer);
              clearInterval(poll);
              resolve();
            }
          },
          timer = setTimeout(() => {
            clearInterval(poll);
            reject(new Error('Native movie source is not seekable at its saved position'));
          }, this.timeout),
          poll = setInterval(check, 20);
        check();
      });
    await new Promise((resolve, reject) => {
      const finish = (error) => {
          clearTimeout(timer);
          this.video.removeEventListener('seeked', seeked);
          this.video.removeEventListener('error', failed);
          error ? reject(error) : resolve();
        },
        seeked = () => finish(),
        failed = () => finish(new Error('Native movie seek failed')),
        timer = setTimeout(() => finish(new Error('Native movie seek timed out')), this.timeout);
      this.video.addEventListener('seeked', seeked);
      this.video.addEventListener('error', failed);
      try {
        this.video.currentTime = seconds;
      } catch (error) {
        finish(error);
      }
    });
    if (Math.abs(this.video.currentTime - seconds) > 0.1)
      throw new Error('Native movie decoder did not restore its saved position');
  }
  configure(record) {
    const [left, top, right, bottom] = record.rectangle;
    Object.assign(this.video.style, {
      left: `${(left * 100) / this.width}%`,
      top: `${(top * 100) / this.height}%`,
      width: `${(((right - left) | 0) * 100) / this.width}%`,
      height: `${(((bottom - top) | 0) * 100) / this.height}%`,
    });
    this.volume(record.decibels);
    this.video.hidden = !this.activated || !record.windowVisible;
    this.record = record;
  }
  redraw() {
    // HTML video participates in browser composition; exposing the element's
    // current decoded frame causes the same repaint without seeking/restarting.
    if (this.record?.prepared && this.record.running) this.video.getBoundingClientRect();
  }
  activate() {
    this.activated = true;
    this.container?.append(this.video);
    if (this.record) this.configure(this.record);
  }
  async close() {
    this.activated = false;
    this.video.pause();
    this.video.hidden = true;
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
    this.source?.release?.();
    this.source = null;
    this.frameCanvas = null;
  }
}
