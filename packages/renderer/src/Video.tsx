import React, { useEffect, useState } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, cancelRender, continueRender, delayRender, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SyntheticScreen, mix, type ScreenOverrides } from "./SyntheticScreen";
import { LayeredScreen } from "./LayeredScreen";
import { cameraFor, cameraTransform, find, progress, regionOf, tickValue } from "./primitives";
import type { ShotAsset, Shot, ShotPlan, VividProps } from "./types";

export const VividVideo: React.FC<VividProps> = ({ plan, assets }) => {
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => plan.brand.fontUrl ? delayRender("Loading brand font") : null);
  useEffect(() => {
    if (fontHandle === null || !plan.brand.fontUrl) return;
    const font = new FontFace("VividBrand", `url(${plan.brand.fontUrl})`);
    font.load().then((loaded) => {
      // Some dependency DOM declarations omit FontFaceSet's standard add() method.
      (document.fonts as FontFaceSet & { add(font: FontFace): FontFaceSet }).add(loaded);
      continueRender(fontHandle);
    }).catch(cancelRender);
  }, [fontHandle, plan.brand.fontUrl]);
  const renderedPlan = plan.brand.fontUrl ? { ...plan, brand: { ...plan.brand, fontFamily: "VividBrand" } } : plan;
  let from = 0;
  return (
    <AbsoluteFill style={{ background: plan.brand.background, fontFamily: renderedPlan.brand.fontFamily }}>
      {plan.shots.map((shot) => {
        const frames = Math.round(shot.durationSec * fps);
        const start = from;
        from += frames;
        return (
          <Sequence key={shot.id} from={start} durationInFrames={frames} name={`${shot.id} · ${shot.beat}`}>
            <ShotView shot={shot} plan={renderedPlan} asset={assets[shot.id] ?? { kind: "deterministic" }} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const ShotView: React.FC<{ shot: Shot; plan: ShotPlan; asset: ShotAsset }> = ({ shot, plan, asset }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const { brand } = plan;

  const screenId = shot.primitives.find((p) => p.screenId)?.screenId;
  const screen = plan.screens.find((s: { id: string }) => s.id === screenId);

  // Shot-entry transition.
  const dissolve = find(shot, "transitions/dissolve");
  const slide = find(shot, "transitions/slide");
  const enter = progress(dissolve ?? slide, t);
  const entryStyle: React.CSSProperties =
    dissolve || slide
      ? { opacity: enter, transform: slide ? `translateX(${(1 - enter) * 6}%)` : undefined }
      : {};

  // Screen state driven by data/interaction primitives. Values changed by earlier shots persist.
  const overrides: ScreenOverrides = { values: carriedValues(plan, shot) };
  const emphasis = find(shot, "data/metric-emphasis");
  if (emphasis?.targetRegionId) overrides.emphasis = { regionId: emphasis.targetRegionId, amount: progress(emphasis, t) };
  const tick = find(shot, "data/counter-tick");
  if (tick?.targetRegionId) {
    overrides.values = { ...overrides.values, [tick.targetRegionId]: tickValue(String(tick.params.from ?? ""), String(tick.params.to ?? ""), progress(tick, t)) };
    overrides.emphasis = { regionId: tick.targetRegionId, amount: 0.6 };
  }
  const grow = find(shot, "data/chart-grow");
  if (grow) {
    overrides.chartProgress = progress(grow, t);
    if (grow.targetRegionId) overrides.emphasis = { regionId: grow.targetRegionId, amount: 0.5 };
  }
  const click = find(shot, "interaction/cursor-click");
  const clickK = click ? (t - click.startSec) / click.durationSec : -1;
  // The value change itself belongs to the next beat (show-state-change), keeping continuity.
  if (click?.targetRegionId && clickK >= 0.6 && clickK <= 0.8) overrides.pressedRegionId = click.targetRegionId;

  const backdrop = find(shot, "presentation/ambient-backdrop") ?? find(shot, "presentation/cinematic-plate");
  const headline = shot.primitives.find((p) => p.primitiveId.startsWith("typography/") && p.params.slot === "headline");
  const subtext = shot.primitives.find((p) => p.primitiveId.startsWith("typography/") && p.params.slot === "subtext");
  const cta = find(shot, "presentation/cta-card");
  const highlight = find(shot, "presentation/region-highlight");
  const layerEntrance = find(shot, "presentation/layer-entrance");
  const highlightRegion = regionOf(screen, highlight?.targetRegionId);
  const aspect = screen?.width && screen.height ? screen.width / screen.height : 16 / 10;
  const screenWidth = Math.min(width * 0.84, height * (subtext ? 0.65 : 0.78) * aspect);

  return (
    <AbsoluteFill style={entryStyle}>
      {plan.presetId === "design-reveal" && <AbsoluteFill style={{ background: `radial-gradient(ellipse at 15% 20%, ${brand.primary}33, transparent 55%), radial-gradient(ellipse at 90% 80%, ${brand.accent}22, transparent 50%)` }} />}
      {backdrop && <Backdrop asset={asset} brand={brand} generatedSec={shot.generation?.durationSec ?? shot.durationSec} cinematic={backdrop.primitiveId.endsWith("plate")} />}

      {screen && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              position: "relative",
              width: screenWidth,
              height: screenWidth / aspect,
              borderRadius: 22,
              overflow: "hidden",
              boxShadow: `0 40px 120px ${mix(brand.background, "#000000", 0.6)}`,
              border: `1px solid ${mix(brand.background, "#ffffff", 0.16)}`,
              marginTop: subtext ? "-8%" : 0,
            }}
          >
            <div style={{ position: "absolute", inset: 0, transform: cameraTransform(cameraFor(shot, screen, t)) }}>
              {screen.layerScene
                ? <LayeredScreen scene={screen.layerScene} seconds={t - (layerEntrance?.startSec ?? 0)} entranceSec={layerEntrance?.durationSec} idPrefix={shot.id} />
                : screen.captureUrl
                ? <Img src={screen.captureUrl} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }} />
                : <SyntheticScreen screen={screen} brand={brand} overrides={overrides} />}
              {highlightRegion && highlight && <div style={{
                position: "absolute", pointerEvents: "none",
                left: `${highlightRegion.bbox.x * 100}%`, top: `${highlightRegion.bbox.y * 100}%`,
                width: `${highlightRegion.bbox.w * 100}%`, height: `${highlightRegion.bbox.h * 100}%`,
                border: `3px solid ${brand.accent}`, boxSizing: "border-box", borderRadius: 10,
                boxShadow: `0 0 35px ${brand.accent}55`, opacity: progress(highlight, t),
              }} />}
              {click && <Cursor region={regionOf(screen, click.targetRegionId)} k={clickK} />}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {headline && <TextReveal text={plan.copy.headline} kind={headline.primitiveId} k={progress(headline, t)} size={84} brand={brand} position="center" />}
      {subtext && <TextReveal text={plan.copy.subtext} kind={subtext.primitiveId} k={progress(subtext, t)} size={40} brand={brand} position="bottom" />}
      {cta && <CtaCard plan={plan} frame={frame - Math.round(cta.startSec * fps)} />}
    </AbsoluteFill>
  );
};

function carriedValues(plan: ShotPlan, shot: Shot): Record<string, string> {
  const values: Record<string, string> = {};
  for (const earlier of plan.shots.slice(0, plan.shots.indexOf(shot))) {
    for (const p of earlier.primitives) {
      if (p.primitiveId === "data/counter-tick" && p.targetRegionId && p.params.to) values[p.targetRegionId] = String(p.params.to);
    }
  }
  return values;
}

/** Generated backdrop; mock:// assets get a brand-colored stand-in so renders work offline. */
const Backdrop: React.FC<{ asset: ShotAsset; brand: ShotPlan["brand"]; generatedSec: number; cinematic: boolean }> = ({ asset, brand, generatedSec, cinematic }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const fadeOut = interpolate(t, [generatedSec - 0.6, generatedSec], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  if (asset.kind === "generated" && /^https?:\/\//.test(asset.url)) {
    return (
      <AbsoluteFill style={{ opacity: fadeOut }}>
        <OffthreadVideo src={asset.url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    );
  }
  const a = 30 + 20 * Math.sin(t * 0.6);
  const b = 70 + 15 * Math.cos(t * 0.45);
  return (
    <AbsoluteFill
      style={{
        opacity: fadeOut,
        background: `radial-gradient(circle at ${a}% 40%, ${brand.primary}${cinematic ? "aa" : "66"} 0%, transparent 45%), radial-gradient(circle at ${b}% 70%, ${brand.accent}${cinematic ? "88" : "44"} 0%, transparent 50%), ${brand.background}`,
        filter: `blur(${cinematic ? 10 : 30}px)`,
        transform: `scale(${1.1 + 0.02 * t})`,
      }}
    />
  );
};

const TextReveal: React.FC<{ text: string; kind: string; k: number; size: number; brand: ShotPlan["brand"]; position: "center" | "bottom" }> = ({
  text,
  kind,
  k,
  size,
  brand,
  position,
}) => {
  const words = text.split(" ");
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: position === "center" ? "center" : "flex-end", paddingBottom: position === "bottom" ? "6%" : 0 }}>
      <div style={{ overflow: "hidden", padding: "0.1em 0.4em", maxWidth: "80%", textAlign: "center" }}>
        <div style={{ fontSize: size, fontWeight: position === "center" ? 700 : 500, color: brand.foreground, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
          {kind === "typography/word-reveal"
            ? words.map((w, i) => {
                const wk = Math.min(1, Math.max(0, k * (words.length + 2) - i));
                return (
                  <span key={i} style={{ display: "inline-block", opacity: wk, transform: `translateY(${(1 - wk) * 40}%)`, marginRight: "0.25em" }}>
                    {w}
                  </span>
                );
              })
            : <span style={{ display: "inline-block", transform: `translateY(${(1 - Math.min(1, k * 1.6)) * 110}%)`, opacity: Math.min(1, k * 2) }}>{text}</span>}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Cursor: React.FC<{ region: { bbox: { x: number; y: number; w: number; h: number } } | undefined; k: number }> = ({ region, k }) => {
  if (!region || k < 0) return null;
  const tx = region.bbox.x + region.bbox.w / 2;
  const ty = region.bbox.y + region.bbox.h / 2;
  const move = Math.min(1, k / 0.6);
  const ease = 1 - (1 - move) ** 3;
  const x = 0.98 + (tx - 0.98) * ease;
  const y = 1.05 + (ty - 1.05) * ease;
  const ripple = k >= 0.6 ? Math.min(1, (k - 0.6) / 0.3) : 0;
  return (
    <>
      {ripple > 0 && (
        <div
          style={{
            position: "absolute",
            left: `${tx * 100}%`,
            top: `${ty * 100}%`,
            width: 90,
            height: 90,
            marginLeft: -45,
            marginTop: -45,
            borderRadius: "50%",
            border: "3px solid white",
            opacity: 1 - ripple,
            transform: `scale(${0.3 + ripple})`,
          }}
        />
      )}
      <svg style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: 34, height: 34, transform: `scale(${k >= 0.6 && k < 0.7 ? 0.85 : 1})`, filter: "drop-shadow(0 4px 8px rgba(0,0,0,.5))" }} viewBox="0 0 24 24">
        <path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.5 L11 13.5 L18 13.5 Z" fill="white" stroke="black" strokeWidth="1.2" />
      </svg>
    </>
  );
};

const CtaCard: React.FC<{ plan: ShotPlan; frame: number }> = ({ plan, frame }) => {
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 18, mass: 0.8 } });
  const { brand } = plan;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: s, transform: `scale(${0.92 + 0.08 * s})` }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {brand.logoUrl
            ? <Img src={brand.logoUrl} style={{ width: 64, height: 64, objectFit: "contain" }} />
            : <div style={{ width: 64, height: 64, borderRadius: 18, background: brand.primary }} />}
          <div style={{ fontSize: 72, fontWeight: 800, color: brand.foreground, letterSpacing: "-0.03em" }}>{plan.productName}</div>
        </div>
        <div style={{ fontSize: 34, color: brand.foreground, opacity: 0.75 }}>{plan.copy.headline}</div>
        <div style={{ marginTop: 12, padding: "18px 40px", borderRadius: 999, background: brand.accent, color: brand.background, fontSize: 30, fontWeight: 700 }}>
          {plan.copy.cta}
        </div>
      </div>
    </AbsoluteFill>
  );
};
