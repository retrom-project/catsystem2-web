// SPDX-License-Identifier: MPL-2.0
// WebGL2 backend for the CatSystemKit-derived E-mote draw list.
const vertexSource = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 grid;
uniform sampler2D nodes;
uniform int nodeIndex;
uniform vec4 iconRect;
uniform vec2 iconOrigin;
uniform vec2 textureSize;
uniform vec2 resolution;
out vec2 uv;
vec4 cubic(float t) { float q=1.0-t; return vec4(q*q*q,3.0*t*q*q,3.0*t*t*q,t*t*t); }
void main() {
  vec2 p=grid*iconRect.zw-iconOrigin;
  int index=nodeIndex;
  for(int depth=0; depth<96; depth++) {
    if(index<0) break;
    vec4 m=texelFetch(nodes,ivec2(0,index),0);
    vec4 o=texelFetch(nodes,ivec2(1,index),0);
    vec4 info=texelFetch(nodes,ivec2(2,index),0);
    if(info.w>0.5) {
      vec2 t=(p+o.zw)/info.xy;
      vec4 bu=cubic(t.x),bv=cubic(t.y);
      vec2 q=vec2(0.0);
      for(int j=0;j<4;j++) {
        vec4 p0=texelFetch(nodes,ivec2(3+j*2,index),0);
        vec4 p1=texelFetch(nodes,ivec2(4+j*2,index),0);
        q+=(p0.xy*bu.x+p0.zw*bu.y+p1.xy*bu.z+p1.zw*bu.w)*bv[j];
      }
      p=q*info.xy-o.zw;
    }
    p=mat2(m.xy,m.zw)*p+o.xy;
    index=int(info.z);
  }
  gl_Position=vec4(p/resolution*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
  uv=(iconRect.xy+grid*iconRect.zw)/textureSize;
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D atlas;
uniform sampler2D mask0;
uniform sampler2D mask1;
uniform sampler2D mask2;
uniform sampler2D mask3;
uniform int clipCount;
uniform float opacity;
uniform vec2 resolution;
out vec4 color;
void main() {
  color=texture(atlas,uv).bgra;
  color.a*=opacity;
  vec2 p=gl_FragCoord.xy/resolution;
  if(clipCount>0) color.a*=texture(mask0,p).a;
  if(clipCount>1) color.a*=texture(mask1,p).a;
  if(clipCount>2) color.a*=texture(mask2,p).a;
  if(clipCount>3) color.a*=texture(mask3,p).a;
  color.rgb*=color.a;
}`;

export class EmoteGL {
  constructor(width, height) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = (this.gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    }));
    if (!gl) throw new Error('E-mote rendering requires WebGL2');
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = (this.program = gl.createProgram());
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    this.uniform = Object.fromEntries(
      [
        'nodes',
        'nodeIndex',
        'iconRect',
        'iconOrigin',
        'textureSize',
        'resolution',
        'atlas',
        'mask0',
        'mask1',
        'mask2',
        'mask3',
        'clipCount',
        'opacity',
      ].map((n) => [n, gl.getUniformLocation(program, n)]),
    );
    gl.uniform1i(this.uniform.atlas, 0);
    gl.uniform1i(this.uniform.nodes, 1);
    for (let i = 0; i < 4; i++) gl.uniform1i(this.uniform[`mask${i}`], i + 2);
    gl.uniform2f(this.uniform.resolution, width, height);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.nodeTexture = this.texture(gl.NEAREST);
    this.whiteTexture = this.texture(gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    this.grids = new Map();
    this.models = new Map();
    this.maskTargets = [];
  }
  texture(filter) {
    const gl = this.gl,
      t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  upload(model) {
    const gl = this.gl;
    if (this.models.has(model)) return this.models.get(model);
    gl.activeTexture(gl.TEXTURE0);
    const textures = model.textures.map((t) => {
      if (
        t.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
        t.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)
      )
        throw new Error('E-mote atlas exceeds GPU texture limit');
      const texture = this.texture(gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        t.width,
        t.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        t.pixels,
      );
      return texture;
    });
    this.models.set(model, textures);
    return textures;
  }
  release(model) {
    const textures = this.models.get(model);
    if (textures) for (const t of textures) this.gl.deleteTexture(t);
    this.models.delete(model);
  }
  grid(n) {
    if (this.grids.has(n)) return this.grids.get(n);
    const gl = this.gl,
      vertices = [],
      indices = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vertices.push(i / n, j / n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i,
          b = a + 1,
          c = a + n + 1,
          d = c + 1;
        indices.push(a, b, c, c, b, d);
      }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vertex = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    const grid = { vao, count: indices.length, vertex, index };
    this.grids.set(n, grid);
    return grid;
  }
  maskTarget(index) {
    const gl = this.gl;
    if (!this.maskTargets[index]) {
      gl.activeTexture(gl.TEXTURE0);
      const texture = this.texture(gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      const buffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('E-mote stencil framebuffer incomplete');
      this.maskTargets[index] = { texture, buffer };
    }
    return this.maskTargets[index];
  }
  render(model, list, alpha = 1) {
    const gl = this.gl,
      textures = this.upload(model),
      data = new Float32Array(list.nodes.length * 48);
    list.nodes.forEach((n, i) => {
      const at = i * 48,
        [a, b, c, d, tx, ty] = n.transform,
        [ox, oy, w, h] = n.box;
      data.set([a, b, c, d, tx, ty, ox, oy, w, h, n.parent, n.mesh ? 1 : 0], at);
      if (n.mesh) data.set(n.mesh, at + 12);
    });
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.nodeTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 12, list.nodes.length, 0, gl.RGBA, gl.FLOAT, data);
    // A mask must never remain sampled while that same texture is attached for drawing.
    for (let i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE2 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
    }
    const draw = (item, masked) => {
      const t = model.textures[item.texture],
        icon = item.icon,
        grid = this.grid(item.divisions);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures[item.texture]);
      gl.bindVertexArray(grid.vao);
      gl.uniform1i(this.uniform.nodeIndex, item.node);
      gl.uniform4f(this.uniform.iconRect, icon.left || 0, icon.top || 0, icon.width, icon.height);
      gl.uniform2f(this.uniform.iconOrigin, icon.originX || 0, icon.originY || 0);
      gl.uniform2f(this.uniform.textureSize, t.width, t.height);
      gl.uniform1f(this.uniform.opacity, masked ? 1 : item.opacity * alpha);
      const clips = masked ? [] : item.clips;
      if (clips.length > 4) throw new Error('E-mote stencil nesting exceeds four');
      gl.uniform1i(this.uniform.clipCount, clips.length);
      clips.forEach((id, i) => {
        gl.activeTexture(gl.TEXTURE2 + i);
        gl.bindTexture(gl.TEXTURE_2D, this.maskTarget(id).texture);
      });
      gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_SHORT, 0);
    };
    for (let i = 0; i < list.masks.length; i++) {
      const target = this.maskTarget(i);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (const item of list.masks[i]) draw(item, true);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const item of list.items) draw(item, false);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`E-mote WebGL error ${error}`);
    return this.canvas;
  }
  dispose() {
    const gl = this.gl;
    for (const model of this.models.keys()) this.release(model);
    for (const grid of this.grids.values()) {
      gl.deleteBuffer(grid.vertex);
      gl.deleteBuffer(grid.index);
      gl.deleteVertexArray(grid.vao);
    }
    for (const m of this.maskTargets) {
      gl.deleteFramebuffer(m.buffer);
      gl.deleteTexture(m.texture);
    }
    gl.deleteTexture(this.nodeTexture);
    gl.deleteTexture(this.whiteTexture);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
