import sharp from "sharp";

export type RenderOptions = {
  widthPx: number;
  heightPx: number;
  dpi: number;
  fit?: "cover" | "contain";
  positionX?: number;
  positionY?: number;
  zoom?: number;
  rotation?: number;
};

const safeDimension = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1 || value > 30_000) throw new Error(`${label} must be an integer between 1 and 30000`);
};

/** Render an approved image at configured print pixel dimensions and embed physical DPI metadata. */
export async function renderProductionImage(source: Buffer, options: RenderOptions): Promise<Buffer> {
  safeDimension(options.widthPx, "widthPx");
  safeDimension(options.heightPx, "heightPx");
  if (options.widthPx * options.heightPx > 100_000_000) throw new Error("Output may not exceed 100 megapixels");
  if (!Number.isFinite(options.dpi) || options.dpi < 72 || options.dpi > 1200) throw new Error("dpi must be between 72 and 1200");
  const zoom = Math.min(4, Math.max(0.25, options.zoom ?? 1));
  const rotate = Math.max(-180, Math.min(180, options.rotation ?? 0));
  const oriented = await sharp(source, { limitInputPixels: 200_000_000, failOn: "error" }).rotate().rotate(rotate, { background: { r: 255, g: 255, b: 255 } }).png().toBuffer();
  const metadata = await sharp(oriented).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image dimensions could not be read");
  const x = Math.max(0, Math.min(1, options.positionX ?? 0.5));
  const y = Math.max(0, Math.min(1, options.positionY ?? 0.5));
  let pipeline = sharp(oriented, { limitInputPixels: 200_000_000, failOn: "error" });
  if (options.fit === "contain") {
    pipeline = pipeline.resize({ width: options.widthPx, height: options.heightPx, fit: "contain", background: { r: 255, g: 255, b: 255 } });
  } else {
    const imageAspect = metadata.width / metadata.height;
    const targetAspect = options.widthPx / options.heightPx;
    const baseWidth = imageAspect > targetAspect ? metadata.height * targetAspect : metadata.width;
    const baseHeight = imageAspect > targetAspect ? metadata.height : metadata.width / targetAspect;
    const cropWidth = Math.max(1, Math.min(metadata.width, Math.round(baseWidth / zoom)));
    const cropHeight = Math.max(1, Math.min(metadata.height, Math.round(baseHeight / zoom)));
    const left = Math.max(0, Math.min(metadata.width - cropWidth, Math.round((metadata.width - cropWidth) * x)));
    const top = Math.max(0, Math.min(metadata.height - cropHeight, Math.round((metadata.height - cropHeight) * y)));
    pipeline = pipeline.extract({ left, top, width: cropWidth, height: cropHeight }).resize({ width: options.widthPx, height: options.heightPx, fit: "fill" });
  }

  return pipeline
    .withMetadata({ density: options.dpi, orientation: 1 })
    .png({ compressionLevel: 8 })
    .toBuffer();
}

/** Generate a lower-resolution preview with a diagonal watermark; never use this output for production. */
export async function renderWatermarkedPreview(source: Buffer, watermark = "PREVIEW"): Promise<Buffer> {
  const image = sharp(source, { limitInputPixels: 200_000_000, failOn: "error" });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image dimensions could not be read");
  const width = Math.min(metadata.width, 1200);
  const height = Math.max(1, Math.round((metadata.height / metadata.width) * width));
  const safeText = watermark.replace(/[<>&"']/g, "");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-24 ${width / 2} ${height / 2})" fill="white" fill-opacity=".44" font-family="Arial,sans-serif" font-size="${Math.max(18, Math.round(width / 12))}" font-weight="700" text-anchor="middle"><text x="${width / 2}" y="${height / 2}">${safeText}</text></g></svg>`);
  return image.resize({ width, height, fit: "fill" }).composite([{ input: overlay }]).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}
