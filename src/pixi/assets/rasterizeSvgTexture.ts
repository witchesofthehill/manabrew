import { ImageSource, Texture } from "pixi.js";

export function rasterizeSvgTexture(svg: string, width: number, height = width): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    let objectUrl: string | null = null;
    let image: HTMLImageElement | null = null;

    const cleanup = () => {
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    try {
      objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      image = new Image();
      const loadedImage = image;
      loadedImage.width = width;
      loadedImage.height = height;
      loadedImage.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("2d context unavailable");
          context.drawImage(loadedImage, 0, 0, width, height);
          resolve(new Texture({ source: new ImageSource({ resource: canvas }) }));
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };
      loadedImage.onerror = () => {
        cleanup();
        reject(new Error("svg decode failed"));
      };
      loadedImage.src = objectUrl;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
