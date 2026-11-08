// SPDX-License-Identifier: MPL-2.0
import { PARTICLE_BLEND_FACTORS } from '../ppi/abi.mjs';
import { bitsFloat } from '../kcs/vm.mjs';
import { advanceD3DContext } from '../ppi/render-state.mjs';
const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec4 position;
layout(location=1) in vec4 diffuse;
layout(location=2) in vec2 texcoord;
uniform vec2 resolution;
uniform bool backgroundPass;
out vec4 vertexColor;
out vec2 uv;
void main(){
  float clipW=backgroundPass?1.0:1.0/position.w;
  vec2 xy=position.xy+(backgroundPass?vec2(0.0):vec2(0.5));
  gl_Position=vec4((xy/resolution*vec2(2.0,2.0)-vec2(1.0))*clipW,(position.z*2.0-1.0)*clipW,clipW);
  vertexColor=diffuse;uv=texcoord;gl_PointSize=1.0;
}`;
const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
in vec4 vertexColor;
in vec2 uv;
uniform sampler2D image;
uniform bool backgroundPass;
uniform ivec2 addressMode;
uniform ivec2 filters;
uniform vec4 borderColor;
uniform bool srgbTexture;
uniform ivec2 textureOperations;
uniform ivec3 textureColorArgs;
uniform ivec3 textureAlphaArgs;
uniform vec4 textureFactor;
uniform vec4 textureConstant;
uniform bool nativeAnisotropy;
uniform float maxAnisotropy;
uniform bool srgbWrite;
uniform sampler2D destination;
uniform bool blending;
uniform ivec4 blendFactors;
uniform ivec2 blendOperations;
uniform vec4 blendConstant;
uniform bool fogEnabled;
uniform int fogMode;
uniform vec4 fogParameters;
uniform vec3 fogColor;
uniform bool lineAntialias;
uniform vec4 lineSegment;
uniform bool alphaTest;
uniform int alphaFunction;
uniform float alphaReference;
out vec4 color;
vec3 linearColor(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
vec3 encodedColor(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
vec4 factor(int mode,vec4 src,vec4 dst){
  if(mode==1)return vec4(0.0);if(mode==2)return vec4(1.0);
  if(mode==3)return src;if(mode==4)return 1.0-src;
  if(mode==5)return vec4(src.a);if(mode==6)return vec4(1.0-src.a);
  if(mode==7)return vec4(dst.a);if(mode==8)return vec4(1.0-dst.a);
  if(mode==9)return dst;if(mode==10)return 1.0-dst;
  if(mode==11)return vec4(vec3(min(src.a,1.0-dst.a)),1.0);
  if(mode==14)return blendConstant;return 1.0-blendConstant;
}
vec4 blendResult(vec4 src,vec4 dst){
  vec4 a=src*factor(blendFactors.x,src,dst),b=dst*factor(blendFactors.y,src,dst);
  float c=src.a*factor(blendFactors.z,src,dst).a,d=dst.a*factor(blendFactors.w,src,dst).a;
  vec3 rgb=blendOperations.x==2?a.rgb-b.rgb:blendOperations.x==3?b.rgb-a.rgb:blendOperations.x==4?min(src.rgb,dst.rgb):blendOperations.x==5?max(src.rgb,dst.rgb):a.rgb+b.rgb;
  float alpha=blendOperations.y==2?c-d:blendOperations.y==3?d-c:blendOperations.y==4?min(src.a,dst.a):blendOperations.y==5?max(src.a,dst.a):c+d;
  return clamp(vec4(rgb,alpha),0.0,1.0);
}
int address(int coordinate,int size,int mode){
  if(mode==1)return (coordinate%size+size)%size;
  if(mode==2){int n=(coordinate%(size*2)+size*2)%(size*2);return n<size?n:size*2-1-n;}
  if(mode==5)coordinate=coordinate<0?-coordinate-1:coordinate;
  return clamp(coordinate,0,size-1);
}
vec4 texel(ivec2 coordinate,ivec2 size){
  if((addressMode.x==4&&(coordinate.x<0||coordinate.x>=size.x))||(addressMode.y==4&&(coordinate.y<0||coordinate.y>=size.y)))return borderColor;
  vec4 value=texelFetch(image,ivec2(address(coordinate.x,size.x,addressMode.x),address(coordinate.y,size.y,addressMode.y)),0);
  if(srgbTexture)value.rgb=linearColor(value.rgb);return value;
}
vec4 sampleImage(){
  ivec2 size=textureSize(image,0);vec2 at=uv*vec2(size);
  vec2 dx=dFdx(at),dy=dFdy(at);int filterType=max(dot(dx,dx),dot(dy,dy))>1.0?filters.x:filters.y;
  if(filterType==1)return texel(ivec2(floor(at)),size);
  if(filterType==3&&nativeAnisotropy){vec2 p=uv;if(addressMode.x==5)p.x=abs(p.x);if(addressMode.y==5)p.y=abs(p.y);vec4 value=textureGrad(image,p,dFdx(p),dFdy(p));if(srgbTexture)value.rgb=linearColor(value.rgb);return value;}
  vec2 p=at-0.5,weight=fract(p);ivec2 lo=ivec2(floor(p));
  if(filterType==3){
    vec2 major=dot(dx,dx)>dot(dy,dy)?dx:dy,minor=dot(dx,dx)>dot(dy,dy)?dy:dx;
    int count=int(clamp(ceil(length(major)/max(1.0,length(minor))),1.0,maxAnisotropy));vec4 sum=vec4(0.0);
    for(int i=0;i<16;i++){if(i>=count)break;vec2 point=at+major*((float(i)+0.5)/float(count)-0.5)-0.5;ivec2 a=ivec2(floor(point));vec2 w=fract(point);sum+=mix(mix(texel(a,size),texel(a+ivec2(1,0),size),w.x),mix(texel(a+ivec2(0,1),size),texel(a+ivec2(1,1),size),w.x),w.y);}
    return sum/float(count);
  }
  return mix(mix(texel(lo,size),texel(lo+ivec2(1,0),size),weight.x),mix(texel(lo+ivec2(0,1),size),texel(lo+ivec2(1,1),size),weight.x),weight.y);
}
vec4 textureArgument(int mode,vec4 tex){
  int base=mode&15;
  vec4 v=base==0||base==1?vertexColor:base==2?tex:base==3?textureFactor:base==6?textureConstant:vec4(0.0);
  if((mode&16)!=0)v=1.0-v;if((mode&32)!=0)v=vec4(v.a);return v;
}
vec4 textureOperation(int mode,vec4 a,vec4 b,vec4 c,vec4 tex){
  if(mode==1)return vertexColor;if(mode==2)return a;if(mode==3)return b;
  if(mode==4)return a*b;if(mode==5)return a*b*2.0;if(mode==6)return a*b*4.0;
  if(mode==7)return a+b;if(mode==8)return a+b-0.5;if(mode==9)return (a+b-0.5)*2.0;
  if(mode==10)return a-b;if(mode==11)return a+b*(1.0-a);
  if(mode==12)return mix(b,a,vertexColor.a);if(mode==13)return mix(b,a,tex.a);
  if(mode==14)return mix(b,a,textureFactor.a);if(mode==15)return a+b*(1.0-tex.a);
  if(mode==16)return mix(b,a,vertexColor.a);
  if(mode==18)return vec4(a.rgb+b.rgb*a.a,a.a*b.a);
  if(mode==19)return vec4(a.rgb*b.rgb+a.a,a.a*b.a);
  if(mode==20)return vec4(a.rgb+b.rgb*(1.0-a.a),a.a*b.a);
  if(mode==21)return vec4((1.0-a.rgb)*b.rgb+a.a,a.a*b.a);
  if(mode==24)return vec4(dot(a.rgb*2.0-1.0,b.rgb*2.0-1.0));
  if(mode==25)return a*b+c;if(mode==26)return mix(b,a,c);
  return vec4(0.0);
}
void main(){
  if(backgroundPass){color=texture(image,uv);return;}
  vec4 tex=sampleImage();
  color=textureOperation(textureOperations.x,textureArgument(textureColorArgs.x,tex),textureArgument(textureColorArgs.y,tex),textureArgument(textureColorArgs.z,tex),tex);
  if(textureOperations.x!=1)color.a=textureOperation(textureOperations.y,textureArgument(textureAlphaArgs.x,tex),textureArgument(textureAlphaArgs.y,tex),textureArgument(textureAlphaArgs.z,tex),tex).a;
  color=clamp(color,0.0,1.0);
  if(alphaTest){float a=floor(color.a*255.0+0.5);bool pass=alphaFunction==8||(alphaFunction==2&&a<alphaReference)||(alphaFunction==3&&a==alphaReference)||(alphaFunction==4&&a<=alphaReference)||(alphaFunction==5&&a>alphaReference)||(alphaFunction==6&&a!=alphaReference)||(alphaFunction==7&&a>=alphaReference);if(!pass)discard;}
  if(lineAntialias){vec2 delta=lineSegment.zw-lineSegment.xy;float len=length(delta);vec2 axis=delta/len,p=gl_FragCoord.xy-0.5-lineSegment.xy;float along=dot(p,axis),distance=abs(p.x*axis.y-p.y*axis.x);color.a*=clamp(1.0-distance,0.0,1.0)*clamp(along+0.5,0.0,1.0)*clamp(len-along+0.5,0.0,1.0);}
  if(fogEnabled){
    float depth=abs(gl_FragCoord.z),f=0.0;
    if(fogMode==1)f=exp(-fogParameters.z*depth);
    if(fogMode==2)f=exp(-pow(fogParameters.z*depth,2.0));
    if(fogMode==3)f=(fogParameters.y-depth)/(fogParameters.y-fogParameters.x);
    color.rgb=mix(fogColor,color.rgb,clamp(f,0.0,1.0));
  }
  if(srgbWrite){
    if(blending){vec4 dst=texelFetch(destination,ivec2(gl_FragCoord.xy),0);dst.rgb=linearColor(dst.rgb);color=blendResult(color,dst);}
    color.rgb=encodedColor(color.rgb);
  }
}`;
const stateDefaults = new Map([
  [7, 0],
  [8, 3],
  [9, 2],
  [14, 1],
  [15, 1],
  [16, 0],
  [19, 5],
  [20, 6],
  [22, 1],
  [23, 4],
  [24, 1],
  [25, 7],
  [26, 0],
  [27, 1],
  [28, 0],
  [29, 0],
  [34, 0],
  [35, 0],
  [36, 0],
  [37, 0x3f800000],
  [38, 0x3f800000],
  [48, 0],
  [52, 0],
  [53, 1],
  [54, 1],
  [55, 1],
  [56, 8],
  [57, 0],
  [58, 0xffffffff],
  [59, 0xffffffff],
  [60, 0xffffffff],
  ...Array.from({ length: 8 }, (_, i) => [128 + i, 0]),
  [136, 1],
  [137, 0],
  [139, 0],
  [140, 0],
  [141, 1],
  [142, 1],
  [143, 0],
  [145, 1],
  [146, 2],
  [147, 2],
  [148, 0],
  [151, 0],
  [152, 0],
  [154, 0x3f800000],
  [155, 0x3f800000],
  [156, 0],
  [157, 0],
  [158, 0x3f800000],
  [159, 0],
  [160, 0],
  [161, 0],
  [162, 0xffffffff],
  [163, 0],
  [165, 0],
  [166, 0x42800000],
  [167, 0],
  [168, 15],
  [170, 0],
  [171, 1],
  [172, 3],
  [173, 1],
  [174, 0],
  [175, 0],
  [176, 0],
  [178, 0x3f800000],
  [179, 0x3f800000],
  [180, 0],
  [181, 0],
  [182, 0x3f800000],
  [183, 0],
  [184, 0],
  [185, 0],
  [186, 1],
  [187, 1],
  [188, 1],
  [189, 8],
  [190, 15],
  [191, 15],
  [192, 15],
  [193, 0xffffffff],
  [194, 0],
  [195, 0],
  ...Array.from({ length: 8 }, (_, i) => [198 + i, 0]),
  [206, 0],
  [207, 2],
  [208, 1],
  [209, 1],
]);
function colorVector(word) {
  return [
    ((word >>> 16) & 255) / 255,
    ((word >>> 8) & 255) / 255,
    (word & 255) / 255,
    (word >>> 24) / 255,
  ];
}
function values(input) {
  return input instanceof Map ? input : new Map(input || []);
}

export function createD3DContext({
  depthStencilEnabled = false,
  magFilter = 2,
  minFilter = 2,
  multisampleAntialias = 0,
} = {}) {
  const { states, samplers } = particleRenderState();
  return {
    states,
    samplers,
    stages: new Map(),
    lastDrawType: 7,
    lastBlend: 7,
    depthStencilEnabled,
    magFilter,
    minFilter,
    multisampleAntialias,
  };
}
export function snapshotD3DContext(context) {
  return {
    ...context,
    states: [...context.states],
    samplers: [...context.samplers],
    stages: [...context.stages].map(([stage, states]) => [stage, [...states]]),
  };
}
export function restoreD3DContext(state) {
  return {
    ...state,
    states: new Map(state.states),
    samplers: new Map(state.samplers),
    stages: new Map(state.stages.map(([stage, states]) => [stage, new Map(states)])),
  };
}

export function particleRenderState(blendMode = 0, renderStates = [], samplerStates = []) {
  const blend = PARTICLE_BLEND_FACTORS[blendMode] || PARTICLE_BLEND_FACTORS[0],
    states = new Map(stateDefaults),
    samplers = new Map([
      [1, 2],
      [2, 2],
      [3, 1],
      [4, 0],
      [5, 2],
      [6, 2],
      [7, 0],
      [8, 0],
      [9, 0],
      [10, 1],
      [11, 0],
      [12, 0],
      [13, 0],
    ]);
  states.set(19, blend.d3dSource);
  states.set(20, blend.d3dDestination);
  for (const [id, value] of values(renderStates)) {
    if (!states.has(id))
      throw new Error(
        `PPI D3D render state ${id} requires a graphics capability outside transformed particle draws`,
      );
    states.set(id, value >>> 0);
  }
  for (const [id, value] of values(samplerStates)) {
    if (!samplers.has(id)) throw new Error(`Unknown PPI D3D sampler state ${id}`);
    if ([1, 2, 3].includes(id) && (value < 1 || value > 5))
      throw new Error(`Invalid PPI address mode ${value}`);
    if ([5, 6].includes(id) && ![1, 2, 3].includes(value))
      throw new Error(`PPI filter ${value} is not a D3D9 2D texture min/magnification filter`);
    if (id === 7 && value > 2) throw new Error(`Invalid PPI mip filter ${value}`);
    if (id === 12 && value)
      throw new Error('PPI multielement textures require an image source with multiple elements');
    samplers.set(id, value >>> 0);
  }
  if (states.get(7) > 2) throw new Error('Invalid PPI depth-buffer mode');
  if (states.get(9) > 2)
    throw new Error('PPI Phong shading is not a transformed diffuse-vertex capability');
  for (const key of [23, 25, 56, 189])
    if (states.get(key) < 1 || states.get(key) > 8)
      throw new Error(`Invalid PPI comparison state ${key}`);
  for (const key of [35, 140])
    if (states.get(key) > 3) throw new Error(`Invalid PPI fog mode ${states.get(key)}`);
  if (states.get(8) < 1 || states.get(8) > 3 || states.get(22) < 1 || states.get(22) > 3)
    throw new Error('Invalid PPI fill/cull mode');
  return { states, samplers };
}

export class ParticlesGL {
  constructor(width, height) {
    this.canvas = new OffscreenCanvas(width, height);
    this.gl = this.canvas.getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      depth: true,
      stencil: true,
    });
    const gl = this.gl;
    if (!gl) throw new Error('Particle rendering requires WebGL2');
    this.anisotropy =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.maxAnisotropy = this.anisotropy
      ? gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
      : 16;
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    this.program = gl.createProgram();
    gl.attachShader(this.program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(this.program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);
    this.uniform = Object.fromEntries(
      [
        'resolution',
        'backgroundPass',
        'image',
        'addressMode',
        'filters',
        'borderColor',
        'srgbTexture',
        'textureOperations',
        'textureColorArgs',
        'textureAlphaArgs',
        'textureFactor',
        'textureConstant',
        'nativeAnisotropy',
        'maxAnisotropy',
        'srgbWrite',
        'destination',
        'blending',
        'blendFactors',
        'blendOperations',
        'blendConstant',
        'fogEnabled',
        'fogMode',
        'fogParameters',
        'fogColor',
        'lineAntialias',
        'lineSegment',
        'alphaTest',
        'alphaFunction',
        'alphaReference',
      ].map((n) => [n, gl.getUniformLocation(this.program, n)]),
    );
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (const [index, size, offset] of [
      [0, 4, 0],
      [1, 4, 16],
      [2, 2, 32],
    ]) {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 40, offset);
    }
    this.background = gl.createTexture();
    this.destination = gl.createTexture();
    this.textures = new Map();
    this.textureRevisions = new WeakMap();
    this.textureBytes = 0;
    this.textureSizes = new Map();
    this.textureBudget = 128 * 1024 * 1024;
    this.ownedTextures = new Set([this.background, this.destination]);
    gl.uniform1i(this.uniform.image, 0);
    gl.uniform1i(this.uniform.destination, 1);
    gl.uniform2f(this.uniform.resolution, width, height);
    this.targetTexture = gl.createTexture();
    this.ownedTextures.add(this.targetTexture);
    gl.bindTexture(gl.TEXTURE_2D, this.targetTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.textureParameters();
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.targetTexture,
      0,
    );
    this.depthStencil = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthStencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      this.depthStencil,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Particle RGBA/depth/stencil framebuffer is incomplete');
    this.primaryTarget = {
      owner: this,
      width,
      height,
      texture: this.targetTexture,
      framebuffer: this.framebuffer,
    };
    this.primaryDepthStencil = {
      owner: this,
      width,
      height,
      format: 75,
      renderbuffer: this.depthStencil,
    };
    this.primaryTarget.depthStencil = this.primaryDepthStencil;
    this.primaryTarget.attachmentsChecked = true;
    this.nativeTargets = new Set();
    this.nativeDepth = new Set();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  get target() {
    return this.activeTarget ?? this.primaryTarget;
  }
  createRenderTarget(width, height, rgba) {
    const gl = this.gl,
      target = {
        owner: this,
        width,
        height,
        texture: gl.createTexture(),
        framebuffer: gl.createFramebuffer(),
      };
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba ?? null,
    );
    this.textureParameters();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Native render target is incomplete');
    target.depthStencil = null;
    target.attachmentsChecked = true;
    this.nativeTargets.add(target);
    return target;
  }
  createDepthStencil(width, height, format = 75) {
    if (![75, 77, 80].includes(format))
      throw new Error(`Native depth/stencil format ${format} needs its precision backend`);
    const gl = this.gl,
      depth = { owner: this, width, height, format, texture: gl.createTexture() };
    gl.bindTexture(gl.TEXTURE_2D, depth.texture);
    if (format === 75)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.DEPTH24_STENCIL8,
        width,
        height,
        0,
        gl.DEPTH_STENCIL,
        gl.UNSIGNED_INT_24_8,
        null,
      );
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        format === 80 ? gl.DEPTH_COMPONENT16 : gl.DEPTH_COMPONENT24,
        width,
        height,
        0,
        gl.DEPTH_COMPONENT,
        format === 80 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
        null,
      );
    this.textureParameters();
    this.nativeDepth.add(depth);
    return depth;
  }
  attachDepthStencil(target, depthStencil) {
    if (target.attachmentsChecked && target.depthStencil === depthStencil) return;
    const gl = this.gl;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    if (depthStencil) {
      const attachment =
        depthStencil.format === 75 ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
      if (depthStencil.renderbuffer)
        gl.framebufferRenderbuffer(
          gl.FRAMEBUFFER,
          attachment,
          gl.RENDERBUFFER,
          depthStencil.renderbuffer,
        );
      else
        gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, depthStencil.texture, 0);
    }
    target.depthStencil = depthStencil;
    target.attachmentsChecked = false;
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Native render target/depth combination is incomplete');
    target.attachmentsChecked = true;
  }
  withRenderTarget(target, callback, { depthStencil = null } = {}) {
    const restore = this.enterRenderTarget(target, depthStencil);
    try {
      return callback();
    } finally {
      restore();
    }
  }
  async withRenderTargetAsync(target, callback, { depthStencil = null } = {}) {
    const restore = this.enterRenderTarget(target, depthStencil);
    try {
      return await callback();
    } finally {
      restore();
    }
  }
  enterRenderTarget(target, depthStencil) {
    if (
      target.owner !== this ||
      target.destroyed ||
      (depthStencil && (depthStencil.owner !== this || depthStencil.destroyed))
    )
      throw new Error(
        'Native render target/depth belongs to a different or closed graphics device',
      );
    const gl = this.gl,
      previous = this.activeTarget,
      previousTarget = this.target,
      previousDepth = previousTarget.depthStencil,
      drawing = this.drawing;
    const restore = () => {
      this.activeTarget = previous;
      this.drawing = drawing;
      const restoreGL = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousTarget.framebuffer);
        this.attachDepthStencil(previousTarget, previousDepth);
        gl.useProgram(this.program);
        gl.uniform2f(this.uniform.resolution, previousTarget.width, previousTarget.height);
        gl.viewport(0, 0, previousTarget.width, previousTarget.height);
      };
      if (this.nativeBatch && !previous) this.nativeBatch.restore ??= restoreGL;
      else restoreGL();
    };
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      // A native DrawUP often repeats the same pair hundreds of times. Avoid
      // detaching its depth surface and synchronously revalidating the FBO
      // until that attachment actually changes.
      this.attachDepthStencil(target, depthStencil);
      this.activeTarget = target;
      this.drawing = true;
      gl.viewport(0, 0, target.width, target.height);
      gl.useProgram(this.program);
      gl.uniform2f(this.uniform.resolution, target.width, target.height);
      return restore;
    } catch (error) {
      restore();
      throw error;
    }
  }
  beginNativeBatch() {
    if (this.nativeBatch) throw new Error('Native GPU render batches cannot overlap');
    const batch = { restore: null };
    this.nativeBatch = batch;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      if (this.nativeBatch !== batch) throw new Error('Native GPU render batch ownership changed');
      this.nativeBatch = null;
      batch.restore?.();
    };
  }
  uploadRenderTarget(target, frame, rectangle = [0, 0, target.width, target.height]) {
    if (target.owner !== this || frame.width !== target.width || frame.height !== target.height)
      throw new Error('Native render-target upload dimensions differ');
    const [x, y, width, height] = rectangle;
    if (!width || !height) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, frame.width);
    try {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        frame.rgba,
        (y * frame.width + x) * 4,
      );
    } finally {
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    }
  }
  destroyRenderTarget(target) {
    if (this.nativeTargets.delete(target)) {
      target.destroyed = true;
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }
  }
  destroyDepthStencil(depth) {
    if (this.nativeDepth.delete(depth)) {
      depth.destroyed = true;
      this.gl.deleteTexture(depth.texture);
    }
  }
  depthStateProgram() {
    if (this.depthProgram) return this.depthProgram;
    const gl = this.gl,
      program = gl.createProgram(),
      sources = [
        [
          gl.VERTEX_SHADER,
          `#version 300 es
        const vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
        void main(){gl_Position=vec4(p[gl_VertexID],0,1);}`,
        ],
        [
          gl.FRAGMENT_SHADER,
          `#version 300 es
        precision highp float;precision highp int;uniform sampler2D image;uniform int mode;uniform int selector;out vec4 color;
        void main(){
          if(mode==0){uint d=uint(round(texelFetch(image,ivec2(gl_FragCoord.xy),0).r*16777215.0));color=vec4(float(d>>16u),float((d>>8u)&255u),float(d&255u),0)/255.0;}
          else if(mode==1)color=vec4(1,0,0,1);
          else{vec4 d=round(texelFetch(image,ivec2(gl_FragCoord.xy),0)*255.0);if(selector>=0&&int(d.a)!=selector)discard;gl_FragDepth=(d.r*65536.0+d.g*256.0+d.b)/16777215.0;color=vec4(0);}
        }`,
        ],
      ];
    for (const [type, source] of sources) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    this.depthProgram = {
      program,
      mode: gl.getUniformLocation(program, 'mode'),
      selector: gl.getUniformLocation(program, 'selector'),
      image: gl.getUniformLocation(program, 'image'),
    };
    return this.depthProgram;
  }
  snapshotDepthStencil(depth) {
    if (depth.owner !== this) throw new Error('Native depth surface belongs to another device');
    if (depth.renderbuffer) return this.snapshotRenderbufferDepth(depth);
    const gl = this.gl,
      program = this.depthStateProgram(),
      target = this.createRenderTarget(depth.width, depth.height),
      bytes = new Uint8Array(depth.width * depth.height * 4),
      bits = new Uint8Array(bytes.length);
    try {
      this.withRenderTarget(target, () => {
        gl.useProgram(program.program);
        gl.uniform1i(program.image, 0);
        gl.uniform1i(program.mode, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, depth.texture);
        for (const capability of [
          gl.BLEND,
          gl.DEPTH_TEST,
          gl.STENCIL_TEST,
          gl.SCISSOR_TEST,
          gl.CULL_FACE,
          gl.POLYGON_OFFSET_FILL,
          gl.DITHER,
        ])
          gl.disable(capability);
        gl.colorMask(true, true, true, true);
        gl.depthMask(false);
        gl.stencilMask(0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, depth.width, depth.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        if (depth.format === 75) {
          gl.bindTexture(gl.TEXTURE_2D, this.targetTexture);
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.DEPTH_STENCIL_ATTACHMENT,
            gl.TEXTURE_2D,
            depth.texture,
            0,
          );
          gl.enable(gl.STENCIL_TEST);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          gl.uniform1i(program.mode, 1);
          gl.clearColor(0, 0, 0, 0);
          for (let bit = 0; bit < 8; bit++) {
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.stencilFunc(gl.EQUAL, 1 << bit, 1 << bit);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.readPixels(0, 0, depth.width, depth.height, gl.RGBA, gl.UNSIGNED_BYTE, bits);
            for (let i = 0; i < bytes.length; i += 4) if (bits[i]) bytes[i + 3] |= 1 << bit;
          }
        }
      });
      return { width: depth.width, height: depth.height, format: depth.format, bytes };
    } finally {
      this.destroyRenderTarget(target);
    }
  }
  snapshotRenderbufferDepth(depth) {
    const gl = this.gl,
      read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
      draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
      scissor = gl.isEnabled(gl.SCISSOR_TEST),
      source = gl.createFramebuffer(),
      target = this.createRenderTarget(depth.width, depth.height),
      texture = this.createDepthStencil(depth.width, depth.height, depth.format);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      this.attachDepthStencil(target, texture);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
      gl.framebufferRenderbuffer(
        gl.READ_FRAMEBUFFER,
        depth.format === 75 ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT,
        gl.RENDERBUFFER,
        depth.renderbuffer,
      );
      gl.readBuffer(gl.NONE);
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Native depth renderbuffer read framebuffer is incomplete');
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
      gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(
        0,
        0,
        depth.width,
        depth.height,
        0,
        0,
        depth.width,
        depth.height,
        gl.DEPTH_BUFFER_BIT | (depth.format === 75 ? gl.STENCIL_BUFFER_BIT : 0),
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      return this.snapshotDepthStencil(texture);
    } finally {
      this.destroyRenderTarget(target);
      this.destroyDepthStencil(texture);
      gl.deleteFramebuffer(source);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      else gl.disable(gl.SCISSOR_TEST);
    }
  }
  restoreDepthStencil(depth, state) {
    if (
      depth.owner !== this ||
      state.width !== depth.width ||
      state.height !== depth.height ||
      state.format !== depth.format ||
      state.bytes.length !== depth.width * depth.height * 4
    )
      throw new Error('Native depth/stencil checkpoint does not match its surface');
    const gl = this.gl,
      program = this.depthStateProgram(),
      input = this.createRenderTarget(depth.width, depth.height, state.bytes),
      output = this.createRenderTarget(depth.width, depth.height);
    try {
      this.withRenderTarget(
        output,
        () => {
          gl.useProgram(program.program);
          gl.uniform1i(program.image, 0);
          gl.uniform1i(program.mode, 2);
          gl.uniform1i(program.selector, -1);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, input.texture);
          for (const capability of [
            gl.BLEND,
            gl.STENCIL_TEST,
            gl.SCISSOR_TEST,
            gl.CULL_FACE,
            gl.POLYGON_OFFSET_FILL,
            gl.DITHER,
          ])
            gl.disable(capability);
          gl.colorMask(false, false, false, false);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.ALWAYS);
          gl.depthMask(true);
          gl.stencilMask(255);
          gl.clearStencil(0);
          gl.clear(gl.STENCIL_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          if (depth.format === 75) {
            const values = new Set();
            for (let i = 3; i < state.bytes.length; i += 4)
              if (state.bytes[i]) values.add(state.bytes[i]);
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(false);
            gl.enable(gl.STENCIL_TEST);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
            for (const value of values) {
              gl.stencilFunc(gl.ALWAYS, value, 255);
              gl.uniform1i(program.selector, value);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
          }
        },
        { depthStencil: depth },
      );
    } finally {
      this.destroyRenderTarget(input);
      this.destroyRenderTarget(output);
    }
  }
  releaseTextureFrame(frame) {
    const texture = this.textures.get(frame);
    if (!texture) return;
    this.textures.delete(frame);
    this.textureBytes -= this.textureSizes.get(texture) || 0;
    this.textureSizes.delete(texture);
    this.ownedTextures.delete(texture);
    this.gl.deleteTexture(texture);
  }
  texture(frame) {
    if (frame.nativeTarget) {
      if (frame.nativeTarget.owner !== this)
        throw new Error('Native texture belongs to a different graphics device');
      return frame.nativeTarget.texture;
    }
    let texture = this.textures.get(frame);
    if (texture) {
      this.textures.delete(frame);
      this.textures.set(frame, texture);
      if (frame.rgba && this.textureRevisions.get(frame) === frame.revision) return texture;
    }
    const gl = this.gl;
    texture ||= gl.createTexture();
    this.ownedTextures.add(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (frame.rgba) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        frame.width,
        frame.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength),
      );
    } else
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame.canvas || frame);
    this.textureParameters();
    this.textures.set(frame, texture);
    this.textureRevisions.set(frame, frame.revision);
    const size = frame.width * frame.height * 4;
    this.textureBytes += size - (this.textureSizes.get(texture) || 0);
    this.textureSizes.set(texture, size);
    while (this.textureBytes > this.textureBudget && this.textures.size > 1) {
      const [key, old] = this.textures.entries().next().value;
      this.textures.delete(key);
      this.textureBytes -= this.textureSizes.get(old);
      this.textureSizes.delete(old);
      this.ownedTextures.delete(old);
      gl.deleteTexture(old);
    }
    return texture;
  }
  textureParameters() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  upload(vertices) {
    const data = new Float32Array(vertices.length * 10);
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i],
        at = i * 10;
      data[at] = v.x;
      data[at + 1] = v.y;
      data[at + 2] = v.z;
      data[at + 3] = v.w;
      data[at + 4] = ((v.color >>> 16) & 255) / 255;
      data[at + 5] = ((v.color >>> 8) & 255) / 255;
      data[at + 6] = (v.color & 255) / 255;
      data[at + 7] = (v.color >>> 24) / 255;
      data[at + 8] = v.u;
      data[at + 9] = v.v;
    }
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STREAM_DRAW);
  }
  beginFrame(destination = 0xff000000, { preserve = false } = {}) {
    if (this.drawing) throw new Error('Particle graphics frame is already open');
    this.drawing = true;
    this.activeTarget = null;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      this.depthStencil,
    );
    this.primaryTarget.depthStencil = this.primaryDepthStencil;
    this.primaryTarget.attachmentsChecked = true;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.uniform2f(this.uniform.resolution, this.canvas.width, this.canvas.height);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    if (preserve) return;
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    if (typeof destination === 'number') {
      gl.clearColor(...colorVector(destination));
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.uniform1i(this.uniform.backgroundPass, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.background);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, destination);
    this.textureParameters();
    const w = this.canvas.width,
      h = this.canvas.height;
    this.upload(
      [
        [0, 0, 0, 0],
        [w, 0, 1, 0],
        [0, h, 0, 1],
        [w, h, 1, 1],
      ].map(([x, y, u, v]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u, v })),
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  clear({
    flags,
    color = 0,
    depth = 0x3f800000,
    stencil = 0,
    rectangles = [],
    opaqueTarget = this.frameOpaqueTarget ?? false,
  }) {
    if (!this.drawing) throw new Error('beginFrame must precede native clear');
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(255);
    gl.clearColor(...colorVector(opaqueTarget ? color | 0xff000000 : color));
    gl.clearDepth(bitsFloat(depth));
    gl.clearStencil(stencil);
    const mask =
      (flags & 1 ? gl.COLOR_BUFFER_BIT : 0) |
      (flags & 2 ? gl.DEPTH_BUFFER_BIT : 0) |
      (flags & 4 ? gl.STENCIL_BUFFER_BIT : 0);
    if (rectangles.length) {
      gl.enable(gl.SCISSOR_TEST);
      for (const [x1, y1, x2, y2] of rectangles) {
        gl.scissor(x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
        gl.clear(mask);
      }
    } else {
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(mask);
    }
  }
  drawGeometry(
    geometry,
    frame,
    {
      blendMode = 0,
      renderStates = [],
      samplerStates = [],
      state,
      context,
      drawType = 0,
      force = false,
      scissor,
      opaqueTarget = this.frameOpaqueTarget ?? false,
    } = {},
  ) {
    if (!this.drawing) throw new Error('beginFrame must precede particle drawGeometry');
    context ||= this.frameContext;
    if (context && !state)
      state = advanceD3DContext(context, {
        blendMode,
        drawType,
        force,
        renderStates,
        samplerStates,
      });
    const gl = this.gl,
      { states: s, samplers: t } = particleRenderState(
        blendMode,
        state?.states || renderStates,
        state?.samplers || samplerStates,
      );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.uniform1i(this.uniform.backgroundPass, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(frame));
    const anisotropic = t.get(5) === 3 || t.get(6) === 3;
    const nativeAnisotropy = anisotropic && this.anisotropy && t.get(1) !== 4 && t.get(2) !== 4;
    if (this.anisotropy)
      gl.texParameterf(
        gl.TEXTURE_2D,
        this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
        nativeAnisotropy ? Math.min(this.maxAnisotropy, Math.max(1, t.get(10))) : 1,
      );
    if (nativeAnisotropy) {
      const addressing = [
        gl.CLAMP_TO_EDGE,
        gl.REPEAT,
        gl.MIRRORED_REPEAT,
        gl.CLAMP_TO_EDGE,
        gl.CLAMP_TO_EDGE,
        gl.CLAMP_TO_EDGE,
      ];
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        t.get(6) === 1 ? gl.NEAREST : gl.LINEAR,
      );
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MAG_FILTER,
        t.get(5) === 1 ? gl.NEAREST : gl.LINEAR,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, addressing[t.get(1)]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, addressing[t.get(2)]);
    }
    gl.uniform1i(this.uniform.nativeAnisotropy, Number(Boolean(nativeAnisotropy)));
    gl.uniform1f(this.uniform.maxAnisotropy, Math.min(16, Math.max(1, t.get(10))));
    gl.uniform2i(this.uniform.addressMode, t.get(1), t.get(2));
    gl.uniform2i(this.uniform.filters, t.get(6), t.get(5));
    gl.uniform4fv(this.uniform.borderColor, colorVector(t.get(4)));
    gl.uniform1i(this.uniform.srgbTexture, Number(Boolean(t.get(11))));
    const textureStage = state?.stages?.get(0),
      colorOperation = textureStage?.get(1) ?? 4,
      alphaOperation = textureStage?.get(4) ?? 4,
      colorArgs = [
        textureStage?.get(2) ?? 2,
        textureStage?.get(3) ?? 0,
        textureStage?.get(26) ?? 1,
      ],
      alphaArgs = [
        textureStage?.get(5) ?? 2,
        textureStage?.get(6) ?? 0,
        textureStage?.get(27) ?? 1,
      ];
    for (const operation of [colorOperation, alphaOperation])
      if (operation < 1 || operation > 26 || [17, 22, 23].includes(operation))
        throw new Error(`D3D texture operation ${operation} requires dependent texture sampling`);
    for (const argument of [...colorArgs, ...alphaArgs])
      if (argument & ~63 || (argument & 15) > 6)
        throw new Error(`Invalid D3D texture-stage argument ${argument}`);
    for (const [stage, states] of state?.stages || [])
      if (stage && states.get(1) !== undefined && states.get(1) !== 1)
        throw new Error(`D3D texture stage ${stage} requires its additional texture source`);
    gl.uniform2i(this.uniform.textureOperations, colorOperation, alphaOperation);
    gl.uniform3i(this.uniform.textureColorArgs, ...colorArgs);
    gl.uniform3i(this.uniform.textureAlphaArgs, ...alphaArgs);
    gl.uniform4fv(this.uniform.textureFactor, colorVector(s.get(60)));
    gl.uniform4fv(this.uniform.textureConstant, colorVector(textureStage?.get(32) ?? 0xffffffff));
    gl.uniform1i(this.uniform.srgbWrite, Number(Boolean(s.get(194))));
    gl.uniform1i(this.uniform.blending, Number(Boolean(s.get(27))));
    gl.uniform4i(
      this.uniform.blendFactors,
      s.get(19),
      s.get(20),
      s.get(206) ? s.get(207) : s.get(19),
      s.get(206) ? s.get(208) : s.get(20),
    );
    gl.uniform2i(this.uniform.blendOperations, s.get(171), s.get(206) ? s.get(209) : s.get(171));
    gl.uniform4fv(this.uniform.blendConstant, colorVector(s.get(193)));
    gl.uniform1i(this.uniform.fogEnabled, Number(Boolean(s.get(28))));
    gl.uniform1i(this.uniform.fogMode, s.get(35));
    gl.uniform4f(
      this.uniform.fogParameters,
      bitsFloat(s.get(36)),
      bitsFloat(s.get(37)),
      bitsFloat(s.get(38)),
      0,
    );
    gl.uniform3fv(this.uniform.fogColor, colorVector(s.get(34)).slice(0, 3));
    gl.uniform1i(this.uniform.lineAntialias, 0);
    gl.uniform1i(this.uniform.alphaTest, Number(Boolean(s.get(15))));
    gl.uniform1i(this.uniform.alphaFunction, s.get(25));
    gl.uniform1f(this.uniform.alphaReference, s.get(24) & 255);
    const capability = (key, enabled) => (enabled ? gl.enable(key) : gl.disable(key)),
      comparison = [
        null,
        gl.NEVER,
        gl.LESS,
        gl.EQUAL,
        gl.LEQUAL,
        gl.GREATER,
        gl.NOTEQUAL,
        gl.GEQUAL,
        gl.ALWAYS,
      ];
    const factors = [
      null,
      gl.ZERO,
      gl.ONE,
      gl.SRC_COLOR,
      gl.ONE_MINUS_SRC_COLOR,
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.DST_ALPHA,
      gl.ONE_MINUS_DST_ALPHA,
      gl.DST_COLOR,
      gl.ONE_MINUS_DST_COLOR,
      gl.SRC_ALPHA_SATURATE,
      null,
      null,
      gl.CONSTANT_COLOR,
      gl.ONE_MINUS_CONSTANT_COLOR,
    ];
    if ((!factors[s.get(19)] && s.get(19) !== 1) || (!factors[s.get(20)] && s.get(20) !== 1))
      throw new Error('Unsupported PPI source/destination blend factor');
    capability(gl.BLEND, s.get(27) && !s.get(194));
    gl.blendColor(...colorVector(s.get(193)));
    const equations = [
      null,
      gl.FUNC_ADD,
      gl.FUNC_SUBTRACT,
      gl.FUNC_REVERSE_SUBTRACT,
      gl.MIN,
      gl.MAX,
    ];
    if (!equations[s.get(171)]) throw new Error('Invalid PPI blend operation');
    gl.blendEquationSeparate(equations[s.get(171)], equations[s.get(209)] || gl.FUNC_ADD);
    if (s.get(206))
      gl.blendFuncSeparate(
        factors[s.get(19)],
        factors[s.get(20)],
        factors[s.get(207)],
        factors[s.get(208)],
      );
    else {
      gl.blendEquation(equations[s.get(171)]);
      gl.blendFunc(factors[s.get(19)], factors[s.get(20)]);
    }
    // The observed native device does not advertise D3DPRASTERCAPS_WBUFFER.
    // It accepts D3DZB_USEW but retains z depth for XYZRHW draws, including when
    // reciprocal-w ordering disagrees. Match that device profile explicitly.
    capability(gl.DEPTH_TEST, s.get(7));
    gl.depthFunc(comparison[s.get(23)]);
    gl.depthMask(Boolean(s.get(14)));
    capability(gl.CULL_FACE, s.get(22) !== 1);
    gl.frontFace(gl.CCW);
    gl.cullFace(s.get(22) === 2 ? gl.FRONT : gl.BACK);
    capability(gl.DITHER, s.get(26));
    const mask = s.get(168);
    gl.colorMask(
      Boolean(mask & 1),
      Boolean(mask & 2),
      Boolean(mask & 4),
      !opaqueTarget && Boolean(mask & 8),
    );
    capability(gl.STENCIL_TEST, s.get(52));
    capability(gl.SCISSOR_TEST, s.get(174));
    const rectangle = scissor || context?.scissor || [0, 0, this.target.width, this.target.height];
    gl.scissor(
      Math.floor(rectangle[0]),
      Math.floor(rectangle[1]),
      Math.max(0, Math.floor(rectangle[2] - rectangle[0])),
      Math.max(0, Math.floor(rectangle[3] - rectangle[1])),
    );
    const stencil = [
      null,
      gl.KEEP,
      gl.ZERO,
      gl.REPLACE,
      gl.INCR,
      gl.DECR,
      gl.INVERT,
      gl.INCR_WRAP,
      gl.DECR_WRAP,
    ];
    gl.stencilFunc(comparison[s.get(56)], s.get(57), s.get(58));
    gl.stencilMask(s.get(59));
    gl.stencilOp(stencil[s.get(53)], stencil[s.get(54)], stencil[s.get(55)]);
    if (s.get(185)) {
      gl.stencilFuncSeparate(gl.BACK, comparison[s.get(189)], s.get(57), s.get(58));
      gl.stencilOpSeparate(gl.BACK, stencil[s.get(186)], stencil[s.get(187)], stencil[s.get(188)]);
    }
    const factor = bitsFloat(s.get(175)),
      units = bitsFloat(s.get(195)) * 2 ** 24;
    capability(gl.POLYGON_OFFSET_FILL, Boolean(factor || units));
    gl.polygonOffset(factor, units);
    const submit = (primitive, vertices) => {
      if (s.get(194)) {
        // WebGL has no switchable FRAMEBUFFER_SRGB capability. Copy the native
        // RGBA8 destination before each primitive, decode it for linear-space
        // blending, then encode RGB only. Separate triangles retain overlap,
        // alpha-test, depth/stencil, masks and destination-factor behavior.
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.destination);
        gl.copyTexImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          0,
          0,
          this.target.width,
          this.target.height,
          0,
        );
        this.textureParameters();
        gl.activeTexture(gl.TEXTURE0);
      }
      this.upload(vertices);
      gl.drawArrays(primitive, 0, vertices.length);
    };
    const valid = (vertices) =>
      vertices.every(
        (v) =>
          Number.isFinite(v.x) &&
          Number.isFinite(v.y) &&
          Number.isFinite(v.z) &&
          Number.isFinite(v.w) &&
          v.w !== 0,
      );
    // Within one draw, solid Gouraud triangles share all device state. A
    // triangle list retains their primitive order, winding, blending and
    // depth/stencil effects while avoiding a separate upload per triangle.
    // sRGB's explicit destination-copy path must remain per primitive.
    if (s.get(8) === 3 && s.get(9) !== 1 && !s.get(194)) {
      const vertices = [];
      for (const particle of geometry) {
        if (!valid(particle.vertices)) continue;
        if (particle.vertices.length === 3) vertices.push(...particle.vertices);
        else for (const index of [0, 1, 2, 1, 3, 2]) vertices.push(particle.vertices[index]);
      }
      if (vertices.length) submit(gl.TRIANGLES, vertices);
      return;
    }
    // WRAPn and point-size/lighting inputs belong to vertex processing; the
    // native XYZRHW path retains the supplied UVs and 1-pixel triangle points.
    for (const particle of geometry) {
      if (!valid(particle.vertices)) continue;
      const triangle = particle.vertices.length === 3;
      const renderFaces = triangle
        ? [[0, 1, 2]]
        : [
            [0, 1, 2],
            [1, 3, 2],
          ];
      const faces = (
        triangle
          ? [[0, 1, 2]]
          : [
              [0, 1, 2],
              [2, 1, 3],
            ]
      ).filter((indices) => {
        const [a, b, c] = indices.map((i) => particle.vertices[i]),
          area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        return s.get(22) === 1 || (s.get(22) === 2 ? area <= 0 : area >= 0);
      });
      if (s.get(8) === 1) {
        for (const indices of faces)
          for (const index of indices) submit(gl.POINTS, [particle.vertices[index]]);
      } else if (s.get(8) === 2) {
        if (s.get(176)) {
          gl.disable(gl.CULL_FACE);
          gl.uniform1i(this.uniform.lineAntialias, 1);
          for (const [ia, ib] of faces.flatMap(([a, b, c]) => [
            [a, b],
            [b, c],
            [c, a],
          ])) {
            const a = particle.vertices[ia],
              b = particle.vertices[ib],
              length = Math.hypot(b.x - a.x, b.y - a.y);
            if (!length) continue;
            const dx = (b.x - a.x) / length,
              dy = (b.y - a.y) / length;
            gl.uniform4f(this.uniform.lineSegment, a.x, a.y, b.x, b.y);
            submit(gl.TRIANGLE_STRIP, [
              { ...a, x: a.x - dx * 0.5 + dy, y: a.y - dy * 0.5 - dx },
              { ...b, x: b.x + dx * 0.5 + dy, y: b.y + dy * 0.5 - dx },
              { ...a, x: a.x - dx * 0.5 - dy, y: a.y - dy * 0.5 + dx },
              { ...b, x: b.x + dx * 0.5 - dy, y: b.y + dy * 0.5 + dx },
            ]);
          }
          gl.uniform1i(this.uniform.lineAntialias, 0);
        } else
          for (const indices of faces)
            submit(
              gl.LINE_LOOP,
              indices.map((i) => particle.vertices[i]),
            );
      } else if (s.get(9) === 1) {
        for (const indices of renderFaces)
          submit(
            gl.TRIANGLES,
            indices.map((i) => ({
              ...particle.vertices[i],
              color: particle.vertices[indices[0]].color,
            })),
          );
      } else if (s.get(194)) {
        for (const indices of renderFaces)
          submit(
            gl.TRIANGLES,
            indices.map((i) => particle.vertices[i]),
          );
      } else {
        submit(triangle ? gl.TRIANGLES : gl.TRIANGLE_STRIP, particle.vertices);
      }
    }
  }
  endFrame() {
    if (!this.drawing) throw new Error('Particle graphics frame is not open');
    this.drawPresentation(this.primaryTarget);
    this.endNativeFrame();
    return this.canvas;
  }
  endNativeFrame() {
    if (!this.drawing) throw new Error('Particle graphics frame is not open');
    this.drawing = false;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }
  presentTarget(target = this.primaryTarget) {
    if (target.owner !== this || target.destroyed)
      throw new Error('Native presentation target belongs to a different or closed device');
    const gl = this.gl,
      width = this.canvas.width,
      height = this.canvas.height,
      draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
      read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
      viewport = gl.getParameter(gl.VIEWPORT),
      program = gl.getParameter(gl.CURRENT_PROGRAM),
      resolution = gl.getUniform(this.program, this.uniform.resolution),
      background = gl.getUniform(this.program, this.uniform.backgroundPass);
    try {
      if (width !== target.width) this.canvas.width = target.width;
      if (height !== target.height) this.canvas.height = target.height;
      this.drawPresentation(target);
      this.presentationCanvas ??= new OffscreenCanvas(target.width, target.height);
      if (this.presentationCanvas.width !== target.width)
        this.presentationCanvas.width = target.width;
      if (this.presentationCanvas.height !== target.height)
        this.presentationCanvas.height = target.height;
      const context = this.presentationCanvas.getContext('2d', { alpha: false });
      context.reset();
      context.globalCompositeOperation = 'copy';
      context.imageSmoothingEnabled = false;
      context.drawImage(this.canvas, 0, 0);
      return this.presentationCanvas;
    } finally {
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.viewport(...viewport);
      gl.useProgram(this.program);
      gl.uniform2fv(this.uniform.resolution, resolution);
      gl.uniform1i(this.uniform.backgroundPass, Number(background));
      gl.useProgram(program);
    }
  }
  drawPresentation(target) {
    const gl = this.gl,
      w = this.canvas.width,
      h = this.canvas.height;
    // Native render-target alpha remains in targetTexture. Presentation ignores
    // that alpha, like a D3D backbuffer, and reverses Y only at the final copy.
    // Keeping native Y in the draw FBO preserves D3D's top-left fill convention.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.uniform2f(this.uniform.resolution, w, h);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DITHER);
    gl.colorMask(true, true, true, true);
    gl.uniform1i(this.uniform.backgroundPass, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    this.textureParameters();
    this.upload(
      [
        [0, 0, 0, 1],
        [w, 0, 1, 1],
        [0, h, 0, 0],
        [w, h, 1, 0],
      ].map(([x, y, u, v]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u, v })),
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const error = gl.getError();
    if (error !== gl.NO_ERROR)
      throw new Error(`Particle WebGL draw failed: 0x${error.toString(16)}`);
  }
  render(geometry, frame, destination, options = {}) {
    this.beginFrame(destination);
    try {
      this.drawGeometry(geometry, frame, options);
      return this.endFrame();
    } catch (error) {
      this.drawing = false;
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      throw error;
    }
  }
  pixels(target = this.primaryTarget) {
    const gl = this.gl,
      previous = gl.getParameter(gl.FRAMEBUFFER_BINDING),
      bytes = new Uint8Array(target.width * target.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    return bytes;
  }
  close() {
    const gl = this.gl;
    for (const target of [...this.nativeTargets]) this.destroyRenderTarget(target);
    for (const depth of [...this.nativeDepth]) this.destroyDepthStencil(depth);
    if (this.depthProgram) gl.deleteProgram(this.depthProgram.program);
    for (const texture of this.ownedTextures) gl.deleteTexture(texture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteRenderbuffer(this.depthStencil);
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
