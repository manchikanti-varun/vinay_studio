import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { renderProductionImage, renderWatermarkedPreview } from "../dist/index.js";

test("production rendering outputs requested pixel dimensions and DPI", async () => {
  const source = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 174, g: 150, b: 110 } } }).png().toBuffer();
  const output = await renderProductionImage(source, { widthPx: 1200, heightPx: 1800, dpi: 300, fit: "cover" });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1800);
  assert.equal(metadata.density, 300);
});

test("preview rendering is capped at 1200 pixels and remains a distinct JPEG", async () => {
  const source = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 174, g: 150, b: 110 } } }).png().toBuffer();
  const output = await renderWatermarkedPreview(source);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 800);
});
