import React from "react";
import type { Region, Screen, ShotPlan } from "./types";

/**
 * Draws a captured screen from its Product IR regions. Used until browser capture
 * supplies real screenshots; region geometry is identical either way, so camera and
 * interaction primitives target the same coordinates.
 */

export interface ScreenOverrides {
  /** Region being emphasized, and 0..1 emphasis strength. */
  emphasis?: { regionId: string; amount: number };
  /** Replacement text for a metric value (counter-tick). */
  values?: Record<string, string>;
  /** 0..1 growth of chart bars. */
  chartProgress?: number;
  pressedRegionId?: string;
}

export const SyntheticScreen: React.FC<{ screen: Screen; brand: ShotPlan["brand"]; overrides?: ScreenOverrides }> = ({
  screen,
  brand,
  overrides = {},
}) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: mix(brand.background, "#ffffff", 0.04),
        fontFamily: brand.fontFamily,
        color: brand.foreground,
        overflow: "hidden",
      }}
    >
      {screen.regions.map((r) => {
        const dim = overrides.emphasis && overrides.emphasis.regionId !== r.id ? 1 - 0.55 * overrides.emphasis.amount : 1;
        const focus = overrides.emphasis?.regionId === r.id ? overrides.emphasis.amount : 0;
        return (
          <div
            key={r.id}
            style={{
              position: "absolute",
              left: `${r.bbox.x * 100}%`,
              top: `${r.bbox.y * 100}%`,
              width: `${r.bbox.w * 100}%`,
              height: `${r.bbox.h * 100}%`,
              opacity: dim,
              padding: 6,
              boxSizing: "border-box",
            }}
          >
            <RegionView region={r} brand={brand} overrides={overrides} focus={focus} />
          </div>
        );
      })}
    </div>
  );
};

const RegionView: React.FC<{ region: Region; brand: ShotPlan["brand"]; overrides: ScreenOverrides; focus: number }> = ({
  region,
  brand,
  overrides,
  focus,
}) => {
  const card: React.CSSProperties = {
    width: "100%",
    height: "100%",
    borderRadius: 14,
    background: mix(brand.background, "#ffffff", 0.08),
    border: `1px solid ${mix(brand.background, "#ffffff", 0.14)}`,
    boxSizing: "border-box",
    boxShadow: focus > 0 ? `0 0 0 ${3 * focus}px ${brand.accent}, 0 0 ${40 * focus}px ${brand.accent}66` : "none",
    transform: `scale(${1 + 0.04 * focus})`,
  };

  switch (region.kind) {
    case "nav":
      return (
        <div style={{ ...card, borderRadius: 0, background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 18px" }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: brand.primary }} />
          <div style={{ fontWeight: 700, fontSize: 22 }}>{region.label}</div>
        </div>
      );
    case "sidebar":
      return (
        <div style={{ ...card, background: "transparent", border: "none", display: "flex", flexDirection: "column", gap: 14, padding: 18 }}>
          {["Overview", "Revenue", "Forecasts", "Customers", "Settings"].map((item, i) => (
            <div key={item} style={{ fontSize: 17, opacity: i === 1 ? 1 : 0.55, fontWeight: i === 1 ? 600 : 400 }}>
              {item}
            </div>
          ))}
        </div>
      );
    case "metric":
      return (
        <div style={{ ...card, padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, opacity: 0.65 }}>{region.label}</div>
          <div style={{ fontSize: 40, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{overrides.values?.[region.id] ?? region.value}</div>
        </div>
      );
    case "button":
    case "input": {
      const pressed = overrides.pressedRegionId === region.id;
      return (
        <div
          style={{
            ...card,
            background: pressed ? brand.accent : brand.primary,
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: 18,
            transform: `scale(${pressed ? 0.95 : 1 + 0.04 * focus})`,
          }}
        >
          {region.label}
        </div>
      );
    }
    case "chart":
      return (
        <div style={{ ...card, padding: "16px 20px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 16, opacity: 0.65, marginBottom: 12 }}>{region.label}</div>
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 10 }}>
            {BARS.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h * 100 * (overrides.chartProgress ?? 1)}%`,
                  borderRadius: 6,
                  background: i >= BARS.length - 3 ? brand.accent : brand.primary,
                  opacity: i >= BARS.length - 3 ? 0.85 : 1,
                }}
              />
            ))}
          </div>
        </div>
      );
    case "table":
      return (
        <div style={{ ...card, padding: "12px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 16, opacity: 0.65 }}>{region.label}</div>
          {[0.8, 0.62, 0.48].map((w, i) => (
            <div key={i} style={{ height: 10, width: `${w * 100}%`, borderRadius: 5, background: mix(brand.background, "#ffffff", 0.18) }} />
          ))}
        </div>
      );
    default:
      return <div style={card} />;
  }
};

const BARS = [0.32, 0.38, 0.35, 0.44, 0.5, 0.48, 0.57, 0.62, 0.66, 0.74, 0.82, 0.9];

/** Blend two hex colors; t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `rgb(${c.join(",")})`;
}

function hex(h: string): number[] {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
