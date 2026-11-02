import test from "node:test";
import assert from "node:assert/strict";
import { defaultPricing, framePrice, servicePrice } from "../dist/index.js";

test("frame base prices match the configured price list", () => {
  assert.deepEqual(Object.entries(defaultPricing.frames), [["8x12", 449], ["12x15", 849], ["12x18", 999], ["16x20", 1699]]);
});

test("each frame size calculates the glass, glitter, and non-breakable price", () => {
  const expected = { "8x12": [449, 499, 499], "12x15": [849, 899, 899], "12x18": [999, 1049, 1049], "16x20": [1699, 1749, 1749] };
  for (const [size, prices] of Object.entries(expected)) {
    assert.equal(framePrice(size, "glass"), prices[0]);
    assert.equal(framePrice(size, "glitter"), prices[1]);
    assert.equal(framePrice(size, "non-breakable"), prices[2]);
  }
});

test("digital printing and restoration add the service fee to the frame", () => {
  assert.equal(servicePrice("printing", "8x12"), 748);
  assert.equal(servicePrice("restoration", "8x12"), 748);
  assert.equal(servicePrice("printing", "12x15", "glitter"), 1198);
});

test("price calculations accept configured database values", () => {
  const configured = {
    ...defaultPricing,
    frames: { ...defaultPricing.frames, "8x12": 525 },
    materialAddons: { ...defaultPricing.materialAddons, glitter: 75 },
    digitalPrintingFee: 350,
  };
  assert.equal(framePrice("8x12", "glass", configured), 525);
  assert.equal(framePrice("8x12", "glitter", configured), 600);
  assert.equal(servicePrice("printing", "8x12", "glass", configured), 875);
});
