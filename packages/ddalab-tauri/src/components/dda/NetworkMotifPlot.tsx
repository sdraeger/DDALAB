"use client";

import React, { useMemo, useState, useCallback, memo } from "react";
import { NetworkMotifData, AdjacencyMatrix } from "@/types/api";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, ArrowRight, Circle } from "lucide-react";

interface NetworkMotifPlotProps {
  data: NetworkMotifData;
  className?: string;
}

interface NodePosition {
  x: number;
  y: number;
  angle: number;
}

// Professional color palette with gradient support
const EDGE_COLORS = {
  low: { start: "#94a3b8", end: "#64748b" }, // Slate for weak connections
  medium: { start: "#60a5fa", end: "#3b82f6" }, // Blue for medium
  high: { start: "#34d399", end: "#10b981" }, // Emerald for strong
  veryHigh: { start: "#fbbf24", end: "#f59e0b" }, // Amber for very strong
};

const NODE_GRADIENT = {
  light: {
    primary: "#3b82f6",
    secondary: "#1d4ed8",
    glow: "rgba(59, 130, 246, 0.3)",
  },
  dark: {
    primary: "#60a5fa",
    secondary: "#3b82f6",
    glow: "rgba(96, 165, 250, 0.4)",
  },
};

function getEdgeColor(weight: number): { start: string; end: string } {
  if (weight >= 0.75) return EDGE_COLORS.veryHigh;
  if (weight >= 0.5) return EDGE_COLORS.high;
  if (weight >= 0.25) return EDGE_COLORS.medium;
  return EDGE_COLORS.low;
}

function getEdgeOpacity(weight: number): number {
  return 0.4 + weight * 0.6;
}

function getEdgeWidth(weight: number): number {
  return 1.5 + weight * 3;
}

// Single network graph component
const NetworkGraph = memo(function NetworkGraph({
  matrix,
  nodePositions,
  nodeLabels,
  index,
}: {
  matrix: AdjacencyMatrix;
  nodePositions: NodePosition[];
  nodeLabels: string[];
  index: number;
}) {
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{
    from: number;
    to: number;
  } | null>(null);

  const nodeRadius = 20;
  const svgSize = 280;
  const centerX = svgSize / 2;
  const centerY = svgSize / 2;

  // Get connected nodes for highlighting
  const connectedNodes = useMemo(() => {
    if (hoveredNode === null) return new Set<number>();
    const connected = new Set<number>();
    matrix.edges.forEach((edge) => {
      if (edge.from === hoveredNode) connected.add(edge.to);
      if (edge.to === hoveredNode) connected.add(edge.from);
    });
    return connected;
  }, [hoveredNode, matrix.edges]);

  // Calculate statistics
  const stats = useMemo(() => {
    const totalWeight = matrix.edges.reduce((sum, e) => sum + e.weight, 0);
    const avgWeight =
      matrix.edges.length > 0 ? totalWeight / matrix.edges.length : 0;
    const maxWeight = Math.max(...matrix.edges.map((e) => e.weight), 0);
    return { edgeCount: matrix.edges.length, avgWeight, maxWeight };
  }, [matrix.edges]);

  // Calculate curved path for directed edge
  const getEdgePath = useCallback(
    (
      from: NodePosition,
      to: NodePosition,
      isSelfLoop: boolean,
      hasBidirectional: boolean,
    ): string => {
      if (isSelfLoop) {
        const loopRadius = 18;
        const offsetX = Math.cos(from.angle) * (nodeRadius + 2);
        const offsetY = Math.sin(from.angle) * (nodeRadius + 2);
        return `M ${from.x + offsetX} ${from.y + offsetY}
                a ${loopRadius} ${loopRadius} 0 1 1 0.1 0`;
      }

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const nx = dx / dist;
      const ny = dy / dist;

      const startX = from.x + nx * (nodeRadius + 2);
      const startY = from.y + ny * (nodeRadius + 2);
      const endX = to.x - nx * (nodeRadius + 8);
      const endY = to.y - ny * (nodeRadius + 8);

      // Curve offset for bidirectional edges
      const curveOffset = hasBidirectional ? dist * 0.2 : dist * 0.08;
      const cx = (startX + endX) / 2 - ny * curveOffset;
      const cy = (startY + endY) / 2 + nx * curveOffset;

      return `M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`;
    },
    [nodeRadius],
  );

  // Check for bidirectional edges
  const bidirectionalPairs = useMemo(() => {
    const pairs = new Set<string>();
    matrix.edges.forEach((e1) => {
      matrix.edges.forEach((e2) => {
        if (e1.from === e2.to && e1.to === e2.from && e1.from !== e1.to) {
          pairs.add(`${Math.min(e1.from, e1.to)}-${Math.max(e1.from, e1.to)}`);
        }
      });
    });
    return pairs;
  }, [matrix.edges]);

  return (
    <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-shadow duration-300">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Graph {index + 1}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {stats.edgeCount} edge{stats.edgeCount !== 1 ? "s" : ""}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-2">
        <svg
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="w-full h-auto"
          style={{ maxHeight: "260px" }}
        >
          <defs>
            {/* Node gradient */}
            <radialGradient
              id={`nodeGradient-${index}`}
              cx="30%"
              cy="30%"
              r="70%"
            >
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#3b82f6" />
            </radialGradient>

            {/* Node shadow */}
            <filter
              id={`nodeShadow-${index}`}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feDropShadow
                dx="0"
                dy="2"
                stdDeviation="3"
                floodColor="#000"
                floodOpacity="0.15"
              />
            </filter>

            {/* Edge gradients for different weights */}
            {matrix.edges.map((edge, idx) => {
              const colors = getEdgeColor(edge.weight);
              return (
                <linearGradient
                  key={`edgeGrad-${idx}`}
                  id={`edgeGradient-${index}-${idx}`}
                  gradientUnits="userSpaceOnUse"
                  x1={nodePositions[edge.from]?.x}
                  y1={nodePositions[edge.from]?.y}
                  x2={nodePositions[edge.to]?.x}
                  y2={nodePositions[edge.to]?.y}
                >
                  <stop offset="0%" stopColor={colors.start} />
                  <stop offset="100%" stopColor={colors.end} />
                </linearGradient>
              );
            })}

            {/* Arrow markers for different weights */}
            <marker
              id={`arrow-${index}`}
              markerWidth="10"
              markerHeight="8"
              refX="9"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 0 0 L 10 4 L 0 8 L 2 4 Z"
                fill="currentColor"
                className="text-primary/80"
              />
            </marker>

            {/* Glow effect for highlighted elements */}
            <filter
              id={`glow-${index}`}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background circle to indicate graph bounds */}
          <circle
            cx={centerX}
            cy={centerY}
            r={95}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="text-border/30"
          />

          {/* Edges */}
          <g className="edges">
            {matrix.edges.map((edge, edgeIdx) => {
              const from = nodePositions[edge.from];
              const to = nodePositions[edge.to];
              if (!from || !to) return null;

              const isSelfLoop = edge.from === edge.to;
              const pairKey = `${Math.min(edge.from, edge.to)}-${Math.max(edge.from, edge.to)}`;
              const hasBidirectional = bidirectionalPairs.has(pairKey);
              const path = getEdgePath(from, to, isSelfLoop, hasBidirectional);

              const isHighlighted =
                hoveredNode === edge.from ||
                hoveredNode === edge.to ||
                (hoveredEdge?.from === edge.from &&
                  hoveredEdge?.to === edge.to);

              const opacity = isHighlighted
                ? 1
                : hoveredNode !== null
                  ? 0.2
                  : getEdgeOpacity(edge.weight);

              return (
                <TooltipProvider key={`edge-${edgeIdx}`}>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <path
                        d={path}
                        fill="none"
                        stroke={`url(#edgeGradient-${index}-${edgeIdx})`}
                        strokeWidth={getEdgeWidth(edge.weight)}
                        strokeOpacity={opacity}
                        strokeLinecap="round"
                        markerEnd={
                          isSelfLoop ? undefined : `url(#arrow-${index})`
                        }
                        className="cursor-pointer transition-all duration-200"
                        filter={
                          isHighlighted ? `url(#glow-${index})` : undefined
                        }
                        onMouseEnter={() =>
                          setHoveredEdge({ from: edge.from, to: edge.to })
                        }
                        onMouseLeave={() => setHoveredEdge(null)}
                        style={{
                          color: getEdgeColor(edge.weight).end,
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 font-medium">
                          <span>{nodeLabels[edge.from]}</span>
                          <ArrowRight className="h-3 w-3" />
                          <span>{nodeLabels[edge.to]}</span>
                        </div>
                        <div className="text-muted-foreground">
                          Weight: {edge.weight.toFixed(3)}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </g>

          {/* Nodes */}
          <g className="nodes">
            {nodePositions.map((pos, nodeIdx) => {
              const isHovered = hoveredNode === nodeIdx;
              const isConnected = connectedNodes.has(nodeIdx);
              const isDimmed =
                hoveredNode !== null && !isHovered && !isConnected;

              return (
                <TooltipProvider key={`node-${nodeIdx}`}>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <g
                        className="cursor-pointer transition-all duration-200"
                        style={{
                          transform: isHovered ? "scale(1.15)" : "scale(1)",
                          transformOrigin: `${pos.x}px ${pos.y}px`,
                          opacity: isDimmed ? 0.3 : 1,
                        }}
                        onMouseEnter={() => setHoveredNode(nodeIdx)}
                        onMouseLeave={() => setHoveredNode(null)}
                      >
                        {/* Node glow effect */}
                        {isHovered && (
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={nodeRadius + 6}
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth="2"
                            strokeOpacity="0.4"
                            className="animate-pulse"
                          />
                        )}

                        {/* Main node circle */}
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={nodeRadius}
                          fill={`url(#nodeGradient-${index})`}
                          filter={`url(#nodeShadow-${index})`}
                          stroke={isHovered ? "#1d4ed8" : "#2563eb"}
                          strokeWidth={isHovered ? 3 : 2}
                        />

                        {/* Node number */}
                        <text
                          x={pos.x}
                          y={pos.y}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="white"
                          fontSize="11"
                          fontWeight="600"
                          className="pointer-events-none select-none"
                        >
                          {nodeIdx + 1}
                        </text>
                      </g>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div className="flex flex-col gap-1">
                        <div className="font-medium">
                          {nodeLabels[nodeIdx] || `Node ${nodeIdx + 1}`}
                        </div>
                        <div className="text-muted-foreground">
                          {
                            matrix.edges.filter(
                              (e) => e.from === nodeIdx || e.to === nodeIdx,
                            ).length
                          }{" "}
                          connections
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </g>

          {/* Node labels outside the circle */}
          {nodePositions.map((pos, nodeIdx) => {
            const labelOffset = nodeRadius + 14;
            const labelX = pos.x + Math.cos(pos.angle) * labelOffset;
            const labelY = pos.y + Math.sin(pos.angle) * labelOffset;

            // Truncate long labels
            const label = nodeLabels[nodeIdx] || "";
            const displayLabel =
              label.length > 6 ? label.substring(0, 5) + "…" : label;

            return (
              <text
                key={`label-${nodeIdx}`}
                x={labelX}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="central"
                fill="currentColor"
                fontSize="9"
                fontWeight="500"
                className="text-muted-foreground pointer-events-none select-none"
              >
                {displayLabel}
              </text>
            );
          })}
        </svg>

        {/* Stats bar */}
        <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-muted-foreground">
          <span>
            Avg:{" "}
            <span className="font-medium">{stats.avgWeight.toFixed(2)}</span>
          </span>
          <span>
            Max:{" "}
            <span className="font-medium">{stats.maxWeight.toFixed(2)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
});

export function NetworkMotifPlot({ data, className }: NetworkMotifPlotProps) {
  // Calculate node positions in a circle
  const nodePositions = useMemo((): NodePosition[] => {
    const numNodes = data.num_nodes;
    const svgSize = 280;
    const centerX = svgSize / 2;
    const centerY = svgSize / 2;
    const radius = 85;

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

  // Calculate overall statistics
  const overallStats = useMemo(() => {
    let totalEdges = 0;
    let totalWeight = 0;
    data.adjacency_matrices.forEach((m) => {
      totalEdges += m.edges.length;
      totalWeight += m.edges.reduce((sum, e) => sum + e.weight, 0);
    });
    const avgWeight = totalEdges > 0 ? totalWeight / totalEdges : 0;
    return { totalEdges, avgWeight };
  }, [data.adjacency_matrices]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header with overall stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Network Connectivity</h3>
          <Badge variant="outline" className="text-[10px]">
            {data.num_nodes} nodes
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Total edges:{" "}
            <span className="font-medium">{overallStats.totalEdges}</span>
          </span>
          <span>
            Avg weight:{" "}
            <span className="font-medium">
              {overallStats.avgWeight.toFixed(3)}
            </span>
          </span>
        </div>
      </div>

      {/* Network graphs grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {data.adjacency_matrices.map((matrix, index) => (
          <NetworkGraph
            key={index}
            matrix={matrix}
            nodePositions={nodePositions}
            nodeLabels={data.node_labels}
            index={index}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-xs text-muted-foreground border-t">
        <div className="flex items-center gap-2">
          <Circle className="h-3 w-3 fill-primary text-primary" />
          <span>Channel node</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center">
            <div
              className="w-6 h-1 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, #94a3b8 0%, #60a5fa 50%, #34d399 100%)",
              }}
            />
          </div>
          <span>Edge weight (low → high)</span>
        </div>
        <div className="flex items-center gap-2">
          <ArrowRight className="h-3 w-3" />
          <span>Directed connection</span>
        </div>
      </div>
    </div>
  );
}

export default NetworkMotifPlot;
