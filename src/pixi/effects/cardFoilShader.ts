import { GlProgram, MeshGeometry, Shader, UniformGroup } from "pixi.js";

export interface CardFoilShader {
  shader: Shader;
  geometry: MeshGeometry;
  uniforms: {
    uPhase: number;
    uSize: Float32Array;
    uRadius: number;
    uWarm: Float32Array;
    uCool: Float32Array;
    uNeutral: Float32Array;
    uExclusion: Float32Array;
  };
  destroy(): void;
}

const vertex = `
attribute vec2 aPosition;
attribute vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
varying vec2 vUV;
void main() {
  vUV = aUV;
  vec3 position = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragment = `
varying vec2 vUV;
uniform float uPhase;
uniform vec4 uColor;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform vec3 uNeutral;
uniform vec2 uSize;
uniform float uRadius;
uniform vec4 uExclusion;
void main() {
  vec2 point = vUV * uSize;
  vec2 corner = abs(point - uSize * 0.5) - (uSize * 0.5 - uRadius);
  if (length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) > uRadius) discard;
  if (uExclusion.z > 0.0 && point.x >= uExclusion.x && point.y >= uExclusion.y
      && point.x <= uExclusion.x + uExclusion.z && point.y <= uExclusion.y + uExclusion.w) discard;
  vec2 extent = vec2(uSize.x * 2.5, uSize.y);
  vec2 samplePoint = vec2(vUV.x + 1.5 * uPhase, vUV.y);
  samplePoint.x /= 2.5;
  vec2 direction = vec2(0.9063078, 0.4226183);
  float t = 0.5 + dot((samplePoint - 0.5) * extent, direction) / dot(extent, direction);
  vec4 color;
  if (t < 0.45) color = mix(vec4(0.0), vec4(uNeutral * 0.26, 0.26), clamp((t - 0.30) / 0.15, 0.0, 1.0));
  else if (t < 0.50) color = mix(vec4(uNeutral * 0.26, 0.26), vec4(uWarm * 0.22, 0.22), (t - 0.45) / 0.05);
  else if (t < 0.55) color = mix(vec4(uWarm * 0.22, 0.22), vec4(uCool * 0.20, 0.20), (t - 0.50) / 0.05);
  else color = mix(vec4(uCool * 0.20, 0.20), vec4(0.0), clamp((t - 0.55) / 0.15, 0.0, 1.0));
  gl_FragColor = color * uColor.a;
}`;

let shared: { program: GlProgram; geometry: MeshGeometry; users: number } | null = null;

export function createCardFoilShader(): CardFoilShader {
  shared ??= {
    program: new GlProgram({ vertex, fragment, name: "manabrew-card-foil" }),
    geometry: new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    }),
    users: 0,
  };
  const resources = shared;
  resources.users++;
  const uniforms = new UniformGroup({
    uPhase: { value: 0.5, type: "f32" },
    uWarm: { value: new Float32Array(3), type: "vec3<f32>" },
    uCool: { value: new Float32Array(3), type: "vec3<f32>" },
    uNeutral: { value: new Float32Array(3), type: "vec3<f32>" },
    uSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
    uRadius: { value: 0, type: "f32" },
    uExclusion: { value: new Float32Array(4), type: "vec4<f32>" },
  });
  const shader = new Shader({
    glProgram: resources.program,
    resources: {
      foilUniforms: uniforms,
    },
  });
  return {
    shader,
    uniforms: uniforms.uniforms,
    geometry: resources.geometry,
    destroy() {
      shader.destroy(false);
      if (--resources.users === 0) {
        resources.geometry.destroy();
        resources.program.destroy();
        shared = null;
      }
    },
  };
}
