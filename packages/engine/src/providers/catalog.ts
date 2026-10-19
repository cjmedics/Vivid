import { pixelRatio, usd, type Capability, type MicroUsd, type ModelTier, type Resolution } from "@vivid/core";
import type { ModelSpec, ModelPricing, ProviderId } from "./types.js";

/**
 * Provider price board — cost doc §2–3, checked 2026-09-26.
 *
 * Planning rules applied here:
 *  - Higgsfield uses the non-sale price; promotions are margin upside, not economics.
 *  - OpenRouter "from" prices for Seedance are treated as 480p-derived and pixel-scaled
 *    (the doc confirms this for Seedance 2.5). Other "from" prices are treated as 720p.
 *  - Slugs and capabilities are unverified until synced from each provider's discovery API
 *    (OpenRouter: GET /api/v1/videos/models).
 */

const CHECKED = "2026-09-26";
const BASE_CAPS: Capability[] = ["text-to-video", "image-to-video"];

function model(
  providerId: ProviderId,
  modelId: string,
  displayName: string,
  tier: ModelTier,
  pricing: ModelPricing,
  opts: { caps?: Capability[]; resolutions?: Resolution[]; maxDurationSec?: number } = {},
): ModelSpec {
  return {
    key: `${providerId}:${modelId}`,
    providerId,
    modelId,
    displayName,
    tier,
    capabilities: [...BASE_CAPS, ...(opts.caps ?? [])],
    resolutions: opts.resolutions ?? ["720p", "1080p"],
    maxDurationSec: opts.maxDurationSec ?? 10,
    pricing,
    priceCheckedAt: CHECKED,
    verified: false,
  };
}

const pixel = (perSecond: number, base: Resolution): ModelPricing => ({ perSecond: usd(perSecond), baseResolution: base, pixelScaled: true });
const flat = (perSecond: number): ModelPricing => ({ perSecond: usd(perSecond), baseResolution: "720p", pixelScaled: false });

export const DEFAULT_CATALOG: ModelSpec[] = [
  // ── OpenRouter (primary) ───────────────────────────────────────────────
  model("openrouter", "bytedance/seedance-2.0-mini", "Seedance 2.0 Mini", "efficient", pixel(0.03363, "480p")),
  model("openrouter", "bytedance/seedance-2.0-fast", "Seedance 2.0 Fast", "efficient", pixel(0.04035, "480p")),
  model("openrouter", "alibaba/wan-3.0", "Wan 3.0", "efficient", pixel(0.0425, "720p")),
  model("openrouter", "google/veo-3.1-lite", "Veo 3.1 Lite", "efficient", {
    ...flat(0.05),
    byResolution: { "720p": usd(0.05), "1080p": usd(0.08) },
  }, { caps: ["audio"] }),
  model("openrouter", "minimax/h3-max", "H3 Max", "efficient", pixel(0.05, "720p")),
  model("openrouter", "alibaba/wan-3.0-prime", "Wan 3.0 Prime", "efficient", pixel(0.068, "720p"), { caps: ["reference-to-video"] }),
  model("openrouter", "bytedance/seedance-2.0", "Seedance 2.0", "balanced", pixel(0.06726, "480p"), { caps: ["reference-to-video"] }),
  model("openrouter", "google/veo-3.1-fast", "Veo 3.1 Fast", "balanced", {
    ...flat(0.1),
    byResolution: { "720p": usd(0.1), "1080p": usd(0.12) },
  }, { caps: ["audio"] }),
  model("openrouter", "bytedance/seedance-2.5", "Seedance 2.5", "balanced", pixel(0.1028, "480p"), {
    caps: ["reference-to-video", "video-input"],
    resolutions: ["480p", "720p", "1080p"],
  }),

  // ── Higgsfield (primary, non-sale prices) ─────────────────────────────
  model("higgsfield", "minimax-hailuo-2.3", "MiniMax Hailuo 2.3", "efficient", flat(0.0467)),
  model("higgsfield", "wan-3.0", "Wan 3.0", "efficient", flat(0.05)),
  model("higgsfield", "kling-3.0", "Kling 3.0", "balanced", flat(0.084), { caps: ["multi-shot"] }),
  model("higgsfield", "kling-o3", "Kling O3", "balanced", flat(0.084), { caps: ["reference-to-video", "multi-shot"] }),
  model("higgsfield", "ltx-2.5-pro", "LTX 2.5 Pro", "balanced", flat(0.12)),
  model("higgsfield", "seedance-2.0", "Seedance 2.0", "balanced", flat(0.1407), { caps: ["reference-to-video"] }),
  model("higgsfield", "cinema-studio-4.0", "Cinema Studio 4.0", "premium", flat(0.2057)),
  model("higgsfield", "genjutsu", "Genjutsu", "premium", flat(0.318), { caps: ["motion-transfer", "video-input"] }),

  // ── Google direct (fallback / premium benchmark) ──────────────────────
  model("google", "veo-3.1-generate", "Veo 3.1 Standard", "premium", {
    ...flat(0.4),
    byResolution: { "720p": usd(0.4), "1080p": usd(0.4), "4k": usd(0.6) },
  }, { caps: ["audio", "reference-to-video"], resolutions: ["720p", "1080p", "4k"] }),
];

/** Per-second price for this model at this resolution, before retries. */
export function pricePerSecond(model: ModelSpec, resolution: Resolution, audio: boolean): MicroUsd {
  const p = model.pricing;
  const base =
    p.byResolution?.[resolution] ??
    (p.pixelScaled ? Math.round(p.perSecond * pixelRatio(resolution, p.baseResolution)) : p.perSecond);
  return base + (audio ? (p.audioPerSecond ?? 0) : 0);
}

/** Providers bill whole seconds; round up so estimates never undershoot. */
export function attemptCost(model: ModelSpec, resolution: Resolution, durationSec: number, audio: boolean): MicroUsd {
  return pricePerSecond(model, resolution, audio) * Math.ceil(durationSec);
}
