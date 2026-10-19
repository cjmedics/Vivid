import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { VividVideo } from "./Video";
import type { VividProps } from "./types";
import sample from "../../../fixtures/render-props.sample.json";

/** Length and size come from the ShotPlan, so the composition never drifts from the estimate. */
const calculateMetadata: CalculateMetadataFunction<VividProps> = ({ props }) => ({
  fps: props.plan.fps,
  width: props.width,
  height: props.height,
  durationInFrames: props.plan.shots.reduce((n, s) => n + Math.round(s.durationSec * props.plan.fps), 0),
});

export const Root: React.FC = () => (
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
);
