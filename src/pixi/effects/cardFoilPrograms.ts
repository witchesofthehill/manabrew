import {
  CARDSTOCK_GLSL,
  foilShader,
  PRINT_DOTS_GLSL,
  SURFACE_GLSL,
  surfaceSeed,
  WORN_GLSL,
} from "card-glint/finish";
import { GlProgram } from "pixi.js";

export const MAX_CARD_FOIL_EXCLUSIONS = 8;
export const CARD_FOIL_INSTANCE_FIELDS = [
  ["uSize", 2],
  ["uRadius", 1],
  ["uExclusionCount", 1],
  ["uUvTop", 4],
  ["uUvBottom", 4],
  ["hasPrinting", 1],
  ["cornerRadius", 1],
  ["finishBase", 1],
  ["hasCoverage", 1],
  ["facePrepared", 1],
  ["printingPrepared", 1],
  ["regularPrinting", 1],
  ["wearInfo", 2],
  ["cardNormal", 3],
  ["printArtwork", 1],
  ["faceProcedural", 1],
  ["printingProcedural", 1],
  ["uExclusions", 32],
  ["maskBottomUp", 1],
] as const;
export const CARD_FOIL_SHARED_FIELDS = [
  ["facePixelSize", 2],
  ["previewKind", 1],
  ["hasMask", 1],
  ["aspect", 1],
  ["pointer", 2],
  ["surfaceInfo", 4],
  ["ripple0", 4],
  ["ripple1", 4],
  ["ripple2", 4],
  ["ripple3", 4],
  ["rainFogDensity", 1],
  ["heatDeformation", 1],
  ["cardstockAmount", 1],
  ["printDotsInfo", 4],
  ["artBounds", 8],
] as const;
const offsets: Record<string, number> = {};
let nextOffset = 0;
for (const [name, size] of CARD_FOIL_INSTANCE_FIELDS) {
  offsets[name] = nextOffset;
  nextOffset += Math.ceil(size / 4);
}
export const CARD_FOIL_DATA_TEXELS = nextOffset + 4;
export const CARD_FOIL_TRANSFORM_OFFSET = nextOffset;
const field = (name: string, components: string) => `instanceValue(${offsets[name]}).${components}`;
const ownFields = [
  "uSize",
  "uRadius",
  "uExclusionCount",
  "uUvTop",
  "uUvBottom",
  "hasPrinting",
  "cornerRadius",
  "finishBase",
  "hasCoverage",
  "facePrepared",
  "printingPrepared",
  "regularPrinting",
  "wearInfo",
  "cardNormal",
  "printArtwork",
  "faceProcedural",
  "printingProcedural",
  "maskBottomUp",
];
const lengths: Record<string, number> = Object.fromEntries(CARD_FOIL_INSTANCE_FIELDS);
const ownComponents: string[] = [];
const ownBindings = ownFields
  .map((name) => {
    const start = ownComponents.length;
    const components = [];
    for (let index = 0; index < lengths[name]; index++) {
      ownComponents.push(field(name, "xyzw"[index]));
      const component = start + index;
      components.push(`ownData[${Math.floor(component / 4)}].${"xyzw"[component % 4]}`);
    }
    const value =
      components.length === 1 ? components[0] : `vec${components.length}(${components.join(",")})`;
    return `#define ${name} ${name === "uExclusionCount" ? `int(${value})` : value}`;
  })
  .join("\n");
const ownVaryings = Math.ceil(ownComponents.length / 4);
const ownAssignments = Array.from(
  { length: ownVaryings },
  (_, index) =>
    `ownData[${index}]=vec4(${Array.from({ length: 4 }, (_, component) => ownComponents[index * 4 + component] ?? "0.").join(",")});`,
).join("\n");
const fallbackBindings = CARD_FOIL_INSTANCE_FIELDS.filter(([name]) => ownFields.includes(name))
  .map(
    ([name, size]) =>
      `uniform ${name === "uExclusionCount" ? "int" : size === 1 ? "float" : `vec${size}`} ${name};`,
  )
  .filter((line) => !line.includes("vec32"))
  .join("\n");
const quadVertex = `in vec2 aPosition; in vec2 aUV;
uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix;
out vec2 vUV;`;
const deformationSampling = `
// Match Card Glint 0.6 gpu/deformation-shader cardSource; the SDK does not export it.
vec2 cardSource(vec2 local){
 float phase=${surfaceSeed(1)}*6.28318530718;
 return local+heatDeformation*vec2(
  .72*sin(local.y*43.+surfaceTime*2.1+phase)+.28*sin(local.y*81.-surfaceTime*3.4+phase*.7),
  .18*sin(local.x*29.-surfaceTime*1.3+phase));
}
vec2 materialUv(vec2 source){
 return inverse(mat2(uUvTop.zw-uUvTop.xy,uUvBottom.xy-uUvTop.xy))*(source-uUvTop.xy);
}
bool fullCard(){
 vec2 span=abs(uUvTop.zw-uUvTop.xy)+abs(uUvBottom.xy-uUvTop.xy);
 return all(lessThan(abs(span-1.),vec2(.00001)))&&
  all(lessThan(abs(min(min(uUvTop.xy,uUvTop.zw),min(uUvBottom.xy,uUvBottom.zw))),vec2(.00001)));
}
`;
const commonSampling = `
vec3 linearInk(vec3 c) {
  return mix(c/12.92,pow(max((c+.055)/1.055,vec3(0.)),vec3(2.4)),step(vec3(.04045),c));
}
vec4 decodeInk(vec4 ink,float prepared) {
  return vec4(linearInk(ink.rgb/mix(max(ink.a,.00001),1.,prepared)),ink.a);
}
vec2 faceUv(vec2 uv) {
  return mix(mix(uUvTop.xy,uUvTop.zw,uv.x),mix(uUvBottom.xy,uUvBottom.zw,uv.x),uv.y);
}
vec4 glintSampleFace(vec2 uv);
float glintSampleMask(vec2 uv);
`;
const programs = new Map<string, GlProgram>();

export function getCardFoilProgram(instanced: boolean, procedural: boolean): GlProgram {
  const key = `${instanced}:${procedural}`;
  const cached = programs.get(key);
  if (cached) return cached;
  const pair = instanced;
  const vertex = `#version 300 es
precision highp float;
precision highp int;
uniform float heatDeformation;
${quadVertex}
${
  instanced
    ? `uniform highp sampler2D instanceData;
flat out int instanceRow;
flat out vec4 ownData[${ownVaryings}];
flat out vec4 layerIds; flat out vec4 uColor;
vec4 instanceValue(int column){return texelFetch(instanceData,ivec2(column,gl_InstanceID),0);}`
    : "uniform mat3 uTransformMatrix; uniform vec4 uUvTop; uniform vec4 uUvBottom;"
}
void main(){
 vec2 local=aPosition;
 vec4 top=${instanced ? `instanceValue(${offsets.uUvTop})` : "uUvTop"};
 vec4 bottom=${instanced ? `instanceValue(${offsets.uUvBottom})` : "uUvBottom"};
 vec2 span=abs(top.zw-top.xy)+abs(bottom.xy-top.xy);
 if(heatDeformation>0.&&all(lessThan(abs(span-1.),vec2(.00001)))&&
  all(lessThan(abs(min(min(top.xy,top.zw),min(bottom.xy,bottom.zw))),vec2(.00001)))){
  mat2 mapping=inverse(mat2(top.zw-top.xy,bottom.xy-top.xy));
  vec2 pad=heatDeformation*(abs(mapping[0])+abs(mapping[1])*.18);
  local=local*(1.+2.*pad)-pad;
 }
 vUV=local;
 ${
   instanced
     ? `instanceRow=gl_InstanceID;
 ${ownAssignments}
 layerIds=instanceValue(${nextOffset + 2});
 uColor=instanceValue(${nextOffset + 3});
 vec4 t=instanceValue(${nextOffset}); vec4 s=instanceValue(${nextOffset + 1});
 vec2 p=vec2(t.x*local.x+t.z*local.y+s.x,t.y*local.x+t.w*local.y+s.y);
 vec3 position=uProjectionMatrix*uWorldTransformMatrix*vec3(p,1.);`
     : "vec3 position=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(local,1.);"
 }
 gl_Position=vec4(position.xy,0.,1.);
}`;
  const fragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
in vec2 vUV; out vec4 finalColor;
uniform float heatDeformation;
${
  instanced
    ? `uniform highp sampler2D instanceData;
flat in int instanceRow;
flat in vec4 ownData[${ownVaryings}];
vec4 instanceValue(int column){return texelFetch(instanceData,ivec2(column,instanceRow),0);}
${ownBindings}
#define exclusionAt(i) instanceValue(${offsets.uExclusions}+i)
uniform sampler2DArray faces; uniform sampler2DArray masks;
uniform sampler2DArray printings; uniform sampler2DArray coverages;
flat in vec4 layerIds;
flat in vec4 uColor;`
    : `${fallbackBindings}
uniform vec4 uExclusions[8];
#define exclusionAt(i) uExclusions[i]
uniform vec4 uColor;
uniform sampler2D face; uniform sampler2D mask;
uniform sampler2D printing; uniform sampler2D coverage;`
}
${commonSampling}
#define flat uniform
#define in
${foilShader({ sampling: "host", artWindows: pair ? "pair" : "array", liquid: false })}
${procedural ? PRINT_DOTS_GLSL : ""}
vec4 glintSurfaceTexture(sampler2D inputMap,vec2 uv);
#define texture glintSurfaceTexture
${SURFACE_GLSL}
#undef texture
vec4 glintSurfaceTexture(sampler2D inputMap,vec2 uv){return texture(inputMap,vec2(uv.x,1.-uv.y));}
${WORN_GLSL}
${CARDSTOCK_GLSL}
#undef in
#undef flat
${deformationSampling}
vec4 rawFace(vec2 uv){
 return decodeInk(${instanced ? "texture(faces,vec3(vec2(uv.x,mix(1.-uv.y,uv.y,facePrepared)),layerIds.x))" : "texture(face,vec2(uv.x,mix(1.-uv.y,uv.y,facePrepared)))"},facePrepared);
}
float inArtwork(vec2 uv){
 ${pair ? "return float((all(greaterThanEqual(uv,artBounds.xy))&&all(lessThanEqual(uv,artBounds.zw))&&artBounds.z>artBounds.x)||(all(greaterThanEqual(uv,artBounds2.xy))&&all(lessThanEqual(uv,artBounds2.zw))&&artBounds2.z>artBounds2.x));" : "for(int i=0;i<8;i++){vec4 b=artBounds[i];if(b.z>b.x&&all(greaterThanEqual(uv,b.xy))&&all(lessThanEqual(uv,b.zw)))return 1.;}return 0.;"}
}
vec4 dots(vec4 ink,vec2 uv,float enabled){
 ${procedural ? "if(enabled>.5&&(printArtwork>.5||inArtwork(uv)<.5))ink.rgb=previewLinear(printDotInk(previewInk(ink.rgb),uv));" : ""}
 return ink;
}
vec4 glintSampleFace(vec2 uv){return dots(rawFace(uv),uv,faceProcedural);}
float glintSampleMask(vec2 uv){vec2 p=vec2(uv.x,mix(1.-uv.y,uv.y,maskBottomUp));return ${instanced ? "texture(masks,vec3(p,layerIds.y)).r" : "texture(mask,p).r"};}
vec4 rawPrinting(vec2 uv){
 return decodeInk(${instanced ? "texture(printings,vec3(vec2(uv.x,mix(1.-uv.y,uv.y,printingPrepared)),layerIds.z))" : "texture(printing,vec2(uv.x,mix(1.-uv.y,uv.y,printingPrepared)))"},printingPrepared);
}
vec4 finishPrinting(vec2 uv){return dots(rawPrinting(uv),uv,printingProcedural);}
float finishCoverage(vec2 uv){return hasCoverage>.5?${instanced ? "texture(coverages,vec3(uv.x,1.-uv.y,layerIds.w)).r" : "texture(coverage,vec2(uv.x,1.-uv.y)).r"}:1.;}
vec3 modernSurface(vec2 uv,vec3 normal,vec3 view,vec2 pixel){
 vec3 base=glintSampleFace(uv).rgb;
 vec3 ink=previewInk(base);
 vec3 color=regularPrinting>0.?ink:previewKind>=5.&&previewKind<8.?animatedSurface(uv,normal):previewFoil(uv,normal,view);
 if(regularPrinting<1.)color=cardstockGloss(uv,ink,color);
 if(wearInfo.x>0.)color=wornSurface(uv,ink,color,normal,view,wearInfo.y,wearInfo.x,previewKind==9.?1.:step(.5,previewKind)*(1.-step(4.5,previewKind)),pixel);
 vec3 under=mix(base,previewLinear(color),finishCoverage(uv));
 if(hasPrinting>0.){vec4 top=finishPrinting(uv);under=mix(under,top.rgb,top.a);}
 return previewInk(under);
}
void main(){
 vec2 originalUv=faceUv(vUV);
 vec2 sourceUv=heatDeformation>0.?cardSource(originalUv):originalUv;
 vec2 uv=vec2(sourceUv.x,1.-sourceUv.y);
 ${procedural ? "printFootprint=printDotFootprint(uv);" : ""}
 vec2 pixel=fwidth(uv*vec2(1.,aspect));
 vec2 point=vUV*uSize;
 for(int i=0;i<8;i++){if(i>=uExclusionCount)break;vec4 e=exclusionAt(i);if(e.z>0.&&point.x>=e.x&&point.y>=e.y&&point.x<=e.x+e.z&&point.y<=e.y+e.w){
  if(heatDeformation<=0.)discard;
  if(any(lessThan(originalUv,vec2(0.)))||any(greaterThan(originalUv,vec2(1.))))discard;
  vec2 protectedUv=vec2(originalUv.x,1.-originalUv.y);
  vec4 base=rawFace(protectedUv);
  if(hasPrinting>0.){
   vec4 top=rawPrinting(protectedUv);
   float alpha=top.a+base.a*(1.-top.a);
   base=vec4((top.rgb*top.a+base.rgb*base.a*(1.-top.a))/max(alpha,.00001),alpha);
  }
  float alpha=base.a*uColor.a;
  finalColor=vec4(previewInk(base.rgb)*alpha,alpha);return;
 }}
 vec2 clipPoint=(heatDeformation>0.&&fullCard()?materialUv(sourceUv):vUV)*uSize;
 vec2 corner=abs(clipPoint-uSize*.5)-(uSize*.5-uRadius);
 if(length(max(corner,0.))+min(max(corner.x,corner.y),0.)>uRadius)discard;
 if(any(lessThan(sourceUv,vec2(0.)))||any(greaterThan(sourceUv,vec2(1.))))discard;
 vec2 sc=abs((uv-.5)*vec2(1.,aspect))-(vec2(.5,aspect*.5)-cornerRadius);
 if(length(max(sc,0.))+min(max(sc.x,sc.y),0.)>cornerRadius)discard;
 vec4 ink=glintSampleFace(uv);
 vec3 normal=studioLighting>.5?normalize(cardNormal):normalize(vec3((pointer-.5)*vec2(.24,-.24),1.));
 vec3 view=studioLighting>.5?studioCardView(uv,normal):normalize(vec3((uv-.5)*vec2(-.65,-.90),1.));
 vec3 color=modernSurface(uv,normal,view,pixel);
 float alpha=mix(ink.a,1.,hasPrinting)*uColor.a;
 finalColor=vec4(color*alpha,alpha);
}`;
  const program = new GlProgram({ vertex, fragment, name: `manabrew-card-glint-host-${key}` });
  programs.set(key, program);
  return program;
}
