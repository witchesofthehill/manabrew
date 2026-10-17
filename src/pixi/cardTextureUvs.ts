import { Matrix, Point, type Container, type Rectangle, type Sprite } from "pixi.js";

const surfacePoint = new Point();
const texturePoint = new Point();
const textureTransform = new Matrix();

export function writeCardTextureUvs(
  sprite: Sprite,
  relativeTo: Container,
  surface: Pick<Rectangle, "x" | "y" | "width" | "height">,
  output: Float32Array,
): void {
  const { texture, anchor } = sprite;
  const { orig, trim, uvs } = texture;
  const width = trim?.width ?? orig.width;
  const height = trim?.height ?? orig.height;
  const offsetX = anchor.x * orig.width - (trim?.x ?? 0);
  const offsetY = anchor.y * orig.height - (trim?.y ?? 0);
  textureTransform.identity();
  for (let node: Container | null = sprite; node && node !== relativeTo; node = node.parent) {
    node.updateLocalTransform();
    textureTransform.prepend(node.localTransform);
  }
  textureTransform.invert();
  for (let corner = 0; corner < 4; corner++) {
    surfacePoint.set(
      surface.x + (corner === 1 || corner === 2 ? surface.width : 0),
      surface.y + (corner >= 2 ? surface.height : 0),
    );
    textureTransform.apply(surfacePoint, texturePoint);
    const x = (texturePoint.x + offsetX) / width;
    const y = (texturePoint.y + offsetY) / height;
    output[corner * 2] = uvs.x0 + x * (uvs.x1 - uvs.x0) + y * (uvs.x3 - uvs.x0);
    output[corner * 2 + 1] = uvs.y0 + x * (uvs.y1 - uvs.y0) + y * (uvs.y3 - uvs.y0);
  }
}
