import { foilShader, SURFACE_GLSL, WORN_GLSL, SurfaceMotion, surfaceSeed } from "card-glint/finish";
import { GlProgram, MeshGeometry, Shader, Texture, UniformGroup } from "pixi.js";
import {
  CARD_FINISH_KINDS,
  resolveCardRainFog,
  resolveCardWearAmount,
  type CardFoilRegion,
} from "@/lib/cardFinish";
import type { CardCosmetics, CardFinish } from "@/protocol/deck";
import {
  acquireCardOpticalLayers,
  getCardSourceCornerRadius,
  type CardOpticalLease,
} from "@/lib/cardOpticalLayers";
import {
  acquireCardFinishMask,
  acquireCardFinishCaustics,
  type CardFinishMaskLease,
  type CardFinishCausticsLease,
} from "@/lib/cardFinishResources";

export const MAX_CARD_FOIL_EXCLUSIONS = 8;

export interface CardFoilUniforms {
  uSize: Float32Array;
  uRadius: number;
  uExclusions: Float32Array;
  uExclusionCount: number;
  uUvTop: Float32Array;
  uUvBottom: Float32Array;
  pointer: Float32Array;
  aspect: number;
  artBounds: Float32Array;
  hasMask: number;
  hasWave: number;
  previewKind: number;
  hasPrinting: number;
  satinCompact: number;
  satinHoverGain: number;
  cornerRadius: number;
  finishBase: number;
  surfaceTime: number;
  rainFogDensity: number;
  surfaceInfo: Float32Array;
  ripple0: Float32Array;
  ripple1: Float32Array;
  ripple2: Float32Array;
  ripple3: Float32Array;
  wearInfo: Float32Array;
}

export interface CardFoilShader {
  shader: Shader;
  geometry: MeshGeometry;
  uniforms: CardFoilUniforms;
  setTexture(texture: Texture | null, uvs?: Float32Array): void;
  setMode(mode: CardFinish, cosmetics?: CardCosmetics): void;
  setArtWindows(regions: readonly CardFoilRegion[]): void;
  setExclusions(regions: readonly CardFoilRegion[]): void;
  update(time: number, hovering: boolean): void;
  destroy(): void;
}

function modernSurfaceShader(): string {
  const foil = foilShader()
    .replaceAll("texture2D(face,", "finishFace(")
    .replaceAll("texture2D(mask,", "finishMask(");
  const surface = SURFACE_GLSL.replaceAll("flat in ", "uniform ").replaceAll(
    "texture(face,",
    "finishFace(",
  );
  return `${foil}
${surface}
${WORN_GLSL}

vec3 modernSurface(vec2 uv,vec3 normal,vec3 view,vec2 wear,vec2 pixel) {
  vec3 color=previewKind>=5. && previewKind<8. ? animatedSurface(uv,normal) : previewFoil(uv,normal,view);
  vec3 base=finishFace(uv).rgb;
  if(wear.x>0.)color=wornSurface(uv,previewInk(base),color,normal,view,wear.y,wear.x,
    previewKind==9. ? 1. : step(.5,previewKind)*(1.-step(4.5,previewKind)),pixel);
  if(hasPrinting>0.){
    vec4 top=finishPrinting(uv);
    vec3 under=mix(base,previewLinear(color),finishCoverage(uv));
    color=previewInk(mix(under,top.rgb,top.a));
  }
  return color;
}`;
}

const vertex = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
out vec2 vUV;
void main() {
  vUV = aUV;
  vec3 position = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragment = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform vec4 uColor;
uniform vec2 uSize;
uniform float uRadius;
uniform vec4 uExclusions[${MAX_CARD_FOIL_EXCLUSIONS}];
uniform int uExclusionCount;
uniform vec4 uUvTop;
uniform vec4 uUvBottom;
uniform sampler2D face;
uniform sampler2D mask;
uniform float hasMask;
uniform sampler2D printing;
uniform sampler2D coverage;
uniform float hasPrinting;
uniform vec2 pointer;
uniform float aspect;
uniform vec4 artBounds[8];
uniform float cornerRadius;
uniform float finishBase;
uniform vec2 wearInfo;
vec2 faceUv(vec2 uv) {
  return mix(mix(uUvTop.xy,uUvTop.zw,uv.x),mix(uUvBottom.xy,uUvBottom.zw,uv.x),uv.y);
}
vec3 linearInk(vec3 c) {
  return mix(c/12.92,pow(max((c+.055)/1.055,vec3(0.)),vec3(2.4)),step(vec3(.04045),c));
}
vec4 finishFace(vec2 uv) {
  vec4 ink=texture(face,vec2(uv.x,1.-uv.y));
  return vec4(linearInk(ink.rgb/max(ink.a,.00001)),ink.a);
}
vec4 finishMask(vec2 uv) { return texture(mask,vec2(uv.x,1.-uv.y)); }
vec4 finishPrinting(vec2 uv) {
  vec4 ink=texture(printing,vec2(uv.x,1.-uv.y));
  return vec4(linearInk(ink.rgb/max(ink.a,.00001)),ink.a);
}
float finishCoverage(vec2 uv) { return texture(coverage,vec2(uv.x,1.-uv.y)).a; }
#define texture2D texture
${modernSurfaceShader().replaceAll("texture(caustics,", "sampleCaustics(")}
#undef texture2D
void main() {
  if(hasPrinting<0.) discard;
  vec2 sourceUv=faceUv(vUV);
  vec2 uv=vec2(sourceUv.x,1.-sourceUv.y);
  vec2 pixel=fwidth(uv*vec2(1.,aspect));
  vec2 point=vUV*uSize;
  vec2 corner=abs(point-uSize*.5)-(uSize*.5-uRadius);
  if(length(max(corner,0.))+min(max(corner.x,corner.y),0.)>uRadius) discard;
  for(int index=0; index<${MAX_CARD_FOIL_EXCLUSIONS}; index++) {
    if(index>=uExclusionCount) break;
    vec4 exclusion=uExclusions[index];
    if(exclusion.z>0. && point.x>=exclusion.x && point.y>=exclusion.y
        && point.x<=exclusion.x+exclusion.z && point.y<=exclusion.y+exclusion.w) discard;
  }
  if(any(lessThan(sourceUv,vec2(0.))) || any(greaterThan(sourceUv,vec2(1.)))) discard;
  vec2 sourceCorner=abs((uv-.5)*vec2(1.,aspect))-(vec2(.5,aspect*.5)-cornerRadius);
  if(length(max(sourceCorner,0.))+min(max(sourceCorner.x,sourceCorner.y),0.)>cornerRadius) discard;
  vec4 ink=finishFace(uv);
  vec3 normal=normalize(vec3((pointer-.5)*vec2(.24,-.24),1.));
  vec3 view=normalize(vec3((uv-.5)*vec2(-.65,-.90),1.));
  vec3 color=modernSurface(uv,normal,view,wearInfo,pixel);
  float alpha=mix(ink.a,1.,hasPrinting)*uColor.a;
  finalColor=vec4(color*alpha,alpha);
}`.replace(
  "uniform sampler2D caustics;",
  `uniform sampler2D caustics;
vec4 sampleCaustics(vec2 uv) { return texture(caustics,vec2(uv.x,1.-uv.y)); }`,
);

let shared: { program: GlProgram; geometry: MeshGeometry; users: number } | null = null;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const viewProjection = new Float32Array(identity);

export function createCardFoilShader(invalidate: () => void): CardFoilShader {
  shared ??= {
    program: new GlProgram({ vertex, fragment, name: "manabrew-card-glint-modern" }),
    geometry: new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    }),
    users: 0,
  };
  const resources = shared;
  resources.users++;
  const group = new UniformGroup({
    uSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
    uRadius: { value: 0, type: "f32" },
    uExclusions: {
      value: new Float32Array(MAX_CARD_FOIL_EXCLUSIONS * 4),
      type: "vec4<f32>",
      size: MAX_CARD_FOIL_EXCLUSIONS,
    },
    uExclusionCount: { value: 0, type: "i32" },
    uUvTop: { value: new Float32Array([0, 0, 1, 0]), type: "vec4<f32>" },
    uUvBottom: { value: new Float32Array([0, 1, 1, 1]), type: "vec4<f32>" },
    pointer: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
    aspect: { value: 1.4, type: "f32" },
    artBounds: { value: new Float32Array(32), type: "vec4<f32>", size: 8 },
    hasMask: { value: 0, type: "f32" },
    hasWave: { value: 0, type: "f32" },
    previewKind: { value: 0, type: "f32" },
    hasPrinting: { value: 0, type: "f32" },
    satinCompact: { value: 1, type: "f32" },
    satinHoverGain: { value: 0, type: "f32" },
    cornerRadius: { value: 0.035, type: "f32" },
    finishBase: { value: 1, type: "f32" },
    surfaceTime: { value: 0, type: "f32" },
    rainFogDensity: { value: 1, type: "f32" },
    surfaceInfo: { value: new Float32Array(4), type: "vec4<f32>" },
    ripple0: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    ripple1: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    ripple2: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    ripple3: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    wearInfo: { value: new Float32Array(2), type: "vec2<f32>" },
  });
  const shader = new Shader({
    glProgram: resources.program,
    resources: {
      foilUniforms: group,
      face: Texture.EMPTY.source,
      mask: Texture.EMPTY.source,
      caustics: Texture.EMPTY.source,
      printing: Texture.EMPTY.source,
      coverage: Texture.EMPTY.source,
    },
  });
  const motion = new SurfaceMotion();
  const normal: [number, number, number] = [0, 0, 1];
  const hoverUv: [number, number] = [0.5, 0.5];
  let mode: CardFinish = "regular";
  let source: Texture | null = null;
  let controller: AbortController | null = null;
  let maskLease: CardFinishMaskLease | null = null;
  let poolLease: CardFinishCausticsLease | null = null;
  let opticalLease: CardOpticalLease | null = null;
  let opticalController: AbortController | null = null;
  let artWindows: readonly CardFoilRegion[] = [];
  const setArtWindows = (regions: readonly CardFoilRegion[]) => {
    const bounds = group.uniforms.artBounds;
    bounds.fill(0);
    if (!regions.length) {
      bounds[2] = 1;
      bounds[3] = 1;
    }
    for (let index = 0; index < Math.min(8, regions.length); index++) {
      const region = regions[index];
      const offset = index * 4;
      bounds[offset] = region.x;
      bounds[offset + 1] = 1 - region.y - region.height;
      bounds[offset + 2] = region.x + region.width;
      bounds[offset + 3] = 1 - region.y;
    }
  };
  const releaseOptical = () => {
    shader.resources.face = (source ?? Texture.EMPTY).source;
    shader.resources.printing = Texture.EMPTY.source;
    shader.resources.coverage = Texture.EMPTY.source;
    opticalController?.abort();
    opticalController = null;
    opticalLease?.release();
    opticalLease = null;
    group.uniforms.hasPrinting = 0;
    group.uniforms.finishBase = 1;
    group.uniforms.cornerRadius = source ? getCardSourceCornerRadius(source) : 0.035;
    setArtWindows(artWindows);
  };
  const syncOptical = () => {
    if (!source || (mode !== "rain" && mode !== "heat" && mode !== "pool")) {
      if (opticalController) releaseOptical();
      return;
    }
    if (opticalController) return;
    const pending = new AbortController();
    const acquisition = acquireCardOpticalLayers(source, pending.signal);
    if (!acquisition) return;
    opticalController = pending;
    group.uniforms.hasPrinting = -1;
    void acquisition
      .then((lease) => {
        if (pending.signal.aborted) {
          lease.release();
          return;
        }
        opticalLease = lease;
        shader.resources.face = lease.artwork.source;
        shader.resources.printing = lease.printing.source;
        shader.resources.coverage = lease.coverage.source;
        group.uniforms.hasPrinting = 1;
        group.uniforms.finishBase = 0;
        group.uniforms.cornerRadius = lease.cornerRadius;
        setArtWindows(lease.artWindows);
        invalidate();
      })
      .catch((error: unknown) => {
        if (!pending.signal.aborted)
          console.error("Card Glint optical printing unavailable", error);
      });
  };
  return {
    shader,
    uniforms: group.uniforms,
    geometry: resources.geometry,
    setTexture(texture: Texture | null, uvs?: Float32Array) {
      shader.resources.face = (opticalLease?.artwork ?? texture ?? Texture.EMPTY).source;
      if (texture !== source) {
        source = texture;
        releaseOptical();
        motion.clear();
        if (texture) group.uniforms.aspect = texture.source.pixelHeight / texture.source.pixelWidth;
        controller?.abort();
        shader.resources.mask = Texture.EMPTY.source;
        group.uniforms.hasMask = 0;
        maskLease?.release();
        maskLease = null;
        if (texture) {
          const pending = new AbortController();
          controller = pending;
          void acquireCardFinishMask(texture, pending.signal)
            .then((lease) => {
              if (pending.signal.aborted) {
                lease.release();
                return;
              }
              maskLease = lease;
              shader.resources.mask = lease.texture.source;
              group.uniforms.hasMask = 1;
              invalidate();
            })
            .catch((error: unknown) => {
              if (!pending.signal.aborted)
                console.error("Card Glint artwork mask unavailable", error);
            });
        }
      }
      const uv = texture?.uvs;
      const top = group.uniforms.uUvTop;
      const bottom = group.uniforms.uUvBottom;
      top[0] = uvs?.[0] ?? uv?.x0 ?? 0;
      top[1] = uvs?.[1] ?? uv?.y0 ?? 0;
      top[2] = uvs?.[2] ?? uv?.x1 ?? 1;
      top[3] = uvs?.[3] ?? uv?.y1 ?? 0;
      bottom[0] = uvs?.[6] ?? uv?.x3 ?? 0;
      bottom[1] = uvs?.[7] ?? uv?.y3 ?? 1;
      bottom[2] = uvs?.[4] ?? uv?.x2 ?? 1;
      bottom[3] = uvs?.[5] ?? uv?.y2 ?? 1;
      if (!texture && poolLease) {
        shader.resources.caustics = Texture.EMPTY.source;
        poolLease.release();
        poolLease = null;
      }
      syncOptical();
    },
    setMode(value: CardFinish, cosmetics?: CardCosmetics) {
      if (mode !== value) motion.clear();
      mode = value;
      group.uniforms.previewKind = CARD_FINISH_KINDS[mode];
      group.uniforms.rainFogDensity = resolveCardRainFog(cosmetics);
      group.uniforms.wearInfo[0] = resolveCardWearAmount(cosmetics);
      group.uniforms.wearInfo[1] = surfaceSeed(cosmetics?.wearSeed ?? 0);
      group.uniforms.surfaceInfo[2] = surfaceSeed(cosmetics?.wearSeed ?? 0);
      if (mode !== "pool" && poolLease) {
        shader.resources.caustics = Texture.EMPTY.source;
        poolLease.release();
        poolLease = null;
      }
      syncOptical();
    },
    setArtWindows(regions: readonly CardFoilRegion[]) {
      artWindows = regions;
      if (!opticalLease) setArtWindows(regions);
    },
    setExclusions(regions: readonly CardFoilRegion[]) {
      if (regions.length > MAX_CARD_FOIL_EXCLUSIONS)
        throw new RangeError(`Card foil supports at most ${MAX_CARD_FOIL_EXCLUSIONS} exclusions`);
      const exclusions = group.uniforms.uExclusions;
      for (let index = 0; index < regions.length; index++) {
        const region = regions[index];
        const offset = index * 4;
        exclusions[offset] = region.x;
        exclusions[offset + 1] = region.y;
        exclusions[offset + 2] = region.width;
        exclusions[offset + 3] = region.height;
      }
      group.uniforms.uExclusionCount = regions.length;
    },
    update(time: number, hovering: boolean) {
      time = Math.floor(time * 30) / 30;
      const uniforms = group.uniforms;
      uniforms.surfaceTime = time;
      normal[0] = (uniforms.pointer[0] - 0.5) * 0.24;
      normal[1] = (uniforms.pointer[1] - 0.5) * -0.24;
      const length = Math.hypot(normal[0], normal[1], 1);
      normal[0] /= length;
      normal[1] /= length;
      normal[2] = 1 / length;
      const { uUvTop: top, uUvBottom: bottom, pointer } = uniforms;
      const x = pointer[0];
      const y = pointer[1];
      for (let axis = 0; axis < 2; axis++) {
        const upper = top[axis] + (top[axis + 2] - top[axis]) * x;
        const lower = bottom[axis] + (bottom[axis + 2] - bottom[axis]) * x;
        hoverUv[axis] = upper + (lower - upper) * y;
      }
      motion.begin();
      const sample = motion.sample(
        { id: 0, card: 0, transform: identity, normal, finish: mode },
        {
          viewProjection,
          time,
          hover: hovering ? { instance: 0, uv: hoverUv } : undefined,
        },
      );
      motion.end();
      if (sample) {
        uniforms.surfaceInfo[0] = sample[0];
        uniforms.surfaceInfo[1] = sample[1];
        uniforms.ripple0.set(sample.subarray(4, 8));
        uniforms.ripple1.set(sample.subarray(8, 12));
        uniforms.ripple2.set(sample.subarray(12, 16));
        uniforms.ripple3.set(sample.subarray(16, 20));
      }
      if (mode === "pool" && source) {
        poolLease ??= acquireCardFinishCaustics();
        poolLease.update(time);
        shader.resources.caustics = poolLease.texture.source;
      }
    },
    destroy() {
      source = null;
      releaseOptical();
      controller?.abort();
      shader.resources.face = Texture.EMPTY.source;
      shader.resources.mask = Texture.EMPTY.source;
      shader.resources.caustics = Texture.EMPTY.source;
      maskLease?.release();
      poolLease?.release();
      motion.clear();
      shader.destroy(false);
      if (--resources.users === 0) {
        resources.geometry.destroy();
        resources.program.destroy();
        shared = null;
      }
    },
  };
}
