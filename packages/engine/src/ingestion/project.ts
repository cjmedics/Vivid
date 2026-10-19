import { BrandKit, ProductIR, VideoBrief } from "@vivid/core";

/** Reopen only self-contained design assets; never fetch or refresh a source. */
export function reopenProject(input: unknown, overrides: { brand?: unknown; brief?: unknown } = {}): ProductIR {
  const ir = ProductIR.parse(input);
  const brand = BrandKit.parse(overrides.brand ?? ir.brand);
  const brief = VideoBrief.parse(overrides.brief ?? {
    productName: ir.product.name, description: ir.product.description, category: ir.product.category,
    headline: ir.copy.headline, subtext: ir.copy.subtext, cta: ir.copy.cta,
  });
  for (const screen of ir.screens) {
    const capture = embeddedPng(screen.captureUrl, "Saved screen capture");
    if (!screen.width || !screen.height || Math.abs(capture.width / capture.height - screen.width / screen.height) > 0.01) {
      throw new Error("Saved screen capture must match its original frame dimensions");
    }
    if (screen.layerScene && (screen.layerScene.width !== screen.width || screen.layerScene.height !== screen.height)) {
      throw new Error("Saved layer scene dimensions must match the screen");
    }
  }
  if (brand.logoUrl) embeddedPng(brand.logoUrl, "Saved brand logo");
  if (brand.fontUrl) {
    const match = /^data:font\/woff2;base64,([A-Za-z0-9+/]+={0,2})$/.exec(brand.fontUrl);
    const bytes = match ? Buffer.from(match[1]!, "base64") : undefined;
    if (!bytes || bytes.length < 4 || bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== "wOF2") {
      throw new Error("Saved project fonts must be embedded WOFF2 assets");
    }
  }
  return ProductIR.parse({
    ...ir, brand, product: { ...ir.product, name: brief.productName, description: brief.description, category: brief.category },
    copy: { headline: brief.headline, subtext: brief.subtext, cta: brief.cta },
  });
}

function embeddedPng(value: string | undefined, label: string): { width: number; height: number } {
  const match = value && /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  const bytes = match ? Buffer.from(match[1]!, "base64") : undefined;
  if (!bytes || bytes.length < 24 || bytes.length > 20 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(label + " must be an embedded PNG smaller than 20 MiB; saved projects do not download external assets");
  }
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error(label + " has invalid dimensions");
  return { width, height };
}
