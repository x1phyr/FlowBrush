import { FlowField, encodeRGBA } from './core';
const VS = `attribute vec2 position; varying vec2 uv;void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}`;
const FS = `precision highp float;varying vec2 uv;uniform sampler2D flowMap;uniform float time;uniform float aspect;
float water(vec2 p){p*=6.283185307;float n=sin(p.x*12.+sin(p.y*5.)*2.)*sin(p.y*9.+sin(p.x*4.)*2.);float m=sin(p.x*4.+p.y*7.)*.5+.5;return pow(max(0.,1.-abs(n)*3.5),5.)*.55+m*.15;}
void main(){vec2 f=texture2D(flowMap,uv).rg*2.-1.;if(length(f)<=2./255.)f=vec2(0.);float a=fract(time*.25),b=fract(time*.25+.5),blend=abs(a*2.-1.);float tex=mix(water(uv-f*a*.18),water(uv-f*b*.18),blend);float speed=length(f);vec3 base=mix(vec3(.025,.11,.15),vec3(.06,.30,.34),speed);gl_FragColor=vec4(base+tex*vec3(.28,.62,.63),1.);}`;
export class WaterRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private buffer: WebGLBuffer;
  private revision = -1;
  private field: FlowField | null = null;
  private t: WebGLUniformLocation | null;
  private aspect: WebGLUniformLocation | null;
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL');
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(message ?? 'Shader 编译失败');
      }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VS),
      fs = shader(gl.FRAGMENT_SHADER, FS),
      p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('动态预览初始化失败');
    this.program = p;
    gl.useProgram(p);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(p, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(p, 'flowMap'), 0);
    this.t = gl.getUniformLocation(p, 'time');
    this.aspect = gl.getUniformLocation(p, 'aspect');
  }
  render(field: FlowField, time: number) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.useProgram(this.program);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.field !== field) {
      const scale = Math.min(480 / field.width, 480 / field.height);
      gl.canvas.width = Math.max(1, Math.round(field.width * scale));
      gl.canvas.height = Math.max(1, Math.round(field.height * scale));
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        field.width,
        field.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        encodeRGBA(field),
      );
      this.field = field;
      this.revision = field.revision;
    } else if (this.revision !== field.revision) {
      const r = field.dirty ?? { x: 0, y: 0, w: field.width, h: field.height };
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        r.x,
        r.y,
        r.w,
        r.h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        encodeRGBA(field, false, r),
      );
      this.revision = field.revision;
    }
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.uniform1f(this.t, time);
    gl.uniform1f(this.aspect, field.width / field.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  dispose() {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
