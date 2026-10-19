import React from "react";
import { AbsoluteFill, Composition, type CalculateMetadataFunction } from "remotion";
import { VividVideo } from "./Video";
import type { VividProps } from "./types";
import sample from "../../../fixtures/render-props.sample.json";
import { validateShotPlan } from "@vivid/core";
import { LayeredScreen } from "./LayeredScreen";

/** Length and size come from the ShotPlan, so the composition never drifts from the estimate. */
const calculateMetadata: CalculateMetadataFunction<VividProps> = ({ props }) => {
  validateShotPlan(props.plan);
  return ({
  fps: props.plan.fps,
  width: props.width,
  height: props.height,
  durationInFrames: props.plan.shots.reduce((n, s) => n + Math.round(s.durationSec * props.plan.fps), 0),
  });
};

const LayerReference: React.FC<VividProps> = ({ plan }) => {
  const scene = plan.screens[0]?.layerScene;
  return scene ? <AbsoluteFill><LayeredScreen scene={scene} seconds={0} idPrefix="reference" /></AbsoluteFill> : null;
};

export const Root: React.FC = () => (<>
  <Composition
    id="Vivid"
    component={VividVideo}
    defaultProps={sample as unknown as VividProps}
    calculateMetadata={calculateMetadata}
    durationInFrames={1}
    fps={30}
    width={1920}
    height={1080}
  />
  <Composition id="VividLayerReference" component={LayerReference} defaultProps={sample as unknown as VividProps}
    width={1920} height={1080} fps={30} durationInFrames={1}
    calculateMetadata={({ props }) => ({ width: Math.round((props.plan.screens[0]?.layerScene?.width ?? props.width / 2) * 2), height: Math.round((props.plan.screens[0]?.layerScene?.height ?? props.height / 2) * 2) })} />
</>);
