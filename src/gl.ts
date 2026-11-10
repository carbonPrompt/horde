// WebGL layer: the map, the zone overlay and every agent, drawn by the graphics card.
// Everything else (units, effects, labels) is drawn on the 2D canvas stacked on top.
// If WebGL is not available, `ok` is false and the 2D canvas draws everything instead.

const VS_QUAD = `
attribute vec2 p;
uniform vec4 cam; // x, y (pixels), scale (pixels per cell), unused
uniform vec2 view; // canvas size in pixels
uniform vec2 size; // map size in cells
varying vec2 uv;
void main() {
  uv = p;
  vec2 px = cam.xy + p * size * cam.z;
  gl_Position = vec4(px / view * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
const FS_QUAD = `
precision mediump float;
uniform sampler2D tex;
varying vec2 uv;
void main() { gl_FragColor = texture2D(tex, uv); }`;

const VS_AGENT = `
attribute float ax;
attribute float ay;
attribute float st;
attribute float mut;
uniform vec4 cam;
uniform vec2 view;
uniform float dot;
varying vec3 col;
void main() {
  // states: 0 civilian, 1 infected, 2 dead, 3 safe civilian
  if (st > 1.5 && st < 2.5) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; return; }
  col = st < 0.5 ? vec3(0.96, 0.945, 0.9) : st < 1.5 ? (mut > 0.5 ? vec3(1.0, 0.4, 0.82) : vec3(1.0, 0.23, 0.23)) : vec3(0.61, 0.906, 0.659);
  vec2 px = cam.xy + vec2(ax, ay) * cam.z;
  gl_Position = vec4(px / view * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
  gl_PointSize = (st > 0.5 && st < 1.5 && mut > 0.5) ? dot * 1.35 : dot;
}`;
const FS_AGENT = `
precision mediump float;
varying vec3 col;
void main() { gl_FragColor = vec4(col, 1.0); }`;

export interface Cam { x: number; y: number; scale: number }

export class GLView {
  ok = false;
  private gl!: WebGLRenderingContext;
  private quad!: WebGLProgram; private agent!: WebGLProgram;
  private quadBuf!: WebGLBuffer; private bx!: WebGLBuffer; private by!: WebGLBuffer; private bs!: WebGLBuffer; private bm!: WebGLBuffer;
  private texMap!: WebGLTexture; private texHeights!: WebGLTexture; private texZone!: WebGLTexture; private texScar!: WebGLTexture;
  private cap = 0;

  constructor(private canvas: HTMLCanvasElement) {
    try {
      const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
      if (!gl) return;
      this.gl = gl;
      this.quad = this.program(VS_QUAD, FS_QUAD);
      this.agent = this.program(VS_AGENT, FS_AGENT);
      this.quadBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
      this.bx = gl.createBuffer()!; this.by = gl.createBuffer()!; this.bs = gl.createBuffer()!; this.bm = gl.createBuffer()!;
      this.texMap = this.texture(); this.texHeights = this.texture(); this.texZone = this.texture(); this.texScar = this.texture();
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.ok = true;
    } catch (e) {
      console.warn("WebGL unavailable, drawing on the 2D canvas", e);
      this.ok = false;
    }
  }

  private program(vs: string, fs: string) {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    return p;
  }
  private texture() {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private upload(t: WebGLTexture, img: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }
  setMap(base: HTMLCanvasElement, heights: HTMLCanvasElement) { if (this.ok) { this.upload(this.texMap, base); this.upload(this.texHeights, heights); } }
  setZone(zone: HTMLCanvasElement) { if (this.ok) this.upload(this.texZone, zone); }
  /** 0.23: the ground-damage layer (craters, rubble), drawn over the map and under the zone tint and the crowd. */
  setScar(scar: HTMLCanvasElement) { if (this.ok) { this.upload(this.texScar, scar); this.hasScar = true; } }
  private hasScar = false;

  draw(cam: Cam, w: number, h: number, mapW: number, mapH: number, showHeights: boolean,
    n: number, ax: Float32Array, ay: Float32Array, state: Uint8Array, dot: number, mutant?: Uint8Array) {
    if (!this.ok) return;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.051, 0.059, 0.071, 1); gl.clear(gl.COLOR_BUFFER_BIT);

    // map + zone
    gl.useProgram(this.quad);
    const qp = gl.getAttribLocation(this.quad, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(qp); gl.vertexAttribPointer(qp, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(gl.getUniformLocation(this.quad, "cam"), cam.x, cam.y, cam.scale, 0);
    gl.uniform2f(gl.getUniformLocation(this.quad, "view"), w, h);
    gl.uniform2f(gl.getUniformLocation(this.quad, "size"), mapW, mapH);
    for (const t of [showHeights ? this.texHeights : this.texMap, ...(this.hasScar && !showHeights ? [this.texScar] : []), this.texZone]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(qp);

    // agents: one point each, straight from the simulation's arrays
    gl.useProgram(this.agent);
    const grow = n > this.cap;
    if (grow) this.cap = n;
    const bind = (buf: WebGLBuffer, name: string, data: Float32Array | Uint8Array, type: number) => {
      const loc = gl.getAttribLocation(this.agent, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (grow) gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n));
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 1, type, false, 0, 0);
      return loc;
    };
    const l1 = bind(this.bx, "ax", ax, gl.FLOAT), l2 = bind(this.by, "ay", ay, gl.FLOAT), l3 = bind(this.bs, "st", state, gl.UNSIGNED_BYTE);
    const l4 = mutant ? bind(this.bm, "mut", mutant, gl.UNSIGNED_BYTE) : -1;
    if (l4 < 0) gl.vertexAttrib1f(gl.getAttribLocation(this.agent, "mut"), 0);
    gl.uniform4f(gl.getUniformLocation(this.agent, "cam"), cam.x, cam.y, cam.scale, 0);
    gl.uniform2f(gl.getUniformLocation(this.agent, "view"), w, h);
    gl.uniform1f(gl.getUniformLocation(this.agent, "dot"), dot);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disableVertexAttribArray(l1); gl.disableVertexAttribArray(l2); gl.disableVertexAttribArray(l3);
    if (l4 >= 0) gl.disableVertexAttribArray(l4);
  }
}
