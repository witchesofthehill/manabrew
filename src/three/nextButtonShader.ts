import { Color } from "three";
import preset from "@/themes/kanagawa";

export function nextButtonShader(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!gl) return () => {};
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const vertex = compile(
    gl.VERTEX_SHADER,
    "attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}",
  );
  const fragment = compile(
    gl.FRAGMENT_SHADER,
    `
    precision mediump float;
    varying vec2 uv;
    uniform float time;
    uniform float aspect;
    uniform vec3 ember, gold, light;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
    }
    void main(){
      vec2 q=vec2((uv.x-.5)*aspect,uv.y-.5);
      float d=length(vec2(max(abs(q.x)-(aspect*.5-.5),0.),q.y));
      vec2 drift=vec2(time*.12,-time*.07);
      float n=noise(q*5.+drift)*.65+noise(q*13.-drift)*.25+noise(q*29.+drift)*.1;
      float rim=exp(-abs(d-.445)*105.);
      float halo=exp(-abs(d-.42)*17.);
      float heat=smoothstep(.25,.49,d);
      float curl=smoothstep(.48,.78,n)*heat;
      vec3 warm=max(ember-vec3(min(ember.r,min(ember.g,ember.b))*.38),vec3(0.));
      vec3 base=mix(warm,gold,.22+.36*uv.y);
      base*=.82+.12*n;
      base+=gold*(halo*.22+curl*.22);
      base=mix(base,light,rim*(.7+.2*n));
      float sheen=exp(-pow((uv.y-.79)*15.,2.))*.1;
      base+=light*sheen;
      gl_FragColor=vec4(base,1.);
    }`,
  );
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return () => {};
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const attribute = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  for (const [name, value] of Object.entries({
    ember: preset.gameColors["mana.R"],
    gold: preset.gameColors["arrow.attack"],
    light: preset.dark.foreground,
  })) {
    const color = new Color(value).convertLinearToSRGB();
    gl.uniform3f(gl.getUniformLocation(program, name), color.r, color.g, color.b);
  }
  const clock = gl.getUniformLocation(program, "time");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(program, "aspect"), canvas.width / canvas.height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  let frame = 0,
    previous = -Infinity;
  const draw = (time: number) => {
    if (!document.hidden && time - previous > 32) {
      previous = time;
      gl.uniform1f(clock, reduced.matches ? 0 : time / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  };
}
