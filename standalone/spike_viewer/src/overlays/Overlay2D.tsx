// SPDX-License-Identifier: Apache-2.0
import type React from "react";
import {
  activeVirtualFrame,
  virtualLayerRange,
  virtualOpacity,
  virtualPickForSample,
  virtualSampleColour,
} from "./rendering";
import type {
  SurfacePrimitive,
  VirtualFrame,
  VirtualLayer,
  VirtualPick,
  VirtualPrimitive,
} from "./types";

export type Overlay2DProps = {
  layers: readonly VirtualLayer[];
  frameIndex: number;
  toLayout: (point: [number, number]) => [number, number];
  onPick?: (pick: VirtualPick) => void;
};

const coordinate = (value: number) => value.toFixed(5).replace(/\.?0+$/, "") || "0";
const pointText = (point: readonly [number, number]) => `${coordinate(point[0])},${coordinate(point[1])}`;

function projectedPoint(
  point: readonly [number, number, number],
  toLayout: Overlay2DProps["toLayout"],
): [number, number] {
  return toLayout([point[0], point[1]]);
}

function projectedLength(
  point: readonly [number, number, number],
  lengthMm: number,
  toLayout: Overlay2DProps["toLayout"],
): number {
  const center = projectedPoint(point, toLayout);
  const edge = toLayout([point[0] + lengthMm, point[1]]);
  return Math.hypot(edge[0] - center[0], edge[1] - center[1]);
}

function projectedRadius(
  point: readonly [number, number, number],
  radiusMm: number,
  toLayout: Overlay2DProps["toLayout"],
): number {
  return Math.max(0.5, projectedLength(point, radiusMm, toLayout));
}

function circlePath(center: readonly [number, number], radius: number): string {
  return `M${coordinate(center[0] - radius)},${coordinate(center[1])}`
    + `a${coordinate(radius)},${coordinate(radius)} 0 1,0 ${coordinate(radius * 2)},0`
    + `a${coordinate(radius)},${coordinate(radius)} 0 1,0 ${coordinate(-radius * 2)},0Z`;
}

function pickProps(onPick: Overlay2DProps["onPick"], pick: VirtualPick) {
  if (!onPick) return { pointerEvents: "none" as const };
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": `${pick.primitiveId} sample ${pick.sampleIndex}`,
    style: { cursor: "pointer" },
    onPointerDown: (event: React.PointerEvent<SVGElement>) => event.stopPropagation(),
    onPointerUp: (event: React.PointerEvent<SVGElement>) => event.stopPropagation(),
    onPointerCancel: (event: React.PointerEvent<SVGElement>) => event.stopPropagation(),
    onClick: (event: React.MouseEvent<SVGElement>) => {
      event.stopPropagation();
      onPick(pick);
    },
    onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      onPick(pick);
    },
  };
}

function nearestPickProps(
  onPick: NonNullable<Overlay2DProps["onPick"]>,
  picks: readonly VirtualPick[],
  positions: readonly [number, number][],
) {
  const properties = pickProps(onPick, picks[0]);
  return {
    ...properties,
    onClick: (event: React.MouseEvent<SVGElement>) => {
      event.stopPropagation();
      const svg = event.currentTarget.ownerSVGElement;
      const matrix = svg?.getScreenCTM();
      let x = event.nativeEvent.offsetX;
      let y = event.nativeEvent.offsetY;
      if (matrix && typeof DOMPoint !== "undefined") {
        const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        x = local.x;
        y = local.y;
      }
      let nearest = 0;
      let distance = Infinity;
      positions.forEach((position, index) => {
        const next = (position[0] - x) ** 2 + (position[1] - y) ** 2;
        if (next < distance) { nearest = index; distance = next; }
      });
      onPick(picks[nearest]);
    },
  };
}

function colourPaths(entries: Map<string, string[]>): React.ReactNode[] {
  return [...entries.entries()].map(([fill, commands]) =>
    <path key={fill} d={commands.join(" ")} fill={fill} stroke="none" pointerEvents="none" />);
}

function points2d(
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: Extract<VirtualPrimitive, { kind: "points" }>,
  range: readonly [number, number],
  toLayout: Overlay2DProps["toLayout"],
  onPick: Overlay2DProps["onPick"],
): React.ReactNode {
  const visible = primitive.positionsMm.map((_, index) => index)
    .filter(index => !primitive.values || primitive.values[index] !== null);
  const paths = new Map<string, string[]>();
  for (const index of visible) {
    const color = virtualSampleColour(primitive, index, range);
    const commands = paths.get(color) ?? [];
    const position = projectedPoint(primitive.positionsMm[index], toLayout);
    commands.push(circlePath(position, projectedRadius(primitive.positionsMm[index], primitive.radiusMm ?? 0.35, toLayout)));
    paths.set(color, commands);
  }
  return <g key={primitive.id} data-virtual-primitive={primitive.id}>
    {colourPaths(paths)}
    {onPick && visible.map(index => {
      const [cx, cy] = projectedPoint(primitive.positionsMm[index], toLayout);
      const radius = Math.max(4, projectedRadius(primitive.positionsMm[index], primitive.radiusMm ?? 0.35, toLayout));
      const pick = virtualPickForSample(layer, frame, primitive, index);
      return <circle key={index} cx={cx} cy={cy} r={radius} fill="transparent"
        data-virtual-sample={index} {...pickProps(onPick, pick)} />;
    })}
  </g>;
}

function vectorPath(start: [number, number], end: [number, number]): string {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return circlePath(start, 1.5);
  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(length * 0.35, Math.max(3, length * 0.18));
  const wing = head * 0.45;
  const baseX = end[0] - ux * head;
  const baseY = end[1] - uy * head;
  return `M${pointText(start)}L${pointText(end)}`
    + `M${pointText(end)}L${pointText([baseX - uy * wing, baseY + ux * wing])}`
    + `M${pointText(end)}L${pointText([baseX + uy * wing, baseY - ux * wing])}`;
}

function vectors2d(
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: Extract<VirtualPrimitive, { kind: "vectors" }>,
  range: readonly [number, number],
  toLayout: Overlay2DProps["toLayout"],
  onPick: Overlay2DProps["onPick"],
): React.ReactNode {
  const paths = new Map<string, string[]>();
  const geometry = primitive.positionsMm.map((position, index) => ({ position, index }))
    .filter(({ index }) => primitive.values?.[index] !== null)
    .map(({ position, index }) => {
    const vector = primitive.vectors[index];
    const start = projectedPoint(position, toLayout);
    const end = toLayout([
      position[0] + vector[0] * primitive.displayScaleMm,
      position[1] + vector[1] * primitive.displayScaleMm,
    ]);
    const color = virtualSampleColour(primitive, index, range);
    const commands = paths.get(color) ?? [];
    commands.push(vectorPath(start, end));
    paths.set(color, commands);
    return { index, start, end };
  });
  return <g key={primitive.id} data-virtual-primitive={primitive.id}>
    {[...paths.entries()].map(([stroke, commands]) =>
      <path key={stroke} d={commands.join(" ")} fill="none" stroke={stroke} strokeWidth={1.5}
        vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
    {onPick && geometry.map(({ index, start, end }) => {
      const pick = virtualPickForSample(layer, frame, primitive, index);
      return Math.hypot(end[0] - start[0], end[1] - start[1]) > 1e-12
        ? <line key={index} x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]}
          stroke="transparent" strokeWidth={8} vectorEffect="non-scaling-stroke"
          data-virtual-sample={index} {...pickProps(onPick, pick)} />
        : <circle key={index} cx={start[0]} cy={start[1]} r={4} fill="transparent"
          data-virtual-sample={index} {...pickProps(onPick, pick)} />;
    })}
  </g>;
}

function admittedTriangles(primitive: SurfacePrimitive): [number, number, number][] {
  return primitive.triangles.filter(triangle => triangle.every(index =>
    index >= 0 && index < primitive.positionsMm.length && (!primitive.values || primitive.values[index] !== null)));
}

function surface2d(
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: SurfacePrimitive,
  range: readonly [number, number],
  toLayout: Overlay2DProps["toLayout"],
  onPick: Overlay2DProps["onPick"],
): React.ReactNode {
  const paths = new Map<string, string[]>();
  const faces = admittedTriangles(primitive).map(triangle => ({
    triangle,
    positions: triangle.map(index => projectedPoint(primitive.positionsMm[index], toLayout)) as [number, number][],
  }));
  for (const { triangle, positions } of faces) {
    const colorIndex = primitive.values
      ? triangle.reduce((best, index) => {
        const target = triangle.reduce((sum, item) => sum + (primitive.values?.[item] ?? 0), 0) / 3;
        return Math.abs((primitive.values?.[index] ?? 0) - target) < Math.abs((primitive.values?.[best] ?? 0) - target)
          ? index : best;
      }, triangle[0])
      : triangle[0];
    const color = virtualSampleColour(primitive, colorIndex, range);
    const commands = paths.get(color) ?? [];
    commands.push(`${positions.map((position, order) =>
      `${order ? "L" : "M"}${pointText(position)}`).join("")}Z`);
    paths.set(color, commands);
  }
  return <g key={primitive.id} data-virtual-primitive={primitive.id}>
    {colourPaths(paths)}
    {onPick && faces.map(({ triangle, positions }, faceIndex) => {
      const picks = triangle.map(index => virtualPickForSample(layer, frame, primitive, index));
      return <polygon key={faceIndex} points={positions.map(pointText).join(" ")} fill="transparent"
        data-virtual-face={faceIndex} {...nearestPickProps(onPick, picks, positions)} />;
    })}
  </g>;
}

function path2d(
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: Extract<VirtualPrimitive, { kind: "path" }>,
  toLayout: Overlay2DProps["toLayout"],
  onPick: Overlay2DProps["onPick"],
): React.ReactNode {
  const positions = primitive.positionsMm.map(position => projectedPoint(position, toLayout));
  const d = positions.length
    ? `${positions.map((position, index) => `${index ? "L" : "M"}${pointText(position)}`).join("")}${primitive.closed ? "Z" : ""}`
    : "";
  const width = primitive.positionsMm.length
    ? Number(Math.max(0.01, projectedLength(primitive.positionsMm[0], primitive.widthMm ?? 0.2, toLayout)).toFixed(5))
    : 1;
  return <g key={primitive.id} data-virtual-primitive={primitive.id}>
    <path d={d} fill="none" stroke={primitive.color ?? "#a78bfa"}
      strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
    {onPick && Array.from({ length: primitive.closed ? positions.length : Math.max(0, positions.length - 1) }, (_, index) => {
      const next = (index + 1) % positions.length;
      const picks = [
        virtualPickForSample(layer, frame, primitive, index),
        virtualPickForSample(layer, frame, primitive, next),
      ];
      return <line key={index} x1={positions[index][0]} y1={positions[index][1]}
        x2={positions[next][0]} y2={positions[next][1]} stroke="transparent" strokeWidth={Math.max(8, width)}
        strokeLinecap="round" data-virtual-segment={index}
        {...nearestPickProps(onPick, picks, [positions[index], positions[next]])} />;
    })}
  </g>;
}

function labels2d(
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: Extract<VirtualPrimitive, { kind: "labels" }>,
  toLayout: Overlay2DProps["toLayout"],
  onPick: Overlay2DProps["onPick"],
): React.ReactNode {
  return <g key={primitive.id} data-virtual-primitive={primitive.id} fill={primitive.color ?? "#f8fafc"}>
    {primitive.positionsMm.map((position, index) => {
      const [x, y] = projectedPoint(position, toLayout);
      const pick = virtualPickForSample(layer, frame, primitive, index);
      const fontSize = Number(Math.max(0.01, projectedLength(position, 2, toLayout)).toFixed(5));
      const strokeWidth = Number(Math.max(0.01, projectedLength(position, 0.18, toLayout)).toFixed(5));
      return <text key={index} x={x} y={y} dominantBaseline="middle" fontSize={fontSize}
        paintOrder="stroke" stroke="rgba(7, 15, 28, .82)" strokeWidth={strokeWidth}
        data-virtual-sample={index} {...pickProps(onPick, pick)}>{primitive.labels[index]}</text>;
    })}
  </g>;
}

function primitive2d(
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: VirtualPrimitive,
  range: readonly [number, number],
  toLayout: Overlay2DProps["toLayout"],
  onPick: Overlay2DProps["onPick"],
): React.ReactNode {
  if (primitive.kind === "points") return points2d(layer, frame, primitive, range, toLayout, onPick);
  if (primitive.kind === "vectors") return vectors2d(layer, frame, primitive, range, toLayout, onPick);
  if (primitive.kind === "surface") return surface2d(layer, frame, primitive, range, toLayout, onPick);
  if (primitive.kind === "path") return path2d(layer, frame, primitive, toLayout, onPick);
  return labels2d(layer, frame, primitive, toLayout, onPick);
}

/** SVG overlay in source XY coordinates. Labels are React text nodes, never injected markup. */
export function Overlay2D({ layers, frameIndex, toLayout, onPick }: Overlay2DProps) {
  return <g data-spike-virtual-overlays>
    {layers.map(layer => {
      const frame = activeVirtualFrame(layer, frameIndex);
      const visible = layer.visible && frame !== null && virtualOpacity(layer) > 0;
      return <g key={layer.id} data-virtual-layer={layer.id} data-virtual-frame={frame?.id}
        visibility={visible ? "visible" : "hidden"} opacity={virtualOpacity(layer)}>
        {frame?.primitives.map(primitive =>
          primitive2d(layer, frame, primitive, virtualLayerRange(layer), toLayout, onPick))}
      </g>;
    })}
  </g>;
}
