export type FrameMaterial = "glass" | "glitter" | "non-breakable";
export type ProductCategory = "frames" | "printing" | "mugs" | "restoration";
export type FrameSize = "8x12" | "12x15" | "12x18" | "16x20";
export type PricingTable = {
  frames: Record<FrameSize, number>;
  materialAddons: Record<FrameMaterial, number>;
  mugs: { white: number; coloured: number };
  digitalPrintingFee: number;
  restorationFee: number;
};

export const defaultPricing = {
  frames: { "8x12": 449, "12x15": 849, "12x18": 999, "16x20": 1699 },
  materialAddons: { glass: 0, glitter: 50, "non-breakable": 50 },
  mugs: { white: 299, coloured: 499 },
  digitalPrintingFee: 299,
  restorationFee: 299,
} as const satisfies PricingTable;

export function framePrice(size: FrameSize, material: FrameMaterial, pricing: PricingTable = defaultPricing): number {
  return pricing.frames[size] + pricing.materialAddons[material];
}

export function servicePrice(kind: "printing" | "restoration", size: FrameSize, material: FrameMaterial = "glass", pricing: PricingTable = defaultPricing): number {
  const fee = kind === "printing" ? pricing.digitalPrintingFee : pricing.restorationFee;
  return fee + framePrice(size, material, pricing);
}

export const frameSizes = Object.keys(defaultPricing.frames) as Array<keyof typeof defaultPricing.frames>;
