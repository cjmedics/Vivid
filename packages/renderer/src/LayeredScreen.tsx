import React, { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import { layerPose, type LayerScene, type VectorNode } from "@vivid/core";

const propName = (name: string) => name === "xlink:href" ? "xlinkHref" : name === "xmlns:xlink" ? "xmlnsXlink" : name.startsWith("data-") ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Reconstruct a genuine SVG scene; animate source nodes without replacing their pixels. */
export const LayeredScreen: React.FC<{ scene: LayerScene; seconds: number; entranceSec?: number; idPrefix: string }> = ({ scene, seconds, entranceSec, idPrefix }) => {
  const [handle] = useState(() => delayRender("Loading embedded design images"));
  useEffect(() => {
    const sources = new Set<string>();
    const walk = (node: VectorNode) => {
      if (node.tag === "image") {
        const src = node.attrs.href ?? node.attrs["xlink:href"];
        if (src?.startsWith("data:")) sources.add(src);
      }
      node.children.forEach((c) => { if (typeof c !== "string") walk(c); });
    };
    walk(scene.root);
    Promise.all([...sources].map((src) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(); image.onerror = () => reject(new Error("Embedded design image failed to load")); image.src = src;
    }))).then(() => continueRender(handle)).catch(cancelRender);
  }, [scene, handle]);
  const prefix = idPrefix.replace(/[^a-zA-Z0-9_-]/g, "_") + "-";
  const byNode = new Map(scene.layers.map((layer, index) => [layer.nodeId, { layer, index }]));
  function render(node: VectorNode | string, key: string): React.ReactNode {
    if (typeof node === "string") return node;
    const props: Record<string, unknown> = { key };
    for (const [name, raw] of Object.entries(node.attrs)) {
      let value = raw;
      if (name === "id") value = prefix + raw;
      else if ((name === "href" || name === "xlink:href") && raw.startsWith("#")) value = "#" + prefix + raw.slice(1);
      else value = raw.replace(/url\(#([^)]*)\)/g, (_, id: string) => `url(#${prefix}${id})`);
      if (name === "style") props.style = Object.fromEntries(raw.split(";").filter((v) => v.trim()).map((v) => { const [k, val] = v.split(":"); return [propName(k!.trim()), val!.trim()]; }));
      else props[propName(name)] = value;
    }
    if (node === scene.root) Object.assign(props, { width: "100%", height: "100%", style: { display: "block", overflow: "hidden" } });
    const element = React.createElement(node.tag, props, ...node.children.map((c, i) => render(c, `${key}-${i}`)));
    const target = byNode.get(node.attrs["data-node-id"] ?? "");
    if (!target || !entranceSec) return element;
    const pose = layerPose(target.layer, target.index, seconds, scene.layers.length, entranceSec);
    const clipId = `${prefix}entrance-${target.index}`;
    return <g key={key} opacity={pose.opacity} transform={`translate(0 ${pose.translateY})`}>
      {target.layer.kind === "image" && <defs><clipPath id={clipId} clipPathUnits="objectBoundingBox"><rect x={0} y={0} width={1} height={pose.reveal} /></clipPath></defs>}
      <g clipPath={target.layer.kind === "image" ? `url(#${clipId})` : undefined}>{element}</g>
    </g>;
  }
  return <>{render(scene.root, "root")}</>;
};
