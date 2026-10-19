import { z } from "zod";

export const Resolution = z.enum(["480p", "720p", "1080p", "4k"]);
export type Resolution = z.infer<typeof Resolution>;

export const AspectRatio = z.enum(["16:9", "9:16", "1:1"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

/** Quality modes from the cost doc §9. Quality changes execution policy, not the usage model. */
export const QualityMode = z.enum(["draft", "production", "master"]);
export type QualityMode = z.infer<typeof QualityMode>;

export const QUALITY_RESOLUTION: Record<QualityMode, Resolution> = {
  draft: "720p",
  production: "1080p",
  master: "4k",
};

const RESOLUTION_HEIGHT: Record<Resolution, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "4k": 2160,
};

export function frameSize(resolution: Resolution, aspect: AspectRatio): { width: number; height: number } {
  const short = RESOLUTION_HEIGHT[resolution];
  const long = Math.round((short * 16) / 9);
  switch (aspect) {
    case "16:9":
      return { width: long, height: short };
    case "9:16":
      return { width: short, height: long };
    case "1:1":
      return { width: short, height: short };
  }
}

/** Pixel count relative to another resolution; used to scale pixel-billed provider prices. */
export function pixelRatio(target: Resolution, base: Resolution): number {
  return (RESOLUTION_HEIGHT[target] / RESOLUTION_HEIGHT[base]) ** 2;
}
