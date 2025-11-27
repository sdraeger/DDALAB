"use client";

import React, { useMemo, useState } from "react";
import { NetworkMotifData, AdjacencyMatrix, NetworkEdge } from "@/types/api";
import { cn } from "@/lib/utils";

interface NetworkMotifPlotProps {
  data: NetworkMotifData;
  colorScheme?: "default" | "blue" | "green" | "purple";
  className?: string;
}

interface NodePosition {
  x: number;
  y: number;
  angle: number;
}

interface TooltipData {
  x: number;
  y: number;
  content: string;
}

const COLOR_SCHEMES = {
  default: {
    node: "#3b82f6",
    nodeStroke: "#1d4ed8",
    edge: "#6366f1",
    text: "#1f2937",
    background: "#f8fafc",
  },
  blue: {
    node: "#0ea5e9",
    nodeStroke: "#0284c7",
    edge: "#38bdf8",
    text: "#0c4a6e",
    background: "#f0f9ff",
  },
  green: {
    node: "#10b981",
    nodeStroke: "#059669",
    edge: "#34d399",
    text: "#064e3b",
    background: "#f0fdf4",
  },
  purple: {
    node: "#8b5cf6",
    nodeStroke: "#7c3aed",
    edge: "#a78bfa",
    text: "#4c1d95",
    background: "#faf5ff",
  },
};

export function NetworkMotifPlot({
  data,
  colorScheme = "default",
  className,
}: NetworkMotifPlotProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const colors = COLOR_SCHEMES[colorScheme];

  // Calculate node positions in a circle
  const nodePositions = useMemo((): NodePosition[] => {
    const numNodes = data.num_nodes;
    const centerX = 100;
    const centerY = 100;
    const radius = 70;

    return Array.from({ length: numNodes }, (_, i) => {
      // Start from top (-π/2) and go clockwise
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / numNodes;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        angle,
      };
    });
  }, [data.num_nodes]);

  // Render a single network graph
  const renderGraph = (matrix: AdjacencyMatrix, index: number) => {
    const nodeRadius = 12;

    // Calculate curved path for directed edge
    const getEdgePath = (
      from: NodePosition,
      to: NodePosition,
      isSelfLoop: boolean,
    ): string => {
      if (isSelfLoop) {
        // Self-loop
        const loopRadius = 15;
        const offsetX = Math.cos(from.angle) * nodeRadius;
        const offsetY = Math.sin(from.angle) * nodeRadius;
        return `M ${from.x + offsetX} ${from.y + offsetY}
                a ${loopRadius} ${loopRadius} 0 1 1 1 0`;
      }

      // Curved edge for bidirectional support
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Normalize direction
      const nx = dx / dist;
      const ny = dy / dist;

      // Offset start and end points by node radius
      const startX = from.x + nx * nodeRadius;
      const startY = from.y + ny * nodeRadius;
      const endX = to.x - nx * (nodeRadius + 6); // Extra offset for arrow
      const endY = to.y - ny * (nodeRadius + 6);

      // Curve control point (perpendicular offset)
      const curveOffset = dist * 0.15;
      const cx = (startX + endX) / 2 - ny * curveOffset;
      const cy = (startY + endY) / 2 + nx * curveOffset;

      return `M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`;
    };

    return (
      <div key={index} className="flex flex-col items-center">
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Delay: {(matrix.delay ?? (matrix as any).scale ?? 0).toFixed(2)}
        </div>
        <svg
          viewBox="0 0 200 200"
          className="w-full max-w-[200px] h-auto"
          style={{ background: colors.background }}
        >
          <defs>
            <marker
              id={`arrowhead-${index}`}
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon
                points="0 0, 8 3, 0 6"
                fill={colors.edge}
                fillOpacity="0.8"
              />
            </marker>
          </defs>

          {/* Edges */}
          {matrix.edges.map((edge, edgeIdx) => {
            const from = nodePositions[edge.from];
            const to = nodePositions[edge.to];
            if (!from || !to) return null;

            const isSelfLoop = edge.from === edge.to;
            const path = getEdgePath(from, to, isSelfLoop);
            const opacity = 0.3 + edge.weight * 0.7;
            const strokeWidth = 1 + edge.weight * 2;

            return (
              <path
                key={`edge-${edgeIdx}`}
                d={path}
                fill="none"
                stroke={colors.edge}
                strokeWidth={strokeWidth}
                strokeOpacity={opacity}
                markerEnd={isSelfLoop ? undefined : `url(#arrowhead-${index})`}
                className="cursor-pointer hover:stroke-opacity-100 transition-all"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltip({
                    x: rect.left + rect.width / 2,
                    y: rect.top - 10,
                    content: `${data.node_labels[edge.from]} → ${data.node_labels[edge.to]}: ${edge.weight.toFixed(3)}`,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}

          {/* Nodes */}
          {nodePositions.map((pos, nodeIdx) => (
            <g key={`node-${nodeIdx}`}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius}
                fill={colors.node}
                stroke={colors.nodeStroke}
                strokeWidth={2}
                className="cursor-pointer hover:opacity-80 transition-opacity duration-150"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltip({
                    x: rect.left + rect.width / 2,
                    y: rect.top - 10,
                    content: data.node_labels[nodeIdx] || `Node ${nodeIdx + 1}`,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize="8"
                fontWeight="bold"
                className="pointer-events-none select-none"
              >
                {nodeIdx + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  };

  return (
    <div className={cn("relative", className)}>
      <div className="grid grid-cols-3 gap-4">
        {data.adjacency_matrices.map((matrix, index) =>
          renderGraph(matrix, index),
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2 py-1 text-xs bg-popover text-popover-foreground rounded shadow-md border pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          {tooltip.content}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: colors.node }}
          />
          <span>Node</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-0.5"
            style={{ background: colors.edge, opacity: 0.8 }}
          />
          <span>→ Directed edge</span>
        </div>
        <div className="text-muted-foreground/60">(Threshold: 0.25)</div>
      </div>
    </div>
  );
}

export default NetworkMotifPlot;
