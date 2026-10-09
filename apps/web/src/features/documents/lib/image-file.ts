export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;

export function validateImageFile(file: Pick<File, "size" | "type">) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error(
      "Choose a JPEG, PNG, or WebP image. PDFs and HEIC are not supported yet.",
    );
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Choose an image smaller than 8 MB.");
  }
}

export function validateImageDimensions(width: number, height: number) {
  if (width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(
      "This image is too large to process safely. Use a photo up to 16 megapixels.",
    );
  }
}

export async function prepareImage(file: File, rotation: number) {
  const bitmap = await createImageBitmap(file);
  try {
    validateImageDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(
      1,
      Math.sqrt(4_000_000 / (bitmap.width * bitmap.height)),
    );
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const sideways = rotation % 180 !== 0;
    const canvas = document.createElement("canvas");
    canvas.dataset.originalWidth = String(bitmap.width);
    canvas.dataset.originalHeight = String(bitmap.height);
    canvas.dataset.rotation = String(rotation);
    canvas.width = sideways ? height : width;
    canvas.height = sideways ? width : height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser cannot prepare this image.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(bitmap, -width / 2, -height / 2, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export interface OcrBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function originalOcrBox(
  box: OcrBBox,
  width: number,
  height: number,
  originalWidth: number,
  originalHeight: number,
  rotation: number,
): OcrBBox {
  const point = (x: number, y: number) => {
    switch (rotation) {
      case 90:
        return [(y / height) * originalWidth, (1 - x / width) * originalHeight];
      case 180:
        return [
          (1 - x / width) * originalWidth,
          (1 - y / height) * originalHeight,
        ];
      case 270:
        return [(1 - y / height) * originalWidth, (x / width) * originalHeight];
      default:
        return [(x / width) * originalWidth, (y / height) * originalHeight];
    }
  };
  const corners = [point(box.x0, box.y0), point(box.x1, box.y1)];
  return {
    x0: Math.min(...corners.map((p) => p[0])),
    y0: Math.min(...corners.map((p) => p[1])),
    x1: Math.max(...corners.map((p) => p[0])),
    y1: Math.max(...corners.map((p) => p[1])),
  };
}

export function bboxToPercent(
  bbox: OcrBBox,
  stageWidth: number,
  stageHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (stageWidth <= 0 || stageHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const x0 = Math.max(0, Math.min(stageWidth, bbox.x0));
  const y0 = Math.max(0, Math.min(stageHeight, bbox.y0));
  const x1 = Math.max(x0, Math.min(stageWidth, bbox.x1));
  const y1 = Math.max(y0, Math.min(stageHeight, bbox.y1));
  return {
    left: (x0 / stageWidth) * 100,
    top: (y0 / stageHeight) * 100,
    width: ((x1 - x0) / stageWidth) * 100,
    height: ((y1 - y0) / stageHeight) * 100,
  };
}

export function clampZoom(zoom: number, min = 0.5, max = 3.0): number {
  return Math.min(max, Math.max(min, Number(zoom.toFixed(2))));
}
