import { Easing, interpolate } from "remotion";
import type { PrimitiveUse, Region, Screen, Shot } from "./types";

/** Pure timing/geometry helpers for motion primitives — no React, easy to reason about. */

export function find(shot: Shot, primitiveId: string): PrimitiveUse | undefined {
  return shot.primitives.find((p) => p.primitiveId === primitiveId);
}

/** 0..1 progress of a primitive at shot-relative time t (seconds). */
export function progress(p: PrimitiveUse | undefined, t: number, ease = Easing.bezier(0.33, 0, 0.2, 1)): number {
  if (!p) return 0;
  return interpolate(t, [p.startSec, p.startSec + p.durationSec], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
}

export function regionOf(screen: Screen | undefined, id: string | undefined): Region | undefined {
  return id ? screen?.regions.find((r) => r.id === id) : undefined;
}

export interface Camera {
  scale: number;
  /** Where the camera is centered, in screen-relative units. */
  cx: number;
  cy: number;
}

const WIDE: Camera = { scale: 1, cx: 0.5, cy: 0.5 };

/**
 * camera/pull-out: 1.12 → 1 wide.
 * camera/push-in: wide → framed on target.
 * Otherwise, shots that act on a region hold a gentle framing on it.
 */
export function cameraFor(shot: Shot, screen: Screen | undefined, t: number): Camera {
  const pullOut = find(shot, "camera/pull-out");
  if (pullOut) return { ...WIDE, scale: 1.12 - 0.12 * progress(pullOut, t) };

  const pushIn = find(shot, "camera/push-in");
  const pushTarget = regionOf(screen, pushIn?.targetRegionId);
  if (pushIn && pushTarget) {
    const k = progress(pushIn, t);
    const framed = frame(pushTarget, 1.7);
    return lerpCam(WIDE, framed, k);
  }

  const target = shot.primitives.map((p) => regionOf(screen, p.targetRegionId)).find(Boolean);
  if (target) {
    const framed = frame(target, target.bbox.w > 0.5 ? 1.15 : 1.45);
    return { ...framed, scale: framed.scale + 0.015 * t }; // slow drift keeps static shots alive
  }
  return WIDE;
}

function frame(r: Region, scale: number): Camera {
  return { scale, cx: r.bbox.x + r.bbox.w / 2, cy: r.bbox.y + r.bbox.h / 2 };
}

function lerpCam(a: Camera, b: Camera, k: number): Camera {
  return { scale: a.scale + (b.scale - a.scale) * k, cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k };
}

/**
 * CSS for the screen layer. `translate` runs before `scale`, so moving the target to the
 * center then scaling about the center keeps it centered at every zoom level. The pan is
 * limited so the screen edge never enters the frame.
 */
export function cameraTransform(c: Camera): string {
  const maxPan = c.scale > 1 ? (0.5 * (c.scale - 1)) / c.scale : 0;
  const dx = clamp(0.5 - c.cx, -maxPan, maxPan);
  const dy = clamp(0.5 - c.cy, -maxPan, maxPan);
  return `scale(${c.scale}) translate(${dx * 100}%, ${dy * 100}%)`;
}

/** "$48,210" → "$52,940" at k, preserving prefix/suffix/decimals. */
export function tickValue(from: string, to: string, k: number): string {
  const a = parseNumeric(from);
  const b = parseNumeric(to);
  if (!a || !b) return k < 0.5 ? from : to;
  const v = a.value + (b.value - a.value) * k;
  const decimals = Math.max(a.decimals, b.decimals);
  return `${b.prefix}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${b.suffix}`;
}

function parseNumeric(s: string): { prefix: string; value: number; suffix: string; decimals: number } | null {
  const m = s.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return null;
  const digits = m[2]!.replace(/,/g, "");
  return { prefix: m[1]!, value: Number(digits), suffix: m[3]!, decimals: digits.includes(".") ? digits.split(".")[1]!.length : 0 };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
